const KEY        = 'geo_radio_favorites';
const KEY_CUSTOM = 'geo_radio_customs';

export class StorageManager {
    isFavorite(uuid) {
        return !!this._load()[uuid];
    }

    // Returns true if the station is now a favorite, false if removed.
    toggle(station) {
        const favs = this._load();
        if (favs[station.uuid]) {
            delete favs[station.uuid];
            this._save(favs);
            return false;
        }
        favs[station.uuid] = {
            uuid: station.uuid,
            name: station.name,
            country: station.country,
            lat: station.lat,
            lng: station.lng,
            url: station.url,
            tags: station.tags,
        };
        this._save(favs);
        return true;
    }

    list() {
        return Object.values(this._load());
    }

    _load() {
        try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
        catch { return {}; }
    }

    _save(favs) {
        localStorage.setItem(KEY, JSON.stringify(favs));
    }

    // ── Custom stations ──────────────────────────────────────────────────────

    getCustomStations() {
        try { return JSON.parse(localStorage.getItem(KEY_CUSTOM) || '[]'); }
        catch { return []; }
    }

    addCustomStation(station) {
        const list = this.getCustomStations();
        list.push(station);
        localStorage.setItem(KEY_CUSTOM, JSON.stringify(list));
    }

    removeCustomStation(uuid) {
        const list = this.getCustomStations().filter(s => s.uuid !== uuid);
        localStorage.setItem(KEY_CUSTOM, JSON.stringify(list));
    }
}
