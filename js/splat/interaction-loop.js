import * as THREE from 'three';
import { CONFIG } from './config.js';
import { ScrollDissolveController } from './scroll-dissolve.js';

/**
 * @typedef {Object} InteractionLoopParams
 * @property {HTMLElement}                stageEl
 * @property {THREE.Scene}                scene
 * @property {THREE.WebGLRenderer}        renderer
 * @property {THREE.PerspectiveCamera}    camera
 * @property {*}                          splatMesh   - Spark SplatMesh.
 * @property {THREE.Vector3}              center
 * @property {number}                     bboxRadius
 * @property {{value:number}}             uHover
 * @property {{value:number}}             uDissolve
 * @property {{value:[number,number,number]}} uMouseLocal
 * @property {boolean}                    scrollEffects
 */

/**
 * Per-stage interaction: mouse parallax, hover scatter, idle spin, optional scroll dissolve.
 * Owns the rAF loop until dispose() is called.
 */
export class InteractionLoop {
    /** @param {InteractionLoopParams} params */
    constructor(params) {
        this.params = params;

        this._targetMouseX = 0; this._targetMouseY = 0;
        this._mouseX = 0;       this._mouseY = 0;
        this._targetHover = 0;  this._hoverAmt = 0;
        this._targetScroll = 0; this._scrollAmt = 0;
        this._rotY = 0;

        this._ndc = new THREE.Vector2();
        this._raycaster = new THREE.Raycaster();
        this._focalPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        this._mouseHitWorld = new THREE.Vector3();
        this._mouseHitLocal = new THREE.Vector3();
        this._camDir = new THREE.Vector3();

        this._rafId = 0;
        this._disposed = false;
        this._scrollCtl = null;

        this._onMove        = this._onMove.bind(this);
        this._onMouseEnter  = () => { this._targetHover = 1; };
        this._onMouseLeave  = () => { this._targetHover = 0; };
        this._tick          = this._tick.bind(this);
    }

    start() {
        const { stageEl, scrollEffects } = this.params;
        document.addEventListener('mousemove', this._onMove, { passive: true });
        stageEl.addEventListener('mouseenter', this._onMouseEnter);
        stageEl.addEventListener('mouseleave', this._onMouseLeave);

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
        this.params.stageEl.removeEventListener('mouseenter', this._onMouseEnter);
        this.params.stageEl.removeEventListener('mouseleave', this._onMouseLeave);
        this._scrollCtl?.dispose();
    }

    /** Mouse coords are computed RELATIVE to this stage's bounding rect. */
    _onMove(e) {
        const r = this.params.stageEl.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top)  / r.height;
        this._targetMouseX = px * 2 - 1;
        this._targetMouseY = -(py * 2 - 1);
        this._ndc.set(this._targetMouseX, this._targetMouseY);
    }

    _tick() {
        if (this._disposed) return;
        this._rafId = requestAnimationFrame(this._tick);

        const p = this.params;

        this._mouseX    += (this._targetMouseX  - this._mouseX)    * CONFIG.SMOOTH_MOUSE;
        this._mouseY    += (this._targetMouseY  - this._mouseY)    * CONFIG.SMOOTH_MOUSE;
        this._hoverAmt  += (this._targetHover   - this._hoverAmt)  * CONFIG.SMOOTH_HOVER;
        this._scrollAmt += (this._targetScroll  - this._scrollAmt) * CONFIG.SMOOTH_SCROLL;

        this._rotY += CONFIG.SPLAT_SPIN_SPEED;
        p.splatMesh.rotation.y = this._rotY;
        p.splatMesh.scale.setScalar(1 + this._scrollAmt * CONFIG.SCATTER_INFLATE_SCALE);

        const parallax = CONFIG.MOUSE_PARALLAX_STRENGTH * p.bboxRadius;
        p.splatMesh.position.set(
            -p.center.x + this._mouseX * parallax,
            -p.center.y + this._mouseY * parallax * 0.6,
            -p.center.z
        );

        this._raycaster.setFromCamera(this._ndc, p.camera);
        p.camera.getWorldDirection(this._camDir);
        this._focalPlane.setFromNormalAndCoplanarPoint(this._camDir.clone().negate(), p.center);
        if (this._raycaster.ray.intersectPlane(this._focalPlane, this._mouseHitWorld)) {
            this._mouseHitLocal.copy(this._mouseHitWorld);
            p.splatMesh.worldToLocal(this._mouseHitLocal);
            p.uMouseLocal.value = [this._mouseHitLocal.x, this._mouseHitLocal.y, this._mouseHitLocal.z];
        }

        p.uHover.value    = this._hoverAmt;
        p.uDissolve.value = this._scrollAmt;

        p.renderer.render(p.scene, p.camera);
    }
}
