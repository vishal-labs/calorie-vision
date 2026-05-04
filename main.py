"""
Calorie Vision — FastAPI Backend
Analyzes food images via OpenRouter (Gemma-4), manages users, meals, presets, and budgets.
"""
import os
import json
import asyncio
import datetime
import httpx
from contextlib import asynccontextmanager
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete

from database import get_db, init_db, engine, Base
from models import User, Meal, Preset, Budget, UserProfile
from schemas import (
    RegisterRequest, LoginRequest, ChangePasswordRequest, AuthResponse,
    MealCreate, MealResponse, MealListResponse,
    PresetCreate, PresetResponse,
    BudgetResponse, BudgetUpdate, HistoryResponse, HistoryDay,
    ProfileUpdate, ProfileResponse, GoalSummary,
)
from auth import (
    hash_password, verify_password, create_token,
    get_current_user,
)

load_dotenv()

LLM_MODEL = "google/gemma-4-31b-it:free"
MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 1

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = """You are a nutritional analysis assistant. You will receive an image of a food item or meal, and optionally a text description from the user.

Your job is to:
1. Identify every distinct food item visible in the image.
2. For each item, estimate: calories (kcal), protein (g), carbs (g), fat (g), and approximate weight (g).
3. Provide a total summary across all items.
4. Give a short, practical suggestion to help the user stay within their calorie budget.

You MUST respond with ONLY valid JSON in this exact schema — no markdown, no explanation, no code fences:
{
  "items": [
    {
      "name": "Item Name",
      "calories": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0,
      "weight_g": 0
    }
  ],
  "total": {
    "calories": 0,
    "protein": 0,
    "carbs": 0,
    "fat": 0
  },
  "suggestions": "A short, helpful suggestion."
}

Be realistic with estimates. If unsure, give a reasonable mid-range estimate. Always respond with valid JSON only."""


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Calorie Vision", version="0.2.0", lifespan=lifespan)

static_dir = Path(__file__).parent / "static"
static_dir.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


class AnalyzeRequest(BaseModel):
    image: str
    description: Optional[str] = None


class FoodItem(BaseModel):
    name: str
    calories: float
    protein: float
    carbs: float
    fat: float
    weight_g: float


class AnalyzeResponse(BaseModel):
    items: list[FoodItem]
    total: dict
    suggestions: str


@app.get("/")
async def serve_index():
    return FileResponse(str(static_dir / "index.html"))


# ══════════════════════════════════════════════
# AUTH ENDPOINTS
# ══════════════════════════════════════════════

@app.post("/api/auth/register", response_model=AuthResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.username == req.username.strip()))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username already exists")

    user = User(
        username=req.username.strip(),
        password_hash=hash_password(req.password),
        must_change_password=False,
    )
    db.add(user)
    await db.flush()

    budget = Budget(user_id=user.id, daily_calories=2000)
    db.add(budget)
    await db.flush()

    token = create_token(user.id, user.username)
    return AuthResponse(token=token, username=user.username, must_change_password=False)


@app.post("/api/auth/login", response_model=AuthResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == req.username.strip()))
    user = result.scalar_one_or_none()

    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = create_token(user.id, user.username)
    return AuthResponse(
        token=token,
        username=user.username,
        must_change_password=user.must_change_password,
    )


