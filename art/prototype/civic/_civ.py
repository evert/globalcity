"""Shared drawing helpers for the civic group (built on pixlib).

Conventions taken from the Micropolis originals (coal, hospital, church, nuclear):
- Oblique view from the south-west: a building is a roof polygon raised `h` px; its walls extrude
  down-left (skew=1, 45 deg) or straight down (skew=0). West wall = lit (LIGHT/WHITE),
  south wall = shaded (MID/DARK), roof varies.
- Shadows fall to the east/south-east and are drawn by *darkening the ground*: dirt->SAND,
  grass->FOREST, pavement->DARK (the originals do this rather than flat black).
"""
import os, sys, hashlib
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from pixlib import *  # noqa
from PIL import Image, ImageDraw

SHADE = {DIRT: SAND, SAND: DARK, GRASS: FOREST, FOREST: DARK, MID: DARK, LIGHT: MID, WHITE: LIGHT,
         DARK: BLACK, WATER: BLUE, BLUE: DARK, YELLOW: SAND, ORANGE: SAND, RED: DARK, BLACK: BLACK}

def rnd(x, y, s):
    return int.from_bytes(hashlib.md5(f'{s}:{x}:{y}'.encode()).digest()[:4], 'little')

def ground(tiles, kind='dirt', seed='', grass_specks=True):
    """Ground like the originals: dirt with DARK/SAND/GRASS specks, or grass with FOREST/DIRT specks."""
    n = tiles * 16
    im = Image.new('RGB', (n, n), DIRT if kind == 'dirt' else GRASS)
    for y in range(n):
        for x in range(n):
            r = rnd(x, y, seed) % 1000
            if kind == 'dirt':
                if r < 18: im.putpixel((x, y), DARK)
                elif r < 34: im.putpixel((x, y), SAND)
                elif grass_specks and r < 44: im.putpixel((x, y), GRASS)
            else:
                if r < 45: im.putpixel((x, y), FOREST)
                elif r < 52: im.putpixel((x, y), DIRT)
    return im

def shade_mask(im, mask):
    """Darken every pixel where mask (L image) is set."""
    p = im.load(); m = mask.load()
    for y in range(im.height):
        for x in range(im.width):
            if m[x, y]: p[x, y] = SHADE.get(p[x, y], DARK)

def shade_poly(im, pts):
    m = Image.new('L', im.size, 0); ImageDraw.Draw(m).polygon(pts, fill=255, outline=255); shade_mask(im, m)

def shade_rect(im, x0, y0, x1, y1):
    m = Image.new('L', im.size, 0); ImageDraw.Draw(m).rectangle([x0, y0, x1, y1], fill=255); shade_mask(im, m)

def block_pts(x, y, w, d, h, skew=1):
    """Outline points of a block's silhouette (roof + walls)."""
    o = h * skew
    return [(x, y), (x + w - 1, y), (x + w - 1, y + d - 1), (x + w - 1 - o, y + d - 1 + h),
            (x - o, y + d - 1 + h), (x - o, y + h)]

def block(im, x, y, w, d, h, roof=MID, west=LIGHT, south=DARK, skew=1, sh=(3, 2), edge=True,
          base_line=BLACK):
    """Raised block. (x,y) = roof top-left, w x d roof, h px tall walls extruding down-left by skew."""
    o = h * skew
    if sh:
        sx, sy = sh
        pts = block_pts(x, y, w, d, h, skew)
        shade_poly(im, [(a + sx, b + sy) for a, b in pts])
    if skew and h:
        poly(im, [(x, y), (x, y + d - 1), (x - o, y + d - 1 + h), (x - o, y + h)], west)
    if h:
        poly(im, [(x, y + d - 1), (x + w - 1, y + d - 1), (x + w - 1 - o, y + d - 1 + h), (x - o, y + d - 1 + h)], south)
        if base_line:
            line(im, [(x - o, y + d - 1 + h), (x + w - 1 - o, y + d - 1 + h)], base_line)
    rect(im, x, y, x + w - 1, y + d - 1, roof)
    if edge:
        line(im, [(x, y), (x + w - 1, y)], WHITE if roof != WHITE else LIGHT)
        line(im, [(x, y), (x, y + d - 1)], WHITE if roof != WHITE else LIGHT)
        line(im, [(x + w - 1, y + 1), (x + w - 1, y + d - 1)], DARK if roof not in (DARK, BLACK) else BLACK)

def south_px(x, y, w, d, h, skew, u, v):
    """Pixel on the south face: u along width (0..w-1), v down the height (0..h-1)."""
    return (x + u - v * skew, y + d + v)

def west_px(x, y, w, d, h, skew, u, v):
    """Pixel on the west face: u along depth (0..d-1), v outward (1..h)."""
    return (x - v * skew, y + u + v)

def south_windows(im, x, y, w, d, h, skew=1, c=BLACK, sp=3, rows=None, start=2, vstep=2, v0=1):
    rows = rows if rows is not None else range(v0, h - 1, vstep)
    for v in rows:
        for u in range(start, w - 2, sp):
            px(im, *south_px(x, y, w, d, h, skew, u, v), c)

