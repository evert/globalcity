"""Shared detail helpers for the leisure group (trees, people, cars, fences, cast shadows)."""
import os, sys, random
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from pixlib import *  # noqa: F401,F403
import pixlib

SHADE = {DIRT: SAND, SAND: DARK, GRASS: FOREST, FOREST: DARK, WATER: BLUE, BLUE: BLUE,
         MID: DARK, LIGHT: MID, WHITE: LIGHT, DARK: BLACK, YELLOW: ORANGE, ORANGE: RED}

def get(im, x, y):
    return im.getpixel((x, y)) if 0 <= x < im.width and 0 <= y < im.height else None

def shade_px(im, x, y):
    c = get(im, x, y)
    if c is not None: im.putpixel((x, y), SHADE.get(c, c))

def cast(im, x0, y0, x1, y1):
    """Darken the ground in a rectangle (soft cast shadow like the originals: SAND on dirt, FOREST on grass)."""
    for y in range(max(0, y0), min(im.height, y1 + 1)):
        for x in range(max(0, x0), min(im.width, x1 + 1)):
            shade_px(im, x, y)

def bldg(im, x, y, w, d, h, roof=LIGHT, wall=DARK, side=BLACK, windows=None, cast_len=3):
    """pixlib.box plus a soft ground-coloured cast shadow beyond the black edge."""
    cast(im, x + w + 2, y + 3, x + w + 1 + cast_len, y + d + h + cast_len - 1)
    cast(im, x + 3, y + d + h + 2, x + w + 1, y + d + h + 1 + cast_len - 1)
    box(im, x, y, w, d, h, roof=roof, wall=wall, side=side, windows=windows)

def speckle(im, rng, n, colours, area=None):
    x0, y0, x1, y1 = area or (1, 1, im.width - 2, im.height - 2)
    for _ in range(n):
        x, y = rng.randint(x0, x1), rng.randint(y0, y1)
        px(im, x, y, rng.choice(colours))

def speckle_on(im, rng, n, colours, ground, area=None):
    """Like speckle but only replaces pixels that are currently `ground` colour(s)."""
    x0, y0, x1, y1 = area or (1, 1, im.width - 2, im.height - 2)
    ground = ground if isinstance(ground, (list, tuple, set)) and not isinstance(ground[0], int) else [ground]
    for _ in range(n):
        x, y = rng.randint(x0, x1), rng.randint(y0, y1)
        if get(im, x, y) in ground: px(im, x, y, rng.choice(colours))

def tree(im, x, y, big=False):
    """Round tree: FOREST canopy, GRASS lit top-left, BLACK/DARK shadow bottom-right. (x, y) = top-left."""
    if big:
        for dx, dy in [(1,0),(2,0),(0,1),(1,1),(2,1),(3,1),(0,2),(1,2),(2,2),(3,2),(1,3),(2,3)]:
            px(im, x+dx, y+dy, FOREST)
        for dx, dy in [(1,0),(0,1),(1,1),(2,0)]: px(im, x+dx, y+dy, GRASS)
        for dx, dy in [(4,2),(3,3),(2,4),(4,3),(3,4)]: shade_px(im, x+dx, y+dy)
        px(im, x+3, y+3, BLACK)
    else:
        for dx, dy in [(0,0),(1,0),(0,1),(1,1)]: px(im, x+dx, y+dy, FOREST)
        px(im, x, y, GRASS)
        px(im, x+2, y+1, BLACK); px(im, x+1, y+2, BLACK); shade_px(im, x+2, y+2)

PEOPLE = [RED, YELLOW, BLUE, WHITE, ORANGE, BLACK]

def crowd(im, rng, n, area, on=None, colours=PEOPLE):
    x0, y0, x1, y1 = area
    tries = 0
    while n > 0 and tries < n * 50:
        tries += 1
        x, y = rng.randint(x0, x1), rng.randint(y0, y1)
        if on is not None and get(im, x, y) not in on: continue
        px(im, x, y, rng.choice(colours)); n -= 1

def car(im, x, y, c, horiz=True):
    """Tiny 3x2 (horiz) or 2x3 car with dark windscreen and black shadow pixel."""
    if horiz:
        rect(im, x, y, x+2, y+1, c); px(im, x+1, y, DARK); px(im, x+3, y+1, BLACK)
    else:
        rect(im, x, y, x+1, y+2, c); px(im, x, y+1, DARK); px(im, x+1, y+3, BLACK)

def fence(im, x0, y0, x1, y1, c=DARK, step=2):
    """Dotted fence rectangle like the coal plant's yard."""
    for x in range(x0, x1 + 1, step):
        px(im, x, y0, c); px(im, x, y1, c)
    for y in range(y0, y1 + 1, step):
        px(im, x0, y, c); px(im, x1, y, c)

def road_h(im, x0, x1, y, dashed=True):
    """2-lane road strip 6px tall like the original roads (MID with LIGHT dashes)."""
    rect(im, x0, y, x1, y + 5, MID)
    if dashed:
        for x in range(x0 + 1, x1, 4): px(im, x, y + 2, LIGHT); px(im, x + 1, y + 2, LIGHT)

def save(im, slug, name, idea, zone):
    pixlib.save(im, slug, name, idea, 'leisure', zone)

def spline(ctrl, closed=True, step=0.02):
    """Catmull-Rom through control points -> list of unique integer pixels in order."""
    P = list(ctrl)
    n = len(P)
    out = []
    segs = n if closed else n - 1
    for i in range(segs):
        p0 = P[(i - 1) % n] if closed or i > 0 else P[0]
        p1 = P[i]; p2 = P[(i + 1) % n]
        p3 = P[(i + 2) % n] if closed or i + 2 < n else P[-1]
        t = 0.0
        while t < 1.0:
            t2, t3 = t * t, t * t * t
            x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            q = (round(x), round(y))
            if not out or out[-1] != q: out.append(q)
            t += step
    return out

def grass_patch(im, cx, cy, rx, ry, seed=0):
    """Irregular grass blob with a dithered FOREST/GRASS edge."""
    for y in range(cy - ry - 1, cy + ry + 2):
        for x in range(cx - rx - 1, cx + rx + 2):
            d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            h = (x * 7 + y * 13 + seed) % 11
            if d <= 1.0:
                px(im, x, y, FOREST if (h == 0 and (x * y) % 3 == 0) else GRASS)
