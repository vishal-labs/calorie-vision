"""
Barcode lookup + Nutri-Score tests. Open Food Facts is mocked; reference
products use their published per-100 g values and official 2023 grades.
"""
import pytest
from httpx import AsyncClient

import food_facts
import nutriscore
from tests.conftest import create_test_user, auth_headers

NUTELLA = {
    "code": "3017620422003",
    "product_name": "Nutella",
    "brands": "Ferrero,Nutella",
    "image_front_small_url": "https://images.openfoodfacts.org/nutella.jpg",
    "quantity": "400 g",
    "product_quantity": "400",
    "serving_size": "15 g",
    "serving_quantity": "15",
    "nutriments": {
        "energy-kcal_100g": 539, "energy-kj_100g": 2252, "fat_100g": 30.9,
        "saturated-fat_100g": 10.6, "carbohydrates_100g": 57.5, "sugars_100g": 56.3,
        "fiber_100g": 3.4, "proteins_100g": 6.3, "salt_100g": 0.107,
    },
    "categories_tags": ["en:spreads", "en:sweet-spreads", "en:hazelnut-spreads"],
    "additives_tags": ["en:e322"],
    "allergens_tags": ["en:milk", "en:nuts", "en:soybeans"],
    "nova_group": 4,
}


class TestNutriScoreAlgorithm:
    def test_nutella_is_e(self):
        n = {"energy_kj": 2252, "sugars": 56.3, "saturated_fat": 10.6, "salt": 0.107,
             "protein": 6.3, "fiber": 3.4, "fat": 30.9}
        r = nutriscore.compute(n, "general")
        assert r["grade"] == "e"
        protein = next(c for c in r["components"] if c["key"] == "protein")
        assert protein["points"] == 0  # not counted: negative points >= 11

    def test_oats_are_a(self):
        n = {"energy_kj": 1550, "sugars": 1.0, "saturated_fat": 1.2, "salt": 0.01,
             "protein": 13, "fiber": 10, "fat": 7}
        assert nutriscore.compute(n, "general")["grade"] == "a"

    def test_cola_is_e(self):
        n = {"energy_kj": 180, "sugars": 10.6, "saturated_fat": 0, "salt": 0, "protein": 0, "fiber": 0}
        assert nutriscore.compute(n, "beverage")["grade"] == "e"

    def test_diet_cola_sweeteners_penalised(self):
        n = {"energy_kj": 1.5, "sugars": 0, "saturated_fat": 0, "salt": 0.02, "protein": 0, "fiber": 0}
        plain = nutriscore.compute(n, "beverage")
        sweet = nutriscore.compute(n, "beverage", sweeteners=True)
        assert plain["grade"] == "b"
        assert sweet["score"] == plain["score"] + 4
        assert sweet["grade"] == "c"

    def test_water_is_a(self):
        assert nutriscore.compute({}, "water")["grade"] == "a"

    def test_olive_oil_is_b(self):
        n = {"energy_kj": 3700, "sugars": 0, "saturated_fat": 14, "salt": 0, "protein": 0,
             "fiber": 0, "fat": 100}
        assert nutriscore.compute(n, "fat", fvl_pct=100)["grade"] == "b"

    def test_alcohol_and_missing_data_not_rated(self):
        assert nutriscore.compute({"energy_kj": 1}, "alcohol") is None
        assert nutriscore.compute({"energy_kj": 100, "sugars": 1}, "general") is None

    def test_category_detection(self):
        assert nutriscore.detect_category(["en:beverages", "en:sodas"]) == "beverage"
        assert nutriscore.detect_category(["en:beverages", "en:waters"]) == "water"
        assert nutriscore.detect_category(["en:dairies", "en:cheeses"]) == "cheese"
        assert nutriscore.detect_category(["en:fats", "en:vegetable-oils"]) == "fat"
        assert nutriscore.detect_category(["en:beverages", "en:wines"]) == "alcohol"
        assert nutriscore.detect_category(["en:snacks"]) == "general"

    @pytest.mark.parametrize("score,grade", [(-3, "a"), (0, "a"), (1, "b"), (2, "b"), (3, "c"),
                                             (10, "c"), (11, "d"), (18, "d"), (19, "e")])
    def test_general_grade_boundaries(self, score, grade):
        assert nutriscore.grade_for(score, "general") == grade


