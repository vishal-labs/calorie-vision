# Contributing to Calorie Vision

Thanks for helping out. This is a small, self-hosted app, so the bar is simple: keep it working on a phone, keep users' data safe, and leave tests green.

## Set up

You need [uv](https://docs.astral.sh/uv/) and Python 3.14 (uv installs it for you).

```
uv sync --group dev
uv run --group dev playwright install chromium   # once, for the browser tests
echo "OPENROUTER_API_KEY=sk-or-..." > .env       # only needed for real AI calls
```

Run the app against SQLite, so you don't need Postgres or Docker for day-to-day work:

```
DATABASE_URL=sqlite+aiosqlite:///./dev.db uv run uvicorn main:app --reload --port 8765
```

Open http://localhost:8765. The camera works on `localhost`; on a phone it needs https.

To try the production setup (Postgres + the real image): `docker compose up --build`.

## Tests

Run both before opening a pull request:

```
uv run --group dev pytest                                         # backend
uv run --group dev python scripts/e2e.py http://localhost:8765    # browser, needs the app running
```

- `pytest` covers the API, auth, meal grouping, the Nutri-Score maths (checked against real products' official grades), barcode lookups, AI output parsing, and the database migration.
- `scripts/e2e.py` drives the whole app in a phone-sized Chromium and saves screenshots of every screen. It mocks the AI, uses real Open Food Facts lookups, and scans a generated barcode through a fake camera (install `ffmpeg` for the live-camera part).
- **Every new endpoint gets a pytest test. Every new screen or flow gets a step in `e2e.py`.** Look at the screenshots: most UI bugs here are layout bugs that only show up at 390 px wide.
- Never call the real AI from tests. Mock `main.call_llm` in pytest, and the route in Playwright.

## Where things live

| Path | What's there |
|---|---|
| `main.py` | All API routes, AI prompts, goal/macro maths, security headers |
| `auth.py` | Passwords, sessions (JWT), rate limiting |
| `database.py` | DB session, the `DB` dependency, the in-place column migration |
| `models.py` / `schemas.py` | Tables / request and response validation |
| `food_facts.py` | Barcode lookup, Open Food Facts normalization, product cache, merging AI ratings |
| `nutriscore.py` | The 2023 Nutri-Score algorithm and the plain-language reasons |
| `static/` | The whole frontend: `index.html`, `style.css`, `app.js`, `scanner.js`, vendored barcode reader |
| `scripts/e2e.py` | Browser end-to-end test |

## Rules that keep the app working

These come from real bugs. Please don't break them.

**Database**
- Use `db: AsyncSession = DB` in routes, never `Depends(get_db)`. The default scope commits after the response is sent, so the app's next request can read stale data.
- New columns on existing tables must be **nullable**. `create_all()` never alters tables; `add_missing_columns()` adds new nullable columns at startup so existing installs keep their data. Anything else (renames, type changes, backfills) needs a real migration, so discuss it in an issue first.
- Every query that touches user data filters by `current_user.id`.

**Backend**
- All OpenRouter calls go through `call_llm()`. Treat model output as untrusted: validate and clamp it the way `normalize_analysis()` and `normalize_product_rating()` do.
- Dates come from the client (`?date=`, `meal_date`). The server runs in UTC; users don't.
- Errors are messages people read: say what happened and what to do next.

**Frontend**
- No inline `<script>` or `onclick=`. The Content-Security-Policy blocks them. Add a `data-action="..."` attribute and a handler in the `actions` map in `app.js`.
- Anything from a user, the AI or Open Food Facts goes through `esc()` before it touches `innerHTML`.
- Moving from one overlay to another uses `swapLayer` / `{ replace: true }`. Closing returns a promise (`back()`, `closeAll()`); await it before opening something new. This keeps the phone's back button working.
- Don't bump `?v=` in `index.html`. Asset versions are computed automatically.
- Grid containers that hold horizontal scrollers need `grid-template-columns: minmax(0, 1fr)`, or the page scrolls sideways on phones.
- Design tokens live at the top of `style.css`. The macro colours (protein `#199e70`, carbs `#3987e5`, fat `#d55181`) were checked for colour-blind readability **in that order**. Don't reorder or replace them without re-checking.
- Copy is short, plain and in sentence case. Buttons say what happens ("Log 450 kcal", not "Submit").

## Commits and pull requests

- Commit messages follow the existing style: `feat: …`, `fix: …`, `chore: …`, `docs: …`, `test: …`.
- Keep a pull request to one change. Describe what changed and how you tested it, and include before/after screenshots for UI changes.
- Update `README.md` when behaviour or setup changes.
- Never commit `.env`, databases (`*.db`), or real API keys.

## Deploying

There's no CI. The owner deploys by hand on the server:

```
git pull && docker compose up --build -d
```

Data lives in the `pgdata` Docker volume. **Never run `docker compose down -v`**: it deletes every user's data.

## Reporting bugs and ideas

Put bugs in `issues.md` (or a GitHub issue): what you did, what you expected, what happened, and your phone and browser. Feature ideas go in [FUTURE_FEATURES.md](FUTURE_FEATURES.md).
