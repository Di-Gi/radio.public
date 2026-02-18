# Globe Visualizer — Investigation & Architecture
_Phase: Pre-implementation. Recommendation ready._

---

## What We're Building

An audio frequency visualizer rendered **inside** the globe, visible through the glass Fresnel shell. Configurable via Settings (enable/disable, mode, palette). Distinct from the existing canvas visualizer in the station panel — that stays untouched.

---

## Key Facts from Codebase

| Thing | Value |
|---|---|
| Globe radius (Globe.gl default) | ~100 Three.js units |
| Camera minDistance | 120 units |
| Camera maxDistance | 800 units |
| Background sphere | r=1000 (camera inside) |
| Audio FFT bins | 128 (fftSize=256, getByteFrequencyData) |
| analyser access | `audioManager.analyser` — public, null until first play |
| Scene access | `this.world.scene()` — already used to add bgMesh |
| Three.js version | r182 — WebGL 2, GLSL ES 3.0 available |
| Existing animate hook | `GlobeManager._animate()` — clean injection point |

---

## Architecture Decision

### The Pipeline: DataTexture → GLSL Shader

**Chosen approach:** `THREE.DataTexture` (128×1, LuminanceFormat) fed from the AnalyserNode each frame → custom GLSL ShaderMaterial on a `THREE.CircleGeometry` centered inside the globe.

**Rejected alternatives:**

| Approach | Why rejected |
|---|---|
| Shader on GlobeMaterial | Globe surface is small in view, spherical UV distortion, complicates glass shader |
| Canvas 2D CanvasTexture | CPU draw + GPU upload every frame, no shader compositing, harder to extend |
| BufferGeometry lines (CPU) | Expensive attribute updates per frame, no GPU efficiency |
| Inner sphere geometry | Loses frequency detail, better for simple pulse effects only |

**Why DataTexture + CircleGeometry wins:**
- `Uint8Array` FFT data → DataTexture is a direct memcpy, near-zero CPU cost
- Shader reads frequency bins in UV space — unlimited visual flexibility
- `THREE.AdditiveBlending` + `depthWrite: false` = perfectly composited glow through glass
- GPU does all the visualization math — no layout thrash, no canvas context
- Multiple shader modes via a single `uMode` int uniform — zero geometry changes between modes
- Consistent with the existing BackgroundMaterial shader pattern

---

## Geometry

```js
new THREE.CircleGeometry(82, 128)
```

- **Radius 82**: inside the globe (r≈100), giving clearance from the glass shell
- **128 segments**: enough resolution for smooth polar arcs
- **Position**: `(0, 0, 0)` — dead center of the scene
- **Rotation**: `(-Math.PI / 2, 0, 0)` — flat/horizontal, or left world-aligned; either works
- `side: THREE.DoubleSide` — visible from both hemispheres
- `transparent: true, depthWrite: false` — composites cleanly over globe contents
- `blending: THREE.AdditiveBlending` — black = invisible, color = glow. Silent = nothing visible.
- `renderOrder: -1` — renders before globe surface, avoids z-sort fighting with glass

---

## Audio Pipeline (per frame)

```
AnalyserNode.getByteFrequencyData(Uint8Array[128])
    → copy into DataTexture.image.data
    → texture.needsUpdate = true
    → Three.js uploads to GPU (single row texture = minimal bandwidth)
    → Shader reads: texture2D(uFreqData, vec2(bin/128.0, 0.5)).r → 0.0–1.0
```

The DataTexture: `new THREE.DataTexture(data, 128, 1, THREE.LuminanceFormat)`
LuminanceFormat = 1 byte/pixel = 128 bytes/frame upload. Essentially free.

---

## Shader Modes

Three modes selected by `uMode` int uniform. Shader lives in `Shaders.js` as `VisualizerMaterial`.

### Mode 0 — Polar (default)
FFT bins mapped around a full circle. Radial amplitude bars extend from an inner ring outward.

```
angle → frequency bin t = (angle + PI) / TWO_PI
freq = texture(uFreqData, vec2(t, 0.5)).r
draw from innerR (0.28) to innerR + freq * 0.65
+ thin base ring at innerR for structure when quiet
+ radial glow falloff beyond the bar tip
```

Visual: concentric spikes radiating from a glowing core ring. Highly reactive, looks organic.

### Mode 1 — Bars
Classic EQ bars, left→right frequency sweep. Clipped to the circular disc boundary.

```
x (UV) → frequency bin
y (UV) → compare against freq amplitude
bar drawn where v <= freq for that x bin
+ clipped by circle mask: step(length(uv - 0.5) * 2.0, 1.0)
```

