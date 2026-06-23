import { dyno } from '@sparkjsdev/spark';
import { CONFIG, glslFloat } from './config.js';

/**
 * @typedef {Object} ScatterUniforms
 * @property {{value:number}} uDissolve - 0..1 scroll-driven dissolve.
 */

/**
 * @typedef {Object} ScatterModifierParams
 * @property {THREE.Vector3}   bboxCenter
 * @property {number}          bboxRadius
 * @property {ScatterUniforms} uniforms
 */

/**
 * Build a per-splat dyno modifier that:
 *  - scatters splats radially outward as `uDissolve` rises;
 *  - shrinks scales toward `SHRINK_AT_FULL_SCATTER` as scatter intensifies;
 *  - fades alpha by `ALPHA_FADE_AT_FULL`.
 *
 * @param {ScatterModifierParams} params
 * @returns {*} A dyno block that can be assigned to `splatMesh.objectModifier`.
 */
export function makeScatterModifier({ bboxCenter, bboxRadius, uniforms }) {
    const { uDissolve } = uniforms;
    const c    = (n) => glslFloat(n);
    const vec3 = (v) => `vec3(${c(v.x)}, ${c(v.y)}, ${c(v.z)})`;

    return dyno.dynoBlock(
        { gsplat: dyno.Gsplat },
        { gsplat: dyno.Gsplat },
        ({ gsplat }) => {
            const { index, center, scales, rgba } = dyno.splitGsplat(gsplat).outputs;

            const dust = new dyno.Dyno({
                inTypes:  { idx: 'int', pos: 'vec3', dissolve: 'float' },
                outTypes: { newCenter: 'vec3', amt: 'float', shrink: 'float' },
                inputs:   { idx: index, pos: center, dissolve: uDissolve },
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
                    vec3 outward = normalize(${inputs.pos} - ${vec3(bboxCenter)} + vec3(1e-5));
                    vec3 dir = normalize(outward + hashDir(${inputs.idx}) * ${c(CONFIG.SCATTER_JITTER_AMOUNT)});

                    float scatter = ${inputs.dissolve};
                    float energy = 0.45 + hash1(${inputs.idx}) * 1.05;
                    float curve  = pow(scatter, 0.7);

                    ${outputs.newCenter} = ${inputs.pos} + dir * curve * energy * ${c(bboxRadius * CONFIG.SCATTER_RADIAL_MULT)};
                    ${outputs.amt}       = scatter;
                    ${outputs.shrink}    = mix(1.0, ${c(CONFIG.SHRINK_AT_FULL_SCATTER)}, clamp(scatter, 0.0, 1.0));
                `)]
            }).outputs;

            const fadedRgba = new dyno.Dyno({
                inTypes:  { c: 'vec4', amt: 'float' },
                outTypes: { c: 'vec4' },
                inputs:   { c: rgba, amt: dust.amt },
                statements: ({ inputs, outputs }) => [
                    `float aMul = 1.0 - clamp(${inputs.amt} * ${c(CONFIG.ALPHA_FADE_AT_FULL)}, 0.0, 0.85);`,
                    `${outputs.c} = vec4(${inputs.c}.rgb, ${inputs.c}.a * aMul);`
                ]
            }).outputs.c;

            return {
                gsplat: dyno.combineGsplat({
                    gsplat,
                    center: dust.newCenter,
                    scales: dyno.mul(scales, dust.shrink),
                    rgba:   fadedRgba
                })
            };
        }
    );
}
