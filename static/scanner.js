/* ═══════════════════════════════════════════════
   Calorie Vision — barcode scanning
   Native BarcodeDetector when available (Chrome/Android), otherwise the
   vendored ZXing WebAssembly polyfill (iOS Safari, Firefox, desktop).
   ═══════════════════════════════════════════════ */

(function () {
    "use strict";

    const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
    const POLYFILL_SRC = "/static/vendor/barcode-detector-3.2.2.js";
    const WASM_SRC = "/static/vendor/zxing_reader-3.1.3.wasm";
    const SCAN_INTERVAL_MS = 90;
    const CONFIRM_READS = 2;       // same code this many times in a row…
    const CONFIRM_WINDOW_MS = 1500; // …within this window

    let detectorPromise = null;

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = src;
            s.onload = resolve;
            s.onerror = () => reject(new Error("Couldn't load the barcode reader."));
            document.head.appendChild(s);
        });
    }

    async function createDetector() {
        if ("BarcodeDetector" in window) {
            try {
                const supported = await window.BarcodeDetector.getSupportedFormats();
                const formats = FORMATS.filter((f) => supported.includes(f));
                if (formats.includes("ean_13")) {
                    return { detector: new window.BarcodeDetector({ formats }), engine: "native" };
                }
            } catch (_) { /* fall through to polyfill */ }
        }
        if (!window.BarcodeDetectionAPI) await loadScript(POLYFILL_SRC);
        const api = window.BarcodeDetectionAPI;
        api.setZXingModuleOverrides({
            locateFile: (path, prefix) => (path.endsWith(".wasm") ? WASM_SRC : prefix + path),
        });
        const detector = new api.BarcodeDetector({ formats: FORMATS });
        // Warm up: compiles the wasm now instead of on the first frame.
        try { await detector.detect(new ImageData(8, 8)); } catch (_) { /* ignore */ }
        return { detector, engine: "zxing" };
    }

    function getDetector() {
        if (!detectorPromise) {
            detectorPromise = createDetector().catch((e) => { detectorPromise = null; throw e; });
        }
        return detectorPromise;
    }

    /** UPC-E (8 digits) → UPC-A (12), so the GS1 check digit and lookups work. */
    function expandUpcE(code) {
        if (!/^[01]\d{7}$/.test(code)) return code;
        const n = code[0], d = code.slice(1, 7), c = code[7];
        const last = d[5];
        let body;
        if ("012".includes(last)) body = d[0] + d[1] + last + "0000" + d[2] + d[3] + d[4];
        else if (last === "3") body = d[0] + d[1] + d[2] + "00000" + d[3] + d[4];
        else if (last === "4") body = d[0] + d[1] + d[2] + d[3] + "00000" + d[4];
        else body = d[0] + d[1] + d[2] + d[3] + d[4] + "0000" + last;
        return n + body + c;
    }

    function validGtin(code) {
        if (!/^\d{8,14}$/.test(code)) return false;
        const digits = code.split("").map(Number);
        const check = digits.pop();
        let sum = 0;
        digits.reverse().forEach((d, i) => { sum += d * (i % 2 === 0 ? 3 : 1); });
        return (10 - (sum % 10)) % 10 === check;
    }

    function normalize(result) {
        let code = String(result.rawValue || "").replace(/\D/g, "");
        if (result.format === "upc_e") code = expandUpcE(code);
        return validGtin(code) ? code : null;
    }

    class Scanner {
        constructor(video, { onDetect, onStatus } = {}) {
            this.video = video;
            this.onDetect = onDetect || (() => {});
            this.onStatus = onStatus || (() => {});
            this.stream = null;
            this.track = null;
            this.running = false;
            this.timer = null;
            this.canvas = document.createElement("canvas");
            this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
            this.lastCode = null;
            this.hits = 0;
            this.firstHitAt = 0;
            this.torchOn = false;
        }

        async start() {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error(window.isSecureContext
                    ? "This browser can't use the camera. Type the barcode instead."
                    : "The camera needs a secure (https) connection. Type the barcode instead.");
            }
            const detectorReady = getDetector();
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    facingMode: { ideal: "environment" },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
            });
            this.track = this.stream.getVideoTracks()[0];
            this.video.srcObject = this.stream;
            await this.video.play().catch(() => {});
            await this.tuneCamera();
            this.onStatus("loading");
            const { detector, engine } = await detectorReady;
            this.detector = detector;
            this.engine = engine;
            if (!this.stream) return; // stopped while loading
            this.running = true;
            this.onStatus("ready");
            this.loop();
        }

        async tuneCamera() {
            const caps = this.track && this.track.getCapabilities ? this.track.getCapabilities() : {};
            const advanced = [];
            if (caps.focusMode && caps.focusMode.includes("continuous")) advanced.push({ focusMode: "continuous" });
            // A little zoom lets phones with wide main cameras focus on small barcodes.
            if (caps.zoom && caps.zoom.max >= 1.6) advanced.push({ zoom: Math.min(2, caps.zoom.max) });
            if (advanced.length) {
                try { await this.track.applyConstraints({ advanced }); } catch (_) { /* best effort */ }
            }
            this.canTorch = !!caps.torch;
        }

        async setTorch(on) {
            if (!this.track || !this.canTorch) return false;
            try {
                await this.track.applyConstraints({ advanced: [{ torch: on }] });
                this.torchOn = on;
            } catch (_) { return false; }
            return true;
        }

        /** Crop to the centre band where the on-screen guide box sits. */
        grabFrame() {
            const v = this.video;
            const vw = v.videoWidth, vh = v.videoHeight;
            if (!vw || !vh) return null;
            const cropW = Math.round(vw * 0.86);
            const cropH = Math.round(Math.min(vh * 0.5, cropW * 0.6));
            const sx = Math.round((vw - cropW) / 2), sy = Math.round((vh - cropH) / 2);
            const scale = Math.min(1, 1280 / cropW);
            const w = Math.round(cropW * scale), h = Math.round(cropH * scale);
            if (this.canvas.width !== w) this.canvas.width = w;
            if (this.canvas.height !== h) this.canvas.height = h;
            this.ctx.drawImage(v, sx, sy, cropW, cropH, 0, 0, w, h);
            return this.engine === "native" ? this.canvas : this.ctx.getImageData(0, 0, w, h);
        }

        async loop() {
            if (!this.running) return;
            const started = performance.now();
            try {
                const frame = this.grabFrame();
                if (frame) {
                    const results = await this.detector.detect(frame);
                    for (const r of results) {
                        const code = normalize(r);
                        if (code && this.confirm(code)) {
                            this.running = false;
                            this.onDetect(code);
                            return;
                        }
                    }
                }
            } catch (e) {
                console.warn("barcode detect failed", e);
            }
            if (!this.running) return;
            const wait = Math.max(0, SCAN_INTERVAL_MS - (performance.now() - started));
            this.timer = setTimeout(() => this.loop(), wait);
        }

        confirm(code) {
            const now = performance.now();
            if (code === this.lastCode && now - this.firstHitAt < CONFIRM_WINDOW_MS) {
                this.hits += 1;
            } else {
                this.lastCode = code;
                this.hits = 1;
                this.firstHitAt = now;
            }
            return this.hits >= CONFIRM_READS;
        }

        resume() {
            this.lastCode = null;
            this.hits = 0;
            if (this.stream && !this.running && this.detector) {
                this.running = true;
                this.loop();
            }
        }

        stop() {
            this.running = false;
            clearTimeout(this.timer);
            if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
            this.stream = null;
            this.track = null;
            this.video.srcObject = null;
        }
    }

    /** Decode a barcode from a still photo (file input fallback). */
    async function decodeFile(file) {
        const { detector } = await getDetector();
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const source = window.BarcodeDetectionAPI && detector instanceof window.BarcodeDetectionAPI.BarcodeDetector
            ? ctx.getImageData(0, 0, canvas.width, canvas.height)
            : canvas;
        const results = await detector.detect(source);
        for (const r of results) {
            const code = normalize(r);
            if (code) return code;
        }
        return null;
    }

    window.CVScanner = { Scanner, decodeFile, validGtin, expandUpcE, preload: () => getDetector().catch(() => {}) };
})();
