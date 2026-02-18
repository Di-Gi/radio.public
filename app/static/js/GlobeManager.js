import Globe from 'globe.gl';
import * as THREE from 'three';
import { GlobeMaterial, BackgroundMaterial } from './Shaders.js';

// ── Pin appearance constants ─────────────────────────────────────────────────
const PIN = {
    // colors
    C_PLAYING:  '#ffffff',    // active broadcast — white (highest contrast)
    C_SELECTED: '#ff4400',    // selected, not yet playing — accent orange
    C_FAVORITE: '#00d9ff',    // saved station — cyan
    C_NORMAL:   '#aa6600',    // default — dim amber

    // radius (Globe.gl units)
    R_PLAYING:  0.50,
    R_SELECTED: 0.42,
    R_FAVORITE: 0.32,
    R_NORMAL:   0.24,

    // altitude (fraction of globe radius)
    A_PLAYING:  0.08,
    A_SELECTED: 0.05,
    A_FAVORITE: 0.025,
    A_NORMAL:   0.015,
};

export class GlobeManager {
    constructor(containerId, onStationSelect, isFavorite) {
        this.container      = document.getElementById(containerId);
        this.onStationSelect = onStationSelect;
        this.isFavorite     = isFavorite || (() => false);
        this.world          = null;
        this.bgMaterial     = null;
        this.stations         = [];
        this._visibleStations = []; // current filtered subset — equals stations when no search

        // Pin state
        this.selectedUuid = null;
        this.playingUuid  = null;

        // Tooltip
        this.elTooltip = document.getElementById('pin-tooltip');
        this._mouseX   = 0;
        this._mouseY   = 0;

        // Rotation grace-period timer
        this._idleTimer = null;

        // Pin refresh batching
        this._refreshPending = false;

        // Visualizer
        this.vizManager = null;

        // Navigation — arc flight path + dedup
        this._navTarget = null;  // { lat, lng } currently animating toward
        this._navTimer  = null;  // second-phase arc timer
    }

    init() {
        // ── 1. MATERIALS ────────────────────────────────────────────────────
        const glassMat = new THREE.ShaderMaterial({
            vertexShader:   GlobeMaterial.vertex,
            fragmentShader: GlobeMaterial.fragment,
            transparent:    true,
            side:           THREE.FrontSide,
            depthWrite: false,
        });

        this.bgMaterial = new THREE.ShaderMaterial({
            uniforms:       { uTime: { value: 0.0 } },
            vertexShader:   BackgroundMaterial.vertex,
            fragmentShader: BackgroundMaterial.fragment,
            side:           THREE.BackSide,
        });

        // ── 2. GLOBE ─────────────────────────────────────────────────────────
        this.world = Globe()(this.container)
            .backgroundColor('#000000')
            .globeMaterial(glassMat)
            .showAtmosphere(true)
            .atmosphereColor('#ff4400')
            .atmosphereAltitude(0.12)

            // ── Pins ────────────────────────────────────────────────────────
            .pointColor(s    => this._pinColor(s))
            .pointRadius(s   => this._pinRadius(s))
            .pointAltitude(s => this._pinAltitude(s))
            .pointsMerge(false)
            .pointLabel(() => '')     // suppress Globe.gl's native tooltip; we use #pin-tooltip

            // ── Rings (pulse on selected / playing station) ─────────────────
            .ringsData([])
            .ringLat(r  => r.lat)
            .ringLng(r  => r.lng)
            .ringColor(r => {
                const c = r.isPlaying
                    ? '255, 80, 0'
                    : this.isFavorite(r.uuid) ? '0, 217, 255' : '255, 110, 20';
                return t => `rgba(${c}, ${Math.max(0, 1 - t)})`;
            })
            .ringMaxRadius(r        => r.isPlaying ? 4.0 : 3.0)
            .ringPropagationSpeed(r => r.isPlaying ? 2.5 : 1.2)
            .ringRepeatPeriod(r     => r.isPlaying ? 900  : 1600)

            // ── Interactions ────────────────────────────────────────────────
            .onPointClick(point => {
                this._hideTooltip();
                this.onStationSelect(point);
            })
            .onPointHover(point => {
                this.container.style.cursor = point ? 'pointer' : 'default';
                if (point) {
                    this._showTooltip(point.name);
                } else {
                    this._hideTooltip();
                }
            })
            // Clicking empty globe space resumes auto-rotation
            .onGlobeClick(() => this.resumeRotation());

        // ── 3. SCENE ─────────────────────────────────────────────────────────
        const bgMesh = new THREE.Mesh(
            new THREE.SphereGeometry(1000, 32, 32),
            this.bgMaterial
        );
        this.world.scene().add(bgMesh);

        // Soft ambient only — no directional light in the scene.
        // Our ShaderMaterial is lights:false so scene lights never touched the
        // glass, but the DirectionalLight was reaching Globe.gl's atmosphere
        // material and biasing the orange halo toward one hemisphere.
        this.world.scene().add(new THREE.AmbientLight(0x303040, 1.2));

        // ── 4. CONTROLS ──────────────────────────────────────────────────────
        const ctrl = this.world.controls();
        ctrl.autoRotate       = true;
        ctrl.autoRotateSpeed  = 0.5;
        ctrl.enableZoom       = true;
        ctrl.maxDistance      = 800;
        ctrl.minDistance      = 120;
        ctrl.rotateSpeed      = 0.7;     // slightly heavier feel
        ctrl.enableDamping    = true;    // smooth inertia (Globe.gl calls update() each frame)
        ctrl.dampingFactor    = 0.08;

        // Pause rotation while dragging; resume after DRAG grace period
        ctrl.addEventListener('start', () => {
            clearTimeout(this._idleTimer);
            ctrl.autoRotate = false;
        });
        ctrl.addEventListener('end', () => {
            this._scheduleRotationResume(8000);   // 8 s after drag release
        });

        window.addEventListener('resize', () => {
            this.world.width(window.innerWidth);
            this.world.height(window.innerHeight);
        });

        // Track mouse for tooltip repositioning
        this.container.addEventListener('mousemove', e => {
            this._mouseX = e.clientX;
            this._mouseY = e.clientY;
            if (this.elTooltip?.style.display === 'block') {
                this._positionTooltip();
            }
        });

        // ── 5. BORDERS ───────────────────────────────────────────────────────
        this._loadBorders();

        // ── 6. ANIMATION LOOP ─────────────────────────────────────────────────
        this._animate();

    }

