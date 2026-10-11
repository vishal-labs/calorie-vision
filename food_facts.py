"""
Barcode lookups against Open Food Facts, normalized for the app and cached in the DB.
"""
import json
import re
import datetime
import httpx
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

import nutriscore
from models import ProductCache

OFF_URL = "https://world.openfoodfacts.org/api/v2/product/{code}.json"
OFF_HEADERS = {"User-Agent": "CalorieVision/0.3 (self-hosted personal calorie tracker)"}
OFF_FIELDS = ",".join([
    "code", "product_name", "product_name_en", "generic_name", "brands",
    "image_front_url", "image_front_small_url", "image_url",
    "quantity", "product_quantity", "serving_size", "serving_quantity",
    "nutriments", "nutriscore_grade", "nutriscore_score", "nova_group",
    "categories_tags", "additives_tags", "allergens_tags", "ingredients_analysis_tags",
    "categories", "ingredients_text", "ingredients_text_en", "labels",
])
FOUND_TTL = datetime.timedelta(days=7)
MISSING_TTL = datetime.timedelta(hours=12)

SWEETENER_ADDITIVES = {
    "en:e950", "en:e951", "en:e952", "en:e954", "en:e955", "en:e957",
    "en:e959", "en:e960", "en:e961", "en:e962", "en:e969",
}
NOVA_LABEL = {
    1: "Unprocessed or minimally processed",
    2: "Processed culinary ingredient",
    3: "Processed food",
    4: "Ultra-processed food",
}

BARCODE_RE = re.compile(r"^\d{8,14}$")


def valid_checksum(code: str) -> bool:
    """GS1 mod-10 check digit, shared by EAN-8, UPC-A, EAN-13 and GTIN-14."""
    digits = [int(c) for c in code]
    body, check = digits[:-1], digits[-1]
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return (10 - total % 10) % 10 == check


def normalize_barcode(code: str) -> str:
    code = (code or "").strip()
    if not BARCODE_RE.match(code):
        raise HTTPException(status_code=400, detail="A barcode is 8 to 14 digits.")
    if not valid_checksum(code):
        raise HTTPException(status_code=400, detail="That barcode's check digit is wrong. Scan it again or retype it.")
    # UPC-A (12) is EAN-13 with a leading 0, which is how Open Food Facts stores it.
    return "0" + code if len(code) == 12 else code


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f >= 0 else None


def _nutrients(nm: dict, suffix: str) -> dict:
    g = lambda k: _num(nm.get(f"{k}{suffix}"))  # noqa: E731
    kcal = g("energy-kcal")
    kj = g("energy-kj")
    if kcal is None and kj is not None:
        kcal = kj / 4.184
    if kj is None and kcal is not None:
        kj = kcal * 4.184
    if kj is None and kcal is None and g("energy") is not None:
        kj = g("energy")  # OFF's bare "energy" is kJ
        kcal = kj / 4.184
    salt = g("salt")
    if salt is None and g("sodium") is not None:
        salt = g("sodium") * 2.5
    return {
        "calories": round(kcal, 1) if kcal is not None else None,
        "energy_kj": kj,
        "protein": g("proteins"),
        "carbs": g("carbohydrates"),
        "sugars": g("sugars"),
        "fat": g("fat"),
        "saturated_fat": g("saturated-fat"),
        "fiber": g("fiber"),
        "salt": salt,
    }


def normalize_product(code: str, p: dict) -> dict:
    nm = p.get("nutriments") or {}
    per100 = _nutrients(nm, "_100g")
    serving_g = _num(p.get("serving_quantity"))
    per_serving = None
    if serving_g and per100["calories"] is not None:
        per_serving = {k: (round(v * serving_g / 100, 1) if v is not None else None)
                       for k, v in per100.items() if k != "energy_kj"}

    categories = p.get("categories_tags") or []
    category = nutriscore.detect_category(categories)
    beverage = category in ("beverage", "water")
    additives = p.get("additives_tags") or []
    fvl = _num(nm.get("fruits-vegetables-legumes-estimate-from-ingredients_100g"))
    if fvl is None:
        fvl = _num(nm.get("fruits-vegetables-nuts-estimate-from-ingredients_100g"))

    computed = nutriscore.compute(
        per100, category, fvl_pct=fvl,
        sweeteners=bool(SWEETENER_ADDITIVES & set(additives)),
    )
    off_grade = (p.get("nutriscore_grade") or "").lower()
    if off_grade in nutriscore.GRADES:
        grade, source = off_grade, "openfoodfacts"
        score = p.get("nutriscore_score")
    elif computed:
        grade, source, score = computed["grade"], "estimated", computed["score"]
    else:
        grade, source, score = None, None, None

    breakdown = nutriscore.explain(per100, computed, beverage, per100["calories"])
    nova = p.get("nova_group")
    try:
        nova = int(nova) if nova is not None else None
    except (TypeError, ValueError):
        nova = None

    name = (p.get("product_name") or p.get("product_name_en") or p.get("generic_name") or "").strip()
    brand = (p.get("brands") or "").split(",")[0].strip()
    readable_categories = (p.get("categories") or ", ".join(
        t.split(":", 1)[-1].replace("-", " ") for t in categories)).strip()
    return {
        "barcode": code,
        "name": name or "Unnamed product",
        "brand": brand or None,
        "image_url": p.get("image_front_small_url") or p.get("image_front_url") or p.get("image_url"),
        # Drop the EU "estimated quantity" mark (℮), which OFF often stores as a bare "e".
        "quantity": re.sub(r"\s*(℮|\be)$", "", (p.get("quantity") or "").strip()) or None,
        "package_g": _num(p.get("product_quantity")),
        "serving_size": p.get("serving_size") or None,
        "serving_g": serving_g,
        "is_beverage": beverage,
        "per_100g": {k: (round(v, 2) if v is not None else None) for k, v in per100.items() if k != "energy_kj"},
        "per_serving": per_serving,
        "nutriscore": {
            "grade": grade,
            "score": score,
            "rating": nutriscore.GRADE_RATING.get(grade),
            "label": nutriscore.GRADE_LABEL.get(grade, "Not rated"),
            "source": source,
            "summary": nutriscore.summary_sentence(grade, breakdown["negatives"], breakdown["positives"]),
            "per": breakdown["per"],
            "negatives": breakdown["negatives"],
            "positives": breakdown["positives"],
        },
        "nova": {"group": nova, "label": NOVA_LABEL.get(nova)} if nova else None,
        "additives": [a.split(":", 1)[-1].upper() for a in additives][:20],
        "allergens": [a.split(":", 1)[-1].replace("-", " ") for a in (p.get("allergens_tags") or [])],
        "has_nutrition": per100["calories"] is not None,
        "nutrition_source": "openfoodfacts" if per100["calories"] is not None else None,
        # Context for the AI rating when Open Food Facts has no grade.
        "categories": readable_categories[:400] or None,
        "ingredients": ((p.get("ingredients_text") or p.get("ingredients_text_en") or "").strip()[:1500]) or None,
        "labels": (p.get("labels") or "").strip()[:300] or None,
    }


