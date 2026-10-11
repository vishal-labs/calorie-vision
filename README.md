# Calorie Vision

A self-hosted, phone-first calorie tracker. Snap a meal and an AI model estimates calories and macros per item. Scan a packaged food's barcode and get its nutrition plus a Nutri-Score (A–E, shown as a rating out of 5) with the reasons behind it.

## Run it

1. Put your OpenRouter key in `.env`:
   ```
   OPENROUTER_API_KEY=sk-or-...
   ```
2. `docker compose up --build -d`
3. Open `http://<host>:9670/`. The camera and barcode scanner need **https** on phones (any reverse proxy with TLS works); on plain http you can still upload photos and type barcodes.

Database tables are created on first start. New columns are added in place on later starts, so existing data is kept.

### Optional settings (`.env`)

| Variable | Default | What it does |
|---|---|---|
| `LLM_MODEL` | `google/gemma-4-31b-it` | OpenRouter model used for photo analysis |
| `JWT_SECRET` | random, stored in the DB | Signing key for sessions. Leave unset unless you run several app instances |

### Forgotten passwords

There's no email. "Forgot password" creates a one-hour reset code and writes it to the server log:

```
docker compose logs app | grep "reset code"
```

## Features

- **Today**: calories left, a fuel bar splitting what you've eaten into protein / carbs / fat, macro targets, water, and meals grouped into breakfast, lunch, dinner and snacks. Use the arrows to view or backfill earlier days.
- **Snap a meal**: photo → optional hint → per-item estimate. Adjust portions, fix or remove items, then log. Logged AI meals stay editable item by item.
- **Barcode**: live scanning on Android and iPhone (native `BarcodeDetector`, or the bundled ZXing WebAssembly reader), scanning from a photo, or typing the number. Product data comes from [Open Food Facts](https://world.openfoodfacts.org) and is cached for 7 days. Grades use the official one when available; otherwise they're computed with the 2023 Nutri-Score algorithm (`nutriscore.py`).
- **Progress**: 7- and 30-day charts, average intake, days within budget, streak, macro split.
- **My foods**: saved foods and recently logged foods, logged again in one tap.
- **You**: daily budget (with a suggestion based on your profile), body profile, backups, password.
- Undo on every log and delete. The Android back button closes sheets and screens. Installable as a home-screen app.

## Development

```
uv sync --group dev
DATABASE_URL=sqlite+aiosqlite:///./dev.db uv run uvicorn main:app --reload --port 8765
uv run --group dev pytest                      # API, Nutri-Score, migrations
uv run --group dev playwright install chromium # once
uv run --group dev python scripts/e2e.py http://localhost:8765   # browser end-to-end run
```

The end-to-end script mocks the AI call, uses real Open Food Facts lookups, and checks the WebAssembly barcode reader against a generated barcode, both as a photo and as a live camera feed.
