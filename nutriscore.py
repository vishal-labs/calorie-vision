"""
Nutri-Score (2023 revision) computation and plain-language explanations.

Open Food Facts usually ships an official grade; this module computes one when
it is missing and, in every case, produces the per-nutrient breakdown that
explains *why* a product got its grade.
"""
from bisect import bisect_left

GRADES = ["a", "b", "c", "d", "e"]
GRADE_RATING = {"a": 5, "b": 4, "c": 3, "d": 2, "e": 1}
GRADE_LABEL = {
    "a": "Excellent",
    "b": "Good",
    "c": "Fair",
    "d": "Poor",
    "e": "Bad",
}

# Points = number of thresholds strictly exceeded.
GENERAL = {
    "energy_kj": [335, 670, 1005, 1340, 1675, 2010, 2345, 2680, 3015, 3350],
    "sugars": [3.4, 6.8, 10, 14, 17, 20, 24, 27, 31, 34, 37, 41, 44, 48, 51],
    "saturated_fat": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    "salt": [round(0.2 * i, 1) for i in range(1, 21)],
    "protein": [2.4, 4.8, 7.2, 9.6, 12, 14, 17],
    "fiber": [3.0, 4.1, 5.2, 6.3, 7.4],
}
BEVERAGE = {
    "energy_kj": [30, 90, 150, 210, 240, 270, 300, 330, 360, 390],
    "sugars": [0.5, 2, 3.5, 5, 6, 7, 8, 9, 10, 11],
    "protein": [1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0],
}
FAT_ENERGY_FROM_SATFAT = [120 * i for i in range(1, 11)]
FAT_SATFAT_RATIO = [10, 16, 22, 28, 34, 40, 46, 52, 58, 64]

# UK FSA "traffic light" levels per 100 g (drinks per 100 ml), used for wording.
LEVELS_FOOD = {"fat": (3, 17.5), "saturated_fat": (1.5, 5), "sugars": (5, 22.5), "salt": (0.3, 1.5)}
LEVELS_DRINK = {"fat": (1.5, 8.75), "saturated_fat": (0.75, 2.5), "sugars": (2.5, 11.25), "salt": (0.3, 0.75)}

NUTRIENT_LABEL = {
    "energy_kj": "Calories",
    "sugars": "Sugar",
    "saturated_fat": "Saturated fat",
    "salt": "Salt",
    "sweeteners": "Sweeteners",
    "protein": "Protein",
    "fiber": "Fibre",
    "fvl": "Fruit, veg & legumes",
}


def _points(value: float, thresholds: list[float]) -> int:
    # Number of thresholds strictly below value.
    return bisect_left(thresholds, value)


def _fvl_points(pct: float | None, beverage: bool) -> int:
    if pct is None:
        return 0
    if beverage:
        return 6 if pct > 80 else 4 if pct > 60 else 2 if pct > 40 else 0
    return 5 if pct > 80 else 2 if pct > 60 else 1 if pct > 40 else 0


def detect_category(categories: list[str]) -> str:
    """Map Open Food Facts category tags to a Nutri-Score computation category."""
    tags = set(categories or [])
    if tags & {"en:alcoholic-beverages", "en:wines", "en:beers", "en:spirits"}:
        return "alcohol"
    if tags & {"en:waters", "en:mineral-waters", "en:spring-waters"} and not tags & {
        "en:flavored-waters", "en:sweetened-beverages",
    }:
        return "water"
    if "en:cheeses" in tags:
        return "cheese"
    if tags & {
        "en:fats", "en:vegetable-oils", "en:olive-oils", "en:butters", "en:margarines",
        "en:nuts", "en:seeds", "en:nut-butters", "en:peanut-butters",
    }:
        return "fat"
    if "en:beverages" in tags and not tags & {"en:dairies", "en:yogurts", "en:soups"}:
        return "beverage"
    return "general"