AI_NUTRIENTS = ("calories", "protein", "carbs", "sugars", "fat", "saturated_fat", "fiber", "salt")


def apply_ai_rating(product: dict, ai: dict) -> dict:
    """Merge a validated AI rating (see main.normalize_product_rating) into a product."""
    product = json.loads(json.dumps(product))  # deep copy
    grade = ai["grade"]
    ns = product["nutriscore"]

    def facts(entries):
        return [{"key": "ai", "label": e["label"], "detail": e.get("detail"), "level": e["level"],
                 "value": None, "unit": "", "points": None, "max_points": None, "share": None}
                for e in entries]

    ns.update({
        "grade": grade,
        "score": None,
        "rating": nutriscore.GRADE_RATING[grade],
        "label": nutriscore.GRADE_LABEL[grade],
        "source": "ai",
        "confidence": ai.get("confidence"),
        "summary": ai["summary"],
        "negatives": facts(ai["negatives"]),
        "positives": facts(ai["positives"]),
    })

    est = ai.get("estimated_per_100g") or {}
    if not product.get("has_nutrition") and est.get("calories"):
        per100 = {k: est.get(k) for k in AI_NUTRIENTS}
        product["per_100g"] = per100
        serving_g = product.get("serving_g")
        product["per_serving"] = (
            {k: (round(v * serving_g / 100, 1) if v is not None else None) for k, v in per100.items()}
            if serving_g else None
        )
        product["has_nutrition"] = True
        product["nutrition_source"] = "ai"
    return product


async def save_product(db: AsyncSession, product: dict) -> None:
    """Persist an updated product (e.g. after AI rating) into the cache row."""
    cached = await db.get(ProductCache, product["barcode"])
    if cached is None:
        cached = ProductCache(barcode=product["barcode"], fetched_at=datetime.datetime.now(datetime.timezone.utc))
        db.add(cached)
    cached.found = True
    cached.payload = json.dumps(product)
    await db.flush()


async def fetch_from_off(code: str) -> dict | None:
    """Returns the raw OFF product, or None if OFF doesn't know the barcode."""
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=OFF_HEADERS) as client:
            res = await client.get(OFF_URL.format(code=code), params={"fields": OFF_FIELDS})
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Couldn't reach Open Food Facts. Check the connection and try again.")
    if res.status_code == 404:
        return None
    if res.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Open Food Facts returned an error ({res.status_code}). Try again shortly.")
    data = res.json()
    if data.get("status") != 1 or not data.get("product"):
        return None
    return data["product"]


async def lookup(db: AsyncSession, raw_code: str) -> dict:
    code = normalize_barcode(raw_code)
    now = datetime.datetime.now(datetime.timezone.utc)
    cached = await db.get(ProductCache, code)
    if cached:
        fetched = cached.fetched_at
        if fetched.tzinfo is None:
            fetched = fetched.replace(tzinfo=datetime.timezone.utc)
        if now - fetched < (FOUND_TTL if cached.found else MISSING_TTL):
            if not cached.found:
                raise HTTPException(status_code=404, detail="Product not found")
            return json.loads(cached.payload)

    raw = await fetch_from_off(code)
    product = normalize_product(code, raw) if raw else None
    if cached is None:
        cached = ProductCache(barcode=code)
        db.add(cached)
    cached.found = product is not None
    cached.payload = json.dumps(product) if product else None
    cached.fetched_at = now
    if product is None:
        await db.commit()  # keep the negative cache entry despite the error response
        raise HTTPException(status_code=404, detail="Product not found")
    await db.flush()
    return product
