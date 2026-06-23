import { CONFIG } from './config.js';
import { ScrollDissolveController } from './scroll-dissolve.js';

/**
 * @typedef {Object} InteractionLoopParams
 * @property {HTMLElement}             stageEl
 * @property {THREE.Scene}             scene
 * @property {THREE.WebGLRenderer}     renderer
 * @property {THREE.PerspectiveCamera} camera
 * @property {*}                       splatMesh   - Spark SplatMesh.
 * @property {THREE.Vector3}           center
 * @property {number}                  bboxRadius
 * @property {{value:number}}          uDissolve
 * @property {boolean}                 scrollEffects
 * @property {*}                       [orbitControls] - Optional OrbitControls instance.
 *                                                       If provided, idle spin and parallax
 *                                                       are suppressed so the user has full
 *                                                       control of the camera.
 */

/**
 * Per-stage interaction: mouse parallax, idle spin, optional scroll dissolve.
 * Owns the rAF loop until dispose() is called.
 */
export class InteractionLoop {
    /** @param {InteractionLoopParams} params */
    constructor(params) {
        this.params = params;

        this._targetMouseX = 0; this._targetMouseY = 0;
        this._mouseX = 0;       this._mouseY = 0;
        this._targetScroll = 0; this._scrollAmt = 0;
        this._rotY = 0;

        this._rafId = 0;
        this._disposed = false;
        this._scrollCtl = null;

        this._onMove = this._onMove.bind(this);
        this._tick   = this._tick.bind(this);
    }

    start() {
        const { scrollEffects } = this.params;
        document.addEventListener('mousemove', this._onMove, { passive: true });

        if (scrollEffects) {
            this._scrollCtl = new ScrollDissolveController({
                onChange: (p) => { this._targetScroll = p; }
            });
            this._scrollCtl.install();
        }

        this._rafId = requestAnimationFrame(this._tick);
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        cancelAnimationFrame(this._rafId);
        document.removeEventListener('mousemove', this._onMove);
        this._scrollCtl?.dispose();
    }

    /** Mouse coords are computed RELATIVE to this stage's bounding rect, used for parallax. */
    _onMove(e) {
        const r = this.params.stageEl.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top)  / r.height;
        this._targetMouseX = px * 2 - 1;
        this._targetMouseY = -(py * 2 - 1);
    }

    _tick() {
        if (this._disposed) return;
        this._rafId = requestAnimationFrame(this._tick);

        const p = this.params;
        const userControlled = !!p.orbitControls;

        this._mouseX    += (this._targetMouseX  - this._mouseX)    * CONFIG.SMOOTH_MOUSE;
        this._mouseY    += (this._targetMouseY  - this._mouseY)    * CONFIG.SMOOTH_MOUSE;
        this._scrollAmt += (this._targetScroll  - this._scrollAmt) * CONFIG.SMOOTH_SCROLL;

        // Idle auto-spin: skip when the user is orbiting; their drag is the rotation.
        if (!userControlled) {
            this._rotY += CONFIG.SPLAT_SPIN_SPEED;
            p.splatMesh.rotation.y = this._rotY;
        }
        p.splatMesh.scale.setScalar(1 + this._scrollAmt * CONFIG.SCATTER_INFLATE_SCALE);

        // Mouse-parallax: skipped under orbit, since the camera is the user's tool there.
        if (!userControlled) {
            const parallax = CONFIG.MOUSE_PARALLAX_STRENGTH * p.bboxRadius;
            p.splatMesh.position.set(
                -p.center.x + this._mouseX * parallax,
                -p.center.y + this._mouseY * parallax * 0.6,
                -p.center.z
            );
        } else {
            p.splatMesh.position.set(-p.center.x, -p.center.y, -p.center.z);
            p.orbitControls.update();
        }

        p.uDissolve.value = this._scrollAmt;

        p.renderer.render(p.scene, p.camera);
    }
}
