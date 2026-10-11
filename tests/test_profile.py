import pytest
from httpx import AsyncClient
from tests.conftest import create_test_user, auth_headers


class TestProfile:
    async def test_get_empty_profile(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        res = await client.get("/api/profile", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data.get("height_cm") is None or data["height_cm"] is None
        assert data.get("weight_kg") is None or data["weight_kg"] is None

    async def test_update_profile_height_weight(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        res = await client.put("/api/profile", json={
            "height_cm": 175, "weight_kg": 70
        }, headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["height_cm"] == 175
        assert data["weight_kg"] == 70
        assert data["bmi"] is not None
        assert 20 < data["bmi"] < 25

    async def test_update_full_profile_and_tdee(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        res = await client.put("/api/profile", json={
            "height_cm": 180,
            "weight_kg": 80,
            "age": 30,
            "gender": "male",
            "activity_level": "moderate",
            "goal": "maintain",
        }, headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["tdee"] is not None
        assert data["tdee"] > 2000

    async def test_full_profile_tdee_lose_goal(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        await client.put("/api/profile", json={
            "height_cm": 165, "weight_kg": 75, "age": 25,
            "gender": "female", "activity_level": "light", "goal": "lose",
        }, headers=headers)
        goals = await client.get("/api/goals", headers=headers)
        assert goals.status_code == 200
        g = goals.json()
        assert g["calories"] > 0
        assert g["protein"] > 0
        assert g["carbs"] > 0
        assert g["fat"] > 0
        assert g["water_ml"] > 0
        assert g["tdee"] > 0
        assert g["bmr"] > 0

    async def test_goals_with_budget_fallback(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        await client.put("/api/budget", json={"daily_calories": 2500}, headers=headers)
        goals = await client.get("/api/goals", headers=headers)
        assert goals.status_code == 200
        g = goals.json()
        assert g["calories"] == 2500
        assert g["protein"] > 0


class TestBMI:
    async def test_bmi_calculation_normal(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        res = await client.put("/api/profile", json={
            "height_cm": 175, "weight_kg": 70
        }, headers=headers)
        data = res.json()
        assert data["bmi"] == pytest.approx(22.9, abs=0.2)

    async def test_bmi_underweight(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        res = await client.put("/api/profile", json={
            "height_cm": 180, "weight_kg": 50
        }, headers=headers)
        assert res.json()["bmi"] < 18.5

    async def test_bmi_obesity(self, client: AsyncClient, db_session):
        user = await create_test_user(db_session)
        headers = auth_headers(user)
        res = await client.put("/api/profile", json={
            "height_cm": 160, "weight_kg": 100
        }, headers=headers)
        assert res.json()["bmi"] > 30


class TestUI:
    """Static shell checks; behaviour is covered by scripts/e2e.py in a real browser."""

    def test_shell_has_tabs_and_flows(self):
        from main import app
        from fastapi.testclient import TestClient
        res = TestClient(app).get("/")
        for tab in ("today", "progress", "foods", "me"):
            assert f'id="tab-{tab}"' in res.text
        for screen in ("camera", "review", "analyzing", "results", "scanner", "product"):
            assert f'id="screen-{screen}"' in res.text
        assert 'rel="manifest"' in res.text

    def test_assets_are_served_with_version(self):
        from main import app
        from fastapi.testclient import TestClient
        tc = TestClient(app)
        html = tc.get("/").text
        for name in ("app.js", "scanner.js", "style.css"):
            marker = f"/static/{name}?v="
            assert marker in html
            assert tc.get(f"/static/{name}").status_code == 200
        js = tc.get("/static/app.js").text
        for fn in ("renderToday", "openScanner", "openGroupSheet", "renderProgress", "loadGoals"):
            assert fn in js
        wasm = tc.get("/static/vendor/zxing_reader-3.1.3.wasm")
        assert wasm.status_code == 200
        assert wasm.headers["content-type"] == "application/wasm"