def compute(n: dict, category: str = "general", fvl_pct: float | None = None,
            sweeteners: bool = False) -> dict | None:
    """Compute a 2023 Nutri-Score from per-100 g/ml nutrients.

    `n` keys: energy_kj, sugars, saturated_fat, salt, protein, fiber, fat.
    Returns None when the product is out of scope or core nutrients are missing.
    """
    if category == "alcohol":
        return None
    if category == "water":
        return {"grade": "a", "score": 0, "components": [], "category": category}

    required = ("energy_kj", "sugars", "saturated_fat", "salt")
    if any(n.get(k) is None for k in required):
        return None

    get = lambda k: float(n.get(k) or 0)  # noqa: E731
    beverage = category == "beverage"
    comps: list[dict] = []

    def neg(key, pts, max_pts):
        comps.append({"key": key, "kind": "negative", "points": pts, "max": max_pts})

    def pos(key, pts, max_pts):
        comps.append({"key": key, "kind": "positive", "points": pts, "max": max_pts})

    if category == "fat":
        sat = get("saturated_fat")
        neg("energy_kj", _points(sat * 37, FAT_ENERGY_FROM_SATFAT), 10)
        neg("sugars", _points(get("sugars"), GENERAL["sugars"]), 15)
        fat = get("fat")
        ratio = (sat / fat * 100) if fat > 0 else 0
        neg("saturated_fat", bisect_left(FAT_SATFAT_RATIO, ratio + 1e-9), 10)
        neg("salt", _points(get("salt"), GENERAL["salt"]), 20)
    elif beverage:
        neg("energy_kj", _points(get("energy_kj"), BEVERAGE["energy_kj"]), 10)
        neg("sugars", _points(get("sugars"), BEVERAGE["sugars"]), 10)
        if sweeteners:
            neg("sweeteners", 4, 4)
        neg("saturated_fat", _points(get("saturated_fat"), GENERAL["saturated_fat"]), 10)
        neg("salt", _points(get("salt"), GENERAL["salt"]), 20)
    else:
        neg("energy_kj", _points(get("energy_kj"), GENERAL["energy_kj"]), 10)
        neg("sugars", _points(get("sugars"), GENERAL["sugars"]), 15)
        neg("saturated_fat", _points(get("saturated_fat"), GENERAL["saturated_fat"]), 10)
        neg("salt", _points(get("salt"), GENERAL["salt"]), 20)

    negative = sum(c["points"] for c in comps)

    protein_table = BEVERAGE["protein"] if beverage else GENERAL["protein"]
    protein_pts = _points(get("protein"), protein_table)
    fiber_pts = _points(get("fiber"), GENERAL["fiber"])
    fvl_pts = _fvl_points(fvl_pct, beverage)

    protein_threshold = 7 if category == "fat" else 11
    protein_counted = beverage or category == "cheese" or negative < protein_threshold
    pos("protein", protein_pts if protein_counted else 0, 7)
    pos("fiber", fiber_pts, 5)
    if fvl_pct is not None:
        pos("fvl", fvl_pts, 6 if beverage else 5)

    positive = sum(c["points"] for c in comps if c["kind"] == "positive")
    score = negative - positive
    return {"grade": grade_for(score, category), "score": score,
            "components": comps, "category": category}


def grade_for(score: int, category: str) -> str:
    if category == "beverage":
        return "b" if score <= 2 else "c" if score <= 6 else "d" if score <= 9 else "e"
    if category == "fat":
        return "a" if score <= -6 else "b" if score <= 2 else "c" if score <= 10 else "d" if score <= 18 else "e"
    return "a" if score <= 0 else "b" if score <= 2 else "c" if score <= 10 else "d" if score <= 18 else "e"


def _level(key: str, value: float, beverage: bool) -> str | None:
    table = LEVELS_DRINK if beverage else LEVELS_FOOD
    if key not in table:
        return None
    low, high = table[key]
    return "low" if value <= low else "high" if value > high else "moderate"


def _fmt(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".") if v < 10 else f"{round(v)}"


