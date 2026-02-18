# Performance Analysis & Replacement Plan
_Phase 2 — Concrete replacements, sorted by expected gain. No visual quality loss target._

---

## Priority Stack (sorted by weight × ease)

| ID | Area | Gain | Effort | Risk to Visual |
|----|------|------|--------|----------------|
| G1/G2 | FBM octave reduction | **High** | Low | Very Low |
| G4 | Background sphere segment count | **Medium** | Trivial | None |
| C1 | Mousemove rAF gating | **Medium** | Low | None |
| CSS1 | Backdrop-filter thinning | **Medium** | Low | Very Low |
| C2 | Canvas dimension caching | Low | Trivial | None |
| C5 | Pin refresh batching | Low–Med | Low | None |
| C3 | Idle visualizer throttle | Low | Low | None |
| C4 | Search debounce | Low | Trivial | None |

---

## [G1/G2] FBM Octave Reduction — Highest Priority

### Current State
`Shaders.js:142–157` — `fbm()` runs 5 octave iterations.
The nebula uses **7 total FBM calls** per pixel (q.x, q.y, q.z, r.x, r.y, r.z + final f).

```
7 calls × 5 octaves × ~200 ops (snoise) = ~7,000 ops/pixel/frame
```

### Replacement
Reduce to **3 octaves**. The domain warping itself (stacking q then r) provides most of the visual complexity — the octave count just adds fine grain detail on top. With 3 octaves the macro structure is identical; you lose some sub-pixel noise.

```glsl
// BEFORE
for (int i = 0; i < 5; ++i) {

// AFTER
for (int i = 0; i < 3; ++i) {
```

**Also**: amplitude `a` starts at 0.5 and halves each octave. With 3 octaves, the maximum signal range narrows. To compensate, rescale the output slightly. Add a `* 1.15` multiplier to the fbm return (or adjust the nebula mix clamp).

**Secondary option (stack with above)**: reduce the domain warp from 2 layers (q + r) to 1 (q only). The `r` warp is the outer warp on top of q, adding a second level of displacement. Removing `r` simplifies to 4 FBM calls (q.x, q.y, q.z + final f) vs 7. The q-warp alone still produces very convincing nebula structure.

```
// Combined: 4 calls × 3 octaves = 12 snoise calls vs current 35
// Reduction: ~65% of shader cost
```

### Expected Gain
~40% reduction (octaves only) to ~65% (octaves + r-layer removal) of background shader cost.
At 1080p this represents millions fewer ALU ops per frame.

---

## [G4] Background Sphere Segments — Trivial Win

### Current State
`GlobeManager.js:111` — `SphereGeometry(1000, 64, 64)` = 4,096 quad faces (8,192 triangles).

The background is a sky sphere. The shader output is smooth (noise-based, no hard edges at geometry boundaries). No lighting. Camera is inside it. Segment count is completely invisible.

### Replacement
```js
// BEFORE
new THREE.SphereGeometry(1000, 64, 64)

// AFTER
new THREE.SphereGeometry(1000, 32, 32)
```

**32×32** = 1,024 faces — 75% vertex reduction. Could go as low as 24×24 (576 faces) with zero visual change.

### Expected Gain
75% vertex processing reduction for the background sphere. Frees vertex shader throughput.

---

## [C1] Mousemove Raycasting — rAF Gate

### Current State
`UIManager.js:33–39` — fires `globe.getCoords()` (Three.js ray-sphere intersection) on _every_ `mousemove` event. At typical cursor speeds this can be 100–400 events/second vs the 60fps render budget.

```js
document.addEventListener('mousemove', (e) => {
    const coords = this.globe.getCoords(e.clientX, e.clientY);
    // DOM update ×2 on every pixel movement
});
```

### Replacement
Store the latest mouse position in the event handler (cheap). Consume it in a rAF loop (or the existing Globe.gl render tick). This bounds raycasting to ≤60/sec regardless of mouse speed.

