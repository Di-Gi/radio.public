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
