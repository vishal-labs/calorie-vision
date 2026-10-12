"""
Calorie Vision — FastAPI Backend
Analyzes food images via OpenRouter, looks up packaged food by barcode via
Open Food Facts, and manages users, meals, presets, budgets and water.
"""
import os
import re
import json
import asyncio
import base64
import hashlib
import hmac
import logging
import datetime
import uuid
import httpx
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Optional
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from database import DB, init_db, async_session
from models import User, Meal, Preset, Budget, UserProfile, WaterLog
from schemas import (
    RegisterRequest, LoginRequest, ChangePasswordRequest, AuthResponse,
    MealCreate, MealBatchCreate, MealUpdate, MealGroupUpdate, MealResponse, MealListResponse,
    RecentFood, PresetCreate, PresetResponse,
    BudgetResponse, BudgetUpdate, HistoryResponse, HistoryDay,
    ProfileUpdate, ProfileResponse, GoalSummary,
    ForgotPasswordRequest, ResetPasswordRequest, WaterUpdate, WaterResponse,
)
from auth import (
    hash_password, verify_password, create_token, load_jwt_secret,
    get_current_user, generate_reset_token, verify_reset_token,
    login_limiter, reset_limiter,
)
import food_facts

load_dotenv()

logger = logging.getLogger("calorievision")
logging.basicConfig(level=logging.INFO)

LLM_MODEL = os.getenv("LLM_MODEL", "google/gemma-4-31b-it")
DEFAULT_BUDGET = 2000
MEAL_TYPES = ("breakfast", "lunch", "dinner", "snack")


# ══════════════════════════════════════════════
# Helper Functions
# ══════════════════════════════════════════════

ACTIVITY_MULTIPLIERS = {
    "sedentary": 1.2,
    "light": 1.375,
    "moderate": 1.55,
    "active": 1.725,
    "very_active": 1.9,
}
GOAL_MODIFIERS = {"lose": 0.8, "maintain": 1.0, "gain": 1.15}


def calculate_bmr(weight_kg, height_cm, age, gender) -> Optional[float]:
    """Mifflin-St Jeor."""
    if None in (weight_kg, height_cm, age, gender):
        return None
    base = (10 * weight_kg) + (6.25 * height_cm) - (5 * age)
    return base + 5 if gender == "male" else base - 161


def calculate_bmi_tdee(
    height_cm: Optional[float],
    weight_kg: Optional[float],
    age: Optional[int],
    gender: Optional[str],
    activity_level: Optional[str],
    goal: Optional[str],
) -> tuple[Optional[float], Optional[float]]:
    """
    Returns (bmi, goal-adjusted daily target). The second value is stored as
    `UserProfile.tdee` for backwards compatibility.
    """
    bmi = None
    tdee = None

    if height_cm is not None and weight_kg is not None and height_cm > 0:
        height_m = height_cm / 100.0
        bmi = round(weight_kg / (height_m ** 2), 1)

    bmr = calculate_bmr(weight_kg, height_cm, age, gender)
    if bmr is not None and activity_level is not None:
        tdee = bmr * ACTIVITY_MULTIPLIERS.get(activity_level, 1.55)
        tdee *= GOAL_MODIFIERS.get(goal, 1.0) if goal else 1.0

    return bmi, tdee


def macro_targets(calories: int, weight_kg: Optional[float], goal: Optional[str]) -> tuple[int, int, int]:
    """Protein by bodyweight when known (capped at 35% of calories), fat 27%, carbs the rest."""
    if weight_kg:
        per_kg = {"lose": 2.0, "gain": 1.8}.get(goal or "", 1.6)
        protein = min(weight_kg * per_kg, calories * 0.35 / 4)
    else:
        protein = calories * 0.30 / 4
    fat = calories * 0.27 / 9
    carbs = max(0.0, (calories - protein * 4 - fat * 9) / 4)
    return round(protein), round(carbs), round(fat)


def fiber_target(calories: int) -> int:
    """14 g of fiber per 1,000 kcal (Dietary Guidelines for Americans), never below 20 g."""
    return max(20, round(calories * 14 / 1000))


MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 1

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = """You are a nutritional analysis assistant. You will receive an image of a food item or meal, and optionally a text description from the user.

Your job is to:
1. Identify every distinct food item visible in the image. Use the user's description to correct what you see (dish names, portion sizes, cooking oil, hidden ingredients).
2. For each item, estimate: calories (kcal), protein (g), carbs (g), fat (g), dietary fiber (g), and approximate weight (g).
3. Give the whole meal a short, natural name (2-6 words), e.g. "Chicken biryani with raita".
4. Give one short, practical suggestion (max 2 sentences) that helps the user stay within their calorie budget, e.g. "If you skip X, you'd have room for Y later." Use the remaining budget if provided.

You MUST respond with ONLY valid JSON in this exact schema — no markdown, no explanation, no code fences:
{
  "meal_name": "Short meal name",
  "items": [
    {
      "name": "Item Name",
      "calories": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0,
      "fiber": 0,
      "weight_g": 0
    }
  ],
  "total": {
    "calories": 0,
    "protein": 0,
    "carbs": 0,
    "fat": 0,
    "fiber": 0
  },
  "suggestions": "A short, helpful suggestion."
}

Be realistic with estimates. If unsure, give a reasonable mid-range estimate. If the image contains no food, return an empty items list and explain in suggestions. Always respond with valid JSON only."""


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    async with async_session() as session:
        await load_jwt_secret(session)
    yield


app = FastAPI(title="Calorie Vision", version="0.3.0", lifespan=lifespan)

static_dir = Path(__file__).parent / "static"
static_dir.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

