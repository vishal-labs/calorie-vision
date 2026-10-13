"""
Calories burned / energy balance, weight tracking, favourite meals and moving meals between days.
"""
import datetime
from datetime import date

import pytest
from httpx import AsyncClient

import main
from tests.conftest import create_test_user, auth_headers

TODAY = date.today()
RICE = {"name": "Rice", "calories": 600, "protein": 10, "carbs": 120, "fat": 4}
PROFILE = {"height_cm": 180, "weight_kg": 80, "age": 30, "gender": "male"}  # BMR 1780


async def setup_user(client, db_session, username="testuser"):
    headers = auth_headers(await create_test_user(db_session, username=username))
    return headers


class TestComputeBalance:
    def test_total_logged(self):
        b = main.compute_balance(TODAY, 1800, 0, 2400, 1700, 2000)
        assert b["basis"] == "total"
        assert b["balance"] == -600
        assert b["net"] == -600

    def test_active_with_bmr(self):
        b = main.compute_balance(TODAY, 1800, 500, 0, 1700, 2000)
        assert b["basis"] == "bmr_plus_active"
        assert b["burned"] == 2200
        assert b["balance"] == -400
        assert b["net"] == 1300
        assert b["budget_with_exercise"] == 2500
        assert b["left_with_exercise"] == 700

    def test_active_without_profile(self):
        b = main.compute_balance(TODAY, 1800, 500, 0, None, 2000)
        assert b["basis"] == "active_only"
        assert b["balance"] is None and b["burned"] is None
        assert b["net"] == 1300

    def test_total_wins_over_active(self):
        b = main.compute_balance(TODAY, 2000, 300, 2600, 1700, 2000)
        assert b["basis"] == "total" and b["burned"] == 2600

    def test_nothing_logged(self):
        b = main.compute_balance(TODAY, 900, 0, 0, 1700, 2000)
        assert b["basis"] == "none" and b["balance"] is None and b["net"] == 900


class TestActivityAndBalance:
    async def test_log_edit_delete_and_balance(self, client: AsyncClient, db_session):
        headers = await setup_user(client, db_session)
        await client.put("/api/profile", json=PROFILE, headers=headers)
        await client.post("/api/meals", json={**RICE, "meal_date": TODAY.isoformat()}, headers=headers)

        res = await client.post("/api/activity", headers=headers, json={
            "calories": 450, "kind": "active", "source": "apple_watch", "note": "  Evening run ",
            "log_date": TODAY.isoformat()})
        assert res.status_code == 201
        entry = res.json()
        assert entry["note"] == "Evening run"

        bal = (await client.get(f"/api/balance?date={TODAY}", headers=headers)).json()
        assert bal["eaten"] == 600 and bal["active"] == 450
        assert bal["basis"] == "bmr_plus_active"
        assert bal["burned"] == 1780 + 450
        assert bal["balance"] == 600 - 2230
        assert bal["left_with_exercise"] == 2000 + 450 - 600
        assert len(bal["entries"]) == 1

        res = await client.patch(f"/api/activity/{entry['id']}", headers=headers, json={"calories": 2500, "kind": "total"})
        assert res.json()["kind"] == "total"
        bal = (await client.get(f"/api/balance?date={TODAY}", headers=headers)).json()
        assert bal["basis"] == "total" and bal["balance"] == -1900

        assert (await client.delete(f"/api/activity/{entry['id']}", headers=headers)).status_code == 200
        bal = (await client.get(f"/api/balance?date={TODAY}", headers=headers)).json()
        assert bal["basis"] == "none" and bal["entries"] == []

    async def test_validation_and_ownership(self, client: AsyncClient, db_session):
        h1 = await setup_user(client, db_session, "a")
        h2 = await setup_user(client, db_session, "b")
        for bad in ({"calories": 0}, {"calories": 20000}, {"calories": 300, "kind": "resting"},
                    {"calories": 300, "source": "garmin2"}):
            assert (await client.post("/api/activity", headers=h1, json=bad)).status_code == 422
        entry = (await client.post("/api/activity", headers=h1, json={"calories": 300})).json()
        assert (await client.patch(f"/api/activity/{entry['id']}", headers=h2, json={"calories": 1})).status_code == 404
        assert (await client.delete(f"/api/activity/{entry['id']}", headers=h2)).status_code == 404
        bal = (await client.get(f"/api/balance?date={TODAY}", headers=h2)).json()
        assert bal["active"] == 0

    async def test_history(self, client: AsyncClient, db_session):
        headers = await setup_user(client, db_session)
        end = date(2026, 5, 10)
        d1, d2, old = end - datetime.timedelta(days=1), end, end - datetime.timedelta(days=30)
        await client.post("/api/meals", json={**RICE, "meal_date": d1.isoformat()}, headers=headers)
        await client.post("/api/activity", headers=headers, json={"calories": 2300, "kind": "total", "log_date": d1.isoformat()})
        await client.post("/api/activity", headers=headers, json={"calories": 400, "log_date": d2.isoformat()})
        await client.post("/api/activity", headers=headers, json={"calories": 400, "log_date": old.isoformat()})
        days = (await client.get(f"/api/balance/history?days=7&end={end}", headers=headers)).json()["days"]
        assert [d["date"] for d in days] == [d1.isoformat(), d2.isoformat()]
        assert days[0]["balance"] == 600 - 2300
        assert days[1]["eaten"] == 0 and days[1]["basis"] == "active_only"


