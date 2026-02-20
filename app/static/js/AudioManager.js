export class AudioManager {
    constructor(statusCallback) {
        this.audio = new Audio();
        this.audio.crossOrigin = "anonymous";
        this.statusCallback = statusCallback; // (isPlaying, statusText) => {}
        this.audioCtx = null;
        this.analyser = null;

        this._bindEvents();
    }

    _bindEvents() {
        this.audio.addEventListener('waiting', () => this.statusCallback(true, "BUFFERING..."));
        this.audio.addEventListener('playing', () => {
            this._ensureAudioContext();
            this.statusCallback(true, "TRANSMITTING");
        });
        this.audio.addEventListener('error', () => {
            const err = this.audio.error;
            const codes = {
                1: "ABORTED",
                2: "NETWORK",
                3: "DECODE",
                4: "SRC_NOT_SUPPORTED",
            };
            const label = err ? (codes[err.code] ?? `UNKNOWN(${err.code})`) : "NO_ERROR_OBJ";
            const msg   = err?.message || "(no message)";
            console.error(`[AudioManager] error — code=${label} msg="${msg}" networkState=${this.audio.networkState} readyState=${this.audio.readyState} src=${this.audio.src}`);
            this.statusCallback(false, "SIGNAL LOST");
        });
    }

    // Called once on first play event — safe to call after user gesture.
    // createMediaElementSource may only be called once per Audio element,
    // so we guard with the null check.
    _ensureAudioContext() {
        if (this.audioCtx) {
            if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
            return;
        }
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = this.audioCtx.createMediaElementSource(this.audio);
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.8;
        source.connect(this.analyser);
        this.analyser.connect(this.audioCtx.destination);
    }

    play(url) {
        this.audio.pause();
        this.audio.src = "";
        this.audio.load();

        this.statusCallback(false, "ESTABLISHING LINK...");

        this.audio.src = `/api/proxy?url=${encodeURIComponent(url)}`;
        this.audio.play().catch(e => {
            console.warn("Autoplay blocked or stream failed:", e);
            this.statusCallback(false, "CONNECTION FAILED");
        });
    }

    stop() {
        this.audio.pause();
        this.audio.src = "";
        this.statusCallback(false, "STANDBY");
    }

    toggle(url) {
        if (!this.audio.paused && this.audio.src.includes("proxy")) {
            this.stop();
        } else {
            this.play(url);
        }
    }
}
