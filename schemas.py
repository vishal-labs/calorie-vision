from pydantic import BaseModel, Field
from typing import Optional
from datetime import date


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    password: str = Field(..., min_length=4, max_length=128)


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(..., min_length=4, max_length=128)


class ForgotPasswordRequest(BaseModel):
    username: str


class ResetPasswordRequest(BaseModel):
    username: str
    reset_token: str
    new_password: str = Field(..., min_length=4, max_length=128)


class AuthResponse(BaseModel):
    token: str
    username: str
    must_change_password: bool


class MealCreate(BaseModel):
    name: str
    calories: float
    protein: float = 0
    carbs: float = 0
    fat: float = 0
    weight_g: float = 0
    meal_date: date = Field(default_factory=date.today)


class MealResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    meal_date: date
    name: str
    calories: float
    protein: float
    carbs: float
    fat: float
    weight_g: float


class MealListResponse(BaseModel):
    meals: list[MealResponse]
    total_calories: float
    total_protein: float
    total_carbs: float
    total_fat: float


class PresetCreate(BaseModel):
    name: str
    calories: float
    protein: float = 0
    carbs: float = 0
    fat: float = 0
    description: str = ""


class PresetResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    calories: float
    protein: float
    carbs: float
    fat: float
    description: str


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


class HistoryResponse(BaseModel):
    days: list[HistoryDay]


class ProfileUpdate(BaseModel):
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    activity_level: Optional[str] = None
    goal: Optional[str] = None


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
    water_ml: int
    bmr: float
    tdee: float
    bmi: Optional[float] = None
