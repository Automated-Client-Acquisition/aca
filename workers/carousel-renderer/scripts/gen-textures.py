#!/usr/bin/env python3
"""
Generate the carousel texture assets (assets/grain.png, assets/halftone.png).

Textures are plain PNGs used as CSS background images. Never SVG filters: resvg
panics on filter regions that collapse (see sanitizeSvg in carousel-slide-renderer.ts).

Usage (from workers/carousel-renderer):  python3 scripts/gen-textures.py
Requires Pillow and numpy. The output is committed; re-run only to change the look.
"""

import os
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, '..', 'assets')
os.makedirs(ASSETS, exist_ok=True)

# ---- film grain: a tileable RGBA noise (white and black specks, random alpha) ----
rng = np.random.default_rng(20260929)
N = 256
speck = rng.integers(0, 2, (N, N)) * 255              # black or white speck
alpha = (rng.random((N, N)) ** 1.6) * 255 * 0.85      # most specks faint, a few strong
grain = np.dstack([speck, speck, speck, alpha]).astype(np.uint8)
Image.fromarray(grain, 'RGBA').save(os.path.join(ASSETS, 'grain.png'), optimize=True)

# ---- halftone: white dots, largest at the bottom right, fading out toward the top left ----
W, H, SS = 1080, 1350, 2
img = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
pitch = 26 * SS
angle = np.deg2rad(45)
cosa, sina = np.cos(angle), np.sin(angle)
diag = np.hypot(W * SS, H * SS)
for gy in range(-40, int(diag / pitch) + 40):
    for gx in range(-40, int(diag / pitch) + 40):
        # rotated grid position
        x = gx * pitch * cosa - gy * pitch * sina + W * SS * 0.5
        y = gx * pitch * sina + gy * pitch * cosa + H * SS * 0.5
        if not (-pitch < x < W * SS + pitch and -pitch < y < H * SS + pitch):
            continue
        # 0 at the top left, 1 at the bottom right
        t = (x / (W * SS) * 0.45 + y / (H * SS) * 0.55)
        f = max(0.0, (t - 0.32) / 0.68) ** 1.25
        r = pitch * 0.5 * f * 1.05
        if r < 0.8 * SS:
            continue
        d.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255, 255))
img = img.resize((W, H), Image.LANCZOS)
img.save(os.path.join(ASSETS, 'halftone.png'), optimize=True)

for name in ('grain.png', 'halftone.png'):
    p = os.path.join(ASSETS, name)
    print(name, os.path.getsize(p) // 1024, 'KB')
