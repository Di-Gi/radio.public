import * as THREE from 'three';
import { ScanMaterial, OrbitMaterial, FluxMaterial } from './Shaders.js';

export class VisualizerManager {
    constructor(scene, getCamera, audioManager, settings) {
        this._scene     = scene;
        this._getCamera = getCamera;
        this._audio     = audioManager;

        this._dataArray = new Uint8Array(128);
        this._texData   = new Uint8Array(128 * 4);

        // Shared 128×1 DataTexture — FFT bins in .r channel
        this._texture = new THREE.DataTexture(this._texData, 128, 1, THREE.RGBAFormat);
        this._texture.magFilter = THREE.LinearFilter;
        this._texture.minFilter = THREE.LinearFilter;

        this._meshes = []; // [SCAN, ORBIT, FLUX]
        this._mode   = settings.get('vizMode');

        this._build(settings);
    }

    // ── PUBLIC API ────────────────────────────────────────────────────────────

    update() {
        const activeMesh = this._meshes[this._mode];
        if (!activeMesh?.visible) return;

        // Update shared audio texture
        if (this._audio.analyser) {
            this._audio.analyser.getByteFrequencyData(this._dataArray);
            for (let i = 0; i < 128; i++) {
                this._texData[i * 4]     = this._dataArray[i];
                this._texData[i * 4 + 1] = 0;
                this._texData[i * 4 + 2] = 0;
                this._texData[i * 4 + 3] = 255;
            }
        } else {
            this._texData.fill(0);
        }
        this._texture.needsUpdate = true;

        // Advance time
        activeMesh.material.uniforms.uTime.value += 0.01;

        // Mode-specific per-frame behaviour
        if (this._mode === 0) {
            // SCAN: billboard — always face camera
            const cam = this._getCamera?.();
            if (cam) activeMesh.lookAt(cam.position);
        } else if (this._mode === 1) {
            // ORBIT: slow equatorial drift
            activeMesh.rotation.z += 0.002;
        } else if (this._mode === 2) {
            // FLUX: slow atmospheric rotation
            activeMesh.rotation.y -= 0.001;
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
            m.material.uniforms.uPalette.value = palette;
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

        // ── MODE 0: SCAN (Holographic Core) ──────────────────────────────────
        // Flat plane inside the globe — rendered as a HUD overlay (no depth test)
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
            depthTest:      false,
            blending:       THREE.AdditiveBlending,
            side:           THREE.DoubleSide,
        });
        const meshScan = new THREE.Mesh(geoScan, matScan);
        meshScan.renderOrder = 999;
        this._scene.add(meshScan);
        this._meshes[0] = meshScan;

        // ── MODE 1: ORBIT (Equatorial Carrier Wave) ───────────────────────────
        // Ring surrounding the globe at the equator, vertices displaced by FFT
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
            depthTest:      true,
            blending:       THREE.AdditiveBlending,
            side:           THREE.DoubleSide,
        });
        const meshOrbit = new THREE.Mesh(geoOrbit, matOrbit);
        meshOrbit.rotation.x = -Math.PI / 2; // lay flat on the equatorial plane
        this._scene.add(meshOrbit);
        this._meshes[1] = meshOrbit;

        // ── MODE 2: FLUX (Ionosphere Shield) ─────────────────────────────────
        // Atmospheric shell just outside the globe surface
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

        this._updateVisibility(enabled ? this._mode : -1);
    }
}
