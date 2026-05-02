/* ═══════════════════════════════════════════════
   Calorie Vision — App Logic
   ═══════════════════════════════════════════════ */

(function () {
    "use strict";

    // ──────────────────────────────────────────
    // PROFILE & STORAGE KEYS
    // ──────────────────────────────────────────
    const GLOBAL_KEYS = {
        profiles: "calorieVision_profiles",   // ["alice", "bob", ...]
        activeUser: "calorieVision_activeUser", // "alice"
    };

    const DEFAULT_BUDGET = 2000;
    const HISTORY_DAYS = 7;

    // Per-user key helpers — all data is namespaced by username
    function userKey(base) {
        return `calorieVision_${activeUser}_${base}`;
    }

    // ──────────────────────────────────────────
    // STATE
    // ──────────────────────────────────────────
    let activeUser = null;
    let cameraStream = null;
    let capturedBase64 = null;
    let lastAnalysisResult = null;

    // ──────────────────────────────────────────
    // PROFILE MANAGEMENT
    // ──────────────────────────────────────────
    function getProfiles() {
        const raw = localStorage.getItem(GLOBAL_KEYS.profiles);
        if (raw) {
            try { return JSON.parse(raw); } catch (_) { /* ignore */ }
        }
        return [];
    }

    function saveProfiles(profiles) {
        localStorage.setItem(GLOBAL_KEYS.profiles, JSON.stringify(profiles));
    }

    function setActiveUser(username) {
        activeUser = username;
        localStorage.setItem(GLOBAL_KEYS.activeUser, username);
    }

    function getActiveUser() {
        return localStorage.getItem(GLOBAL_KEYS.activeUser) || null;
    }

    function createProfile(name) {
        const profiles = getProfiles();
        const normalized = name.trim();
        if (!normalized) return null;
        // Check for duplicate (case-insensitive)
        if (profiles.some((p) => p.toLowerCase() === normalized.toLowerCase())) {
            return normalized; // Already exists, just log in
        }
        profiles.push(normalized);
        saveProfiles(profiles);
        return normalized;
    }

    // ──────────────────────────────────────────
    // STORAGE HELPERS (per-user)
    // ──────────────────────────────────────────
    function todayStr() {
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
    }

    function getBudget() {
        return parseInt(localStorage.getItem(userKey("budget")), 10) || DEFAULT_BUDGET;
    }

    function setBudget(val) {
        localStorage.setItem(userKey("budget"), val.toString());
    }

    function getName() {
        return activeUser || "";
    }

    function getTodayData() {
        const raw = localStorage.getItem(userKey("data"));
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed.date === todayStr()) return parsed;
            } catch (_) { /* ignore */ }
        }
        // Day rolled over or first use — archive old data
        archiveOldDay();
        const fresh = { date: todayStr(), consumed: 0, meals: [] };
        localStorage.setItem(userKey("data"), JSON.stringify(fresh));
        return fresh;
    }

    function saveTodayData(data) {
        localStorage.setItem(userKey("data"), JSON.stringify(data));
    }

    function archiveOldDay() {
        const raw = localStorage.getItem(userKey("data"));
        if (!raw) return;
        try {
            const old = JSON.parse(raw);
            if (old.date === todayStr()) return; // same day, nothing to archive
            if (old.meals && old.meals.length > 0) {
                const history = getHistory();
                history.unshift({ date: old.date, consumed: old.consumed, meals: old.meals });
                while (history.length > HISTORY_DAYS) history.pop();
                localStorage.setItem(userKey("history"), JSON.stringify(history));
            }
        } catch (_) { /* ignore */ }
    }

    function getHistory() {
        const raw = localStorage.getItem(userKey("history"));
        if (raw) {
            try { return JSON.parse(raw); } catch (_) { /* ignore */ }
        }
        return [];
    }

    function getPresets() {
        const raw = localStorage.getItem(userKey("presets"));
        if (raw) {
            try { return JSON.parse(raw); } catch (_) { /* ignore */ }
        }
        return [];
    }

    function savePresets(presets) {
        localStorage.setItem(userKey("presets"), JSON.stringify(presets));
    }

    // ──────────────────────────────────────────
    // DOM REFERENCES
    // ──────────────────────────────────────────
    const $ = (id) => document.getElementById(id);

    const views = {
        login: $("view-login"),
        home: $("view-home"),
        manual: $("view-manual"),
        camera: $("view-camera"),
        review: $("view-review"),
        loading: $("view-loading"),
        results: $("view-results"),
        settings: $("view-settings"),
    };

    const els = {
        profileList: $("profile-list"),
        newProfileName: $("new-profile-name"),
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
        btnExportData: $("btn-export-data"),
        btnImportData: $("btn-import-data"),
        fileImport: $("file-import"),
        manualPresets: $("manual-presets"),
        btnDeletePreset: $("btn-delete-preset"),
        manualSavePreset: $("manual-save-preset"),
        presetSelectorGroup: $("preset-selector-group"),
    };

    // ──────────────────────────────────────────
    // VIEW SWITCHING
    // ──────────────────────────────────────────
    function showView(name) {
        Object.values(views).forEach((v) => v.classList.remove("active"));
        views[name].classList.add("active");

        // Show/hide header on login/camera/loading views
        const header = $("app-header");
        if (name === "login" || name === "camera" || name === "loading") {
            header.style.display = "none";
        } else {
            header.style.display = "";
        }
    }

    // ──────────────────────────────────────────
    // LOGIN UI
    // ──────────────────────────────────────────
    function renderProfileList() {
        const profiles = getProfiles();
        if (profiles.length === 0) {
            els.profileList.innerHTML = "";
            return;
        }
        els.profileList.innerHTML = profiles
            .map((name) => `
                <div class="profile-card" data-profile="${escapeHtml(name)}">
                    <div class="profile-avatar">${escapeHtml(name.charAt(0).toUpperCase())}</div>
                    <span class="profile-card-name">${escapeHtml(name)}</span>
                </div>
            `)
            .join("");

        // Attach click handlers
        els.profileList.querySelectorAll(".profile-card").forEach((card) => {
            card.addEventListener("click", () => {
                loginAs(card.dataset.profile);
            });
        });
    }

    function loginAs(username) {
        setActiveUser(username);
        updateHeader();
        renderMealLog();
        renderHistory();
        showView("home");
    }

    function handleCreateProfile() {
        const name = els.newProfileName.value.trim();
        if (!name) {
            els.newProfileName.focus();
            return;
        }
        createProfile(name);
        els.newProfileName.value = "";
        loginAs(name);
    }

    function switchProfile() {
        activeUser = null;
        localStorage.removeItem(GLOBAL_KEYS.activeUser);
        renderProfileList();
        showView("login");
    }

    // ──────────────────────────────────────────
    // UI UPDATES
    // ──────────────────────────────────────────
    function updateHeader() {
        const budget = getBudget();
        const data = getTodayData();
        const consumed = data.consumed;
        const remaining = Math.max(0, budget - consumed);
        const pct = Math.min(100, (consumed / budget) * 100);

        // Greeting
        const name = getName();
        els.greeting.textContent = name ? `Hello, ${name}` : "Hello!";

        // Calorie status
        els.calorieStatus.textContent = `${consumed} / ${budget} kcal`;
        els.remainingLabel.textContent = `${remaining} kcal remaining`;

        // Macro status
        let sumPro = 0, sumCrb = 0, sumFat = 0;
        (data.meals || []).forEach(m => {
            sumPro += (m.protein || 0);
            sumCrb += (m.carbs || 0);
            sumFat += (m.fat || 0);
        });
        if (els.dailyProtein) els.dailyProtein.textContent = sumPro;
        if (els.dailyCarbs) els.dailyCarbs.textContent = sumCrb;
        if (els.dailyFat) els.dailyFat.textContent = sumFat;

        // Progress bar
        els.progressBar.style.width = pct + "%";
        els.progressBar.classList.remove("warning", "danger");
        if (pct >= 100) {
            els.progressBar.classList.add("danger");
        } else if (pct >= 80) {
            els.progressBar.classList.add("warning");
        }

        // Warning banner removed per user preference
    }

    function renderMealLog() {
        const data = getTodayData();
        if (!data.meals || data.meals.length === 0) {
            els.mealList.innerHTML = '<p class="empty-state">No meals logged yet. Tap "Scan Meal" to start!</p>';
            return;
        }

        els.mealList.innerHTML = data.meals
            .map((meal, i) => `
                <div class="meal-card" id="meal-card-${i}">
                    <div class="meal-card-info">
                        <span class="meal-card-name">${escapeHtml(meal.name)}</span>
                        <span class="meal-card-time">${meal.time}</span>
                    </div>
                    <div class="meal-card-right">
                        <span class="meal-card-calories">${meal.calories} kcal</span>
                        <button class="btn-remove-meal" data-index="${i}" aria-label="Remove meal">−</button>
                    </div>
                </div>
            `)
            .join("");

        // Attach remove handlers
        els.mealList.querySelectorAll(".btn-remove-meal").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                removeMeal(parseInt(btn.dataset.index, 10));
            });
        });

        // Attach edit handlers (click on the card itself)
        els.mealList.querySelectorAll(".meal-card").forEach((card) => {
            card.addEventListener("click", () => {
                const idx = parseInt(card.id.replace('meal-card-', ''), 10);
                openEditMeal(idx);
            });
            card.style.cursor = 'pointer';
        });
    }

    function renderHistory() {
        const history = getHistory();
        if (history.length === 0) {
            els.historySection.style.display = "none";
            return;
        }
        els.historySection.style.display = "";

        const budget = getBudget();
        
        // Render Chart
        // Map history to chronological order (it's stored newest first)
        const chartData = [...history].reverse();
        const chartHtml = chartData.map(day => {
            const pct = Math.min(100, (day.consumed / budget) * 100);
            const isOver = day.consumed > budget;
            const dObj = new Date(day.date + "T00:00:00");
            const dayLabel = dObj.toLocaleDateString(undefined, { weekday: "short" });
            
            return `
                <div class="chart-col">
                    <div class="chart-bar-bg">
                        <div class="chart-bar-fill ${isOver ? 'over' : ''}" style="height: ${pct}%"></div>
                    </div>
                    <span class="chart-label">${dayLabel}</span>
                </div>
            `;
        }).join("");

        const chartContainer = `<div class="history-chart">${chartHtml}</div>`;

        // Render List
        const listHtml = history
            .map((day) => {
                const mealsHtml = (day.meals || [])
                    .map((m) => `
                        <div class="history-meal">
                            <span class="history-meal-name">${escapeHtml(m.name)}</span>
                            <span class="history-meal-cal">${m.calories} kcal</span>
                        </div>
                    `)
                    .join("");
                return `
                    <div class="history-day">
                        <div class="history-day-header">
                            <span>${formatDate(day.date)}</span>
                            <span class="history-day-total">${day.consumed} kcal total</span>
                        </div>
                        <div class="history-meals">${mealsHtml}</div>
                    </div>
                `;
            })
            .join("");

        els.historyList.innerHTML = chartContainer + listHtml;
    }

    function renderResults(result) {
        // Items
        els.resultsItems.innerHTML = result.items
            .map((item) => `
                <div class="result-item">
                    <div class="result-item-header">
                        <span class="result-item-name">${escapeHtml(item.name)}</span>
                        <span class="result-item-cal">${item.calories} kcal</span>
                    </div>
                    <div class="result-item-macros">
                        <div class="macro-badge protein">${item.protein}g<span>Protein</span></div>
                        <div class="macro-badge carbs">${item.carbs}g<span>Carbs</span></div>
                        <div class="macro-badge fat">${item.fat}g<span>Fat</span></div>
                        <div class="macro-badge weight">${item.weight_g}g<span>Weight</span></div>
                    </div>
                </div>
            `)
            .join("");

        // Total
        const t = result.total;
        els.resultsTotal.innerHTML = `
            <div class="total-header">Total</div>
            <div class="total-calories">${t.calories} kcal</div>
            <div class="total-macros">
                <div class="macro-badge protein">${t.protein}g<span>Protein</span></div>
                <div class="macro-badge carbs">${t.carbs}g<span>Carbs</span></div>
                <div class="macro-badge fat">${t.fat}g<span>Fat</span></div>
            </div>
        `;

        // Suggestion
        if (result.suggestions) {
            els.resultsSuggestion.textContent = result.suggestions;
            els.resultsSuggestion.style.display = "";
        } else {
            els.resultsSuggestion.style.display = "none";
        }
    }

    // ──────────────────────────────────────────
    // CAMERA
    // ──────────────────────────────────────────
    async function startCamera() {
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
                audio: false,
            });
            els.cameraPreview.srcObject = cameraStream;
            showView("camera");
        } catch (err) {
            alert("Camera access denied. Please allow camera permissions and try again.");
            console.error("Camera error:", err);
        }
    }

    function stopCamera() {
        if (cameraStream) {
            cameraStream.getTracks().forEach((t) => t.stop());
            cameraStream = null;
            els.cameraPreview.srcObject = null;
        }
    }

    function captureImage() {
        const video = els.cameraPreview;
        const canvas = els.capturedCanvas;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0);
        capturedBase64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
        stopCamera();
        els.foodDescription.value = "";
        showView("review");
    }

    // ──────────────────────────────────────────
    // ANALYSIS
    // ──────────────────────────────────────────
    async function analyzeImage() {
        showView("loading");

        const body = { image: capturedBase64 };
        const desc = els.foodDescription.value.trim();
        if (desc) body.description = desc;

        try {
            const res = await fetch("/api/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: "Unknown error" }));
                throw new Error(err.detail || `Server error ${res.status}`);
            }

            lastAnalysisResult = await res.json();
            renderResults(lastAnalysisResult);
            showView("results");
        } catch (err) {
            alert("Analysis failed: " + err.message);
            showView("home");
        }
    }

    // ──────────────────────────────────────────
    // CONSUME
    // ──────────────────────────────────────────
    function consumeMeal() {
        if (!lastAnalysisResult) return;

        const data = getTodayData();
        const total = lastAnalysisResult.total;
        const itemNames = lastAnalysisResult.items.map((i) => i.name).join(", ");
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

        data.consumed += Math.round(total.calories);
        data.meals.push({
            name: itemNames,
            calories: Math.round(total.calories),
            protein: Math.round(total.protein),
            carbs: Math.round(total.carbs),
            fat: Math.round(total.fat),
            time: timeStr,
        });

        saveTodayData(data);
        lastAnalysisResult = null;
        capturedBase64 = null;

        updateHeader();
        renderMealLog();
        renderHistory();
        showView("home");
    }

    function removeMeal(index) {
        const data = getTodayData();
        if (index < 0 || index >= data.meals.length) return;
        const removed = data.meals.splice(index, 1)[0];
        data.consumed = Math.max(0, data.consumed - removed.calories);
        saveTodayData(data);
        updateHeader();
        renderMealLog();
    }

    // ──────────────────────────────────────────
    // IMAGE UPLOAD
    // ──────────────────────────────────────────
    function triggerUpload() {
        $('file-upload').click();
    }

    function handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (e) {
            const img = new Image();
            img.onload = function () {
                const canvas = els.capturedCanvas;
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                capturedBase64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
                els.foodDescription.value = '';
                showView('review');
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
        // Reset input so same file can be re-selected
        event.target.value = '';
    }

    // ──────────────────────────────────────────
    // MANUAL ADD / EDIT
    // ──────────────────────────────────────────
    function renderPresetsDropdown() {
        const presets = getPresets();
        let html = '<option value="">Custom Entry...</option>';
        presets.forEach((p, idx) => {
            html += `<option value="${idx}">${escapeHtml(p.name)} (${p.calories} kcal)</option>`;
        });
        if (els.manualPresets) {
            els.manualPresets.innerHTML = html;
            els.manualPresets.value = "";
        }
        if (els.btnDeletePreset) els.btnDeletePreset.style.display = "none";
        if (els.presetSelectorGroup) els.presetSelectorGroup.style.display = "";
        if (els.manualSavePreset) els.manualSavePreset.checked = false;
    }

    function openManualAdd() {
        renderPresetsDropdown();
        $('manual-title').textContent = 'Add Meal Manually';
        $('manual-save-text').textContent = 'Add Meal';
        $('manual-edit-index').value = '-1';
        $('manual-name').value = '';
        $('manual-calories').value = '';
        $('manual-protein').value = '';
        $('manual-carbs').value = '';
        $('manual-fat').value = '';
        $('manual-desc').value = '';
        showView('manual');
    }

    function openEditMeal(index) {
        const data = getTodayData();
        if (index < 0 || index >= data.meals.length) return;
        const meal = data.meals[index];

        $('manual-title').textContent = 'Edit Meal';
        $('manual-save-text').textContent = 'Save Changes';
        $('manual-edit-index').value = index.toString();
        if (els.presetSelectorGroup) els.presetSelectorGroup.style.display = "none";

        // Parse name — if it contains ' — ', split into name and description
        const parts = meal.name.split(' — ');
        $('manual-name').value = parts[0] || '';
        $('manual-desc').value = parts.length > 1 ? parts.slice(1).join(' — ') : '';
        $('manual-calories').value = meal.calories || '';
        $('manual-protein').value = meal.protein || '';
        $('manual-carbs').value = meal.carbs || '';
        $('manual-fat').value = meal.fat || '';

        showView('manual');
    }

    function saveManualMeal() {
        const name = $('manual-name').value.trim();
        const calories = parseInt($('manual-calories').value, 10);
        if (!name || isNaN(calories) || calories <= 0) {
            alert('Please enter a meal name and valid calorie count.');
            return;
        }

        const protein = parseInt($('manual-protein').value, 10) || 0;
        const carbs = parseInt($('manual-carbs').value, 10) || 0;
        const fat = parseInt($('manual-fat').value, 10) || 0;
        const desc = $('manual-desc').value.trim();
        const displayName = desc ? `${name} — ${desc}` : name;
        const editIndex = parseInt($('manual-edit-index').value, 10);

        const data = getTodayData();

        // Preset saving logic
        if (els.presetSelectorGroup && els.presetSelectorGroup.style.display !== "none" && els.manualSavePreset && els.manualSavePreset.checked) {
            const presets = getPresets();
            const existingIdx = presets.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
            const newPreset = { name, calories, protein, carbs, fat };
            if (existingIdx >= 0) {
                presets[existingIdx] = newPreset;
            } else {
                presets.push(newPreset);
            }
            savePresets(presets);
        }

        if (editIndex >= 0 && editIndex < data.meals.length) {
            // EDIT mode — update existing meal
            const oldCalories = data.meals[editIndex].calories;
            data.consumed = Math.max(0, data.consumed - oldCalories + calories);
            data.meals[editIndex].name = displayName;
            data.meals[editIndex].calories = calories;
            data.meals[editIndex].protein = protein;
            data.meals[editIndex].carbs = carbs;
            data.meals[editIndex].fat = fat;
        } else {
            // ADD mode — new meal
            const now = new Date();
            const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            data.consumed += calories;
            data.meals.push({
                name: displayName,
                calories: calories,
                protein: protein,
                carbs: carbs,
                fat: fat,
                time: timeStr,
            });
        }

        saveTodayData(data);
        updateHeader();
        renderMealLog();
        renderHistory();
        showView('home');
    }

    // ──────────────────────────────────────────
    // SETTINGS
    // ──────────────────────────────────────────
    function openSettings() {
        els.settingName.value = getName();
        els.settingBudget.value = getBudget();
        showView("settings");
    }

    function saveSettings() {
        // Name change — update profile list and active user
        const newName = els.settingName.value.trim();
        if (newName && newName !== activeUser) {
            const profiles = getProfiles();
            const idx = profiles.indexOf(activeUser);
            if (idx !== -1) profiles[idx] = newName;
            saveProfiles(profiles);
            setActiveUser(newName);
        }

        const budget = parseInt(els.settingBudget.value, 10);
        if (budget && budget >= 500 && budget <= 10000) {
            setBudget(budget);
        }

        updateHeader();
        renderMealLog();
        renderHistory();
        showView("home");
    }

    function resetToday() {
        if (!confirm("Reset all of today's meal data?")) return;
        const fresh = { date: todayStr(), consumed: 0, meals: [] };
        saveTodayData(fresh);
        updateHeader();
        renderMealLog();
    }

    // ──────────────────────────────────────────
    // UTILS
    // ──────────────────────────────────────────
    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    function formatDate(dateStr) {
        const d = new Date(dateStr + "T00:00:00");
        return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    }

    // ──────────────────────────────────────────
    // DATA EXPORT & IMPORT
    // ──────────────────────────────────────────
    function exportData() {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith("calorieVision_")) {
                data[key] = localStorage.getItem(key);
            }
        }
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `calorie_vision_backup_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = JSON.parse(e.target.result);
                // Clear existing calorieVision data
                const keysToRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key.startsWith("calorieVision_")) keysToRemove.push(key);
                }
                keysToRemove.forEach(k => localStorage.removeItem(k));

                // Load new data
                for (const key in data) {
                    if (key.startsWith("calorieVision_")) {
                        localStorage.setItem(key, data[key]);
                    }
                }
                alert("Data imported successfully!");
                location.reload(); // Reload to pick up new state
            } catch (err) {
                alert("Invalid backup file.");
                console.error(err);
            }
        };
        reader.readAsText(file);
        event.target.value = ''; // reset input
    }

    // ──────────────────────────────────────────
    // EVENT LISTENERS
    // ──────────────────────────────────────────
    function init() {
        // Login
        $("btn-create-profile").addEventListener("click", handleCreateProfile);
        $("new-profile-name").addEventListener("keydown", (e) => {
            if (e.key === "Enter") handleCreateProfile();
        });

        // Home
        $("btn-scan").addEventListener("click", startCamera);
        $("btn-upload").addEventListener("click", triggerUpload);
        $("file-upload").addEventListener("change", handleFileUpload);
        $("btn-manual").addEventListener("click", openManualAdd);

        // Manual Add / Edit
        $("btn-manual-cancel").addEventListener("click", () => showView("home"));
        $("btn-manual-save").addEventListener("click", saveManualMeal);
        
        if (els.manualPresets) {
            els.manualPresets.addEventListener("change", () => {
                const idx = els.manualPresets.value;
                if (idx === "") {
                    els.btnDeletePreset.style.display = "none";
                    $('manual-name').value = '';
                    $('manual-calories').value = '';
                    $('manual-protein').value = '';
                    $('manual-carbs').value = '';
                    $('manual-fat').value = '';
                } else {
                    const p = getPresets()[parseInt(idx, 10)];
                    if (p) {
                        els.btnDeletePreset.style.display = "block";
                        $('manual-name').value = p.name || '';
                        $('manual-calories').value = p.calories || '';
                        $('manual-protein').value = p.protein || '';
                        $('manual-carbs').value = p.carbs || '';
                        $('manual-fat').value = p.fat || '';
                    }
                }
            });
        }
        
        if (els.btnDeletePreset) {
            els.btnDeletePreset.addEventListener("click", () => {
                const idx = els.manualPresets.value;
                if (idx !== "") {
                    const presets = getPresets();
                    if (confirm(`Delete preset "${presets[idx].name}"?`)) {
                        presets.splice(idx, 1);
                        savePresets(presets);
                        renderPresetsDropdown();
                        $('manual-name').value = '';
                        $('manual-calories').value = '';
                        $('manual-protein').value = '';
                        $('manual-carbs').value = '';
                        $('manual-fat').value = '';
                    }
                }
            });
        }

        // Camera
        $("btn-camera-back").addEventListener("click", () => {
            stopCamera();
            showView("home");
        });
        $("btn-capture").addEventListener("click", captureImage);

        // Review
        $("btn-retake").addEventListener("click", startCamera);
        $("btn-analyze").addEventListener("click", analyzeImage);

        // Results
        $("btn-discard").addEventListener("click", () => {
            lastAnalysisResult = null;
            capturedBase64 = null;
            showView("home");
        });
        $("btn-consume").addEventListener("click", consumeMeal);

        // Settings
        $("btn-settings").addEventListener("click", openSettings);
        $("btn-settings-back").addEventListener("click", saveSettings);
        $("btn-reset-today").addEventListener("click", resetToday);
        $("btn-switch-profile").addEventListener("click", switchProfile);
        els.btnExportData.addEventListener("click", exportData);
        els.btnImportData.addEventListener("click", () => els.fileImport.click());
        els.fileImport.addEventListener("change", importData);

        // Check if there's an active session
        const savedUser = getActiveUser();
        if (savedUser && getProfiles().includes(savedUser)) {
            loginAs(savedUser);
        } else {
            renderProfileList();
            showView("login");
        }
    }

    // Kick off
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
