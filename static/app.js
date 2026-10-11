/* ═══════════════════════════════════════════════
   Calorie Vision — app logic
   ═══════════════════════════════════════════════ */

(function () {
    "use strict";

    // ══════════════════════════════════════════
    // UTILITIES
    // ══════════════════════════════════════════
    const $ = (id) => document.getElementById(id);
    const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
    const fmt = (n) => Math.round(Number(n) || 0).toLocaleString();
    const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };
    const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
    const vibrate = (ms = 12) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) { /* unsupported */ } };

    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } },
        del(k) { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } },
    };

    function isoDate(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    const todayIso = () => isoDate(new Date());
    function addDays(iso, n) {
        const d = new Date(`${iso}T12:00:00`);
        d.setDate(d.getDate() + n);
        return isoDate(d);
    }
    function dayLabel(iso, long = false) {
        if (iso === todayIso()) return "Today";
        if (iso === addDays(todayIso(), -1)) return "Yesterday";
        const d = new Date(`${iso}T12:00:00`);
        return d.toLocaleDateString(undefined, long
            ? { weekday: "long", day: "numeric", month: "long" }
            : { weekday: "short", day: "numeric", month: "short" });
    }

    const MEAL_TYPES = [
        { key: "breakfast", label: "Breakfast" },
        { key: "lunch", label: "Lunch" },
        { key: "dinner", label: "Dinner" },
        { key: "snack", label: "Snacks" },
    ];
    function guessMealType(d = new Date()) {
        const h = d.getHours() + d.getMinutes() / 60;
        if (h >= 4.5 && h < 10.5) return "breakfast";
        if (h >= 11.5 && h < 15.5) return "lunch";
        if (h >= 18 && h < 22.5) return "dinner";
        return "snack";
    }
    function mealTypeOf(meal) {
        if (meal.meal_type) return meal.meal_type;
        return meal.created_at ? guessMealType(new Date(meal.created_at)) : "snack";
    }

    // ══════════════════════════════════════════
    // STATE
    // ══════════════════════════════════════════
    const state = {
        token: store.get("cv_token"),
        username: store.get("cv_username"),
        tab: "today",
        date: todayIso(),
        day: null,
        water: null,
        goals: null,
        profile: null,
        range: 7,
        recent: [],
        presets: [],
        foodsQuery: "",
        addMealType: null,
        photo: null,
        analysis: null,
        product: null,
    };

    // ══════════════════════════════════════════
    // API
    // ══════════════════════════════════════════
    class ApiError extends Error {
        constructor(message, status) { super(message); this.status = status; }
    }

    const FIELD_NAMES = { name: "Name", calories: "Calories", protein: "Protein", carbs: "Carbs", fat: "Fat",
        weight_g: "Weight", username: "Username", password: "Password", new_password: "New password",
        daily_calories: "Budget", height_cm: "Height", weight_kg: "Weight", age: "Age" };

    function errorMessage(data, status) {
        const d = data && data.detail;
        if (typeof d === "string") return d;
        if (Array.isArray(d) && d.length) {
            const e = d[0];
            const field = e.loc && e.loc[e.loc.length - 1];
            const msg = String(e.msg || "is invalid").replace(/^Value error, /, "");
            if (field === "username" && /pattern/i.test(msg)) return "Usernames can use letters, numbers and . _ - @";
            return field && FIELD_NAMES[field] ? `${FIELD_NAMES[field]}: ${msg.charAt(0).toLowerCase()}${msg.slice(1)}` : msg;
        }
        if (status === 429) return "Too many attempts. Wait a few minutes and try again.";
        return status >= 500 ? "The server hit an error. Try again." : "That request didn't work. Try again.";
    }

    async function api(method, path, body, { signal } = {}) {
        const headers = {};
        if (body !== undefined) headers["Content-Type"] = "application/json";
        if (state.token) headers.Authorization = `Bearer ${state.token}`;
        let res;
        try {
            res = await fetch(path, { method, headers, signal, body: body !== undefined ? JSON.stringify(body) : undefined });
        } catch (e) {
            if (e.name === "AbortError") throw e;
            throw new ApiError("Can't reach the server. Check your connection.", 0);
        }
        let data = null;
        try { data = await res.json(); } catch (_) { /* empty body */ }
        if (res.status === 401 && state.token && !path.startsWith("/api/auth/")) {
            signOut();
            throw new ApiError("Your session ended. Sign in again.", 401);
        }
        if (!res.ok) throw new ApiError(errorMessage(data, res.status), res.status);
        return data;
    }
    const get = (p, o) => api("GET", p, undefined, o);
    const post = (p, b, o) => api("POST", p, b, o);
    const put = (p, b) => api("PUT", p, b);
    const patch = (p, b) => api("PATCH", p, b);
    const del = (p) => api("DELETE", p);

    // ══════════════════════════════════════════
    // TOASTS
    // ══════════════════════════════════════════
    function toast(message, { error = false, action, onAction, duration } = {}) {
        const el = document.createElement("div");
        el.className = "toast" + (error ? " is-error" : "");
        el.setAttribute("role", error ? "alert" : "status");
        el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action)}</button>` : ""}`;
        const remove = () => { el.classList.add("is-out"); setTimeout(() => el.remove(), 220); };
        if (action) {
            el.querySelector("button").addEventListener("click", () => { remove(); onAction && onAction(); });
        }
        // One message at a time: the newest replaces whatever is showing.
        $("toasts").querySelectorAll(".toast").forEach((t) => t.remove());
        $("toasts").appendChild(el);
        setTimeout(remove, duration || (action ? 5500 : error ? 4500 : 2600));
    }
    const toastError = (e) => { if (e && e.name !== "AbortError") toast(e.message || String(e), { error: true }); };

    function setBusy(btn, busy) {
        if (!btn) return;
        btn.disabled = busy;
        btn.classList.toggle("is-busy", busy);
    }

    // ══════════════════════════════════════════
    // LAYERS (screens + sheets), wired to browser history so Back closes them
    // ══════════════════════════════════════════
    const layers = [];
    let pendingPops = 0;
    const popWaiters = [];

    function openLayer(name, close) {
        layers.push({ name, close });
        history.pushState({ cvLayer: layers.length }, "");
        syncBodyLock();
    }
    function swapLayer(name, close) {
        const top = layers.pop();
        if (top) top.close();
        layers.push({ name, close });
        history.replaceState({ cvLayer: layers.length }, "");
        syncBodyLock();
    }
    function closeLayers(n = 1) {
        n = Math.min(n, layers.length);
        if (!n) return Promise.resolve();
        for (let i = 0; i < n; i++) layers.pop().close();
        syncBodyLock();
        return new Promise((resolve) => {
            pendingPops++;
            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };
            popWaiters.push(finish);
            setTimeout(finish, 500);
            history.go(-n);
        });
    }
    const back = () => closeLayers(1);
    const closeAll = () => closeLayers(layers.length);
    const topLayer = () => layers[layers.length - 1];

    window.addEventListener("popstate", () => {
        if (pendingPops > 0) {
            pendingPops--;
            const w = popWaiters.shift();
            if (w) w();
            return;
        }
        const top = layers.pop();
        if (top) top.close();
        syncBodyLock();
    });

    function syncBodyLock() {
        document.body.classList.toggle("is-locked", layers.length > 0);
        document.body.classList.toggle("has-screen", layers.some((l) => l.name.startsWith("screen:")));
    }

    function showScreen(id) { $(id).hidden = false; }
    function hideScreen(id) { $(id).hidden = true; }

    function openScreen(id, { replace = false, onClose } = {}) {
        const close = () => { hideScreen(id); onClose && onClose(); };
        (replace ? swapLayer : openLayer)(`screen:${id}`, close);
        showScreen(id);
        const body = $(id).querySelector(".screen-body");
        if (body) body.scrollTop = 0;
    }

    // ── Sheets ──
    function openSheet({ title, body, foot = "", onMount, onClose, replace = false, label }) {
        const backdrop = document.createElement("div");
        backdrop.className = "sheet-backdrop";
        const sheet = document.createElement("div");
        sheet.className = "sheet";
        sheet.setAttribute("role", "dialog");
        sheet.setAttribute("aria-modal", "true");
        sheet.setAttribute("aria-label", label || title || "Dialog");
        sheet.innerHTML = `
            <div class="sheet-grip" aria-hidden="true"></div>
            ${title !== undefined ? `<div class="sheet-head"><h2 class="sheet-title">${esc(title)}</h2>
                <button class="icon-btn" data-action="back" aria-label="Close">${icon("close")}</button></div>` : ""}
            <div class="sheet-body">${body}</div>
            ${foot ? `<div class="sheet-foot">${foot}</div>` : ""}`;
        const root = $("sheets");
        root.appendChild(backdrop);
        root.appendChild(sheet);
        backdrop.addEventListener("click", () => { if (topLayer() && topLayer().sheet === sheet) back(); });

        const close = () => {
            sheet.classList.add("is-closing");
            backdrop.classList.add("is-closing");
            setTimeout(() => { sheet.remove(); backdrop.remove(); }, 200);
            onClose && onClose();
        };
        (replace ? swapLayer : openLayer)("sheet", close);
        layers[layers.length - 1].sheet = sheet;
        if (onMount) onMount(sheet);
        const focusable = sheet.querySelector("[autofocus]");
        if (focusable) setTimeout(() => focusable.focus(), 280);
        return sheet;
    }

    function confirmSheet({ title, message, confirm = "Confirm", danger = false }) {
        return new Promise((resolve) => {
            let answered = false;
            openSheet({
                title,
                body: `<p style="margin:0;color:var(--ink-2)">${esc(message)}</p>`,
                foot: `<button class="btn btn-secondary btn-grow" data-role="no">Cancel</button>
                       <button class="btn ${danger ? "btn-danger" : "btn-primary"} btn-grow" data-role="yes">${esc(confirm)}</button>`,
                onMount(el) {
                    el.querySelector('[data-role="no"]').addEventListener("click", () => back());
                    el.querySelector('[data-role="yes"]').addEventListener("click", async () => {
                        answered = true;
                        await back();
                        resolve(true);
                    });
                },
                onClose() { if (!answered) resolve(false); },
            });
        });
    }

    // ══════════════════════════════════════════
    // AUTH
    // ══════════════════════════════════════════
    let authMode = "login";

    function setAuth(token, username) {
        state.token = token;
        state.username = username;
        store.set("cv_token", token);
        store.set("cv_username", username);
    }

    function showAuth(panel = "main") {
        $("tabs").hidden = true;
        $("view-auth").hidden = false;
        $("auth-main").hidden = panel !== "main";
        $("auth-reset").hidden = panel !== "reset";
        $("auth-change").hidden = panel !== "change";
        if (panel === "reset") {
            $("reset-username").value = $("auth-username").value.trim();
            $("reset-form").hidden = true;
            $("reset-msg").hidden = true;
        }
    }

    function setAuthMode(mode) {
        authMode = mode;
        document.querySelectorAll('[data-action="auth-mode"]').forEach((b) => {
            const on = b.dataset.mode === mode;
            b.classList.toggle("is-on", on);
            b.setAttribute("aria-selected", String(on));
        });
        $("auth-title").textContent = mode === "login" ? "Welcome back" : "Start tracking";
        $("auth-sub").textContent = mode === "login"
            ? "Sign in to keep logging."
            : "Create an account. Your meals stay private to you.";
        $("auth-submit").textContent = mode === "login" ? "Sign in" : "Create account";
        $("auth-password").setAttribute("autocomplete", mode === "login" ? "current-password" : "new-password");
        $("auth-error").hidden = true;
    }

    async function submitAuth(e) {
        e.preventDefault();
        const username = $("auth-username").value.trim();
        const password = $("auth-password").value;
        const err = $("auth-error");
        err.hidden = true;
        if (!username || !password) { err.textContent = "Enter a username and password."; err.hidden = false; return; }
        if (authMode === "register" && password.length < 4) {
            err.textContent = "Use at least 4 characters for the password."; err.hidden = false; return;
        }
        const btn = $("auth-submit");
        setBusy(btn, true);
        try {
            const data = await post(`/api/auth/${authMode === "login" ? "login" : "register"}`, { username, password });
            setAuth(data.token, data.username);
            $("auth-password").value = "";
            if (data.must_change_password) {
                $("change-old").value = password;
                showAuth("change");
            } else {
                await enterApp();
            }
        } catch (ex) {
            err.textContent = ex.message;
            err.hidden = false;
        } finally {
            setBusy(btn, false);
        }
    }

    async function submitResetRequest(e) {
        e.preventDefault();
        const username = $("reset-username").value.trim();
        if (!username) return;
        const btn = e.submitter || e.target.querySelector("button");
        setBusy(btn, true);
        try {
            const data = await post("/api/auth/forgot-password", { username });
            $("reset-msg").textContent = data.message;
            $("reset-msg").hidden = false;
            $("reset-form").hidden = false;
            $("reset-code").focus();
        } catch (ex) {
            $("reset-msg").textContent = ex.message;
            $("reset-msg").hidden = false;
        } finally {
            setBusy(btn, false);
        }
    }

    async function submitReset(e) {
        e.preventDefault();
        const btn = e.submitter || e.target.querySelector("button");
        setBusy(btn, true);
        try {
            await post("/api/auth/reset-password", {
                username: $("reset-username").value.trim(),
                reset_token: $("reset-code").value.trim(),
                new_password: $("reset-password").value,
            });
            $("auth-username").value = $("reset-username").value.trim();
            showAuth("main");
            setAuthMode("login");
            toast("Password updated. Sign in with the new one.");
            $("auth-password").focus();
        } catch (ex) {
            $("reset-msg").textContent = ex.message;
            $("reset-msg").hidden = false;
        } finally {
            setBusy(btn, false);
        }
    }

    async function submitChange(e) {
        e.preventDefault();
        const err = $("change-error");
        err.hidden = true;
        const btn = e.submitter || e.target.querySelector("button");
        setBusy(btn, true);
        try {
            await put("/api/auth/change-password", { old_password: $("change-old").value, new_password: $("change-new").value });
            $("change-old").value = "";
            $("change-new").value = "";
            await enterApp();
            toast("Password saved");
        } catch (ex) {
            err.textContent = ex.message;
            err.hidden = false;
        } finally {
            setBusy(btn, false);
        }
    }

    function signOut() {
        state.token = null;
        state.username = null;
        store.del("cv_token");
        store.del("cv_username");
        stopAllCameras();
        while (layers.length) layers.pop().close();
        syncBodyLock();
        state.day = state.goals = state.profile = state.water = null;
        setAuthMode("login");
        showAuth("main");
    }

    async function enterApp() {
        $("view-auth").hidden = true;
        $("tabs").hidden = false;
        state.date = todayIso();
        switchTab("today");
        await refreshAll();
    }

    // ══════════════════════════════════════════
    // DATA
    // ══════════════════════════════════════════
    async function loadGoals() {
        state.goals = await get("/api/goals");
        return state.goals;
    }

    async function refreshDay() {
        const date = state.date;
        const [day, water] = await Promise.all([
            get(`/api/meals?date=${date}`),
            get(`/api/water?date=${date}`),
        ]);
        if (date !== state.date) return; // user moved on
        state.day = day;
        state.water = water;
        renderToday();
    }

    async function refreshAll() {
        try {
            await Promise.all([loadGoals(), refreshDay()]);
            renderToday();
        } catch (e) { toastError(e); }
    }

    // ══════════════════════════════════════════
    // TABS
    // ══════════════════════════════════════════
    function switchTab(tab) {
        state.tab = tab;
        ["today", "progress", "foods", "me"].forEach((t) => { $(`tab-${t}`).hidden = t !== tab; });
        document.querySelectorAll(".tabbar-btn").forEach((b) => {
            const on = b.dataset.tab === tab;
            b.classList.toggle("is-on", on);
            if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
        });
        window.scrollTo(0, 0);
        if (tab === "progress") renderProgress();
        if (tab === "foods") renderFoods(true);
        if (tab === "me") renderMe();
        if (tab === "today" && state.day) refreshDay().catch(toastError);
    }

    // ══════════════════════════════════════════
    // TODAY
    // ══════════════════════════════════════════
    function renderToday() {
        $("day-label").textContent = dayLabel(state.date, true);
        $("day-next").disabled = state.date >= todayIso();
        renderHero();
        renderWater();
        renderMealSections();
    }

    function renderHero() {
        const hero = $("hero");
        const goals = state.goals;
        const day = state.day;
        if (!goals || !day) {
            $("hero-value").innerHTML = '<span class="skel" style="display:inline-block;width:3.2ch;height:0.8em"></span>';
            return;
        }
        const budget = goals.calories;
        const eaten = day.total_calories;
        const left = budget - eaten;
        const over = left < 0;
        hero.classList.toggle("is-over", over);
        $("hero-value").textContent = fmt(Math.abs(left));
        $("hero-caption").textContent = over ? "kcal over budget" : "kcal left";

        const basis = Math.max(budget, eaten, 1);
        const pK = day.total_protein * 4, cK = day.total_carbs * 4, fK = day.total_fat * 9;
        const macroK = pK + cK + fK;
        const pct = (k) => `${(k / basis) * 100}%`;
        if (macroK > 0) {
            const scale = eaten / macroK;
            $("fuel-protein").style.width = pct(pK * scale);
            $("fuel-carbs").style.width = pct(cK * scale);
            $("fuel-fat").style.width = pct(fK * scale);
            $("fuel-other").style.width = "0%";
        } else {
            ["protein", "carbs", "fat"].forEach((k) => { $(`fuel-${k}`).style.width = "0%"; });
            $("fuel-other").style.width = pct(eaten);
        }
        $("fuel-eaten").textContent = `${fmt(eaten)} eaten`;
        $("fuel-budget").textContent = `${fmt(budget)} budget`;
        $("fuel").setAttribute("aria-label", `${fmt(eaten)} of ${fmt(budget)} kcal eaten`);

        const macros = [
            { key: "protein", label: "Protein", val: day.total_protein, goal: goals.protein },
            { key: "carbs", label: "Carbs", val: day.total_carbs, goal: goals.carbs },
            { key: "fat", label: "Fat", val: day.total_fat, goal: goals.fat },
        ];
        $("macros").innerHTML = macros.map((m) => `
            <div class="macro" style="--c:var(--${m.key})">
                <span class="macro-name">${m.label}</span>
                <span class="macro-val">${fmt(m.val)}<small>/ ${fmt(m.goal)} g</small></span>
                <span class="macro-bar"><span style="width:${clamp((m.val / Math.max(m.goal, 1)) * 100, 0, 100)}%"></span></span>
            </div>`).join("");
    }

    function renderWater() {
        const w = state.water;
        if (!w) return;
        $("water-amount").textContent = `${fmt(w.amount_ml)} / ${fmt(w.goal_ml)} ml`;
        const glasses = clamp(Math.round(w.goal_ml / 250), 4, 14);
        const full = Math.floor(w.amount_ml / 250);
        $("water-glasses").innerHTML = Array.from({ length: glasses }, (_, i) =>
            `<span class="${i < full ? "is-full" : ""}"></span>`).join("");
    }

    function mealMeta(m) {
        const parts = [];
        if (m.nutri_grade) parts.push(nsMini(m.nutri_grade));
        if (m.is_group) parts.push(`<span class="tag">${icon("sparkle")}${m.items.length} items</span>`);
        else if (m.source === "ai") parts.push(`<span class="tag">${icon("sparkle")}AI</span>`);
        parts.push(`<span>P ${fmt(m.protein)} · C ${fmt(m.carbs)} · F ${fmt(m.fat)}</span>`);
        return parts.join("");
    }

    const nsMini = (g) => `<span class="ns-mini" data-g="${esc(g)}" style="--ns:var(--ns-${esc(g)})" title="Nutri-Score ${esc(g.toUpperCase())}">${esc(g)}</span>`;

    function renderMealSections() {
        const root = $("meal-sections");
        const day = state.day;
        if (!day) {
            root.innerHTML = '<div class="skel" style="height:56px;margin-top:20px"></div><div class="skel" style="height:56px;margin-top:10px"></div>';
            return;
        }
        if (!day.meals.length) {
            const isToday = state.date === todayIso();
            root.innerHTML = `
                <div class="empty-day">
                    <p>${isToday ? "Nothing logged yet today. Snap your next meal and the calories are worked out for you." : `Nothing logged for ${esc(dayLabel(state.date))}. You can still add what you ate.`}</p>
                    <div class="empty-actions">
                        <button class="btn btn-primary btn-sm" data-action="open-camera">${icon("camera")}Snap a meal</button>
                        <button class="btn btn-secondary btn-sm" data-action="open-scanner">${icon("barcode")}Scan barcode</button>
                    </div>
                </div>`;
            return;
        }
        const byType = Object.fromEntries(MEAL_TYPES.map((t) => [t.key, []]));
        day.meals.forEach((m) => byType[mealTypeOf(m)].push(m));
        root.innerHTML = MEAL_TYPES.map((t) => {
            const meals = byType[t.key];
            const kcal = meals.reduce((s, m) => s + m.calories, 0);
            return `
            <section class="meal-section" aria-label="${t.label}">
                <div class="meal-section-head">
                    <h2 class="meal-section-title">${t.label}</h2>
                    <span class="meal-section-kcal">${meals.length ? `${fmt(kcal)} kcal` : ""}</span>
                    <button class="meal-section-add" data-action="open-add" data-meal-type="${t.key}" aria-label="Add to ${t.label}">${icon("plus")}</button>
                </div>
                ${meals.length ? `<ul class="meal-list">${meals.map((m) => `
                    <li><button class="meal-row" data-action="open-meal" data-key="${esc(m.group_token || m.id)}">
                        <span class="meal-row-main">
                            <span class="meal-row-name">${esc(m.name)}</span>
                            <span class="meal-row-meta">${mealMeta(m)}</span>
                        </span>
                        <span class="meal-row-kcal">${fmt(m.calories)}<small>kcal</small></span>
                    </button></li>`).join("")}</ul>` : ""}
            </section>`;
        }).join("");
    }

    function findMeal(key) {
        return state.day && state.day.meals.find((m) => String(m.group_token || m.id) === String(key));
    }

    async function changeDay(delta) {
        const next = delta === 0 ? todayIso() : addDays(state.date, delta);
        if (next > todayIso()) return;
        state.date = next;
        state.day = null;
        renderToday();
        try { await refreshDay(); } catch (e) { toastError(e); }
    }

    async function addWater(ml) {
        vibrate(8);
        try {
            state.water = await post("/api/water", { delta_ml: ml, log_date: state.date });
            renderWater();
        } catch (e) { toastError(e); }
    }

    // ══════════════════════════════════════════
    // ADD SHEET
    // ══════════════════════════════════════════
    async function openAddSheet(mealType) {
        state.addMealType = mealType || null;
        const forLabel = mealType ? MEAL_TYPES.find((t) => t.key === mealType).label.toLowerCase() : null;
        const dateNote = state.date !== todayIso() ? ` · ${dayLabel(state.date)}` : "";
        openSheet({
            title: forLabel ? `Add to ${forLabel}${dateNote}` : `Log food${dateNote}`,
            body: `
                <div class="add-grid">
                    <button class="add-tile is-primary" data-action="open-camera">
                        <span><strong>Snap a meal</strong><small>AI works out calories and macros from a photo</small></span>
                        ${icon("camera")}
                    </button>
                    <button class="add-tile" data-action="open-scanner">${icon("barcode")}<span><strong>Scan barcode</strong><small>Packaged food, rated A–E</small></span></button>
                    <button class="add-tile" data-action="pick-photo">${icon("image")}<span><strong>Photo library</strong><small>Estimate from a saved photo</small></span></button>
                    <button class="add-tile" data-action="quick-add">${icon("pen-line")}<span><strong>Quick add</strong><small>Type in calories and macros</small></span></button>
                    <button class="add-tile" data-action="tab-foods">${icon("bowl")}<span><strong>My foods</strong><small>Saved and recent foods</small></span></button>
                </div>
                <div id="add-recent"></div>`,
            onMount: async (el) => {
                try {
                    const recent = await get("/api/meals/recent?limit=8");
                    state.recent = recent;
                    if (!recent.length || !el.isConnected) return;
                    el.querySelector("#add-recent").innerHTML = `
                        <p class="quick-label">Log again</p>
                        <div class="chips-scroll" style="margin-top:10px">${recent.map((f, i) => `
                            <button class="quick-chip" data-action="relog-recent" data-index="${i}">
                                <strong>${esc(f.name)}</strong><small>${fmt(f.calories)} kcal</small>
                            </button>`).join("")}</div>`;
                } catch (_) { /* optional */ }
            },
        });
    }

    function currentMealType() {
        return state.addMealType || guessMealType();
    }

    function mealTypeSeg(selected, name = "meal_type") {
        return `<div class="chips" role="radiogroup" aria-label="Meal">${MEAL_TYPES.map((t) => `
            <button type="button" class="chip ${t.key === selected ? "is-on" : ""}" role="radio" aria-checked="${t.key === selected}"
                data-action="pick-chip" data-group="${name}" data-value="${t.key}">${t.label}</button>`).join("")}</div>`;
    }
    function chipValue(root, group) {
        const on = root.querySelector(`[data-group="${group}"].is-on`);
        return on ? on.dataset.value : null;
    }

    async function logMeals(meals, { groupName, mealType, label, deferToast = false } = {}) {
        const date = state.date;
        let created;
        if (meals.length > 1) {
            created = await post("/api/meals/batch", { meals: meals.map((m) => ({ ...m, meal_date: date })), group_name: groupName || null, meal_type: mealType });
        } else {
            created = [await post("/api/meals", { ...meals[0], meal_date: date, meal_type: mealType })];
        }
        const kcal = meals.reduce((s, m) => s + (Number(m.calories) || 0), 0);
        vibrate(20);
        const notify = () => toast(`Logged ${fmt(kcal)} kcal${label ? ` · ${label}` : ""}`, {
            action: "Undo",
            onAction: async () => {
                try {
                    await del(`/api/meals/${created[0].id}`);
                    await refreshDay();
                    toast("Removed");
                } catch (e) { toastError(e); }
            },
        });
        // Callers closing an overlay pass deferToast and call notify() afterwards,
        // so the toast doesn't jump from the overlay position to the tab position.
        if (!deferToast) notify();
        return notify;
    }

    // ── Quick add / food form ──
    function foodFormHtml(f = {}, { showPresetToggle = true, mealType } = {}) {
        const v = (x) => (x === undefined || x === null || x === "" ? "" : esc(r1(x)));
        return `
            <form class="form" data-form="food" novalidate>
                <label class="field"><span class="field-label">Name</span>
                    <input class="input" name="name" maxlength="200" required value="${esc(f.name || "")}" placeholder="e.g. Masala dosa" ${f.name ? "" : "autofocus"}></label>
                <div class="grid-2">
                    <label class="field"><span class="field-label">Calories</span>
                        <span class="input-unit"><input class="input" name="calories" inputmode="decimal" required value="${v(f.calories)}" placeholder="0"><span>kcal</span></span></label>
                    <label class="field"><span class="field-label">Amount <span class="muted">optional</span></span>
                        <span class="input-unit"><input class="input" name="weight_g" inputmode="decimal" value="${v(f.weight_g || "")}" placeholder="—"><span>g</span></span></label>
                </div>
                <div class="grid-3">
                    <label class="field"><span class="field-label">Protein</span><span class="input-unit"><input class="input" name="protein" inputmode="decimal" value="${v(f.protein)}" placeholder="0"><span>g</span></span></label>
                    <label class="field"><span class="field-label">Carbs</span><span class="input-unit"><input class="input" name="carbs" inputmode="decimal" value="${v(f.carbs)}" placeholder="0"><span>g</span></span></label>
                    <label class="field"><span class="field-label">Fat</span><span class="input-unit"><input class="input" name="fat" inputmode="decimal" value="${v(f.fat)}" placeholder="0"><span>g</span></span></label>
                </div>
                ${mealType !== undefined ? `<div><p class="field-row-label">Meal</p>${mealTypeSeg(mealType)}</div>` : ""}
                ${showPresetToggle ? '<label class="check"><input type="checkbox" name="save_preset"> Also save to My foods</label>' : ""}
                <p class="form-error" data-role="error" hidden></p>
            </form>`;
    }

    function readFoodForm(form) {
        const fd = new FormData(form);
        const err = form.querySelector('[data-role="error"]');
        const fail = (msg) => { err.textContent = msg; err.hidden = false; return null; };
        err.hidden = true;
        const name = String(fd.get("name") || "").trim();
        if (!name) return fail("Give it a name.");
        const calories = num(fd.get("calories"));
        if (calories === null || calories < 0) return fail("Enter the calories as a number.");
        if (calories > 20000) return fail("That's more than 20,000 kcal. Check the number.");
        const out = { name, calories };
        for (const k of ["protein", "carbs", "fat", "weight_g"]) {
            const raw = String(fd.get(k) ?? "").trim();
            const n = raw === "" ? 0 : num(raw);
            if (n === null || n < 0) return fail(`${FIELD_NAMES[k]} must be a positive number.`);
            out[k] = n;
        }
        out.save_preset = fd.get("save_preset") === "on";
        return out;
    }

    function openQuickAdd(prefill = {}, { replace = false, source = "manual" } = {}) {
        openSheet({
            replace,
            title: "Quick add",
            body: foodFormHtml(prefill, { mealType: currentMealType() }),
            foot: '<button class="btn btn-primary btn-block" data-role="save">Add to log</button>',
            onMount(el) {
                const form = el.querySelector("form");
                const save = el.querySelector('[data-role="save"]');
                const submit = async () => {
                    const food = readFoodForm(form);
                    if (!food) return;
                    setBusy(save, true);
                    try {
                        const { save_preset, ...meal } = food;
                        const mealType = chipValue(el, "meal_type");
                        if (save_preset) {
                            await post("/api/presets", { name: meal.name, calories: meal.calories, protein: meal.protein, carbs: meal.carbs, fat: meal.fat });
                        }
                        const notify = await logMeals([{ ...meal, source }], { mealType, deferToast: true });
                        await back();
                        notify();
                        await refreshDay();
                    } catch (e) { toastError(e); } finally { setBusy(save, false); }
                };
                save.addEventListener("click", submit);
                form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
            },
        });
    }

    async function relogRecent(food, mealType) {
        try {
            const { times_logged, ...rest } = food;
            await logMeals([{ name: rest.name, calories: rest.calories, protein: rest.protein, carbs: rest.carbs, fat: rest.fat,
                weight_g: rest.weight_g, barcode: rest.barcode || null, nutri_grade: rest.nutri_grade || null, source: "recent" }],
            { mealType: mealType || currentMealType() });
            await refreshDay();
        } catch (e) { toastError(e); }
    }

    // ══════════════════════════════════════════
    // MEAL DETAIL / EDIT
    // ══════════════════════════════════════════
    function detailMacros(m) {
        return `<div class="detail-macros">
            <span style="--c:var(--protein)"><i></i>Protein ${fmt(m.protein)} g</span>
            <span style="--c:var(--carbs)"><i></i>Carbs ${fmt(m.carbs)} g</span>
            <span style="--c:var(--fat)"><i></i>Fat ${fmt(m.fat)} g</span>
            ${m.weight_g ? `<span>${fmt(m.weight_g)} g total</span>` : ""}
        </div>`;
    }

    function openMealSheet(key) {
        const meal = findMeal(key);
        if (!meal) return;
        if (meal.is_group) return openGroupSheet(meal);

        openSheet({
            title: "Edit entry",
            body: `
                ${meal.nutri_grade || meal.source ? `<div class="meal-row-meta">${mealMeta(meal)}</div>` : ""}
                ${foodFormHtml(meal, { showPresetToggle: false, mealType: mealTypeOf(meal) })}
                <div class="row-actions">
                    <button class="btn btn-secondary btn-sm" data-role="again">${icon("repeat")}Log again${state.date !== todayIso() ? " today" : ""}</button>
                    <button class="btn btn-secondary btn-sm" data-role="preset">${icon("star")}Save to My foods</button>
                </div>`,
            foot: `<button class="btn btn-danger" data-role="delete" aria-label="Delete entry">${icon("trash")}</button>
                   <button class="btn btn-primary btn-grow" data-role="save">Save changes</button>`,
            onMount(el) {
                const form = el.querySelector("form");
                el.querySelector('[data-role="save"]').addEventListener("click", async (ev) => {
                    const food = readFoodForm(form);
                    if (!food) return;
                    const { save_preset, ...changes } = food;
                    setBusy(ev.currentTarget, true);
                    try {
                        await patch(`/api/meals/${meal.id}`, { ...changes, meal_type: chipValue(el, "meal_type") });
                        await back();
                        await refreshDay();
                        toast("Saved");
                    } catch (e) { toastError(e); setBusy(ev.currentTarget, false); }
                });
                el.querySelector('[data-role="delete"]').addEventListener("click", () => deleteMeal(meal));
                el.querySelector('[data-role="again"]').addEventListener("click", async () => {
                    const copy = { name: meal.name, calories: meal.calories, protein: meal.protein, carbs: meal.carbs, fat: meal.fat,
                        weight_g: meal.weight_g, barcode: meal.barcode, nutri_grade: meal.nutri_grade, source: "recent", meal_date: todayIso() };
                    try {
                        await post("/api/meals", { ...copy, meal_type: guessMealType() });
                        await back();
                        if (state.date !== todayIso()) await changeDay(0); else await refreshDay();
                        toast(`Logged ${fmt(meal.calories)} kcal again`);
                    } catch (e) { toastError(e); }
                });
                el.querySelector('[data-role="preset"]').addEventListener("click", async (ev) => {
                    try {
                        await post("/api/presets", { name: meal.name, calories: meal.calories, protein: meal.protein, carbs: meal.carbs, fat: meal.fat });
                        ev.currentTarget.disabled = true;
                        ev.currentTarget.innerHTML = `${icon("check")}Saved to My foods`;
                    } catch (e) { toastError(e); }
                });
            },
        });
    }

    function groupItemRow(item) {
        return `<li class="item" data-item="${item.id}">
            <div class="item-top">
                <button class="item-name" data-role="edit-item" data-id="${item.id}">${esc(item.name)}</button>
                <span class="item-kcal">${fmt(item.calories)}</span>
                <button class="item-remove" data-role="remove-item" data-id="${item.id}" aria-label="Remove ${esc(item.name)}">${icon("trash")}</button>
            </div>
            <div class="item-macros"><span><b>P</b> ${fmt(item.protein)}</span><span><b>C</b> ${fmt(item.carbs)}</span><span><b>F</b> ${fmt(item.fat)}</span>${item.weight_g ? `<span class="p">${fmt(item.weight_g)} g</span>` : ""}</div>
        </li>`;
    }

    function openGroupSheet(meal, { replace = false } = {}) {
        openSheet({
            replace,
            title: "Meal",
            body: `
                <label class="field"><span class="field-label">Name</span>
                    <input class="input" data-role="gname" maxlength="200" value="${esc(meal.name)}"></label>
                <div class="detail-total"><span class="big-num">${fmt(meal.calories)}</span><span class="hero-caption">kcal</span></div>
                ${detailMacros(meal)}
                <div><p class="field-row-label">Meal</p>${mealTypeSeg(mealTypeOf(meal))}</div>
                <div>
                    <p class="field-row-label">Items · tap one to fix it</p>
                    <ul class="item-list">${meal.items.map(groupItemRow).join("")}</ul>
                </div>`,
            foot: `<button class="btn btn-danger" data-role="delete" aria-label="Delete meal">${icon("trash")}</button>
                   <button class="btn btn-primary btn-grow" data-role="save">Save</button>`,
            onMount(el) {
                el.querySelector('[data-role="save"]').addEventListener("click", async (ev) => {
                    setBusy(ev.currentTarget, true);
                    try {
                        await patch(`/api/meals/groups/${encodeURIComponent(meal.group_token)}`, {
                            group_name: el.querySelector('[data-role="gname"]').value.trim() || null,
                            meal_type: chipValue(el, "meal_type"),
                        });
                        await back();
                        await refreshDay();
                        toast("Saved");
                    } catch (e) { toastError(e); setBusy(ev.currentTarget, false); }
                });
                el.querySelector('[data-role="delete"]').addEventListener("click", () => deleteMeal(meal));
                el.querySelectorAll('[data-role="edit-item"]').forEach((b) => b.addEventListener("click", () => {
                    const item = meal.items.find((i) => String(i.id) === b.dataset.id);
                    openItemEditor(meal, item);
                }));
                el.querySelectorAll('[data-role="remove-item"]').forEach((b) => b.addEventListener("click", async () => {
                    const item = meal.items.find((i) => String(i.id) === b.dataset.id);
                    try {
                        await del(`/api/meals/${item.id}?scope=item`);
                        await refreshDay();
                        const fresh = findMeal(meal.group_token) || state.day.meals.find((m) => m.id === meal.items.find((i) => i.id !== item.id)?.id);
                        toast(`Removed ${item.name}`, {
                            action: "Undo",
                            onAction: async () => {
                                // Restore as a standalone entry next to the meal.
                                await post("/api/meals", { name: item.name, calories: item.calories, protein: item.protein, carbs: item.carbs,
                                    fat: item.fat, weight_g: item.weight_g, meal_date: state.date, meal_type: mealTypeOf(meal), source: "ai" });
                                await refreshDay();
                            },
                        });
                        if (fresh && fresh.is_group) openGroupSheet(fresh, { replace: true });
                        else await back();
                    } catch (e) { toastError(e); }
                }));
            },
        });
    }

    function openItemEditor(meal, item) {
        openSheet({
            title: "Fix item",
            body: foodFormHtml(item, { showPresetToggle: false }) + `
                <div><p class="field-row-label">Scale the portion</p><div class="chips">
                    ${[0.5, 0.75, 1.25, 1.5, 2].map((f) => `<button type="button" class="chip" data-role="scale" data-f="${f}">×${f}</button>`).join("")}
                </div></div>`,
            foot: '<button class="btn btn-primary btn-block" data-role="save">Save item</button>',
            onMount(el) {
                const form = el.querySelector("form");
                el.querySelectorAll('[data-role="scale"]').forEach((b) => b.addEventListener("click", () => {
                    const f = parseFloat(b.dataset.f);
                    for (const k of ["calories", "protein", "carbs", "fat", "weight_g"]) {
                        const input = form.elements[k];
                        const v = num(input.value);
                        if (v !== null) input.value = r1(v * f);
                    }
                    vibrate(6);
                }));
                el.querySelector('[data-role="save"]').addEventListener("click", async (ev) => {
                    const food = readFoodForm(form);
                    if (!food) return;
                    const { save_preset, ...changes } = food;
                    setBusy(ev.currentTarget, true);
                    try {
                        await patch(`/api/meals/${item.id}`, changes);
                        await refreshDay();
                        await back();
                        const fresh = findMeal(meal.group_token);
                        if (fresh) openGroupSheet(fresh, { replace: true });
                        toast("Item updated");
                    } catch (e) { toastError(e); setBusy(ev.currentTarget, false); }
                });
            },
        });
    }

    async function deleteMeal(meal) {
        const snapshot = meal;
        try {
            await del(`/api/meals/${meal.id}`);
            await closeAll();
            await refreshDay();
            toast(`Deleted ${meal.name}`, {
                action: "Undo",
                onAction: async () => {
                    try {
                        const base = { meal_date: snapshot.meal_date, meal_type: mealTypeOf(snapshot) };
                        if (snapshot.is_group) {
                            await post("/api/meals/batch", {
                                meals: snapshot.items.map((i) => ({ name: i.name, calories: i.calories, protein: i.protein, carbs: i.carbs, fat: i.fat, weight_g: i.weight_g, ...base, source: snapshot.source || "ai" })),
                                group_name: snapshot.name, meal_type: base.meal_type,
                            });
                        } else {
                            await post("/api/meals", { name: snapshot.name, calories: snapshot.calories, protein: snapshot.protein, carbs: snapshot.carbs,
                                fat: snapshot.fat, weight_g: snapshot.weight_g, source: snapshot.source, barcode: snapshot.barcode, nutri_grade: snapshot.nutri_grade, ...base });
                        }
                        await refreshDay();
                    } catch (e) { toastError(e); }
                },
            });
        } catch (e) { toastError(e); }
    }

    // ══════════════════════════════════════════
    // CAMERA → REVIEW → ANALYZE → RESULTS
    // ══════════════════════════════════════════
    let camStream = null;

    function stopCamera() {
        if (camStream) camStream.getTracks().forEach((t) => t.stop());
        camStream = null;
        $("cam-video").srcObject = null;
    }

    function cameraErrorMessage(e) {
        if (!window.isSecureContext) return "The camera needs a secure (https) connection. Choose a photo instead.";
        if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) return "Camera access is blocked. Allow it in your browser's site settings, or choose a photo instead.";
        if (e && (e.name === "NotFoundError" || e.name === "OverconstrainedError")) return "No camera found on this device. Choose a photo instead.";
        if (e && e.name === "NotReadableError") return "Another app is using the camera. Close it and try again.";
        return (e && e.message) || "Couldn't start the camera.";
    }

    async function openCamera({ replace = false } = {}) {
        if (topLayer() && topLayer().name === "sheet" && !replace) replace = true;
        openScreen("screen-camera", { replace, onClose: stopCamera });
        $("cam-error").hidden = true;
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error();
            camStream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
            });
            if ($("screen-camera").hidden) { stopCamera(); return; }
            $("cam-video").srcObject = camStream;
            await $("cam-video").play().catch(() => {});
        } catch (e) {
            $("cam-error").textContent = cameraErrorMessage(e);
            $("cam-error").hidden = false;
        }
    }

    function drawScaled(source, w, h, max = 1280) {
        const scale = Math.min(1, max / Math.max(w, h));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.85);
    }

    function capturePhoto() {
        const v = $("cam-video");
        if (!v.videoWidth) { toast("The camera isn't ready yet.", { error: true }); return; }
        vibrate(15);
        state.photo = drawScaled(v, v.videoWidth, v.videoHeight);
        openReview({ replace: true });
    }

    function fileToJpeg(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                try { resolve(drawScaled(img, img.naturalWidth, img.naturalHeight)); } catch (e) { reject(e); }
                URL.revokeObjectURL(url);
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't an image this browser can open.")); };
            img.src = url;
        });
    }

    async function handlePhotoFile(file) {
        if (!file) return;
        try {
            state.photo = await fileToJpeg(file);
            const top = topLayer();
            openReview({ replace: !!top && (top.name === "sheet" || top.name === "screen:screen-camera") });
        } catch (e) { toastError(e); }
    }

    function openReview({ replace = false } = {}) {
        $("review-img").src = state.photo;
        $("review-desc").value = "";
        document.querySelectorAll("#review-hints .chip").forEach((c) => c.classList.remove("is-on"));
        openScreen("screen-review", { replace });
    }

    let analyzeCtl = null;
    let statusTimer = null;

    async function analyze() {
        const description = $("review-desc").value.trim();
        const remaining = state.goals && state.day && state.date === todayIso()
            ? state.goals.calories - state.day.total_calories : null;
        $("analyzing-img").src = state.photo;
        openScreen("screen-analyzing", { replace: true, onClose: () => { if (analyzeCtl) analyzeCtl.abort(); clearInterval(statusTimer); } });
        const msgs = ["Finding the foods on your plate…", "Estimating portion sizes…", "Working out the macros…", "Nearly done…"];
        let i = 0;
        $("analyzing-status").textContent = msgs[0];
        clearInterval(statusTimer);
        statusTimer = setInterval(() => { i = Math.min(i + 1, msgs.length - 1); $("analyzing-status").textContent = msgs[i]; }, 2600);

        analyzeCtl = new AbortController();
        try {
            const res = await post("/api/analyze", {
                image: state.photo.split(",")[1],
                description: description || null,
                remaining_calories: remaining,
            }, { signal: analyzeCtl.signal });
            analyzeCtl = null;
            clearInterval(statusTimer);
            if (!res.items.length) {
                openReview({ replace: true });
                $("review-desc").value = description;
                toast(res.suggestions || "No food found in that photo. Try again closer to the plate.", { error: true, duration: 6000 });
                return;
            }
            state.analysis = {
                name: res.meal_name || (res.items.length === 1 ? res.items[0].name : ""),
                suggestion: res.suggestions,
                mealType: currentMealType(),
                items: res.items.map((it) => ({ ...it, factor: 1 })),
            };
            openResults();
        } catch (e) {
            clearInterval(statusTimer);
            if (e.name === "AbortError") return;
            analyzeCtl = null;
            openReview({ replace: true });
            $("review-desc").value = description;
            toast(e.message || "The estimate failed. Try again.", { error: true, duration: 6000 });
        }
    }

    function scaledItem(it) {
        const f = it.factor;
        return { name: it.name, calories: r1(it.calories * f), protein: r1(it.protein * f), carbs: r1(it.carbs * f), fat: r1(it.fat * f), weight_g: Math.round(it.weight_g * f) };
    }

    function openResults() {
        renderResults();
        openScreen("screen-results", { replace: true });
    }

    function renderResults() {
        const a = state.analysis;
        const items = a.items.map(scaledItem);
        const total = items.reduce((t, i) => ({ calories: t.calories + i.calories, protein: t.protein + i.protein, carbs: t.carbs + i.carbs, fat: t.fat + i.fat, weight_g: t.weight_g + i.weight_g }),
            { calories: 0, protein: 0, carbs: 0, fat: 0, weight_g: 0 });
        let after = "";
        if (state.goals && state.day) {
            const left = state.goals.calories - state.day.total_calories - total.calories;
            const when = state.date === todayIso() ? "today" : `on ${dayLabel(state.date)}`;
            after = left >= 0
                ? `<p class="budget-after">After this you'll have <strong>${fmt(left)} kcal</strong> left ${esc(when)}.</p>`
                : `<p class="budget-after is-over">This puts you <strong>${fmt(-left)} kcal</strong> over budget ${esc(when)}.</p>`;
        }
        $("results-body").innerHTML = `
            <div class="results-hero">
                <img class="results-thumb" src="${state.photo}" alt="">
                <label class="results-name"><span class="field-label">Meal name</span>
                    <input class="input" id="results-name" maxlength="200" value="${esc(a.name)}" placeholder="Name this meal"></label>
            </div>
            <div>
                <div class="results-total"><span class="big-num">${fmt(total.calories)}</span><span class="hero-caption">kcal</span></div>
                ${detailMacros(total)}
                ${after}
            </div>
            <div>
                <p class="field-row-label">Adjust portions or tap an item to fix it</p>
                <ul class="item-list">${a.items.map((it, idx) => {
                    const s = scaledItem(it);
                    const amount = it.weight_g ? `${fmt(s.weight_g)} g` : `×${it.factor}`;
                    return `<li class="item">
                        <div class="item-top">
                            <button class="item-name" data-action="result-edit" data-index="${idx}">${esc(it.name)}</button>
                            <span class="item-kcal">${fmt(s.calories)}</span>
                            <button class="item-remove" data-action="result-remove" data-index="${idx}" aria-label="Remove ${esc(it.name)}">${icon("trash")}</button>
                        </div>
                        <div class="item-bottom">
                            <span class="item-macros"><span><b>P</b> ${fmt(s.protein)}</span><span><b>C</b> ${fmt(s.carbs)}</span><span><b>F</b> ${fmt(s.fat)}</span></span>
                            <span class="portion">
                                <button data-action="result-portion" data-index="${idx}" data-step="-0.25" aria-label="Less ${esc(it.name)}">${icon("minus")}</button>
                                <span>${amount}</span>
                                <button data-action="result-portion" data-index="${idx}" data-step="0.25" aria-label="More ${esc(it.name)}">${icon("plus")}</button>
                            </span>
                        </div>
                    </li>`;
                }).join("")}</ul>
                <button class="btn btn-ghost btn-sm" data-action="result-add" style="margin-top:6px">${icon("plus")}Add an item</button>
            </div>
            <div><p class="field-row-label">Meal</p>${mealTypeSeg(a.mealType, "result_meal_type")}</div>
            ${a.suggestion ? `<div class="tip">${icon("sparkle")}<span>${esc(a.suggestion)}</span></div>` : ""}`;
        $("results-name").addEventListener("input", (e) => { a.name = e.target.value; });
        const btn = $("results-log");
        btn.textContent = a.items.length ? `Log ${fmt(total.calories)} kcal` : "Add an item to log";
        btn.disabled = !a.items.length;
    }

    function editResultItem(index) {
        const a = state.analysis;
        const isNew = index === -1;
        const it = isNew ? {} : scaledItem(a.items[index]);
        openSheet({
            title: isNew ? "Add item" : "Fix item",
            body: foodFormHtml(it, { showPresetToggle: false }),
            foot: `<button class="btn btn-primary btn-block" data-role="save">${isNew ? "Add item" : "Save item"}</button>`,
            onMount(el) {
                const form = el.querySelector("form");
                const save = () => {
                    const food = readFoodForm(form);
                    if (!food) return;
                    const { save_preset, ...item } = food;
                    if (isNew) a.items.push({ ...item, factor: 1 });
                    else a.items[index] = { ...item, factor: 1 };
                    back();
                    renderResults();
                };
                el.querySelector('[data-role="save"]').addEventListener("click", save);
                form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
            },
        });
    }

    async function logResults() {
        const a = state.analysis;
        if (!a || !a.items.length) return;
        const btn = $("results-log");
        setBusy(btn, true);
        try {
            const items = a.items.map((it) => ({ ...scaledItem(it), source: "ai" }));
            const mealType = chipValue($("screen-results"), "result_meal_type") || a.mealType;
            const notify = await logMeals(items, { groupName: a.name.trim() || null, mealType, deferToast: true });
            state.analysis = null;
            await closeAll();
            notify();
            if (state.tab !== "today") switchTab("today");
            await refreshDay();
        } catch (e) { toastError(e); } finally { setBusy(btn, false); }
    }

    // ══════════════════════════════════════════
    // BARCODE
    // ══════════════════════════════════════════
    let scanner = null;
    let audioCtx = null;

    function beep() {
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.frequency.value = 1760;
            g.gain.setValueAtTime(0.12, audioCtx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
            o.connect(g).connect(audioCtx.destination);
            o.start();
            o.stop(audioCtx.currentTime + 0.12);
        } catch (_) { /* audio unavailable */ }
    }

    function stopScanner() {
        if (scanner) scanner.stop();
        scanner = null;
        $("torch-btn").hidden = true;
        $("torch-btn").setAttribute("aria-pressed", "false");
    }

    function stopAllCameras() { stopScanner(); stopCamera(); }

    async function openScanner({ replace = false } = {}) {
        if (topLayer() && topLayer().name === "sheet" && !replace) replace = true;
        // Prime audio inside the tap so the success beep is allowed later.
        try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { /* ignore */ }
        openScreen("screen-scanner", { replace, onClose: stopScanner });
        $("barcode-input").value = "";
        $("scan-error").hidden = true;
        $("scan-hint").textContent = "Line up the barcode inside the box";
        const win = $("scan-window");
        win.classList.remove("is-hit");
        win.classList.add("is-loading");
        stopScanner();
        scanner = new window.CVScanner.Scanner($("scan-video"), {
            onDetect: (code) => onBarcode(code, { fromCamera: true }),
            onStatus: (s) => {
                win.classList.toggle("is-loading", s === "loading");
                if (s === "loading") $("scan-hint").textContent = "Starting the barcode reader…";
                if (s === "ready") $("scan-hint").textContent = "Line up the barcode inside the box";
            },
        });
        try {
            await scanner.start();
            if ($("screen-scanner").hidden) { stopScanner(); return; }
            if (scanner && scanner.canTorch) $("torch-btn").hidden = false;
        } catch (e) {
            win.classList.remove("is-loading");
            $("scan-error").textContent = e && e.name ? cameraErrorMessage(e).replace("Choose a photo instead.", "Type the barcode below instead.") : (e.message || String(e));
            $("scan-error").hidden = false;
            $("scan-hint").textContent = "Type the barcode instead";
        }
    }

    async function onBarcode(code, { fromCamera = false } = {}) {
        if (fromCamera) {
            vibrate(40);
            beep();
            $("scan-window").classList.add("is-hit");
        }
        $("scan-hint").textContent = `Looking up ${code}…`;
        try {
            const product = await get(`/api/products/${code}`);
            if ($("screen-scanner").hidden) return;
            openProduct(product);
        } catch (e) {
            if ($("screen-scanner").hidden) return;
            if (e.status === 404) {
                openProductNotFound(code);
            } else {
                toastError(e);
                $("scan-window").classList.remove("is-hit");
                $("scan-hint").textContent = "Line up the barcode inside the box";
                if (scanner) scanner.resume();
            }
        }
    }

    async function submitBarcode(e) {
        e.preventDefault();
        const code = $("barcode-input").value.replace(/\D/g, "");
        if (!window.CVScanner.validGtin(code)) {
            toast(code.length < 8 ? "A barcode has 8 to 14 digits." : "Those digits don't form a valid barcode. Check for a typo.", { error: true });
            return;
        }
        $("barcode-input").blur();
        if (scanner) scanner.running = false;
        const btn = e.submitter || e.target.querySelector("button");
        setBusy(btn, true);
        await onBarcode(code);
        setBusy(btn, false);
    }

    async function scanFromPhoto(file) {
        if (!file) return;
        $("scan-hint").textContent = "Reading the photo…";
        try {
            const code = await window.CVScanner.decodeFile(file);
            if (!code) {
                toast("No barcode found in that photo. Try a sharper, closer shot.", { error: true });
                $("scan-hint").textContent = "Line up the barcode inside the box";
                return;
            }
            if (scanner) scanner.running = false;
            await onBarcode(code, { fromCamera: true });
        } catch (e) { toastError(e); }
    }

    function defaultPortion(p) {
        if (p.serving_g) return p.serving_g;
        if (p.package_g && p.package_g <= 60) return p.package_g;
        return 100;
    }

    function openProduct(product) {
        state.product = { ...product, grams: defaultPortion(product), mealType: currentMealType() };
        renderProduct();
        openScreen("screen-product", { replace: true });
        if (!product.nutriscore.grade) rateWithAi();
    }

    /** Open Food Facts had no grade: ask the AI to rate it (cached server-side). */
    async function rateWithAi() {
        const p = state.product;
        if (!p || p.nutriscore.grade || p.aiPending) return;
        p.aiPending = true;
        p.aiError = null;
        renderProduct(true);
        const isCurrent = () => state.product && state.product.barcode === p.barcode;
        try {
            const rated = await post(`/api/products/${encodeURIComponent(p.barcode)}/assess`);
            if (!isCurrent()) return;
            state.product = {
                ...rated,
                grams: p.has_nutrition ? p.grams : defaultPortion(rated),
                mealType: state.product.mealType,
            };
        } catch (e) {
            if (!isCurrent()) return;
            state.product.aiPending = false;
            state.product.aiError = e.message || "The AI couldn't rate this product.";
        }
        if (isCurrent() && !$("screen-product").hidden) renderProduct(true);
    }

    function factRow(e, good) {
        const value = e.value === null || e.value === undefined ? "" : `${e.value}${e.unit === "kcal" ? " kcal" : ` ${e.unit}`}`;
        const words = { energy_kj: { high: "High in calories", moderate: "Moderately calorific", low: "Low in calories" },
            sugars: { high: "Too sweet", moderate: "Some sugar", low: "Low sugar" },
            saturated_fat: { high: "High saturated fat", moderate: "Some saturated fat", low: "Low saturated fat" },
            salt: { high: "Too salty", moderate: "Some salt", low: "Low salt" },
            sweeteners: { high: "Contains sweeteners" },
            protein: { high: "Excellent protein", moderate: "Some protein" },
            fiber: { high: "Excellent fibre", moderate: "Some fibre" },
            fvl: { high: "Fruit, veg or legumes" } };
        const ai = e.key === "ai";
        const title = ai ? e.label : (words[e.key] && words[e.key][e.level]) || e.label;
        const sub = ai ? e.detail : e.label;
        return `<div class="fact ${good ? "is-good" : ""}" data-level="${esc(e.level)}">
            <span class="fact-dot" aria-hidden="true"></span>
            <span class="fact-name">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ""}</span>
            <span class="fact-val">${esc(value)}</span>
        </div>`;
    }

    function scoreSource(ns, p) {
        if (ns.source === "ai") {
            return `Nutri-Score, rated by AI${ns.confidence === "low" ? " · low confidence" : ""}`;
        }
        if (ns.source === "estimated") return "Nutri-Score, calculated from the label";
        if (ns.source === "openfoodfacts") return "Nutri-Score from Open Food Facts";
        return p.aiPending ? "Nutri-Score, rated by AI" : "Nutri-Score";
    }

    function productPortion(p) {
        const f = p.grams / 100;
        const n = p.per_100g;
        return { calories: (n.calories || 0) * f, protein: (n.protein || 0) * f, carbs: (n.carbs || 0) * f, fat: (n.fat || 0) * f };
    }

    function renderProduct(keepScroll = false) {
        const p = state.product;
        const scroller = $("screen-product").querySelector(".screen-body");
        const scrollTop = keepScroll ? scroller.scrollTop : 0;
        const ns = p.nutriscore;
        const unit = p.is_beverage ? "ml" : "g";
        const grade = ns.grade;
        const scale = ["a", "b", "c", "d", "e"].map((g) =>
            `<span data-g="${g}" class="${g === grade ? "is-on" : ""}" style="--ns:var(--ns-${g})">${g}</span>`).join("");
        const portions = [];
        if (p.serving_g) portions.push({ g: p.serving_g, label: `1 serving · ${fmt(p.serving_g)} ${unit}` });
        portions.push({ g: 100, label: `100 ${unit}` });
        if (p.package_g && p.package_g !== p.serving_g && p.package_g !== 100) portions.push({ g: p.package_g, label: `Whole pack · ${fmt(p.package_g)} ${unit}` });
        const n = productPortion(p);

        $("product-body").innerHTML = `
            <div class="product-head">
                ${p.image_url ? `<img class="product-img" src="${esc(p.image_url)}" alt="" referrerpolicy="no-referrer">` : `<div class="product-img-ph">${icon("barcode")}</div>`}
                <div>
                    <h3 class="product-name">${esc(p.name)}</h3>
                    <p class="product-brand">${esc([p.brand && !p.name.toLowerCase().includes(p.brand.toLowerCase()) ? p.brand : null, p.quantity].filter(Boolean).join(" · "))}</p>
                </div>
            </div>

            <section class="score-card ${grade ? "" : "is-unrated"} ${p.aiPending ? "is-pending" : ""}" aria-label="Nutri-Score" aria-busy="${!!p.aiPending}">
                <div class="score-top">
                    <div class="ns-scale" role="img" aria-label="${grade ? `Nutri-Score ${grade.toUpperCase()}` : p.aiPending ? "Rating in progress" : "Not rated"}">${scale}</div>
                    <div class="score-text">
                        <span class="score-label">${grade ? `${esc(ns.label)} · ${ns.rating}/5` : p.aiPending ? "Rating…" : "Not rated"}</span>
                        <span class="score-sub">${scoreSource(ns, p)}</span>
                    </div>
                </div>
                <p class="score-summary">${p.aiPending
                    ? "Open Food Facts has no score for this product, so the AI is rating it from the ingredients, nutrition and package photo."
                    : esc(p.aiError || ns.summary)}</p>
                ${!grade && !p.aiPending ? `<button class="btn btn-secondary btn-sm" data-action="product-ai-retry" style="justify-self:start">${icon("sparkle")}Rate with AI</button>` : ""}
            </section>

            ${ns.negatives.length ? `<div class="facts"><h3>Watch out${ns.source === "ai" ? "" : ` · per ${esc(ns.per)}`}</h3>${ns.negatives.map((e) => factRow(e, false)).join("")}</div>` : ""}
            ${ns.positives.length ? `<div class="facts"><h3>Good points${ns.source === "ai" ? "" : ` · per ${esc(ns.per)}`}</h3>${ns.positives.map((e) => factRow(e, true)).join("")}</div>` : ""}

            ${p.nova ? `<div class="nova"><span class="nova-num" data-n="${p.nova.group}">${p.nova.group}</span>
                <span><strong>${esc(p.nova.label)}</strong><small>NOVA processing group, from 1 (whole food) to 4</small></span></div>` : ""}

            ${p.additives.length || p.allergens.length ? `<div class="facts">
                ${p.allergens.length ? `<h3>Allergens</h3><div class="pill-row">${p.allergens.map((a) => `<span class="pill pill-warn">${esc(a)}</span>`).join("")}</div>` : ""}
                ${p.additives.length ? `<h3>Additives</h3><div class="pill-row">${p.additives.map((a) => `<span class="pill">${esc(a)}</span>`).join("")}</div>` : ""}
            </div>` : ""}

            ${p.has_nutrition && p.nutrition_source === "ai" ? `<div class="tip">${icon("sparkle")}<span>Open Food Facts has no nutrition facts for this product, so these numbers are AI estimates. If you have the pack, compare them with the label.</span></div>` : ""}
            ${p.has_nutrition ? `<section class="portion-card" aria-label="How much">
                <p class="field-row-label" style="margin:0">How much did you have?</p>
                <div class="chips">${portions.map((o) => `<button class="chip ${Math.abs(o.g - p.grams) < 0.01 ? "is-on" : ""}" data-action="product-portion" data-g="${o.g}">${esc(o.label)}</button>`).join("")}</div>
                <label class="field"><span class="input-unit"><input class="input" id="product-grams" inputmode="decimal" value="${r1(p.grams)}" aria-label="Amount in ${unit}"><span>${unit}</span></span></label>
                <div class="portion-result">
                    <div><span class="big-num" id="product-kcal">${fmt(n.calories)}</span> <span class="hero-caption">kcal</span></div>
                </div>
                <div class="portion-macros" id="product-macros"></div>
                <div><p class="field-row-label">Meal</p>${mealTypeSeg(p.mealType, "product_meal_type")}</div>
            </section>` : `<div class="tip">${icon(p.aiPending ? "sparkle" : "pen-line")}<span>${p.aiPending
                ? "No nutrition facts in Open Food Facts yet. The AI is estimating them…"
                : "This product has no nutrition facts in Open Food Facts yet. Add it with the numbers from the label."}</span></div>`}

            <p class="source-note">Data from Open Food Facts, a free database anyone can improve. Barcode ${esc(p.barcode)}.</p>`;

        $("product-foot").innerHTML = p.has_nutrition
            ? `<button class="btn btn-primary btn-block" data-action="log-product" id="product-log">Log ${fmt(n.calories)} kcal</button>`
            : '<button class="btn btn-primary btn-block" data-action="product-manual">Add from the label</button>';

        scroller.scrollTop = scrollTop;
        const gramsInput = $("product-grams");
        if (gramsInput) {
            gramsInput.addEventListener("input", () => {
                const g = num(gramsInput.value);
                if (g === null || g < 0) return;
                p.grams = Math.min(g, 20000);
                document.querySelectorAll('[data-action="product-portion"]').forEach((c) => c.classList.toggle("is-on", Math.abs(parseFloat(c.dataset.g) - p.grams) < 0.01));
                updateProductPortion();
            });
            updateProductPortion();
        }
    }

    function updateProductPortion() {
        const p = state.product;
        const n = productPortion(p);
        $("product-kcal").textContent = fmt(n.calories);
        $("product-macros").innerHTML = `
            <span style="--c:var(--protein)"><i></i>Protein ${r1(n.protein)} g</span>
            <span style="--c:var(--carbs)"><i></i>Carbs ${r1(n.carbs)} g</span>
            <span style="--c:var(--fat)"><i></i>Fat ${r1(n.fat)} g</span>`;
        const btn = $("product-log");
        btn.textContent = `Log ${fmt(n.calories)} kcal`;
        btn.disabled = !(p.grams > 0);
    }

    async function logProduct() {
        const p = state.product;
        const n = productPortion(p);
        const btn = $("product-log");
        setBusy(btn, true);
        try {
            const notify = await logMeals([{
                name: p.brand && !p.name.toLowerCase().includes(p.brand.toLowerCase()) ? `${p.name} (${p.brand})` : p.name,
                calories: r1(n.calories), protein: r1(n.protein), carbs: r1(n.carbs), fat: r1(n.fat),
                weight_g: Math.round(p.grams), source: "barcode", barcode: p.barcode.length > 14 ? null : p.barcode,
                nutri_grade: p.nutriscore.grade || null,
            }], { mealType: chipValue($("screen-product"), "product_meal_type") || p.mealType, deferToast: true });
            await closeAll();
            notify();
            if (state.tab !== "today") switchTab("today");
            await refreshDay();
        } catch (e) { toastError(e); } finally { setBusy(btn, false); }
    }

    function openProductNotFound(code) {
        state.product = null;
        $("product-body").innerHTML = `
            <div class="notfound">
                ${icon("barcode")}
                <span class="mono">${esc(code)}</span>
                <p>This product isn't in Open Food Facts yet. Snap it with the camera, or add it from the label.</p>
                <button class="btn btn-primary" data-action="open-camera-replace">${icon("camera")}Snap it instead</button>
                <button class="btn btn-secondary" data-action="product-manual">Add from the label</button>
                <button class="btn btn-ghost" data-action="rescan">Scan another barcode</button>
            </div>`;
        $("product-foot").innerHTML = "";
        openScreen("screen-product", { replace: true });
    }

    // ══════════════════════════════════════════
    // PROGRESS
    // ══════════════════════════════════════════
    async function renderProgress() {
        const body = $("progress-body");
        body.innerHTML = '<div class="skel" style="height:80px;margin-bottom:24px"></div><div class="skel" style="height:200px"></div>';
        const days = state.range;
        try {
            const [hist, goals] = await Promise.all([get(`/api/history?days=${days}&end=${todayIso()}`), state.goals || loadGoals()]);
            if (state.tab !== "progress" || state.range !== days) return;
            const budget = goals.calories;
            const byDate = Object.fromEntries(hist.days.map((d) => [d.date, d]));
            const series = [];
            for (let i = days - 1; i >= 0; i--) {
                const iso = addDays(todayIso(), -i);
                const d = byDate[iso];
                series.push({ date: iso, kcal: d ? d.total_calories : 0, logged: !!d, p: d ? d.total_protein : 0, c: d ? d.total_carbs : 0, f: d ? d.total_fat : 0 });
            }
            const logged = series.filter((d) => d.logged);
            const avg = logged.length ? logged.reduce((s, d) => s + d.kcal, 0) / logged.length : 0;
            const within = logged.filter((d) => d.kcal <= budget).length;
            let streak = 0;
            for (let i = series.length - 1; i >= 0; i--) {
                if (series[i].logged) streak++;
                else if (i === series.length - 1) continue; // today not logged yet doesn't break it
                else break;
            }
            const pK = logged.reduce((s, d) => s + d.p * 4, 0), cK = logged.reduce((s, d) => s + d.c * 4, 0), fK = logged.reduce((s, d) => s + d.f * 9, 0);
            const mK = pK + cK + fK;
            const pct = (k) => (mK ? Math.round((k / mK) * 100) : 0);

            if (!logged.length) {
                body.innerHTML = `<div class="empty-day"><p>No meals in the last ${days} days. Your trends show up here once you start logging.</p>
                    <button class="btn btn-primary btn-sm" data-action="open-add">${icon("plus")}Log food</button></div>`;
                return;
            }

            body.innerHTML = `
                <div class="stat-row">
                    <div class="stat"><span class="stat-val">${fmt(avg)}</span><span class="stat-label">Avg kcal / day</span></div>
                    <div class="stat"><span class="stat-val">${within}<small class="muted" style="font-size:16px">/${logged.length}</small></span><span class="stat-label">Days in budget</span></div>
                    <div class="stat"><span class="stat-val">${streak}</span><span class="stat-label">Day streak</span></div>
                </div>
                <section class="chart-card">
                    <h2 class="chart-title">Calories per day</h2>
                    <p class="chart-sub">Tap a bar for details. Dashed line is your ${fmt(budget)} kcal budget.</p>
                    <div class="chart" id="kcal-chart">${barChart(series, budget)}</div>
                    <div class="legend">
                        <span><i style="--c:var(--saffron)"></i>In budget</span>
                        <span><i style="--c:var(--over)"></i>Over budget</span>
                        <span><i class="dash"></i>Budget</span>
                    </div>
                </section>
                ${mK ? `<section class="chart-card">
                    <h2 class="chart-title">Where your calories came from</h2>
                    <p class="chart-sub">Share of calories from each macro, over logged days.</p>
                    <div class="split-bar" role="img" aria-label="Protein ${pct(pK)}%, carbs ${pct(cK)}%, fat ${pct(fK)}%">
                        <span style="--c:var(--protein);flex:${pK}"></span><span style="--c:var(--carbs);flex:${cK}"></span><span style="--c:var(--fat);flex:${fK}"></span>
                    </div>
                    <div class="legend">
                        <span><i style="--c:var(--protein)"></i>Protein ${pct(pK)}%</span>
                        <span><i style="--c:var(--carbs)"></i>Carbs ${pct(cK)}%</span>
                        <span><i style="--c:var(--fat)"></i>Fat ${pct(fK)}%</span>
                    </div>
                </section>` : ""}
                <section>
                    <h2 class="section-label">Days</h2>
                    <ul class="day-list">${logged.slice().reverse().map((d) => `
                        <li><button class="day-item" data-action="goto-day" data-date="${d.date}">
                            <span class="day-item-date">${esc(dayLabel(d.date))}<small>P ${fmt(d.p)} · C ${fmt(d.c)} · F ${fmt(d.f)}</small></span>
                            <span class="day-item-kcal ${d.kcal > budget ? "is-over" : ""}">${fmt(d.kcal)} kcal${d.kcal > budget ? " · over" : ""}</span>
                            ${icon("chev-right")}
                        </button></li>`).join("")}</ul>
                </section>`;
            wireChart($("kcal-chart"), series, budget);
        } catch (e) {
            body.innerHTML = '<p class="empty-note">Couldn\'t load your history.</p>';
            toastError(e);
        }
    }

    function barChart(series, budget) {
        const W = 340, H = 170, top = 14, bottom = 22, left = 0, right = 0;
        const n = series.length;
        const maxV = Math.max(budget * 1.15, ...series.map((d) => d.kcal), 1);
        const plotH = H - top - bottom;
        const slot = (W - left - right) / n;
        const gap = n > 14 ? 2 : 8;
        const bw = Math.max(2, slot - gap);
        const y = (v) => top + plotH - (v / maxV) * plotH;
        const radius = Math.min(4, bw / 2);
        const bars = series.map((d, i) => {
            const x = left + i * slot + gap / 2;
            const h = Math.max(0, (d.kcal / maxV) * plotH);
            const cls = `bar${d.kcal > budget ? " is-over" : ""}`;
            if (h <= 0) return "";
            const r = Math.min(radius, h);
            const yt = top + plotH - h;
            const yb = top + plotH;
            // Rounded data end, square baseline.
            return `<path class="${cls}" data-i="${i}" d="M${x},${yb} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + bw - r} Q${x + bw},${yt} ${x + bw},${yt + r} V${yb} Z"/>`;
        }).join("");
        const hits = series.map((d, i) => `<rect class="bar-hit" data-i="${i}" x="${left + i * slot}" y="${top}" width="${slot}" height="${plotH + bottom}"/>`).join("");
        const labels = series.map((d, i) => {
            const show = n <= 7 || i % 5 === (n - 1) % 5;
            if (!show) return "";
            const date = new Date(`${d.date}T12:00:00`);
            const txt = n <= 7 ? date.toLocaleDateString(undefined, { weekday: "short" }) : String(date.getDate());
            return `<text class="axis-text" x="${left + i * slot + slot / 2}" y="${H - 6}" text-anchor="middle">${esc(txt)}</text>`;
        }).join("");
        const by = y(budget);
        return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Calories per day, last ${n} days">
            <line class="grid-line" x1="0" x2="${W}" y1="${top + plotH}" y2="${top + plotH}"/>
            ${bars}
            <line class="budget-line" x1="0" x2="${W}" y1="${by}" y2="${by}"/>
            ${labels}
            ${hits}
        </svg>`;
    }

    function wireChart(root, series, budget) {
        if (!root) return;
        let tip = null;
        const svg = root.querySelector("svg");
        const show = (i) => {
            const d = series[i];
            root.classList.add("has-focus");
            root.querySelectorAll(".bar").forEach((b) => b.classList.toggle("is-focus", b.dataset.i === String(i)));
            if (!tip) { tip = document.createElement("div"); tip.className = "chart-tip"; root.appendChild(tip); }
            const diff = d.kcal - budget;
            tip.innerHTML = `${esc(dayLabel(d.date))}<br><strong>${fmt(d.kcal)} kcal</strong> ${d.logged ? `· ${diff > 0 ? `${fmt(diff)} over` : `${fmt(-diff)} under`}` : "· nothing logged"}`;
            const hit = root.querySelector(`.bar-hit[data-i="${i}"]`);
            const box = hit.getBoundingClientRect();
            const rootBox = root.getBoundingClientRect();
            const x = clamp(box.left + box.width / 2 - rootBox.left, 70, rootBox.width - 70);
            tip.style.left = `${x}px`;
            tip.style.top = "0px";
        };
        const hide = () => {
            root.classList.remove("has-focus");
            if (tip) { tip.remove(); tip = null; }
        };
        svg.addEventListener("pointerover", (e) => { const i = e.target.dataset && e.target.dataset.i; if (i !== undefined) show(Number(i)); });
        svg.addEventListener("pointerdown", (e) => { const i = e.target.dataset && e.target.dataset.i; if (i !== undefined) show(Number(i)); });
        svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
    }

    // ══════════════════════════════════════════
    // FOODS
    // ══════════════════════════════════════════
    async function renderFoods(reload) {
        const body = $("foods-body");
        if (reload) {
            if (!state.recent.length && !state.presets.length) body.innerHTML = '<div class="skel" style="height:200px"></div>';
            try {
                [state.recent, state.presets] = await Promise.all([get("/api/meals/recent?limit=40"), get("/api/presets")]);
            } catch (e) { toastError(e); return; }
        }
        const q = state.foodsQuery.trim().toLowerCase();
        const match = (f) => !q || f.name.toLowerCase().includes(q);
        const presets = state.presets.filter(match);
        const recent = state.recent.filter(match);
        const row = (f, kind, i) => `
            <li class="food-row">
                <button class="food-row-main" data-action="food-open" data-kind="${kind}" data-index="${i}">
                    <span class="food-row-name">${esc(f.name)}</span>
                    <span class="food-row-meta">${f.nutri_grade ? nsMini(f.nutri_grade) : ""}<span>${fmt(f.calories)} kcal · P ${fmt(f.protein)} · C ${fmt(f.carbs)} · F ${fmt(f.fat)}</span>${f.times_logged > 1 ? `<span>· ${f.times_logged}×</span>` : ""}</span>
                </button>
                <button class="food-add" data-action="food-log" data-kind="${kind}" data-index="${i}" aria-label="Log ${esc(f.name)}">${icon("plus")}</button>
            </li>`;
        body.innerHTML = `
            <h2 class="section-label">Saved</h2>
            ${presets.length ? `<ul class="food-list">${presets.map((f) => row(f, "preset", state.presets.indexOf(f))).join("")}</ul>`
                : `<p class="empty-note">${q ? "No saved foods match." : "Save foods you eat often and log them in one tap. Use New, or “Save to My foods” on any entry."}</p>`}
            <h2 class="section-label">Recent</h2>
            ${recent.length ? `<ul class="food-list">${recent.map((f) => row(f, "recent", state.recent.indexOf(f))).join("")}</ul>`
                : `<p class="empty-note">${q ? "Nothing recent matches." : "Foods you log show up here."}</p>`}`;
    }

    function foodFrom(kind, index) {
        return kind === "preset" ? state.presets[index] : state.recent[index];
    }

    function openFoodSheet(kind, index) {
        const f = foodFrom(kind, index);
        if (!f) return;
        let factor = 1;
        const render = (el) => {
            el.querySelector('[data-role="kcal"]').textContent = fmt(f.calories * factor);
            el.querySelector('[data-role="macros"]').innerHTML = `
                <span style="--c:var(--protein)"><i></i>Protein ${r1(f.protein * factor)} g</span>
                <span style="--c:var(--carbs)"><i></i>Carbs ${r1(f.carbs * factor)} g</span>
                <span style="--c:var(--fat)"><i></i>Fat ${r1(f.fat * factor)} g</span>`;
            el.querySelector('[data-role="log"]').textContent = `Log ${fmt(f.calories * factor)} kcal`;
        };
        openSheet({
            title: f.name,
            body: `
                <div class="detail-total"><span class="big-num" data-role="kcal"></span><span class="hero-caption">kcal</span></div>
                <div class="detail-macros" data-role="macros"></div>
                <div><p class="field-row-label">Portion</p><div class="chips">
                    ${[0.5, 1, 1.5, 2, 3].map((x) => `<button type="button" class="chip ${x === 1 ? "is-on" : ""}" data-action="pick-chip" data-group="factor" data-value="${x}">${x === 1 ? "1 portion" : `×${x}`}</button>`).join("")}
                </div></div>
                <div><p class="field-row-label">Meal</p>${mealTypeSeg(currentMealType())}</div>
                ${f.description ? `<p class="muted" style="margin:0">${esc(f.description)}</p>` : ""}
                ${kind === "preset" ? `<button class="btn btn-ghost btn-sm" data-role="delete" style="justify-self:start">${icon("trash")}Remove from My foods</button>` : ""}`,
            foot: '<button class="btn btn-primary btn-block" data-role="log">Log</button>',
            onMount(el) {
                render(el);
                el.addEventListener("click", (e) => {
                    const chip = e.target.closest('[data-group="factor"]');
                    if (chip) setTimeout(() => { factor = parseFloat(chip.dataset.value); render(el); });
                });
                el.querySelector('[data-role="log"]').addEventListener("click", async (ev) => {
                    setBusy(ev.currentTarget, true);
                    try {
                        const notify = await logMeals([{ name: f.name, calories: r1(f.calories * factor), protein: r1(f.protein * factor), carbs: r1(f.carbs * factor),
                            fat: r1(f.fat * factor), weight_g: Math.round((f.weight_g || 0) * factor), barcode: f.barcode || null,
                            nutri_grade: f.nutri_grade || null, source: kind === "preset" ? "preset" : "recent" }], { mealType: chipValue(el, "meal_type"), deferToast: true });
                        await back();
                        notify();
                        await refreshDay();
                    } catch (e) { toastError(e); setBusy(ev.currentTarget, false); }
                });
                const delBtn = el.querySelector('[data-role="delete"]');
                if (delBtn) delBtn.addEventListener("click", async () => {
                    try {
                        await del(`/api/presets/${f.id}`);
                        await back();
                        await renderFoods(true);
                        toast(`Removed ${f.name} from My foods`);
                    } catch (e) { toastError(e); }
                });
            },
        });
    }

    function openNewPreset() {
        openSheet({
            title: "New saved food",
            body: foodFormHtml({}, { showPresetToggle: false }),
            foot: '<button class="btn btn-primary btn-block" data-role="save">Save food</button>',
            onMount(el) {
                const form = el.querySelector("form");
                const save = async () => {
                    const food = readFoodForm(form);
                    if (!food) return;
                    try {
                        await post("/api/presets", { name: food.name, calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat });
                        await back();
                        await renderFoods(true);
                        toast(`Saved ${food.name}`);
                    } catch (e) { toastError(e); }
                };
                el.querySelector('[data-role="save"]').addEventListener("click", save);
                form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
            },
        });
    }

    // ══════════════════════════════════════════
    // PROFILE (Me)
    // ══════════════════════════════════════════
    async function renderMe() {
        $("me-title").textContent = state.username || "You";
        const body = $("me-body");
        if (!state.profile) body.innerHTML = '<div class="skel" style="height:300px"></div>';
        try {
            const [profile, goals] = await Promise.all([get("/api/profile"), loadGoals()]);
            state.profile = profile;
            if (state.tab !== "me") return;
            const p = profile;
            const opt = (v, label, cur) => `<option value="${v}" ${v === (cur || "") ? "selected" : ""}>${label}</option>`;
            const rec = goals.recommended_calories;
            body.innerHTML = `
                <section class="me-section">
                    <h2>Daily budget</h2>
                    <p>The calories you aim to eat each day. Everything on Today counts against this.</p>
                    <div class="budget-stepper">
                        <button class="icon-btn" data-action="budget-step" data-step="-50" aria-label="Decrease by 50">${icon("minus")}</button>
                        <input class="input" id="budget-input" inputmode="numeric" value="${goals.calories}" aria-label="Daily calorie budget">
                        <button class="icon-btn" data-action="budget-step" data-step="50" aria-label="Increase by 50">${icon("plus")}</button>
                    </div>
                    ${rec && Math.abs(rec - goals.calories) >= 25 ? `<div class="recommend"><span>Your profile suggests <strong>${fmt(rec)} kcal</strong></span>
                        <button class="btn btn-sm btn-primary" data-action="use-recommended" data-kcal="${rec}">Use it</button></div>` : ""}
                    <dl class="kv">
                        <div><dt>Protein</dt><dd>${fmt(goals.protein)} g</dd></div>
                        <div><dt>Carbs</dt><dd>${fmt(goals.carbs)} g</dd></div>
                        <div><dt>Fat</dt><dd>${fmt(goals.fat)} g</dd></div>
                    </dl>
                </section>

                <section class="me-section">
                    <h2>Body & goal</h2>
                    <p>Used to suggest a budget and protein target. Stays on your server.</p>
                    <form class="form" id="profile-form" novalidate>
                        <div class="grid-2">
                            <label class="field"><span class="field-label">Height</span><span class="input-unit"><input class="input" name="height_cm" inputmode="decimal" value="${p.height_cm ?? ""}" placeholder="175"><span>cm</span></span></label>
                            <label class="field"><span class="field-label">Weight</span><span class="input-unit"><input class="input" name="weight_kg" inputmode="decimal" value="${p.weight_kg ?? ""}" placeholder="70"><span>kg</span></span></label>
                            <label class="field"><span class="field-label">Age</span><input class="input" name="age" inputmode="numeric" value="${p.age ?? ""}" placeholder="30"></label>
                            <label class="field"><span class="field-label">Sex</span><select class="input" name="gender">${opt("", "Choose", p.gender)}${opt("male", "Male", p.gender)}${opt("female", "Female", p.gender)}</select></label>
                        </div>
                        <label class="field"><span class="field-label">Activity</span><select class="input" name="activity_level">
                            ${opt("", "Choose", p.activity_level)}${opt("sedentary", "Mostly sitting", p.activity_level)}${opt("light", "Light exercise 1–3 days a week", p.activity_level)}
                            ${opt("moderate", "Exercise 3–5 days a week", p.activity_level)}${opt("active", "Hard exercise 6–7 days a week", p.activity_level)}${opt("very_active", "Physical job or training twice a day", p.activity_level)}
                        </select></label>
                        <div><p class="field-row-label">Goal</p><div class="seg">
                            ${[["lose", "Lose"], ["maintain", "Maintain"], ["gain", "Gain"]].map(([k, l]) => `<button type="button" class="seg-btn ${(p.goal || "maintain") === k ? "is-on" : ""}" data-action="pick-seg" data-group="goal" data-value="${k}">${l}</button>`).join("")}
                        </div></div>
                        <button class="btn btn-secondary" type="submit">Save profile</button>
                    </form>
                    ${goals.bmr ? `<dl class="kv">
                        <div><dt>BMI</dt><dd>${goals.bmi ?? "—"}</dd></div>
                        <div><dt>At rest</dt><dd>${fmt(goals.bmr)}</dd></div>
                        <div><dt>Maintenance</dt><dd>${fmt(goals.tdee)}</dd></div>
                    </dl>` : ""}
                </section>

                <section class="me-section">
                    <h2>Your data</h2>
                    <p>Download a backup of everything, or restore one.</p>
                    <div class="row-actions">
                        <button class="btn btn-secondary btn-sm" data-action="export">Download backup</button>
                        <button class="btn btn-secondary btn-sm" data-action="import">Restore backup</button>
                        <button class="btn btn-danger btn-sm" data-action="clear-day">Clear ${esc(dayLabel(state.date).toLowerCase())}'s log</button>
                    </div>
                </section>

                <section class="me-section">
                    <h2>Password</h2>
                    <form class="form" id="password-form" novalidate>
                        <div class="grid-2">
                            <label class="field"><span class="field-label">Current</span><input class="input" type="password" name="old" autocomplete="current-password" maxlength="128"></label>
                            <label class="field"><span class="field-label">New</span><input class="input" type="password" name="new" autocomplete="new-password" minlength="4" maxlength="128"></label>
                        </div>
                        <button class="btn btn-secondary" type="submit">Change password</button>
                    </form>
                </section>

                <section class="me-section">
                    <button class="btn btn-ghost" data-action="sign-out">Sign out of ${esc(state.username || "")}</button>
                </section>`;

            $("budget-input").addEventListener("change", (e) => saveBudget(e.target.value));
            $("profile-form").addEventListener("submit", saveProfile);
            $("password-form").addEventListener("submit", changePassword);
        } catch (e) { toastError(e); }
    }

    let budgetTimer = null;
    function stepBudget(step) {
        const input = $("budget-input");
        const v = clamp((num(input.value) || 2000) + step, 500, 10000);
        input.value = v;
        vibrate(5);
        clearTimeout(budgetTimer);
        budgetTimer = setTimeout(() => saveBudget(v), 600);
    }

    async function saveBudget(value) {
        const v = Math.round(num(value) || 0);
        if (v < 500 || v > 10000) { toast("Set a budget between 500 and 10,000 kcal.", { error: true }); return; }
        try {
            await put("/api/budget", { daily_calories: v });
            await loadGoals();
            toast(`Budget set to ${fmt(v)} kcal`);
            renderMe();
            renderToday();
        } catch (e) { toastError(e); }
    }

    async function saveProfile(e) {
        e.preventDefault();
        const form = e.target;
        const fd = new FormData(form);
        const body = {};
        const ranges = { height_cm: [50, 300], weight_kg: [10, 500], age: [1, 150] };
        for (const [k, [lo, hi]] of Object.entries(ranges)) {
            const raw = String(fd.get(k) || "").trim();
            if (!raw) continue;
            const v = num(raw);
            if (v === null || v < lo || v > hi) { toast(`${FIELD_NAMES[k]} should be between ${lo} and ${hi}.`, { error: true }); return; }
            body[k] = k === "age" ? Math.round(v) : v;
        }
        if (fd.get("gender")) body.gender = fd.get("gender");
        if (fd.get("activity_level")) body.activity_level = fd.get("activity_level");
        const goal = form.querySelector('[data-group="goal"].is-on');
        if (goal) body.goal = goal.dataset.value;
        const btn = e.submitter;
        setBusy(btn, true);
        try {
            await put("/api/profile", body);
            await loadGoals();
            toast("Profile saved");
            await renderMe();
            renderToday();
        } catch (ex) { toastError(ex); } finally { setBusy(btn, false); }
    }

    async function changePassword(e) {
        e.preventDefault();
        const fd = new FormData(e.target);
        if (String(fd.get("new") || "").length < 4) { toast("Use at least 4 characters for the new password.", { error: true }); return; }
        try {
            await put("/api/auth/change-password", { old_password: fd.get("old"), new_password: fd.get("new") });
            e.target.reset();
            toast("Password changed");
        } catch (ex) { toastError(ex); }
    }

    async function exportData() {
        try {
            const data = await get("/api/export");
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `calorie-vision-${todayIso()}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            toast("Backup downloaded");
        } catch (e) { toastError(e); }
    }

    async function importFile(file) {
        if (!file) return;
        let data;
        try { data = JSON.parse(await file.text()); } catch (_) { toast("That file isn't a Calorie Vision backup.", { error: true }); return; }
        const count = Array.isArray(data.meals) ? data.meals.length : 0;
        const ok = await confirmSheet({ title: "Restore backup?", message: `This adds ${count} meals and any saved foods to your account. Existing entries stay.`, confirm: "Restore" });
        if (!ok) return;
        try {
            await put("/api/import", data);
            await refreshAll();
            toast("Backup restored");
            renderMe();
        } catch (e) { toastError(e); }
    }

    async function clearDay() {
        const day = state.day;
        if (!day || !day.meals.length) { toast(`Nothing logged ${dayLabel(state.date).toLowerCase()}.`); return; }
        const ok = await confirmSheet({ title: `Clear ${dayLabel(state.date).toLowerCase()}?`, message: `This deletes all ${day.meals.length} entries for ${dayLabel(state.date, true)}. It can't be undone.`, confirm: "Delete all", danger: true });
        if (!ok) return;
        try {
            for (const m of day.meals) await del(`/api/meals/${m.id}`);
            await refreshDay();
            toast("Cleared");
        } catch (e) { toastError(e); }
    }

    // ══════════════════════════════════════════
    // EVENTS
    // ══════════════════════════════════════════
    const actions = {
        "auth-mode": (el) => setAuthMode(el.dataset.mode),
        "toggle-password": (el) => {
            const input = $(el.dataset.target);
            const show = input.type === "password";
            input.type = show ? "text" : "password";
            el.textContent = show ? "Hide" : "Show";
            el.setAttribute("aria-label", show ? "Hide password" : "Show password");
        },
        "show-reset": () => showAuth("reset"),
        "hide-reset": () => showAuth("main"),
        "sign-out": () => signOut(),

        tab: (el) => switchTab(el.dataset.tab),
        "tab-foods": async () => { await back(); switchTab("foods"); },
        "day-prev": () => changeDay(-1),
        "day-next": () => changeDay(1),
        "day-today": () => { if (state.date !== todayIso()) changeDay(0); },
        "goto-day": (el) => { state.date = el.dataset.date; state.day = null; switchTab("today"); renderToday(); refreshDay().catch(toastError); },
        water: (el) => addWater(parseInt(el.dataset.ml, 10)),

        "open-add": (el) => openAddSheet(el.dataset.mealType),
        "open-meal": (el) => openMealSheet(el.dataset.key),
        "quick-add": () => openQuickAdd({}, { replace: true }),
        "relog-recent": async (el) => { const f = state.recent[Number(el.dataset.index)]; await back(); relogRecent(f, state.addMealType); },

        "open-camera": () => openCamera(),
        "open-camera-replace": () => openCamera({ replace: true }),
        "pick-photo": () => $("photo-input").click(),
        capture: () => capturePhoto(),
        "swap-to-barcode": () => { stopCamera(); openScanner({ replace: true }); },
        retake: () => openCamera({ replace: true }),
        hint: (el) => {
            const box = $("review-desc");
            const hint = el.dataset.hint;
            const parts = box.value.split(/,\s*/).filter(Boolean);
            const i = parts.indexOf(hint);
            if (i >= 0) parts.splice(i, 1); else parts.push(hint);
            box.value = parts.join(", ");
            el.classList.toggle("is-on", i < 0);
        },
        analyze: () => analyze(),
        "cancel-analyze": () => { if (analyzeCtl) analyzeCtl.abort(); clearInterval(statusTimer); openReview({ replace: true }); },
        "result-portion": (el) => {
            const it = state.analysis.items[Number(el.dataset.index)];
            it.factor = clamp(Math.round((it.factor + parseFloat(el.dataset.step)) * 100) / 100, 0.25, 5);
            vibrate(5);
            renderResults();
        },
        "result-remove": (el) => { state.analysis.items.splice(Number(el.dataset.index), 1); renderResults(); },
        "result-edit": (el) => editResultItem(Number(el.dataset.index)),
        "result-add": () => editResultItem(-1),
        "log-results": () => logResults(),

        "open-scanner": () => openScanner(),
        rescan: () => openScanner({ replace: true }),
        torch: async (el) => {
            if (!scanner) return;
            const on = el.getAttribute("aria-pressed") !== "true";
            if (await scanner.setTorch(on)) el.setAttribute("aria-pressed", String(on));
        },
        "scan-photo": () => $("barcode-photo-input").click(),
        "product-portion": (el) => {
            state.product.grams = parseFloat(el.dataset.g);
            $("product-grams").value = r1(state.product.grams);
            document.querySelectorAll('[data-action="product-portion"]').forEach((c) => c.classList.toggle("is-on", c === el));
            updateProductPortion();
        },
        "log-product": () => logProduct(),
        "product-ai-retry": () => rateWithAi(),
        "product-manual": async () => {
            const p = state.product;
            const prefill = p ? { name: p.name, weight_g: p.serving_g || "" } : {};
            await closeAll();
            openQuickAdd(prefill, { source: "barcode" });
        },

        "food-open": (el) => openFoodSheet(el.dataset.kind, Number(el.dataset.index)),
        "food-log": (el) => {
            const f = foodFrom(el.dataset.kind, Number(el.dataset.index));
            if (f) relogRecent(f, guessMealType());
        },
        "new-preset": () => openNewPreset(),
        range: (el) => {
            state.range = Number(el.dataset.days);
            document.querySelectorAll('[data-action="range"]').forEach((b) => b.classList.toggle("is-on", b === el));
            renderProgress();
        },

        "budget-step": (el) => stepBudget(Number(el.dataset.step)),
        "use-recommended": (el) => saveBudget(el.dataset.kcal),
        export: () => exportData(),
        import: () => $("import-input").click(),
        "clear-day": () => clearDay(),

        "pick-chip": (el) => {
            el.parentElement.querySelectorAll(`[data-group="${el.dataset.group}"]`).forEach((c) => {
                c.classList.toggle("is-on", c === el);
                c.setAttribute("aria-checked", String(c === el));
            });
            if (el.dataset.group === "result_meal_type" && state.analysis) state.analysis.mealType = el.dataset.value;
            if (el.dataset.group === "product_meal_type" && state.product) state.product.mealType = el.dataset.value;
        },
        "pick-seg": (el) => {
            el.parentElement.querySelectorAll(".seg-btn").forEach((c) => c.classList.toggle("is-on", c === el));
        },
        back: () => back(),
    };

    function init() {
        history.replaceState({ cvBase: true }, "");

        document.addEventListener("click", (e) => {
            const el = e.target.closest("[data-action]");
            if (!el || el.disabled) return;
            const fn = actions[el.dataset.action];
            if (!fn) return;
            e.preventDefault();
            Promise.resolve(fn(el, e)).catch(toastError);
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && layers.length) back();
        });

        $("auth-form").addEventListener("submit", submitAuth);
        $("reset-request-form").addEventListener("submit", submitResetRequest);
        $("reset-form").addEventListener("submit", submitReset);
        $("change-form").addEventListener("submit", submitChange);
        $("barcode-form").addEventListener("submit", submitBarcode);
        $("barcode-input").addEventListener("focus", () => { if (scanner) scanner.running = false; });
        $("barcode-input").addEventListener("blur", () => { if (scanner && !$("screen-scanner").hidden) scanner.resume(); });

        $("photo-input").addEventListener("change", (e) => { handlePhotoFile(e.target.files[0]); e.target.value = ""; });
        $("barcode-photo-input").addEventListener("change", (e) => { scanFromPhoto(e.target.files[0]); e.target.value = ""; });
        $("import-input").addEventListener("change", (e) => { importFile(e.target.files[0]); e.target.value = ""; });

        let searchTimer = null;
        $("foods-search").addEventListener("input", (e) => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { state.foodsQuery = e.target.value; renderFoods(false); }, 120);
        });

        // Cameras must not keep running in the background.
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                stopAllCameras();
            } else if (!$("screen-scanner").hidden) {
                openScanner({ replace: true });
            } else if (!$("screen-camera").hidden) {
                openCamera({ replace: true });
            } else if (state.token && state.tab === "today" && state.date !== todayIso() && state.day && state.date === addDays(todayIso(), -1)) {
                // Day rolled over while the app was in the background.
                changeDay(0);
            }
        });

        boot();
    }

    async function boot() {
        if (!state.token) { setAuthMode("login"); showAuth("main"); return; }
        try {
            const me = await get("/api/auth/me");
            state.username = me.username;
            if (me.must_change_password) { showAuth("change"); return; }
            await enterApp();
            window.CVScanner && setTimeout(() => window.CVScanner.preload(), 3000);
        } catch (e) {
            if (e.status === 401) { signOut(); return; }
            // Offline or server down: show the shell and let the toast explain.
            $("view-auth").hidden = true;
            $("tabs").hidden = false;
            renderToday();
            toastError(e);
        }
    }

    document.addEventListener("DOMContentLoaded", init);
})();
