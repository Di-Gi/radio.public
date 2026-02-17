export class UIManager {
    constructor(globeManager, audioManager, storageManager) {
        this.globe = globeManager;
        this.audio = audioManager;
        this.storage = storageManager;
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
        this.elStarBtn    = document.getElementById('star-btn');
        this.elScanBtn    = document.getElementById('scan-btn');
        this.elSearch     = document.getElementById('search-input');
        this.elCanvas     = document.getElementById('visualizer-canvas');

        this._initListeners();
        this._startVisualizerLoop();
        this._startLocalTimeClock();
    }

    _initListeners() {
        // Coordinates on mouse move
        document.addEventListener('mousemove', (e) => {
            if (!this.globe?.world) return;
            const coords = this.globe.getCoords(e.clientX, e.clientY);
            if (coords) {
                this.elLat.innerText = `${Math.abs(coords.lat).toFixed(4)} ${coords.lat >= 0 ? 'N' : 'S'}`;
                this.elLng.innerText = `${Math.abs(coords.lng).toFixed(4)} ${coords.lng >= 0 ? 'E' : 'W'}`;
            }
        });

        // Search filtering
        this.elSearch.addEventListener('input', (e) => {
            const val = e.target.value.toLowerCase();
            const filtered = this.globe.stations.filter(s =>
                (s.name    || '').toLowerCase().includes(val) ||
                (s.tags    || '').toLowerCase().includes(val) ||
                (s.country || '').toLowerCase().includes(val)
            );
            this.globe.world.pointsData(filtered);
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
    }

    setScanAdvanceCallback(fn) {
        this.onScanAdvance = fn;
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
        const dataArr = new Uint8Array(128); // reuse buffer

        const draw = () => {
            // Sync canvas resolution to CSS size
            const w = canvas.offsetWidth  || 340;
            const h = canvas.offsetHeight || 38;
            if (canvas.width !== w)  canvas.width  = w;
            if (canvas.height !== h) canvas.height = h;

            ctx.clearRect(0, 0, w, h);

            if (this.audio.analyser) {
                this.audio.analyser.getByteFrequencyData(dataArr);

                const barCount = dataArr.length;
                const barW = w / barCount;

                for (let i = 0; i < barCount; i++) {
                    const v = dataArr[i] / 255;
                    const barH = v * h;
                    ctx.fillStyle = `rgba(255, ${68 + Math.floor(v * 60)}, 0, ${0.35 + v * 0.65})`;
                    ctx.fillRect(i * barW, h - barH, barW - 1, barH);
                }
            } else {
                // Idle flat-line
                ctx.strokeStyle = 'rgba(255, 68, 0, 0.18)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, h / 2);
                ctx.lineTo(w, h / 2);
                ctx.stroke();
            }

            requestAnimationFrame(draw);
        };

        requestAnimationFrame(draw);
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
