import * as THREE from 'three';
import { SparkRenderer, SplatMesh, dyno } from '@sparkjsdev/spark';

// ============================================================================
//                              TWEAKABLE CONFIG
// ----------------------------------------------------------------------------
// Every visual knob lives here. Per-stage overrides (URL, pivot rotation,
// right-offset, camera pitch, fit pad, scroll-effects on/off) come from
// data-* attributes on the .splat-stage element in the HTML.
// ============================================================================
const CONFIG = {
    // ── ROTATION ───────────────────────────────────────────────────────────
    // Constant idle yaw, in radians per frame (60fps assumed). Higher = faster spin.
    SPLAT_SPIN_SPEED: 0.0022,

    // ── CAMERA FRAMING ─────────────────────────────────────────────────────
    CAMERA_FOV_DEG: 60,
    CAMERA_FIT_PAD: 0.9,   // 1.0 = exact bounding-sphere fit; <1 zooms in

    // ── HOVER (mouse-radius scatter) ───────────────────────────────────────
    MOUSE_SCATTER_RADIUS_FRAC: 0.4,   // radius of effect as fraction of bbox radius
    MOUSE_PARALLAX_STRENGTH:   0.012, // worldspace shift per unit NDC

    // ── SCROLL DISSOLVE ────────────────────────────────────────────────────
    // Only stages with data-spark-effects="true" listen to scroll. The dissolve
    // is anchored to two DOM elements rather than viewport units.
    SCROLL_DISSOLVE_START_SELECTOR: '.display .display-line:last-child',  // second line of H1 — between .display and .lede
    SCROLL_DISSOLVE_END_SELECTOR:   '#abstract',  // dissolve completes when next section covers the splat
    // Asymmetric recovery: each pixel of upward scroll reduces the dissolve as
    // if MULTIPLIER pixels had been scrolled. So at 2.5, recovering from a full
    // dissolve takes ~40% of the scroll distance that built it up.
    SCROLL_RECOVER_MULTIPLIER: 2.5,

    // ── SCATTER SHADER (per-splat dyno modifier) ───────────────────────────
    SCATTER_RADIAL_MULT:    1.05,
    SCATTER_JITTER_AMOUNT:  0.55,
    SHRINK_AT_FULL_SCATTER: 0.25,
    ALPHA_FADE_AT_FULL:     0.55,
    SCATTER_INFLATE_SCALE:  0.06,

    // ── SMOOTHING (lower = laggier, higher = snappier; per-frame constants) ──
    SMOOTH_MOUSE:    0.08,
    SMOOTH_HOVER:    0.06,
    SMOOTH_SCROLL:   0.075
};

// Format a JS number as a GLSL float literal (always has a decimal point).
const glslFloat = (n) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

// ============================================================================
// Boot — find every .splat-stage and mount one viewer per stage.
// ============================================================================
const stageEls = Array.from(document.querySelectorAll('.splat-stage'));
for (const el of stageEls) {
    mountSplat(el).catch((err) => {
        console.error(`Splat mount failed (${el.dataset.splatId}):`, err);
        const loading = el.querySelector('.splat-loading');
        if (loading) loading.textContent = 'Failed to load splat — see console';
    });
}

