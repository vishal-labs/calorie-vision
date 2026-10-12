# Future features

Ideas for what to build next, roughly in priority order. Effort: **S** is an evening, **M** a weekend, **L** longer. Move an item to the "Done" section at the bottom when it ships.

## Next up

| Feature | Why | Effort | Notes |
|---|---|---|---|
| **Weight tracking** | The budget and profile only matter if you can see weight move. | M | New `weight_logs` table (one row per day), a quick "log weight" on You, and a trend line on Progress with a 7-day average to smooth daily noise. Optionally update `weight_kg` on the profile from the latest entry. |
| **Search Open Food Facts by name** | Not everything has a barcode handy ("Amul butter", "Maggi"). | M | Proxy OFF's search API through the backend (cache results), and reuse the product screen for the result. |
| **Photo of a nutrition label** | Products missing from Open Food Facts are the most common dead end after scanning. | M | On "not found", offer "Photograph the label". The AI reads the per-100 g table into the product form, and you confirm before logging. |
| **Save a meal as a favourite** | Many people eat the same breakfast daily. Today only single foods can be saved. | M | Save a grouped meal (all items) to My foods and log it again in one tap. Needs a `preset_items` table or a JSON column. |
| **Copy a day or meal** | "Same lunch as yesterday" should be one tap. | S | "Copy to today" on a meal sheet and on a Progress day. The API already supports batch logging. |
| **Move a meal to another day** | Typed meals are often logged to the wrong day by mistake. Moving between breakfast/lunch/dinner/snacks already works. | S | `meal_date` is already editable in `PATCH /api/meals/{id}`. Add a date picker under "Logged under" in the meal sheet, and a group-level move endpoint. |

## Later

| Feature | Why | Effort | Notes |
|---|---|---|---|
| **"Fix it with AI" on results** | Faster than editing numbers by hand: "the rice was half that" or "no ghee". | M | Send the current items plus the correction to the AI and replace the list. Reuse `/api/analyze/text` with the previous result as context. |
| **Custom macro split** | Protein targets differ for lifting, keto, and so on. | S | Protein g/kg plus fat % in You. `macro_targets()` already takes these as inputs. |
| **Sugar and salt tracking** | Both are already known for barcode products but aren't tracked daily. | M | Same pattern as fiber: nullable `sugars` and `salt` columns on meals and presets (the migration handles it), ask the AI for them, and show them as secondary lines under the macros on Today. |
| **Reminders** | Logging habits stick better with a nudge. | M | Web Push needs a service worker and VAPID keys; iOS supports it only for installed home-screen apps. Opt-in times per meal. |
| **Offline logging** | Logging fails on bad mobile data. | L | Service worker plus a local queue that syncs when back online. Watch out: AI and barcode lookups still need the network. |
| **Weekly summary** | One glance at the week's average, best day and protein hit rate. | S | A card on Progress first. Email or push later. |
| **Recipes** | Home cooking ("my dal recipe, 4 servings"). | L | Ingredients → total → per-serving food saved to My foods. |
| **Share products back to Open Food Facts** | AI ratings and label photos could improve the open database for everyone. | M | OFF has a write API. It needs an OFF account and clear consent per product. |

## Platform and operations

| Item | Why | Effort | Notes |
|---|---|---|---|
| **Proper migrations (Alembic)** | `add_missing_columns()` only handles new nullable columns. | M | Alembic is already a dependency. Add a baseline revision matching today's schema, then run migrations on startup. |
| **Self-serve password reset** | Today the owner reads reset codes from server logs. | M | Optional SMTP settings to email the code, falling back to the log. Or an admin page listing pending resets. |
| **Admin page** | Manage users and see AI usage without touching the database. | M | Needs an `is_admin` flag and role checks. |
| **AI cost and reliability** | One OpenRouter key is a single point of failure (it was revoked once already). | S | Fallback model via `LLM_FALLBACK_MODEL`, a clear in-app message when the key is invalid, and a per-user daily AI call limit. |
| **Shared rate limiting** | The login rate limiter is in memory, per process. | S | Fine for one container. Move it to the database or Redis if the app ever runs more than one worker. |
| **Automated tests in CI** | Catch regressions before they reach the server. | S | GitHub Actions running `pytest` and `scripts/e2e.py` on pull requests only, with no deploy step. |
| **Backups** | Data lives in a single Docker volume. | S | A nightly `pg_dump` to another disk, plus a documented restore. |

## Nice to have

- Light theme (currently dark only, by design).
- Apple Health / Health Connect sync. Needs a native wrapper app, so it's out of scope for a web app.
- Multiple languages, and units (oz/lb, kcal/kJ).
- Accessibility audit with a real screen reader on iOS and Android.
- Barcode history: a list of recently scanned products, including ones you didn't log.

## Done

- Mobile-first rebuild: Today, Progress, My foods, You; undo; back button support; installable app.
- Barcode scanner on Android and iPhone, with Nutri-Score A–E and reasons.
- AI rating for products Open Food Facts can't grade.
- Photo meal analysis with editable items.
- "Type it in": describe a meal and the AI fills in the macros, including for past days.
- Water tracking, meal types, earlier days.
- Fiber tracking with a daily target, everywhere macros appear.
- Move a logged meal between breakfast, lunch, dinner and snacks in one tap.
- Security hardening: auth on AI endpoints, no leaked reset codes, persisted session secret, rate limiting, CSP.
