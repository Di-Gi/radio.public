# Project Structure with Import Analysis

- app/
  - parsers/
    - __init__.py
    - radio_browser.py
        from typing import List, Dict
        import httpx
        import json
        
        class RadioBrowserParser:
            source_name = "radio_browser_api"
        
            # URL to fetch (using a reliable mirror)
            # For local testing, you can swap this with a local file read
            DATA_URL = "https://de1.api.radio-browser.info/json/stations/topclick/500"
        
            async def fetch_and_parse(self) -> List[Dict]:
                print(f"[{self.source_name}] Fetching data...")
                
                # In a real scenario, we might page through results or read a local dump
                async with httpx.AsyncClient() as client:
                    resp = await client.get(self.DATA_URL)
                    data = resp.json()
        
                parsed_stations = []
                
                for item in data:
                    # Smart Sub-Parsing: Only take items with valid Geo data
                    if item.get('geo_lat') and item.get('geo_long'):
                        parsed_stations.append({
                            "uuid": item.get('stationuuid'),
                            "name": item.get('name', '').strip(),
                            "url": item.get('url_resolved'),
                            "country": item.get('country'),
                            "tags": item.get('tags'),
                            "lat": float(item['geo_lat']),
                            "lng": float(item['geo_long']),
                            "source": self.source_name
                        })
                
                print(f"[{self.source_name}] Parsed {len(parsed_stations)} valid geo-stations.")
                return parsed_stations
  - static/
    - js/
      - AudioManager.js
          Imported by: main.js
          export class AudioManager {
              constructor(statusCallback) {
                  this.audio = new Audio();
                  this.audio.crossOrigin = "anonymous";
                  this.statusCallback = statusCallback; // (isPlaying, statusText) => {}
                  this.audioCtx = null;
                  this.analyser = null;
          
                  this._bindEvents();
              }
          
              _bindEvents() {
                  this.audio.addEventListener('waiting', () => this.statusCallback(true, "BUFFERING..."));
                  this.audio.addEventListener('playing', () => {
                      this._ensureAudioContext();
                      this.statusCallback(true, "TRANSMITTING");
                  });
                  this.audio.addEventListener('error', (e) => {
                      console.error("Audio Error:", e);
                      this.statusCallback(false, "SIGNAL LOST");
                  });
              }
          
              // Called once on first play event — safe to call after user gesture.
              // createMediaElementSource may only be called once per Audio element,
              // so we guard with the null check.
              _ensureAudioContext() {
                  if (this.audioCtx) {
                      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
                      return;
                  }
                  this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                  const source = this.audioCtx.createMediaElementSource(this.audio);
                  this.analyser = this.audioCtx.createAnalyser();
                  this.analyser.fftSize = 256;
                  this.analyser.smoothingTimeConstant = 0.8;
                  source.connect(this.analyser);
                  this.analyser.connect(this.audioCtx.destination);
              }
          
              play(url) {
                  this.audio.pause();
                  this.audio.src = "";
                  this.audio.load();
          
                  this.statusCallback(false, "ESTABLISHING LINK...");
          
                  this.audio.src = `/api/proxy?url=${encodeURIComponent(url)}`;
                  this.audio.play().catch(e => {
                      console.warn("Autoplay blocked or stream failed:", e);
                      this.statusCallback(false, "CONNECTION FAILED");
                  });
              }
          
              stop() {
                  this.audio.pause();
                  this.audio.src = "";
                  this.statusCallback(false, "STANDBY");
              }
          
              toggle(url) {
                  if (!this.audio.paused && this.audio.src.includes("proxy")) {
                      this.stop();
                  } else {
                      this.play(url);
                  }
              }
          }
      - GlobeManager.js
          Imports: Shaders.js
          Imported by: main.js
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
      - main.js
          Imports: AudioManager.js, GlobeManager.js, SettingsManager.js, ShortcutManager.js, StorageManager.js, UIManager.js, VisualizerManager.js
          import { GlobeManager }      from './GlobeManager.js';
          import { AudioManager }      from './AudioManager.js';
          import { UIManager }         from './UIManager.js';
          import { StorageManager }    from './StorageManager.js';
          import { SettingsManager }   from './SettingsManager.js';
          import { VisualizerManager } from './VisualizerManager.js';
          import { ShortcutManager }   from './ShortcutManager.js';
          
          // Application state
          let selectedStation = null;
          
          const storageMgr = new StorageManager();
          
          const audioMgr = new AudioManager((isPlaying, statusText) => {
              uiMgr.updateStatus(isPlaying, statusText);
              // Keep playing pin in sync with audio state
              globeMgr.setPlaying(isPlaying ? selectedStation?.uuid ?? null : null);
          });
          
          const globeMgr = new GlobeManager(
              'globe-container',
              (station) => {
                  selectedStation = station;
                  uiMgr.showStation(station);
                  globeMgr.focus(station.lat, station.lng);
                  globeMgr.setSelected(station.uuid);
              },
              (uuid) => storageMgr.isFavorite(uuid)
          );
          
          const settingsMgr = new SettingsManager(globeMgr);
          const uiMgr = new UIManager(globeMgr, audioMgr, storageMgr, settingsMgr);
          
          // Scan advance: random station, focus, play
          uiMgr.setScanAdvanceCallback(() => {
              if (!globeMgr.stations.length) return;
              const station = globeMgr.stations[Math.floor(Math.random() * globeMgr.stations.length)];
              selectedStation = station;
              uiMgr.showStation(station);
              globeMgr.focus(station.lat, station.lng);
              globeMgr.setSelected(station.uuid);
              audioMgr.play(station.url);
          });
          
          // Play button
          document.getElementById('play-btn').addEventListener('click', () => {
              if (selectedStation) audioMgr.toggle(selectedStation.url);
          });
          
          // Init
          globeMgr.init();
          settingsMgr.apply();
          
          // Visualizer — needs scene (available post-init) and audio ref
          const vizMgr = new VisualizerManager(
              globeMgr.world.scene(),
              () => globeMgr.world.camera(),
              audioMgr,
              settingsMgr
          );
          globeMgr.setVizManager(vizMgr);
          settingsMgr.setViz(vizMgr);
          settingsMgr.applyViz();
          
          new ShortcutManager(audioMgr, uiMgr);
          
          fetch('/api/stations')
              .then(res => res.json())
              .then(data => {
                  console.log(`Loaded ${data.length} stations`);
                  globeMgr.updateData(data);
              })
              .catch(err => console.error("Failed to load stations:", err));
      - SettingsManager.js
          Imported by: main.js
          const STORAGE_KEY = 'geo_radio_settings';
          
          const DEFAULTS = {
              autoRotate:    true,
              rotationSpeed: 0.5,
              vizEnabled:    true,
              vizMode:       0,      // 0=polar  1=bars  2=ring
              vizPalette:    0,      // 0=accent 1=cyan  2=plasma 3=mono
          };
          
          export class SettingsManager {
              constructor(globe) {
                  this.globe  = globe;
                  this._viz   = null;
                  this._settings = { ...DEFAULTS };
                  this._load();
              }
          
              // Apply globe settings after globe.init()
              apply() {
                  for (const [key, value] of Object.entries(this._settings)) {
                      this._applyKey(key, value);
                  }
              }
          
              // Register VisualizerManager and apply persisted viz settings to it
              setViz(vizManager) {
                  this._viz = vizManager;
              }
          
              applyViz() {
                  if (!this._viz) return;
                  this._viz.setEnabled(this._settings.vizEnabled);
                  this._viz.setMode(this._settings.vizMode);
                  this._viz.setPalette(this._settings.vizPalette);
              }
          
              get(key) {
                  return this._settings[key];
              }
          
              set(key, value) {
                  this._settings[key] = value;
                  this._applyKey(key, value);
                  this._save();
              }
          
              // ── INTERNAL ─────────────────────────────────────────────────────────────
          
              _applyKey(key, value) {
                  switch (key) {
                      case 'autoRotate':    this.globe.setAutoRotate(value);    break;
                      case 'rotationSpeed': this.globe.setRotationSpeed(value); break;
                      case 'vizEnabled':    this._viz?.setEnabled(value);       break;
                      case 'vizMode':       this._viz?.setMode(value);          break;
                      case 'vizPalette':    this._viz?.setPalette(value);       break;
                  }
              }
          
              _load() {
                  try {
                      const raw = localStorage.getItem(STORAGE_KEY);
                      if (raw) Object.assign(this._settings, JSON.parse(raw));
                  } catch { /* corrupt storage — fall back to defaults */ }
              }
          
              _save() {
                  try {
                      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._settings));
                  } catch { /* storage unavailable */ }
              }
          }
      - Shaders.js
          Imported by: GlobeManager.js, VisualizerManager.js
          export const GlobeMaterial = {
          
              vertex: /* glsl */`
                  varying vec3 vNormal;
                  varying vec3 vViewDir;
          
                  void main() {
                      vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                      vNormal  = normalize(normalMatrix * normal);
                      vViewDir = normalize(-mvPos.xyz);       // fragment → camera (view-space)
                      gl_Position = projectionMatrix * mvPos;
                  }
              `,
          
              fragment: /* glsl */`
                  varying vec3 vNormal;
                  varying vec3 vViewDir;
          
                  void main() {
                      float NdotV = clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);
          
                      // ── Schlick Fresnel (F0 = 0.04 for glass, power 7) ─────────────
                      float fresnel = 0.04 + 0.96 * pow(1.0 - NdotV, 7.0);
          
                      // ── Color ───────────────────────────────────────────────────────
                      vec3 color = mix(
                          vec3(0.01,  0.015, 0.04),   // near-void center
                          vec3(0.82,  0.90,  1.00),   // cool glass-white rim
                          fresnel
                      );
          
                      // ── Alpha ───────────────────────────────────────────────────────
                      float alpha = fresnel * 0.88 + 0.012;
          
                      gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
                  }
              `
          };
          
          export const VisualizerMaterial = {
          
              vertex: /* glsl */`
                  varying vec2 vUv;
                  void main() {
                      vUv = uv;
                      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                  }
              `,
          
              fragment: /* glsl */`
                  uniform sampler2D uFreqData;   // 128×1 RGBA — FFT bins in .r, 0→1
                  uniform float     uMode;       // 0=polar  1=bars  2=ring  (float — Three.js sends floats)
                  uniform float     uPalette;    // 0=accent 1=cyan  2=plasma 3=mono
                  uniform float     uTime;
                  uniform float     uOpacity;
          
                  varying vec2 vUv;
          
                  #define PI      3.14159265359
                  #define TWO_PI  6.28318530718
          
                  // ── Palette ─────────────────────────────────────────────────────────────
                  vec3 pal(float amp) {
                      if (uPalette < 0.5) return mix(vec3(0.9,  0.22, 0.0),  vec3(1.0,  0.62, 0.15), amp); // Accent
                      if (uPalette < 1.5) return mix(vec3(0.0,  0.58, 0.85), vec3(0.4,  0.95, 1.0),  amp); // Cyan
                      if (uPalette < 2.5) {                                                                  // Plasma
                          vec3 lo  = vec3(0.45, 0.0,  0.75);
                          vec3 mid = vec3(0.85, 0.0,  0.45);
                          vec3 hi  = vec3(1.0,  0.45, 0.0);
                          return amp < 0.5 ? mix(lo, mid, amp * 2.0) : mix(mid, hi, (amp - 0.5) * 2.0);
                      }
                      return mix(vec3(0.55, 0.60, 0.68), vec3(1.0), amp);                                   // Mono
                  }
          
                  void main() {
                      vec2  p = (vUv - 0.5) * 2.0;   // -1..1, center at origin
                      float r = length(p);
                      if (r > 1.0) discard;
          
                      float angle = atan(p.y, p.x);              // -PI to PI
                      float t     = (angle + PI) / TWO_PI;       // 0→1 around circle
          
                      float intensity = 0.0;
                      float amp       = 0.0;
          
                      // ── Mode 0: Polar ────────────────────────────────────────────────────
                      if (uMode < 0.5) {
                          amp = texture2D(uFreqData, vec2(t, 0.5)).r;
          
                          float innerR  = 0.26;
                          float outerR  = innerR + amp * 0.68;
          
                          float bar     = step(innerR, r) * step(r, outerR);
                          float ring    = smoothstep(0.022, 0.0, abs(r - innerR)) * 0.38;
                          float tipDist = r - outerR;
                          float glow    = max(0.0, 1.0 - tipDist / 0.1) * step(0.0, tipDist) * amp * 0.65;
          
                          intensity = max(bar, ring) + glow;
          
                      // ── Mode 1: Bars ─────────────────────────────────────────────────────
                      } else if (uMode < 1.5) {
                          amp        = texture2D(uFreqData, vec2(vUv.x, 0.5)).r;
                          float fill = step(vUv.y, amp * 0.92);
                          float edge = max(0.0, 1.0 - abs(vUv.y - amp * 0.92) / 0.055);
                          float clip = step(r, 0.98);
          
                          intensity = (fill * 0.70 + edge * 0.95) * clip;
          
                      // ── Mode 2: Ring Wave ────────────────────────────────────────────────
                      } else {
                          amp = texture2D(uFreqData, vec2(t, 0.5)).r;
          
                          float ringR = 0.48 + amp * 0.36;
                          float dist  = abs(r - ringR);
                          float rim   = smoothstep(0.03, 0.0, dist);
                          float bloom = smoothstep(0.16, 0.0, dist) * amp * 0.5;
                          float quiet = smoothstep(0.018, 0.0, abs(r - 0.48)) * 0.28;
          
                          intensity = max(rim + bloom, quiet);
                      }
          
                      if (intensity < 0.004) discard;
          
                      gl_FragColor = vec4(pal(amp) * intensity * uOpacity, 1.0);
                  }
              `
          };
          
          export const BackgroundMaterial = {
          
              vertex: /* glsl */`
                  varying vec2 vUv;
                  varying vec3 vWorldDir; // 3D direction for seamless noise
                  
                  void main() {
                      vUv = uv;
                      // On a sphere centered at (0,0,0), position is the direction.
                      vWorldDir = normalize(position);
                      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                  }
              `,
          
              fragment: /* glsl */`
                  uniform float uTime;
                  varying vec2 vUv;
                  varying vec3 vWorldDir;
          
                  // ── 3D NOISE UTILITIES (SEAMLESS) ───────────────────────────────────
                  
                  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
                  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
          
                  // Simplex Noise 3D
                  float snoise(vec3 v) { 
                      const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
                      const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
          
                      // First corner
                      vec3 i  = floor(v + dot(v, C.yyy) );
                      vec3 x0 = v - i + dot(i, C.xxx) ;
          
                      // Other corners
                      vec3 g = step(x0.yzx, x0.xyz);
                      vec3 l = 1.0 - g;
                      vec3 i1 = min( g.xyz, l.zxy );
                      vec3 i2 = max( g.xyz, l.zxy );
          
                      //   x0 = x0 - 0.0 + 0.0 * C.xxx;
                      //   x1 = x0 - i1  + 1.0 * C.xxx;
                      //   x2 = x0 - i2  + 2.0 * C.xxx;
                      //   x3 = x0 - 1.0 + 3.0 * C.xxx;
                      vec3 x1 = x0 - i1 + C.xxx;
                      vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y
                      vec3 x3 = x0 - D.yyy;      // -1.0+3.0*C.x = -0.5 = -D.y
          
                      // Permutations
                      i = mod289(i); 
                      vec4 p = permute( permute( permute( 
                                  i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                              + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
                              + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
          
                      // Gradients: 7x7 points over a square, mapped onto an octahedron.
                      // The ring size 17*17 = 289 is close to a multiple of 49 (49*6 = 294)
                      float n_ = 0.142857142857; // 1.0/7.0
                      vec3  ns = n_ * D.wyz - D.xzx;
          
                      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod(p,7*7)
          
                      vec4 x_ = floor(j * ns.z);
                      vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)
          
                      vec4 x = x_ *ns.x + ns.yyyy;
                      vec4 y = y_ *ns.x + ns.yyyy;
                      vec4 h = 1.0 - abs(x) - abs(y);
          
                      vec4 b0 = vec4( x.xy, y.xy );
                      vec4 b1 = vec4( x.zw, y.zw );
          
                      //vec4 s0 = vec4(lessThan(b0,0.0))*2.0 - 1.0;
                      //vec4 s1 = vec4(lessThan(b1,0.0))*2.0 - 1.0;
                      vec4 s0 = floor(b0)*2.0 + 1.0;
                      vec4 s1 = floor(b1)*2.0 + 1.0;
                      vec4 sh = -step(h, vec4(0.0));
          
                      vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
                      vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
          
                      vec3 p0 = vec3(a0.xy,h.x);
                      vec3 p1 = vec3(a0.zw,h.y);
                      vec3 p2 = vec3(a1.xy,h.z);
                      vec3 p3 = vec3(a1.zw,h.w);
          
                      //Normalise gradients
                      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
                      p0 *= norm.x;
                      p1 *= norm.y;
                      p2 *= norm.z;
                      p3 *= norm.w;
          
                      // Mix final noise value
                      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                      m = m * m;
                      return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                                  dot(p2,x2), dot(p3,x3) ) );
                  }
          
                  // Fractal Brownian Motion (3D)
                  float fbm(vec3 x) {
                      float v = 0.0;
                      float a = 0.5;
                      // Rotate to reduce axial bias
                      mat3 rot = mat3(
                          0.00,  0.80,  0.60,
                          -0.80,  0.36, -0.48,
                          -0.60, -0.48,  0.64 
                      );
                      for (int i = 0; i < 3; ++i) {
                          v += a * snoise(x);
                          x = rot * x * 2.0; 
                          a *= 0.5;
                      }
                      return v;
                  }
          
                  // ── STAR SYSTEM (2D - Kept 2D for sharpness, but fixed logic) ───────
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
                      vec2 diff = f - pos;
          
                      float twinkle = 0.5 + 0.5 * sin(uTime * (1.0 + h * 4.0) + h * 100.0);
                      
                      float dist = length(diff);
                      float brightness = max(0.0, 1.0 - dist * 2.0); 
                      brightness = pow(brightness, falloff); 
          
                      return tint * brightness * twinkle;
                  }
          
                  // ── MAIN ────────────────────────────────────────────────────────────
                  
                  void main() {
                      vec2 st = vUv;
                      // Use 3D coords for seamless nebula
                      vec3 pos = vWorldDir; 
                      
                      // 1. DEEP VOID BACKGROUND
                      // Gradient based on Y (vertical), but allow it to wrap fully 
                      // without hard edges. simple vertical gradient is safe.
                      vec3 bg = mix(vec3(0.001, 0.002, 0.005), vec3(0.005, 0.008, 0.015), smoothstep(-1.0, 1.0, pos.y));
          
                      // 2. DOMAIN WARPING NEBULA (3D)
                      // Using 3D noise eliminates the seam completely.
                      float t = uTime * 0.02;
                      
                      vec3 q = vec3(0.);
                      q.x = fbm(pos + vec3(0.0, 0.0, 0.0) + 0.05*t);
                      q.y = fbm(pos + vec3(5.2, 1.3, 2.8) + 0.08*t);
                      q.z = fbm(pos + vec3(1.2, 5.4, 2.1) + 0.06*t);
          
                      vec3 r = vec3(0.);
                      r.x = fbm(pos + 4.0*q + vec3(1.7, 9.2, 0.5) + 0.15*t);
                      r.y = fbm(pos + 4.0*q + vec3(8.3, 2.8, 1.1) + 0.126*t);
                      r.z = fbm(pos + 4.0*q + vec3(2.1, 5.1, 7.8) + 0.11*t);
          
                      float f = fbm(pos + 4.0*r);
          
                      // Coloring
                      vec3 gasColor = mix(
                          vec3(0.0, 0.12, 0.18),      // Darkest gas (richer teal shadow)
                          vec3(0.20, 0.0, 0.35),      // Midtone (richer royal purple)
                          clamp(f*f*4.0, 0.0, 1.0)
                      );
          
                      vec3 hotGas = mix(
                          vec3(0.25, 0.0, 0.08),      // Dark wine-red
                          vec3(0.70, 0.20, 0.0),      // Amber (no white-hot)
                          clamp(length(q), 0.0, 1.0)
                      );
          
                      vec3 nebula = mix(gasColor, hotGas, length(r) * f);
                      bg += nebula * 0.55;
          
                      // 3. STAR FIELD
                      // (Stars use 2D UVs. The seam is technically present in the grid, 
                      // but without the black vignette line, it is invisible to the eye 
                      // unless a star sits exactly on the pixel line)
                      bg += starLayer(st, 150.0, 0.90, 8.0, vec3(0.6, 0.7, 1.0)) * 0.8;
                      bg += starLayer(st, 80.0, 0.95, 12.0, vec3(0.9, 0.9, 1.0)) * 1.0;
                      bg += starLayer(st, 25.0, 0.98, 20.0, vec3(1.0, 0.85, 0.6)) * 1.5;
          
                      // 4. VIGNETTE (REMOVED)
                      // The black line was caused by uv.x * (1.0 - uv.x).
                      // A sky sphere should not have corners.
                      // If we want a slight top/bottom fade:
                      float poleFade = 1.0 - abs(pos.y); // Fade only at extreme poles if needed
                      // bg *= smoothstep(0.0, 0.2, poleFade); // Optional, usually not needed in space
          
                      // 5. DITHERING
                      // Prevents banding in dark gradients
                      float dither = fract(sin(dot(vUv * 1000.0, vec2(12.9898, 78.233))) * 43758.5453);
                      bg += (dither - 0.5) / 255.0;
          
                      gl_FragColor = vec4(bg, 1.0);
                  }
              `
          };
      - ShortcutManager.js
          Imported by: main.js
          export class ShortcutManager {
              constructor(audioManager, uiManager) {
                  this._audio = audioManager;
                  this._ui    = uiManager;
                  this._init();
              }
          
              _init() {
                  document.addEventListener('keydown', (e) => {
                      // Never intercept when the user is typing in an input field
                      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
          
                      switch (e.code) {
                          case 'Space':
                              e.preventDefault();
                              this._togglePlayback();
                              break;
                          case 'ArrowLeft':
                              e.preventDefault();
                              this._ui.searchPrev();
                              break;
                          case 'ArrowRight':
                              e.preventDefault();
                              this._ui.searchNext();
                              break;
                      }
                  });
              }
          
              _togglePlayback() {
                  const station = this._ui.currentStation;
                  if (!station) return;
                  this._audio.toggle(station.url);
              }
          }
      - StorageManager.js
          Imported by: main.js
          const KEY = 'geo_radio_favorites';
          
          export class StorageManager {
              isFavorite(uuid) {
                  return !!this._load()[uuid];
              }
          
              // Returns true if the station is now a favorite, false if removed.
              toggle(station) {
                  const favs = this._load();
                  if (favs[station.uuid]) {
                      delete favs[station.uuid];
                      this._save(favs);
                      return false;
                  }
                  favs[station.uuid] = {
                      uuid: station.uuid,
                      name: station.name,
                      country: station.country,
                      lat: station.lat,
                      lng: station.lng,
                      url: station.url,
                      tags: station.tags,
                  };
                  this._save(favs);
                  return true;
              }
          
              list() {
                  return Object.values(this._load());
              }
          
              _load() {
                  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
                  catch { return {}; }
              }
          
              _save(favs) {
                  localStorage.setItem(KEY, JSON.stringify(favs));
              }
          }
      - UIManager.js
          Imported by: main.js
          export class UIManager {
              constructor(globeManager, audioManager, storageManager, settingsManager) {
                  this.globe    = globeManager;
                  this.audio    = audioManager;
                  this.storage  = storageManager;
                  this.settings = settingsManager;
                  this.currentStation = null;
                  this.scanTimer = null;
                  this.onScanAdvance = null; // () => void
          
                  // Cache DOM elements
                  this.elLat        = document.getElementById('lat');
                  this.elLng        = document.getElementById('lng');
                  this.elStatus     = document.getElementById('status-txt');
                  this.elLed        = document.getElementById('led');
                  this.elMetaBox    = document.getElementById('meta-box');
                  this.elStName     = document.getElementById('st-name');
                  this.elStCountry  = document.getElementById('st-country');
                  this.elLocalTime  = document.getElementById('st-local-time');
                  this.elStTags     = document.getElementById('st-tags');
                  this.elPlayBtn    = document.getElementById('play-btn');
                  this.elStarBtn     = document.getElementById('star-btn');
                  this.elScanBtn     = document.getElementById('scan-btn');
                  this.elSearch      = document.getElementById('search-input');
                  this.elSearchBox   = document.getElementById('search-box');
                  this.elSearchPrev  = document.getElementById('search-prev');
                  this.elSearchNext  = document.getElementById('search-next');
                  this.elSearchCount = document.getElementById('search-count');
                  this.elCanvas      = document.getElementById('visualizer-canvas');
          
                  // Search navigation state
                  this._filteredResults = [];
                  this._searchIndex     = 0;
          
                  this._initListeners();
                  this._initModal();
                  this._startVisualizerLoop();
                  this._startLocalTimeClock();
              }
          
              _initListeners() {
                  // Coordinates on mouse move — rAF-gated to cap raycasting at one call per frame
                  this._pendingMouse = null;
                  this._mouseScheduled = false;
                  document.addEventListener('mousemove', (e) => {
                      this._pendingMouse = { x: e.clientX, y: e.clientY };
                      if (this._mouseScheduled) return;
                      this._mouseScheduled = true;
                      requestAnimationFrame(() => {
                          this._mouseScheduled = false;
                          if (!this._pendingMouse || !this.globe?.world) return;
                          const coords = this.globe.getCoords(this._pendingMouse.x, this._pendingMouse.y);
                          this._pendingMouse = null;
                          if (coords) {
                              this.elLat.innerText = `${Math.abs(coords.lat).toFixed(4)} ${coords.lat >= 0 ? 'N' : 'S'}`;
                              this.elLng.innerText = `${Math.abs(coords.lng).toFixed(4)} ${coords.lng >= 0 ? 'E' : 'W'}`;
                          }
                      });
                  });
          
                  // Search — expand box on focus, collapse when empty + blurred
                  this.elSearch.addEventListener('focus', () =>
                      this.elSearchBox.classList.add('expanded')
                  );
                  this.elSearch.addEventListener('keydown', (e) => {
                      if (e.key === 'Enter') this.elSearch.blur();
                  });
                  this.elSearch.addEventListener('blur', () => {
                      if (!this.elSearch.value) this.elSearchBox.classList.remove('expanded');
                  });
          
                  // Search filtering — debounced, with auto-navigate and nav button wiring
                  let searchTimer = null;
                  this.elSearch.addEventListener('input', (e) => {
                      clearTimeout(searchTimer);
                      searchTimer = setTimeout(() => {
                          const val = e.target.value.toLowerCase().trim();
                          if (!val) {
                              this._filteredResults = [];
                              this._searchIndex = 0;
                              this.globe.setVisibleStations(this.globe.stations);
                              this._updateSearchNav();
                              return;
                          }
                          this._filteredResults = this.globe.stations.filter(s =>
                              (s.name    || '').toLowerCase().includes(val) ||
                              (s.tags    || '').toLowerCase().includes(val) ||
                              (s.country || '').toLowerCase().includes(val)
                          );
                          this._searchIndex = 0;
                          this.globe.setVisibleStations(this._filteredResults);
                          if (this._filteredResults.length > 0) this._searchNavigate(0);
                          this._updateSearchNav();
                      }, 150);
                  });
          
                  this.elSearchPrev.addEventListener('click', () => {
                      if (this._searchIndex > 0) this._searchNavigate(this._searchIndex - 1);
                  });
                  this.elSearchNext.addEventListener('click', () => {
                      if (this._searchIndex < this._filteredResults.length - 1)
                          this._searchNavigate(this._searchIndex + 1);
                  });
          
                  // Star / favorite
                  this.elStarBtn.addEventListener('click', () => {
                      if (!this.currentStation) return;
                      const isFav = this.storage.toggle(this.currentStation);
                      this._renderStarBtn(isFav);
                      this.globe.refreshPointColors();
                  });
          
                  // Scan toggle
                  this.elScanBtn.addEventListener('click', () => {
                      if (this.scanTimer) {
                          this._stopScan();
                      } else {
                          this._startScan();
                      }
                  });
              }
          
              // ── PUBLIC ──────────────────────────────────────────────────────────────
          
              showStation(station) {
                  this.currentStation = station;
                  this.elStName.innerText    = station.name;
                  this.elStCountry.innerText = station.country || '--';
                  this.elStTags.innerText    = station.tags    || 'UNCLASSIFIED';
                  this._renderLocalTime(station.lng);
                  this.elMetaBox.style.display = 'block';
                  this.elPlayBtn.innerText = 'INITIATE LINK';
                  this.elPlayBtn.classList.remove('playing');
                  this.elLed.classList.remove('active');
                  this._renderStarBtn(this.storage.isFavorite(station.uuid));
              }
          
              updateStatus(isPlaying, text) {
                  this.elStatus.innerText = text;
                  this.elStatus.classList.toggle('live', isPlaying);
                  this.elLed.classList.toggle('active', isPlaying);
                  this.elPlayBtn.innerText = isPlaying ? 'TERMINATE LINK' : 'INITIATE LINK';
                  this.elPlayBtn.classList.toggle('playing', isPlaying);
                  if (isPlaying) this._resumeViz?.();
              }
          
              setScanAdvanceCallback(fn) {
                  this.onScanAdvance = fn;
              }
          
              // ── MODAL ────────────────────────────────────────────────────────────────
          
              _initModal() {
                  const overlay       = document.getElementById('modal-overlay');
                  const closeBtn      = document.getElementById('modal-close');
                  const brandLogo     = document.getElementById('brand-logo');
                  const autoRotateChk = document.getElementById('setting-autorotate');
                  const vizEnabledChk = document.getElementById('setting-viz-enabled');
                  const speedBtns     = document.querySelectorAll('.speed-btn:not(.viz-mode-btn):not(.viz-pal-btn)');
                  const modeBtns      = document.querySelectorAll('.viz-mode-btn');
                  const palBtns       = document.querySelectorAll('.viz-pal-btn');
          
                  // Sync all controls to persisted values on open
                  const syncControls = () => {
                      autoRotateChk.checked = this.settings.get('autoRotate');
                      vizEnabledChk.checked = this.settings.get('vizEnabled');
          
                      const speed = this.settings.get('rotationSpeed');
                      speedBtns.forEach(b =>
                          b.classList.toggle('active', parseFloat(b.dataset.speed) === speed)
                      );
                      const mode = this.settings.get('vizMode');
                      modeBtns.forEach(b =>
                          b.classList.toggle('active', parseInt(b.dataset.mode) === mode)
                      );
                      const pal = this.settings.get('vizPalette');
                      palBtns.forEach(b =>
                          b.classList.toggle('active', parseInt(b.dataset.palette) === pal)
                      );
                  };
          
                  const open  = () => { syncControls(); overlay.classList.add('open'); };
                  const close = () => overlay.classList.remove('open');
          
                  brandLogo.addEventListener('click', open);
                  closeBtn.addEventListener('click', close);
                  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
          
                  // Globe settings
                  autoRotateChk.addEventListener('change', () =>
                      this.settings.set('autoRotate', autoRotateChk.checked)
                  );
                  speedBtns.forEach(btn => btn.addEventListener('click', () => {
                      this.settings.set('rotationSpeed', parseFloat(btn.dataset.speed));
                      speedBtns.forEach(b => b.classList.remove('active'));
                      btn.classList.add('active');
                  }));
          
                  // Visualizer settings
                  vizEnabledChk.addEventListener('change', () =>
                      this.settings.set('vizEnabled', vizEnabledChk.checked)
                  );
                  modeBtns.forEach(btn => btn.addEventListener('click', () => {
                      this.settings.set('vizMode', parseInt(btn.dataset.mode));
                      modeBtns.forEach(b => b.classList.remove('active'));
                      btn.classList.add('active');
                  }));
                  palBtns.forEach(btn => btn.addEventListener('click', () => {
                      this.settings.set('vizPalette', parseInt(btn.dataset.palette));
                      palBtns.forEach(b => b.classList.remove('active'));
                      btn.classList.add('active');
                  }));
              }
          
              // ── STAR BUTTON ─────────────────────────────────────────────────────────
          
              _renderStarBtn(isFav) {
                  this.elStarBtn.innerHTML = isFav ? '&#9733;' : '&#9734;';
                  this.elStarBtn.classList.toggle('active', isFav);
              }
          
              // ── LOCAL TIME ──────────────────────────────────────────────────────────
          
              _renderLocalTime(lng) {
                  if (lng == null) { this.elLocalTime.innerText = '--:--'; return; }
                  const t = this._calcLocalTime(lng);
                  this.elLocalTime.innerText = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
              }
          
              _calcLocalTime(lng) {
                  const utcOffset = lng / 15; // degrees → rough hours
                  const now = new Date();
                  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
                  return new Date(utcMs + 3600000 * utcOffset);
              }
          
              _startLocalTimeClock() {
                  setInterval(() => {
                      if (this.currentStation?.lng != null) {
                          this._renderLocalTime(this.currentStation.lng);
                      }
                  }, 10000);
              }
          
              // ── VISUALIZER ──────────────────────────────────────────────────────────
          
              _startVisualizerLoop() {
                  const canvas = this.elCanvas;
                  const ctx = canvas.getContext('2d');
                  const dataArr = new Uint8Array(128);
          
                  // Cache dimensions — updated by ResizeObserver, not read per-frame
                  let w = canvas.offsetWidth  || 340;
                  let h = canvas.offsetHeight || 38;
                  canvas.width  = w;
                  canvas.height = h;
          
                  new ResizeObserver(([entry]) => {
                      w = Math.round(entry.contentRect.width)  || 340;
                      h = Math.round(entry.contentRect.height) || 38;
                      canvas.width  = w;
                      canvas.height = h;
                  }).observe(canvas);
          
                  let running = false;
          
                  const draw = () => {
                      if (this.audio.analyser) {
                          ctx.clearRect(0, 0, w, h);
                          this.audio.analyser.getByteFrequencyData(dataArr);
                          const barW = w / dataArr.length;
                          for (let i = 0; i < dataArr.length; i++) {
                              const v = dataArr[i] / 255;
                              const barH = v * h;
                              ctx.fillStyle = `rgba(255, ${68 + Math.floor(v * 60)}, 0, ${0.35 + v * 0.65})`;
                              ctx.fillRect(i * barW, h - barH, barW - 1, barH);
                          }
                          requestAnimationFrame(draw);
                      } else {
                          // Draw flat-line once and stop — loop resumes via _resumeViz when audio starts
                          ctx.clearRect(0, 0, w, h);
                          ctx.strokeStyle = 'rgba(255, 68, 0, 0.18)';
                          ctx.lineWidth = 1;
                          ctx.beginPath();
                          ctx.moveTo(0, h / 2);
                          ctx.lineTo(w, h / 2);
                          ctx.stroke();
                          running = false;
                      }
                  };
          
                  this._resumeViz = () => {
                      if (!running) {
                          running = true;
                          requestAnimationFrame(draw);
                      }
                  };
          
                  // Initial render
                  this._resumeViz();
              }
          
              // ── SEARCH NAVIGATION ────────────────────────────────────────────────────
          
              searchPrev() {
                  if (this._searchIndex > 0) this._searchNavigate(this._searchIndex - 1);
              }
          
              searchNext() {
                  if (this._searchIndex < this._filteredResults.length - 1)
                      this._searchNavigate(this._searchIndex + 1);
              }
          
              _searchNavigate(idx) {
                  this._searchIndex = idx;
                  // Re-use the full onStationSelect chain so selectedStation in main.js stays in sync
                  this.globe.onStationSelect(this._filteredResults[idx]);
                  this._updateSearchNav();
              }
          
              _updateSearchNav() {
                  const total = this._filteredResults.length;
                  const i     = this._searchIndex;
                  this.elSearchPrev.disabled  = total === 0 || i === 0;
                  this.elSearchNext.disabled  = total === 0 || i === total - 1;
                  this.elSearchCount.textContent = total > 0
                      ? `${i + 1} / ${total}`
                      : '';
              }
          
              // ── SCAN MODE ────────────────────────────────────────────────────────────
          
              _startScan() {
                  this.elScanBtn.innerText = 'SCANNING';
                  this.elScanBtn.classList.add('active');
                  // Advance immediately, then schedule repeats
                  if (this.onScanAdvance) this.onScanAdvance();
                  this._scheduleScanTick();
              }
          
              _stopScan() {
                  clearTimeout(this.scanTimer);
                  this.scanTimer = null;
                  this.elScanBtn.innerText = 'SCAN';
                  this.elScanBtn.classList.remove('active');
              }
          
              _scheduleScanTick() {
                  this.scanTimer = setTimeout(() => {
                      if (!this.scanTimer) return; // stopped
                      if (this.onScanAdvance) this.onScanAdvance();
                      this._scheduleScanTick();
                  }, 10000);
              }
          }
      - VisualizerManager.js
          Imports: Shaders.js
          Imported by: main.js
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
    - index.html
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>GEO_RADIO</title>
            <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&display=swap" rel="stylesheet">
            <style>
                :root {
                    --glass:      rgba(12, 15, 22, 0.15);
                    --glass-rim:  rgba(255, 255, 255, 0.10);
                    --glass-edge: rgba(255, 255, 255, 0.06);
                    --accent:     #ff4400;
                    --accent-dim: rgba(255, 68, 0, 0.30);
                    --cyan:       #00d9ff;
                    --fg:         #ced4df;
                    --dim:        #48525e;
                    --font:       'JetBrains Mono', monospace;
                }
        
                * { box-sizing: border-box; user-select: none; margin: 0; padding: 0; }
        
                body {
                    background: #020308;
                    overflow: hidden;
                    color: var(--fg);
                    font-family: var(--font);
                    text-transform: uppercase;
                }
        
                #globe-container { width: 100vw; height: 100vh; }
        
                /* ── GLASS PANEL BASE ── */
                .panel {
                    position: absolute;
                    z-index: 100;
                    background: var(--glass);
                    backdrop-filter: blur(10px) saturate(160%);
                    -webkit-backdrop-filter: blur(10px) saturate(160%);
                    border: 1px solid var(--glass-edge);
                    border-top: 1px solid var(--glass-rim);
                    border-radius: 2px;
                    box-shadow:
                        0 20px 40px -8px rgba(0, 0, 0, 0.75),
                        inset 0 1px 0 rgba(255, 255, 255, 0.04);
                }
        
                /* ── BRAND BOX (top-left) ── */
                #brand-box { top: 20px; left: 20px; width: 240px; }
        
                .brand-logo {
                    padding: 14px 18px 12px;
                    border-bottom: 1px solid var(--glass-edge);
                    cursor: pointer;
                    transition: opacity 0.15s;
                }
                .brand-logo:hover { opacity: 0.75; }
                .brand-logo h1 {
                    font-size: 34px;
                    font-weight: 800;
                    line-height: 1;
                    letter-spacing: -1px;
                    color: var(--fg);
                }
                .brand-logo h1 span { color: var(--accent); }
        
                .brand-coords {
                    display: flex;
                    justify-content: space-between;
                    padding: 8px 18px;
                    font-size: 10px;
                    font-weight: 500;
                    color: var(--dim);
                    letter-spacing: 0.05em;
                }
        
                /* ── STATUS BOX (top-right) ── */
                #status-box {
                    top: 20px; right: 20px;
                    display: flex;
                    align-items: center;
                    gap: 14px;
                    padding: 9px 16px;
                }
        
                #scan-btn {
                    font-family: var(--font);
                    font-size: 9px;
                    font-weight: 700;
                    letter-spacing: 0.14em;
                    color: var(--dim);
                    background: none;
                    border: 1px solid var(--glass-edge);
                    border-radius: 1px;
                    padding: 4px 10px;
                    cursor: pointer;
                    text-transform: uppercase;
                    transition: color 0.2s, border-color 0.2s;
                }
                #scan-btn:hover { color: var(--fg); border-color: rgba(255, 255, 255, 0.14); }
                #scan-btn.active { color: var(--accent); border-color: var(--accent-dim); }
        
                .v-sep { width: 1px; height: 14px; background: var(--glass-edge); flex-shrink: 0; }
        
                #status-txt {
                    font-size: 9px;
                    font-weight: 700;
                    letter-spacing: 0.14em;
                    color: var(--dim);
                    transition: color 0.3s;
                }
                #status-txt.live { color: var(--accent); }
        
                .led {
                    width: 7px; height: 7px;
                    background: var(--dim);
                    border-radius: 50%;
                    flex-shrink: 0;
                    transition: background 0.3s, box-shadow 0.3s;
                }
                .led.active {
                    background: var(--accent);
                    box-shadow: 0 0 8px var(--accent), 0 0 3px var(--accent);
                }
        
                /* ── META BOX (bottom-left) ── */
                #meta-box { bottom: 20px; left: 20px; width: 340px; display: none; }
        
                .meta-head {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    padding: 16px 18px 0;
                }
                .meta-content { flex: 1; min-width: 0; }
        
                .label {
                    font-size: 9px;
                    font-weight: 700;
                    color: var(--dim);
                    letter-spacing: 0.16em;
                    margin-bottom: 5px;
                }
        
                #st-name {
                    font-size: 15px;
                    font-weight: 800;
                    color: var(--fg);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    line-height: 1.2;
                    margin-bottom: 12px;
                }
        
                .meta-row {
                    display: flex;
                    gap: 0;
                    padding: 0 18px 10px;
                    border-bottom: 1px solid var(--glass-edge);
                }
                .meta-cell {
                    flex: 1;
                }
                .meta-cell + .meta-cell {
                    padding-left: 16px;
                    border-left: 1px solid var(--glass-edge);
                }
        
                #st-country, #st-local-time {
                    font-size: 11px;
                    font-weight: 700;
                    color: var(--fg);
                }
        
                #st-tags {
                    padding: 8px 18px;
                    font-size: 10px;
                    font-weight: 500;
                    color: var(--dim);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    border-bottom: 1px solid var(--glass-edge);
                }
        
                #star-btn {
                    font-size: 17px;
                    line-height: 1;
                    background: none;
                    border: none;
                    color: var(--dim);
                    cursor: pointer;
                    padding: 0 0 0 12px;
                    flex-shrink: 0;
                    transition: color 0.2s;
                    font-family: var(--font);
                }
                #star-btn:hover { color: var(--fg); }
                #star-btn.active { color: var(--cyan); }
        
                /* visualizer */
                #visualizer-canvas {
                    display: block;
                    width: 100%;
                    height: 38px;
                }
        
                #play-btn {
                    display: block;
                    width: 100%;
                    padding: 13px 18px;
                    background: rgba(255, 255, 255, 0.05);
                    color: var(--fg);
                    border: none;
                    border-top: 1px solid var(--glass-edge);
                    font-family: var(--font);
                    font-size: 10px;
                    font-weight: 800;
                    letter-spacing: 0.16em;
                    cursor: pointer;
                    text-transform: uppercase;
                    transition: background 0.2s, color 0.2s;
                }
                #play-btn:hover { background: var(--accent); color: #fff; }
                #play-btn.playing { color: var(--accent); }
        
                /* ── SEARCH BOX (bottom-right) ── */
                #search-box {
                    bottom: 20px; right: 20px;
                    width: 270px;
                    padding: 14px 18px;
                    transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                }
                #search-box.expanded { width: 400px; }
        
                .search-row {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 8px;
                }
        
                #search-input {
                    flex: 1;
                    min-width: 0;
                    background: transparent;
                    border: none;
                    border-bottom: 1px solid var(--glass-edge);
                    color: var(--fg);
                    font-family: var(--font);
                    font-size: 13px;
                    font-weight: 500;
                    outline: none;
                    padding-bottom: 5px;
                    letter-spacing: 0.04em;
                }
                #search-input::placeholder { color: var(--dim); }
                #search-input:-webkit-autofill,
                #search-input:-webkit-autofill:focus {
                    -webkit-box-shadow: 0 0 0 1000px transparent inset;
                    -webkit-text-fill-color: var(--fg);
                    transition: background-color 9999s ease;
                }
        
                .search-nav-btn {
                    display: none;
                    font-family: var(--font);
                    font-size: 11px;
                    font-weight: 700;
                    color: var(--dim);
                    background: none;
                    border: 1px solid var(--glass-edge);
                    border-radius: 1px;
                    padding: 3px 8px;
                    cursor: pointer;
                    flex-shrink: 0;
                    transition: color 0.15s, border-color 0.15s;
                    line-height: 1;
                }
                #search-box.expanded .search-nav-btn { display: block; }
                .search-nav-btn:hover:not(:disabled) { color: var(--fg); border-color: rgba(255,255,255,0.14); }
                .search-nav-btn:disabled { opacity: 0.25; cursor: default; }
        
                .search-footer {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }
                .search-label {
                    font-size: 9px;
                    font-weight: 700;
                    letter-spacing: 0.16em;
                    color: var(--dim);
                }
                #search-count {
                    font-size: 9px;
                    font-weight: 500;
                    letter-spacing: 0.1em;
                    color: var(--dim);
                }
        
                /* ── MODAL ── */
                #modal-overlay {
                    display: none;
                    position: fixed;
                    inset: 0;
                    z-index: 300;
                    background: rgba(2, 3, 8, 0.72);
                    align-items: center;
                    justify-content: center;
                }
                #modal-overlay.open { display: flex; }
        
                #modal-box {
                    position: relative;
                    width: 460px;
                    max-width: calc(100vw - 40px);
                    background: rgba(7, 9, 16, 0.96);
                    backdrop-filter: blur(28px) saturate(180%);
                    -webkit-backdrop-filter: blur(28px) saturate(180%);
                    border: 1px solid rgba(255, 255, 255, 0.09);
                    border-top: 1px solid rgba(255, 255, 255, 0.18);
                    box-shadow:
                        0 40px 80px -16px rgba(0, 0, 0, 0.95),
                        0 0 0 1px rgba(255, 255, 255, 0.03),
                        inset 0 1px 0 rgba(255, 255, 255, 0.07);
                }
        
                #modal-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 18px 20px 16px;
                    border-bottom: 1px solid var(--glass-edge);
                }
                #modal-header span {
                    font-size: 22px;
                    font-weight: 800;
                    letter-spacing: -0.5px;
                    color: var(--fg);
                }
                #modal-header span .accent { color: var(--accent); }
        
                #modal-close {
                    background: none;
                    border: none;
                    color: var(--dim);
                    font-family: var(--font);
                    font-size: 14px;
                    cursor: pointer;
                    padding: 4px 6px;
                    transition: color 0.15s;
                    line-height: 1;
                }
                #modal-close:hover { color: var(--fg); }
        
                .modal-section {
                    padding: 16px 20px;
                }
                .modal-section + .modal-section {
                    border-top: 1px solid var(--glass-edge);
                }
        
                .modal-section .label { margin-bottom: 10px; }
        
                .modal-about-text {
                    font-size: 10px;
                    font-weight: 500;
                    color: var(--dim);
                    line-height: 1.8;
                    letter-spacing: 0.04em;
                    text-transform: none;
                }
        
                .setting-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 7px 0;
                }
                .setting-row + .setting-row {
                    border-top: 1px solid var(--glass-edge);
                }
        
                .setting-name {
                    font-size: 9px;
                    font-weight: 700;
                    letter-spacing: 0.12em;
                    color: var(--fg);
                }
        
                /* Toggle switch */
                .toggle-wrap { display: flex; align-items: center; gap: 8px; }
                .toggle-wrap input[type="checkbox"] { display: none; }
                .toggle-track {
                    width: 30px; height: 16px;
                    background: var(--dim);
                    border-radius: 8px;
                    cursor: pointer;
                    position: relative;
                    transition: background 0.2s;
                    flex-shrink: 0;
                }
                .toggle-track::after {
                    content: '';
                    position: absolute;
                    top: 3px; left: 3px;
                    width: 10px; height: 10px;
                    background: rgba(2,3,8,0.9);
                    border-radius: 50%;
                    transition: transform 0.2s;
                }
                input[type="checkbox"]:checked + .toggle-track { background: var(--accent); }
                input[type="checkbox"]:checked + .toggle-track::after { transform: translateX(14px); }
        
                /* Speed buttons */
                .speed-options { display: flex; gap: 4px; }
                .speed-btn {
                    font-family: var(--font);
                    font-size: 8px;
                    font-weight: 700;
                    letter-spacing: 0.12em;
                    color: var(--dim);
                    background: none;
                    border: 1px solid var(--glass-edge);
                    border-radius: 1px;
                    padding: 4px 8px;
                    cursor: pointer;
                    text-transform: uppercase;
                    transition: color 0.15s, border-color 0.15s;
                }
                .speed-btn:hover { color: var(--fg); border-color: rgba(255,255,255,0.14); }
                .speed-btn.active { color: var(--accent); border-color: var(--accent-dim); }
        
                /* ── PIN TOOLTIP ── */
                #pin-tooltip {
                    position: fixed;
                    z-index: 200;
                    display: none;
                    pointer-events: none;
                    padding: 5px 10px;
                    font-family: var(--font);
                    font-size: 9px;
                    font-weight: 700;
                    letter-spacing: 0.12em;
                    white-space: nowrap;
                    color: var(--fg);
                    background: rgba(12, 15, 22, 0.82);
                    border: 1px solid var(--glass-edge);
                    border-top: 1px solid var(--glass-rim);
                    border-radius: 2px;
                    box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.6);
                }
            </style>
        </head>
        <body>
        
        <div id="globe-container"></div>
        <div id="pin-tooltip"></div>
        
        <!-- MODAL -->
        <div id="modal-overlay">
            <div class="panel" id="modal-box">
                <div id="modal-header">
                    <span>GEO<span class="accent">_</span>RADIO</span>
                    <button id="modal-close">✕</button>
                </div>
        
                <div class="modal-section">
                    <div class="label">About</div>
                    <p class="modal-about-text">A live signal explorer. Browse active broadcasts from thousands of radio stations across the globe in real time. Select any transmission point to tune in and establish a link.</p>
                </div>
        
                <div class="modal-section">
                    <div class="label">Settings</div>
        
                    <div class="setting-row">
                        <span class="setting-name">Auto-Rotate</span>
                        <label class="toggle-wrap">
                            <input type="checkbox" id="setting-autorotate" checked>
                            <span class="toggle-track"></span>
                        </label>
                    </div>
        
                    <div class="setting-row">
                        <span class="setting-name">Rotation Speed</span>
                        <div class="speed-options">
                            <button class="speed-btn" data-speed="0.2">Slow</button>
                            <button class="speed-btn active" data-speed="0.5">Normal</button>
                            <button class="speed-btn" data-speed="1.2">Fast</button>
                        </div>
                    </div>
                </div>
        
                <div class="modal-section">
                    <div class="label">Globe Visualizer</div>
        
                    <div class="setting-row">
                        <span class="setting-name">Enabled</span>
                        <label class="toggle-wrap">
                            <input type="checkbox" id="setting-viz-enabled" checked>
                            <span class="toggle-track"></span>
                        </label>
                    </div>
        
                    <div class="setting-row">
                        <span class="setting-name">Mode</span>
                        <div class="speed-options">
                            <button class="speed-btn viz-mode-btn active" data-mode="0">Polar</button>
                            <button class="speed-btn viz-mode-btn" data-mode="1">Bars</button>
                            <button class="speed-btn viz-mode-btn" data-mode="2">Ring</button>
                        </div>
                    </div>
        
                    <div class="setting-row">
                        <span class="setting-name">Palette</span>
                        <div class="speed-options">
                            <button class="speed-btn viz-pal-btn active" data-palette="0">Accent</button>
                            <button class="speed-btn viz-pal-btn" data-palette="1">Cyan</button>
                            <button class="speed-btn viz-pal-btn" data-palette="2">Plasma</button>
                            <button class="speed-btn viz-pal-btn" data-palette="3">Mono</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- BRAND -->
        <div class="panel" id="brand-box">
            <div class="brand-logo" id="brand-logo">
                <h1>GEO<span>_</span>RADIO</h1>
            </div>
            <div class="brand-coords">
                <span id="lat">00.0000 N</span>
                <span id="lng">00.0000 E</span>
            </div>
        </div>
        
        <!-- STATUS -->
        <div class="panel" id="status-box">
            <button id="scan-btn">SCAN</button>
            <div class="v-sep"></div>
            <span id="status-txt">STANDBY</span>
            <div id="led" class="led"></div>
        </div>
        
        <!-- META -->
        <div class="panel" id="meta-box">
            <div class="meta-head">
                <div class="meta-content">
                    <div class="label">STATION IDENTITY</div>
                    <div id="st-name">--</div>
                </div>
                <button id="star-btn" title="Add to favorites">&#9734;</button>
            </div>
        
            <div class="meta-row">
                <div class="meta-cell">
                    <div class="label">COUNTRY</div>
                    <div id="st-country">--</div>
                </div>
                <div class="meta-cell">
                    <div class="label">LOCAL TIME</div>
                    <div id="st-local-time">--:--</div>
                </div>
            </div>
        
            <div id="st-tags">--</div>
        
            <canvas id="visualizer-canvas"></canvas>
        
            <button id="play-btn">INITIATE LINK</button>
        </div>
        
        <!-- SEARCH -->
        <div class="panel" id="search-box">
            <div class="search-row">
                <button id="search-prev" class="search-nav-btn" disabled>&#8249;</button>
                <input type="text" id="search-input" placeholder="station · country · tag" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off">
                <button id="search-next" class="search-nav-btn" disabled>&#8250;</button>
            </div>
            <div class="search-footer">
                <span class="search-label">Frequency Search</span>
                <span id="search-count"></span>
            </div>
        </div>
        
        <script type="module" src="./js/main.js"></script>
        </body>
        </html>
  - __init__.py
  - database.py
      import sqlite_utils
      from typing import List, Dict
      
      import os
      
      DB_NAME = os.getenv("DATABASE_PATH", "stations.db")
      
      def get_db():
          db = sqlite_utils.Database(DB_NAME)
          # Enable Full Text Search and create table if not exists
          if "stations" not in db.table_names():
              db["stations"].create({
                  "uuid": str,
                  "name": str,
                  "url": str,
                  "country": str,
                  "tags": str,
                  "lat": float,
                  "lng": float,
                  "source": str,
              }, pk="uuid")
              # Create index for fast geo-lookups
              db["stations"].create_index(["lat", "lng"])
          return db
      
      def upsert_stations(stations: List[Dict]):
          db = get_db()
          # Batch upsert for performance
          db["stations"].upsert_all(stations, pk="uuid")
      
      def query_stations(limit: int = 500):
          db = get_db()
          # Return stations with valid coordinates
          return list(db.query(f"SELECT * FROM stations WHERE lat IS NOT NULL AND lng IS NOT NULL LIMIT {limit}"))
  - main.py
      import uvicorn
      import asyncio
      import importlib
      import pkgutil
      from urllib.parse import urlparse
      from contextlib import asynccontextmanager
      from fastapi import FastAPI, BackgroundTasks, Query
      from fastapi.responses import StreamingResponse, Response
      from fastapi.staticfiles import StaticFiles
      import os
      
      from app.database import upsert_stations, query_stations
      import app.parsers as parsers_package
      
      @asynccontextmanager
      async def lifespan(app: FastAPI):
          print("🚀 Initializing Geo-Radio Services...")
          asyncio.create_task(asyncio.to_thread(run_ingestion))
          yield
      
      app = FastAPI(lifespan=lifespan)
      
      # --- THE ROBUST RADIO PROXY ---
      @app.get("/api/proxy")
      async def proxy_stream(url: str = Query(...)):
          """A protocol-agnostic proxy that handles ICY, HTTP/1.0 and HTTPS"""
          parsed = urlparse(url)
          host = parsed.hostname
          port = parsed.port or (443 if parsed.scheme == "https" else 80)
          path = parsed.path + ("?" + parsed.query if parsed.query else "")
          if not path: path = "/"
      
          async def stream_generator():
              reader, writer = None, None
              try:
                  # Handle SSL for HTTPS streams, otherwise plain TCP
                  ssl_context = True if parsed.scheme == "https" else None
                  reader, writer = await asyncio.open_connection(host, port, ssl=ssl_context)
      
                  # Send a minimalist HTTP request
                  # We explicitly DON'T ask for ICY metadata to keep the stream clean
                  request = (
                      f"GET {path} HTTP/1.0\r\n"
                      f"Host: {host}\r\n"
                      f"User-Agent: MidnightRadio/1.0\r\n"
                      f"Accept: */*\r\n"
                      f"Connection: close\r\n\r\n"
                  )
                  writer.write(request.encode())
                  await writer.drain()
      
                  # Skip the headers manually
                  # We look for the double newline (\r\n\r\n) that separates headers from audio
                  header_buffer = b""
                  while True:
                      line = await reader.readuntil(b"\n")
                      header_buffer += line
                      if header_buffer.endswith(b"\r\n\r\n") or header_buffer.endswith(b"\n\n"):
                          break
      
                  # Now just pipe the raw audio data
                  while True:
                      chunk = await reader.read(4096)
                      if not chunk: break
                      yield chunk
      
              except Exception as e:
                  print(f"📡 Proxy Error: {e}")
              finally:
                  if writer:
                      writer.close()
                      await writer.wait_closed()
          
          # Updated: Add CORS header to allow clean AudioContext analysis
          return StreamingResponse(
              stream_generator(), 
              media_type="audio/mpeg", 
              headers={"Access-Control-Allow-Origin": "*"}
          )
      
      # --- DATABASE & INGESTION ---
      def run_ingestion():
          for _, name, is_pkg in pkgutil.iter_modules(parsers_package.__path__):
              if is_pkg: continue
              full_module_name = f"app.parsers.{name}"
              try:
                  module = importlib.import_module(full_module_name)
                  for attr_name in dir(module):
                      attr = getattr(module, attr_name)
                      if isinstance(attr, type) and hasattr(attr, 'fetch_and_parse') and hasattr(attr, 'source_name'):
                          parser_instance = attr()
                          loop = asyncio.new_event_loop()
                          try:
                              stations = loop.run_until_complete(parser_instance.fetch_and_parse())
                              if stations: upsert_stations(stations)
                          finally:
                              loop.close()
              except Exception as e:
                  print(f"❌ Ingestion Error: {e}")
      
      @app.get("/api/stations")
      def get_stations():
          return query_stations(limit=2000)
      
      # Silence the favicon 404 logs
      @app.get("/favicon.ico")
      def favicon(): return Response(status_code=204)
      
      
      # python only development
      # app.mount("/", StaticFiles(directory="app/static", html=True), name="static")
      # (for production)
      # app.mount("/", StaticFiles(directory="dist", html=True), name="static")
      if os.path.exists("dist"):
          app.mount("/", StaticFiles(directory="dist", html=True), name="static")
      
      if __name__ == "__main__":
          uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