class TestBarcodeValidation:
    @pytest.mark.parametrize("code", ["3017620422003", "5449000000996", "96385074", "036000291452"])
    def test_valid_checksums(self, code):
        assert food_facts.valid_checksum(code)

    def test_upc_a_is_padded_to_ean13(self):
        assert food_facts.normalize_barcode("036000291452") == "0036000291452"

    @pytest.mark.parametrize("code", ["3017620422004", "12345", "abcdefghijkl", ""])
    def test_rejects_bad_codes(self, code):
        with pytest.raises(Exception):
            food_facts.normalize_barcode(code)


class TestNormalizeProduct:
    def test_nutella(self):
        p = food_facts.normalize_product("3017620422003", {**NUTELLA, "nutriscore_grade": "e"})
        assert p["name"] == "Nutella"
        assert p["brand"] == "Ferrero"
        assert p["per_100g"]["calories"] == 539
        assert p["per_serving"]["calories"] == pytest.approx(80.8, abs=0.1)
        ns = p["nutriscore"]
        assert ns["grade"] == "e" and ns["rating"] == 1 and ns["source"] == "openfoodfacts"
        neg_keys = [n["key"] for n in ns["negatives"]]
        assert "sugars" in neg_keys and "saturated_fat" in neg_keys
        assert "sugar" in ns["summary"].lower()
        assert p["nova"]["group"] == 4
        assert p["additives"] == ["E322"]

    def test_estimates_grade_when_off_has_none(self):
        p = food_facts.normalize_product("3017620422003", NUTELLA)
        assert p["nutriscore"]["grade"] == "e"
        assert p["nutriscore"]["source"] == "estimated"

    def test_sodium_and_kj_only(self):
        p = food_facts.normalize_product("3017620422003", {
            "product_name": "Crackers",
            "nutriments": {"energy_100g": 2000, "sodium_100g": 0.4, "sugars_100g": 2,
                           "saturated-fat_100g": 1},
        })
        assert p["per_100g"]["salt"] == pytest.approx(1.0)
        assert p["per_100g"]["calories"] == pytest.approx(478, abs=1)
        assert p["nutriscore"]["grade"] is not None

    def test_no_nutrition(self):
        p = food_facts.normalize_product("3017620422003", {"product_name": "Mystery"})
        assert p["has_nutrition"] is False
        assert p["nutriscore"]["grade"] is None
        assert p["nutriscore"]["label"] == "Not rated"


class TestProductEndpoint:
    async def test_lookup_and_cache(self, client: AsyncClient, db_session, monkeypatch):
        calls = []

        async def fake_fetch(code):
            calls.append(code)
            return NUTELLA

        monkeypatch.setattr(food_facts, "fetch_from_off", fake_fetch)
        headers = auth_headers(await create_test_user(db_session))
        res = await client.get("/api/products/3017620422003", headers=headers)
        assert res.status_code == 200
        assert res.json()["nutriscore"]["grade"] == "e"
        res = await client.get("/api/products/3017620422003", headers=headers)
        assert res.status_code == 200
        assert calls == ["3017620422003"]

    async def test_not_found_is_cached(self, client: AsyncClient, db_session, monkeypatch):
        calls = []

        async def fake_fetch(code):
            calls.append(code)
            return None

        monkeypatch.setattr(food_facts, "fetch_from_off", fake_fetch)
        headers = auth_headers(await create_test_user(db_session))
        for _ in range(2):
            res = await client.get("/api/products/5449000000996", headers=headers)
            assert res.status_code == 404
        assert len(calls) == 1

    async def test_bad_checksum(self, client: AsyncClient, db_session):
        headers = auth_headers(await create_test_user(db_session))
        res = await client.get("/api/products/3017620422004", headers=headers)
        assert res.status_code == 400

    async def test_requires_auth(self, client: AsyncClient):
        res = await client.get("/api/products/3017620422003")
        assert res.status_code in (401, 403)


UNRATED = {
    "product_name": "Masala Peanuts",
    "brands": "Haldiram's",
    "categories": "Snacks, Salty snacks, Peanuts",
    "ingredients_text": "Peanuts, gram flour, vegetable oil, salt, spices",
    "image_front_small_url": "https://images.openfoodfacts.org/x.jpg",
    "serving_quantity": "30",
    "nutriments": {},
}

