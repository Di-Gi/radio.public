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
