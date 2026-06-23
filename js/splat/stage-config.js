import { CONFIG } from './config.js';

/**
 * @typedef {Object} StageConfig
 * @property {string}  id              - Identifier from data-splat-id (for debugging).
 * @property {string}  url             - Splat asset URL (.qsplat.gz / .splat / .ply / .spz).
 * @property {{x:number,y:number,z:number}} pivotRot - Pivot rotation in radians.
 * @property {number}  rightOffset     - Horizontal nudge as a fraction of visible width.
 * @property {number}  cameraPitchDeg  - Negative = look down on subject.
 * @property {number}  fitPad          - Bounding-sphere fit pad (1 = exact).
 * @property {boolean} scrollEffects   - Whether this stage listens to scroll dissolve.
 * @property {boolean} orbitControls   - Whether the user can drag-spin / wheel-zoom this stage.
 *                                       When true, idle auto-spin and mouse-parallax are disabled.
 */

/**
 * Read the per-stage configuration from data-* attributes on a .splat-stage element.
 * @param {HTMLElement} el
 * @returns {StageConfig}
 */
export function readStageConfig(el) {
    const d = el.dataset;
    return {
        id:           d.splatId ?? 'unnamed',
        url:          d.splatUrl,
        pivotRot: {
            x: Number(d.pivotRotX ?? 0),
            y: Number(d.pivotRotY ?? 0),
            z: Number(d.pivotRotZ ?? 0)
        },
        rightOffset:    Number(d.rightOffset ?? 0),
        cameraPitchDeg: Number(d.cameraPitchDeg ?? 0),
        fitPad:         d.fitPad ? Number(d.fitPad) : CONFIG.CAMERA_FIT_PAD,
        scrollEffects:  d.sparkEffects === 'true',
        orbitControls:  d.orbitControls === 'true'
    };
}
