import * as THREE from 'three';
import { VisualizerMaterial } from './Shaders.js';

export class VisualizerManager {
    constructor(scene, getCamera, audioManager, settings) {
        this._scene     = scene;
        this._getCamera = getCamera;
        this._audio     = audioManager;

        this._dataArray = new Uint8Array(128);      // FFT read buffer
        this._texData   = null;                     // direct ref to texture pixel buffer
        this._texture   = null;
        this._material  = null;
        this._mesh      = null;

        this._build(settings);
    }

    // ── PUBLIC API ────────────────────────────────────────────────────────────

    update() {
        if (!this._mesh?.visible) return;

        // Billboard — always face camera
        const cam = this._getCamera?.();
        if (cam) this._mesh.lookAt(cam.position);

        // Advance time uniform
        this._material.uniforms.uTime.value += 0.01;

        // Feed FFT data into DataTexture — write directly into the buffer
        if (this._audio.analyser) {
            this._audio.analyser.getByteFrequencyData(this._dataArray);
            for (let i = 0; i < 128; i++) {
                const val = this._dataArray[i];
                // RGBA Format requires 4 bytes per pixel. 
                // We must set Alpha (index+3) to 255, otherwise the pixel 
                // might be treated as fully transparent/discarded by the GPU/Sampler.
                this._texData[i * 4]     = val; // R
                this._texData[i * 4 + 1] = 0;   // G
                this._texData[i * 4 + 2] = 0;   // B
                this._texData[i * 4 + 3] = 255; // A (Full Opacity)
            }
        } else {
            // Fill black but keep alpha 255 just in case
            for (let i = 0; i < 128 * 4; i += 4) {
                this._texData[i]     = 0;
                this._texData[i + 1] = 0;
                this._texData[i + 2] = 0;
                this._texData[i + 3] = 255;
            }
        }
        this._texture.needsUpdate = true;
    }

    setEnabled(enabled) {
        if (this._mesh) this._mesh.visible = enabled;
    }

    setMode(mode) {
        if (this._material) this._material.uniforms.uMode.value = mode;
    }

    setPalette(palette) {
        if (this._material) this._material.uniforms.uPalette.value = palette;
    }

    // ── INTERNAL ─────────────────────────────────────────────────────────────

    _build(settings) {
        // DataTexture: 128×1 RGBA
        this._texData = new Uint8Array(128 * 4);
        this._texture = new THREE.DataTexture(this._texData, 128, 1, THREE.RGBAFormat);
        this._texture.magFilter  = THREE.LinearFilter;
        this._texture.minFilter  = THREE.LinearFilter;
        this._texture.needsUpdate = true;

        this._material = new THREE.ShaderMaterial({
            uniforms: {
                uFreqData: { value: this._texture },
                uMode:     { value: settings.get('vizMode') },
                uPalette:  { value: settings.get('vizPalette') },
                uTime:     { value: 0.0 },
                uOpacity:  { value: 1.0 },
            },
            vertexShader:   VisualizerMaterial.vertex,
            fragmentShader: VisualizerMaterial.fragment,
            transparent:    true,
            depthWrite:     false,
            // CRITICAL FIX: Disable depthTest so the visualizer draws "on top" 
            // even though it is physically inside the glass sphere.
            depthTest:      false, // <-- change to true if land should 'block' visualizer
            // could add depth/ height to land masses (floating) effect w/ empty center over 
            // glass sphere for globe. 
            blending:       THREE.AdditiveBlending,
            side:           THREE.DoubleSide,
        });

        const geo = new THREE.CircleGeometry(82, 128);
        this._mesh = new THREE.Mesh(geo, this._material);
        
        // Ensure it renders after the globe background
        this._mesh.renderOrder = 999; 
        
        this._mesh.visible = settings.get('vizEnabled');

        this._scene.add(this._mesh);
    }
}