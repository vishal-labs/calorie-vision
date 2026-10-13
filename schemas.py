import datetime
from pydantic import BaseModel, BeforeValidator, Field, field_validator
from typing import Annotated, Literal, Optional
from datetime import date

MealType = Literal["breakfast", "lunch", "dinner", "snack"]
MealSource = Literal["ai", "barcode", "manual", "preset", "recent"]

# Columns added after launch are NULL on old rows; report them as 0.
ZeroIfNone = Annotated[float, BeforeValidator(lambda v: 0 if v is None else v)]

# Upper bounds stop typos (an extra zero) and garbage imports from wrecking totals.
Kcal = Field(..., ge=0, le=20000)
Grams = Field(0, ge=0, le=5000)


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=50, pattern=r"^\s*[A-Za-z0-9_.\-@]+\s*$")
    password: str = Field(..., min_length=4, max_length=128)


class LoginRequest(BaseModel):
    username: str = Field(..., max_length=50)
    password: str = Field(..., max_length=128)


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(..., max_length=128)
    new_password: str = Field(..., min_length=4, max_length=128)


class ForgotPasswordRequest(BaseModel):
    username: str = Field(..., max_length=50)


class ResetPasswordRequest(BaseModel):
    username: str = Field(..., max_length=50)
    reset_token: str = Field(..., max_length=64)
    new_password: str = Field(..., min_length=4, max_length=128)


class AuthResponse(BaseModel):
    token: str
    username: str
    must_change_password: bool


class MealCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    calories: float = Kcal
    protein: float = Grams
    carbs: float = Grams
    fat: float = Grams
    fiber: float = Field(0, ge=0, le=500)
    weight_g: float = Field(0, ge=0, le=20000)
    meal_date: date = Field(default_factory=date.today)
    group_token: str | None = Field(None, max_length=64)
    meal_type: Optional[MealType] = None
    source: Optional[MealSource] = None
    barcode: str | None = Field(None, pattern=r"^\d{8,14}$")
    nutri_grade: str | None = Field(None, pattern=r"^[a-e]$")

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name can't be empty")
        return v


class MealBatchCreate(BaseModel):
    meals: list[MealCreate] = Field(..., max_length=30)
    group_name: str | None = Field(None, max_length=200)
    meal_type: Optional[MealType] = None


class MealUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    calories: float | None = Field(None, ge=0, le=20000)
    protein: float | None = Field(None, ge=0, le=5000)
    carbs: float | None = Field(None, ge=0, le=5000)
    fat: float | None = Field(None, ge=0, le=5000)
    fiber: float | None = Field(None, ge=0, le=500)
    weight_g: float | None = Field(None, ge=0, le=20000)
    meal_type: Optional[MealType] = None
    meal_date: date | None = None


class MealGroupUpdate(BaseModel):
    group_name: str | None = Field(None, max_length=200)
    meal_type: Optional[MealType] = None
    meal_date: date | None = None


class MealBreakdownItem(BaseModel):
    id: int
    name: str
    calories: float
    protein: float
    carbs: float
    fat: float
    fiber: ZeroIfNone = 0
    weight_g: float


class MealResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    meal_date: date
    name: str
    calories: float
    protein: float
    carbs: float
    fat: float
    fiber: ZeroIfNone = 0
    weight_g: float
    group_token: str | None = None
    is_group: bool = False
    items: list[MealBreakdownItem] | None = None
    meal_type: str | None = None
    source: str | None = None
    barcode: str | None = None
    nutri_grade: str | None = None
    created_at: datetime.datetime | None = None


class MealListResponse(BaseModel):
    meals: list[MealResponse]
    total_calories: float
    total_protein: float
    total_carbs: float
    total_fat: float
    total_fiber: float = 0


class RecentFood(BaseModel):
    name: str
    calories: float
    protein: float
    carbs: float
    fat: float
    fiber: ZeroIfNone = 0
    weight_g: float
    barcode: str | None = None
    nutri_grade: str | None = None
    times_logged: int


