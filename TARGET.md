Here is what i want for as a website. 
1. An application which takes camera permission, and once the frame is set on the plate/food items, it should capture the image process it using gemma-4(add a env variable for the openrouter key) and let me know howmany calories that food item contains
along with the image, i can provide a small description(in an input box below the the live camera preview). so that The LLM can be more accurate on the calorie counting. 
2. Once the image is processed, and i get the calorie count, i should also be able to see the approximate breakdown of carbs, protein, and fats. and approximate weight of the food item
3. This app is only for me(personal use). There is only one thing more in this app, where i can set say 2000 calories per day, and after evey meat/food item that i add, those calories should be reduced from the 2000 limit.(or the limit that i can set in the setting/limit tab).

4. The UI should be minimal, simple, dark themed, easy to navigate and process. I should be able to see the progress of my daily calories intake.

5. The flow should be something like this: 
    1. I open the app. 
    2. I see a button which when clicked, starts camera preview where i can align the meal/food item in it. 
    3. Once aligned, i click a button to capture the image
    4. Once the image is clicked, i can add an optional description about the image
    5. The Optional description + image is sent to the LLM(which already has this system prompt)
    6. The response returned is the breakdown of each item it identifies in the image along with calorie, protein, carbs, fat and at the end, overall Calorie count. If it can, i should give suggestions like "If you can reduce the conumption of X, you can eat Y later" or something like that. 
    7. Finally, when i click Consume Button, it should subsract these calories from the limit that i set already(this limit can be changed dynamically)
6. Handle the memory of the app so that when i come back the next meal, it should be able to remember my new limit and say if i am getting overboard. 

### Technical Architecture
1. Use Python for backend(prefereably FastAPI) with clean simple endpoints. 
2. Use Simple Javascript, HTML, CSS for clean, modern Dark theme. 
3. Use LocalStorage to save the data (limit, consumed, remaining). 
4. Create a env file with an empty string to start with OPENROUTER_API_KEY= so that i can add it. 
5. Write tests to test the working of every button, dynamic variable. Use minimal dependencies as possible.
6. Use the existing UV venv for python development.
7. Prioritise the UI/UX giving constant feedback to the user. while also mantaining smooth operations and transitions between views. 

### Barcode scanning section
Here is what I want along with the current version of the app: A barcode scanner which can read the barcodes of the food items and give the approximate calorie count that are accurate to the actual product. The calorie and label details should be displayed along with the Item Name. 

But here is the additional feature that you have to do, classify the product into A, B, C, D, E (where A is the healthiest and E is the least healthiest). The color code should be Green, Light Green, Yellow, Orange, Red respectively. 
Along with the classification, also give a small description of why the product is classified as such.(I think some country follows this scoring system already) 

1. Breakdown this feature into smaller tasks and build a solid plan and execute it
2. Write tests to verify the progress and integrity of these new features
3. Choose your own method to get the Barcode details, Ig there is some open food labels dataset(live one ig) but feel free to search for existing ones and implement whatever you think is the easiest and best.   


### Database architecture. 
1. I want to move from localStorage to a database architecture. 
2. Where each user will have their own tables, each holding their daily log and preset information.
3. Also, there should be User signup/login feature. 
4. Any other Database schema/tables/features that you feel might be useful, implement those too. 
5. Use proper Database security and authentication, authorization. Make sure it is safe and secure from backend point of view. Like prevention of SQL injection, CSRF, etc..
6. Use RESTful API endpoints for all these features.
7. I want this entire database setup to be in the docker compose file as an other service, meaning once deployed, for the first time, it should setup the database automatically. and set a simple password(example: 'pass') as the default for all the user accounts, but once they try to login, prompt them to change the password. If there is any other better setup/migration setup feel free to implement it. 
8. Write a solid plan and break down this feature into smaller tasks and execute it. Write proper tests to verify the progress and integrity of these new features.
9. Split the entire section into smaller problems, while having a solid plan and tests at every step to check the integrity of the features that are new and existing. 

Finally, Update the Frontend with the required changes that's suitable for mobile view. do a little bit of polishing for the existing UI while keeping the entire UX more user friendly. 

---

## Implementation status (updated 2026-10-11)

Where the build differs from the brief above, the reasons are given.

### Core flow
- [x] Camera preview → capture → optional description → AI breakdown per item (calories, protein, carbs, fat, weight) → total → suggestion → **Log** (the "Consume" step). You can adjust portions, fix or remove items, and add missing ones before logging. Every item stays editable afterwards.
- [x] Model is configurable with `LLM_MODEL` (default `google/gemma-4-31b-it`); the key comes from `OPENROUTER_API_KEY` in `.env`. The model is told your remaining budget, so its suggestion is concrete.
- [x] **Type it in**: for meals you didn't photograph, describe them in one field (items and quantities). The AI fills in each item's macros on the same review screen, and you log it, including to earlier days.
- [x] Fiber tracked alongside protein, carbs and fat (AI estimates it too), with a daily target.
- [x] Logged meals can be moved between breakfast, lunch, dinner and snacks in one tap.
- [x] Calories burned from a watch (Active or Total) and a **Balance** view with net, deficit/surplus and a 7-day chart; weight tracking; favourite meals; moving meals between days.
- [x] Daily limit, set and changed in the **You** tab, with a suggested target from height/weight/age/activity/goal. Today shows calories left, or a clear over-budget state.
- [x] Dark, minimal, mobile-first UI with constant feedback: loading states, toasts with Undo, haptics. Extras: water tracking, meal types, earlier days, Progress charts, My foods.

### Barcode scanning
- [x] Live scanning on Android **and iPhone** (native detector, or a bundled ZXing WebAssembly reader), plus scan-from-photo and typed codes.
- [x] Real product data from **Open Food Facts** (live, cached 7 days): name, brand, image, nutrition per 100 g and per portion.
- [x] **Nutri-Score A–E** in the official green → light green → yellow → orange → red, shown with a rating out of 5. A plain-language reason comes with lists of what to watch out for and the good points. Uses the official grade when OFF has one, otherwise computes it with the 2023 algorithm. If OFF has no grade and not enough nutrition data to compute one, **the AI rates it** (and estimates nutrition per 100 g so it can still be logged), clearly labelled as an AI rating. Also shows NOVA processing level, allergens and additives.

### Database & security
- [x] Moved from localStorage to Postgres (a Docker Compose service, set up automatically on first start). Per-user rows are used instead of per-user tables, which is the standard and safer design.
- [x] Signup/login with bcrypt and JWT; every data endpoint is scoped to the signed-in user.
- [x] SQL injection: ORM-only queries. CSRF: not applicable (bearer tokens, no cookies). Plus a strict Content-Security-Policy, security headers, rate-limited login/reset, input validation with sane bounds, and a session secret that isn't guessable.
- [x] RESTful endpoints; schema changes migrate in place without losing data.
- [ ] Shared default password `pass` for all accounts: **intentionally not done**. A known shared password is a security hole; people create their own account instead. Accounts flagged `must_change_password` are still forced to change it at sign-in.
- [x] Password reset without email: a one-hour code is written to the server log for the owner to hand over (`docker compose logs app | grep "reset code"`).

### Tests
- [x] 160 backend tests (pytest), plus a Playwright end-to-end run (`scripts/e2e.py`) covering every main flow on a phone-sized screen, including a real barcode scan through the camera.
