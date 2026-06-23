/**
 * .qsplat.gz loader — fetch + gzip-decompress + dequantise to standard .splat bytes.
 *
 * Mirror of convert_ply.py's encoder. Byte layout:
 *   header (44 B): magic | version | count | bbox(min,max) | log-scale(min,max)
 *   body  (17 B): pos uint16x3 | scale uint8x3 | rgba uint8x4 | rot uint8x4
 * The decoder expands each splat to the standard .splat 32-byte layout
 * (float32 pos + float32 linear scale + uint8 rgba + uint8 rot).
 */

const MAGIC = 0x51535054;     // 'QSPT' little-endian
const SUPPORTED_VERSION = 1;
const HEADER_SIZE = 44;
const SRC_STRIDE = 17;
const DST_STRIDE = 32;

/**
 * @typedef {Object} QSplatHeader
 * @property {number} count
 * @property {{x:number,y:number,z:number}} bboxMin
 * @property {{x:number,y:number,z:number}} bboxMax
 * @property {number} lnScaleMin
 * @property {number} lnScaleMax
 */

/**
 * Fetch a .qsplat.gz URL and return the standard .splat byte payload.
 * @param {string} url
 * @returns {Promise<Uint8Array>}
 */
export async function fetchAndDecodeQSplat(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch ${url} failed: ${res.status}`);

    const ds = new DecompressionStream('gzip');
    const decompressed = res.body.pipeThrough(ds);
    const buffer = await new Response(decompressed).arrayBuffer();
    const raw = new Uint8Array(buffer);

    const header = parseHeader(raw);
    return dequantiseBody(raw, header);
}

/**
 * @param {Uint8Array} raw
 * @returns {QSplatHeader}
 */
function parseHeader(raw) {
    const dv = new DataView(raw.buffer, raw.byteOffset, HEADER_SIZE);
    const magic = dv.getUint32(0, true);
    if (magic !== MAGIC) throw new Error(`Bad magic: 0x${magic.toString(16)}`);
    const version = dv.getUint8(4);
    if (version !== SUPPORTED_VERSION) throw new Error(`Unsupported qsplat version ${version}`);

    return {
        count: dv.getUint32(8, true),
        bboxMin: { x: dv.getFloat32(12, true), y: dv.getFloat32(16, true), z: dv.getFloat32(20, true) },
        bboxMax: { x: dv.getFloat32(24, true), y: dv.getFloat32(28, true), z: dv.getFloat32(32, true) },
        lnScaleMin: dv.getFloat32(36, true),
        lnScaleMax: dv.getFloat32(40, true)
    };
}

/**
 * @param {Uint8Array} raw
 * @param {QSplatHeader} header
 * @returns {Uint8Array}
 */
function dequantiseBody(raw, header) {
    const { count, bboxMin, bboxMax, lnScaleMin, lnScaleMax } = header;
    const extX = bboxMax.x - bboxMin.x;
    const extY = bboxMax.y - bboxMin.y;
    const extZ = bboxMax.z - bboxMin.z;
    const lnExt = lnScaleMax - lnScaleMin;

    const out = new Uint8Array(count * DST_STRIDE);
    const outF32 = new Float32Array(out.buffer);

    // 17-byte stride means uint16 reads are unaligned for odd-indexed splats,
    // so we use DataView throughout (it handles unaligned reads).
    for (let i = 0; i < count; i++) {
        const srcOff = HEADER_SIZE + i * SRC_STRIDE;
        const dv = new DataView(raw.buffer, raw.byteOffset + srcOff, SRC_STRIDE);

        const xq  = dv.getUint16(0, true);
        const yq  = dv.getUint16(2, true);
        const zq  = dv.getUint16(4, true);
        const sxq = dv.getUint8(6);
        const syq = dv.getUint8(7);
        const szq = dv.getUint8(8);
        const r = dv.getUint8(9), g = dv.getUint8(10), b = dv.getUint8(11), a = dv.getUint8(12);
        const qw = dv.getUint8(13), qx = dv.getUint8(14), qy = dv.getUint8(15), qz = dv.getUint8(16);

        const dstF = (i * DST_STRIDE) >> 2;
        outF32[dstF + 0] = bboxMin.x + (xq / 65535) * extX;
        outF32[dstF + 1] = bboxMin.y + (yq / 65535) * extY;
        outF32[dstF + 2] = bboxMin.z + (zq / 65535) * extZ;
        outF32[dstF + 3] = Math.exp(lnScaleMin + (sxq / 255) * lnExt);
        outF32[dstF + 4] = Math.exp(lnScaleMin + (syq / 255) * lnExt);
        outF32[dstF + 5] = Math.exp(lnScaleMin + (szq / 255) * lnExt);

        const dstU8 = i * DST_STRIDE + 24;
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
