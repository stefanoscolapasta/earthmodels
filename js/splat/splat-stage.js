import * as THREE from 'three';
import { SparkRenderer, SplatMesh, dyno } from '@sparkjsdev/spark';

import { CONFIG } from './config.js';
import { readStageConfig } from './stage-config.js';
import { fetchAndDecodeQSplat } from './qsplat-loader.js';
import { frameSplatToCamera } from './camera-framing.js';
import { makeScatterModifier } from './scatter-modifier.js';
import { InteractionLoop } from './interaction-loop.js';

/**
 * One SplatStage owns one .splat-stage element: it sets up the WebGL renderer,
 * loads the splat asset, frames the camera, wires up the scatter modifier,
 * and starts the interaction loop. Call dispose() to tear everything down.
 */
export class SplatStage {
    /** @param {HTMLElement} el */
    constructor(el) {
        this.el = el;
        this.config = readStageConfig(el);
        this._loop = null;
        this._disposed = false;
        this._resizeObserver = null;
        this._onWindowResize = null;
    }

    /**
     * Mount and start the stage. Resolves once the splat is initialised and the
     * first frame has been queued.
     */
    async mount() {
        const cfg = this.config;

        const renderer = this._createRenderer();
        this.el.appendChild(renderer.domElement);

        const scene  = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(CONFIG.CAMERA_FOV_DEG, 1, 0.01, 1000);
        const spark  = new SparkRenderer({ renderer });
        scene.add(spark);

        const uniforms = {
            uHover:      dyno.dynoFloat(0),
            uDissolve:   dyno.dynoFloat(0),
            uMouseLocal: dyno.dynoVec3([1e6, 1e6, 1e6])
        };

        const splatPivot = new THREE.Group();
        splatPivot.rotation.set(cfg.pivotRot.x, cfg.pivotRot.y, cfg.pivotRot.z);
        scene.add(splatPivot);

        const splatMesh = await this._loadSplatMesh(cfg.url);
        splatMesh.quaternion.identity();
        splatPivot.add(splatMesh);
        await splatMesh.initialized;

        this._removeLoadingIndicator();

        const { center, radius } = frameSplatToCamera(splatMesh, camera, {
            fitPad:   cfg.fitPad,
            pitchDeg: cfg.cameraPitchDeg
        });

        const applyRightOffset = () => this._applyRightOffset(splatPivot, camera);
        this._installResizeHandlers(renderer, camera, applyRightOffset);

        splatMesh.objectModifier = makeScatterModifier({
            bboxCenter:        center,
            bboxRadius:        radius,
            mouseRadiusWorld:  radius * CONFIG.MOUSE_SCATTER_RADIUS_FRAC,
            uniforms
        });
        splatMesh.updateGenerator?.();

        this._loop = new InteractionLoop({
            stageEl:       this.el,
            scene, renderer, camera, splatMesh,
            center, bboxRadius: radius,
            uHover:        uniforms.uHover,
            uDissolve:     uniforms.uDissolve,
            uMouseLocal:   uniforms.uMouseLocal,
            scrollEffects: cfg.scrollEffects
        });
        this._loop.start();
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        this._loop?.dispose();
        this._resizeObserver?.disconnect();
        if (this._onWindowResize) window.removeEventListener('resize', this._onWindowResize);
    }

    _createRenderer() {
        const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x000000, 0);
        const c = renderer.domElement;
        c.style.display = 'block';
        c.style.width   = '100%';
        c.style.height  = '100%';
        return renderer;
    }

    _removeLoadingIndicator() {
        const loading = this.el.querySelector('.splat-loading');
        if (loading) loading.remove();
    }

    /**
     * Load a SplatMesh. .qsplat.gz is decoded client-side; everything else is
     * handed to Spark's URL loader.
     */
    async _loadSplatMesh(url) {
        if (url.includes('.qsplat')) {
            const fileBytes = await fetchAndDecodeQSplat(url);
            return new SplatMesh({ fileBytes, fileType: 'splat' });
        }
        return new SplatMesh({ url });
    }

    _applyRightOffset(splatPivot, camera) {
        const off = this.config.rightOffset;
        if (!off) { splatPivot.position.x = 0; return; }
        // Distance from camera to look-target (origin), not just |z|, so this
        // works regardless of camera pitch.
        const distance = camera.position.length();
        const fov = THREE.MathUtils.degToRad(camera.fov);
        const visibleH = 2 * distance * Math.tan(fov / 2);
        const visibleW = visibleH * camera.aspect;
        // Camera-right in world is +X; shifting in -X moves the splat toward
        // the user's screen-right.
        splatPivot.position.x = -visibleW * 0.5 * off;
    }

    _installResizeHandlers(renderer, camera, applyRightOffset) {
        // Track the last integer pixel size we actually applied. Mobile
        // browsers fire scroll-induced resize/ResizeObserver events for
        // sub-pixel URL-bar movement; reapplying setSize() each time
        // re-creates the WebGL backing buffer and the canvas flickers.
        let lastW = 0, lastH = 0;
        const sync = () => {
            const rect = this.el.getBoundingClientRect();
            const w = Math.max(1, Math.round(rect.width));
            const h = Math.max(1, Math.round(rect.height));
            if (w === lastW && h === lastH) return;
            lastW = w; lastH = h;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            applyRightOffset();
        };
        sync();

        this._onWindowResize = sync;
        window.addEventListener('resize', sync);
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(sync);
            this._resizeObserver.observe(this.el);
        }
    }
}

/**
 * Mount a SplatStage on every `.splat-stage` element in the document.
 * Failures are surfaced in-place inside the stage's loading indicator.
 * @returns {Promise<SplatStage[]>} successfully-mounted stages
 */
export async function mountAllSplatStages(root = document) {
    const els = Array.from(root.querySelectorAll('.splat-stage'));
    const mounted = [];
    await Promise.all(els.map(async (el) => {
        const stage = new SplatStage(el);
        try {
            await stage.mount();
            mounted.push(stage);
        } catch (err) {
            console.error(`Splat mount failed (${el.dataset.splatId}):`, err);
            const loading = el.querySelector('.splat-loading');
            if (loading) loading.textContent = 'Failed to load splat — see console';
        }
    }));
    return mounted;
}
