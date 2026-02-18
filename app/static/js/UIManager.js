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