```js
// State
this._pendingMouse = null;
this._mouseScheduled = false;

// Handler — just stores position, no compute
document.addEventListener('mousemove', (e) => {
    this._pendingMouse = { x: e.clientX, y: e.clientY };
    if (!this._mouseScheduled) {
        this._mouseScheduled = true;
        requestAnimationFrame(() => {
            this._mouseScheduled = false;
            if (!this._pendingMouse || !this.globe?.world) return;
            const coords = this.globe.getCoords(this._pendingMouse.x, this._pendingMouse.y);
            if (coords) {
                this.elLat.innerText = `${Math.abs(coords.lat).toFixed(4)} ${coords.lat >= 0 ? 'N' : 'S'}`;
                this.elLng.innerText = `${Math.abs(coords.lng).toFixed(4)} ${coords.lng >= 0 ? 'E' : 'W'}`;
            }
            this._pendingMouse = null;
        });
    }
});
```

### Expected Gain
Eliminates excess JS thread blocking from synchronous raycasting during fast mouse movement. Particularly impactful during globe interactions (drag + pan).

---

## [CSS1] Backdrop-Filter Thinning

### Current State
`index.html:37–38` — `.panel` class (4 panels) + `#pin-tooltip` (line 268).

```css
backdrop-filter: blur(16px) saturate(180%) contrast(108%);
```

**5 elements** with this filter, all stacked over animated WebGL. Each one forces the compositor to:
1. Sample the WebGL framebuffer region behind the element
2. Apply a 16px Gaussian blur (expensive — radius scales quadratically)
3. Apply saturation + contrast passes on top
4. Composite the result

The `contrast(108%)` in particular adds a full compositor pass for a barely perceptible 8% contrast bump.

### Replacement — Two options

**Option A: Reduce aggressiveness (recommended first step)**
```css
/* BEFORE */
backdrop-filter: blur(16px) saturate(180%) contrast(108%);

/* AFTER */
backdrop-filter: blur(10px) saturate(160%);
```
Drop blur from 16→10px (cheaper — blur cost scales with radius²), remove `contrast`, reduce saturation slightly. The glass look is maintained; the panels are over a mostly dark background anyway.

**Option B: will-change promotion (additive, on top of A)**
```css
.panel {
    will-change: transform;
}
```
Forces each panel to its own compositor layer, reducing re-composite cost when the WebGL content behind them updates (every frame). Trade-off: slightly higher VRAM for extra layers.

**Note on `#pin-tooltip`:** It moves with the cursor at 60fps while visible. This is particularly expensive because it invalidates the compositor region on every frame. Consider removing `backdrop-filter` from the tooltip entirely and using a solid semi-transparent background instead — the tooltip is tiny (9px text) and the blur reads as noise at that scale anyway.

```css
/* BEFORE */
#pin-tooltip {
    backdrop-filter: blur(16px) saturate(180%);
    background: var(--glass); /* rgba(12, 15, 22, 0.15) — near transparent */
}

/* AFTER */
#pin-tooltip {
    /* no backdrop-filter */
    background: rgba(12, 15, 22, 0.82); /* opaque enough to read, no compositor cost */
}
```

### Expected Gain
Compositor load reduction on every frame. Tooltip fix is the highest-value individual change here since it forces a re-composite every frame during hover.

---

## [C2] Canvas Dimension Caching

### Current State
`UIManager.js:137–140` — reads `offsetWidth` and `offsetHeight` inside the 60fps draw loop.

```js
const w = canvas.offsetWidth  || 340;
const h = canvas.offsetHeight || 38;
if (canvas.width !== w)  canvas.width  = w;
if (canvas.height !== h) canvas.height = h;
```

`offsetWidth/offsetHeight` are layout-triggering reads. If anything has dirtied the layout (even a style change elsewhere), these reads cause a full layout reflow at 60fps.

### Replacement
Cache dimensions. Only re-read on a `ResizeObserver` callback.

```js
// Init once
let cachedW = canvas.offsetWidth  || 340;
let cachedH = canvas.offsetHeight || 38;
canvas.width  = cachedW;
canvas.height = cachedH;

const ro = new ResizeObserver(([entry]) => {
    cachedW = entry.contentRect.width  || 340;
    cachedH = entry.contentRect.height || 38;
    canvas.width  = cachedW;
    canvas.height = cachedH;
});
ro.observe(canvas);

// In draw():
// replace the 4 lines above with:
const w = cachedW;
const h = cachedH;
```

### Expected Gain
Eliminates potential layout reflow at 60fps. Low cost but clean.

---

## [C5] Pin Refresh Batching

### Current State
`GlobeManager.js:187–197` — `setSelected()` and `setPlaying()` each independently call `_refreshPoints()` + `_updateRings()`. A station click triggers both calls back-to-back, causing 2× Globe.gl point rebuilds in the same tick.

