#!/usr/bin/env python3
"""
Convert an INRIA-style 3DGS PLY to a quantised + gzipped custom format
(.qsplat.gz).

Why not just .splat? .splat is the antimatter15 32-byte fixed-stride layout —
positions and scales are float32, which is overkill for browser viewing. We
ship a smaller representation and dequantise back to .splat in JS.

──────────────────── PLY layout (per vertex, all float32) ────────────────────
    x, y, z
    scale_0, scale_1, scale_2          (log-space)
    f_dc_0, f_dc_1, f_dc_2             (SH base term — used for color at deg 0)
    opacity                            (logit-space)
    rot_0, rot_1, rot_2, rot_3         (quaternion w x y z)
    f_rest_0..f_rest_44                (higher-order SH — IGNORED)

──────────────────── .qsplat.gz layout ────────────────────────────────────────

    HEADER (44 bytes, little-endian, packed):
        u32   magic            = 0x51535054   ('QSPT')
        u8    version          = 1
        u8    reserved[3]
        u32   splat_count
        f32   bbox_min_x, bbox_min_y, bbox_min_z
        f32   bbox_max_x, bbox_max_y, bbox_max_z
        f32   ln_scale_min, ln_scale_max

    BODY (17 bytes per splat, packed, splat_count * 17 bytes total):
        u16   x_q                       (x mapped 0..65535 over bbox x range)
        u16   y_q                       ( …same…                 y range)
        u16   z_q                       ( …same…                 z range)
        u8    sx_q                      (scale_0 mapped 0..255 over ln_scale range, EXP applied in JS)
        u8    sy_q
        u8    sz_q
        u8    r, g, b                   (rgb = 0.5 + C0 * f_dc_*, clipped, *255)
        u8    a                         (sigmoid(opacity) * 255)
        u8    qw, qx, qy, qz            (quaternion normalised then *128 + 128)

    The whole thing is then gzip-compressed (level 9). Position quantisation
    correlates spatially adjacent splats, which gzip compresses well — typical
    ratio is another ~25-35% on top of quantisation alone.

──────────────────── Resulting size ──────────────────────────────────────────

    Standard .splat:    32 bytes/splat
    Our quantised:      17 bytes/splat
    After gzip -9:      ~10-12 bytes/splat (depends on scene structure)

    For the cypress (1.23M splats):  37.7 MB .splat → ~14 MB .qsplat.gz
    For the dandelion (346k splats): 10.6 MB .splat → ~3.5 MB .qsplat.gz

Requires:  pip install numpy plyfile
Usage:     python convert_ply.py
"""

import gzip
import os
import struct
import sys
import numpy as np
from plyfile import PlyData

# Standard SH-base coefficient — INRIA gsplat encodes RGB as (0.5 + C0 * f_dc_*).
SH_C0 = 0.28209479177387814

