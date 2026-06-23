/**
 * Live HUD widgets:
 *   - `#clock`      → UTC clock, ticks every second.
 *   - `#hud-cursor` → normalised cursor coordinates.
 *   - `#hud-fps`    → frames-per-second sampled every ~1s.
 *
 * Each widget is independent and a no-op if its target element is missing.
 */

export class UTCClock {
    /** @param {string} [selector] */
    constructor(selector = '#clock') {
        this.el = document.querySelector(selector);
        this._timerId = 0;
    }
    start() {
        if (!this.el) return;
        this._tick();
        this._timerId = setInterval(() => this._tick(), 1000);
    }
    stop() { clearInterval(this._timerId); }
    _tick() {
        const d = new Date();
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mm = String(d.getUTCMinutes()).padStart(2, '0');
        const ss = String(d.getUTCSeconds()).padStart(2, '0');
        this.el.textContent = `${hh}:${mm}:${ss} UTC`;
    }
}

export class CursorReadout {
    /** @param {string} [selector] */
    constructor(selector = '#hud-cursor') {
        this.el = document.querySelector(selector);
        this._onMove = this._onMove.bind(this);
    }
    start() {
        if (!this.el) return;
        document.addEventListener('mousemove', this._onMove, { passive: true });
    }
    stop() { document.removeEventListener('mousemove', this._onMove); }
    _onMove(e) {
        const x = (e.clientX / window.innerWidth - 0.5) * 2;
        const y = -(e.clientY / window.innerHeight - 0.5) * 2;
        const fmt = (v) => (v >= 0 ? '+' : '') + v.toFixed(3);
        this.el.textContent = `CUR  ${fmt(x)}  ${fmt(y)}`;
    }
}

export class FpsCounter {
    /** @param {string} [selector] */
    constructor(selector = '#hud-fps') {
        this.el = document.querySelector(selector);
        this._frames = 0;
        this._lastTick = 0;
        this._rafId = 0;
        this._loop = this._loop.bind(this);
    }
    start() {
        if (!this.el) return;
        this._lastTick = performance.now();
        this._rafId = requestAnimationFrame(this._loop);
    }
    stop() { cancelAnimationFrame(this._rafId); }
    _loop(now) {
        this._frames++;
        if (now - this._lastTick >= 1000) {
            this.el.textContent = `${this._frames} FPS`;
            this._frames = 0;
            this._lastTick = now;
        }
        this._rafId = requestAnimationFrame(this._loop);
    }
}

/** Convenience: start every HUD widget that has a target element. */
export function installHud() {
    new UTCClock().start();
    new CursorReadout().start();
    new FpsCounter().start();
}
