"""
Tests for meal editing, water, recent foods, history windows, goals, validation,
schema migration and AI-output normalization.
"""
import datetime
import json
from datetime import date

from httpx import AsyncClient
from sqlalchemy import create_engine, inspect

import main
from database import Base, add_missing_columns
from tests.conftest import create_test_user, auth_headers

RICE = {"name": "Rice", "calories": 200, "protein": 4, "carbs": 44, "fat": 0.5, "weight_g": 150}
DAL = {"name": "Dal", "calories": 150, "protein": 12, "carbs": 20, "fat": 3, "weight_g": 100}


async def log_group(client, headers, **extra):
    res = await client.post("/api/meals/batch", json={"meals": [RICE, DAL], **extra}, headers=headers)
    assert res.status_code == 201
    meals = (await client.get(f"/api/meals?date={date.today()}", headers=headers)).json()["meals"]
    return next(m for m in meals if m["is_group"])


class TestGroupedItemEditing:
    async def test_edit_single_item_in_group(self, client: AsyncClient, db_session):
        headers = auth_headers(await create_test_user(db_session))
        group = await log_group(client, headers)
        rice = next(i for i in group["items"] if i["name"] == "Rice")

        res = await client.patch(f"/api/meals/{rice['id']}", json={"calories": 260, "weight_g": 200}, headers=headers)
        assert res.status_code == 200
        assert res.json()["calories"] == 260

        data = (await client.get(f"/api/meals?date={date.today()}", headers=headers)).json()
        assert data["total_calories"] == 410
        assert data["meals"][0]["calories"] == 410

    async def test_delete_single_item_keeps_rest_of_group(self, client: AsyncClient, db_session):
        headers = auth_headers(await create_test_user(db_session))
        group = await log_group(client, headers)
        dal = next(i for i in group["items"] if i["name"] == "Dal")

        res = await client.delete(f"/api/meals/{dal['id']}?scope=item", headers=headers)
        assert res.status_code == 200
        data = (await client.get(f"/api/meals?date={date.today()}", headers=headers)).json()
        assert data["total_calories"] == 200
        assert [i["name"] for i in data["meals"][0]["items"]] == ["Rice"]

    async def test_group_name_and_meal_type(self, client: AsyncClient, db_session):
        headers = auth_headers(await create_test_user(db_session))
        group = await log_group(client, headers, group_name="Dal chawal", meal_type="lunch")
        assert group["name"] == "Dal chawal"
        assert group["meal_type"] == "lunch"

        res = await client.patch(f"/api/meals/groups/{group['group_token']}",
                                 json={"group_name": "Lunch plate", "meal_type": "dinner"}, headers=headers)
        assert res.status_code == 200
        meal = (await client.get(f"/api/meals?date={date.today()}", headers=headers)).json()["meals"][0]
        assert meal["name"] == "Lunch plate"
        assert meal["meal_type"] == "dinner"

    async def test_unnamed_group_title_lists_items(self, client: AsyncClient, db_session):
        headers = auth_headers(await create_test_user(db_session))
        group = await log_group(client, headers)
        assert group["name"] == "Rice & Dal"

    async def test_cannot_edit_other_users_meal(self, client: AsyncClient, db_session):
        h1 = auth_headers(await create_test_user(db_session, username="a"))
        h2 = auth_headers(await create_test_user(db_session, username="b"))
        meal = (await client.post("/api/meals", json=RICE, headers=h1)).json()
        res = await client.patch(f"/api/meals/{meal['id']}", json={"calories": 1}, headers=h2)
        assert res.status_code == 404
        res = await client.patch("/api/meals/groups/nope", json={"group_name": "x"}, headers=h2)
        assert res.status_code == 404

    async def test_single_item_batch_is_not_grouped(self, client: AsyncClient, db_session):
        headers = auth_headers(await create_test_user(db_session))
        res = await client.post("/api/meals/batch", json={"meals": [RICE]}, headers=headers)
        assert res.status_code == 201
        assert res.json()[0]["group_token"] is None


class TestMealValidation:
    async def test_rejects_negative_and_huge_values(self, client: AsyncClient, db_session):
        headers = auth_headers(await create_test_user(db_session))
        for bad in ({"name": "x", "calories": -5}, {"name": "x", "calories": 99999},
                    {"name": "   ", "calories": 10}, {"name": "x" * 201, "calories": 10},
                    {"name": "x", "calories": 10, "meal_type": "brunch"},
                    {"name": "x", "calories": 10, "barcode": "abc"}):
            res = await client.post("/api/meals", json=bad, headers=headers)
            assert res.status_code == 422, bad

    async def test_stores_barcode_metadata(self, client: AsyncClient, db_session):
        headers = auth_headers(await create_test_user(db_session))
        res = await client.post("/api/meals", json={
            "name": "Oats", "calories": 150, "source": "barcode", "barcode": "3017620422003",
            "nutri_grade": "a", "meal_type": "breakfast",
        }, headers=headers)
        assert res.status_code == 201
        body = res.json()
        assert (body["source"], body["barcode"], body["nutri_grade"], body["meal_type"]) == \
            ("barcode", "3017620422003", "a", "breakfast")