def explain(n: dict, result: dict | None, beverage: bool, kcal: float | None) -> dict:
    """Build Yuka-style negatives/positives lists and a one-line summary."""
    unit = "100 ml" if beverage else "100 g"
    negatives, positives = [], []
    comps = {c["key"]: c for c in (result or {}).get("components", [])}

    def item(key, value, value_unit, level, comp):
        share = comp["points"] / comp["max"] if comp and comp["max"] else None
        return {
            "key": key,
            "label": NUTRIENT_LABEL.get(key, key),
            "value": value,
            "unit": value_unit,
            "level": level,
            "points": comp["points"] if comp else None,
            "max_points": comp["max"] if comp else None,
            "share": share,
        }

    for key in ("energy_kj", "sugars", "saturated_fat", "salt"):
        v = n.get(key)
        if v is None:
            continue
        comp = comps.get(key)
        if key == "energy_kj":
            value, value_unit = (round(kcal) if kcal is not None else round(v / 4.184)), "kcal"
            share = (comp["points"] / comp["max"]) if comp else 0
            level = "low" if share <= 0.2 else "high" if share >= 0.6 else "moderate"
        else:
            value, value_unit = round(v, 2), "g"
            level = _level(key, v, beverage)
            # Traffic-light levels are lenient for drinks; take the stricter of
            # the two views so the wording matches what drove the grade.
            if comp and comp["max"]:
                share = comp["points"] / comp["max"]
                by_points = "high" if share >= 0.6 else "moderate" if share >= 0.3 else "low"
                rank = {"low": 0, "moderate": 1, "high": 2}
                level = max(level, by_points, key=rank.get)
        entry = item(key, value, value_unit, level, comp)
        (negatives if level in ("moderate", "high") else positives).append(entry)

    if "sweeteners" in comps:
        negatives.append(item("sweeteners", None, "", "high", comps["sweeteners"]))

    for key in ("protein", "fiber"):
        v = n.get(key)
        if v is None:
            continue
        comp = comps.get(key)
        raw_pts = _points(v, (BEVERAGE["protein"] if beverage and key == "protein" else GENERAL[key]))
        level = "high" if raw_pts >= 4 else "moderate" if raw_pts >= 2 else "low"
        if level != "low":
            positives.append(item(key, round(v, 1), "g", level, comp))

    if "fvl" in comps and comps["fvl"]["points"] > 0:
        positives.append(item("fvl", None, "%", "high", comps["fvl"]))

    order = {"high": 0, "moderate": 1, "low": 2}
    negatives.sort(key=lambda e: (order.get(e["level"], 3), -(e["points"] or 0)))
    positives.sort(key=lambda e: (e["level"] != "low", e["points"] or 0), reverse=True)

    return {"per": unit, "negatives": negatives, "positives": positives}


def summary_sentence(grade: str | None, negatives: list[dict], positives: list[dict]) -> str:
    if not grade:
        return "Not enough nutrition data to rate this product."
    bad = [e["label"].lower() for e in negatives if e["level"] == "high"][:2]
    meh = [e["label"].lower() for e in negatives if e["level"] == "moderate"][:2]
    good = [e["label"].lower() for e in positives
            if e["key"] in ("protein", "fiber", "fvl") and e["level"] != "low"][:2]
    joined = lambda xs: " and ".join(xs)  # noqa: E731

    if grade in ("a", "b"):
        s = "A good everyday choice"
        if good:
            s += f", with useful {joined(good)}"
        if bad:
            s += f", though it's high in {joined(bad)}"
        return s + "."
    if grade == "c":
        if bad:
            return f"Fine in moderation. Watch the {joined(bad)}."
        if meh:
            return f"Fine in moderation. It has moderate {joined(meh)}."
        return "Fine in moderation."
    reason = bad or meh
    s = f"Best kept occasional, mainly because of the {joined(reason)}" if reason else "Best kept occasional"
    if good:
        s += f". It does offer some {joined(good)}"
    return s + "."
