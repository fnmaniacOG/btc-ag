#!/usr/bin/env python3
"""
Regenerate the social card at public/og.png.

    pip install pillow && python3 scripts/make-og.py

Deliberately a build-time script rather than a `next/og` route: the card's
content never changes, social scrapers cache it, and generating it at runtime
would drag satori + resvg WASM into the serverless bundle for no benefit.
"""

import glob
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1200, 630
BLACK = (5, 5, 5)
ORANGE = (247, 147, 26)
WHITE = (240, 240, 242)
GREY = (160, 160, 166)
DIM = (112, 112, 118)

VENUES = [
    'UniSat', 'Magisat', 'Satflow', 'Gamma', 'Ordinals Wallet',
    'ORD.NET', 'Odin.fun', 'wecsats', 'Nexus',
]

FONT_CANDIDATES = {
    'bold': ['/usr/share/fonts/**/Lato-Bold.ttf', '/usr/share/fonts/**/DejaVuSans-Bold.ttf',
             '/System/Library/Fonts/Helvetica.ttc'],
    'regular': ['/usr/share/fonts/**/Lato-Regular.ttf', '/usr/share/fonts/**/DejaVuSans.ttf',
                '/System/Library/Fonts/Helvetica.ttc'],
}


def load(kind: str, size: int):
    for pattern in FONT_CANDIDATES[kind]:
        for path in glob.glob(pattern, recursive=True):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def main() -> None:
    bold = load('bold', 118)
    reg40 = load('regular', 40)
    reg26 = load('regular', 26)
    reg22 = load('regular', 22)

    # Glow lives on its own layer so it can be blurred without softening text.
    glow = Image.new('RGB', (W, H), BLACK)
    gd = ImageDraw.Draw(glow, 'RGBA')
    for r in range(760, 0, -10):
        gd.ellipse([60 - r, -260 - r, 60 + r, -260 + r],
                   fill=(*ORANGE, int(30 * (1 - r / 760) ** 1.5)))
    for r in range(520, 0, -10):
        gd.ellipse([1150 - r, -120 - r, 1150 + r, -120 + r],
                   fill=(*ORANGE, int(14 * (1 - r / 520) ** 1.6)))

    img = glow.filter(ImageFilter.GaussianBlur(46))
    d = ImageDraw.Draw(img, 'RGBA')

    d.text((80, 148), 'btc', font=bold, fill=ORANGE)
    d.text((80 + d.textlength('btc', font=bold), 148), '.ag', font=bold, fill=WHITE)

    d.text((80, 302), 'Nine Bitcoin marketplaces. One order book.', font=reg40, fill=GREY)
    d.text((80, 364), 'Ordinals · Runes · Rare Sats — aggregated, deduplicated, live on-chain',
           font=reg26, fill=DIM)

    cx, cy = 80, 454
    for v in VENUES:
        bw = d.textlength(v, font=reg22) + 28
        if cx + bw > W - 80:
            cx, cy = 80, cy + 52
        d.rounded_rectangle([cx, cy, cx + bw, cy + 42], radius=9,
                            outline=(*ORANGE, 105), width=1)
        d.text((cx + 14, cy + 9), v, font=reg22, fill=ORANGE)
        cx += bw + 12

    out = os.path.join(os.path.dirname(__file__), '..', 'public', 'og.png')
    img.save(out, 'PNG', optimize=True)
    print(f'wrote {os.path.normpath(out)} ({W}x{H})')


if __name__ == '__main__':
    main()