class TestRecentFoods:
    async def test_distinct_most_recent_first_with_counts(self, client: AsyncClient, db_session):
        headers = auth_headers(await create_test_user(db_session))
        for m in (RICE, DAL, RICE):
            await client.post("/api/meals", json=m, headers=headers)
        res = await client.get("/api/meals/recent", headers=headers)
        assert res.status_code == 200
        foods = res.json()
        assert [f["name"] for f in foods][:2] == ["Rice", "Dal"]
        assert foods[0]["times_logged"] == 2


class TestWater:
    async def test_add_and_clamp(self, client: AsyncClient, db_session):
        headers = auth_headers(await create_test_user(db_session))
        today = date.today().isoformat()
        res = await client.get(f"/api/water?date={today}", headers=headers)
        assert res.json()["amount_ml"] == 0
        assert res.json()["goal_ml"] == 2500

        await client.post("/api/water", json={"delta_ml": 250, "log_date": today}, headers=headers)
        res = await client.post("/api/water", json={"delta_ml": 500, "log_date": today}, headers=headers)
        assert res.json()["amount_ml"] == 750
        res = await client.post("/api/water", json={"delta_ml": -5000, "log_date": today}, headers=headers)
        assert res.json()["amount_ml"] == 0

    async def test_goal_from_weight(self, client: AsyncClient, db_session):
        headers = auth_headers(await create_test_user(db_session))
        await client.put("/api/profile", json={"weight_kg": 80}, headers=headers)
        res = await client.get("/api/water", headers=headers)
        assert res.json()["goal_ml"] == 2800


class TestHistoryWindow:
    async def test_respects_client_end_date_and_groups(self, client: AsyncClient, db_session):
        headers = auth_headers(await create_test_user(db_session))
        end = date(2026, 3, 10)
        old = (end - datetime.timedelta(days=40)).isoformat()
        await client.post("/api/meals", json={**RICE, "meal_date": old}, headers=headers)
        await client.post("/api/meals/batch", json={"meals": [
            {**RICE, "meal_date": end.isoformat()}, {**DAL, "meal_date": end.isoformat()}]}, headers=headers)
        future = (end + datetime.timedelta(days=1)).isoformat()
        await client.post("/api/meals", json={**DAL, "meal_date": future}, headers=headers)

        week = (await client.get(f"/api/history?end={end}&days=7", headers=headers)).json()["days"]
        assert [d["date"] for d in week] == [end.isoformat()]
        assert week[0]["meals"][0]["is_group"] is True
        assert week[0]["total_calories"] == 350

        longer = (await client.get(f"/api/history?end={end}&days=60", headers=headers)).json()["days"]
        assert len(longer) == 2


class TestGoalsUseBudget:
    async def test_budget_is_the_calorie_target(self, client: AsyncClient, db_session):
        headers = auth_headers(await create_test_user(db_session))
        await client.put("/api/budget", json={"daily_calories": 1800}, headers=headers)
        await client.put("/api/profile", json={
            "height_cm": 180, "weight_kg": 80, "age": 30, "gender": "male",
            "activity_level": "moderate", "goal": "maintain"}, headers=headers)
        g = (await client.get("/api/goals", headers=headers)).json()
        assert g["calories"] == 1800
        # Mifflin: 10*80 + 6.25*180 - 5*30 + 5 = 1780; * 1.55
        assert g["recommended_calories"] == round(1780 * 1.55)
        assert g["protein"] == round(80 * 1.6)
        total = g["protein"] * 4 + g["carbs"] * 4 + g["fat"] * 9
        assert abs(total - 1800) < 15

    async def test_profile_rejects_invalid_enums(self, client: AsyncClient, db_session):
        headers = auth_headers(await create_test_user(db_session))
        res = await client.put("/api/profile", json={"gender": "robot"}, headers=headers)
        assert res.status_code == 422


class TestAuthHardening:
    async def test_login_rate_limited(self, client: AsyncClient, db_session):
        await create_test_user(db_session, username="victim", password="right")
        for _ in range(8):
            res = await client.post("/api/auth/login", json={"username": "victim", "password": "wrong"})
            assert res.status_code == 401
        res = await client.post("/api/auth/login", json={"username": "victim", "password": "right"})
        assert res.status_code == 429

    async def test_register_rejects_weird_usernames(self, client: AsyncClient):
        res = await client.post("/api/auth/register", json={"username": "<script>", "password": "secret"})
        assert res.status_code == 422

    async def test_me(self, client: AsyncClient, db_session):
        headers = auth_headers(await create_test_user(db_session, username="meuser"))
        res = await client.get("/api/auth/me", headers=headers)
        assert res.json()["username"] == "meuser"