class TestWeight:
    async def test_log_trend_and_profile(self, client: AsyncClient, db_session):
        headers = await setup_user(client, db_session)
        await client.put("/api/profile", json={"height_cm": 180, "weight_kg": 85}, headers=headers)
        base = date(2026, 5, 1)
        for i, kg in enumerate([82.0, 81.6, 81.8, 81.2, 81.0, 80.8, 80.6, 80.4]):
            res = await client.put("/api/weight", headers=headers,
                                   json={"weight_kg": kg, "log_date": (base + datetime.timedelta(days=i)).isoformat()})
            assert res.status_code == 200
        hist = (await client.get(f"/api/weight?days=30&end={base + datetime.timedelta(days=7)}", headers=headers)).json()
        assert len(hist["entries"]) == 8
        assert hist["latest"]["weight_kg"] == 80.4
        # trend on day 8 = mean of days 2..8
        assert hist["latest"]["trend_kg"] == pytest.approx(sum([81.6, 81.8, 81.2, 81.0, 80.8, 80.6, 80.4]) / 7, abs=0.01)
        assert hist["change_7d"] < 0 and hist["change_range"] < 0
        # The newest weigh-in became the profile weight, and BMI followed
        profile = (await client.get("/api/profile", headers=headers)).json()
        assert profile["weight_kg"] == 80.4
        assert profile["bmi"] == round(80.4 / 1.8 ** 2, 1)

    async def test_upsert_backdate_and_delete(self, client: AsyncClient, db_session):
        headers = await setup_user(client, db_session)
        await client.put("/api/weight", headers=headers, json={"weight_kg": 75, "log_date": "2026-05-10"})
        await client.put("/api/weight", headers=headers, json={"weight_kg": 74.5, "log_date": "2026-05-10"})
        # A back-dated weigh-in must not overwrite the current profile weight
        await client.put("/api/weight", headers=headers, json={"weight_kg": 77, "log_date": "2026-05-01"})
        hist = (await client.get("/api/weight?days=30&end=2026-05-10", headers=headers)).json()
        assert [e["weight_kg"] for e in hist["entries"]] == [77, 74.5]
        assert (await client.get("/api/profile", headers=headers)).json()["weight_kg"] == 74.5
        assert (await client.delete("/api/weight/2026-05-01", headers=headers)).status_code == 200
        assert (await client.delete("/api/weight/2026-05-01", headers=headers)).status_code == 404
        assert (await client.put("/api/weight", headers=headers, json={"weight_kg": 5})).status_code == 422