def west_windows(im, x, y, w, d, h, skew=1, c=MID, sp=3, cols=None, start=2):
    cols = cols if cols is not None else range(2, h, 2)
    for v in cols:
        for u in range(start, d - 1, sp):
            px(im, *west_px(x, y, w, d, h, skew, u, v), c)

def tree(im, x, y, big=False):
    """Little round tree: FOREST crown, lit GRASS top-left, BLACK lower-right rim + ground shadow."""
    if big:
        m = Image.new('L', im.size, 0); d = ImageDraw.Draw(m)
        d.rectangle([x + 2, y + 2, x + 4, y + 4], fill=255); shade_mask(im, m)
        rect(im, x, y + 1, x + 3, y + 2, FOREST); rect(im, x + 1, y, x + 2, y + 3, FOREST)
        px(im, x + 1, y + 1, GRASS); px(im, x + 1, y, GRASS)
        px(im, x + 3, y + 2, BLACK); px(im, x + 2, y + 3, BLACK)
    else:
        shade_rect(im, x + 1, y + 1, x + 2, y + 2)
        rect(im, x, y, x + 1, y + 1, FOREST); px(im, x, y, GRASS); px(im, x + 1, y + 1, BLACK)

def car(im, x, y, c=RED, vertical=False):
    if vertical:
        px(im, x, y, c); px(im, x, y + 1, c); px(im, x + 1, y + 1, BLACK)
    else:
        px(im, x, y, c); px(im, x + 1, y, c); px(im, x + 1, y + 1, BLACK)

def person(im, x, y, c=None):
    px(im, x, y, c or BLACK)

def flag(im, x, y, c=RED, h=5):
    """Flag pole with a 2x2 flag at the top and a 1px shadow."""
    line(im, [(x, y), (x, y + h)], WHITE)
    px(im, x + 1, y + h, BLACK)
    rect(im, x + 1, y, x + 2, y + 1, c)

def checker(im, x0, y0, x1, y1, a, b):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            px(im, x, y, a if (x + y) % 2 == 0 else b)

def dome(im, cx, cy, r, base=LIGHT, lit=WHITE, mid=MID, dark=DARK, outline=None, shadow=True):
    """Shaded hemisphere seen from above: lit top-left, dithered terminator, dark bottom-right."""
    if shadow:
        m = Image.new('L', im.size, 0)
        ImageDraw.Draw(m).ellipse([cx - r + 2, cy - r + 2, cx + r + 2, cy + r + 1], fill=255)
        shade_mask(im, m)
    for y in range(cy - r, cy + r + 1):
        for x in range(cx - r, cx + r + 1):
            dx, dy = x - cx, y - cy
            if dx * dx + dy * dy > r * r + r * 0.6: continue
            t = (dx + dy) / (2 * r)          # -1 top-left .. +1 bottom-right
            e = (dx * dx + dy * dy) / (r * r)
            if t < -0.35 and e < 0.75: c = lit
            elif t < 0.05: c = base
            elif t < 0.25: c = base if (x + y) % 2 else mid
            elif t < 0.45: c = mid
            elif t < 0.6: c = mid if (x + y) % 2 else dark
            else: c = dark
            px(im, x, y, c)
    if outline:
        ImageDraw.Draw(im).ellipse([cx - r, cy - r, cx + r, cy + r], outline=outline)

def pave(im, x0, y0, x1, y1, c=MID, edge=LIGHT):
    rect(im, x0, y0, x1, y1, c)
    if edge: line(im, [(x0, y0), (x1, y0)], edge); line(im, [(x0, y0), (x0, y1)], edge)

def road_stub(im, x0, y0, x1, y1):
    """Driveway leaving through the zone border, like the originals' road stubs."""
    rect(im, x0, y0, x1, y1, MID)

def cap(im, cx, cy, r, ry=None, base=LIGHT, lit=WHITE, mid=MID, dark=DARK):
    """Upper half of a dome seen from the front-above (sits on y=cy), lit from the top-left."""
    ry = ry or r
    for y in range(cy - ry, cy + 1):
        for x in range(cx - r, cx + r + 1):
            dx, dy = (x - cx) / r, (y - cy) / ry
            if dx * dx + dy * dy > 1.08: continue
            t = dx * 0.8 - dy * 0.15
            if dx < -0.25 and dy < -0.3 and dx * dx + dy * dy < 0.7: c = lit
            elif t < 0.1: c = base
            elif t < 0.3: c = base if (x + y) % 2 else mid
            elif t < 0.55: c = mid
            elif t < 0.7: c = mid if (x + y) % 2 else dark
            else: c = dark
            px(im, x, y, c)

def drum(im, cx, top, r, h, face=LIGHT, slit=DARK):
    """Cylinder face (rotunda drum) under a cap: lit left, shaded right, column slits."""
    for x in range(cx - r, cx + r + 1):
        t = (x - cx) / r
        c = WHITE if t < -0.5 else face if t < 0.3 else MID if t < 0.75 else DARK
        line(im, [(x, top), (x, top + h - 1)], c)
    for x in range(cx - r + 1, cx + r, 2):
        line(im, [(x, top + 1), (x, top + h - 2)], slit if (x - cx) / r < 0.75 else BLACK)
    line(im, [(cx - r, top + h - 1), (cx + r, top + h - 1)], BLACK)
