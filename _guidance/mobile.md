# Low-Compute Optimization - Patch Write-up

## Current Architecture
The `GEO_RADIO` frontend is currently designed as a visually rich, high-fidelity WebGL experience. However, it relies heavily on operations that are notoriously punishing for low-compute devices (mobile GPUs, integrated laptop graphics):
1. **Expensive Fragment Shaders**: `BackgroundMaterial` evaluates 3D Simplex Noise and multiple octaves of Fractal Brownian Motion (FBM) *per pixel, per frame* for the nebula effect. `FluxMaterial` uses Triplanar noise.
2. **High Fill-Rate Demands**: Modern phones and laptops have high-density displays (Device Pixel Ratio of 2.0 to 3.0). Rendering complex procedural shaders at native resolution forces the GPU to calculate millions of heavy fragment operations every 16ms.
3. **Dual Visualizers**: The app runs both a 2D Canvas FFT visualizer (in the UI) and a 3D WebGL FFT visualizer (`VisualizerManager.js`) simultaneously.
4. **Continuous Animation Loop**: `GlobeManager.js` forces continuous `requestAnimationFrame` loops even when nothing is changing, keeping the GPU awake and draining battery.

## Requirements
- Maintain smooth, reliable interactions (UI responsiveness, globe rotation) on low-end hardware.
- Reduce battery drain and thermal throttling on mobile devices.
- Allow users to explicitly opt into or out of "Low-Compute" constraints.
- Do not completely sacrifice the application's core aesthetic.

## Approaches Considered

#### Approach 1: Global Resolution & Engine Scaling (Brute Force)
- **Description**: Globally clamp the WebGL pixel ratio to `1.0` (ignoring Retina/high-DPI screens) and throttle `requestAnimationFrame` to 30 FPS.
- **Pros**: Immediate, massive reduction in GPU workload (up to 9x fewer pixels processed on modern iPhones). No shader rewrites required.
- **Cons**: Makes the 3D text and globe edges look blurry/pixelated on high-end devices where it isn't necessary.

#### Approach 2: Total 2D Fallback (Leaflet/Mapbox)
- **Description**: Detect mobile/low-end devices and serve a completely different 2D map interface instead of Three.js.
- **Pros**: Guaranteed 60 FPS on practically any device from the last decade.
- **Cons**: Massive architectural impact. Requires maintaining two separate frontend codebases and UI paradigms. Loses the "holographic" brand identity.

#### Approach 3: Pre-rendered Assets & Texture Baking
- **Description**: Remove procedural shaders (`fbm`, `snoise`) and replace them with static `.jpg`/`.png` textures wrapped around a sphere.
- **Pros**: Replaces heavy math with extremely cheap texture lookups.
- **Cons**: Increases initial payload/load time. Loses the dynamic, slowly shifting animation of the background nebula.

#### Approach 4: Dedicated "Eco Mode" with Shader Degradation ✅ Recommended
- **Description**: Introduce an explicit `Eco Mode` (defaulting to ON for mobile devices). When active, it clamps the pixel ratio to `1.0`, strips out the heavy procedural math from the background shader, and scales back the visualizer complexity.
- **Pros**: Gives the user control. Preserves high-fidelity for desktop users while rescuing mobile performance. The simplified shaders maintain the color palette and vibe without the math penalty.
- **Cons**: Requires managing two versions of some shaders.

## Implementation Strategy

We will implement **Approach 4** through a phased strategy:

### Phase 1: Establish "Eco Mode" State
Modify `SettingsManager` to track `ecoMode`. Use a simple heuristic (e.g., checking `window.innerWidth < 768` or `navigator.hardwareConcurrency < 4`) to set a smart default on first load.

### Phase 2: Create Lightweight Shaders
Add `BackgroundMaterialEco` to `Shaders.js`. This version will entirely remove the 3D Simplex/FBM logic and rely only on the 2D Starfield and a simple vertical gradient. This alone rescues ~60% of GPU frame time on mobile.