class TestFavouriteMeals:
    async def test_preset_with_items(self, client: AsyncClient, db_session):
        headers = await setup_user(client, db_session)
        res = await client.post("/api/presets", headers=headers, json={
            "name": "Usual breakfast", "calories": 0,
            "items": [{"name": "Oats", "calories": 300, "protein": 10, "carbs": 54, "fat": 6, "fiber": 8, "weight_g": 80},
                      {"name": "Banana", "calories": 105, "protein": 1.3, "carbs": 27, "fat": 0.4, "fiber": 3.1}]})
        assert res.status_code == 201
        preset = res.json()
        assert preset["calories"] == 405 and preset["fiber"] == 11.1
        assert [i["name"] for i in preset["items"]] == ["Oats", "Banana"]
        listed = (await client.get("/api/presets", headers=headers)).json()
        assert len(listed[0]["items"]) == 2

        exported = (await client.get("/api/export", headers=headers)).json()
        h2 = await setup_user(client, db_session, "other")
        assert (await client.put("/api/import", headers=h2, json=exported)).status_code == 200
        assert len((await client.get("/api/presets", headers=h2)).json()[0]["items"]) == 2

    async def test_single_food_preset_has_no_items(self, client: AsyncClient, db_session):
        headers = await setup_user(client, db_session)
        res = await client.post("/api/presets", headers=headers, json={"name": "Apple", "calories": 95})
        assert res.json()["items"] is None


class TestMoveMealDay:
    async def test_move_group_and_single(self, client: AsyncClient, db_session):
        headers = await setup_user(client, db_session)
        yesterday = (TODAY - datetime.timedelta(days=1)).isoformat()
        await client.post("/api/meals/batch", headers=headers, json={"meals": [
            {**RICE, "meal_date": TODAY.isoformat()}, {"name": "Dal", "calories": 150, "meal_date": TODAY.isoformat()}]})
        single = (await client.post("/api/meals", headers=headers, json={**RICE, "name": "Apple"})).json()
        group = next(m for m in (await client.get(f"/api/meals?date={TODAY}", headers=headers)).json()["meals"] if m["is_group"])

        assert (await client.patch(f"/api/meals/groups/{group['group_token']}", headers=headers,
                                   json={"meal_date": yesterday})).status_code == 200
        assert (await client.patch(f"/api/meals/{single['id']}", headers=headers,
                                   json={"meal_date": yesterday})).status_code == 200
        assert (await client.get(f"/api/meals?date={TODAY}", headers=headers)).json()["meals"] == []
        moved = (await client.get(f"/api/meals?date={yesterday}", headers=headers)).json()
        assert moved["total_calories"] == 600 + 150 + 600


class TestBackupRoundtrip:
    async def test_activity_and_weight(self, client: AsyncClient, db_session):
        headers = await setup_user(client, db_session)
        await client.post("/api/activity", headers=headers, json={"calories": 520, "kind": "active", "source": "fitbit"})
        await client.put("/api/weight", headers=headers, json={"weight_kg": 72.3})
        exported = (await client.get("/api/export", headers=headers)).json()
        assert exported["activity"][0]["calories"] == 520 and exported["weight"][0]["weight_kg"] == 72.3

        h2 = await setup_user(client, db_session, "restore")
        assert (await client.put("/api/import", headers=h2, json=exported)).status_code == 200
        assert (await client.get(f"/api/balance?date={TODAY}", headers=h2)).json()["active"] == 520
        assert (await client.get("/api/weight", headers=h2)).json()["latest"]["weight_kg"] == 72.3

        bad = {"activity": [{"calories": -5}]}
        assert (await client.put("/api/import", headers=h2, json=bad)).status_code == 400
