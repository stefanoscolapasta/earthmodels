/**
 * Global tweakables for every splat stage. Per-stage overrides come from
 * data-* attributes on the .splat-stage element and are resolved in
 * stage-config.js.
 */
export const CONFIG = Object.freeze({
    SPLAT_SPIN_SPEED: 0.0022,

    CAMERA_FOV_DEG: 60,
    CAMERA_FIT_PAD: 0.9,

    MOUSE_SCATTER_RADIUS_FRAC: 0.4,
    MOUSE_PARALLAX_STRENGTH:   0.012,

    SCROLL_DISSOLVE_START_SELECTOR: '.display .display-line:last-child',
    SCROLL_DISSOLVE_END_SELECTOR:   '#abstract',
    SCROLL_RECOVER_MULTIPLIER: 2.5,

    SCATTER_RADIAL_MULT:    1.05,
    SCATTER_JITTER_AMOUNT:  0.55,
    SHRINK_AT_FULL_SCATTER: 0.25,
    ALPHA_FADE_AT_FULL:     0.55,
    SCATTER_INFLATE_SCALE:  0.06,

    SMOOTH_MOUSE:    0.08,
    SMOOTH_HOVER:    0.06,
    SMOOTH_SCROLL:   0.075
});

/** Format a JS number as a GLSL float literal (always has a decimal point). */
export const glslFloat = (n) => (Number.isInteger(n) ? `${n}.0` : `${n}`);
