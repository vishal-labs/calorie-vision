import pytest
import pytest_asyncio
from httpx import AsyncClient
from datetime import date
from tests.conftest import create_test_user, auth_headers


class TestGroupedMeals:
    async def test_ai_returns_grouped_meals(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        res = await client.post("/api/meals/batch", json={
            "meals": [
                {"name": "Rice", "calories": 200, "protein": 4, "carbs": 44, "fat": 0.5, "weight_g": 150},
                {"name": "Chicken Curry", "calories": 300, "protein": 25, "carbs": 10, "fat": 18, "weight_g": 150},
            ]
        }, headers=headers)
        assert res.status_code == 201
        meals = await client.get(f"/api/meals?date={date.today()}", headers=headers)
        data = meals.json()
        assert len(data["meals"]) == 1
        assert data["meals"][0]["is_group"]
        assert "Rice" in data["meals"][0]["items"]
        assert "Chicken Curry" in data["meals"][0]["items"]

    async def test_single_meal_not_grouped(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        res = await client.post("/api/meals", json={
            "name": "Apple", "calories": 95, "protein": 0.5, "carbs": 25, "fat": 0.3, "weight_g": 182
        }, headers=headers)
        assert res.status_code == 201
        meals = await client.get(f"/api/meals?date={date.today()}", headers=headers)
        data = meals.json()
        assert len(data["meals"]) == 1
        assert data["meals"][0].get("is_group") is False or data["meals"][0].get("is_group") is None
        assert data["meals"][0].get("items") is None

    async def test_delete_grouped_meal(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        await client.post("/api/meals/batch", json={
            "meals": [
                {"name": "Rice", "calories": 200, "protein": 4, "carbs": 44, "fat": 0.5, "weight_g": 150},
                {"name": "Dal", "calories": 150, "protein": 12, "carbs": 20, "fat": 3, "weight_g": 100},
            ]
        }, headers=headers)
        meals = await client.get(f"/api/meals?date={date.today()}", headers=headers)
        meal_id = meals.json()["meals"][0]["id"]
        del_res = await client.delete(f"/api/meals/{meal_id}", headers=headers)
        assert del_res.status_code == 200
        after = await client.get(f"/api/meals?date={date.today()}", headers=headers)
        assert len(after.json()["meals"]) == 0

    async def test_mixed_grouped_and_single(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        await client.post("/api/meals/batch", json={
            "meals": [
                {"name": "Rice", "calories": 200, "protein": 4, "carbs": 44, "fat": 0.5, "weight_g": 150},
                {"name": "Curry", "calories": 300, "protein": 25, "carbs": 10, "fat": 18, "weight_g": 150},
            ]
        }, headers=headers)
        await client.post("/api/meals", json={
            "name": "Apple", "calories": 95, "protein": 0.5, "carbs": 25, "fat": 0.3, "weight_g": 182
        }, headers=headers)
        meals = await client.get(f"/api/meals?date={date.today()}", headers=headers)
        data = meals.json()
        grouped = [m for m in data["meals"] if m.get("is_group")]
        singles = [m for m in data["meals"] if not m.get("is_group")]
        assert len(grouped) == 1
        assert len(singles) == 1