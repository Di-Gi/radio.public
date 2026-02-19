# Patch Write-up: Robust Geo-Radio Visualizers

## Current Architecture
The current visualization system uses a single 2D billboard (`PlaneGeometry`) rendered "inside" the globe. It relies on a single shader with a `uMode` switch to draw basic Polar, Bar, or Ring shapes on that 2D plane. It feels disconnected from the 3D globe environment.

## Requirements
- Replace generic "media player" visuals with themes fitting a "Planetary Radio Interceptor".
- Utilize 3D geometry (Rings, Spheres) that interacts with the globe.
- Maintain performance by only rendering the active mode.
- Update UI labels to reflect new modes.

## Implementation Strategy
We will replace the single-mesh system with a multi-mesh system in `VisualizerManager`. Each mode will have dedicated geometry and a specialized shader.

### New Visualizer Modes
1.  **SCAN (Mode 0)**: A "Holographic Core" inside the globe. Tech-heavy, grid-based, replacing the old 'Polar'.
2.  **ORBIT (Mode 1)**: An "Equatorial Carrier Wave". A physical ring surrounding the planet that pulses and displaces vertices based on frequency.
3.  **FLUX (Mode 2)**: An "Ionosphere Shield". A simplified atmospheric shell that glows and shifts with signal intensity.

## Files Modified & Degree

| File Path | Layer | Change Degree | Description |
|-----------|-------|---------------|----------------|
| `app/static/js/Shaders.js` | Views | Major | Added `COMMON_PALETTE` and 3 new full shader materials. |
| `app/static/js/VisualizerManager.js` | ViewModels | Moderate | Logic to manage 3 distinct meshes/geometries. |
| `app/static/index.html` | Views | Minor | Updated settings UI labels to SCAN, ORBIT, FLUX. |

---

## Code Modifications

### 1. `app/static/js/Shaders.js`

We create a shared palette function and three distinct shader materials.

```javascript
import * as THREE from 'three';

// ── SHARED PALETTE ───────────────────────────────────────────────────────────
const PALETTE_GLSL = `
uniform float uPalette;

