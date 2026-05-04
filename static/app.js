/* ═══════════════════════════════════════════════
   Calorie Vision — App Logic (Database Backend)
   ═══════════════════════════════════════════════ */

(function () {
    "use strict";

    const DEFAULT_BUDGET = 2000;

    let token = sessionStorage.getItem("cv_token") || null;
    let currentUsername = sessionStorage.getItem("cv_username") || null;

    function setAuth(t, username) {
        token = t;
        currentUsername = username;
        sessionStorage.setItem("cv_token", t);
        sessionStorage.setItem("cv_username", username);
    }

    function clearAuth() {
        token = null;
        currentUsername = null;
        sessionStorage.removeItem("cv_token");
        sessionStorage.removeItem("cv_username");
    }

    function todayStr() {
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
    }

    // ══════════════════════════════════════════
    // API HELPERS
    // ══════════════════════════════════════════

    async function apiGet(path) {
        const res = await fetch(path, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) { clearAuth(); showView("login"); throw new Error("Unauthorized"); }
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Request failed"); }
        return res.json();
    }

    async function apiPost(path, body) {
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
        if (res.status === 401) { clearAuth(); showView("login"); throw new Error("Unauthorized"); }
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Request failed"); }
        return res.json();
    }

    async function apiPut(path, body) {
        const res = await fetch(path, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
        });
        if (res.status === 401) { clearAuth(); showView("login"); throw new Error("Unauthorized"); }
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Request failed"); }
        return res.json();
    }

    async function apiDelete(path) {
        const res = await fetch(path, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) { clearAuth(); showView("login"); throw new Error("Unauthorized"); }
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Request failed"); }
        return res.json();
    }

    // ══════════════════════════════════════════
    // DOM REFERENCES
    // ══════════════════════════════════════════
    const $ = (id) => document.getElementById(id);

    const views = {
        login: $("view-login"),
        home: $("view-home"),
        manual: $("view-manual"),
        camera: $("view-camera"),
        barcode: $("view-barcode"),
        barcodeResult: $("view-barcode-result"),
        review: $("view-review"),
        loading: $("view-loading"),
        results: $("view-results"),
        settings: $("view-settings"),
    };

    const els = {
        loginUsername: $("login-username"),
        loginPassword: $("login-password"),
        loginError: $("login-error"),
        loginSubtitle: $("login-subtitle"),
        changePasswordSection: $("change-password-section"),
        cpOldPassword: $("cp-old-password"),
        cpNewPassword: $("cp-new-password"),
        greeting: $("greeting"),
        calorieStatus: $("calorie-status"),
        progressBar: $("progress-bar"),
        remainingLabel: $("remaining-label"),
        mealList: $("meal-list"),
        historyList: $("history-list"),
        historySection: $("history-section"),
        cameraPreview: $("camera-preview"),
        barcodeVideo: $("barcode-video"),
        barcodeResultContent: $("barcode-result-content"),
        capturedCanvas: $("captured-canvas"),
        foodDescription: $("food-description"),
        resultsItems: $("results-items"),
        resultsTotal: $("results-total"),
        resultsSuggestion: $("results-suggestion"),
        warningBanner: $("warning-banner"),
        warningText: $("warning-text"),
        settingName: $("setting-name"),
        settingBudget: $("setting-budget"),
        dailyProtein: $("daily-protein"),
        dailyCarbs: $("daily-carbs"),
        dailyFat: $("daily-fat"),
        proteinGoal: $("protein-goal"),
        carbsGoal: $("carbs-goal"),
        fatGoal: $("fat-goal"),
        btnExportData: $("btn-export-data"),
        btnImportData: $("btn-import-data"),
        fileImport: $("file-import"),
        manualPresets: $("manual-presets"),
        btnDeletePreset: $("btn-delete-preset"),
        manualSavePreset: $("manual-save-preset"),
        presetSelectorGroup: $("preset-selector-group"),
        profilePreview: $("profile-preview"),
        profileCardContent: $("profile-card-content"),
        tdeeResult: $("tdee-result"),
        profileHeight: $("profile-height"),
        profileWeight: $("profile-weight"),
        profileAge: $("profile-age"),
        profileGender: $("profile-gender"),
        profileActivity: $("profile-activity"),
        profileGoal: $("profile-goal"),
    };

    // ══════════════════════════════════════════
    // VIEW SWITCHING
    // ══════════════════════════════════════════
    function showView(name) {
        Object.values(views).forEach((v) => v.classList.remove("active"));
        const v = views[name];
        if (v) v.classList.add("active");

        const header = $("app-header");
        const hideHeader = ["login", "camera", "barcode", "barcodeResult", "loading", "review"].includes(name);
        header.style.display = hideHeader ? "none" : "";
    }

    // ══════════════════════════════════════════
    // AUTH
    // ══════════════════════════════════════════

    function showLoginError(msg) {
        els.loginError.textContent = msg;
        els.loginError.style.display = "block";
    }

    function hideLoginError() {
        els.loginError.style.display = "none";
    }

    async function handleLogin() {
        hideLoginError();
        const username = els.loginUsername.value.trim();
        const password = els.loginPassword.value;
        if (!username || !password) { showLoginError("Please enter username and password"); return; }
        try {
            const data = await apiPost("/api/auth/login", { username, password });
            setAuth(data.token, data.username);
            if (data.must_change_password) {
                showChangePasswordPrompt();
            } else {
                loadAndShowHome();
            }
        } catch (e) {
            showLoginError(e.message);
        }
    }

    async function handleRegister() {
        hideLoginError();
        const username = els.loginUsername.value.trim();
        const password = els.loginPassword.value;
        if (!username || !password) { showLoginError("Please enter username and password"); return; }
        if (password.length < 4) { showLoginError("Password must be at least 4 characters"); return; }
        try {
            const data = await apiPost("/api/auth/register", { username, password });
            setAuth(data.token, data.username);
            loadAndShowHome();
        } catch (e) {
            showLoginError(e.message);
        }
    }

    function showChangePasswordPrompt() {
        els.changePasswordSection.style.display = "block";
        els.loginSubtitle.textContent = "You must change your password before continuing";
        $("btn-login").style.display = "none";
        $("btn-register").style.display = "none";
    }

    async function handleChangePassword() {
        const oldPw = els.cpOldPassword.value;
        const newPw = els.cpNewPassword.value;
        if (!oldPw || !newPw) { showLoginError("Please fill in both password fields"); return; }
        if (newPw.length < 4) { showLoginError("New password must be at least 4 characters"); return; }
        try {
            await apiPut("/api/auth/change-password", { old_password: oldPw, new_password: newPw });
            els.changePasswordSection.style.display = "none";
            $("btn-login").style.display = "";
            $("btn-register").style.display = "";
            loadAndShowHome();
        } catch (e) {
            showLoginError(e.message);
        }
    }

    function handleLogout() {
        clearAuth();
        stopCamera();
        stopBarcodeScanner();
        showView("login");
    }

    async function loadAndShowHome() {
        await Promise.all([renderMealLog(), renderHistory(), updateHeader(), renderProfilePreview()]);
        showView("home");
    }

    // ══════════════════════════════════════════
    // DATA LOADERS
    // ══════════════════════════════════════════

    async function loadBudget() {
        try {
            const b = await apiGet("/api/budget");
            return b.daily_calories;
        } catch {
            return DEFAULT_BUDGET;
        }
    }

    async function loadGoals() {
        try {
            return await apiGet("/api/goals");
        } catch {
            return { calories: DEFAULT_BUDGET, protein: 150, carbs: 200, fat: 67, water_ml: 2500, tdee: DEFAULT_BUDGET, bmr: 1800, bmi: null };
        }
    }

    async function loadProfile() {
        try {
            return await apiGet("/api/profile");
        } catch {
            return {};
        }
    }

    async function getTodayMeals() {
        try {
            return await apiGet(`/api/meals?date=${todayStr()}`);
        } catch {
            return { meals: [], total_calories: 0, total_protein: 0, total_carbs: 0, total_fat: 0 };
        }
    }

    async function loadPresets() {
        try {
            return await apiGet("/api/presets");
        } catch {
            return [];
        }
    }

    async function loadHistory() {
        try {
            const data = await apiGet("/api/history");
            return data.days.filter((d) => d.date !== todayStr());
        } catch {
            return [];
        }
    }

    // ══════════════════════════════════════════
    // HEADER / PROGRESS
    // ══════════════════════════════════════════
    async function updateHeader() {
        const [budget, data, goals] = await Promise.all([loadBudget(), getTodayMeals(), loadGoals()]);
        const consumed = data.total_calories;
        const remaining = Math.max(0, budget - consumed);
        const pct = budget > 0 ? Math.min(100, (consumed / budget) * 100) : 0;

        els.greeting.textContent = `Hello, ${currentUsername}!`;
        els.calorieStatus.textContent = `${Math.round(consumed)} / ${budget} kcal`;
        els.progressBar.style.width = `${pct}%`;
        els.progressBar.classList.remove("warning", "danger");
        if (pct >= 90) els.progressBar.classList.add("danger");
        else if (pct >= 75) els.progressBar.classList.add("warning");
        els.remainingLabel.textContent = `${Math.round(remaining)} kcal remaining`;

        els.dailyProtein.textContent = Math.round(data.total_protein);
        els.dailyCarbs.textContent = Math.round(data.total_carbs);
        els.dailyFat.textContent = Math.round(data.total_fat);
        els.proteinGoal.textContent = `/ ${goals.protein}g`;
        els.carbsGoal.textContent = `/ ${goals.carbs}g`;
        els.fatGoal.textContent = `/ ${goals.fat}g`;

        els.waterInfo && (els.waterInfo.textContent = `${goals.water_ml}ml`);

        if (els.warningBanner) {
            if (consumed > budget) {
                els.warningBanner.classList.remove("hidden", "warn");
                els.warningBanner.classList.add("over");
                els.warningText.textContent = `Over budget by ${Math.round(consumed - budget)} kcal!`;
            } else if (pct >= 85) {
                els.warningBanner.classList.remove("hidden", "over");
                els.warningBanner.classList.add("warn");
                els.warningText.textContent = `Approaching your daily limit (${Math.round(remaining)} kcal left)`;
            } else {
                els.warningBanner.classList.add("hidden");
            }
        }
    }

    // ══════════════════════════════════════════
    // PROFILE PREVIEW (on home page)
    // ══════════════════════════════════════════
    async function renderProfilePreview() {
        const profile = await loadProfile();
        const hasData = profile.height_cm || profile.weight_kg || profile.bmi;
        if (!hasData) {
            els.profilePreview.style.display = "none";
            return;
        }
        els.profilePreview.style.display = "";

        const bmi = profile.bmi || (profile.height_cm && profile.weight_kg
            ? (profile.weight_kg / ((profile.height_cm / 100) ** 2)).toFixed(1)
            : null);
        let bmiCategory = "";
        let bmiColor = "";
        if (bmi !== null) {
            const b = parseFloat(bmi);
            if (b < 18.5) { bmiCategory = "Underweight"; bmiColor = "#60a5fa"; }
            else if (b < 25) { bmiCategory = "Healthy"; bmiColor = "#34d399"; }
            else if (b < 30) { bmiCategory = "Overweight"; bmiColor = "#fbbf24"; }
            else { bmiCategory = "Obese"; bmiColor = "#f87171"; }
        }

        els.profileCardContent.innerHTML = `
            <div class="pc-stats">
                <div class="pc-stat">
                    <span class="pc-val">${profile.height_cm || "—"}</span>
                    <span class="pc-lbl">Height (cm)</span>
                </div>
                <div class="pc-stat">
                    <span class="pc-val">${profile.weight_kg || "—"}</span>
                    <span class="pc-lbl">Weight (kg)</span>
                </div>
                <div class="pc-stat">
                    <span class="pc-val" style="color:${bmiColor}">${bmi || "—"}</span>
                    <span class="pc-lbl" style="color:${bmiColor}">BMI ${bmiCategory ? "· " + bmiCategory : ""}</span>
                </div>
            </div>`;

        const goals = await loadGoals();
        if (goals.tdee) {
            els.profileCardContent.innerHTML += `
                <div class="pc-goals">
                    <div class="pc-goal-row"><span>TDEE</span><span>${Math.round(goals.tdee)} kcal</span></div>
                    <div class="pc-goal-row"><span>BMR</span><span>${Math.round(goals.bmr)} kcal</span></div>
                    <div class="pc-goal-row"><span>Target</span><span>${Math.round(goals.calories)} kcal</span></div>
                    <div class="pc-goal-row"><span>Water</span><span>${Math.round(goals.water_ml)} ml</span></div>
                </div>`;
        }
    }

    // ══════════════════════════════════════════
    // MEAL LOG RENDERING
    // ══════════════════════════════════════════
    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    async function renderMealLog() {
        const data = await getTodayMeals();
        const list = els.mealList;
        if (data.meals.length === 0) {
            list.innerHTML = '<p class="empty-state">No meals logged yet. Tap "Scan Meal" to start!</p>';
            return;
        }
        list.innerHTML = data.meals
            .map(
                (m) => `
            <div class="meal-card" data-meal-id="${m.id}">
                <div class="meal-card-info">
                    <span class="meal-card-name">${escapeHtml(m.name)}</span>
                    <span class="meal-card-time">P:${Math.round(m.protein)}g C:${Math.round(m.carbs)}g F:${Math.round(m.fat)}g</span>
                </div>
                <div class="meal-card-right">
                    <span class="meal-card-calories">${Math.round(m.calories)} kcal</span>
                    <button class="btn-remove-meal" data-id="${m.id}" aria-label="Remove meal">&times;</button>
                </div>
            </div>`
            )
            .join("");

        list.querySelectorAll(".btn-remove-meal").forEach((btn) => {
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                e.preventDefault();
                btn.disabled = true;
                const id = btn.dataset.id;
                try {
                    await apiDelete(`/api/meals/${id}`);
                } catch (err) {
                    alert("Failed to remove meal: " + err.message);
                    btn.disabled = false;
                    return;
                }
                await Promise.all([renderMealLog(), renderHistory(), updateHeader(), renderProfilePreview()]);
            });
        });

        list.querySelectorAll(".meal-card").forEach((card) => {
            card.addEventListener("click", () => {
                const id = card.dataset.mealId;
                getTodayMeals().then((fresh) => openEditMeal(id, fresh.meals));
            });
        });
    }

    // ══════════════════════════════════════════
    // HISTORY RENDERING
    // ══════════════════════════════════════════
    async function renderHistory() {
        const historyDays = await loadHistory();
        els.historySection.style.display = historyDays.length > 0 ? "" : "none";
        if (historyDays.length === 0) { els.historyList.innerHTML = ""; return; }

        const todayData = await getTodayMeals();
        const budget = await loadBudget();
        const allDays = historyDays.slice(0, 6);
        const chartDays = [
            { date: todayStr(), consumed: todayData.total_calories },
            ...allDays.map((d) => ({ date: d.date, consumed: d.total_calories })),
        ].reverse();

        const maxVal = Math.max(budget, ...chartDays.map((d) => d.consumed), 1);
        const budgetPct = (budget / maxVal) * 100;

        let chartHtml = '<div class="chart-wrapper">';
        chartHtml += '<div class="y-axis">';
        chartHtml += `<div class="y-tick" style="bottom:${budgetPct}%"><span>${budget}</span></div>`;
        chartHtml += "</div><div class=\"history-chart\">";
        if (budgetPct > 0 && budgetPct < 100) {
            chartHtml += `<div class="budget-line" style="bottom:${budgetPct}%"></div>`;
        }
        chartHtml += chartDays.map((d) => {
            const h = maxVal > 0 ? (d.consumed / maxVal) * 100 : 0;
            const over = d.consumed > budget;
            return `<div class="chart-col">
                <span class="chart-value">${Math.round(d.consumed)}</span>
                <div class="chart-bar-bg">
                    <div class="chart-bar-fill${over ? " over" : ""}" style="height:${h}%"></div>
                </div>
                <span class="chart-label">${d.date.slice(5)}</span>
            </div>`;
        }).join("");
        chartHtml += "</div></div>";

        let daysHtml = allDays.map((d) => `
            <div class="history-day">
                <div class="history-day-header">
                    <span>${d.date}</span>
                    <span class="history-day-total">${Math.round(d.total_calories)} kcal</span>
                </div>
                ${d.meals.map((m) => `
                    <div class="history-meal">
                        <span class="history-meal-name">${escapeHtml(m.name)}</span>
                        <span class="history-meal-cal">${Math.round(m.calories)} kcal</span>
                    </div>`).join("")}
            </div>`).join("");

        els.historyList.innerHTML = chartHtml + daysHtml;
    }

    // ══════════════════════════════════════════
    // CAMERA
    // ══════════════════════════════════════════
    let cameraStream = null;
    let capturedBase64 = null;
    let lastAnalysisResult = null;

    async function startCamera() {
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false,
            });
            els.cameraPreview.srcObject = cameraStream;
            els.cameraPreview.play();
            showView("camera");
        } catch (err) {
            alert("Camera access denied or unavailable.");
            console.error(err);
        }
    }

    function stopCamera() {
        if (cameraStream) {
            cameraStream.getTracks().forEach((t) => t.stop());
            cameraStream = null;
        }
    }

    function captureImage() {
        const video = els.cameraPreview;
        const canvas = $("hidden-canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);
        capturedBase64 = canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
        stopCamera();

        const display = els.capturedCanvas;
        display.width = Math.min(canvas.width, 400);
        display.height = (canvas.height / canvas.width) * display.width;
        display.getContext("2d").drawImage(canvas, 0, 0, display.width, display.height);

        showView("review");
    }

    // ══════════════════════════════════════════
    // AI ANALYSIS
    // ══════════════════════════════════════════
    async function analyzeImage() {
        showView("loading");
        try {
            const desc = els.foodDescription.value.trim() || null;
            const res = await apiPost("/api/analyze", { image: capturedBase64, description: desc });
            lastAnalysisResult = res;
            renderResults(res);
            showView("results");
        } catch (e) {
            alert("Analysis failed. Please try again.");
            console.error(e);
            showView("home");
            updateHeader();
        }
    }

    function renderResults(data) {
        els.resultsItems.innerHTML = data.items.map((item) => `
            <div class="result-item">
                <div class="result-item-header">
                    <span class="result-item-name">${escapeHtml(item.name)}</span>
                    <span class="result-item-cal">${Math.round(item.calories)} kcal</span>
                </div>
                <div class="result-item-macros">
                    <div class="macro-badge protein">P<span>${Math.round(item.protein)}g</span></div>
                    <div class="macro-badge carbs">C<span>${Math.round(item.carbs)}g</span></div>
                    <div class="macro-badge fat">F<span>${Math.round(item.fat)}g</span></div>
                    <div class="macro-badge weight">W<span>${Math.round(item.weight_g)}g</span></div>
                </div>
            </div>`).join("");

        els.resultsTotal.innerHTML = `
            <div class="total-header">Total</div>
            <div class="total-calories">${Math.round(data.total.calories)} kcal</div>
            <div class="total-macros">
                <div class="macro-badge protein">P<span>${Math.round(data.total.protein)}g</span></div>
                <div class="macro-badge carbs">C<span>${Math.round(data.total.carbs)}g</span></div>
                <div class="macro-badge fat">F<span>${Math.round(data.total.fat)}g</span></div>
            </div>`;

        els.resultsSuggestion.innerHTML = data.suggestions ? `<p>${escapeHtml(data.suggestions)}</p>` : "";
    }

    async function consumeMeal() {
        if (!lastAnalysisResult) return;
        const today = todayStr();
        for (const item of lastAnalysisResult.items) {
            try {
                await apiPost("/api/meals", {
                    name: item.name, calories: item.calories, protein: item.protein,
                    carbs: item.carbs, fat: item.fat, weight_g: item.weight_g, meal_date: today,
                });
            } catch (e) { console.error("Failed to log meal:", e); }
        }
        lastAnalysisResult = null;
        await Promise.all([renderMealLog(), renderHistory(), updateHeader(), renderProfilePreview()]);
        showView("home");
    }

    // ══════════════════════════════════════════
    // MANUAL ENTRY
    // ══════════════════════════════════════════
    async function openManualAdd() {
        $("manual-title").textContent = "Add Meal Manually";
        $("manual-edit-index").value = "-1";
        ["manual-name","manual-calories","manual-protein","manual-carbs","manual-fat","manual-desc"].forEach(id => $(id).value = "");
        els.manualSavePreset.checked = false;
        $("manual-save-text").textContent = "Add Meal";
        await populateManualPresets();
        showView("manual");
    }

    async function openEditMeal(mealId, meals) {
        const meal = meals.find((m) => String(m.id) === String(mealId));
        if (!meal) return;
        $("manual-title").textContent = "Edit Meal";
        $("manual-edit-index").value = mealId;
        $("manual-name").value = meal.name;
        $("manual-calories").value = meal.calories;
        $("manual-protein").value = meal.protein;
        $("manual-carbs").value = meal.carbs;
        $("manual-fat").value = meal.fat;
        $("manual-desc").value = "";
        els.manualSavePreset.checked = false;
        $("manual-save-text").textContent = "Update Meal";
        await populateManualPresets();
        showView("manual");
    }

    async function populateManualPresets() {
        const presets = await loadPresets();
        const select = els.manualPresets;
        select.innerHTML = '<option value="">Custom Entry...</option>';
        presets.forEach((p) => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = p.name;
            select.appendChild(opt);
        });
    }

    async function saveManualMeal() {
        const editId = parseInt($("manual-edit-index").value, 10);
        const name = $("manual-name").value.trim();
        const calStr = $("manual-calories").value.trim();
        const desc = $("manual-desc").value.trim();
        if (!name || !calStr) { alert("Meal name and calories are required."); return; }
        const calories = parseFloat(calStr);
        if (isNaN(calories)) { alert("Please enter a valid number for calories."); return; }
        const protein = parseFloat($("manual-protein").value) || 0;
        const carbs = parseFloat($("manual-carbs").value) || 0;
        const fat = parseFloat($("manual-fat").value) || 0;

        if (editId >= 0) {
            try { await apiDelete(`/api/meals/${editId}`); } catch (e) { /* ignore */ }
        }
        try {
            await apiPost("/api/meals", { name, calories, protein, carbs, fat, weight_g: 0, meal_date: todayStr() });
        } catch (e) {
            alert("Failed to save meal: " + e.message);
            return;
        }
        if (els.manualSavePreset.checked) {
            try { await apiPost("/api/presets", { name, calories, protein, carbs, fat, description: desc }); } catch (e) { /* ignore */ }
        }
        await Promise.all([renderMealLog(), renderHistory(), updateHeader(), renderProfilePreview()]);
        showView("home");
    }

    async function loadPresetToForm(presetId) {
        const presets = await loadPresets();
        const p = presets.find((pr) => String(pr.id) === String(presetId));
        if (!p) return;
        $("manual-name").value = p.name;
        $("manual-calories").value = p.calories;
        $("manual-protein").value = p.protein;
        $("manual-carbs").value = p.carbs;
        $("manual-fat").value = p.fat;
        $("manual-desc").value = p.description || "";
        els.btnDeletePreset.style.display = "inline-flex";
        els.manualSavePreset.checked = false;
    }

    async function deleteManualPreset() {
        const presetId = els.manualPresets.value;
        if (!presetId) return;
        if (!confirm("Delete this preset?")) return;
        try { await apiDelete(`/api/presets/${presetId}`); } catch (e) { alert("Failed to delete preset."); return; }
        await populateManualPresets();
        els.btnDeletePreset.style.display = "none";
        ["manual-name","manual-calories","manual-protein","manual-carbs","manual-fat","manual-desc"].forEach(id => $(id).value = "");
    }

    // ══════════════════════════════════════════
    // SETTINGS & PROFILE
    // ══════════════════════════════════════════
    async function openSettings() {
        const [budget, profile] = await Promise.all([loadBudget(), loadProfile()]);
        els.settingName.value = currentUsername;
        els.settingBudget.value = budget;
        els.profileHeight.value = profile.height_cm || "";
        els.profileWeight.value = profile.weight_kg || "";
        els.profileAge.value = profile.age || "";
        els.profileGender.value = profile.gender || "";
        els.profileActivity.value = profile.activity_level || "";
        els.profileGoal.value = profile.goal || "maintain";
        document.querySelectorAll(".goal-btn").forEach((b) => {
            b.classList.toggle("active", b.dataset.goal === els.profileGoal.value);
        });
        renderTDEEPreview();
        showView("settings");
    }

    function recalcTDEE() {
        const h = parseFloat(els.profileHeight.value);
        const w = parseFloat(els.profileWeight.value);
        const age = parseInt(els.profileAge.value);
        const gender = els.profileGender.value;
        const activity = els.profileActivity.value;
        const goal = els.profileGoal.value;

        if (!h || !w || !age || !gender || !activity) return null;

        let bmr;
        if (gender === "male") {
            bmr = (10 * w) + (6.25 * h) - (5 * age) + 5;
        } else {
            bmr = (10 * w) + (6.25 * h) - (5 * age) - 161;
        }

        const multipliers = {
            sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
        };
        const tdee = bmr * (multipliers[activity] || 1.2);

        const goalMod = { lose: 0.8, maintain: 1.0, gain: 1.15 };
        const target = Math.round(tdee * (goalMod[goal] || 1.0));

        const bmi = w / ((h / 100) ** 2);

        return { bmr: Math.round(bmr), tdee: Math.round(tdee), target, bmi: parseFloat(bmi.toFixed(1)) };
    }

    function renderTDEEPreview() {
        const result = recalcTDEE();
        if (!result) {
            els.tdeeResult.style.display = "none";
            return;
        }
        els.tdeeResult.style.display = "";
        const bmi = result.bmi;
        let bmiCat = "";
        let bmiColor = "";
        if (bmi < 18.5) { bmiCat = "Underweight"; bmiColor = "#60a5fa"; }
        else if (bmi < 25) { bmiCat = "Healthy"; bmiColor = "#34d399"; }
        else if (bmi < 30) { bmiCat = "Overweight"; bmiColor = "#fbbf24"; }
        else { bmiCat = "Obese"; bmiColor = "#f87171"; }

        els.tdeeResult.innerHTML = `
            <div class="tdee-grid">
                <div class="tdee-card">
                    <span class="tdee-val">${result.bmr}</span>
                    <span class="tdee-label">BMR (kcal)</span>
                </div>
                <div class="tdee-card">
                    <span class="tdee-val">${result.tdee}</span>
                    <span class="tdee-label">TDEE (kcal)</span>
                </div>
                <div class="tdee-card tdee-target">
                    <span class="tdee-val">${result.target}</span>
                    <span class="tdee-label">Daily Target</span>
                </div>
                <div class="tdee-card">
                    <span class="tdee-val" style="color:${bmiColor}">${result.bmi}</span>
                    <span class="tdee-label" style="color:${bmiColor}">BMI · ${bmiCat}</span>
                </div>
            </div>`;
    }

    async function saveSettings() {
        const newBudget = parseInt(els.settingBudget.value, 10);
        if (isNaN(newBudget) || newBudget < 500) {
            alert("Budget must be at least 500 kcal.");
            return;
        }
        await apiPut("/api/budget", { daily_calories: newBudget });

        const profileData = {};
        const h = els.profileHeight.value.trim();
        const w = els.profileWeight.value.trim();
        const age = els.profileAge.value.trim();
        const gender = els.profileGender.value;
        const activity = els.profileActivity.value;
        const goal = els.profileGoal.value;

        if (h) profileData.height_cm = parseFloat(h);
        if (w) profileData.weight_kg = parseFloat(w);
        if (age) profileData.age = parseInt(age);
        if (gender) profileData.gender = gender;
        if (activity) profileData.activity_level = activity;
        if (goal) profileData.goal = goal;

        if (Object.keys(profileData).length > 0) {
            try { await apiPut("/api/profile", profileData); } catch (e) { /* ignore */ }
        }

        await Promise.all([updateHeader(), renderProfilePreview()]);
        showView("home");
    }

    async function resetToday() {
        if (!confirm("Delete all meals logged today? This cannot be undone.")) return;
        const data = await getTodayMeals();
        for (const m of data.meals) {
            try { await apiDelete(`/api/meals/${m.id}`); } catch (e) { /* continue */ }
        }
        await Promise.all([renderMealLog(), renderHistory(), updateHeader(), renderProfilePreview()]);
        showView("home");
    }

    async function exportData() {
        try {
            const [budget, todayMeals, history, presets] = await Promise.all([
                loadBudget(), getTodayMeals(), apiGet("/api/history"), loadPresets(),
            ]);
            const blob = new Blob(
                [JSON.stringify({ budget, today: todayMeals, history, presets }, null, 2)],
                { type: "application/json" }
            );
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `calorievision-backup-${todayStr()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) { alert("Export failed: " + e.message); }
    }

    function importData() { els.fileImport.click(); }

    async function handleFileImport(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const data = JSON.parse(reader.result);
                if (data.budget) await apiPut("/api/budget", { daily_calories: data.budget });
                if (data.today && data.today.meals) {
                    const today = todayStr();
                    for (const m of data.today.meals) {
                        try { await apiPost("/api/meals", {
                            name: m.name, calories: m.calories, protein: m.protein || 0,
                            carbs: m.carbs || 0, fat: m.fat || 0, weight_g: m.weight_g || 0, meal_date: today,
                        }); } catch (e) { /* skip */ }
                    }
                }
                if (data.presets && Array.isArray(data.presets)) {
                    for (const p of data.presets) {
                        try { await apiPost("/api/presets", {
                            name: p.name, calories: p.calories, protein: p.protein || 0,
                            carbs: p.carbs || 0, fat: p.fat || 0, description: p.description || "",
                        }); } catch (e) { /* skip */ }
                    }
                }
                await Promise.all([updateHeader(), renderMealLog(), renderHistory(), renderProfilePreview()]);
                alert("Data imported successfully.");
            } catch (err) { alert("Invalid backup file."); console.error(err); }
        };
        reader.readAsText(file);
        event.target.value = "";
    }

    // ══════════════════════════════════════════
    // UPLOAD
    // ══════════════════════════════════════════
    async function handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            capturedBase64 = reader.result.split(",")[1];
            const img = new Image();
            img.onload = () => {
                const display = els.capturedCanvas;
                display.width = Math.min(img.width, 400);
                display.height = (img.height / img.width) * display.width;
                display.getContext("2d").drawImage(img, 0, 0, display.width, display.height);
                showView("review");
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
        event.target.value = "";
    }

    // ══════════════════════════════════════════
    // BARCODE SCANNER
    // ══════════════════════════════════════════
    let codeReader = null;
    let barcodeCurrentProduct = null;
    let barcodeCurrentPortion = 1;
    let barcodeScannedInvalid = new Set();
    const BARCODE_MAX_INVALID = 4;

    const nutriScoreDescriptions = {
        a: "Excellent nutritional quality. Low in saturated fat, sugar, and sodium while rich in fiber and protein.",
        b: "Good nutritional quality with balanced nutrients and moderate fat and sugar levels.",
        c: "Average nutritional quality. Contains moderate amounts of fat, sugar, or sodium.",
        d: "Below average nutritional quality. Higher in fat, saturated fat, sugar, or sodium.",
        e: "Poor nutritional quality. High in calories, saturated fat, sugar, or sodium.",
    };

    async function startBarcodeScanner() {
        barcodeScannedInvalid = new Set();
        try {
            codeReader = new ZXing.BrowserMultiFormatReader();
            const videoInputDevices = await codeReader.listVideoInputDevices();
            const backCamera = videoInputDevices.find(
                (d) => d.label.toLowerCase().includes("back") || d.label.toLowerCase().includes("environment")
            ) || videoInputDevices[videoInputDevices.length - 1];

            if (!backCamera) {
                alert("No camera found.");
                showView("home");
                return;
            }

            showView("barcode");

            codeReader.decodeFromVideoDevice(backCamera.deviceId, "barcode-video", (result, err) => {
                if (result) {
                    const barcode = result.getText();
                    if (barcodeScannedInvalid.has(barcode)) return;
                    handleBarcodeScan(barcode);
                }
            });
        } catch (err) {
            alert("Camera access denied.");
            console.error(err);
            showView("home");
        }
    }

    function stopBarcodeScanner() {
        if (codeReader) {
            codeReader.reset();
            codeReader = null;
        }
    }

    async function handleBarcodeScan(barcode) {
        try {
            const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
            const data = await res.json();
            if (data.status === 1 && data.product) {
                stopBarcodeScanner();
                barcodeCurrentProduct = data.product;
                barcodeCurrentPortion = 1;
                renderBarcodeResult(data.product);
                showView("barcodeResult");
            } else {
                barcodeScannedInvalid.add(barcode);
                if (barcodeScannedInvalid.size >= BARCODE_MAX_INVALID) {
                    stopBarcodeScanner();
                    alert(`Unable to identify product after ${BARCODE_MAX_INVALID} attempts. Please try again.`);
                    showView("home");
                }
            }
        } catch (err) {
            barcodeScannedInvalid.add(barcode);
            if (barcodeScannedInvalid.size >= BARCODE_MAX_INVALID) {
                stopBarcodeScanner();
                alert("Network error while looking up product.");
                showView("home");
            }
        }
    }

    function renderBarcodeResult(product) {
        const name = product.product_name || product.generic_name || "Unknown Product";
        const grade = product.nutriscore_grade ? product.nutriscore_grade.toLowerCase() : null;
        const portion = barcodeCurrentPortion;
        const nutriments = product.nutriments || {};

        const baseKcal = nutriments["energy-kcal_100g"] || nutriments["energy-kcal"] || 0;
        const baseProtein = nutriments.proteins_100g || nutriments.proteins || 0;
        const baseCarbs = nutriments.carbohydrates_100g || nutriments.carbohydrates || 0;
        const baseFat = nutriments.fat_100g || nutriments.fat || 0;
        const servingQty = (product.serving_quantity || product.serving_size
            ? parseFloat(product.serving_quantity || product.serving_size)
            : 100) || 100;
        const factor = (servingQty / 100) * portion;

        const kcal = baseKcal * factor;
        const protein = baseProtein * factor;
        const carbs = baseCarbs * factor;
        const fat = baseFat * factor;
        const sugar = (nutriments.sugars_100g || 0) * factor;
        const sodium = (nutriments.sodium_100g || 0) * factor;
        const satFat = (nutriments["saturated-fat_100g"] || 0) * factor;

        const grades = ["a", "b", "c", "d", "e"];
        const gradeHtml = grade
            ? grades.map((g) => `<div class="ns-square ns-${g}${g === grade ? " active" : ""}">${g.toUpperCase()}</div>`).join("")
            : "";

        const statusText = grade ? nutriScoreDescriptions[grade] || "" : "No Nutri-Score available";

        els.barcodeResultContent.innerHTML = `
            <div class="barcode-new-layout">
                <div class="br-name-box">${escapeHtml(name)}</div>
                ${grade ? `<div class="br-section ns-section">
                    <span class="ns-label">Nutri-Score</span>
                    <div class="ns-row"><div class="ns-badges">${gradeHtml}</div><div class="ns-status">${statusText}</div></div>
                </div>` : ""}
                <div class="portion-row">
                    ${[0.25, 0.5, 1, 1.5, 2].map((p) =>
                        `<button class="portion-btn${p === portion ? " active" : ""}" data-portion="${p}">${p === 1 ? "1x" : p + "x"}</button>`
                    ).join("")}
                </div>
                <div class="br-macros-grid">
                    <div class="br-macro-card"><span class="br-macro-val">${Math.round(kcal)}</span><span class="br-macro-unit">kcal</span><span class="br-macro-label">Calories</span></div>
                    <div class="br-macro-card"><span class="br-macro-val">${protein.toFixed(1)}</span><span class="br-macro-unit">g</span><span class="br-macro-label">Protein</span></div>
                    <div class="br-macro-card"><span class="br-macro-val">${carbs.toFixed(1)}</span><span class="br-macro-unit">g</span><span class="br-macro-label">Carbs</span></div>
                    <div class="br-macro-card"><span class="br-macro-val">${fat.toFixed(1)}</span><span class="br-macro-unit">g</span><span class="br-macro-label">Fat</span></div>
                </div>
                <div class="br-section">
                    <div class="br-section-title">Nutrition (per portion)</div>
                    <div class="br-detailed-grid">
                        <div class="br-detail-card"><span class="br-detail-val">${sugar.toFixed(1)}g</span><span class="br-detail-label">Sugar</span></div>
                        <div class="br-detail-card"><span class="br-detail-val">${sodium.toFixed(1)}g</span><span class="br-detail-label">Sodium</span></div>
                        <div class="br-detail-card"><span class="br-detail-val">${satFat.toFixed(1)}g</span><span class="br-detail-label">Sat. Fat</span></div>
                    </div>
                </div>
            </div>`;

        els.barcodeResultContent.querySelectorAll(".portion-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                barcodeCurrentPortion = parseFloat(btn.dataset.portion);
                renderBarcodeResult(product);
            });
        });
    }

    async function saveBarcodeMeal() {
        if (!barcodeCurrentProduct) return;
        const nutriments = barcodeCurrentProduct.nutriments || {};
        const servingQty = (barcodeCurrentProduct.serving_quantity || barcodeCurrentProduct.serving_size
            ? parseFloat(barcodeCurrentProduct.serving_quantity || barcodeCurrentProduct.serving_size)
            : 100) || 100;
        const factor = (servingQty / 100) * barcodeCurrentPortion;

        const name = barcodeCurrentProduct.product_name || barcodeCurrentProduct.generic_name || "Unknown Product";
        const calories = (nutriments["energy-kcal_100g"] || 0) * factor;
        const protein = (nutriments.proteins_100g || 0) * factor;
        const carbs = (nutriments.carbohydrates_100g || 0) * factor;
        const fat = (nutriments.fat_100g || 0) * factor;

        try {
            await apiPost("/api/meals", {
                name, calories, protein, carbs, fat,
                weight_g: servingQty * barcodeCurrentPortion, meal_date: todayStr(),
            });
        } catch (e) {
            alert("Failed to log item: " + e.message);
            return;
        }

        barcodeCurrentProduct = null;
        await Promise.all([renderMealLog(), renderHistory(), updateHeader(), renderProfilePreview()]);
        showView("home");
    }

    // ══════════════════════════════════════════
    // EVENT BINDINGS
    // ══════════════════════════════════════════
    function init() {
        $("btn-login").addEventListener("click", handleLogin);
        $("btn-register").addEventListener("click", handleRegister);
        $("btn-change-password").addEventListener("click", handleChangePassword);
        els.loginPassword.addEventListener("keydown", (e) => { if (e.key === "Enter") handleLogin(); });
        els.cpNewPassword.addEventListener("keydown", (e) => { if (e.key === "Enter") handleChangePassword(); });

        $("btn-home").addEventListener("click", () => loadAndShowHome());
        $("btn-logout").addEventListener("click", handleLogout);
        $("btn-settings").addEventListener("click", openSettings);

        $("btn-scan").addEventListener("click", startCamera);
        $("btn-barcode").addEventListener("click", startBarcodeScanner);
        $("btn-upload").addEventListener("click", () => $("file-upload").click());
        $("btn-manual").addEventListener("click", openManualAdd);
        $("file-upload").addEventListener("change", handleFileUpload);

        $("btn-camera-back").addEventListener("click", () => { stopCamera(); showView("home"); });
        $("btn-barcode-back").addEventListener("click", () => { stopBarcodeScanner(); showView("home"); });
        $("btn-capture").addEventListener("click", captureImage);

        $("btn-retake").addEventListener("click", async () => { await startCamera(); });
        $("btn-analyze").addEventListener("click", analyzeImage);

        $("btn-consume").addEventListener("click", consumeMeal);
        $("btn-discard").addEventListener("click", () => { lastAnalysisResult = null; showView("home"); });

        $("btn-barcode-save").addEventListener("click", saveBarcodeMeal);
        $("btn-barcode-discard").addEventListener("click", () => { barcodeCurrentProduct = null; showView("home"); });

        $("btn-manual-cancel").addEventListener("click", () => showView("home"));
        $("btn-manual-save").addEventListener("click", saveManualMeal);

        els.manualPresets.addEventListener("change", (e) => {
            if (e.target.value) loadPresetToForm(e.target.value);
            else {
                els.btnDeletePreset.style.display = "none";
                ["manual-name","manual-calories","manual-protein","manual-carbs","manual-fat","manual-desc"].forEach(id => $(id).value = "");
            }
        });
        els.btnDeletePreset.addEventListener("click", deleteManualPreset);

        $("btn-settings-back").addEventListener("click", saveSettings);
        $("btn-reset-today").addEventListener("click", resetToday);
        els.btnExportData.addEventListener("click", exportData);
        els.btnImportData.addEventListener("click", importData);
        els.fileImport.addEventListener("change", handleFileImport);

        document.querySelectorAll(".goal-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                document.querySelectorAll(".goal-btn").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                els.profileGoal.value = btn.dataset.goal;
                renderTDEEPreview();
            });
        });

        ["profile-height","profile-weight","profile-age","profile-gender","profile-activity"].forEach((id) => {
            $(id).addEventListener("change", renderTDEEPreview);
            $(id).addEventListener("input", renderTDEEPreview);
        });

        if (token) loadAndShowHome();
        else showView("login");
    }

    document.addEventListener("DOMContentLoaded", init);
})();