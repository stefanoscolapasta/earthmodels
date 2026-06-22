#!/usr/bin/env python3
"""
Convert an INRIA-style 3DGS PLY to the antimatter15 .splat format.

PLY layout we expect (per vertex, all float32):
    x, y, z
    scale_0, scale_1, scale_2          (log-space)
    f_dc_0, f_dc_1, f_dc_2             (SH base term, used for color at degree 0)
    opacity                            (logit-space)
    rot_0, rot_1, rot_2, rot_3         (quaternion, w x y z)
    f_rest_0..f_rest_44                (higher-order SH, ignored)

.splat layout (per splat, 32 bytes, little-endian):
    position : 3 x float32   (12 B)
    scale    : 3 x float32   (12 B, linear, = exp(log_scale))
    color    : 4 x uint8     (4 B, RGBA — alpha is sigmoid(opacity))
    rotation : 4 x uint8     (4 B, quaternion normalized then mapped [-1,1] -> [0,255])

This keeps every splat in the source file at ~30% of the PLY size and parses
about an order of magnitude faster than the PLY path.

Requires: pip install numpy plyfile
"""

import os
import sys
import numpy as np
from plyfile import PlyData

SH_C0 = 0.28209479177387814   # 1 / (2 * sqrt(pi)) — base SH coefficient


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def convert_ply_to_splat(input_path, output_path):
    print(f"Loading PLY: {input_path}")
    plydata = PlyData.read(input_path)
    v = plydata['vertex']
    n = len(v)
    print(f"Splats: {n:,}")

    out = np.empty((n, 32), dtype=np.uint8)
    buf = out.view()

    # 0..11: position (xyz)
    pos = np.stack([v['x'], v['y'], v['z']], axis=1).astype(np.float32)
    buf[:, 0:12] = pos.view(np.uint8).reshape(n, 12)

    # 12..23: scale (linear)
    scale = np.exp(np.stack([v['scale_0'], v['scale_1'], v['scale_2']], axis=1).astype(np.float32))
    buf[:, 12:24] = scale.view(np.uint8).reshape(n, 12)

    # 24..27: color RGBA (uint8)
    rgb = 0.5 + SH_C0 * np.stack([v['f_dc_0'], v['f_dc_1'], v['f_dc_2']], axis=1)
    rgb = np.clip(rgb * 255.0, 0, 255).astype(np.uint8)
    alpha = np.clip(sigmoid(v['opacity'].astype(np.float32)) * 255.0, 0, 255).astype(np.uint8)
    buf[:, 24:27] = rgb
    buf[:, 27]    = alpha

    # 28..31: rotation (uint8 quaternion)
    rot = np.stack([v['rot_0'], v['rot_1'], v['rot_2'], v['rot_3']], axis=1).astype(np.float32)
    norm = np.linalg.norm(rot, axis=1, keepdims=True)
    norm = np.where(norm > 0, norm, 1.0)
    rot = rot / norm
    rot_q = np.clip(rot * 128.0 + 128.0, 0, 255).astype(np.uint8)
    buf[:, 28:32] = rot_q

    print(f"Writing: {output_path}")
    with open(output_path, 'wb') as f:
        f.write(out.tobytes())

    in_mb = os.path.getsize(input_path) / (1024 * 1024)
    out_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"PLY:   {in_mb:7.2f} MB")
    print(f"Splat: {out_mb:7.2f} MB  ({100 * out_mb / in_mb:.1f}% of PLY, {n:,} splats kept)")


if __name__ == "__main__":
    if len(sys.argv) >= 3:
        targets = [(sys.argv[1], sys.argv[2])]
    else:
        targets = [
            ("assets/ply/Sawara Cypress (Chamaecyparis pisifera)/scene.ply",
             "assets/ply/Sawara Cypress (Chamaecyparis pisifera)/scene_web.splat"),
            ("assets/ply/Dandelion on lawn/scene.ply",
             "assets/ply/Dandelion on lawn/scene_web.splat"),
        ]

    for src, dst in targets:
        if not os.path.exists(src):
            print(f"Skipping (missing): {src}", file=sys.stderr)
            continue
        convert_ply_to_splat(src, dst)
        print()