QSPLAT_MAGIC = 0x51535054  # 'QSPT' (little-endian on disk)
QSPLAT_VERSION = 1
HEADER_SIZE = 44
BYTES_PER_SPLAT = 17


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def convert_ply_to_qsplat_gz(input_path, output_path):
    print(f"Loading PLY: {input_path}")
    plydata = PlyData.read(input_path)
    v = plydata['vertex']
    n = len(v)
    print(f"Splats: {n:,}")

    # ─── Read raw fields into numpy arrays ───
    xyz = np.stack([v['x'], v['y'], v['z']], axis=1).astype(np.float32)
    log_scale = np.stack([v['scale_0'], v['scale_1'], v['scale_2']], axis=1).astype(np.float32)
    f_dc = np.stack([v['f_dc_0'], v['f_dc_1'], v['f_dc_2']], axis=1).astype(np.float32)
    opacity = v['opacity'].astype(np.float32)
    rot = np.stack([v['rot_0'], v['rot_1'], v['rot_2'], v['rot_3']], axis=1).astype(np.float32)

    # ─── Per-axis bbox; per-file log-scale range ───
    bbox_min = xyz.min(axis=0)
    bbox_max = xyz.max(axis=0)
    # Avoid /0 on perfectly axis-aligned scenes.
    bbox_extent = np.where(bbox_max - bbox_min > 1e-9, bbox_max - bbox_min, 1.0)

    ln_scale_min = float(log_scale.min())
    ln_scale_max = float(log_scale.max())
    ln_scale_extent = max(ln_scale_max - ln_scale_min, 1e-9)

    # ─── Quantise ───
    # Position: 16-bit per axis over bbox.
    xyz_norm = (xyz - bbox_min) / bbox_extent
    xyz_q = np.clip(xyz_norm * 65535.0 + 0.5, 0, 65535).astype(np.uint16)

    # Scale: 8-bit per component over file-wide log-range.
    scale_norm = (log_scale - ln_scale_min) / ln_scale_extent
    scale_q = np.clip(scale_norm * 255.0 + 0.5, 0, 255).astype(np.uint8)

    # RGB: standard SH-base → 0..1 → uint8.
    rgb = 0.5 + SH_C0 * f_dc
    rgb_q = np.clip(rgb * 255.0 + 0.5, 0, 255).astype(np.uint8)

    # Alpha: sigmoid(opacity) → uint8.
    alpha_q = np.clip(sigmoid(opacity) * 255.0 + 0.5, 0, 255).astype(np.uint8)

    # Rotation: normalise quaternion, map [-1,1] → uint8.
    norm = np.linalg.norm(rot, axis=1, keepdims=True)
    rot_n = rot / np.where(norm > 0, norm, 1.0)
    rot_q = np.clip(rot_n * 128.0 + 128.0 + 0.5, 0, 255).astype(np.uint8)

    # ─── Pack body: 17 bytes per splat, no padding ───
    # Layout: 6 bytes pos | 3 bytes scale | 3 bytes rgb | 1 byte alpha | 4 bytes rot
    body = np.empty((n, BYTES_PER_SPLAT), dtype=np.uint8)
    # Position (3 x uint16, little-endian).
    body[:, 0:6] = xyz_q.view(np.uint8).reshape(n, 6)
    # Scales.
    body[:, 6:9] = scale_q
    # RGB.
    body[:, 9:12] = rgb_q
    # Alpha.
    body[:, 12] = alpha_q
    # Rotation.
    body[:, 13:17] = rot_q

    # ─── Header ───
    header = struct.pack(
        '<I B 3x I 3f 3f 2f',
        QSPLAT_MAGIC,
        QSPLAT_VERSION,
        n,
        bbox_min[0], bbox_min[1], bbox_min[2],
        bbox_max[0], bbox_max[1], bbox_max[2],
        ln_scale_min, ln_scale_max,
    )
    assert len(header) == HEADER_SIZE, f"Header size mismatch: {len(header)} != {HEADER_SIZE}"

    # ─── Concat + gzip ───
    raw = header + body.tobytes()
    print(f"Quantised raw size: {len(raw) / 1024 / 1024:.2f} MB")

    print(f"Gzipping (level 9) -> {output_path}")
    # mtime=0 makes the gzip output deterministic so re-running gives the
    # same bytes (helps with caching/ETag).
    with open(output_path, 'wb') as f_out:
        with gzip.GzipFile(fileobj=f_out, mode='wb', compresslevel=9, mtime=0) as gz:
            gz.write(raw)

    in_mb = os.path.getsize(input_path) / 1024 / 1024
    out_mb = os.path.getsize(output_path) / 1024 / 1024
    print(f"PLY:        {in_mb:7.2f} MB")
    print(f"qsplat.gz:  {out_mb:7.2f} MB  ({100 * out_mb / in_mb:.1f}% of PLY)")


if __name__ == "__main__":
    targets = [
        ("assets/ply/SawaraCypress.ply", "assets/ply/SawaraCypress.qsplat.gz"),
        ("assets/ply/dandelion.ply",     "assets/ply/dandelion.qsplat.gz"),
    ]
    for src, dst in targets:
        if not os.path.exists(src):
            print(f"Skipping (missing): {src}", file=sys.stderr)
            continue
        convert_ply_to_qsplat_gz(src, dst)
        print()