AI_REPLY = {
    "grade": "D",
    "summary": "Fried and salty, though peanuts bring protein.",
    "negatives": [{"label": "High in salt", "detail": "Seasoned and fried", "level": "high"},
                  {"label": "", "detail": "dropped: no label", "level": "high"}],
    "positives": [{"label": "Good protein", "detail": "From peanuts", "level": "weird"}],
    "estimated_per_100g": {"calories": "540 kcal", "protein": 20, "carbs": 30, "sugars": 3,
                           "fat": 38, "saturated_fat": 6, "fiber": 6, "salt": 2.1},
    "confidence": "medium",
}


class TestAiRating:
    def test_normalize_rating(self):
        import main
        r = main.normalize_product_rating(AI_REPLY)
        assert r["grade"] == "d"
        assert len(r["negatives"]) == 1
        assert r["positives"][0]["level"] == "moderate"
        assert r["estimated_per_100g"]["calories"] == 540

    @pytest.mark.parametrize("bad", [{"grade": "z"}, {"grade": None}, ["not", "a", "dict"]])
    def test_normalize_rejects_bad_grades(self, bad):
        import main
        with pytest.raises(ValueError):
            main.normalize_product_rating(bad)

    async def test_assess_unrated_product(self, client: AsyncClient, db_session, monkeypatch):
        import json
        import main
        llm_calls = []

        async def fake_fetch(code):
            return UNRATED

        async def fake_llm(system_prompt, user_content, **kw):
            llm_calls.append(user_content)
            return json.dumps(AI_REPLY)

        async def no_image(url):
            return None

        monkeypatch.setattr(food_facts, "fetch_from_off", fake_fetch)
        monkeypatch.setattr(main, "call_llm", fake_llm)
        monkeypatch.setattr(main, "fetch_image_b64", no_image)
        headers = auth_headers(await create_test_user(db_session))

        first = (await client.get("/api/products/3017620422003", headers=headers)).json()
        assert first["nutriscore"]["grade"] is None
        assert first["has_nutrition"] is False

        res = await client.post("/api/products/3017620422003/assess", headers=headers)
        assert res.status_code == 200
        rated = res.json()
        assert rated["nutriscore"]["grade"] == "d"
        assert rated["nutriscore"]["source"] == "ai"
        assert rated["nutriscore"]["rating"] == 2
        assert rated["nutriscore"]["negatives"][0]["key"] == "ai"
        assert rated["has_nutrition"] is True
        assert rated["nutrition_source"] == "ai"
        assert rated["per_100g"]["calories"] == 540
        assert rated["per_serving"]["calories"] == pytest.approx(162)
        prompt_text = llm_calls[0][0]["text"]
        assert "Masala Peanuts" in prompt_text and "gram flour" in prompt_text

        # Cached: later lookups and assessments don't call the AI again.
        again = (await client.get("/api/products/3017620422003", headers=headers)).json()
        assert again["nutriscore"]["grade"] == "d"
        await client.post("/api/products/3017620422003/assess", headers=headers)
        assert len(llm_calls) == 1

    async def test_assess_skips_graded_products(self, client: AsyncClient, db_session, monkeypatch):
        import main

        async def fake_fetch(code):
            return {**NUTELLA, "nutriscore_grade": "e"}

        async def boom(*a, **kw):
            raise AssertionError("AI must not be called for graded products")

        monkeypatch.setattr(food_facts, "fetch_from_off", fake_fetch)
        monkeypatch.setattr(main, "call_llm", boom)
        headers = auth_headers(await create_test_user(db_session))
        res = await client.post("/api/products/3017620422003/assess", headers=headers)
        assert res.status_code == 200
        assert res.json()["nutriscore"]["source"] == "openfoodfacts"

    async def test_assess_bad_ai_output(self, client: AsyncClient, db_session, monkeypatch):
        import main

        async def fake_fetch(code):
            return UNRATED

        async def fake_llm(*a, **kw):
            return "I think it's pretty healthy!"

        monkeypatch.setattr(food_facts, "fetch_from_off", fake_fetch)
        monkeypatch.setattr(main, "call_llm", fake_llm)
        monkeypatch.setattr(main, "fetch_image_b64", lambda url: __import__("asyncio").sleep(0))
        headers = auth_headers(await create_test_user(db_session))
        res = await client.post("/api/products/3017620422003/assess", headers=headers)
        assert res.status_code == 502
        product = (await client.get("/api/products/3017620422003", headers=headers)).json()
        assert product["nutriscore"]["grade"] is None

    async def test_assess_requires_auth(self, client: AsyncClient):
        res = await client.post("/api/products/3017620422003/assess")
        assert res.status_code in (401, 403)