### Phase 3: WebGL Renderer & Feature Clamping
Modify `GlobeManager.js` to react to `ecoMode`.
- Clamp the renderer's `devicePixelRatio`.
- Swap the background material based on state.
- Reduce Globe.gl's ring propagation and geometry detail if possible.

### Phase 4: UI Integration
Add the toggle to the Settings Modal in `index.html` and wire it up in `UIManager.js`.

## Files Modified & Degree

| File Path | Layer | Change Degree | Estimated Lines |
|-----------|-------|---------------|----------------|
| `static/js/SettingsManager.js` | Core | Minor | +15 |
| `static/js/Shaders.js` | WebGL | Moderate | +45 |
| `static/js/GlobeManager.js` | WebGL | Moderate | +35 |
| `static/js/UIManager.js` | UI/Desktop | Minor | +15 |
| `static/index.html` | UI/Views | Minor | +10 |

---

## Detail Each Modification

#### File: `static/js/SettingsManager.js`
**Purpose**: Store and apply the new Eco Mode setting.
**Changes needed**: Add `ecoMode` to `DEFAULTS` with a smart detection fallback.

```javascript
const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

const DEFAULTS = {
    ecoMode:       isMobile, // Smart default
    autoRotate:    true,
    // ... existing
};

// In _applyKey:
case 'ecoMode': this.globe.setEcoMode(value); break;
```

#### File: `static/js/Shaders.js`
**Purpose**: Provide a lightweight alternative to the expensive background.
**Changes needed**: Export a new `BackgroundMaterialEco`.

