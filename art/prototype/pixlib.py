"""Tiny pixel-art helper for GlobalCity building prototypes in the Micropolis (SimCity Classic) style.

Rules of the house style (see ref/_reference_3x.png):
- Only the 14 palette colours below. No anti-aliasing, no gradients except 1px dithers.
- Oblique top-down view, light from the top-left: roofs are LIGHT/MID grey (or a colour), the visible
  front (south) wall is DARK, the east side is DARK or BLACK, and a 1-2px BLACK shadow falls to the
  bottom-right. Windows are tiny 1px dots/rows (BLACK on light walls, WHITE/YELLOW on dark walls).
- A building sits on a footprint of 3x3 (48x48 px) or 4x4 (64x64 px) tiles, ground = speckled DIRT or
  dithered GRASS, usually framed by a 1px border in its zone colour (see `border`).
- Small accent colours (RED, YELLOW, ORANGE, BLUE) for signs, lights, details. Use them sparingly.
"""
from PIL import Image, ImageDraw
import hashlib, json, os

BLACK = (0x00, 0x00, 0x00); DARK = (0x3f, 0x3f, 0x3f); MID = (0x7f, 0x7f, 0x7f); LIGHT = (0xbf, 0xbf, 0xbf)
WHITE = (0xff, 0xff, 0xff); DIRT = (0xcc, 0x7f, 0x66); SAND = (0x99, 0x7f, 0x4c); GRASS = (0x00, 0xe6, 0x00)
FOREST = (0x00, 0x7f, 0x00); WATER = (0x66, 0x66, 0xe6); BLUE = (0x00, 0x00, 0xe6); RED = (0xff, 0x00, 0x00)
YELLOW = (0xff, 0xff, 0x00); ORANGE = (0xff, 0x7f, 0x00)
PALETTE = [BLACK, DARK, MID, LIGHT, WHITE, DIRT, SAND, GRASS, FOREST, WATER, BLUE, RED, YELLOW, ORANGE]

# zone border colours used by the originals
BORDER = {'res': FOREST, 'com': WATER, 'ind': YELLOW, 'civic': BLUE, 'fire': RED, 'power': YELLOW, 'park': FOREST, 'none': None}

def canvas(tiles: int, ground: str = 'dirt', seed: str = '') -> Image.Image:
    """New size*16 square image with speckled dirt, dithered grass, sand or water ground."""
    n = tiles * 16
    im = Image.new('RGB', (n, n), DIRT)
    px = im.load()
    h = hashlib.md5(seed.encode()).digest()
    for y in range(n):
        for x in range(n):
            r = (x * 73856093 ^ y * 19349663 ^ h[0] * 83492791) & 0xffff
            if ground == 'dirt':
                if r % 37 == 0: px[x, y] = DARK
                elif r % 53 == 0: px[x, y] = SAND
            elif ground == 'grass':
                px[x, y] = FOREST if (x + y) % 2 == 0 and r % 3 == 0 else GRASS
            elif ground == 'sand':
                px[x, y] = SAND if r % 4 else DIRT
            elif ground == 'water':
                px[x, y] = BLUE if r % 11 == 0 else WATER
    return im

def border(im: Image.Image, kind: str) -> None:
    c = BORDER.get(kind)
    if c: ImageDraw.Draw(im).rectangle([0, 0, im.width - 1, im.height - 1], outline=c)

def rect(im, x0, y0, x1, y1, fill, outline=None):
    ImageDraw.Draw(im).rectangle([x0, y0, x1, y1], fill=fill, outline=outline)

def px(im, x, y, c):
    if 0 <= x < im.width and 0 <= y < im.height: im.putpixel((x, y), c)

def line(im, pts, c, width=1):
    ImageDraw.Draw(im).line(pts, fill=c, width=width)

def ellipse(im, x0, y0, x1, y1, fill, outline=None):
    ImageDraw.Draw(im).ellipse([x0, y0, x1, y1], fill=fill, outline=outline)

def poly(im, pts, fill, outline=None):
    ImageDraw.Draw(im).polygon(pts, fill=fill, outline=outline)

def box(im, x, y, w, d, h, roof=LIGHT, wall=DARK, side=BLACK, shadow=True, windows=None):
    """Oblique block: roof rectangle (w x d) at (x, y), a south wall h px tall below it, an east side
    strip, and a black drop shadow to the bottom-right. windows: None | 'dark' | 'light'."""
    if shadow:
        rect(im, x + 2, y + d + h, x + w + 1, y + d + h + 1, BLACK)
        rect(im, x + w, y + 2, x + w + 1, y + d + h + 1, BLACK)
    rect(im, x, y + d, x + w - 1, y + d + h - 1, wall)            # south wall
    rect(im, x + w - 1, y + 1, x + w - 1, y + d + h - 1, side)    # east edge
    rect(im, x, y, x + w - 2, y + d - 1, roof)                    # roof
    line(im, [(x, y), (x + w - 2, y)], WHITE)                     # lit roof edge
    line(im, [(x, y), (x, y + d - 1)], WHITE)
    if windows and h >= 3:
        wc = YELLOW if windows == 'dark' else BLACK
        for wx in range(x + 2, x + w - 2, 3):
            for wy in range(y + d + 1, y + d + h - 1, 2): px(im, wx, wy, wc)

def save(im: Image.Image, slug: str, name: str, idea: str, group: str, zone: str = 'none'):
    """Save native PNG + 4x preview and append metadata (name, footprint, gameplay idea)."""
    out = os.path.join(os.path.dirname(__file__), group)
    os.makedirs(out, exist_ok=True)
    bad = {c for c in im.getdata() if c not in PALETTE}
    assert not bad, f'{slug}: off-palette colours {list(bad)[:5]}'
    im.save(os.path.join(out, f'{slug}.png'))
    im.resize((im.width * 4, im.height * 4), Image.NEAREST).save(os.path.join(out, f'{slug}@4x.png'))
    meta_path = os.path.join(out, 'meta.json')
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    meta[slug] = {'name': name, 'tiles': im.width // 16, 'zone': zone, 'idea': idea}
    json.dump(meta, open(meta_path, 'w'), indent=2)

if __name__ == '__main__':
    im = canvas(3, 'dirt', 'demo'); border(im, 'civic')
    box(im, 8, 6, 30, 16, 12, windows='dark')
    save(im, 'demo', 'Demo block', 'helper smoke test', '_demo', 'civic')
    print('ok')