Visual: familiar EQ display, contained inside the glass sphere.

### Mode 2 — Ring Wave
A single thin ring at constant radius that distorts radially by audio amplitude. Time-domain feel.

```
For each angle, measure freq at that bin
ring_r = 0.38 + freq * 0.22
draw thin band around ring_r using smoothstep
+ glow halo using distance from ring_r
```

Visual: a pulsing, breathing ring — minimalist, elegant. Quiet = thin clean ring. Loud = bloom.

---

## Palettes

Controlled by `uPalette` int uniform. Four options:

| ID | Name | Base | Glow | Character |
|----|------|------|------|-----------|
| 0 | Accent | `#ff4400` orange | `#ff8833` amber | Matches globe accent — cohesive |
| 1 | Cyan | `#00d9ff` | `#80eeff` | Matches favorites — cold/electric |
| 2 | Plasma | purple→magenta→orange (by amplitude) | white hot tip | Dynamic, reactive |
| 3 | Mono | `rgba(200,210,220)` silver | white | Neutral, architectural |

Palette selection: shader computes `vec3 baseCol, glowCol` from `uPalette` + amplitude. Plasma uses an amplitude-driven gradient via `mix()`.

---

## New Settings Keys

```js
// SettingsManager DEFAULTS addition:
vizEnabled:  true,
vizMode:     0,      // 0=polar, 1=bars, 2=ring
vizPalette:  0,      // 0=accent, 1=cyan, 2=plasma, 3=mono
```

SettingsManager needs a `setViz(vizManager)` call after VisualizerManager is created, to apply these keys via `_applyKey`.

---

## VisualizerManager API

```js
class VisualizerManager {
    constructor(scene, audioManager, settings)
    update()           // called from GlobeManager._animate() — reads FFT, updates texture
    setEnabled(bool)   // show/hide mesh, pause updates
    setMode(int)       // sets uMode uniform
    setPalette(int)    // sets uPalette uniform
}
```

---

## Files Changed

| File | Change |
|---|---|
| `js/VisualizerManager.js` | **New** — owns geometry, material, texture, update loop |
| `js/Shaders.js` | Add `VisualizerMaterial` export |
| `js/GlobeManager.js` | Add `setVizManager(vm)`, call `vizManager.update()` in `_animate()` |
| `js/SettingsManager.js` | Add viz defaults, `_applyKey` cases, `setViz(vm)` |
| `js/UIManager.js` | Add visualizer section to modal |
| `js/main.js` | Wire VisualizerManager instantiation and connections |
| `index.html` | Modal visualizer settings UI (enable, mode buttons, palette swatches) |

---

## Wiring Sequence (main.js)

```js
globeMgr.init();
settingsMgr.apply();

// Visualizer — needs scene (available after init) and audio ref
const vizMgr = new VisualizerManager(globeMgr.world.scene(), audioMgr, settingsMgr);
globeMgr.setVizManager(vizMgr);
settingsMgr.setViz(vizMgr);   // so settings can drive it
settingsMgr.applyViz();       // apply persisted viz settings to the scene
```

---

## Rendering Notes

- Globe.gl owns the Three.js renderer. Our meshes added to `world.scene()` are rendered by Globe.gl's internal loop — no extra render calls needed.
- `depthWrite: false` + `AdditiveBlending` means the disc is invisible when audio is off (all zeros = black = fully transparent in additive mode). No need to hide the mesh when silent — it just disappears naturally.
- The Fresnel glass shader is `transparent: true` and renders the globe shell. The inner disc renders behind it in depth order (lower renderOrder). From outside the globe, you see: background → inner disc glow → glass shell → atmosphere. Correct layering.

---

## Open Questions (decide at implementation)

1. **Disc orientation**: Horizontal (equatorial plane) vs world-aligned vs always facing camera (billboard). Billboard requires `material.depthTest = false` + manual rotation each frame. Horizontal or world-aligned is simpler and still looks great.
2. **Fade on disable**: Animate `uOpacity` 0→1 on enable, 1→0 on disable, rather than instant show/hide.
3. **Sensitivity**: Expose a gain/sensitivity multiplier? Could be a slider in settings. Defer unless audio levels feel off.

---

## Verdict

**Implement as: `VisualizerMaterial` GLSL shader + `VisualizerManager.js` + DataTexture pipeline.**
Start with Mode 0 (Polar) + Accent palette as defaults. The architecture supports all 3 modes and 4 palettes from the same shader. Clean, GPU-efficient, visually compelling through the glass globe.
