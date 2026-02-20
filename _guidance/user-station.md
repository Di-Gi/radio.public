# Custom Stations Feature - Patch Write-up

## Current Architecture
The application currently fetches a readonly list of stations from the backend (`/api/stations`), which reads from a SQLite database or scrapes external sources. State persistence is handled client-side via `localStorage` for **Favorites** and **Settings**.

## Requirements
Allow users to register their own custom radio stations directly from the interface.
- **Storage:** Client-side only (privacy-focused, no backend auth required).
- **UI:** Integrated into the existing Settings modal.
- **Interaction:** Users should be able to input Name, URL, and coordinates.
- **UX:** "Pick on Globe" functionality to easily set coordinates.

## Approaches Considered

| Approach | Description | Verdict |
|----------|-------------|---------|
| **1. Client-Side (LocalStorage)** | Store custom stations in browser storage. Merge with API data in `main.js`. | ✅ **Recommended** (Matches existing Favorites pattern, zero backend dependency) |
| **2. Backend API** | `POST` endpoint to SQLite. Requires user auth/sessions to prevent map spamming. | ❌ Rejected (Over-engineering for single-user/kiosk context) |
| **3. URL Parameters** | Encode stations in URL hash. | ❌ Rejected (URLs become too long, harder to manage lists) |

## Implementation Strategy

### 1. Storage Layer (`StorageManager.js`)
Extend storage to handle a separate collection for `geo_radio_customs`.

### 2. Globe Interaction (`GlobeManager.js`)
Modify `onGlobeClick` to expose coordinate data (Lat/Lng) to the `UIManager`, enabling a "Click to Pick Location" feature for the custom station form.

### 3. UI Layer (`index.html` & `UIManager.js`)
Add a "Custom Transmissions" section to the settings modal.
- **List View:** Compact list of saved custom stations with delete buttons.
- **Add View:** Form with inputs for Name, Stream URL, Lat, Lng (and a "Pick" button).

### 4. Application Logic (`main.js`)
Modify the data loading routine to merge API stations with Custom stations before passing them to the Globe.

---

## Files Modified & Degree

| File Path | Layer | Change Degree | Est. Lines |
|-----------|-------|---------------|------------|
| `static/js/StorageManager.js` | Services | Minor | +25 |
| `static/js/GlobeManager.js` | Desktop | Minor | +10 |
| `static/js/UIManager.js` | Desktop | Moderate | +100 |
| `static/index.html` | Views | Moderate | +50 |
| `static/js/main.js` | Core | Minor | +15 |

---

## Detailed Modifications

### 1. File: `static/js/StorageManager.js`
**Purpose:** Manage persistence of custom stations.

```javascript
// Add CONST
const KEY_CUSTOM = 'geo_radio_customs';

// Add methods to StorageManager class
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
```

### 2. File: `static/js/GlobeManager.js`
**Purpose:** Enable coordinate picking.

**Changes:**
1. Add `this.onBackgroundClick = null;` to constructor.
2. Update `.onGlobeClick` in `init()`:

```javascript
// Inside init() chain:
.onGlobeClick(({ lat, lng }) => {
    this.resumeRotation();
    if (this.onBackgroundClick) this.onBackgroundClick({ lat, lng });
})
```

### 3. File: `static/index.html`
**Purpose:** Add the UI form.

**Changes:**
Insert this block into `#modal-box` (Settings Modal), after the "Globe Visualizer" section:

```html
<div class="modal-section">
    <div class="label">Custom Transmissions</div>
    
    <!-- LIST VIEW -->
    <div id="custom-list-view">
        <div id="custom-station-list" style="max-height: 100px; overflow-y: auto; margin-bottom: 10px;">
            <!-- JS populates this -->
        </div>
        <button id="btn-custom-add" class="speed-btn" style="width: 100%; padding: 8px;">+ Register Frequency</button>
    </div>

    <!-- ADD FORM (Hidden) -->
    <div id="custom-add-view" style="display: none;">
        <div class="setting-row">
            <input type="text" id="inp-custom-name" class="speed-btn" style="width: 100%; text-align: left; cursor: text;" placeholder="STATION NAME">
        </div>
        <div class="setting-row">
            <input type="text" id="inp-custom-url" class="speed-btn" style="width: 100%; text-align: left; cursor: text;" placeholder="STREAM URL (MP3/AAC)">
        </div>
        <div class="setting-row" style="gap: 5px;">
            <input type="number" id="inp-custom-lat" class="speed-btn" style="width: 30%; cursor: text;" placeholder="LAT">
            <input type="number" id="inp-custom-lng" class="speed-btn" style="width: 30%; cursor: text;" placeholder="LNG">
            <button id="btn-custom-pick" class="speed-btn active" style="flex: 1;">Pick on Map</button>
        </div>
        <div class="setting-row" style="margin-top: 10px; justify-content: flex-end; gap: 8px;">
            <button id="btn-custom-cancel" class="speed-btn">Cancel</button>
            <button id="btn-custom-save" class="speed-btn active" style="color: var(--accent); border-color: var(--accent);">Save</button>
        </div>
    </div>
</div>
```