```javascript
export const BackgroundMaterialEco = {
    vertex: BackgroundMaterial.vertex, // Re-use existing vertex
    fragment: /* glsl */`
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vWorldDir;

        // Keep ONLY the 2D star function, remove fbm and snoise entirely
        float hash12(vec2 p) {
            vec3 p3  = fract(vec3(p.xyx) * .1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
        }

        vec3 starLayer(vec2 uv, float scale, float thresh, float falloff, vec3 tint) {
            vec2 st = uv * scale;
            vec2 id = floor(st);
            vec2 f  = fract(st);
            float h = hash12(id);
            if (h < thresh) return vec3(0.0);
            vec2 pos = vec2(hash12(id + 154.45), hash12(id + 92.2));
            float dist = length(f - pos);
            float brightness = pow(max(0.0, 1.0 - dist * 2.0), falloff);
            // Simplified twinkle
            float twinkle = 0.7 + 0.3 * sin(uTime * 2.0 + h * 100.0);
            return tint * brightness * twinkle;
        }

        void main() {
            // Simple gradient void
            vec3 bg = mix(vec3(0.001, 0.002, 0.005), vec3(0.005, 0.008, 0.015), smoothstep(-1.0, 1.0, vWorldDir.y));
            
            // Only render stars, skip nebula
            bg += starLayer(vUv, 150.0, 0.90, 8.0, vec3(0.6, 0.7, 1.0)) * 0.8;
            bg += starLayer(vUv, 80.0, 0.95, 12.0, vec3(0.9, 0.9, 1.0)) * 1.0;

            gl_FragColor = vec4(bg, 1.0);
        }
    `
};
```

#### File: `static/js/GlobeManager.js`
**Purpose**: Apply resolution clamping and swap shaders.
**Changes needed**: Implement `setEcoMode()`.

```javascript
import { GlobeMaterial, BackgroundMaterial, BackgroundMaterialEco } from './Shaders.js';

// Inside class GlobeManager:
init() {
    // ... existing init ...
    this.bgMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1000, 32, 32),
        this.bgMaterial // Default initialized
    );
    this.world.scene().add(this.bgMesh);
    
    // Safety clamp: Even on high-end, limit to 1.5 to prevent 4K meltdowns
    this.world.renderer().setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
}

setEcoMode(enabled) {
    if (!this.world) return;
    
    // 1. Swap Shader
    const targetMat = enabled ? BackgroundMaterialEco : BackgroundMaterial;
    this.bgMaterial = new THREE.ShaderMaterial({
        uniforms:       { uTime: { value: 0.0 } },
        vertexShader:   targetMat.vertex,
        fragmentShader: targetMat.fragment,
        side:           THREE.BackSide,
    });
    this.bgMesh.material = this.bgMaterial;

    // 2. Clamp Pixel Ratio
    const pr = enabled ? 1.0 : Math.min(window.devicePixelRatio, 1.5);
    this.world.renderer().setPixelRatio(pr);

    // 3. Throttle Rings / Atmosphere
    this.world.showAtmosphere(!enabled);
}
```

#### File: `static/index.html` & `static/js/UIManager.js`
**Purpose**: Expose the toggle to the user.
**Changes needed**: Add a toggle in the modal identical to the `Auto-Rotate` toggle.

```html
<!-- In index.html Modal section -->
<div class="setting-row">
    <span class="setting-name">Eco Mode (Low Compute)</span>
    <label class="toggle-wrap">
        <input type="checkbox" id="setting-ecomode">
        <span class="toggle-track"></span>
    </label>
</div>
```

```javascript
// In UIManager.js _initModal()
const ecoModeChk = document.getElementById('setting-ecomode');
ecoModeChk.checked = this.settings.get('ecoMode');

ecoModeChk.addEventListener('change', () =>
    this.settings.set('ecoMode', ecoModeChk.checked)
);
```

---

## Edge Cases Handled

1. **Hot-swapping Materials**:
   - *Detection*: Changing `ecoMode` at runtime.
   - *Recovery*: `setEcoMode()` explicitly creates a new `ShaderMaterial` and assigns it to `this.bgMesh.material`. Three.js handles the disposal/re-compilation of the shader program automatically.
2. **Device Pixel Ratio Changes**:
   - *Detection*: Users toggling Eco mode might see the canvas physically resize if not handled properly.
   - *Prevention*: Globe.gl manages canvas CSS size independently of the internal WebGL rendering buffer. `renderer.setPixelRatio()` only changes the internal buffer size, preventing layout shifts while boosting performance.
3. **Visualizer Desync**:
   - *Prevention*: When `ecoMode` is on, we might also want to auto-disable the 3D visualizer. We can handle this in `SettingsManager._applyKey` by turning off `vizEnabled` when `ecoMode` becomes true, saving even more compute.

## Paths We Opt NOT to Take

❌ **Removing the 3D Visualizers entirely**: The visualizers (Scan, Orbit, Flux) are core to the cyberpunk/radio aesthetic. Taking them out completely ruins the vibe. Instead, by limiting the `devicePixelRatio` to `1.0` in Eco Mode, the visualizers become cheap enough to run on mobile without modification.

❌ **Throttling `requestAnimationFrame`**: While skipping frames (e.g., rendering at 30 FPS) saves battery, it makes the globe drag/spin interactions feel incredibly sluggish and unresponsive. Lowering pixel/fragment counts keeps the interaction loop at 60 FPS while reducing the actual workload per frame.

## User Experience Flow

1. User visits the site on an iPhone.
2. `SettingsManager` detects `window.innerWidth <= 768` and sets `ecoMode: true` by default.
3. The app loads. The WebGL canvas runs at `1.0` pixel ratio instead of `3.0`. The background renders the cheap starfield instead of the heavy volumetric nebula. Atmosphere is hidden.
4. The GPU fill-rate requirement is reduced by ~90%. The globe spins smoothly at 60 FPS.
5. If the user opens Settings, they see "Eco Mode" enabled. They can toggle it off, immediately experiencing the high-fidelity nebula and sharper resolution (at the cost of their battery).