// ============================================================================
// mountSplat — per-stage initialisation
// ============================================================================
async function mountSplat(stageEl) {
    const cfg = readStageConfig(stageEl);

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width  = '100%';
    canvas.style.height = '100%';
    stageEl.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CONFIG.CAMERA_FOV_DEG, 1, 0.01, 1000);
    const spark = new SparkRenderer({ renderer });
    scene.add(spark);

    const uHover      = dyno.dynoFloat(0);
    const uDissolve   = dyno.dynoFloat(0);
    const uMouseLocal = dyno.dynoVec3([1e6, 1e6, 1e6]);

    const splatPivot = new THREE.Group();
    splatPivot.rotation.set(cfg.pivotRot.x, cfg.pivotRot.y, cfg.pivotRot.z);
    scene.add(splatPivot);

    // .qsplat.gz is our quantised + gzipped format. We decode it client-side
    // back to standard 32-byte .splat bytes and hand those to Spark.
    // Other extensions (.splat / .ply / .spz) go straight through Spark's URL loader.
    let splatMesh;
    if (cfg.url.includes('.qsplat')) {
        const splatBytes = await fetchAndDecodeQSplat(cfg.url);
        splatMesh = new SplatMesh({ fileBytes: splatBytes, fileType: 'splat' });
    } else {
        splatMesh = new SplatMesh({ url: cfg.url });
    }
    splatMesh.quaternion.identity();
    splatPivot.add(splatMesh);

    await splatMesh.initialized;

    const loadingEl = stageEl.querySelector('.splat-loading');
    if (loadingEl) loadingEl.remove();

    const center = new THREE.Vector3();
    const bboxRadius = frameSplatToCamera(splatMesh, camera, center, {
        fitPad: cfg.fitPad,
        pitchDeg: cfg.cameraPitchDeg
    });

    function applyRightOffset() {
        if (!cfg.rightOffset) { splatPivot.position.x = 0; return; }
        // Distance from camera to look-target (origin), not just |z|, so this
        // works regardless of camera pitch.
        const distance = camera.position.length();
        const fov = THREE.MathUtils.degToRad(camera.fov);
        const visibleH = 2 * distance * Math.tan(fov / 2);
        const visibleW = visibleH * camera.aspect;
        // Camera-right in world is +X; shifting in -X moves the splat toward
        // the user's screen-right.
        splatPivot.position.x = -visibleW * 0.5 * cfg.rightOffset;
    }

    function syncRendererSize() {
        const rect = stageEl.getBoundingClientRect();
        const w = Math.max(1, rect.width);
        const h = Math.max(1, rect.height);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        applyRightOffset();
    }
    syncRendererSize();
    window.addEventListener('resize', syncRendererSize);
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(syncRendererSize).observe(stageEl);
    }

    splatMesh.objectModifier = makeScatterModifier({
        bboxCenter: center,
        bboxRadius,
        mouseRadiusWorld: bboxRadius * CONFIG.MOUSE_SCATTER_RADIUS_FRAC,
        uHover, uDissolve, uMouseLocal
    });
    splatMesh.updateGenerator?.();

    startInteraction({
        stageEl, scene, renderer, camera, splatMesh,
        center, bboxRadius,
        uHover, uDissolve, uMouseLocal,
        scrollEffects: cfg.scrollEffects
    });
}

// ============================================================================
// Per-stage interaction — mouse parallax, hover scatter, spin, scroll dissolve.
// ============================================================================
function startInteraction({ stageEl, scene, renderer, camera, splatMesh,
                            center, bboxRadius,
                            uHover, uDissolve, uMouseLocal, scrollEffects }) {
    let targetMouseX = 0, targetMouseY = 0;
    let mouseX = 0, mouseY = 0;
    let targetHover = 0, hoverAmt = 0;
    let targetScroll = 0, scrollAmt = 0;
    let rotY = 0;

    const ndc = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    const focalPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const mouseHitWorld = new THREE.Vector3();
    const mouseHitLocal = new THREE.Vector3();
    const camDir = new THREE.Vector3();

    // Mouse coords are computed RELATIVE to this stage's bounding rect, so an
    // inline stage's hover doesn't track the page-wide cursor — only the cursor
    // over its own rectangle.
    function onMove(e) {
        const r = stageEl.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top)  / r.height;
        targetMouseX = px * 2 - 1;
        targetMouseY = -(py * 2 - 1);
        ndc.set(targetMouseX, targetMouseY);
    }
    document.addEventListener('mousemove', onMove, { passive: true });

    stageEl.addEventListener('mouseenter', () => { targetHover = 1; });
    stageEl.addEventListener('mouseleave', () => { targetHover = 0; });

    if (scrollEffects) {
        installScrollDissolve((p) => { targetScroll = p; });
    }

    function tick() {
        requestAnimationFrame(tick);

        mouseX    += (targetMouseX - mouseX)    * CONFIG.SMOOTH_MOUSE;
        mouseY    += (targetMouseY - mouseY)    * CONFIG.SMOOTH_MOUSE;
        hoverAmt  += (targetHover  - hoverAmt)  * CONFIG.SMOOTH_HOVER;
        scrollAmt += (targetScroll - scrollAmt) * CONFIG.SMOOTH_SCROLL;

        rotY += CONFIG.SPLAT_SPIN_SPEED;
        splatMesh.rotation.y = rotY;
        splatMesh.scale.setScalar(1 + scrollAmt * CONFIG.SCATTER_INFLATE_SCALE);

        const parallax = CONFIG.MOUSE_PARALLAX_STRENGTH * bboxRadius;
        splatMesh.position.set(
            -center.x + mouseX * parallax,
            -center.y + mouseY * parallax * 0.6,
            -center.z
        );

        raycaster.setFromCamera(ndc, camera);
        camera.getWorldDirection(camDir);
        focalPlane.setFromNormalAndCoplanarPoint(camDir.clone().negate(), center);
        if (raycaster.ray.intersectPlane(focalPlane, mouseHitWorld)) {
            mouseHitLocal.copy(mouseHitWorld);
            splatMesh.worldToLocal(mouseHitLocal);
            uMouseLocal.value = [mouseHitLocal.x, mouseHitLocal.y, mouseHitLocal.z];
        }

        uHover.value    = hoverAmt;
        uDissolve.value = scrollAmt;

        renderer.render(scene, camera);
    }
    requestAnimationFrame(tick);
}