### 4. File: `static/js/UIManager.js`
**Purpose:** Handle form logic and map picking.

**Changes:**
1.  **Cache Elements**: Add the new IDs to `constructor`.
2.  **Logic**: Add `_initCustomStationLogic()` called from constructor.

```javascript
_initCustomStationLogic() {
    const updateList = () => {
        const list = this.storage.getCustomStations();
        const container = document.getElementById('custom-station-list');
        container.innerHTML = '';
        if(list.length === 0) {
            container.innerHTML = '<div style="font-size:9px; color:var(--dim);">NO CUSTOM FREQUENCIES</div>';
        }
        list.forEach(s => {
            const row = document.createElement('div');
            row.className = 'setting-row';
            row.innerHTML = `
                <span class="setting-name" style="text-transform:none;">${s.name}</span>
                <button class="speed-btn" data-del="${s.uuid}">×</button>
            `;
            row.querySelector('button').onclick = () => {
                this.storage.removeCustomStation(s.uuid);
                updateList();
                this.onCustomStationChange?.(); // Callback to refresh globe
            };
            container.appendChild(row);
        });
    };

    // Toggle Views
    const viewList = document.getElementById('custom-list-view');
    const viewAdd  = document.getElementById('custom-add-view');
    
    document.getElementById('btn-custom-add').onclick = () => {
        viewList.style.display = 'none';
        viewAdd.style.display = 'block';
        // Enable picking mode
        this.globe.onBackgroundClick = (coords) => {
            document.getElementById('inp-custom-lat').value = coords.lat.toFixed(4);
            document.getElementById('inp-custom-lng').value = coords.lng.toFixed(4);
        };
    };

    const closeAdd = () => {
        viewAdd.style.display = 'none';
        viewList.style.display = 'block';
        this.globe.onBackgroundClick = null; // Disable picking
    };

    document.getElementById('btn-custom-cancel').onclick = closeAdd;

    document.getElementById('btn-custom-save').onclick = () => {
        const name = document.getElementById('inp-custom-name').value.trim();
        const url  = document.getElementById('inp-custom-url').value.trim();
        const lat  = parseFloat(document.getElementById('inp-custom-lat').value);
        const lng  = parseFloat(document.getElementById('inp-custom-lng').value);

        if(!name || !url || isNaN(lat) || isNaN(lng)) {
            alert("Invalid Input"); return;
        }

        this.storage.addCustomStation({
            uuid: 'cust-' + Date.now(),
            name, url, lat, lng,
            country: 'Custom', tags: 'User Stream', isCustom: true
        });
        
        // Reset fields
        document.getElementById('inp-custom-name').value = '';
        document.getElementById('inp-custom-url').value = '';
        
        closeAdd();
        updateList();
        this.onCustomStationChange?.();
    };

    updateList();
}
```

3. Add `setCustomStationCallback(fn)` to `UIManager` to let `main.js` hook in.

### 5. File: `static/js/main.js`
**Purpose:** Merge data sources.

**Changes:**

```javascript
// ... existing imports

// Helper to merge and update
const refreshStations = (apiData) => {
    const customData = storageMgr.getCustomStations();
    const merged = [...apiData, ...customData];
    globeMgr.updateData(merged);
};

// ... inside fetch promise
fetch('/api/stations')
    .then(res => res.json())
    .then(data => {
        // Store API data in a variable accessible to refreshStations
        // Or simpler: Just re-fetch logic for now, or keep 'apiStations' in memory
        window._apiStations = data; 
        refreshStations(data);
    });

// Hook UI callback
uiMgr.setCustomStationCallback(() => {
    if (window._apiStations) refreshStations(window._apiStations);
});
```

---

## Edge Cases Handled
1.  **Empty Inputs:** Simple validation check prevents saving null data.
2.  **Map Picking:** Uses `onBackgroundClick` so picking doesn't trigger on existing stations.
3.  **Proxying:** Custom URLs are passed to `AudioManager` which uses the existing `/api/proxy` endpoint. This ensures Mixed Content warnings (HTTP stream on HTTPS site) are avoided automatically.
4.  **Persistence:** Data survives page reloads via LocalStorage.

## User Experience Flow
1.  User opens **Settings**.
2.  Scrolls to **Custom Transmissions**.
3.  Clicks **+ Register Frequency**.
4.  Clicks on the **Globe** background (modal stays open, coordinates fill in automatically).
5.  Enters "My Synthwave Stream" and URL.
6.  Clicks **Save**.
7.  The station appears instantly on the globe and in the list.