CSP = "; ".join([
    "default-src 'self'",
    # wasm-unsafe-eval: the ZXing barcode decoder is WebAssembly
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://images.openfoodfacts.org https://static.openfoodfacts.org",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("Content-Security-Policy", CSP)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


def asset_version() -> str:
    """Cache-busting version derived from the static assets, so it never needs a manual bump."""
    h = hashlib.sha1()
    for name in ("app.js", "style.css", "scanner.js"):
        f = static_dir / name
        if f.exists():
            st = f.stat()
            h.update(f"{name}:{st.st_mtime_ns}:{st.st_size}".encode())
    return h.hexdigest()[:10]


@app.get("/", response_class=HTMLResponse)
async def serve_index():
    html = (static_dir / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html.replace("__V__", asset_version()), headers={"Cache-Control": "no-cache"})


def client_key(request: Request, username: str) -> str:
    ip = request.client.host if request.client else "?"
    return f"{ip}:{username.strip().lower()}"


# ══════════════════════════════════════════════
# AUTH ENDPOINTS
# ══════════════════════════════════════════════

@app.post("/api/auth/register", response_model=AuthResponse)
async def register(req: RegisterRequest, db: AsyncSession = DB):
    username = req.username.strip()
    existing = await db.execute(select(User).where(User.username == username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="That username is taken. Pick another or sign in.")

    user = User(
        username=username,
        password_hash=hash_password(req.password),
        must_change_password=False,
    )
    db.add(user)
    await db.flush()

    db.add(Budget(user_id=user.id, daily_calories=DEFAULT_BUDGET))
    await db.flush()

    token = create_token(user.id, user.username)
    return AuthResponse(token=token, username=user.username, must_change_password=False)


@app.post("/api/auth/login", response_model=AuthResponse)
async def login(req: LoginRequest, request: Request, db: AsyncSession = DB):
    key = client_key(request, req.username)
    login_limiter.check(key)
    result = await db.execute(select(User).where(User.username == req.username.strip()))
    user = result.scalar_one_or_none()

    if not user or not verify_password(req.password, user.password_hash):
        login_limiter.hit(key)
        raise HTTPException(status_code=401, detail="Wrong username or password")

    login_limiter.reset(key)
    token = create_token(user.id, user.username)
    return AuthResponse(
        token=token,
        username=user.username,
        must_change_password=user.must_change_password,
    )


@app.get("/api/auth/me")
async def me(current_user: User = Depends(get_current_user)):
    return {"username": current_user.username, "must_change_password": current_user.must_change_password}


@app.put("/api/auth/change-password")
async def change_password(
    req: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    if not verify_password(req.old_password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    current_user.password_hash = hash_password(req.new_password)
    current_user.must_change_password = False
    await db.flush()
    return {"message": "Password changed successfully"}


@app.post("/api/auth/forgot-password")
async def forgot_password(
    req: ForgotPasswordRequest,
    request: Request,
    db: AsyncSession = DB,
):
    """Create a reset code. There's no email, so the code goes to the server log
    for the app owner to hand over; it's never returned to the caller."""
    key = client_key(request, req.username)
    reset_limiter.check(key)
    reset_limiter.hit(key)
    result = await db.execute(select(User).where(User.username == req.username.strip()))
    user = result.scalar_one_or_none()

    message = "If that account exists, a reset code was created. Ask the app owner for it."
    if not user:
        return {"message": message}

    user.reset_token = generate_reset_token()
    user.reset_expiry = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)
    await db.flush()
    logger.warning("Password reset code for user %r (valid 1 hour): %s", user.username, user.reset_token)
    return {"message": message}


@app.post("/api/auth/reset-password")
async def reset_password(
    req: ResetPasswordRequest,
    request: Request,
    db: AsyncSession = DB,
):
    """Reset password using a valid reset token."""
    key = client_key(request, req.username) + ":reset"
    reset_limiter.check(key)
    result = await db.execute(select(User).where(User.username == req.username.strip()))
    user = result.scalar_one_or_none()

    if not user or not verify_reset_token(req.reset_token) or user.reset_token is None \
            or not hmac.compare_digest(user.reset_token, req.reset_token):
        reset_limiter.hit(key)
        raise HTTPException(status_code=400, detail="Invalid reset token")

    now = datetime.datetime.now(datetime.timezone.utc)
    expiry = user.reset_expiry
    if expiry is not None and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=datetime.timezone.utc)  # SQLite returns naive datetimes
    if expiry is None or expiry < now:
        raise HTTPException(status_code=400, detail="Reset token has expired")

    user.password_hash = hash_password(req.new_password)
    user.must_change_password = False
    user.reset_token = None
    user.reset_expiry = None
    await db.flush()
    reset_limiter.reset(key)
    return {"message": "Password reset successfully"}


# ══════════════════════════════════════════════
# MEAL HELPERS
# ══════════════════════════════════════════════

def meal_breakdown_item(meal: Meal) -> dict:
    """Serialize a persisted meal as a grouped-meal nutrition breakdown item."""
    return {
        "id": meal.id,
        "name": meal.name,
        "calories": meal.calories,
        "protein": meal.protein,
        "carbs": meal.carbs,
        "fat": meal.fat,
        "fiber": meal.fiber or 0,
        "weight_g": meal.weight_g,
    }


def single_meal_response(m: Meal) -> MealResponse:
    return MealResponse(
        id=m.id, meal_date=m.meal_date, name=m.name,
        calories=m.calories, protein=m.protein, carbs=m.carbs, fat=m.fat, fiber=m.fiber or 0,
        weight_g=m.weight_g, group_token=m.group_token, is_group=False, items=None,
        meal_type=m.meal_type, source=m.source, barcode=m.barcode,
        nutri_grade=m.nutri_grade, created_at=m.created_at,
    )


def group_title(group: list[Meal]) -> str:
    named = next((m.group_name for m in group if m.group_name), None)
    if named:
        return named
    names = [m.name for m in group]
    if len(names) <= 2:
        return " & ".join(names)
    return f"{names[0]}, {names[1]} +{len(names) - 2} more"


def build_meal_list(meals: list[Meal]) -> tuple[list[MealResponse], dict]:
    """Collapse rows sharing a group_token into one grouped entry, in logging order."""
    groups: dict[str, list[Meal]] = {}
    for m in meals:
        if m.group_token:
            groups.setdefault(m.group_token, []).append(m)

    out: list[MealResponse] = []
    seen: set[str] = set()
    for m in meals:
        if not m.group_token:
            out.append(single_meal_response(m))
            continue
        if m.group_token in seen:
            continue
        seen.add(m.group_token)
        g = groups[m.group_token]
        out.append(MealResponse(
            id=g[0].id,
            meal_date=g[0].meal_date,
            name=group_title(g),
            calories=sum(x.calories for x in g),
            protein=sum(x.protein for x in g),
            carbs=sum(x.carbs for x in g),
            fat=sum(x.fat for x in g),
            fiber=sum(x.fiber or 0 for x in g),
            weight_g=sum(x.weight_g for x in g),
            group_token=m.group_token,
            is_group=True,
            items=[meal_breakdown_item(x) for x in g],
            meal_type=g[0].meal_type,
            source=g[0].source,
            created_at=g[0].created_at,
        ))

    totals = {
        "total_calories": sum(m.calories for m in meals),
        "total_protein": sum(m.protein for m in meals),
        "total_carbs": sum(m.carbs for m in meals),
        "total_fat": sum(m.fat for m in meals),
        "total_fiber": sum(m.fiber or 0 for m in meals),
    }
    return out, totals


def parse_date(value: Optional[str]) -> datetime.date:
    if not value:
        return datetime.date.today()
    try:
        return datetime.date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")


async def get_owned_meal(db: AsyncSession, meal_id: int, user: User) -> Meal:
    result = await db.execute(select(Meal).where(Meal.id == meal_id, Meal.user_id == user.id))
    meal = result.scalar_one_or_none()
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")
    return meal


def new_meal(user: User, meal: MealCreate, **overrides) -> Meal:
    data = meal.model_dump()
    data.update(overrides)
    return Meal(user_id=user.id, **data)


# ══════════════════════════════════════════════
# MEAL ENDPOINTS
# ══════════════════════════════════════════════

@app.get("/api/meals", response_model=MealListResponse)
async def get_meals(
    date: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    meal_date = parse_date(date)
    result = await db.execute(
        select(Meal).where(
            Meal.user_id == current_user.id,
            Meal.meal_date == meal_date,
        ).order_by(Meal.created_at, Meal.id)
    )
    meals, totals = build_meal_list(list(result.scalars().all()))
    return MealListResponse(meals=meals, **totals)


@app.get("/api/meals/recent", response_model=list[RecentFood])
async def recent_foods(
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    """Distinct recently-logged foods (by name), most recent first, for one-tap re-logging."""
    limit = max(1, min(limit, 50))
    result = await db.execute(
        select(Meal).where(Meal.user_id == current_user.id)
        .order_by(Meal.created_at.desc(), Meal.id.desc()).limit(400)
    )
    seen: dict[str, RecentFood] = {}
    for m in result.scalars().all():
        key = m.name.strip().lower()
        if key in seen:
            seen[key].times_logged += 1
            continue
        if len(seen) >= limit:
            continue
        seen[key] = RecentFood(
            name=m.name, calories=m.calories, protein=m.protein, carbs=m.carbs,
            fat=m.fat, fiber=m.fiber or 0, weight_g=m.weight_g, barcode=m.barcode,
            nutri_grade=m.nutri_grade, times_logged=1,
        )
    return list(seen.values())


@app.post("/api/meals", response_model=MealResponse, status_code=201)
async def add_meal(
    meal: MealCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    record = new_meal(current_user, meal)
    db.add(record)
    await db.flush()
    await db.refresh(record)
    return single_meal_response(record)


@app.post("/api/meals/batch", response_model=list[MealResponse], status_code=201)
async def add_meals_batch(
    data: MealBatchCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    """Add multiple meals (e.g., from AI scan) with a shared group_token."""
    if not data.meals:
        return []

    group_token = uuid.uuid4().hex[:16] if len(data.meals) > 1 else None
    records = []
    for meal in data.meals:
        overrides = {"group_token": group_token, "group_name": data.group_name if group_token else None}
        if data.meal_type:
            overrides["meal_type"] = data.meal_type
        record = new_meal(current_user, meal, **overrides)
        db.add(record)
        records.append(record)

    await db.flush()
    for r in records:
        await db.refresh(r)
    return [
        single_meal_response(r).model_copy(update={"is_group": r.group_token is not None})
        for r in records
    ]


@app.patch("/api/meals/{meal_id}", response_model=MealResponse)
async def update_meal(
    meal_id: int,
    data: MealUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    """Edit one meal row. For grouped meals this edits a single item of the group."""
    meal = await get_owned_meal(db, meal_id, current_user)
    for field, value in data.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(meal, field, value)
    await db.flush()
    await db.refresh(meal)
    return single_meal_response(meal)


@app.patch("/api/meals/groups/{group_token}")
async def update_meal_group(
    group_token: str,
    data: MealGroupUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    result = await db.execute(
        select(Meal).where(Meal.group_token == group_token, Meal.user_id == current_user.id)
    )
    meals = result.scalars().all()
    if not meals:
        raise HTTPException(status_code=404, detail="Meal not found")
    updates = data.model_dump(exclude_unset=True)
    for m in meals:
        if "group_name" in updates:
            m.group_name = (updates["group_name"] or "").strip() or None
        if updates.get("meal_type"):
            m.meal_type = updates["meal_type"]
    await db.flush()
    return {"message": "Meal updated"}


@app.delete("/api/meals/{meal_id}")
async def delete_meal(
    meal_id: int,
    scope: Literal["group", "item"] = "group",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    """Delete a meal. For grouped meals the whole group goes unless scope=item."""
    meal = await get_owned_meal(db, meal_id, current_user)
    if meal.group_token and scope == "group":
        await db.execute(
            delete(Meal).where(
                Meal.group_token == meal.group_token,
                Meal.user_id == current_user.id,
            )
        )
    else:
        await db.delete(meal)
    return {"message": "Meal deleted"}


# ══════════════════════════════════════════════
# PRESET ENDPOINTS
# ══════════════════════════════════════════════

@app.get("/api/presets", response_model=list[PresetResponse])
async def get_presets(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    result = await db.execute(
        select(Preset).where(Preset.user_id == current_user.id).order_by(Preset.name)
    )
    return [PresetResponse.model_validate(p) for p in result.scalars().all()]


@app.post("/api/presets", response_model=PresetResponse, status_code=201)
async def create_preset(
    preset: PresetCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    record = Preset(user_id=current_user.id, **preset.model_dump())
    db.add(record)
    await db.flush()
    await db.refresh(record)
    return PresetResponse.model_validate(record)


@app.delete("/api/presets/{preset_id}")
async def delete_preset(
    preset_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    result = await db.execute(
        select(Preset).where(Preset.id == preset_id, Preset.user_id == current_user.id)
    )
    preset = result.scalar_one_or_none()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    await db.delete(preset)
    return {"message": "Preset deleted"}


# ══════════════════════════════════════════════
# BUDGET ENDPOINTS
# ══════════════════════════════════════════════

async def get_or_create_budget(db: AsyncSession, user: User) -> Budget:
    result = await db.execute(select(Budget).where(Budget.user_id == user.id))
    budget = result.scalar_one_or_none()
    if not budget:
        budget = Budget(user_id=user.id, daily_calories=DEFAULT_BUDGET)
        db.add(budget)
        await db.flush()
    return budget


@app.get("/api/budget", response_model=BudgetResponse)
async def get_budget(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    budget = await get_or_create_budget(db, current_user)
    return BudgetResponse(daily_calories=budget.daily_calories)


@app.put("/api/budget", response_model=BudgetResponse)
async def update_budget(
    data: BudgetUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    budget = await get_or_create_budget(db, current_user)
    budget.daily_calories = data.daily_calories
    await db.flush()
    return BudgetResponse(daily_calories=budget.daily_calories)


# ══════════════════════════════════════════════
# PROFILE ENDPOINTS
# ══════════════════════════════════════════════

async def get_profile_row(db: AsyncSession, user: User) -> Optional[UserProfile]:
    result = await db.execute(select(UserProfile).where(UserProfile.user_id == user.id))
    return result.scalar_one_or_none()


@app.get("/api/profile", response_model=ProfileResponse)
async def get_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    profile = await get_profile_row(db, current_user)
    if not profile:
        return ProfileResponse()
    return ProfileResponse.model_validate(profile)


@app.put("/api/profile", response_model=ProfileResponse)
async def update_profile(
    data: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    profile = await get_profile_row(db, current_user)
    if not profile:
        profile = UserProfile(user_id=current_user.id)
        db.add(profile)

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(profile, field, value)

    profile.bmi, profile.tdee = calculate_bmi_tdee(
        height_cm=profile.height_cm,
        weight_kg=profile.weight_kg,
        age=profile.age,
        gender=profile.gender,
        activity_level=profile.activity_level,
        goal=profile.goal,
    )

    await db.flush()
    await db.refresh(profile)
    return ProfileResponse.model_validate(profile)


# ══════════════════════════════════════════════
# GOALS ENDPOINT
# ══════════════════════════════════════════════

@app.get("/api/goals", response_model=GoalSummary)
async def get_goals(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    """Daily targets. The budget is the single calorie target; the profile-based
    figure is returned separately as `recommended_calories`."""
    profile = await get_profile_row(db, current_user)
    budget = await get_or_create_budget(db, current_user)
    calories = budget.daily_calories

    bmr = 0.0
    tdee = float(calories)
    recommended = None
    weight = goal = None
    if profile:
        weight, goal = profile.weight_kg, profile.goal
        bmr = calculate_bmr(profile.weight_kg, profile.height_cm, profile.age, profile.gender) or 0.0
        if bmr and profile.activity_level:
            tdee = bmr * ACTIVITY_MULTIPLIERS.get(profile.activity_level, 1.55)
        if profile.tdee is not None:
            recommended = round(profile.tdee)

    protein, carbs, fat = macro_targets(calories, weight, goal)
    water_ml = round(weight * 35) if weight else 2500

    return GoalSummary(
        calories=calories,
        protein=protein,
        carbs=carbs,
        fat=fat,
        fiber=fiber_target(calories),
        water_ml=water_ml,
        bmr=bmr,
        tdee=tdee,
        bmi=profile.bmi if profile else None,
        recommended_calories=recommended,
    )


# ══════════════════════════════════════════════
# WATER ENDPOINTS
# ══════════════════════════════════════════════

async def water_goal(db: AsyncSession, user: User) -> int:
    profile = await get_profile_row(db, user)
    return round(profile.weight_kg * 35) if profile and profile.weight_kg else 2500


@app.get("/api/water", response_model=WaterResponse)
async def get_water(
    date: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    log_date = parse_date(date)
    result = await db.execute(
        select(WaterLog).where(WaterLog.user_id == current_user.id, WaterLog.log_date == log_date)
    )
    row = result.scalar_one_or_none()
    return WaterResponse(log_date=log_date, amount_ml=row.amount_ml if row else 0,
                         goal_ml=await water_goal(db, current_user))


@app.post("/api/water", response_model=WaterResponse)
async def add_water(
    data: WaterUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    result = await db.execute(
        select(WaterLog).where(WaterLog.user_id == current_user.id, WaterLog.log_date == data.log_date)
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = WaterLog(user_id=current_user.id, log_date=data.log_date, amount_ml=0)
        db.add(row)
    row.amount_ml = max(0, min(20000, (row.amount_ml or 0) + data.delta_ml))
    await db.flush()
    return WaterResponse(log_date=row.log_date, amount_ml=row.amount_ml,
                         goal_ml=await water_goal(db, current_user))


# ══════════════════════════════════════════════
# HISTORY ENDPOINT
# ══════════════════════════════════════════════

@app.get("/api/history", response_model=HistoryResponse)
async def get_history(
    days: int = 7,
    end: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    """Days with meals in the `days`-long window ending at `end` (the client's today)."""
    days = max(1, min(days, 120))
    end_date = parse_date(end)
    cutoff = end_date - datetime.timedelta(days=days)
    result = await db.execute(
        select(Meal)
        .where(Meal.user_id == current_user.id, Meal.meal_date >= cutoff, Meal.meal_date <= end_date)
        .order_by(Meal.meal_date.desc(), Meal.created_at, Meal.id)
    )

    by_day: dict[datetime.date, list[Meal]] = {}
    for m in result.scalars().all():
        by_day.setdefault(m.meal_date, []).append(m)

    history_days = []
    for d in sorted(by_day, reverse=True):
        meals, totals = build_meal_list(by_day[d])
        history_days.append(HistoryDay(date=d, meals=meals, **totals))
    return HistoryResponse(days=history_days)


# ══════════════════════════════════════════════
# EXPORT/IMPORT ENDPOINTS
# ══════════════════════════════════════════════


class ImportData(BaseModel):
    meals: Optional[list[dict]] = Field(None, max_length=50000)
    presets: Optional[list[dict]] = Field(None, max_length=5000)
    budget: Optional[dict] = None
    profile: Optional[dict] = None


@app.get("/api/export")
async def export_data(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    """Export all user data including meals, presets, budget, and profile."""
    meals_result = await db.execute(
        select(Meal).where(Meal.user_id == current_user.id).order_by(Meal.meal_date.desc(), Meal.created_at)
    )
    meals_data = [
        {
            "name": m.name,
            "calories": m.calories,
            "protein": m.protein,
            "carbs": m.carbs,
            "fat": m.fat,
            "fiber": m.fiber,
            "weight_g": m.weight_g,
            "meal_date": m.meal_date.isoformat(),
            "meal_type": m.meal_type,
            "group_token": m.group_token,
            "group_name": m.group_name,
            "source": m.source,
            "barcode": m.barcode,
            "nutri_grade": m.nutri_grade,
        }
        for m in meals_result.scalars().all()
    ]

    presets_result = await db.execute(
        select(Preset).where(Preset.user_id == current_user.id).order_by(Preset.name)
    )
    presets_data = [
        {
            "name": p.name,
            "calories": p.calories,
            "protein": p.protein,
            "carbs": p.carbs,
            "fat": p.fat,
            "fiber": p.fiber,
            "description": p.description,
        }
        for p in presets_result.scalars().all()
    ]

    budget = await get_or_create_budget(db, current_user)
    profile = await get_profile_row(db, current_user)
    profile_data = {}
    if profile:
        profile_data = {
            "height_cm": profile.height_cm,
            "weight_kg": profile.weight_kg,
            "age": profile.age,
            "gender": profile.gender,
            "activity_level": profile.activity_level,
            "goal": profile.goal,
            "tdee": profile.tdee,
            "bmi": profile.bmi,
        }

    return {
        "meals": meals_data,
        "presets": presets_data,
        "budget": {"daily_calories": budget.daily_calories},
        "profile": profile_data,
    }


def validate_numeric(value, field_name, maximum=20000):
    if value is None:
        return 0
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise HTTPException(status_code=400, detail=f"{field_name} must be a valid number")
    if value != value:  # NaN check
        raise HTTPException(status_code=400, detail=f"{field_name} cannot be NaN")
    if value < 0:
        raise HTTPException(status_code=400, detail=f"{field_name} cannot be negative")
    if value > maximum:
        raise HTTPException(status_code=400, detail=f"{field_name} is unrealistically large")
    return float(value)


def import_text(value, default: str, max_len: int) -> str:
    text = str(value).strip() if value is not None else ""
    return (text or default)[:max_len]


@app.put("/api/import")
async def import_data(
    data: ImportData,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    """Import user data including meals, presets, budget, and profile."""
    if data.budget and "daily_calories" in data.budget:
        try:
            daily = BudgetUpdate(daily_calories=data.budget["daily_calories"]).daily_calories
        except Exception:
            raise HTTPException(status_code=400, detail="daily_calories must be between 500 and 10000")
        budget = await get_or_create_budget(db, current_user)
        budget.daily_calories = daily
        await db.flush()

    if data.profile:
        profile = await get_profile_row(db, current_user)
        if not profile:
            profile = UserProfile(user_id=current_user.id)
            db.add(profile)

        if data.profile.get("height_cm") is not None:
            height_val = data.profile["height_cm"]
            if not isinstance(height_val, (int, float)) or height_val < 50 or height_val > 300:
                raise HTTPException(status_code=400, detail="height_cm must be between 50 and 300")
            profile.height_cm = height_val
        if data.profile.get("weight_kg") is not None:
            weight_val = data.profile["weight_kg"]
            if not isinstance(weight_val, (int, float)) or weight_val < 10 or weight_val > 500:
                raise HTTPException(status_code=400, detail="weight_kg must be between 10 and 500")
            profile.weight_kg = weight_val
        if data.profile.get("age") is not None:
            age_val = data.profile["age"]
            if not isinstance(age_val, int) or age_val < 1 or age_val > 150:
                raise HTTPException(status_code=400, detail="age must be between 1 and 150")
            profile.age = age_val
        if data.profile.get("gender") in ("male", "female"):
            profile.gender = data.profile["gender"]
        if data.profile.get("activity_level") in ACTIVITY_MULTIPLIERS:
            profile.activity_level = data.profile["activity_level"]
        if data.profile.get("goal") in GOAL_MODIFIERS:
            profile.goal = data.profile["goal"]

        profile.bmi, profile.tdee = calculate_bmi_tdee(
            height_cm=profile.height_cm,
            weight_kg=profile.weight_kg,
            age=profile.age,
            gender=profile.gender,
            activity_level=profile.activity_level,
            goal=profile.goal,
        )
        await db.flush()

    if data.meals:
        # Re-key groups so imported meals never merge into existing ones.
        token_map: dict[str, str] = {}
        for meal_data in data.meals:
            if not isinstance(meal_data, dict):
                raise HTTPException(status_code=400, detail="Each meal must be an object")
            date_str = meal_data.get("meal_date", datetime.date.today().isoformat())
            try:
                meal_date = datetime.date.fromisoformat(date_str)
            except (ValueError, TypeError):
                raise HTTPException(status_code=400, detail=f"Invalid date format: {date_str}. Use YYYY-MM-DD.")

            old_token = meal_data.get("group_token")
            group_token = None
            if old_token:
                group_token = token_map.setdefault(str(old_token), uuid.uuid4().hex[:16])
            meal_type = meal_data.get("meal_type")
            grade = meal_data.get("nutri_grade")
            barcode = meal_data.get("barcode")

            db.add(Meal(
                user_id=current_user.id,
                meal_date=meal_date,
                name=import_text(meal_data.get("name"), "Imported Meal", 200),
                calories=validate_numeric(meal_data.get("calories"), "calories"),
                protein=validate_numeric(meal_data.get("protein"), "protein", 5000),
                carbs=validate_numeric(meal_data.get("carbs"), "carbs", 5000),
                fat=validate_numeric(meal_data.get("fat"), "fat", 5000),
                fiber=validate_numeric(meal_data.get("fiber"), "fiber", 500),
                weight_g=validate_numeric(meal_data.get("weight_g"), "weight_g"),
                group_token=group_token,
                group_name=import_text(meal_data.get("group_name"), "", 200) or None,
                meal_type=meal_type if meal_type in MEAL_TYPES else None,
                source=import_text(meal_data.get("source"), "", 20) or None,
                barcode=barcode if isinstance(barcode, str) and re.fullmatch(r"\d{8,14}", barcode) else None,
                nutri_grade=grade if grade in ("a", "b", "c", "d", "e") else None,
            ))
        await db.flush()

    if data.presets:
        for preset_data in data.presets:
            if not isinstance(preset_data, dict):
                raise HTTPException(status_code=400, detail="Each preset must be an object")
            db.add(Preset(
                user_id=current_user.id,
                name=import_text(preset_data.get("name"), "Imported Preset", 200),
                calories=validate_numeric(preset_data.get("calories"), "calories"),
                protein=validate_numeric(preset_data.get("protein"), "protein", 5000),
                carbs=validate_numeric(preset_data.get("carbs"), "carbs", 5000),
                fat=validate_numeric(preset_data.get("fat"), "fat", 5000),
                fiber=validate_numeric(preset_data.get("fiber"), "fiber", 500),
                description=import_text(preset_data.get("description"), "", 500),
            ))
        await db.flush()

    return {"message": "Data imported successfully"}


# ══════════════════════════════════════════════
# BARCODE / PRODUCT ENDPOINT
# ══════════════════════════════════════════════

@app.get("/api/products/{barcode}")
async def get_product(
    barcode: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    """Packaged food by barcode, with nutrition per 100 g and an explained Nutri-Score (A–E)."""
    return await food_facts.lookup(db, barcode)


PRODUCT_RATING_PROMPT = """You rate packaged foods and drinks on the European Nutri-Score scale: A (healthiest), B, C, D, E (least healthy).

Follow the official Nutri-Score (2023) logic as closely as you can:
- Penalise energy, sugars, saturated fat and salt (and non-sugar sweeteners in drinks).
- Credit protein, fibre, and fruit/vegetables/legumes/nuts/olive or rapeseed oil.
- Drinks are judged more strictly than foods; only plain water gets A.
When nutrition facts per 100 g are missing or incomplete, estimate typical values for this exact kind of product from its name, category, ingredients and package photo, and rate from those.

Respond with ONLY valid JSON in this exact schema, no markdown or code fences:
{
  "grade": "c",
  "summary": "One or two short, plain sentences on why it gets this grade.",
  "negatives": [{"label": "High in sugar", "detail": "Short specific reason", "level": "high"}],
  "positives": [{"label": "Good source of fibre", "detail": "Short specific reason", "level": "moderate"}],
  "estimated_per_100g": {"calories": 0, "protein": 0, "carbs": 0, "sugars": 0, "fat": 0, "saturated_fat": 0, "fiber": 0, "salt": 0},
  "confidence": "medium"
}
"grade" is one lowercase letter a-e. "level" is "high" or "moderate". Give at most 4 negatives and 4 positives (either list may be empty). "confidence" is "low", "medium" or "high". Always fill estimated_per_100g (per 100 ml for drinks)."""


def normalize_product_rating(raw: dict) -> dict:
    """Validate the model's product rating; raises ValueError if unusable."""
    if not isinstance(raw, dict):
        raise ValueError("Top-level JSON is not an object")
    grade = str(raw.get("grade") or "").strip().lower()[:1]
    if grade not in ("a", "b", "c", "d", "e"):
        raise ValueError(f"Invalid grade {raw.get('grade')!r}")

    def entries(key):
        out = []
        for e in (raw.get(key) or [])[:4]:
            if not isinstance(e, dict) or not str(e.get("label") or "").strip():
                continue
            level = str(e.get("level") or "").lower()
            out.append({
                "label": str(e["label"]).strip()[:80],
                "detail": (str(e.get("detail") or "").strip()[:160] or None),
                "level": level if level in ("high", "moderate") else "moderate",
            })
        return out

    est_raw = raw.get("estimated_per_100g") or {}
    est = {}
    if isinstance(est_raw, dict):
        for k in food_facts.AI_NUTRIENTS:
            if est_raw.get(k) is not None:
                cap = 900 if k == "calories" else 100
                est[k] = round(min(_to_float(est_raw.get(k)), cap), 2)
    confidence = str(raw.get("confidence") or "").lower()
    return {
        "grade": grade,
        "summary": str(raw.get("summary") or "").strip()[:400] or "Rated by AI from the product details.",
        "negatives": entries("negatives"),
        "positives": entries("positives"),
        "estimated_per_100g": est,
        "confidence": confidence if confidence in ("low", "medium", "high") else None,
    }


async def fetch_image_b64(url: str | None) -> str | None:
    """Product photo as a data URL, so the model doesn't depend on fetching URLs itself."""
    if not url or not url.startswith("https://images.openfoodfacts.org/"):
        return None
    try:
        async with httpx.AsyncClient(timeout=6.0, headers=food_facts.OFF_HEADERS) as client:
            res = await client.get(url)
        if res.status_code != 200 or len(res.content) > 2_000_000:
            return None
        mime = res.headers.get("content-type", "image/jpeg").split(";")[0]
        return f"data:{mime};base64,{base64.b64encode(res.content).decode()}"
    except httpx.HTTPError:
        return None


@app.post("/api/products/{barcode}/assess")
async def assess_product(
    barcode: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = DB,
):
    """AI Nutri-Score for products Open Food Facts can't grade. The result is cached
    with the product, so each product is rated once."""
    product = await food_facts.lookup(db, barcode)
    if product["nutriscore"]["grade"]:
        return product

    facts = {k: v for k, v in (product.get("per_100g") or {}).items() if v is not None}
    lines = [
        f"Product: {product['name']}",
        f"Brand: {product.get('brand') or 'unknown'}",
        f"Type: {'drink' if product.get('is_beverage') else 'food'}",
        f"Quantity: {product.get('quantity') or 'unknown'}",
        f"Categories: {product.get('categories') or 'unknown'}",
        f"Labels: {product.get('labels') or 'none'}",
        f"Ingredients: {product.get('ingredients') or 'not listed'}",
        f"Additives: {', '.join(product.get('additives') or []) or 'none listed'}",
        f"NOVA processing group: {(product.get('nova') or {}).get('group') or 'unknown'}",
        "Nutrition per 100 g/ml from the label: "
        + (json.dumps(facts) if facts else "not available - estimate it"),
    ]
    user_content: list = [{"type": "text", "text": "\n".join(lines)}]
    image = await fetch_image_b64(product.get("image_url"))
    if image:
        user_content.append({"type": "image_url", "image_url": {"url": image}})

    try:
        content = await call_llm(PRODUCT_RATING_PROMPT, user_content, max_tokens=900, temperature=0.2)
        rating = normalize_product_rating(extract_json(content))
    except (TypeError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"The AI couldn't rate this product ({type(e).__name__}). Try again.")

    product = food_facts.apply_ai_rating(product, rating)
    await food_facts.save_product(db, product)
    return product


# ══════════════════════════════════════════════
# AI ANALYSIS ENDPOINT
# ══════════════════════════════════════════════

# ~6 MB of JPEG once base64-decoded; the client downsizes to ~1.5 MP anyway.
MAX_IMAGE_B64 = 8_000_000


class AnalyzeRequest(BaseModel):
    image: str = Field(..., min_length=4, max_length=MAX_IMAGE_B64)
    description: Optional[str] = Field(None, max_length=500)
    remaining_calories: Optional[float] = Field(None, ge=-20000, le=20000)


class FoodItem(BaseModel):
    name: str
    calories: float
    protein: float
    carbs: float
    fat: float
    fiber: float = 0
    weight_g: float


class AnalyzeResponse(BaseModel):
    meal_name: str = ""
    items: list[FoodItem]
    total: dict
    suggestions: str


def _to_float(v) -> float:
    if isinstance(v, str):
        m = re.search(r"-?\d+(\.\d+)?", v)
        v = m.group(0) if m else 0
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(f, 20000.0)) if f == f else 0.0


def normalize_analysis(raw: dict) -> dict:
    """Coerce model output into the response schema; totals are recomputed from items."""
    if not isinstance(raw, dict):
        raise ValueError("Top-level JSON is not an object")
    items = []
    for it in raw.get("items") or []:
        if not isinstance(it, dict):
            continue
        name = str(it.get("name") or "").strip()[:200] or "Food item"
        items.append({
            "name": name,
            "calories": round(_to_float(it.get("calories")), 1),
            "protein": round(_to_float(it.get("protein")), 1),
            "carbs": round(_to_float(it.get("carbs")), 1),
            "fat": round(_to_float(it.get("fat")), 1),
            "fiber": round(min(_to_float(it.get("fiber") or it.get("fibre")), 500), 1),
            "weight_g": round(_to_float(it.get("weight_g") or it.get("weight"))),
        })
    total = {k: round(sum(i[k] for i in items), 1) for k in ("calories", "protein", "carbs", "fat", "fiber")}
    suggestion = raw.get("suggestions") or raw.get("suggestion") or ""
    if isinstance(suggestion, list):
        suggestion = " ".join(str(s) for s in suggestion)
    return {
        "meal_name": str(raw.get("meal_name") or "").strip()[:200],
        "items": items,
        "total": total,
        "suggestions": str(suggestion).strip()[:600],
    }


def extract_json(content: str) -> dict:
    content = content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[1] if "\n" in content else ""
        content = content.rsplit("```", 1)[0].strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        start, end = content.find("{"), content.rfind("}")
        if start == -1 or end <= start:
            raise
        return json.loads(content[start:end + 1])


async def call_llm(system_prompt: str, user_content: list, max_tokens: int = 1500,
                   temperature: float = 0.3) -> str:
    """One OpenRouter chat completion with retries; returns the text content."""
    if not OPENROUTER_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="OPENROUTER_API_KEY is not set. Add it to the .env file.",
        )
    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:8000",
        "X-Title": "Calorie Vision",
    }

    async with httpx.AsyncClient(timeout=90.0) as client:
        for attempt in range(MAX_RETRIES):
            try:
                response = await client.post(
                    OPENROUTER_URL, json=payload, headers=headers
                )
                response.raise_for_status()
                break
            except httpx.HTTPStatusError as e:
                code = e.response.status_code
                retryable = code >= 500 or code == 429
                if retryable and attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(RETRY_DELAY_SECONDS * (2 ** attempt))
                    continue
                detail = "The AI service is busy. Try again in a minute." if code == 429 \
                    else f"OpenRouter API error after {attempt + 1} attempt(s): {code}"
                raise HTTPException(status_code=502, detail=detail)
            except httpx.RequestError as e:
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(RETRY_DELAY_SECONDS * (2 ** attempt))
                    continue
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to reach OpenRouter after {attempt + 1} attempt(s): {type(e).__name__}",
                )

    data = response.json()
    try:
        content = data["choices"][0]["message"]["content"]
        if isinstance(content, list):  # some providers return content parts
            content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
        if not isinstance(content, str):
            raise TypeError("content is not text")
        return content
    except (KeyError, IndexError, TypeError) as e:
        logger.warning("Unexpected LLM response: %s", str(data)[:1000])
        raise HTTPException(status_code=502, detail=f"Failed to parse the AI response ({type(e).__name__}).")


@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze_food(
    request: AnalyzeRequest,
    current_user: User = Depends(get_current_user),
):
    image = request.image
    mime = "image/jpeg"
    if image.startswith("data:"):
        header, _, image = image.partition(",")
        mime = header[5:].split(";")[0] or mime

    hints = []
    if request.description and request.description.strip():
        hints.append(f"Description: {request.description.strip()}")
    if request.remaining_calories is not None:
        hints.append(f"Remaining calorie budget for today before this meal: {round(request.remaining_calories)} kcal")

    user_content = [{"type": "text", "text": h} for h in hints]
    user_content.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image}"}})

    try:
        content = await call_llm(SYSTEM_PROMPT, user_content, max_tokens=1500)
        result = normalize_analysis(extract_json(content))
    except (KeyError, IndexError, TypeError, ValueError) as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to parse the AI response ({type(e).__name__}). Try again or add a description.",
        )

    return result



TEXT_SYSTEM_PROMPT = """You are a nutritional analysis assistant. The user describes, in their own words, a meal they already ate (they didn't take a photo). It may be a comma- or line-separated list, with quantities in any form: grams, ml, cups, bowls, pieces, slices, "a plate", "half", "small/large", and dishes from any cuisine (Indian, Asian, Western, etc.).

Your job is to:
1. Split the description into distinct food or drink items, keeping the user's quantity for each.
2. For each item, estimate calories (kcal), protein (g), carbs (g), fat (g), dietary fiber (g) and weight (g, or ml for drinks) for the stated quantity. If no quantity is given, assume one typical single serving.
3. Name each item with its quantity so the user can check it, e.g. "Roti (2)", "Dal tadka (1 bowl, ~200 g)", "Paneer butter masala (100 g)".
4. Give the whole meal a short, natural name (2-6 words).
5. Give one short, practical suggestion (max 2 sentences) that helps the user stay within their calorie budget. Use the remaining budget if provided.

Use typical home-cooked or restaurant recipes as described (e.g. "restaurant", "homemade", "with ghee" change the estimate). Ignore anything that isn't food or drink.

You MUST respond with ONLY valid JSON in this exact schema — no markdown, no explanation, no code fences:
{
  "meal_name": "Short meal name",
  "items": [
    {"name": "Item (quantity)", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "fiber": 0, "weight_g": 0}
  ],
  "total": {"calories": 0, "protein": 0, "carbs": 0, "fat": 0, "fiber": 0},
  "suggestions": "A short, helpful suggestion."
}
If the text contains no food at all, return an empty items list and say so in suggestions."""


class AnalyzeTextRequest(BaseModel):
    text: str = Field(..., min_length=2, max_length=1000)
    remaining_calories: Optional[float] = Field(None, ge=-20000, le=20000)


@app.post("/api/analyze/text", response_model=AnalyzeResponse)
async def analyze_text(
    request: AnalyzeTextRequest,
    current_user: User = Depends(get_current_user),
):
    """Estimate a meal from a typed description (for meals that weren't photographed)."""
    text = request.text.strip()
    if len(text) < 2:
        raise HTTPException(status_code=422, detail="Describe what you ate, e.g. \"2 rotis, 1 bowl dal\".")
    parts = [f"What I ate: {text}"]
    if request.remaining_calories is not None:
        parts.append(f"Remaining calorie budget for the day before this meal: {round(request.remaining_calories)} kcal")
    try:
        content = await call_llm(TEXT_SYSTEM_PROMPT, [{"type": "text", "text": "\n".join(parts)}], max_tokens=1500)
        return normalize_analysis(extract_json(content))
    except (KeyError, IndexError, TypeError, ValueError) as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to parse the AI response ({type(e).__name__}). Try rephrasing the meal.",
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
