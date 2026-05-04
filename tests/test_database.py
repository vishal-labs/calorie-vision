import pytest
from httpx import AsyncClient
from tests.conftest import create_test_user, auth_headers


class TestAuth:
    async def test_register_success(self, client: AsyncClient, db_session):
        res = await client.post("/api/auth/register", json={
            "username": "alice", "password": "pass1234"
        })
        assert res.status_code == 200
        data = res.json()
        assert data["username"] == "alice"
        assert "token" in data
        assert data["must_change_password"] is False

    async def test_register_duplicate(self, client: AsyncClient, db_session):
        await client.post("/api/auth/register", json={"username": "bob", "password": "pass1234"})
        res = await client.post("/api/auth/register", json={"username": "bob", "password": "another"})
        assert res.status_code == 409

    async def test_register_short_username(self, client: AsyncClient):
        res = await client.post("/api/auth/register", json={"username": "a", "password": "pass1234"})
        assert res.status_code == 422

    async def test_register_short_password(self, client: AsyncClient):
        res = await client.post("/api/auth/register", json={"username": "user", "password": "ab"})
        assert res.status_code == 422

    async def test_login_success(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session, "testuser", "testpass")
        res = await client.post("/api/auth/login", json={"username": "testuser", "password": "testpass"})
        assert res.status_code == 200
        data = res.json()
        assert data["username"] == "testuser"
        assert "token" in data

    async def test_login_wrong_password(self, client: AsyncClient, db_session):
        await create_test_user(db_session, "testuser", "testpass")
        res = await client.post("/api/auth/login", json={"username": "testuser", "password": "wrong"})
        assert res.status_code == 401

    async def test_login_nonexistent_user(self, client: AsyncClient):
        res = await client.post("/api/auth/login", json={"username": "ghost", "password": "nope"})
        assert res.status_code == 401

    async def test_login_must_change_password(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session, "newuser", "pass", must_change=True)
        res = await client.post("/api/auth/login", json={"username": "newuser", "password": "pass"})
        assert res.status_code == 200
        assert res.json()["must_change_password"] is True

    async def test_change_password(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session, "changer", "oldpass")
        headers = auth_headers(user)
        res = await client.put("/api/auth/change-password", json={
            "old_password": "oldpass", "new_password": "newpass"
        }, headers=headers)
        assert res.status_code == 200
        assert res.json()["message"] == "Password changed successfully"

    async def test_change_password_wrong_old(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session, "changer2", "correct")
        headers = auth_headers(user)
        res = await client.put("/api/auth/change-password", json={
            "old_password": "wrong", "new_password": "newpass"
        }, headers=headers)
        assert res.status_code == 401

    async def test_protected_endpoint_without_token(self, client: AsyncClient):
        res = await client.get("/api/meals")
        assert res.status_code in (401, 403)

    async def test_protected_endpoint_with_bad_token(self, client: AsyncClient):
        res = await client.get("/api/meals", headers={"Authorization": "Bearer badtoken"})
        assert res.status_code == 401


