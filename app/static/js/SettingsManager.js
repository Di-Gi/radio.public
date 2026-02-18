const STORAGE_KEY = 'geo_radio_settings';

const DEFAULTS = {
    autoRotate:    true,
    rotationSpeed: 0.5,
    vizEnabled:    true,
    vizMode:       0,      // 0=polar  1=bars  2=ring
    vizPalette:    0,      // 0=accent 1=cyan  2=plasma 3=mono
};

export class SettingsManager {
    constructor(globe) {
        this.globe  = globe;
        this._viz   = null;
        this._settings = { ...DEFAULTS };
        this._load();
    }

    // Apply globe settings after globe.init()
    apply() {
        for (const [key, value] of Object.entries(this._settings)) {
            this._applyKey(key, value);
        }
    }

    // Register VisualizerManager and apply persisted viz settings to it
    setViz(vizManager) {
        this._viz = vizManager;
    }

    applyViz() {
        if (!this._viz) return;
        this._viz.setEnabled(this._settings.vizEnabled);
        this._viz.setMode(this._settings.vizMode);
        this._viz.setPalette(this._settings.vizPalette);
    }

    get(key) {
        return this._settings[key];
    }

    set(key, value) {
        this._settings[key] = value;
        this._applyKey(key, value);
        this._save();
    }

    // ── INTERNAL ─────────────────────────────────────────────────────────────

    _applyKey(key, value) {
        switch (key) {
            case 'autoRotate':    this.globe.setAutoRotate(value);    break;
            case 'rotationSpeed': this.globe.setRotationSpeed(value); break;
            case 'vizEnabled':    this._viz?.setEnabled(value);       break;
            case 'vizMode':       this._viz?.setMode(value);          break;
            case 'vizPalette':    this._viz?.setPalette(value);       break;
        }
    }

    _load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) Object.assign(this._settings, JSON.parse(raw));
        } catch { /* corrupt storage — fall back to defaults */ }
    }

    _save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this._settings));
        } catch { /* storage unavailable */ }
    }
}
