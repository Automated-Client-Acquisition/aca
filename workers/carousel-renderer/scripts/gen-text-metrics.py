#!/usr/bin/env python3
"""
Generate src/carousel-text-metrics.ts: per-character advance widths for the
vendored carousel fonts, so the layout engine can size text to its box without a
text-measuring runtime (Satori gives no way to ask how tall a text block will be).

Usage (from workers/carousel-renderer):  python3 scripts/gen-text-metrics.py
Requires Pillow. Re-run whenever a font in assets/fonts/ changes.
"""

import os
from PIL import ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', 'assets', 'fonts')
OUT = os.path.join(HERE, '..', 'src', 'carousel-text-metrics.ts')

# key used by the layout engine -> font file
KEYS = {
    'Inter-400': 'Inter-Regular.ttf',
    'Inter-500': 'Inter-Medium.ttf',
    'Inter-700': 'Inter-Bold.ttf',
    'Inter-800': 'Inter-ExtraBold.ttf',
    'Inter-900': 'Inter-Black.ttf',
    'InstrumentSerif-400': 'InstrumentSerif-Regular.ttf',
    'InstrumentSerif-400i': 'InstrumentSerif-Italic.ttf',
    'Anton-400': 'Anton-Regular.ttf',
    'Bricolage-700': 'BricolageGrotesque-Bold.ttf',
    'Bricolage-800': 'BricolageGrotesque-ExtraBold.ttf',
    'SpaceMono-400': 'SpaceMono-Regular.ttf',
    'SpaceMono-700': 'SpaceMono-Bold.ttf',
}

lines = [
    '/**',
    ' * GENERATED FILE - do not edit. Run: python3 scripts/gen-text-metrics.py',
    ' *',
    ' * Advance widths (1000 units per em) for ASCII 32..126 of each vendored carousel',
    ' * font, used by carousel-templates.ts to size and wrap text before rendering.',
    ' */',
    '',
    'export const TEXT_METRICS: Record<string, number[]> = {',
]

for key, fname in KEYS.items():
    font = ImageFont.truetype(os.path.join(FONTS, fname), 1000)
    widths = [round(font.getlength(chr(c))) for c in range(32, 127)]
    lines.append(f"  '{key}': [{','.join(str(w) for w in widths)}],")

lines.append('};')
lines.append('')
open(OUT, 'w').write('\n'.join(lines))
print('wrote', OUT)