class TestMeals:
    async def test_get_empty_meals(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        res = await client.get("/api/meals", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["meals"] == []
        assert data["total_calories"] == 0

    async def test_add_meal(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        res = await client.post("/api/meals", json={
            "name": "Chicken Salad",
            "calories": 450,
            "protein": 35,
            "carbs": 15,
            "fat": 22,
            "weight_g": 300,
        }, headers=headers)
        assert res.status_code == 201
        data = res.json()
        assert data["name"] == "Chicken Salad"
        assert data["calories"] == 450
        assert data["protein"] == 35
        assert data["id"] is not None

    async def test_get_meals_with_data(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        await client.post("/api/meals", json={"name": "Rice", "calories": 300}, headers=headers)
        await client.post("/api/meals", json={"name": "Curry", "calories": 250}, headers=headers)

        res = await client.get("/api/meals", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert len(data["meals"]) == 2
        assert data["total_calories"] == 550

    async def test_delete_meal(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        add = await client.post("/api/meals", json={"name": "Snack", "calories": 100}, headers=headers)
        meal_id = add.json()["id"]

        res = await client.delete(f"/api/meals/{meal_id}", headers=headers)
        assert res.status_code == 200

        get_res = await client.get("/api/meals", headers=headers)
        assert get_res.json()["meals"] == []

    async def test_delete_nonexistent_meal(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        res = await client.delete("/api/meals/99999", headers=headers)
        assert res.status_code == 404

    async def test_delete_other_users_meal(self, client: AsyncClient, db_session):
        user1 = await create_test_user(db_session, "user1", "pass1")
        user2 = await create_test_user(db_session, "user2", "pass2")
        headers1 = auth_headers(user1)
        headers2 = auth_headers(user2)

        add = await client.post("/api/meals", json={"name": "Mine", "calories": 100}, headers=headers1)
        meal_id = add.json()["id"]

        res = await client.delete(f"/api/meals/{meal_id}", headers=headers2)
        assert res.status_code == 404

    async def test_meal_date_filter(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        await client.post("/api/meals", json={
            "name": "Today", "calories": 100, "meal_date": "2024-06-15"
        }, headers=headers)
        await client.post("/api/meals", json={
            "name": "Other", "calories": 200, "meal_date": "2024-06-16"
        }, headers=headers)

        res = await client.get("/api/meals?date=2024-06-15", headers=headers)
        data = res.json()
        assert len(data["meals"]) == 1
        assert data["meals"][0]["name"] == "Today"

    async def test_meal_invalid_date(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        res = await client.get("/api/meals?date=not-a-date", headers=headers)
        assert res.status_code == 400


class TestPresets:
    async def test_get_empty_presets(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        res = await client.get("/api/presets", headers=headers)
        assert res.status_code == 200
        assert res.json() == []

    async def test_create_preset(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        res = await client.post("/api/presets", json={
            "name": "My Salad",
            "calories": 350,
            "protein": 20,
            "carbs": 10,
            "fat": 25,
            "description": "Homemade",
        }, headers=headers)
        assert res.status_code == 201
        data = res.json()
        assert data["name"] == "My Salad"
        assert data["calories"] == 350

    async def test_get_presets_with_data(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        await client.post("/api/presets", json={"name": "A", "calories": 100}, headers=headers)
        await client.post("/api/presets", json={"name": "B", "calories": 200}, headers=headers)
        res = await client.get("/api/presets", headers=headers)
        assert len(res.json()) == 2

    async def test_delete_preset(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        add = await client.post("/api/presets", json={"name": "ToDelete", "calories": 50}, headers=headers)
        preset_id = add.json()["id"]
        res = await client.delete(f"/api/presets/{preset_id}", headers=headers)
        assert res.status_code == 200
        remaining = await client.get("/api/presets", headers=headers)
        assert remaining.json() == []

    async def test_delete_nonexistent_preset(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        res = await client.delete("/api/presets/99999", headers=headers)
        assert res.status_code == 404


class TestBudget:
    async def test_get_default_budget(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        res = await client.get("/api/budget", headers=headers)
        assert res.status_code == 200
        assert res.json()["daily_calories"] == 2000

    async def test_update_budget(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        res = await client.put("/api/budget", json={"daily_calories": 2500}, headers=headers)
        assert res.status_code == 200
        assert res.json()["daily_calories"] == 2500

        get_res = await client.get("/api/budget", headers=headers)
        assert get_res.json()["daily_calories"] == 2500

    async def test_update_budget_invalid_low(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        res = await client.put("/api/budget", json={"daily_calories": 100}, headers=headers)
        assert res.status_code == 422


class TestHistory:
    async def test_get_empty_history(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        res = await client.get("/api/history", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert "days" in data
        assert isinstance(data["days"], list)

    async def test_get_history_with_data(self, client: AsyncClient, db_session):
        from datetime import date, timedelta
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        yesterday = (date.today() - timedelta(days=2)).isoformat()
        await client.post("/api/meals", json={
            "name": "Pizza", "calories": 800, "meal_date": yesterday, "protein": 30
        }, headers=headers)

        res = await client.get("/api/history", headers=headers)
        data = res.json()
        assert len(data["days"]) == 1
        day = data["days"][0]
        assert day["date"] == yesterday
        assert day["total_calories"] == 800
        assert len(day["meals"]) == 1


class TestIndex:
    async def test_serves_html(self, client: AsyncClient):
        res = await client.get("/")
        assert res.status_code == 200
        assert "Calorie Vision" in res.text

    async def test_login_view_has_password_fields(self, client: AsyncClient):
        res = await client.get("/")
        assert 'id="login-username"' in res.text
        assert 'id="login-password"' in res.text
        assert 'id="btn-login"' in res.text
        assert 'id="btn-register"' in res.text
        assert 'id="change-password-section"' in res.text
