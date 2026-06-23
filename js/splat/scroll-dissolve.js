import { CONFIG } from './config.js';

/**
 * Tracks scroll between two DOM anchors and emits a 0..1 dissolve target.
 * Scrolling forward (down) drives the dissolve at 1× scroll-distance;
 * scrolling backward recovers it at `SCROLL_RECOVER_MULTIPLIER` × the rate.
 */
export class ScrollDissolveController {
    /**
     * @param {{ startSelector?: string, endSelector?: string, recoverMultiplier?: number,
     *          onChange: (value: number) => void }} options
     */
    constructor(options) {
        this.startSelector     = options.startSelector     ?? CONFIG.SCROLL_DISSOLVE_START_SELECTOR;
        this.endSelector       = options.endSelector       ?? CONFIG.SCROLL_DISSOLVE_END_SELECTOR;
        this.recoverMultiplier = options.recoverMultiplier ?? CONFIG.SCROLL_RECOVER_MULTIPLIER;
        this.onChange = options.onChange;

        this._startY = 0;
        this._endY   = 1;
        this._dissolve = 0;
        this._lastY = window.scrollY;

        this._onScroll = this._onScroll.bind(this);
        this._onResize = this._onResize.bind(this);
    }

    /** Begin listening. */
    install() {
        this._measure();
        window.addEventListener('scroll', this._onScroll, { passive: true });
        window.addEventListener('resize', this._onResize);
        if (document.readyState !== 'complete') {
            window.addEventListener('load', this._onResize, { once: true });
        }
        document.fonts?.ready?.then(() => this._measure());
    }

    /** Stop listening. */
    dispose() {
        window.removeEventListener('scroll', this._onScroll);
        window.removeEventListener('resize', this._onResize);
    }

    _measure() {
        const startEl = document.querySelector(this.startSelector);
        const endEl   = document.querySelector(this.endSelector);
        if (!startEl || !endEl) return;

        this._startY = startEl.getBoundingClientRect().top + window.scrollY;
        this._endY   = Math.max(endEl.getBoundingClientRect().top + window.scrollY, this._startY + 1);

        const y = window.scrollY;
        if      (y <= this._startY) this._dissolve = 0;
        else if (y >= this._endY)   this._dissolve = 1;
        this._lastY = y;
        this.onChange(this._dissolve);
    }

    _onResize() { this._measure(); }

    _onScroll() {
        const y = window.scrollY;
        const dy = y - this._lastY;
        this._lastY = y;

        if (y <= this._startY) {
            this._dissolve = 0;
        } else if (y >= this._endY) {
            this._dissolve = 1;
        } else {
            const range = this._endY - this._startY;
            const delta = dy > 0
                ? dy / range
                : (dy * this.recoverMultiplier) / range;
            this._dissolve = Math.max(0, Math.min(1, this._dissolve + delta));
        }
        this.onChange(this._dissolve);
    }
}