class TestImportKeepsGroups:
    async def test_roundtrip_preserves_grouping(self, client: AsyncClient, db_session):
        headers = auth_headers(await create_test_user(db_session))
        await log_group(client, headers, group_name="Thali", meal_type="lunch")
        exported = (await client.get("/api/export", headers=headers)).json()

        headers2 = auth_headers(await create_test_user(db_session, username="other"))
        res = await client.put("/api/import", json=exported, headers=headers2)
        assert res.status_code == 200
        meals = (await client.get(f"/api/meals?date={date.today()}", headers=headers2)).json()["meals"]
        assert len(meals) == 1 and meals[0]["is_group"] and meals[0]["name"] == "Thali"


class TestMigration:
    def test_adds_new_columns_to_old_table(self):
        engine = create_engine("sqlite://")
        with engine.begin() as conn:
            conn.exec_driver_sql(
                "CREATE TABLE meals (id INTEGER PRIMARY KEY, user_id INTEGER, meal_date DATE, "
                "name VARCHAR(200), calories FLOAT, protein FLOAT, carbs FLOAT, fat FLOAT, "
                "weight_g FLOAT, group_token VARCHAR(64), created_at DATETIME)"
            )
            conn.exec_driver_sql("INSERT INTO meals (user_id, name, calories) VALUES (1, 'Old', 100)")
            Base.metadata.create_all(conn)
            added = add_missing_columns(conn)
            assert {"meals.meal_type", "meals.group_name", "meals.barcode"} <= set(added)
            cols = {c["name"] for c in inspect(conn).get_columns("meals")}
            assert {"meal_type", "source", "nutri_grade"} <= cols
            assert conn.exec_driver_sql("SELECT name FROM meals").scalar() == "Old"
            assert add_missing_columns(conn) == []


class TestAnalysisNormalization:
    def test_recomputes_totals_and_coerces(self):
        raw = {
            "items": [
                {"name": "Toast", "calories": "120 kcal", "protein": 4, "carbs": 20, "fat": 2},
                {"name": "", "calories": -5, "protein": None, "carbs": 1, "fat": 1, "weight": 30},
                "junk",
            ],
            "total": {"calories": 9999},
            "suggestions": ["Eat", "veg"],
        }
        out = main.normalize_analysis(raw)
        assert out["total"]["calories"] == 120
        assert out["items"][0]["weight_g"] == 0
        assert out["items"][1] == {"name": "Food item", "calories": 0.0, "protein": 0.0,
                                   "carbs": 1.0, "fat": 1.0, "weight_g": 30}
        assert out["suggestions"] == "Eat veg"

    def test_extracts_json_from_prose(self):
        content = 'Sure! Here you go: {"items": [], "suggestions": "ok"} Hope that helps.'
        assert main.extract_json(content)["suggestions"] == "ok"

    def test_fenced_json(self):
        assert main.extract_json('```json\n{"a": 1}\n```') == {"a": 1}


class TestAnalyzeText:
    async def test_estimates_from_description(self, client: AsyncClient, db_session, monkeypatch):
        sent = []

        async def fake_llm(system_prompt, user_content, **kw):
            sent.append(user_content[0]["text"])
            return json.dumps({
                "meal_name": "Dal roti",
                "items": [
                    {"name": "Roti (2)", "calories": 240, "protein": 8, "carbs": 44, "fat": 4, "weight_g": 80},
                    {"name": "Dal tadka (1 bowl)", "calories": "180 kcal", "protein": 9, "carbs": 24, "fat": 6, "weight_g": 200},
                ],
                "total": {"calories": 1},
                "suggestions": "Add a salad.",
            })

        monkeypatch.setattr(main, "call_llm", fake_llm)
        headers = auth_headers(await create_test_user(db_session))
        res = await client.post("/api/analyze/text", headers=headers,
                                json={"text": "2 rotis, 1 bowl dal", "remaining_calories": 900})
        assert res.status_code == 200
        body = res.json()
        assert body["meal_name"] == "Dal roti"
        assert body["total"]["calories"] == 420  # recomputed from items
        assert "2 rotis, 1 bowl dal" in sent[0] and "900 kcal" in sent[0]

    async def test_validation_and_auth(self, client: AsyncClient, db_session):
        headers = auth_headers(await create_test_user(db_session))
        assert (await client.post("/api/analyze/text", headers=headers, json={"text": ""})).status_code == 422
        assert (await client.post("/api/analyze/text", headers=headers, json={"text": "x" * 1001})).status_code == 422
        assert (await client.post("/api/analyze/text", json={"text": "2 rotis"})).status_code in (401, 403)

    async def test_unparseable_ai_reply(self, client: AsyncClient, db_session, monkeypatch):
        async def fake_llm(*a, **kw):
            return "Sounds tasty!"

        monkeypatch.setattr(main, "call_llm", fake_llm)
        headers = auth_headers(await create_test_user(db_session))
        res = await client.post("/api/analyze/text", headers=headers, json={"text": "2 rotis"})
        assert res.status_code == 502