// ============================================================================
// Scroll dissolve — anchored to two DOM elements, with asymmetric recovery
// ============================================================================
function installScrollDissolve(setTarget) {
    let startY = 0, endY = 1;
    let dissolve = 0;
    let lastY = window.scrollY;

    function measure() {
        const startEl = document.querySelector(CONFIG.SCROLL_DISSOLVE_START_SELECTOR);
        const endEl   = document.querySelector(CONFIG.SCROLL_DISSOLVE_END_SELECTOR);
        if (!startEl || !endEl) return;
        startY = startEl.getBoundingClientRect().top + window.scrollY;
        endY   = Math.max(endEl.getBoundingClientRect().top + window.scrollY, startY + 1);

        const y = window.scrollY;
        if (y <= startY) dissolve = 0;
        else if (y >= endY) dissolve = 1;
        lastY = y;
        setTarget(dissolve);
    }

    function onScroll() {
        const y = window.scrollY;
        const dy = y - lastY;
        lastY = y;
        if (y <= startY) {
            dissolve = 0;
        } else if (y >= endY) {
            dissolve = 1;
        } else {
            const range = endY - startY;
            const delta = dy > 0
                ? dy / range
                : (dy * CONFIG.SCROLL_RECOVER_MULTIPLIER) / range;
            dissolve = Math.max(0, Math.min(1, dissolve + delta));
        }
        setTarget(dissolve);
    }

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);
    if (document.readyState !== 'complete') {
        window.addEventListener('load', measure, { once: true });
    }
    document.fonts?.ready?.then(measure);
}