class PresetItem(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    calories: float = Kcal
    protein: float = Grams
    carbs: float = Grams
    fat: float = Grams
    fiber: float = Field(0, ge=0, le=500)
    weight_g: float = Field(0, ge=0, le=20000)


class PresetCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    # For a multi-item favourite the totals are computed from `items`.
    items: list[PresetItem] | None = Field(None, max_length=30)
    calories: float = Kcal
    protein: float = Grams
    carbs: float = Grams
    fat: float = Grams
    fiber: float = Field(0, ge=0, le=500)
    description: str = Field("", max_length=500)


class PresetResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    calories: float
    protein: float
    carbs: float
    fat: float
    fiber: ZeroIfNone = 0
    description: str
    items: list[PresetItem] | None = None

    @field_validator("items", mode="before")
    @classmethod
    def parse_items(cls, v):
        if isinstance(v, str):
            import json
            return json.loads(v) or None
        return v


class BudgetResponse(BaseModel):
    daily_calories: int


class BudgetUpdate(BaseModel):
    daily_calories: int = Field(..., ge=500, le=10000)


class HistoryDay(BaseModel):
    date: date
    meals: list[MealResponse]
    total_calories: float
    total_protein: float
    total_carbs: float
    total_fat: float
    total_fiber: float = 0


class HistoryResponse(BaseModel):
    days: list[HistoryDay]


class ProfileUpdate(BaseModel):
    height_cm: Optional[float] = Field(None, ge=50, le=300)
    weight_kg: Optional[float] = Field(None, ge=10, le=500)
    age: Optional[int] = Field(None, ge=1, le=150)
    gender: Optional[Literal["male", "female"]] = None
    activity_level: Optional[Literal["sedentary", "light", "moderate", "active", "very_active"]] = None
    goal: Optional[Literal["lose", "maintain", "gain"]] = None


class ProfileResponse(BaseModel):
    model_config = {"from_attributes": True}
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    activity_level: Optional[str] = None
    goal: Optional[str] = None
    tdee: Optional[float] = None
    bmi: Optional[float] = None


class GoalSummary(BaseModel):
    calories: int
    protein: int
    carbs: int
    fat: int
    fiber: int = 28
    water_ml: int
    bmr: float
    tdee: float
    bmi: Optional[float] = None
    recommended_calories: Optional[int] = None


class WaterUpdate(BaseModel):
    delta_ml: int = Field(..., ge=-5000, le=5000)
    log_date: date = Field(default_factory=date.today)


class WaterResponse(BaseModel):
    log_date: date
    amount_ml: int
    goal_ml: int


# ── Calories burned & energy balance ──
ActivityKind = Literal["active", "total"]
ActivitySource = Literal["apple_watch", "fitbit", "garmin", "other"]


class ActivityCreate(BaseModel):
    calories: float = Field(..., gt=0, le=10000)
    kind: ActivityKind = "active"
    source: Optional[ActivitySource] = None
    note: str | None = Field(None, max_length=100)
    log_date: date = Field(default_factory=date.today)


class ActivityUpdate(BaseModel):
    calories: float | None = Field(None, gt=0, le=10000)
    kind: Optional[ActivityKind] = None
    source: Optional[ActivitySource] = None
    note: str | None = Field(None, max_length=100)
    log_date: date | None = None


class ActivityResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    log_date: date
    calories: float
    kind: str
    source: str | None = None
    note: str | None = None


class BalanceDay(BaseModel):
    date: date
    eaten: float
    active: float
    total_logged: float
    budget: int
    # How "burned" was worked out: "total" (logged), "bmr_plus_active" (profile estimate),
    # "active_only" (no resting estimate possible) or "none" (nothing logged).
    basis: Literal["total", "bmr_plus_active", "active_only", "none"]
    resting_estimate: float | None = None
    burned: float | None = None          # best estimate of total burn, if known
    balance: float | None = None         # eaten - burned (negative = deficit)
    net: float                           # eaten - logged burn (active or total)
    budget_with_exercise: float          # budget + active calories
    left_with_exercise: float


class BalanceResponse(BalanceDay):
    entries: list[ActivityResponse]


class BalanceHistory(BaseModel):
    days: list[BalanceDay]


# ── Weight ──
class WeightUpsert(BaseModel):
    weight_kg: float = Field(..., ge=20, le=400)
    log_date: date = Field(default_factory=date.today)


class WeightEntry(BaseModel):
    log_date: date
    weight_kg: float
    trend_kg: float  # average of entries in the 7 days up to this one


class WeightHistory(BaseModel):
    entries: list[WeightEntry]
    latest: WeightEntry | None = None
    change_7d: float | None = None   # trend now vs ~7 days earlier
    change_range: float | None = None  # trend now vs start of the window