    // Fetch the bundled GeoJSON and render country outlines as transparent
    // polygons with a white hairline stroke — "etched onto the glass" look.
    _loadBorders() {
        fetch('/data/countries.geojson')
            .then(r => r.json())
            .then(data => {
                this.world
                    .polygonsData(data.features)
                    .polygonCapColor(() => 'rgba(0,0,0,0)')          // invisible fill
                    .polygonSideColor(() => 'rgba(0,0,0,0)')         // invisible extrusion
                    .polygonStrokeColor(() => 'rgba(255,255,255,0.13)') // white hairline
                    .polygonAltitude(0.001)                          // flush with surface
                    .polygonsTransitionDuration(0);                  // no pop-in animation
            })
            .catch(() => { /* borders unavailable — globe still works */ });
    }

    setVizManager(vm) {
        this.vizManager = vm;
    }

    _animate() {
        if (this.bgMaterial) this.bgMaterial.uniforms.uTime.value += 0.005;
        if (this.vizManager) this.vizManager.update();
        requestAnimationFrame(() => this._animate());
    }

    // ── PUBLIC STATE API ─────────────────────────────────────────────────────

    setSelected(uuid) {
        this.selectedUuid = uuid;
        this._scheduleRefresh();
    }

    setPlaying(uuid) {
        this.playingUuid = uuid;
        this._scheduleRefresh();
    }

    updateData(data) {
        this.stations         = data;
        this._visibleStations = data;
        this.world.pointsData(data);
    }

    // Called by UIManager when search filters or clears
    setVisibleStations(arr) {
        this._visibleStations = arr;
        this.world.pointsData(arr);
    }

    focus(lat, lng) {
        // Deduplicate — if already animating to this destination, don't interrupt
        if (this._navTarget &&
            Math.abs(this._navTarget.lat - lat) < 0.5 &&
            Math.abs(this._navTarget.lng  - lng) < 0.5) return;

        clearTimeout(this._navTimer);
        this._navTarget = { lat, lng };

        const cur  = this.world.pointOfView();
        const dLat = lat - cur.lat;

        // Normalise longitude delta across the date line
        let dLng = lng - cur.lng;
        if (dLng >  180) dLng -= 360;
        if (dLng < -180) dLng += 360;

        const dist = Math.sqrt(dLat * dLat + dLng * dLng);

        if (dist > 15) {
            // ── Arc flight ─────────────────────────────────────────────────────
            // Both phases target the same lat/lng — no direction change, no jag.
            // The arc shape comes from altitude only.
            // Phase 2 starts before phase 1 ends (overlap) so Globe.gl hands off
            // while the camera still has velocity — continuous, smooth motion.
            const peakAlt = Math.min(2.0 + dist * 0.022, 4.5);
            const rise    = 850;
            const descent = 600;
            const overlap = 220;  // start descent this many ms before rise ends

            this.world.pointOfView({ lat, lng, altitude: peakAlt }, rise);
            this._navTimer = setTimeout(() => {
                this.world.pointOfView({ lat, lng, altitude: 1.8 }, descent);
                this._navTimer = setTimeout(() => { this._navTarget = null; }, descent);
            }, rise - overlap);
        } else {
            // ── Direct flight ──────────────────────────────────────────────────
            const dur = 850 + dist * 12;
            this.world.pointOfView({ lat, lng, altitude: 1.8 }, dur);
            this._navTimer = setTimeout(() => { this._navTarget = null; }, dur);
        }

        this.stopRotation();
    }