vec3 getPalette(float t) {
    vec3 c = vec3(0.0);
    // 0: Accent (Orange/Fire)
    if (uPalette < 0.5) {
        c = mix(vec3(1.0, 0.1, 0.0), vec3(1.0, 0.8, 0.2), t);
    } 
    // 1: Cyan (Data)
    else if (uPalette < 1.5) {
        c = mix(vec3(0.0, 0.4, 0.9), vec3(0.4, 0.9, 1.0), t);
    }
    // 2: Plasma (Purple/Pink)
    else if (uPalette < 2.5) {
        c = mix(vec3(0.3, 0.0, 0.6), vec3(1.0, 0.0, 0.4), t);
    }
    // 3: Mono (White/Grey)
    else {
        c = vec3(t * 0.9 + 0.1);
    }
    return c;
}
`;

// ── 1. SCAN (Holographic Core) ───────────────────────────────────────────────
export const ScanMaterial = {
    vertex: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragment: /* glsl */`
        uniform sampler2D uFreqData;
        uniform float uTime;
        uniform float uOpacity;
        uniform float uPalette; // used in PALETTE_GLSL
        varying vec2 vUv;

        ${PALETTE_GLSL}

        void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float r = length(p);
            float a = atan(p.y, p.x);
            float t = (a + 3.14159) / 6.28318; // 0..1 radial

            // Sample Frequency (mirrored)
            float freq = texture2D(uFreqData, vec2(abs(t - 0.5) * 2.0, 0.5)).r;

            // Rings
            float rings = fract(r * 6.0 - uTime * 0.1);
            float ringLine = smoothstep(0.0, 0.05, rings) * smoothstep(0.1, 0.05, rings);
            
            // Radar sweep
            float sweep = smoothstep(0.0, 0.3, 1.0 - abs(mod(t - uTime * 0.2, 1.0) - 0.5) * 2.0);

            // Audio reaction
            float wave = smoothstep(0.01, 0.0, abs(r - (0.3 + freq * 0.4)));
            
            // Combine
            float alpha = (ringLine * 0.1 + wave + sweep * 0.1) * smoothstep(1.0, 0.8, r);
            vec3 col = getPalette(freq);

            if (alpha < 0.01) discard;
            gl_FragColor = vec4(col, alpha * uOpacity);
        }
    `
};

// ── 2. ORBIT (Equatorial Ring) ───────────────────────────────────────────────
export const OrbitMaterial = {
    vertex: /* glsl */`
        uniform sampler2D uFreqData;
        varying float vAmp;
        varying vec2 vUv;

        void main() {
            vUv = uv;
            // Map UV.x (angle) to Frequency Bin
            float amp = texture2D(uFreqData, vec2(uv.x, 0.5)).r;
            vAmp = amp;

            // Displace Z (which is Up in ring local space, or Outward from center)
            vec3 pos = position;
            // Spike displacement
            pos.z += amp * 12.0; 
            
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
    `,
    fragment: /* glsl */`
        uniform float uPalette;
        uniform float uOpacity;
        varying float vAmp;
        varying vec2 vUv;

        ${PALETTE_GLSL}

        void main() {
            // Edges fade out
            float rim = 1.0 - abs(vUv.y - 0.5) * 2.0;
            float alpha = smoothstep(0.0, 0.2, rim);
            
            // Brighten peaks
            vec3 col = getPalette(vAmp);
            col += vec3(0.5) * step(0.8, vAmp);

            gl_FragColor = vec4(col, alpha * vAmp * uOpacity * 1.5);
        }
    `
};

// ── 3. FLUX (Ionosphere Shell) ───────────────────────────────────────────────
export const FluxMaterial = {
    vertex: /* glsl */`
        varying vec3 vNormal;
        varying vec2 vUv;
        void main() {
            vNormal = normalize(normalMatrix * normal);
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragment: /* glsl */`
        uniform sampler2D uFreqData;
        uniform float uTime;
        uniform float uPalette;
        uniform float uOpacity;
        varying vec3 vNormal;
        varying vec2 vUv;

        ${PALETTE_GLSL}

        // Simple noise
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f*f*(3.0-2.0*f);
            return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), f.x),
                       mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), f.x), f.y);
        }

        void main() {
            // Get average bass (left side of texture)
            float bass = 0.0;
            for(int i=0; i<10; i++) bass += texture2D(uFreqData, vec2(float(i)/128.0, 0.5)).r;
            bass /= 10.0;

            // Flowing noise
            float n = noise(vUv * 10.0 + vec2(uTime * 0.2, uTime * 0.05));
            
            // Fresnel edge glow
            vec3 viewDir = vec3(0.0, 0.0, 1.0); // Approximation for billboard-ish logic or simple fresnel
            float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);

            float alpha = n * bass * 0.8 + fresnel * 0.3;
            vec3 col = getPalette(bass * n + 0.2);

            gl_FragColor = vec4(col, alpha * uOpacity);
        }
    `
};

// Keep existing Globe/Bg Materials for other imports...
export const GlobeMaterial = { /* ... keep existing ... */ vertex: `...`, fragment: `...` };
export const BackgroundMaterial = { /* ... keep existing ... */ vertex: `...`, fragment: `...` };
```
*Note: Ensure the existing `GlobeMaterial` and `BackgroundMaterial` are preserved in the file.*

### 2. `app/static/js/VisualizerManager.js`

Refactor to manage the three mesh types.

```javascript
import * as THREE from 'three';
import { ScanMaterial, OrbitMaterial, FluxMaterial } from './Shaders.js';

export class VisualizerManager {
    constructor(scene, getCamera, audioManager, settings) {
        this._scene     = scene;
        this._getCamera = getCamera;
        this._audio     = audioManager;

        this._dataArray = new Uint8Array(128);
        this._texData   = new Uint8Array(128 * 4);
        
        // Common Texture
        this._texture = new THREE.DataTexture(this._texData, 128, 1, THREE.RGBAFormat);
        this._texture.magFilter = THREE.LinearFilter;
        this._texture.minFilter = THREE.LinearFilter;
        
        // Meshes
        this._meshes = []; // [Scan, Orbit, Flux]
        this._mode   = settings.get('vizMode');
        
        this._build(settings);
    }

    // ── PUBLIC API ────────────────────────────────────────────────────────────

    update() {
        const isEnabled = this._meshes.some(m => m.visible);
        if (!isEnabled) return;

        // 1. Update Audio Texture
        if (this._audio.analyser) {
            this._audio.analyser.getByteFrequencyData(this._dataArray);
            for (let i = 0; i < 128; i++) {
                const val = this._dataArray[i];
                this._texData[i * 4]     = val;
                this._texData[i * 4 + 1] = 0;
                this._texData[i * 4 + 2] = 0;
                this._texData[i * 4 + 3] = 255;
            }
        } else {
            // Idle state: faint noise or silence
            this._texData.fill(0); 
        }
        this._texture.needsUpdate = true;

        // 2. Update Active Mesh
        const mesh = this._meshes[this._mode];
        if (mesh && mesh.visible) {
            mesh.material.uniforms.uTime.value += 0.01;
            
            // Mode-specific updates
            if (this._mode === 0) {
                // SCAN: Billboard behavior
                const cam = this._getCamera?.();
                if (cam) mesh.lookAt(cam.position);
            } else if (this._mode === 1) {
                // ORBIT: Slow rotation
                mesh.rotation.z += 0.002;
            } else if (this._mode === 2) {
                // FLUX: Slow rotation
                mesh.rotation.y -= 0.001;
            }
        }
    }

    setEnabled(enabled) {
        this._updateVisibility(enabled ? this._mode : -1);
    }

    setMode(mode) {
        this._mode = mode;
        this._updateVisibility(this._mode);
    }

    setPalette(palette) {
        this._meshes.forEach(m => {
            if (m.material.uniforms.uPalette) {
                m.material.uniforms.uPalette.value = palette;
            }
        });
    }

    // ── INTERNAL ─────────────────────────────────────────────────────────────

    _updateVisibility(activeMode) {
        this._meshes.forEach((m, i) => {
            m.visible = (i === activeMode);
        });
    }

    _build(settings) {
        const palette = settings.get('vizPalette');
        const enabled = settings.get('vizEnabled');

        // ── MODE 0: SCAN (Internal Hologram) ──
        // PlaneGeometry - Renders 'inside' globe but on top (no depth test)
        const geoScan = new THREE.PlaneGeometry(150, 150);
        const matScan = new THREE.ShaderMaterial({
            uniforms: {
                uFreqData: { value: this._texture },
                uTime:     { value: 0.0 },
                uPalette:  { value: palette },
                uOpacity:  { value: 0.9 },
            },
            vertexShader:   ScanMaterial.vertex,
            fragmentShader: ScanMaterial.fragment,
            transparent:    true,
            depthWrite:     false,
            depthTest:      false, // HUD effect
            blending:       THREE.AdditiveBlending,
            side:           THREE.DoubleSide,
        });
        const meshScan = new THREE.Mesh(geoScan, matScan);
        meshScan.renderOrder = 999;
        this._scene.add(meshScan);
        this._meshes[0] = meshScan;

        // ── MODE 1: ORBIT (Equatorial Ring) ──
        // RingGeometry(inner, outer, segments). Rotated to lie on Equator.
        const geoOrbit = new THREE.RingGeometry(115, 140, 128);
        const matOrbit = new THREE.ShaderMaterial({
            uniforms: {
                uFreqData: { value: this._texture },
                uTime:     { value: 0.0 },
                uPalette:  { value: palette },
                uOpacity:  { value: 1.0 },
            },
            vertexShader:   OrbitMaterial.vertex,
            fragmentShader: OrbitMaterial.fragment,
            transparent:    true,
            depthWrite:     false,
            depthTest:      true, // Occluded by globe
            blending:       THREE.AdditiveBlending,
            side:           THREE.DoubleSide,
        });
        const meshOrbit = new THREE.Mesh(geoOrbit, matOrbit);
        meshOrbit.rotation.x = -Math.PI / 2; // Lie flat
        this._scene.add(meshOrbit);
        this._meshes[1] = meshOrbit;

        // ── MODE 2: FLUX (Ionosphere) ──
        // SphereGeometry just outside globe surface
        const geoFlux = new THREE.SphereGeometry(105, 64, 64);
        const matFlux = new THREE.ShaderMaterial({
            uniforms: {
                uFreqData: { value: this._texture },
                uTime:     { value: 0.0 },
                uPalette:  { value: palette },
                uOpacity:  { value: 0.6 },
            },
            vertexShader:   FluxMaterial.vertex,
            fragmentShader: FluxMaterial.fragment,
            transparent:    true,
            depthWrite:     false,
            depthTest:      true,
            blending:       THREE.AdditiveBlending,
        });
        const meshFlux = new THREE.Mesh(geoFlux, matFlux);
        this._scene.add(meshFlux);
        this._meshes[2] = meshFlux;

        // Set Initial State
        this._updateVisibility(enabled ? this._mode : -1);
    }
}
```

### 3. `app/static/index.html`

Update the visualizer settings section to reflect the new modes.

```html
<!-- Inside <div class="modal-section"> ... Globe Visualizer ... -->
<div class="setting-row">
    <span class="setting-name">Mode</span>
    <div class="speed-options">
        <button class="speed-btn viz-mode-btn active" data-mode="0">SCAN</button>
        <button class="speed-btn viz-mode-btn" data-mode="1">ORBIT</button>
        <button class="speed-btn viz-mode-btn" data-mode="2">FLUX</button>
    </div>
</div>
```

---

## Edge Case Handling

1.  **Transparency Sorting**:
    *   **SCAN**: Uses `depthTest: false` and `renderOrder: 999`. It will always appear on top, creating a HUD/Hologram effect inside the glass globe.
    *   **ORBIT & FLUX**: Use `depthTest: true`. They will be properly occluded by the opaque-ish parts of the globe, though since the globe glass is transparent, we might see the back of the ring. `depthWrite: false` prevents self-occlusion artifacts.

2.  **Audio Silence**:
    *   Shaders use `uTime` and base opacity to ensure they don't completely vanish when silent, but look "idle" (low energy).

3.  **Performance**:
    *   Only the active mesh is updated and rendered. The `VisualizerManager.update` loop checks `mesh.visible` before setting uniforms.

4.  **Geometry Alignment**:
    *   Orbit Ring is rotated `-Math.PI/2` on X to align with the globe's equator (assuming Y-up world).

## Summary

This patch transforms the visualizer from a generic 2D overlay into a suite of 3D environmental effects that feel native to a "Geo-Radio" station. The "Scan" mode provides a data-centric internal view, "Orbit" gives a physical representation of the broadcast carrier wave, and "Flux" visualizes the atmospheric conditions of the radio signal.