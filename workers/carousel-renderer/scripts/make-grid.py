#!/usr/bin/env python3
"""
Lay out an arbitrary set of rendered slides in a grid (one row per --cols).

  python3 scripts/make-grid.py --out grid.png --cols 3 --width 360 a.png b.png ...

Each image is labelled with the part of its file name after the deck id.
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFont


def arg(name, default):
    if f'--{name}' in sys.argv:
        return sys.argv[sys.argv.index(f'--{name}') + 1]
    return default


OUT = arg('out', 'grid.png')
COLS = int(arg('cols', '3'))
WIDTH = int(arg('width', '360'))
files = []
skip = False
for i, a in enumerate(sys.argv[1:], start=1):
    if skip:
        skip = False
        continue
    if a.startswith('--'):
        skip = True
        continue
    files.append(a)

try:
    FONT = ImageFont.load_default(size=16)
except TypeError:
    FONT = ImageFont.load_default()

imgs = [Image.open(f).convert('RGB') for f in files]
ratio = imgs[0].height / imgs[0].width
cell_h = round(WIDTH * ratio)
rows = (len(imgs) + COLS - 1) // COLS
pad, label = 8, 22
sheet = Image.new('RGB', (COLS * (WIDTH + pad) + pad, rows * (cell_h + label + pad) + pad), (236, 236, 236))
d = ImageDraw.Draw(sheet)
for i, (f, img) in enumerate(zip(files, imgs)):
    r, c = divmod(i, COLS)
    x, y = pad + c * (WIDTH + pad), pad + r * (cell_h + label + pad)
    d.text((x + 2, y + 2), '__'.join(os.path.basename(f).replace('.png', '').split('__')[:2])[:44], fill=(30, 30, 30), font=FONT)
    sheet.paste(img.resize((WIDTH, round(WIDTH * img.height / img.width)), Image.LANCZOS), (x, y + label))
sheet.save(OUT)
print('wrote', OUT, sheet.size)