    getCoords(x, y) {
        if (!this.world) return null;
        return this.world.toGlobeCoords(x, y);
    }

    // Called on station focus — longer grace period so the user can
    // read the panel and decide to play before the globe starts spinning again.
    stopRotation() {
        if (!this.world) return;
        this.world.controls().autoRotate = false;
        this._scheduleRotationResume(20000);  // 20 s after station select
    }

    setAutoRotate(enabled) {
        if (!this.world) return;
        clearTimeout(this._idleTimer);
        this.world.controls().autoRotate = enabled;
    }

    setRotationSpeed(speed) {
        if (!this.world) return;
        this.world.controls().autoRotateSpeed = speed;
    }

    // Called on empty-globe click — immediate resume, clears any pending timer.
    resumeRotation() {
        clearTimeout(this._idleTimer);
        if (this.world) this.world.controls().autoRotate = true;
    }

    _scheduleRotationResume(delay) {
        clearTimeout(this._idleTimer);
        this._idleTimer = setTimeout(() => {
            if (this.world) this.world.controls().autoRotate = true;
        }, delay);
    }

    // Called after favorites toggle to recolour all pins
    refreshPointColors() {
        this._scheduleRefresh();
    }

    // ── INTERNAL ─────────────────────────────────────────────────────────────

    // Collapses multiple synchronous state changes into a single Globe.gl rebuild
    _scheduleRefresh() {
        if (this._refreshPending) return;
        this._refreshPending = true;
        queueMicrotask(() => {
            this._refreshPending = false;
            this._refreshPoints();
            this._updateRings();
        });
    }

    // Re-feed pointsData to force Globe.gl to re-run the accessor functions.
    // Uses _visibleStations so an active search filter is preserved.
    _refreshPoints() {
        if (this.world && this._visibleStations.length) {
            this.world.pointsData([...this._visibleStations]);
        }
    }

    // Rebuild ringsData based on current selected / playing state
    _updateRings() {
        if (!this.world) return;
        if (!this.selectedUuid) {
            this.world.ringsData([]);
            return;
        }
        const station = this.stations.find(s => s.uuid === this.selectedUuid);
        if (!station) { this.world.ringsData([]); return; }

        this.world.ringsData([{
            lat:       station.lat,
            lng:       station.lng,
            uuid:      station.uuid,
            isPlaying: station.uuid === this.playingUuid,
        }]);
    }

    // ── Pin accessor helpers ──────────────────────────────────────────────────

    _pinColor(s) {
        if (s.uuid === this.playingUuid)  return PIN.C_PLAYING;
        if (s.uuid === this.selectedUuid) return PIN.C_SELECTED;
        if (this.isFavorite(s.uuid))      return PIN.C_FAVORITE;
        return PIN.C_NORMAL;
    }

    _pinRadius(s) {
        if (s.uuid === this.playingUuid)  return PIN.R_PLAYING;
        if (s.uuid === this.selectedUuid) return PIN.R_SELECTED;
        if (this.isFavorite(s.uuid))      return PIN.R_FAVORITE;
        return PIN.R_NORMAL;
    }

    _pinAltitude(s) {
        if (s.uuid === this.playingUuid)  return PIN.A_PLAYING;
        if (s.uuid === this.selectedUuid) return PIN.A_SELECTED;
        if (this.isFavorite(s.uuid))      return PIN.A_FAVORITE;
        return PIN.A_NORMAL;
    }

    // ── Tooltip ───────────────────────────────────────────────────────────────

    _showTooltip(text) {
        if (!this.elTooltip) return;
        this.elTooltip.innerText = text;
        this.elTooltip.style.display = 'block';
        this._positionTooltip();
    }

    _hideTooltip() {
        if (this.elTooltip) this.elTooltip.style.display = 'none';
    }

    _positionTooltip() {
        if (!this.elTooltip) return;
        this.elTooltip.style.left = `${this._mouseX + 16}px`;
        this.elTooltip.style.top  = `${this._mouseY - 10}px`;
    }
}
