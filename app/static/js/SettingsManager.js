const STORAGE_KEY = 'geo_radio_settings';

const DEFAULTS = {
    autoRotate:    true,
    rotationSpeed: 0.5,
};

export class SettingsManager {
    constructor(globe) {
        this.globe     = globe;
        this._settings = { ...DEFAULTS };
        this._load();
    }

    // Apply persisted settings to the scene — call after globe.init()
    apply() {
        for (const [key, value] of Object.entries(this._settings)) {
            this._applyKey(key, value);
        }
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