@app.put("/api/auth/change-password")
async def change_password(
    req: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(req.old_password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    current_user.password_hash = hash_password(req.new_password)
    current_user.must_change_password = False
    await db.flush()
    return {"message": "Password changed successfully"}


# ══════════════════════════════════════════════
# MEAL ENDPOINTS
# ══════════════════════════════════════════════

@app.get("/api/meals", response_model=MealListResponse)
async def get_meals(
    date: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if date:
        try:
            meal_date = datetime.date.fromisoformat(date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    else:
        meal_date = datetime.date.today()

    result = await db.execute(
        select(Meal).where(
            Meal.user_id == current_user.id,
            Meal.meal_date == meal_date,
        ).order_by(Meal.created_at)
    )
    meals = result.scalars().all()

    total_cal = sum(m.calories for m in meals)
    total_protein = sum(m.protein for m in meals)
    total_carbs = sum(m.carbs for m in meals)
    total_fat = sum(m.fat for m in meals)

    return MealListResponse(
        meals=[MealResponse.model_validate(m) for m in meals],
        total_calories=total_cal,
        total_protein=total_protein,
        total_carbs=total_carbs,
        total_fat=total_fat,
    )


@app.post("/api/meals", response_model=MealResponse, status_code=201)
async def add_meal(
    meal: MealCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    record = Meal(
        user_id=current_user.id,
        meal_date=meal.meal_date,
        name=meal.name,
        calories=meal.calories,
        protein=meal.protein,
        carbs=meal.carbs,
        fat=meal.fat,
        weight_g=meal.weight_g,
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)
    return MealResponse.model_validate(record)


@app.delete("/api/meals/{meal_id}")
async def delete_meal(
    meal_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Meal).where(Meal.id == meal_id, Meal.user_id == current_user.id)
    )
    meal = result.scalar_one_or_none()
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")
    await db.delete(meal)
    return {"message": "Meal deleted"}


# ══════════════════════════════════════════════
# PRESET ENDPOINTS
# ══════════════════════════════════════════════

@app.get("/api/presets", response_model=list[PresetResponse])
async def get_presets(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Preset).where(Preset.user_id == current_user.id).order_by(Preset.name)
    )
    return [PresetResponse.model_validate(p) for p in result.scalars().all()]


@app.post("/api/presets", response_model=PresetResponse, status_code=201)
async def create_preset(
    preset: PresetCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    record = Preset(
        user_id=current_user.id,
        name=preset.name,
        calories=preset.calories,
        protein=preset.protein,
        carbs=preset.carbs,
        fat=preset.fat,
        description=preset.description,
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)
    return PresetResponse.model_validate(record)


@app.delete("/api/presets/{preset_id}")
async def delete_preset(
    preset_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
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

@app.get("/api/budget", response_model=BudgetResponse)
async def get_budget(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Budget).where(Budget.user_id == current_user.id)
    )
    budget = result.scalar_one_or_none()
    if not budget:
        budget = Budget(user_id=current_user.id, daily_calories=2000)
        db.add(budget)
        await db.flush()
    return BudgetResponse(daily_calories=budget.daily_calories)


@app.put("/api/budget", response_model=BudgetResponse)
async def update_budget(
    data: BudgetUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Budget).where(Budget.user_id == current_user.id)
    )
    budget = result.scalar_one_or_none()
    if not budget:
        budget = Budget(user_id=current_user.id)
        db.add(budget)
    budget.daily_calories = data.daily_calories
    await db.flush()
    return BudgetResponse(daily_calories=budget.daily_calories)


# ══════════════════════════════════════════════
# PROFILE ENDPOINTS
# ══════════════════════════════════════════════

@app.get("/api/profile", response_model=ProfileResponse)
async def get_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserProfile).where(UserProfile.user_id == current_user.id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        return ProfileResponse()
    return ProfileResponse.model_validate(profile)


@app.put("/api/profile", response_model=ProfileResponse)
async def update_profile(
    data: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserProfile).where(UserProfile.user_id == current_user.id)
    )
    profile = result.scalar_one_or_none()

    if not profile:
        profile = UserProfile(user_id=current_user.id)
        db.add(profile)

    # Update provided fields
    if data.height_cm is not None:
        profile.height_cm = data.height_cm
    if data.weight_kg is not None:
        profile.weight_kg = data.weight_kg
    if data.age is not None:
        profile.age = data.age
    if data.gender is not None:
        profile.gender = data.gender
    if data.activity_level is not None:
        profile.activity_level = data.activity_level
    if data.goal is not None:
        profile.goal = data.goal

    # Calculate BMI if height and weight are both available
    if profile.height_cm is not None and profile.weight_kg is not None:
        height_m = profile.height_cm / 100.0
        profile.bmi = round(profile.weight_kg / (height_m ** 2), 1)

    # Calculate TDEE if all required fields are set
    if (
        profile.age is not None
        and profile.gender is not None
        and profile.weight_kg is not None
        and profile.height_cm is not None
        and profile.activity_level is not None
    ):
        # BMR: Mifflin-St Jeor equation
        if profile.gender == "male":
            bmr = (10 * profile.weight_kg) + (6.25 * profile.height_cm) - (5 * profile.age) + 5
        else:  # female
            bmr = (10 * profile.weight_kg) + (6.25 * profile.height_cm) - (5 * profile.age) - 161

        # Activity multiplier
        activity_multipliers = {
            "sedentary": 1.2,
            "light": 1.375,
            "moderate": 1.55,
            "active": 1.725,
            "very_active": 1.9,
        }
        multiplier = activity_multipliers.get(profile.activity_level, 1.55)
        tdee = bmr * multiplier

        # Goal modifier
        goal_modifiers = {
            "lose": 0.8,
            "maintain": 1.0,
            "gain": 1.15,
        }
        goal_modifier = goal_modifiers.get(profile.goal, 1.0) if profile.goal else 1.0
        profile.tdee = tdee * goal_modifier

    await db.flush()
    await db.refresh(profile)
    return ProfileResponse.model_validate(profile)


# ══════════════════════════════════════════════
# GOALS ENDPOINT
# ══════════════════════════════════════════════

@app.get("/api/goals", response_model=GoalSummary)
async def get_goals(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Get profile and budget
    profile_result = await db.execute(
        select(UserProfile).where(UserProfile.user_id == current_user.id)
    )
    profile = profile_result.scalar_one_or_none()

    budget_result = await db.execute(
        select(Budget).where(Budget.user_id == current_user.id)
    )
    budget = budget_result.scalar_one_or_none()

    # Determine calorie target
    tdee_value = 2000.0
    calories = 2000

    if profile and profile.tdee is not None:
        tdee_value = profile.tdee
        calories = round(profile.tdee)

    # Calculate BMR from profile data if available
    bmr_value = 0.0
    if (
        profile
        and profile.age is not None
        and profile.gender is not None
        and profile.weight_kg is not None
        and profile.height_cm is not None
    ):
        if profile.gender == "male":
            bmr_value = (10 * profile.weight_kg) + (6.25 * profile.height_cm) - (5 * profile.age) + 5
        else:
            bmr_value = (10 * profile.weight_kg) + (6.25 * profile.height_cm) - (5 * profile.age) - 161
    else:
        bmr_value = 0.0

    # If no profile TDEE, check budget
    if profile is None or profile.tdee is None:
        if budget:
            calories = budget.daily_calories

    # Macro split
    protein = round(calories * 0.30 / 4)
    carbs = round(calories * 0.40 / 4)
    fat = round(calories * 0.30 / 9)

    # Water recommendation
    if profile and profile.weight_kg is not None:
        water_ml = round(profile.weight_kg * 35)
    else:
        water_ml = 2500

    bmi_val = profile.bmi if profile else None

    return GoalSummary(
        calories=calories,
        protein=protein,
        carbs=carbs,
        fat=fat,
        water_ml=water_ml,
        bmr=bmr_value,
        tdee=tdee_value,
        bmi=bmi_val,
    )


# ══════════════════════════════════════════════
# HISTORY ENDPOINT
# ══════════════════════════════════════════════

@app.get("/api/history", response_model=HistoryResponse)
async def get_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cutoff = datetime.date.today() - datetime.timedelta(days=7)
    result = await db.execute(
        select(Meal)
        .where(Meal.user_id == current_user.id, Meal.meal_date >= cutoff)
        .order_by(Meal.meal_date.desc(), Meal.created_at)
    )
    meals = result.scalars().all()

    days: dict[datetime.date, list[Meal]] = {}
    for m in meals:
        days.setdefault(m.meal_date, []).append(m)

    history_days = []
    for d in sorted(days.keys(), reverse=True):
        day_meals = days[d]
        history_days.append(HistoryDay(
            date=d,
            meals=[MealResponse.model_validate(m) for m in day_meals],
            total_calories=sum(m.calories for m in day_meals),
            total_protein=sum(m.protein for m in day_meals),
            total_carbs=sum(m.carbs for m in day_meals),
            total_fat=sum(m.fat for m in day_meals),
        ))

    return HistoryResponse(days=history_days)


# ══════════════════════════════════════════════
# EXPORT/IMPORT ENDPOINTS
# ══════════════════════════════════════════════


class ImportData(BaseModel):
    meals: Optional[list[dict]] = None
    presets: Optional[list[dict]] = None
    budget: Optional[dict] = None
    profile: Optional[dict] = None


@app.get("/api/export")
async def export_data(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export all user data including meals, presets, budget, and profile."""
    # Get meals (all time)
    meals_result = await db.execute(
        select(Meal).where(Meal.user_id == current_user.id).order_by(Meal.meal_date.desc(), Meal.created_at)
    )
    meals = meals_result.scalars().all()
    meals_data = [
        {
            "name": m.name,
            "calories": m.calories,
            "protein": m.protein,
            "carbs": m.carbs,
            "fat": m.fat,
            "weight_g": m.weight_g,
            "meal_date": m.meal_date.isoformat(),
        }
        for m in meals
    ]

    # Get presets
    presets_result = await db.execute(
        select(Preset).where(Preset.user_id == current_user.id).order_by(Preset.name)
    )
    presets = presets_result.scalars().all()
    presets_data = [
        {
            "name": p.name,
            "calories": p.calories,
            "protein": p.protein,
            "carbs": p.carbs,
            "fat": p.fat,
            "description": p.description,
        }
        for p in presets
    ]

    # Get budget
    budget_result = await db.execute(
        select(Budget).where(Budget.user_id == current_user.id)
    )
    budget = budget_result.scalar_one_or_none()
    budget_data = {"daily_calories": budget.daily_calories if budget else 2000}

    # Get profile
    profile_result = await db.execute(
        select(UserProfile).where(UserProfile.user_id == current_user.id)
    )
    profile = profile_result.scalar_one_or_none()
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
        "budget": budget_data,
        "profile": profile_data,
    }


@app.put("/api/import")
async def import_data(
    data: ImportData,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Import user data including meals, presets, budget, and profile."""
    # Import budget
    if data.budget and "daily_calories" in data.budget:
        budget_result = await db.execute(
            select(Budget).where(Budget.user_id == current_user.id)
        )
        budget = budget_result.scalar_one_or_none()
        if not budget:
            budget = Budget(user_id=current_user.id, daily_calories=data.budget["daily_calories"])
            db.add(budget)
        else:
            budget.daily_calories = data.budget["daily_calories"]
        await db.flush()

    # Import profile
    if data.profile:
        profile_result = await db.execute(
            select(UserProfile).where(UserProfile.user_id == current_user.id)
        )
        profile = profile_result.scalar_one_or_none()

        if not profile:
            profile = UserProfile(user_id=current_user.id)
            db.add(profile)

        # Update provided profile fields
        if "height_cm" in data.profile and data.profile["height_cm"] is not None:
            profile.height_cm = data.profile["height_cm"]
        if "weight_kg" in data.profile and data.profile["weight_kg"] is not None:
            profile.weight_kg = data.profile["weight_kg"]
        if "age" in data.profile and data.profile["age"] is not None:
            profile.age = data.profile["age"]
        if "gender" in data.profile and data.profile["gender"] is not None:
            profile.gender = data.profile["gender"]
        if "activity_level" in data.profile and data.profile["activity_level"] is not None:
            profile.activity_level = data.profile["activity_level"]
        if "goal" in data.profile and data.profile["goal"] is not None:
            profile.goal = data.profile["goal"]

        # Recalculate BMI and TDEE
        if profile.height_cm is not None and profile.weight_kg is not None:
            height_m = profile.height_cm / 100.0
            profile.bmi = round(profile.weight_kg / (height_m ** 2), 1)

        if (
            profile.age is not None
            and profile.gender is not None
            and profile.weight_kg is not None
            and profile.height_cm is not None
            and profile.activity_level is not None
        ):
            if profile.gender == "male":
                bmr = (10 * profile.weight_kg) + (6.25 * profile.height_cm) - (5 * profile.age) + 5
            else:
                bmr = (10 * profile.weight_kg) + (6.25 * profile.height_cm) - (5 * profile.age) - 161

            activity_multipliers = {
                "sedentary": 1.2,
                "light": 1.375,
                "moderate": 1.55,
                "active": 1.725,
                "very_active": 1.9,
            }
            multiplier = activity_multipliers.get(profile.activity_level, 1.55)
            tdee = bmr * multiplier

            goal_modifiers = {
                "lose": 0.8,
                "maintain": 1.0,
                "gain": 1.15,
            }
            goal_modifier = goal_modifiers.get(profile.goal, 1.0) if profile.goal else 1.0
            profile.tdee = tdee * goal_modifier

        await db.flush()

    # Import meals
    if data.meals:
        for meal_data in data.meals:
            meal = Meal(
                user_id=current_user.id,
                meal_date=datetime.date.fromisoformat(meal_data.get("meal_date", datetime.date.today().isoformat())),
                name=meal_data.get("name", "Imported Meal"),
                calories=meal_data.get("calories", 0),
                protein=meal_data.get("protein", 0),
                carbs=meal_data.get("carbs", 0),
                fat=meal_data.get("fat", 0),
                weight_g=meal_data.get("weight_g", 0),
            )
            db.add(meal)
        await db.flush()

    # Import presets
    if data.presets:
        for preset_data in data.presets:
            preset = Preset(
                user_id=current_user.id,
                name=preset_data.get("name", "Imported Preset"),
                calories=preset_data.get("calories", 0),
                protein=preset_data.get("protein", 0),
                carbs=preset_data.get("carbs", 0),
                fat=preset_data.get("fat", 0),
                description=preset_data.get("description", ""),
            )
            db.add(preset)
        await db.flush()

    return {"message": "Data imported successfully"}


# ══════════════════════════════════════════════
# AI ANALYSIS ENDPOINT (existing)
# ══════════════════════════════════════════════

@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze_food(request: AnalyzeRequest):
    if not OPENROUTER_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="OPENROUTER_API_KEY is not set. Add it to the .env file.",
        )

    user_content = [
        {
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{request.image}"},
        },
    ]

    if request.description:
        user_content.insert(
            0, {"type": "text", "text": f"Description: {request.description}"}
        )

    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.3,
        "max_tokens": 1024,
    }

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:8000",
        "X-Title": "Calorie Vision",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        last_error = None
        for attempt in range(MAX_RETRIES):
            try:
                response = await client.post(
                    OPENROUTER_URL, json=payload, headers=headers
                )
                response.raise_for_status()
                break
            except httpx.HTTPStatusError as e:
                last_error = e
                if e.response.status_code >= 500 and attempt < MAX_RETRIES - 1:
                    delay = RETRY_DELAY_SECONDS * (2 ** attempt)
                    await asyncio.sleep(delay)
                    continue
                raise HTTPException(
                    status_code=502,
                    detail=f"OpenRouter API error after {attempt + 1} attempt(s): {e.response.status_code}",
                )
            except httpx.RequestError as e:
                last_error = e
                if attempt < MAX_RETRIES - 1:
                    delay = RETRY_DELAY_SECONDS * (2 ** attempt)
                    await asyncio.sleep(delay)
                    continue
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to reach OpenRouter after {attempt + 1} attempt(s): {str(e)}",
                )

    data = response.json()

    try:
        content = data["choices"][0]["message"]["content"]
        content = content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1]
            content = content.rsplit("```", 1)[0]
            content = content.strip()
        result = json.loads(content)
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to parse LLM response: {str(e)}. Raw: {data}",
        )

    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
