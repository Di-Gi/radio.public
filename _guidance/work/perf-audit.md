# Performance Audit — Viewport & Frontend
_Status: Investigation complete. Pending analysis + replacement planning._

---

## Context

Profile snapshot at load-in showed:
- `localhost` (render/frame cost): **2,553.9 ms — 97.2%**
- `comp.<computed>` (globe__gl.js:858): **1,400.4 ms — 53.3%**
- `timerExpired` (globe__gl.js:686): **1,033.2 ms — 39.3%**

Primary complaint: high baseline GPU/CPU cost from shader + globe leaves little headroom for additional animation (rotation jitter, sluggish response).

---

## Expensive Operations — Collected List

Ordered by discovery, not weight. Re-sort by weight in next phase.

---

### GPU — Shaders.js

#### [G1] Background Shader — Fractal Brownian Motion (5 octaves × domain warp)
- **File:** `Shaders.js:142–157`
- **What:** `fbm()` calls `snoise()` 5× per call. Domain warping calls `fbm()` 6× total (q.x, q.y, q.z, r.x, r.y, r.z) + 1 final `fbm()` = **7 full FBM chains** per pixel.
- **Cost:** ~1,000–1,500 ALU ops/pixel
- **Runs:** Every frame on the entire background sphere (~1M+ pixels at 1080p)
- **Notes:** Animated via `uTime * 0.02` + per-axis offsets. Provides the nebula structure.

#### [G2] Background Shader — Simplex Noise 3D (snoise)
- **File:** `Shaders.js:67–139`
- **What:** Each call: 3× `mod289`, 3× `permute`, 1× `taylorInvSqrt`, multiple dot products, `abs`, `floor`, `step`, `max`, `pow`. ~200 ops per invocation.
- **Cost:** Called 35× per pixel (7 FBM chains × 5 octaves)
- **Notes:** Standard snoise, no room to simplify in-place without replacing.

#### [G3] Background Shader — 3 Star Layers with Twinkle
- **File:** `Shaders.js:234–236`
- **What:** `starLayer()` called 3×. Each call: 3× `hash12`, `length`, `pow`, `sin(uTime * ...)`. ~100 ops/pixel total.
- **Runs:** Every frame, every pixel

#### [G4] Background Sphere — Geometry Overdraw
- **File:** `GlobeManager.js:110–114`
- **What:** `SphereGeometry(1000, 64, 64)` — 64×64 = 4,096 segments. Background sphere is rendered at r=1000, camera is inside it. Entire sphere is in view every frame.
- **Notes:** High segment count for a solid-color-ish background adds unnecessary vertex processing. Could reduce segments significantly without visual change.

#### [G5] Globe Glass Shader — Fresnel per Fragment
- **File:** `Shaders.js:15–37`
- **What:** Fresnel calc `pow(1.0 - NdotV, 7.0)` per fragment. Applied to entire globe surface.
- **Cost:** Light — ~30 ops/pixel — but on a high-poly globe mesh.
- **Notes:** Not a primary bottleneck but stacks with scene cost.

---

### CPU — JavaScript

#### [C1] Mousemove — Raycasting on Every Pixel
- **File:** `UIManager.js:33–39`
- **What:** `globe.getCoords(x, y)` fires on every `mousemove` event — no throttle/debounce. Three.js raycasting is non-trivial (ray-sphere intersection + coord transform).
- **Impact:** Contiguous mouse movement = many raycasts/frame. Blocks JS thread.
- **Fix signal:** Throttle to ~16ms (once per frame) or requestAnimationFrame-gate.

#### [C2] Visualizer Canvas — DOM Size Read Every Frame
- **File:** `UIManager.js:137–140`
- **What:** `canvas.offsetWidth` / `canvas.offsetHeight` read inside `draw()` which runs at 60 FPS. DOM layout reads can trigger reflow if layout is dirty.
- **Fix signal:** Cache size, only re-read on `ResizeObserver` event.

