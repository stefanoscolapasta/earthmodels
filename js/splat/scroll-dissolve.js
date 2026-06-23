import { CONFIG } from './config.js';

/**
 * Tracks scroll relative to two DOM anchors and emits a 0..1 dissolve target.
 *
 * Stateful, not positional. The dissolve is an accumulator integrated from
 * scroll deltas, NOT a function of absolute scroll position:
 *   - scrolling down ABOVE `startY` does nothing (the gate is closed);
 *   - scrolling down past `startY` adds to the dissolve at 1× rate;
 *   - scrolling up ALWAYS subtracts at `recoverMultiplier` × rate, regardless
 *     of where on the page you are.
 *
 * This means: scatter, then scroll back up — the dissolve unwinds quickly.
 * Scroll down again from the same spot and you continue from wherever it
 * stopped, not from a value derived from absolute scrollY.
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

        // Anchors are recorded for the gate test (down-scroll only counts when
        // y > startY) and for the integration range (endY - startY). The
        // accumulated dissolve value is preserved across re-measures so resize
        // / fonts-loaded events don't snap the effect back to a positional value.
        this._startY = startEl.getBoundingClientRect().top + window.scrollY;
        this._endY   = Math.max(endEl.getBoundingClientRect().top + window.scrollY, this._startY + 1);

        this._lastY = window.scrollY;
        this.onChange(this._dissolve);
    }

    _onResize() { this._measure(); }

    _onScroll() {
        const y = window.scrollY;
        const dy = y - this._lastY;
        this._lastY = y;
        if (dy === 0) return;

        const range = this._endY - this._startY;
        let delta = 0;

        if (dy > 0) {
            // Down-scroll only contributes when we're past the start gate.
            // Above the gate, scrolling down is just normal page scrolling.
            if (y > this._startY) {
                // The fraction of the gated range crossed this tick.
                const downFrom = Math.max(this._startY, this._lastY - dy);
                const downTo   = y;
                delta = (downTo - downFrom) / range;
            }
        } else {
            // Up-scroll always unwinds, regardless of where we are on the page.
            // This is what lets the user "rewind" the scatter from any scroll
            // position without it snapping back to a positional value.
            delta = (dy * this.recoverMultiplier) / range;
        }

        this._dissolve = Math.max(0, Math.min(1, this._dissolve + delta));
        this.onChange(this._dissolve);
    }
}
