import pytest
from httpx import AsyncClient
from tests.conftest import create_test_user, auth_headers


class TestExport:
    async def test_export_includes_profile(self, client: AsyncClient, db_session):
        """Test that /api/export includes profile data"""
        user = await create_test_user(db_session)
        headers = auth_headers(user)

        # Set profile via /api/profile
        await client.put("/api/profile", json={
            "height_cm": 175,
            "weight_kg": 70,
            "age": 30,
            "gender": "male",
            "activity_level": "moderate",
            "goal": "maintain",
        }, headers=headers)

        # Call /api/export
        res = await client.get("/api/export", headers=headers)
        assert res.status_code == 200
        data = res.json()

        # Verify response includes profile with height_cm and weight_kg
        assert "profile" in data
        assert data["profile"]["height_cm"] == 175
        assert data["profile"]["weight_kg"] == 70
        assert data["profile"]["age"] == 30
        assert data["profile"]["gender"] == "male"
        assert data["profile"]["activity_level"] == "moderate"
        assert data["profile"]["goal"] == "maintain"

    async def test_export_includes_meals_presets_budget(self, client: AsyncClient, db_session):
        """Test that /api/export includes meals, presets, and budget"""
        user = await create_test_user(db_session)
        headers = auth_headers(user)

        # Add some data
        await client.put("/api/budget", json={"daily_calories": 2200}, headers=headers)
        await client.post("/api/meals", json={
            "name": "Test Meal",
            "calories": 500,
            "protein": 30,
            "carbs": 40,
            "fat": 20,
            "meal_date": "2026-05-05"
        }, headers=headers)
        await client.post("/api/presets", json={
            "name": "Test Preset",
            "calories": 300,
            "protein": 20,
            "carbs": 30,
            "fat": 10
        }, headers=headers)

        res = await client.get("/api/export", headers=headers)
        assert res.status_code == 200
        data = res.json()

        assert "meals" in data
        assert "presets" in data
        assert "budget" in data
        assert data["budget"]["daily_calories"] == 2200
        assert len(data["presets"]) == 1
        assert len(data["meals"]) == 1


class TestImport:
    async def test_import_profile_data(self, client: AsyncClient, db_session):
        """Test that /api/import can import profile data"""
        user = await create_test_user(db_session)
        headers = auth_headers(user)

        # Import profile data via /api/import
        import_data = {
            "profile": {
                "height_cm": 180,
                "weight_kg": 85,
                "age": 35,
                "gender": "male",
                "activity_level": "active",
                "goal": "lose"
            }
        }
        res = await client.put("/api/import", json=import_data, headers=headers)
        assert res.status_code == 200

        # Verify via /api/profile
        profile_res = await client.get("/api/profile", headers=headers)
        assert profile_res.status_code == 200
        profile = profile_res.json()
        assert profile["height_cm"] == 180
        assert profile["weight_kg"] == 85
        assert profile["age"] == 35
        assert profile["gender"] == "male"
        assert profile["activity_level"] == "active"
        assert profile["goal"] == "lose"

    async def test_import_meals_presets_budget(self, client: AsyncClient, db_session):
        """Test that /api/import can import meals, presets, and budget"""
        user = await create_test_user(db_session)
        headers = auth_headers(user)

        import_data = {
            "budget": {"daily_calories": 2500},
            "meals": [
                {
                    "name": "Imported Meal",
                    "calories": 600,
                    "protein": 25,
                    "carbs": 50,
                    "fat": 25,
                    "weight_g": 200,
                    "meal_date": "2026-05-05"
                }
            ],
            "presets": [
                {
                    "name": "Imported Preset",
                    "calories": 400,
                    "protein": 30,
                    "carbs": 40,
                    "fat": 15,
                    "description": "Test preset"
                }
            ]
        }
        res = await client.put("/api/import", json=import_data, headers=headers)
        assert res.status_code == 200

        # Verify budget
        budget_res = await client.get("/api/budget", headers=headers)
        assert budget_res.json()["daily_calories"] == 2500

        # Verify meals
        meals_res = await client.get("/api/meals?date=2026-05-05", headers=headers)
        assert len(meals_res.json()["meals"]) == 1

        # Verify presets
        presets_res = await client.get("/api/presets", headers=headers)
        assert len(presets_res.json()) == 1

    async def test_import_partial_data(self, client: AsyncClient, db_session):
        """Test that /api/import handles partial data correctly"""
        user = await create_test_user(db_session)
        headers = auth_headers(user)

        # Import only profile (no meals, presets, or budget)
        import_data = {
            "profile": {
                "height_cm": 170,
                "weight_kg": 65
            }
        }
        res = await client.put("/api/import", json=import_data, headers=headers)
        assert res.status_code == 200

        # Verify profile was imported
        profile_res = await client.get("/api/profile", headers=headers)
        assert profile_res.json()["height_cm"] == 170