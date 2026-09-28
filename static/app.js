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
        forgotPassword: $("view-forgot-password"),
        home: $("view-home"),
        manual: $("view-manual"),
        camera: $("view-camera"),
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
        forgotUsername: $("forgot-username"),
        forgotError: $("forgot-error"),
        forgotSuccess: $("forgot-success"),
        resetTokenSection: $("reset-token-section"),
        resetTokenDisplay: $("reset-token-display"),
        resetTokenInput: $("reset-token-input"),
        newPasswordInput: $("new-password-input"),
        greeting: $("greeting"),
        calorieStatus: $("calorie-status"),
        progressBar: $("progress-bar"),
        remainingLabel: $("remaining-label"),
        mealList: $("meal-list"),
        historyList: $("history-list"),
        historySection: $("history-section"),
        cameraPreview: $("camera-preview"),
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
        settingsOldPassword: $("setting-old-password"),
        settingsNewPassword: $("setting-new-password"),
        btnChangePasswordSettings: $("btn-change-password-settings"),
    };

    // ══════════════════════════════════════════
    // VIEW SWITCHING
    // ══════════════════════════════════════════
    function showView(name) {
        Object.values(views).forEach((v) => v.classList.remove("active"));
        const v = views[name];
        if (v) v.classList.add("active");

        const header = $("app-header");
        const hideHeader = ["login", "forgotPassword", "camera", "loading", "review"].includes(name);
        header.style.display = hideHeader ? "none" : "";
    }

    // ══════════════════════════════════════════
    // TOASTS
    // ══════════════════════════════════════════
    function toast(msg, type = "info") {
        const root = $("toast-root");
        if (!root) { alert(msg); return; }
        const el = document.createElement("div");
        el.className = `toast toast-${type}`;
        el.setAttribute("role", "status");
        el.textContent = msg;
        root.appendChild(el);
        setTimeout(() => {
            el.classList.add("out");
            setTimeout(() => el.remove(), 300);
        }, 2400);
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
        showView("login");
    }

    // ══════════════════════════════════════════
    // SETTINGS PASSWORD CHANGE
    // ═════════════════════════════════════════=
    async function handleSettingsPasswordChange() {
        const oldPw = els.settingsOldPassword.value;
        const newPw = els.settingsNewPassword.value;
        if (!oldPw || !newPw) { toast("Please fill in both password fields", "error"); return; }
        if (newPw.length < 4) { toast("New password must be at least 4 characters", "error"); return; }
        try {
            await apiPut("/api/auth/change-password", { old_password: oldPw, new_password: newPw });
            toast("Password updated successfully!", "success");
            els.settingsOldPassword.value = "";
            els.settingsNewPassword.value = "";
        } catch (e) {
            toast("Failed to update password: " + e.message, "error");
        }
    }

    // ══════════════════════════════════════════
    // FORGOT PASSWORD
    // ══════════════════════════════════════════

    function showForgotPassword() {
        // Clear previous state
        els.forgotUsername.value = "";
        els.forgotError.style.display = "none";
        els.forgotSuccess.style.display = "none";
        els.resetTokenSection.style.display = "none";
        showView("forgotPassword");
    }

    async function handleRequestReset() {
        els.forgotError.style.display = "none";
        els.forgotSuccess.style.display = "none";
        
        const username = els.forgotUsername.value.trim();
        if (!username) {
            els.forgotError.textContent = "Please enter your username";
            els.forgotError.style.display = "block";
            return;
        }

        try {
            const data = await apiPost("/api/auth/forgot-password", { username });
            
            if (data.reset_token) {
                // Show the token to the user (in a real app, this would be emailed)
                els.resetTokenDisplay.textContent = data.reset_token;
                els.resetTokenSection.style.display = "block";
                els.forgotSuccess.textContent = "Token generated! Enter it below to reset your password.";
                els.forgotSuccess.style.display = "block";
            } else {
                // Security: always show success to prevent username enumeration
                els.forgotSuccess.textContent = "If the username exists, a reset token has been sent.";
                els.forgotSuccess.style.display = "block";
            }
        } catch (e) {
            els.forgotError.textContent = e.message || "Failed to request reset";
            els.forgotError.style.display = "block";
        }
    }

    async function handleResetPassword() {
        els.forgotError.style.display = "none";
        
        const username = els.forgotUsername.value.trim();
        const resetToken = els.resetTokenInput.value.trim();
        const newPassword = els.newPasswordInput.value;

        if (!username || !resetToken || !newPassword) {
            els.forgotError.textContent = "Please fill in all fields";
            els.forgotError.style.display = "block";
            return;
        }

        if (newPassword.length < 4) {
            els.forgotError.textContent = "Password must be at least 4 characters";
            els.forgotError.style.display = "block";
            return;
        }

        try {
            await apiPost("/api/auth/reset-password", {
                username,
                reset_token: resetToken,
                new_password: newPassword
            });

            toast("Password reset successful! Please login with your new password.", "success");
            showView("login");
        } catch (e) {
            els.forgotError.textContent = e.message || "Failed to reset password";
            els.forgotError.style.display = "block";
        }
    }

    function handleBackToLogin() {
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
            .map((m) => {
                if (m.is_group && m.items && m.items.length > 0) {
                    // Render as expandable grouped card
                    const itemsHtml = m.items
                        .map((item) => `<div class="meal-group-item">
                            <span>${escapeHtml(item.name || item)}</span>
                            ${item.calories !== undefined ? `<span>${Math.round(item.calories)} kcal</span>` : ""}
                        </div>`)
                        .join("");
                    return `
                <div class="meal-card meal-card-group" data-meal-id="${m.id}" data-group-token="${m.group_token || ""}">
                    <div class="meal-card-info">
                        <span class="meal-card-name">${escapeHtml(m.name)}</span>
                        <span class="meal-card-time">P:${Math.round(m.protein)}g C:${Math.round(m.carbs)}g F:${Math.round(m.fat)}g</span>
                    </div>
                    <div class="meal-card-right">
                        <span class="meal-card-calories">${Math.round(m.calories)} kcal</span>
                        <button class="btn-expand-group" aria-label="Expand">▼</button>
                        <button class="btn-remove-meal" data-id="${m.id}" aria-label="Remove meal">&times;</button>
                    </div>
                    <div class="meal-group-items hidden">${itemsHtml}</div>
                </div>`;
                }
                // Regular single meal card
                return `
            <div class="meal-card" data-meal-id="${m.id}">
                <div class="meal-card-info">
                    <span class="meal-card-name">${escapeHtml(m.name)}</span>
                    <span class="meal-card-time">P:${Math.round(m.protein)}g C:${Math.round(m.carbs)}g F:${Math.round(m.fat)}g</span>
                </div>
                <div class="meal-card-right">
                    <span class="meal-card-calories">${Math.round(m.calories)} kcal</span>
                    <button class="btn-remove-meal" data-id="${m.id}" aria-label="Remove meal">&times;</button>
                </div>
            </div>`;
            })
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
                    toast("Failed to remove meal: " + err.message, "error");
                    btn.disabled = false;
                    return;
                }
                await Promise.all([renderMealLog(), renderHistory(), updateHeader(), renderProfilePreview()]);
            });
        });

        // Toggle expand/collapse for group meals
        list.querySelectorAll(".btn-expand-group").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                e.preventDefault();
                const card = btn.closest(".meal-card-group");
                const itemsDiv = card.querySelector(".meal-group-items");
                const isHidden = itemsDiv.classList.contains("hidden");
                itemsDiv.classList.toggle("hidden", !isHidden);
                btn.textContent = isHidden ? "▲" : "▼";
            });
        });

        list.querySelectorAll(".meal-card").forEach((card) => {
            card.addEventListener("click", async () => {
                const id = card.dataset.mealId;
                const groupToken = card.dataset.groupToken;
                const fresh = await getTodayMeals();
                
                if (groupToken) {
                    const groupMeal = fresh.meals.find(m => m.group_token === groupToken);
                    if (groupMeal && groupMeal.items) {
                        showGroupMealDetails(groupMeal);
                        return;
                    }
                }
                
                openEditMeal(id, fresh.meals);
            });
        });
        
        list.querySelectorAll(".meal-card-group").forEach((card) => {
            card.addEventListener("click", async () => {
                const groupToken = card.dataset.groupToken;
                if (!groupToken) return;
                const fresh = await getTodayMeals();
                const groupMeal = fresh.meals.find(m => m.group_token === groupToken);
                if (groupMeal && groupMeal.items) {
                    showGroupMealDetails(groupMeal);
                }
            });
        });
    }
    
    function showGroupMealDetails(meal) {
        const itemsHtml = meal.items.map((item) => {
            if (typeof item === "string") {
                return `<div class="group-detail-item"><span>${escapeHtml(item)}</span></div>`;
            }
            return `<div class="group-detail-item group-detail-item-rich">
                <div class="group-detail-item-header">
                    <span>${escapeHtml(item.name)}</span>
                    <strong>${Math.round(item.calories)} kcal</strong>
                </div>
                <div class="group-detail-macros">
                    <span>P:${Math.round(item.protein)}g</span>
                    <span>C:${Math.round(item.carbs)}g</span>
                    <span>F:${Math.round(item.fat)}g</span>
                    <span>${Math.round(item.weight_g)}g</span>
                </div>
            </div>`;
        }).join("");
        const html = `
            <div class="modal-overlay">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>Meal Details</h3>
                        <button class="modal-close" id="modal-close-group">&times;</button>
                    </div>
                    <div class="modal-body">
                        ${itemsHtml}
                        <div class="group-detail-totals">
                            <div class="gdt-row"><span>Total Calories</span><span>${Math.round(meal.calories)} kcal</span></div>
                            <div class="gdt-row"><span>Protein</span><span>${Math.round(meal.protein)}g</span></div>
                            <div class="gdt-row"><span>Carbs</span><span>${Math.round(meal.carbs)}g</span></div>
                            <div class="gdt-row"><span>Fat</span><span>${Math.round(meal.fat)}g</span></div>
                            <div class="gdt-row"><span>Weight</span><span>${Math.round(meal.weight_g)}g</span></div>
                        </div>
                    </div>
                </div>
            </div>`;
        
        const modalContainer = document.createElement("div");
        modalContainer.id = "group-meal-modal";
        modalContainer.innerHTML = html;
        document.body.appendChild(modalContainer);
        
        $("modal-close-group").addEventListener("click", () => {
            modalContainer.remove();
        });
        
        modalContainer.querySelector(".modal-overlay").addEventListener("click", (e) => {
            if (e.target.classList.contains("modal-overlay")) {
                modalContainer.remove();
            }
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
            toast("Camera access denied or unavailable.", "error");
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
            toast("Analysis failed. Please try again.", "error");
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

        // Get existing meals array
        const mealsToSave = lastAnalysisResult.items.map((item) => ({
            name: item.name,
            calories: item.calories,
            protein: item.protein,
            carbs: item.carbs,
            fat: item.fat,
            weight_g: item.weight_g,
            meal_date: today,
        }));

        try {
            // Send all meals as a batch (saves them with same group_token)
            await apiPost("/api/meals/batch", { meals: mealsToSave });
        } catch (e) {
            console.error("Failed to log meals:", e);
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
        if (!name || !calStr) { toast("Meal name and calories are required.", "error"); return; }
        const calories = parseFloat(calStr);
        if (isNaN(calories)) { toast("Please enter a valid number for calories.", "error"); return; }
        const protein = parseFloat($("manual-protein").value) || 0;
        const carbs = parseFloat($("manual-carbs").value) || 0;
        const fat = parseFloat($("manual-fat").value) || 0;

        if (editId >= 0) {
            try { await apiDelete(`/api/meals/${editId}`); } catch (e) { /* ignore */ }
        }
        try {
            await apiPost("/api/meals", { name, calories, protein, carbs, fat, weight_g: 0, meal_date: todayStr() });
        } catch (e) {
            toast("Failed to save meal: " + e.message, "error");
            return;
        }
        if (els.manualSavePreset.checked) {
            try { await apiPost("/api/presets", { name, calories, protein, carbs, fat, description: desc }); } catch (e) { /* ignore */ }
            toast("Meal saved and preset created", "success");
        } else {
            toast("Meal saved", "success");
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
        try { await apiDelete(`/api/presets/${presetId}`); } catch (e) { toast("Failed to delete preset.", "error"); return; }
        toast("Preset deleted", "success");
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
            toast("Budget must be at least 500 kcal.", "error");
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
            try { await apiPut("/api/profile", profileData); } catch (e) { toast("Failed to save profile: " + e.message, "error"); }
        }

        await Promise.all([updateHeader(), renderProfilePreview()]);
        toast("Settings saved", "success");
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
            const data = await apiGet("/api/export");
            const blob = new Blob(
                [JSON.stringify(data, null, 2)],
                { type: "application/json" }
            );
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `calorievision-backup-${todayStr()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast("Backup downloaded", "success");
        } catch (e) { toast("Export failed: " + e.message, "error"); }
    }

    function importData() { els.fileImport.click(); }

    async function handleFileImport(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const data = JSON.parse(reader.result);
                await apiPut("/api/import", data);
                await Promise.all([updateHeader(), renderMealLog(), renderHistory(), renderProfilePreview()]);
                toast("Data imported successfully.", "success");
            } catch (err) { toast("Invalid backup file.", "error"); console.error(err); }
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
    // EVENT BINDINGS
    // ══════════════════════════════════════════
    function init() {
        $("btn-login").addEventListener("click", handleLogin);
        $("btn-register").addEventListener("click", handleRegister);
        $("btn-change-password").addEventListener("click", handleChangePassword);
        $("btn-forgot-password").addEventListener("click", showForgotPassword);
        $("btn-request-reset").addEventListener("click", handleRequestReset);
        $("btn-reset-password").addEventListener("click", handleResetPassword);
        $("btn-back-to-login").addEventListener("click", handleBackToLogin);
        
        els.loginPassword.addEventListener("keydown", (e) => { if (e.key === "Enter") handleLogin(); });
        els.cpNewPassword.addEventListener("keydown", (e) => { if (e.key === "Enter") handleChangePassword(); });
        els.forgotUsername.addEventListener("keydown", (e) => { if (e.key === "Enter") handleRequestReset(); });
        els.resetTokenInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleResetPassword(); });
        els.newPasswordInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleResetPassword(); });

        $("btn-home").addEventListener("click", () => loadAndShowHome());
        $("btn-logout").addEventListener("click", handleLogout);
        $("btn-settings").addEventListener("click", openSettings);

        $("btn-scan").addEventListener("click", startCamera);
        $("btn-upload").addEventListener("click", () => $("file-upload").click());
        $("btn-manual").addEventListener("click", openManualAdd);
        $("file-upload").addEventListener("change", handleFileUpload);

        $("btn-camera-back").addEventListener("click", () => { stopCamera(); showView("home"); });
        $("btn-capture").addEventListener("click", captureImage);

        $("btn-retake").addEventListener("click", async () => { await startCamera(); });
        $("btn-analyze").addEventListener("click", analyzeImage);

        $("btn-consume").addEventListener("click", consumeMeal);
        $("btn-discard").addEventListener("click", () => { lastAnalysisResult = null; showView("home"); });

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
        els.btnChangePasswordSettings.addEventListener("click", handleSettingsPasswordChange);
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
