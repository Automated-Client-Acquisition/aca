#!/usr/bin/env python3
"""
Assemble contact sheets from the PNGs test-render.js wrote, and report dead zones.

  python3 scripts/make-sheets.py <render dir> [--width 360] [--out <sheet dir>]

One sheet per (deck, aspect, brand): a row per theme, a column per slide, each
slide scaled to --width px (360 = roughly how a phone shows it). Also writes
deadzones.txt: for every slide, the tallest band with no content between the
header and the footer, as a % of the slide height (the target is 25% or less).
"""

import json
import os
import sys
from collections import defaultdict

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


def arg(name, default):
    if f'--{name}' in sys.argv:
        return sys.argv[sys.argv.index(f'--{name}') + 1]
    return default


SRC = sys.argv[1]
WIDTH = int(arg('width', '360'))
OUT = arg('out', os.path.join(SRC, 'sheets'))
os.makedirs(OUT, exist_ok=True)

manifest = json.load(open(os.path.join(SRC, 'manifest.json')))
try:
    FONT = ImageFont.load_default(size=18)
except TypeError:
    FONT = ImageFont.load_default()


def dead_zone(img):
    """Tallest run of content-free rows between header and footer, as a fraction of height."""
    g = np.asarray(img.convert('L').resize((img.width // 4, img.height // 4), Image.LANCZOS), dtype=np.float32)
    blur = np.asarray(Image.fromarray(g.astype(np.uint8)).filter(ImageFilter.GaussianBlur(3)), dtype=np.float32)
    detail = np.abs(g - blur)                    # texture-free measure of edges and shapes
    coarse = np.abs(np.asarray(Image.fromarray(g.astype(np.uint8)).filter(ImageFilter.GaussianBlur(9)), dtype=np.float32) - np.asarray(Image.fromarray(g.astype(np.uint8)).filter(ImageFilter.GaussianBlur(24)), dtype=np.float32))
    energy = detail.mean(axis=1) + coarse.mean(axis=1)
    base = np.percentile(energy, 15)
    active = energy > base + 1.1
    h = len(active)
    lo, hi = int(h * 0.15), int(h * 0.90)        # skip the header and the footer bands
    best = run = 0
    for v in active[lo:hi]:
        run = 0 if v else run + 1
        best = max(best, run)
    return best / h


groups = defaultdict(list)
for m in manifest:
    groups[(m['deck'], m['aspect'], m['brand'])].append(m)

report = []
for (deck, aspect, brand), items in sorted(groups.items()):
    themes = sorted({i['theme'] for i in items}, key=lambda t: [x['theme'] for x in items].index(t))
    cols = max(i['n'] for i in items) if deck != 'cta-keyword' else max(i['n'] for i in items)
    sample = Image.open(os.path.join(SRC, items[0]['file']))
    cell_w = WIDTH
    cell_h = round(sample.height * WIDTH / sample.width)
    label_w = 110
    pad = 8
    sheet = Image.new('RGB', (label_w + cols * (cell_w + pad) + pad, len(themes) * (cell_h + pad) + pad), (236, 236, 236))
    draw = ImageDraw.Draw(sheet)
    for r, theme in enumerate(themes):
        y = pad + r * (cell_h + pad)
        draw.text((10, y + 8), theme, fill=(20, 20, 20), font=FONT)
        for it in [i for i in items if i['theme'] == theme]:
            img = Image.open(os.path.join(SRC, it['file'])).convert('RGB')
            dz = dead_zone(img)
            report.append((dz, it['file']))
            x = label_w + (it['n'] - 1) * (cell_w + pad) + pad
            sheet.paste(img.resize((cell_w, cell_h), Image.LANCZOS), (x, y))
    name = f'{deck}__{aspect}__{brand}.png'
    sheet.save(os.path.join(OUT, name))
    print('sheet', name, sheet.size)

report.sort(reverse=True)
with open(os.path.join(OUT, 'deadzones.txt'), 'w') as f:
    for dz, file in report:
        f.write(f'{dz * 100:5.1f}%  {file}\n')
over = [r for r in report if r[0] > 0.25]
print(f'dead zones: worst {report[0][0] * 100:.1f}% ({report[0][1]}); {len(over)} of {len(report)} slides over 25%')
