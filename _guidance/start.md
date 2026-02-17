This investigation explores ways to transition the **Geo-Radio** concept from a technical demo into a solidified, "viable" product. We will focus on deepening the immersion, improving stream reliability, and adding user retention features like "Favorites" and "Scan Mode."

---

# Geo-Radio - Product Solidification Investigation

## Current Architecture
The current system uses a **FastAPI** backend to scrape `radio-browser` into a **SQLite** DB. The frontend uses **Globe.gl** (Three.js) with custom shaders for a "tactical/glass" aesthetic. Audio is piped through a **Python proxy** to bypass CORS and protocol issues.

## Requirements for Viability
1.  **Immersive Audio Feedback**: Users need to *see* the sound (Visualizers).
2.  **Discovery Tools**: "Scan" functionality to browse the globe automatically.
3.  **Persistence**: A way to save "frequencies" (Favorites).
4.  **Atmospheric Realism**: Contextual data like local time at the station's coordinates.
5.  **Stream Health**: Automated verification of station URLs to prevent "dead air."

---

## Approaches Considered

### 1. The "Analog Shortwave" Experience (Recommended) ✅
*   **Description**: Add CSS/Shader "interference" during station transitions, a frequency scanner, and a Web Audio API visualizer.
*   **Pros**: High "cool factor," masks loading latencies with aesthetic "static."
*   **Cons**: Higher CPU/GPU usage.

### 2. The "Data Hub" Experience
*   **Description**: Focus on metadata—news feeds, weather at the location, and detailed station history.
*   **Pros**: Informative and useful.
*   **Cons**: Moves away from the minimalist aesthetic; harder to source data.

### 3. The "Social Radio" Experience
*   **Description**: See where other users are currently listening on the globe (real-time).
*   **Pros**: High retention, makes the world feel "alive."
*   **Cons**: Requires WebSockets and a more complex backend.

---

## Implementation Strategy

### Phase 1: The "Signal" (Audio Visualizer)
Integrate the **Web Audio API** into `AudioManager.js`. Instead of just an `Audio` object, create an `AudioContext` with an `AnalyserNode`. Pass this data to the `UIManager` to render a minimalist CSS or Canvas waveform.

### Phase 2: The "Memory" (Favorites System)
Implement a `StorageManager.js` using `localStorage`. Allow users to "Star" a station. These stations should appear as a different color (e.g., bright Cyan) on the globe.

### Phase 3: The "Scan" (Discovery Mode)
Add a "SCAN" button. When active, the system plays a station for 10 seconds, then automatically rotates the globe to a new random station, creating a lean-back discovery experience.

---

## Files Modified & Degree

| File Path | Layer | Change Degree | Estimated Lines |
|-----------|-------|---------------|----------------|
| `app/static/js/AudioManager.js` | UI/Logic | Moderate | +40 |
| `app/static/index.html` | UI | Minor | +20 |
| `app/static/js/UIManager.js` | UI | Moderate | +60 |
| `app/database.py` | Data | Minor | +15 |
| `app/main.py` | Backend | Moderate | +30 |

---

## Detailed Modification Plan

### 1. Signal Visualizer (The "Voice" of the Radio)
**File**: `app/static/js/AudioManager.js`
We need to connect the audio stream to an Analyser.
```javascript
// New method in AudioManager
setupVisualizer(canvasElement) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = ctx.createMediaElementSource(this.audio);
    const analyser = ctx.createAnalyser();
    source.connect(analyser);
    analyser.connect(ctx.destination);
    // ... animation loop to draw to canvas
}
```

### 2. Time-Zone Calculation (Contextual Realism)
**File**: `app/static/js/UIManager.js`
Calculate the local time of the station based on its Longitude to show if it's "Night" or "Day" at the broadcast location.
```javascript
getLocalTime(lng) {
    const utcOffset = lng / 15; // Rough estimate
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * utcOffset));
}
```

### 3. Backend Health Checker
**File**: `app/main.py`
A background task that pings station URLs. If a station returns a 404/500 repeatedly, it is flagged in the DB and hidden from the `api/stations` endpoint.

---

## Edge Cases Handled

1.  **Autoplay Restrictions**: Browsers block audio until a user clicks. 
    *   *Solution*: The "INITIATE LINK" button serves as the explicit user gesture required to resume the `AudioContext`.
2.  **High Latency Streams**: Some stations take 5+ seconds to buffer.
    *   *Solution*: UI should show a "SYNCHRONIZING..." state with a progress bar or spinning "tuning" icon.
3.  **CORS/HLS Issues**: Many modern stations use `.m3u8` (HLS).
    *   *Solution*: The current proxy handles raw streams well, but adding `hls.js` to the frontend would expand support to 30% more stations.

---

## Paths We Opt NOT to Take
*   **User Accounts**: We will use `localStorage` instead of a full Auth system. This keeps the app "frictionless"—no login required to start listening.
*   **Mobile App**: We will focus on a PWA (Progressive Web App) approach rather than native iOS/Android to keep the codebase unified.

---

## User Experience Flow (The "Perfect Session")
1.  **Arrival**: User opens the site; globe is rotating slowly in "Standby."
2.  **Discovery**: User clicks "SCAN." The globe zips to a random point in Japan. Low-fi static plays for 0.5s, then Japanese jazz begins.
3.  **Context**: User sees "LOCAL TIME: 03:42 AM" and the station's "Signal Strength" (Visualizer) dancing.
4.  **Retention**: User likes the track, clicks the "STAR" icon. The station is saved to their sidebar for future sessions.
5.  **Immersion**: User zooms out; their "Star" is now a permanent glowing beacon on the dark globe.

---

### Next Steps for Implementation:
1.  **Implement the Web Audio Analyser** in `AudioManager.js`.
2.  **Add the "Local Time" logic** to the metadata panel.
3.  **Create a simple "Favorites" list** in the UI that persists to `localStorage`.