```js
setSelected(uuid) {
    this.selectedUuid = uuid;
    this._refreshPoints();   // Globe.gl rebuild #1
    this._updateRings();
}

setPlaying(uuid) {
    this.playingUuid = uuid;
    this._refreshPoints();   // Globe.gl rebuild #2
    this._updateRings();
}
```

### Replacement
Defer the actual rebuild with `queueMicrotask` (or `Promise.resolve().then()`). Multiple synchronous state updates in the same tick collapse into a single rebuild.

```js
_scheduleRefresh() {
    if (this._refreshPending) return;
    this._refreshPending = true;
    queueMicrotask(() => {
        this._refreshPending = false;
        this._refreshPoints();
        this._updateRings();
    });
}

setSelected(uuid) {
    this.selectedUuid = uuid;
    this._scheduleRefresh();
}

setPlaying(uuid) {
    this.playingUuid = uuid;
    this._scheduleRefresh();
}

refreshPointColors() {
    this._scheduleRefresh();
}
```

### Expected Gain
Halves Globe.gl rebuild calls on station interactions. Small but clean — eliminates guaranteed double rebuild on play.

---

## [C3] Idle Visualizer Throttle

### Current State
`UIManager.js:156–164` — visualizer runs rAF at 60fps unconditionally. When idle (no audio), it draws a static flat line every frame.

```js
} else {
    // Idle flat-line — redraws 60× per second doing nothing
    ctx.strokeStyle = 'rgba(255, 68, 0, 0.18)';
    ...
}
requestAnimationFrame(draw);
```

### Replacement
When `audio.analyser` is null, draw once and pause the loop. Resume on audio start.

```js
let vizRunning = false;

const draw = () => {
    if (this.audio.analyser) {
        // ... existing bar drawing ...
        requestAnimationFrame(draw);  // only recurse when active
    } else {
        // Draw flat line once and stop
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(255, 68, 0, 0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        vizRunning = false;
        // Don't recurse — loop dies here
    }
};

// Public method to (re)start the loop when audio connects:
startViz() {
    if (!vizRunning) {
        vizRunning = true;
        requestAnimationFrame(draw);
    }
}
```

Call `startViz()` from `AudioManager` when `analyser` is connected.

### Expected Gain
Eliminates a full rAF loop at 60fps when nothing is playing. Reduces main thread pressure in idle state.

---

## [C4] Search Debounce

### Current State
`UIManager.js:43–50` — `filter()` + `pointsData()` re-feed on every keystroke.

### Replacement
150ms debounce. Trivial.

```js
let searchTimer = null;
this.elSearch.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        const val = e.target.value.toLowerCase();
        const filtered = this.globe.stations.filter(s =>
            (s.name    || '').toLowerCase().includes(val) ||
            (s.tags    || '').toLowerCase().includes(val) ||
            (s.country || '').toLowerCase().includes(val)
        );
        this.globe.world.pointsData(filtered);
    }, 150);
});
```

### Expected Gain
Eliminates intermediate Globe.gl rebuilds on fast typing. The UX is imperceptibly different (150ms lag on a search field is fine, especially with a short filter).

---

## Implementation Order

1. **G1/G2** — FBM 5→3 octaves. Test visual quality. If acceptable, optionally remove r-warp layer.
2. **G4** — Sphere segments 64→32. Zero risk, do it immediately.
3. **C1** — Mousemove rAF gate. High-impact during interactions.
4. **CSS1** — Reduce blur + remove tooltip backdrop-filter. Compositor savings every frame.
5. **C2** — ResizeObserver canvas. Trivial, do alongside CSS1.
6. **C5** — Pin refresh batching. Quick win, clean code improvement.
7. **C3 + C4** — Idle visualizer + search debounce. Polish.

---

## What We're Not Touching

- **Globe.gl internals** (`comp.<computed>`, ring timers) — not editable without forking the library. Acceptable cost since rings only exist when a station is selected.
- **GlobeMaterial Fresnel** — low enough cost, no meaningful gain from optimizing.
- **Auto-rotate** — inherent to the UX, cost is negligible vs shader load.
- **snoise algorithm** — canonical implementation, replacing with a different noise function is an option but scope-creep until G1/G2 are validated.