// ============================================================================
// .qsplat.gz loader — fetch + gzip-decompress + dequantise to .splat bytes
// ----------------------------------------------------------------------------
// Mirror of convert_ply.py's encoder. See that file for the full byte layout.
// In a single line:
//   header (44 B) tells us splat count + bbox + log-scale range;
//   each splat is 17 B (pos uint16×3 | scale uint8×3 | rgba uint8×4 | rot uint8×4);
//   we expand back to the standard .splat 32-byte layout (float32 pos + float32
//   linear scale + uint8 rgba + uint8 rot).
// ============================================================================
async function fetchAndDecodeQSplat(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch ${url} failed: ${res.status}`);

    // DecompressionStream is supported in all evergreen browsers (2023+).
    const ds = new DecompressionStream('gzip');
    const decompressed = res.body.pipeThrough(ds);
    const blob = await new Response(decompressed).arrayBuffer();
    const raw = new Uint8Array(blob);

    // ─── parse header ───
    const HEADER_SIZE = 44;
    const dv = new DataView(raw.buffer, raw.byteOffset, HEADER_SIZE);
    const magic = dv.getUint32(0, true);
    if (magic !== 0x51535054) throw new Error(`Bad magic: 0x${magic.toString(16)}`);
    const version = dv.getUint8(4);
    if (version !== 1) throw new Error(`Unsupported qsplat version ${version}`);
    const count = dv.getUint32(8, true);
    const bboxMinX = dv.getFloat32(12, true);
    const bboxMinY = dv.getFloat32(16, true);
    const bboxMinZ = dv.getFloat32(20, true);
    const bboxMaxX = dv.getFloat32(24, true);
    const bboxMaxY = dv.getFloat32(28, true);
    const bboxMaxZ = dv.getFloat32(32, true);
    const lnScaleMin = dv.getFloat32(36, true);
    const lnScaleMax = dv.getFloat32(40, true);

    const extX = bboxMaxX - bboxMinX;
    const extY = bboxMaxY - bboxMinY;
    const extZ = bboxMaxZ - bboxMinZ;
    const lnExt = lnScaleMax - lnScaleMin;

    // ─── allocate output (.splat layout: 32 bytes/splat) ───
    const STRIDE = 32;
    const out = new Uint8Array(count * STRIDE);
    const outF32 = new Float32Array(out.buffer);

    // ─── dequantise body ───
    // The 17-byte stride means uint16 reads are unaligned for odd-indexed splats,
    // so we always use DataView (which handles unaligned reads).
    const BODY_OFFSET = HEADER_SIZE;
    const SRC_STRIDE = 17;
    for (let i = 0; i < count; i++) {
        const srcOff = BODY_OFFSET + i * SRC_STRIDE;
        const dv2 = new DataView(raw.buffer, raw.byteOffset + srcOff, SRC_STRIDE);

        const xq = dv2.getUint16(0, true);
        const yq = dv2.getUint16(2, true);
        const zq = dv2.getUint16(4, true);
        const sxq = dv2.getUint8(6);
        const syq = dv2.getUint8(7);
        const szq = dv2.getUint8(8);
        const r = dv2.getUint8(9);
        const g = dv2.getUint8(10);
        const b = dv2.getUint8(11);
        const a = dv2.getUint8(12);
        const qw = dv2.getUint8(13);
        const qx = dv2.getUint8(14);
        const qy = dv2.getUint8(15);
        const qz = dv2.getUint8(16);

        const dstF = (i * STRIDE) >> 2;
        // Position: dequant uint16 -> float32 over bbox.
        outF32[dstF + 0] = bboxMinX + (xq / 65535) * extX;
        outF32[dstF + 1] = bboxMinY + (yq / 65535) * extY;
        outF32[dstF + 2] = bboxMinZ + (zq / 65535) * extZ;
        // Scale: dequant uint8 over log-range, then exp() to linear (matches .splat).
        outF32[dstF + 3] = Math.exp(lnScaleMin + (sxq / 255) * lnExt);
        outF32[dstF + 4] = Math.exp(lnScaleMin + (syq / 255) * lnExt);
        outF32[dstF + 5] = Math.exp(lnScaleMin + (szq / 255) * lnExt);

        // Color RGBA + rotation: copy uint8 directly into the .splat tail.
        const dstU8 = i * STRIDE + 24;
        out[dstU8 + 0] = r;
        out[dstU8 + 1] = g;
        out[dstU8 + 2] = b;
        out[dstU8 + 3] = a;
        out[dstU8 + 4] = qw;
        out[dstU8 + 5] = qx;
        out[dstU8 + 6] = qy;
        out[dstU8 + 7] = qz;
    }

    return out;
}

// ============================================================================
// Stage config from data-* attrs
// ============================================================================
function readStageConfig(el) {
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
        cameraPitchDeg: Number(d.cameraPitchDeg ?? 0),  // negative = look down on subject
        fitPad:         d.fitPad ? Number(d.fitPad) : CONFIG.CAMERA_FIT_PAD,
        scrollEffects:  d.sparkEffects === 'true'
    };
}

// ============================================================================
// Scatter shader — per-splat dyno modifier
// ============================================================================
function makeScatterModifier({ bboxCenter, bboxRadius, mouseRadiusWorld,
                                uHover, uDissolve, uMouseLocal }) {
    const C = (n) => glslFloat(n);
    const VEC3 = (v) => `vec3(${C(v.x)}, ${C(v.y)}, ${C(v.z)})`;

    return dyno.dynoBlock(
        { gsplat: dyno.Gsplat },
        { gsplat: dyno.Gsplat },
        ({ gsplat }) => {
            const { index, center, scales, rgba } = dyno.splitGsplat(gsplat).outputs;

            const dust = new dyno.Dyno({
                inTypes: { idx: 'int', pos: 'vec3', mouseLocal: 'vec3', hover: 'float', dissolve: 'float' },
                outTypes: { newCenter: 'vec3', amt: 'float', shrink: 'float' },
                inputs: { idx: index, pos: center, mouseLocal: uMouseLocal, hover: uHover, dissolve: uDissolve },
                globals: () => [dyno.unindent(`
                    vec3 hashDir(int i) {
                        float fi = float(i);
                        float a = fract(sin(fi * 12.9898) * 43758.5453);
                        float b = fract(sin(fi * 78.2331) * 22578.1459);
                        float theta = a * 6.2831853;
                        float z = b * 2.0 - 1.0;
                        float r = sqrt(max(0.0, 1.0 - z * z));
                        return vec3(r * cos(theta), r * sin(theta), z);
                    }
                    float hash1(int i) {
                        return fract(sin(float(i) * 91.345) * 51289.6841);
                    }
                `)],
                statements: ({ inputs, outputs }) => [dyno.unindent(`
                    vec3 outward = normalize(${inputs.pos} - ${VEC3(bboxCenter)} + vec3(1e-5));
                    vec3 dir = normalize(outward + hashDir(${inputs.idx}) * ${C(CONFIG.SCATTER_JITTER_AMOUNT)});

                    float distMouse = distance(${inputs.pos}, ${inputs.mouseLocal});
                    float local = 1.0 - smoothstep(0.0, ${C(mouseRadiusWorld)}, distMouse);
                    float mouseScatter = local * ${inputs.hover};

                    float scatter = max(${inputs.dissolve}, mouseScatter);
                    float energy = 0.45 + hash1(${inputs.idx}) * 1.05;
                    float curve  = pow(scatter, 0.7);

                    ${outputs.newCenter} = ${inputs.pos} + dir * curve * energy * ${C(bboxRadius * CONFIG.SCATTER_RADIAL_MULT)};
                    ${outputs.amt}       = scatter;
                    ${outputs.shrink}    = mix(1.0, ${C(CONFIG.SHRINK_AT_FULL_SCATTER)}, clamp(scatter, 0.0, 1.0));
                `)]
            }).outputs;

            const fadedRgba = new dyno.Dyno({
                inTypes:  { c: 'vec4', amt: 'float' },
                outTypes: { c: 'vec4' },
                inputs:   { c: rgba, amt: dust.amt },
                statements: ({ inputs, outputs }) => [
                    `float aMul = 1.0 - clamp(${inputs.amt} * ${C(CONFIG.ALPHA_FADE_AT_FULL)}, 0.0, 0.85);`,
                    `${outputs.c} = vec4(${inputs.c}.rgb, ${inputs.c}.a * aMul);`
                ]
            }).outputs.c;

            return {
                gsplat: dyno.combineGsplat({
                    gsplat,
                    center: dust.newCenter,
                    scales: dyno.mul(scales, dust.shrink),
                    rgba: fadedRgba
                })
            };
        }
    );
}

// ============================================================================
// Camera framing — bounding-sphere fit with optional pitch
// ============================================================================
function frameSplatToCamera(splatMesh, camera, outCenter,
                             { fitPad = CONFIG.CAMERA_FIT_PAD, pitchDeg = 0 } = {}) {
    let box;
    try { box = splatMesh.getBoundingBox(true); } catch { box = null; }
    if (!box || box.isEmpty()) {
        outCenter.set(0, 0, 0);
        camera.position.set(0, 0, 5);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        return 1;
    }

    box.getCenter(outCenter);
    const size = new THREE.Vector3();
    box.getSize(size);
    const radius = size.length() * 0.5;

    const fov = THREE.MathUtils.degToRad(camera.fov);
    const distance = (radius / Math.sin(fov * 0.5)) * fitPad;

    // Place camera on a circle in the YZ plane around origin. Negative pitchDeg
    // raises the camera and tilts it down on the subject (bird's-eye view).
    const pitchRad = THREE.MathUtils.degToRad(pitchDeg);
    camera.position.set(
        0,
        Math.sin(-pitchRad) * distance,
        -Math.cos(-pitchRad) * distance
    );
    camera.lookAt(0, 0, 0);
    camera.near = Math.max(0.01, distance - radius * 4);
    camera.far = distance + radius * 8;
    camera.updateProjectionMatrix();

    return radius;
}