#### [C3] Visualizer Canvas — No OffscreenCanvas / Worker
- **File:** `UIManager.js:130–169`
- **What:** Canvas 2D draw loop running at 60 FPS on main thread alongside the Three.js WebGL render loop. Both compete for the main thread.
- **Notes:** 128 bars drawn per frame. Minor individually, but main thread contention with WebGL compounds.

#### [C4] Search Filter — Linear O(n) Scan Per Keystroke
- **File:** `UIManager.js:43–50`
- **What:** `stations.filter()` over entire dataset comparing 3 string fields per station. Then re-feeds filtered array to `globe.world.pointsData()` which triggers Globe.gl pin regeneration.
- **Impact:** Scales with station count. Keystroke-level latency visible with large datasets.

#### [C5] Pin State Refresh — Full Re-feed on Any State Change
- **File:** `GlobeManager.js:243–246`
- **What:** `refreshPointColors()` and `_refreshRings()` spread the full stations array and re-feed to Globe.gl on every: favorite toggle, selection change, playback state change.
- **Impact:** Globe.gl rebuilds all pin geometry on each call. O(n) rebuild for a single-station state change.

#### [C6] Globe.gl Internal — `comp.<computed>` (858) + `timerExpired` (686)
- **File:** `globe__gl.js` (bundled Globe.gl)
- **What:** Profile shows 53% cost in Globe.gl's computed property evaluation and 39% in timer-driven animations (ring pulses, auto-rotate). These are library internals.
- **Notes:** Not directly editable but can be influenced by: reducing ring count, disabling unused features, or configuring lower-frequency update ticks.

#### [C7] Auto-Rotate — Globe.gl autoRotateSpeed at Full Frame Rate
- **File:** `GlobeManager.js:125`
- **What:** `controls.autoRotateSpeed = 0.3`. OrbitControls auto-rotate recalculates camera position every frame even when nothing else is happening.
- **Notes:** Low cost individually, but when combined with shader + pin updates = no idle frames.

---

### CSS — Compositor Layer Cost

#### [CSS1] Backdrop Filters on Multiple Panels
- **File:** `index.html` (embedded CSS)
- **What:** `backdrop-filter: blur(16px) saturate(180%) contrast(108%)` applied to multiple overlapping glass UI panels. Each panel with `backdrop-filter` forces its own compositor layer and a full blur pass over the content behind it.
- **Impact:** High compositor cost, especially when the panels overlap animated WebGL content (the globe). Not on main thread but taxes GPU compositing budget.
- **Notes:** Number of panels with this property and their z-stack determines total cost.

---

## Pipeline Map (Summary)

```
Per Frame (60 FPS target):
├── JS Main Thread
│   ├── GlobeManager._animate()           — uTime increment + rAF
│   ├── Globe.gl internals                — comp.<computed>, ring timers [C6]
│   ├── UIManager visualizer draw()       — canvas size read [C2] + 128-bar draw [C3]
│   └── Mousemove handlers (async)        — raycasting [C1]
│
├── GPU — WebGL
│   ├── BackgroundMaterial (full sphere)
│   │   ├── FBM × 7 chains × 5 octaves   [G1][G2]
│   │   └── 3 star layers + twinkle       [G3]
│   ├── GlobeMaterial (globe surface)     [G5]
│   └── Globe.gl pins + rings + borders  [C6]
│
└── GPU — Compositor
    └── backdrop-filter blur passes       [CSS1]
```

---

## Next Steps

- [ ] Sort by measured weight once profiler data is mapped to items
- [ ] Design replacements for each item — no visual quality loss target
- [ ] Prioritize: G1/G2 (shader cost), C1 (mousemove), CSS1 (backdrop-filter), C5 (pin refresh)
- [ ] Evaluate: baked texture for background nebula (static or low-FPS update)
- [ ] Evaluate: reduce fbm octave count (5 → 3) with compensating scale tweak
- [ ] Evaluate: throttle uTime increment to reduce nebula animation rate without stopping it
