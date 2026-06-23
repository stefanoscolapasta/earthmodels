import * as THREE from 'three';
import { CONFIG } from './config.js';

/**
 * @typedef {Object} FramingResult
 * @property {THREE.Vector3} center  - World-space centre of the splat bounding box.
 * @property {number}        radius  - Bounding-sphere radius (used to scale interaction effects).
 */

/**
 * @typedef {Object} FramingOptions
 * @property {number} [fitPad]   - 1.0 = exact bounding-sphere fit; <1 zooms in.
 * @property {number} [pitchDeg] - Negative = look down on subject.
 */

const DEFAULT_RADIUS_FALLBACK = 1;

/**
 * Position `camera` so the splat's bounding sphere is fully framed.
 * Mutates `camera`. Returns the centre/radius of the splat's bounding box.
 *
 * @param {{ getBoundingBox: (precise: boolean) => THREE.Box3 }} splatMesh
 * @param {THREE.PerspectiveCamera} camera
 * @param {FramingOptions} [opts]
 * @returns {FramingResult}
 */
export function frameSplatToCamera(splatMesh, camera, opts = {}) {
    const fitPad   = opts.fitPad   ?? CONFIG.CAMERA_FIT_PAD;
    const pitchDeg = opts.pitchDeg ?? 0;

    const box = safeGetBoundingBox(splatMesh);
    if (!box || box.isEmpty()) {
        camera.position.set(0, 0, 5);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        return { center: new THREE.Vector3(), radius: DEFAULT_RADIUS_FALLBACK };
    }

    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const radius = size.length() * 0.5;

    const fov = THREE.MathUtils.degToRad(camera.fov);
    const distance = (radius / Math.sin(fov * 0.5)) * fitPad;

    // Place camera on a circle in the YZ plane around origin.
    const pitchRad = THREE.MathUtils.degToRad(pitchDeg);
    camera.position.set(
        0,
        Math.sin(-pitchRad) * distance,
        -Math.cos(-pitchRad) * distance
    );
    camera.lookAt(0, 0, 0);
    camera.near = Math.max(0.01, distance - radius * 4);
    camera.far  = distance + radius * 8;
    camera.updateProjectionMatrix();

    return { center, radius };
}

function safeGetBoundingBox(splatMesh) {
    try { return splatMesh.getBoundingBox(true); }
    catch { return null; }
}
