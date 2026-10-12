"""
End-to-end smoke test in a phone-sized headless Chromium.

Run the app first (any DB), e.g.:
    DATABASE_URL=sqlite+aiosqlite:///./dev.db uv run uvicorn main:app --port 8765
then:
    uv run --group dev python scripts/e2e.py [base_url] [screenshot_dir]

The AI endpoint is mocked in the browser so no OpenRouter credits are used.
Barcode lookups hit the real Open Food Facts API. The barcode reader is tested
with the native BarcodeDetector removed, i.e. the ZXing/WebAssembly path iPhones use,
both from a photo and from a live (fake) camera stream.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import food_facts  # noqa: E402
import main as backend  # noqa: E402

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8765"
SHOTS = Path(sys.argv[2] if len(sys.argv) > 2 else tempfile.mkdtemp(prefix="cv-shots-"))
SHOTS.mkdir(parents=True, exist_ok=True)
NUTELLA = "3017620422003"

# ── EAN-13 rendering ──
L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"]
G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"]
R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"]
PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]


def ean13_svg(code: str, module: int = 4) -> str:
    d = [int(c) for c in code]
    bits = "101"
    for i, digit in enumerate(d[1:7]):
        bits += (L if PARITY[d[0]][i] == "L" else G)[digit]
    bits += "01010"
    for digit in d[7:]:
        bits += R[digit]
    bits += "101"
    quiet = 11 * module
    w = len(bits) * module + 2 * quiet
    h = 70 * module
    rects = "".join(
        f'<rect x="{quiet + i * module}" y="{2 * module}" width="{module}" height="{h - 14 * module}"/>'
        for i, b in enumerate(bits) if b == "1")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f'<rect width="100%" height="100%" fill="#fff"/><g fill="#000">{rects}</g>'
            f'<text x="{w/2}" y="{h - 3*module}" font-family="monospace" font-size="{7*module}" text-anchor="middle">{code}</text></svg>')


def make_assets(browser, workdir: Path):
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.set_content(f'<body style="margin:0;background:#c9c2b5;display:grid;place-items:center;height:100vh">'
                     f'<div style="background:#fff;padding:16px;border-radius:8px">{ean13_svg(NUTELLA, 4)}</div></body>')
    frame_png = workdir / "barcode-frame.png"
    page.screenshot(path=str(frame_png))
    page.close()
    y4m = workdir / "barcode.y4m"
    if shutil.which("ffmpeg"):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", str(frame_png), "-t", "2",
                        "-r", "10", "-pix_fmt", "yuv420p", str(y4m)], check=True)
    return frame_png, (y4m if y4m.exists() else None)


UNRATED_CODE = "8901719123870"
UNRATED_RAW = {
    "product_name": "Parle-G Gold biscuits", "brands": "Parle", "quantity": "250 g", "product_quantity": "250",
    "categories": "Snacks, Sweet snacks, Biscuits", "ingredients_text": "Wheat flour, sugar, edible vegetable oil, invert syrup, milk solids",
    "serving_quantity": "25", "nutriments": {},
}
AI_RATING = {
    "grade": "d", "summary": "Mostly refined flour and sugar with little fibre or protein.",
    "negatives": [{"label": "High in sugar", "detail": "Sugar and invert syrup are main ingredients", "level": "high"},
                  {"label": "Refined flour", "detail": "Little fibre", "level": "moderate"}],
    "positives": [{"label": "Low in salt", "detail": "Mild sweet biscuit", "level": "moderate"}],
    "estimated_per_100g": {"calories": 460, "protein": 7, "carbs": 76, "sugars": 26, "fat": 14,
                           "saturated_fat": 6.5, "fiber": 2, "salt": 0.6},
    "confidence": "medium",
}
UNRATED_PRODUCT = food_facts.normalize_product(UNRATED_CODE, UNRATED_RAW)
RATED_PRODUCT = food_facts.apply_ai_rating(UNRATED_PRODUCT, backend.normalize_product_rating(AI_RATING))

MOCK_ANALYSIS = {
    "meal_name": "Chicken rice bowl",
    "items": [
        {"name": "Grilled chicken", "calories": 280, "protein": 40, "carbs": 0, "fat": 12, "fiber": 0, "weight_g": 150},
        {"name": "Basmati rice", "calories": 260, "protein": 5, "carbs": 56, "fat": 1, "fiber": 2, "weight_g": 200},
        {"name": "Cucumber salad", "calories": 40, "protein": 1, "carbs": 6, "fat": 2, "fiber": 1.5, "weight_g": 80},
    ],
    "total": {"calories": 580, "protein": 46, "carbs": 62, "fat": 15},
    "suggestions": "Swap half the rice for salad and you'd have room for a 150 kcal snack later.",
}


MOCK_TEXT_ANALYSIS = {
    "meal_name": "Dal roti dinner",
    "items": [
        {"name": "Roti (2)", "calories": 240, "protein": 8, "carbs": 44, "fat": 4, "weight_g": 80},
        {"name": "Dal tadka (1 bowl, ~200 g)", "calories": 180, "protein": 9, "carbs": 24, "fat": 6, "weight_g": 200},
        {"name": "Paneer butter masala (100 g)", "calories": 280, "protein": 12, "carbs": 9, "fat": 22, "weight_g": 100},
    ],
    "total": {"calories": 700, "protein": 29, "carbs": 77, "fat": 32},
    "suggestions": "Swapping the paneer curry for a second bowl of dal would save about 100 kcal.",
}


def wait_until(page, js, timeout=8.0):
    # wait_for_function evals a string, which the app's CSP (correctly) forbids.
    end = time.time() + timeout
    while time.time() < end:
        if page.evaluate(js):
            return
        page.wait_for_timeout(100)
    raise TimeoutError(js)


def shot(page, name):
    page.wait_for_timeout(350)
    page.screenshot(path=str(SHOTS / f"{name}.png"))


def main():
    errors = []
    user = f"e2e{int(time.time())}"
    with sync_playwright() as p:
        workdir = Path(tempfile.mkdtemp(prefix="cv-e2e-"))
        boot = p.chromium.launch()
        frame_png, y4m = make_assets(boot, workdir)
        boot.close()

        args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
        if y4m:
            args.append(f"--use-file-for-fake-video-capture={y4m}")
        browser = p.chromium.launch(args=args)
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                  is_mobile=True, has_touch=True, permissions=["camera"])
        # Force the WebAssembly reader (what iOS Safari uses).
        ctx.add_init_script("delete window.BarcodeDetector;")
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.route("**/api/analyze/text", lambda route: route.fulfill(
            status=200, content_type="application/json", body=json.dumps(MOCK_TEXT_ANALYSIS)))
        page.route("**/api/analyze", lambda route: route.fulfill(
            status=200, content_type="application/json", body=json.dumps(MOCK_ANALYSIS)))

        page.goto(BASE, wait_until="networkidle")
        expect(page.locator("#view-auth")).to_be_visible()
        shot(page, "01-auth")

        # Register
        page.click('[data-action="auth-mode"][data-mode="register"]')
        page.fill("#auth-username", user)
        page.fill("#auth-password", "secret123")
        page.click("#auth-submit")
        expect(page.locator("#tab-today")).to_be_visible()
        expect(page.locator("#hero-value")).to_have_text("2,000")
        shot(page, "02-today-empty")

        # Water
        page.click('[data-action="water"][data-ml="250"]')
        expect(page.locator("#water-amount")).to_contain_text("250 /")

        # Add sheet → quick add
        page.click(".tabbar-fab")
        expect(page.locator(".sheet")).to_be_visible()
        shot(page, "03-add-sheet")
        page.click('.sheet [data-action="describe"]')
        page.click('.sheet [data-role="manual"]')  # "Enter them yourself"
        page.fill('.sheet input[name="name"]', "Greek yogurt")
        page.fill('.sheet input[name="calories"]', "150")
        page.fill('.sheet input[name="protein"]', "17")
        page.fill('.sheet input[name="carbs"]', "6")
        page.fill('.sheet input[name="fat"]', "4")
        page.fill('.sheet input[name="fiber"]', "2")
        page.check('.sheet input[name="save_preset"]')
        page.click('.sheet [data-role="save"]')
        expect(page.locator(".meal-row-name", has_text="Greek yogurt")).to_be_visible()
        expect(page.locator("#hero-value")).to_have_text("1,850")
        expect(page.locator("#fiber-row .fiber-val")).to_contain_text("2 / 28 g")

        # Snap a meal (mocked AI)
        page.click(".tabbar-fab")
        page.click('.sheet [data-action="open-camera"]')
        expect(page.locator("#screen-camera")).to_be_visible()
        wait_until(page, "document.getElementById('cam-video').videoWidth > 0")
        shot(page, "04-camera")
        page.click('[data-action="capture"]')
        expect(page.locator("#screen-review")).to_be_visible()
        page.click('#review-hints [data-hint="Homemade"]')
        shot(page, "05-review")
        page.click('[data-action="analyze"]')
        expect(page.locator("#screen-results")).to_be_visible(timeout=10000)
        expect(page.locator("#results-log")).to_have_text("Log 580 kcal")
        page.click('[data-action="result-portion"][data-index="1"][data-step="-0.25"]')
        expect(page.locator("#results-log")).to_have_text("Log 515 kcal")
        page.click('[data-action="result-remove"][data-index="2"]')
        expect(page.locator("#results-log")).to_have_text("Log 475 kcal")
        shot(page, "06-results")
        page.click("#results-log")
        expect(page.locator("#screen-results")).to_be_hidden()
        expect(page.locator(".meal-row-name", has_text="Chicken rice bowl")).to_be_visible()
        expect(page.locator("#hero-value")).to_have_text("1,375")
        # 2 (yogurt) + 1.5 (rice, x0.75) ; salad was removed
        expect(page.locator("#fiber-row .fiber-val")).to_contain_text("4 / 28 g")
        shot(page, "07-today-logged")
        page.screenshot(path=str(SHOTS / "07b-today-full.png"), full_page=True)

        # Edit a single item inside the grouped meal (issues.md)
        page.click('.meal-row:has-text("Chicken rice bowl")')
        expect(page.locator(".sheet .item-list")).to_be_visible()
        shot(page, "08-group-sheet")
        page.click('.sheet [data-role="edit-item"]:has-text("Basmati rice")')
        cal = page.locator('.sheet:last-of-type input[name="calories"]')
        cal.fill("100")
        page.click('.sheet:last-of-type [data-role="save"]')
        expect(page.locator("#hero-value")).to_have_text("1,470")
        page.keyboard.press("Escape")
        expect(page.locator(".sheet")).to_have_count(0)

        # Move a logged meal to another meal type from its sheet (instant, no Save)
        page.click('.meal-row:has-text("Greek yogurt")')
        expect(page.locator(".sheet .meal-mover")).to_be_visible()
        target = page.locator(".sheet .meal-mover .chip:not(.is-on)").first
        label = target.inner_text()
        target.click()
        expect(page.locator(".toast")).to_contain_text(f"Moved to {label}")
        shot(page, "08b-move-meal")
        page.keyboard.press("Escape")
        expect(page.locator(".sheet")).to_have_count(0)
        expect(page.locator(f'section[aria-label="{label}"] .meal-row-name', has_text="Greek yogurt")).to_be_visible()

        # Android-style back closes a sheet; the sheet must fit the phone even
        # with a long "Log again" row (regression: it used to force sideways scrolling)
        page.click(".tabbar-fab")
        expect(page.locator(".sheet")).to_be_visible()
        expect(page.locator(".quick-chip").first).to_be_visible()
        widths = page.evaluate("() => [innerWidth, document.querySelector('.sheet-body').scrollWidth, document.documentElement.scrollWidth]")
        assert widths[1] <= widths[0] and widths[2] <= widths[0], f"add sheet overflows: {widths}"
        page.go_back()
        expect(page.locator(".sheet")).to_have_count(0)

        # Barcode from a photo (ZXing wasm)
        page.click(".tabbar-fab")
        page.click('.sheet [data-action="open-scanner"]')
        expect(page.locator("#screen-scanner")).to_be_visible()
        if y4m:
            # Live fake camera shows the barcode; the scanner should pick it up on its own.
            expect(page.locator("#screen-product")).to_be_visible(timeout=20000)
            print("live camera scan: OK")
        else:
            page.set_input_files("#barcode-photo-input", str(frame_png))
            expect(page.locator("#screen-product")).to_be_visible(timeout=20000)
        expect(page.locator(".product-name")).to_contain_text("Nutella")
        expect(page.locator(".ns-scale .is-on")).to_have_text("e")
        page.wait_for_timeout(1200)  # product photo
        shot(page, "09-product")
        page.screenshot(path=str(SHOTS / "09b-product-full.png"), full_page=True)
        page.locator("#screen-product .screen-body").evaluate("el => el.scrollTop = el.scrollHeight")
        shot(page, "09c-product-bottom")
        page.click('[data-action="product-portion"]:has-text("100 g")')
        expect(page.locator("#product-log")).to_have_text("Log 539 kcal")
        page.click("#product-log")
        expect(page.locator(".meal-row-name", has_text="Nutella")).to_be_visible()

        # Previous day navigation + empty state
        page.click('[data-action="day-prev"]')
        expect(page.locator("#day-label")).to_have_text("Yesterday")
        shot(page, "11-yesterday")

        # Forgot to photograph a meal yesterday: type it, AI fills the macros
        page.click('.empty-day [data-action="describe"]')
        expect(page.locator(".sheet-title")).to_have_text("What did you eat? · Yesterday")
        page.click('.sheet [data-role="go"]')
        expect(page.locator('.sheet [data-role="error"]')).to_be_visible()
        page.fill(".sheet .describe-input", "2 rotis, 1 bowl dal, 100 g paneer butter masala")
        shot(page, "11b-describe")
        page.click('.sheet [data-role="go"]')
        expect(page.locator("#screen-results")).to_be_visible()
        expect(page.locator(".described")).to_contain_text("2 rotis, 1 bowl dal")
        expect(page.locator("#results-log")).to_have_text("Log 700 kcal")
        page.click('[data-action="result-portion"][data-index="2"][data-step="-0.25"]')
        expect(page.locator("#results-log")).to_have_text("Log 630 kcal")
        expect(page.locator("#screen-results .budget-after")).to_contain_text("left yesterday")
        shot(page, "11c-describe-results")
        page.click("#results-log")
        expect(page.locator("#day-label")).to_have_text("Yesterday")
        expect(page.locator(".meal-row-name", has_text="Dal roti dinner")).to_be_visible()
        expect(page.locator("#hero-value")).to_have_text("1,370")
        page.click('[data-action="day-today"]')

        # Progress
        page.click('[data-action="tab"][data-tab="progress"]')
        expect(page.locator("#kcal-chart svg")).to_be_visible()
        page.locator("#kcal-chart .bar-hit").last.dispatch_event("pointerdown")
        shot(page, "12-progress")

        # Foods
        page.click('[data-action="tab"][data-tab="foods"]')
        expect(page.locator(".food-row-name", has_text="Greek yogurt").first).to_be_visible()
        shot(page, "13-foods")
        page.fill("#foods-search", "nutel")
        expect(page.locator(".food-row-name", has_text="Greek yogurt")).to_have_count(0)

        # Profile
        page.click('[data-action="tab"][data-tab="me"]')
        page.fill('#profile-form input[name="height_cm"]', "178")
        page.fill('#profile-form input[name="weight_kg"]', "74")
        page.fill('#profile-form input[name="age"]', "27")
        page.select_option('#profile-form select[name="gender"]', "male")
        page.select_option('#profile-form select[name="activity_level"]', "moderate")
        page.click('#profile-form button[type="submit"]')
        expect(page.locator(".recommend")).to_be_visible()
        shot(page, "14-me")
        page.click('[data-action="use-recommended"]')
        expect(page.locator(".recommend")).to_have_count(0)

        # Session survives reload (token in localStorage)
        page.reload(wait_until="networkidle")
        expect(page.locator("#tab-today")).to_be_visible()

        # Sign out
        page.click('[data-action="tab"][data-tab="me"]')
        page.click('[data-action="sign-out"]')
        expect(page.locator("#view-auth")).to_be_visible()

        # Photo scan + typed barcodes, with a camera that shows no barcode
        # (the barcode video above would be re-detected instantly).
        plain = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
        pctx = plain.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                 is_mobile=True, has_touch=True, permissions=["camera"])
        pctx.add_init_script("delete window.BarcodeDetector;")
        pg = pctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(BASE, wait_until="networkidle")
        pg.fill("#auth-username", user)
        pg.fill("#auth-password", "secret123")
        pg.click("#auth-submit")
        expect(pg.locator("#tab-today")).to_be_visible()
        pg.click(".tabbar-fab")
        pg.click('.sheet [data-action="open-scanner"]')
        expect(pg.locator("#screen-scanner")).to_be_visible()
        pg.set_input_files("#barcode-photo-input", str(frame_png))
        expect(pg.locator("#screen-product")).to_be_visible(timeout=20000)
        expect(pg.locator(".product-name")).to_contain_text("Nutella")
        print("photo scan: OK")
        pg.click('[data-action="rescan"]')
        expect(pg.locator("#screen-scanner")).to_be_visible()
        pg.fill("#barcode-input", "3017620422004")
        pg.click('#barcode-form button[type="submit"]')
        expect(pg.locator(".toast.is-error")).to_be_visible()
        pg.fill("#barcode-input", "5449000000996")
        pg.click('#barcode-form button[type="submit"]')
        expect(pg.locator(".product-name")).to_contain_text("Coca")
        pg.wait_for_timeout(1200)
        shot(pg, "10-product-coke")
        pg.go_back()
        expect(pg.locator("#screen-product")).to_be_hidden()
        # Product without a Nutri-Score → rated by AI (mocked), nutrition estimated
        pg.route(f"**/api/products/{UNRATED_CODE}", lambda route: route.fulfill(
            status=200, content_type="application/json", body=json.dumps(UNRATED_PRODUCT)))

        def slow_assess(route):
            time.sleep(1.5)
            route.fulfill(status=200, content_type="application/json", body=json.dumps(RATED_PRODUCT))
        pg.route(f"**/api/products/{UNRATED_CODE}/assess", slow_assess)
        pg.click(".tabbar-fab")
        pg.click('.sheet [data-action="open-scanner"]')
        pg.fill("#barcode-input", UNRATED_CODE)
        pg.click('#barcode-form button[type="submit"]')
        expect(pg.locator(".score-label")).to_have_text("Rating…")
        shot(pg, "10c-ai-rating-pending")
        expect(pg.locator(".score-label")).to_have_text("Poor · 2/5", timeout=10000)
        expect(pg.locator(".ns-scale .is-on")).to_have_text("d")
        expect(pg.locator(".score-sub")).to_contain_text("rated by AI")
        expect(pg.locator(".fact-name", has_text="High in sugar")).to_be_visible()
        expect(pg.locator("#product-log")).to_have_text("Log 115 kcal")  # 25 g serving x 460 kcal/100 g
        shot(pg, "10d-ai-rated")
        pg.click("#product-log")
        expect(pg.locator(".meal-row-name", has_text="Parle-G")).to_be_visible()

        # Unknown product → helpful fallback
        pg.click(".tabbar-fab")
        pg.click('.sheet [data-action="open-scanner"]')
        pg.fill("#barcode-input", "0000000000000")
        pg.click('#barcode-form button[type="submit"]')
        expect(pg.locator(".notfound")).to_be_visible(timeout=15000)
        shot(pg, "10b-not-found")
        plain.close()

        # Desktop layout glance
        desk = browser.new_page(viewport={"width": 1280, "height": 860})
        desk.goto(BASE, wait_until="networkidle")
        desk.fill("#auth-username", user)
        desk.fill("#auth-password", "secret123")
        desk.click("#auth-submit")
        expect(desk.locator("#tab-today")).to_be_visible()
        desk.wait_for_timeout(500)
        desk.screenshot(path=str(SHOTS / "15-desktop.png"))

        browser.close()

    real_errors = [e for e in errors if "favicon" not in e]
    print("screenshots:", SHOTS)
    print("JS errors:", real_errors or "none")
    return 1 if real_errors else 0


if __name__ == "__main__":
    sys.exit(main())
