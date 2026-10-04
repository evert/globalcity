"""Shared drawing helpers for the 'utilities' group, layered on top of pixlib.

Projection (matches the Micropolis originals): height goes up-RIGHT at 45 degrees, so a building's roof
sits up-right of its ground footprint, the lit WEST face shows on the left, the SOUTH face at the bottom,
and the shadow falls to the bottom-right as a darkened copy of the ground (dirt->sand, grass->forest).
"""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pixlib import *          # noqa: F401,F403  (palette constants + helpers)
import pixlib
from PIL import Image, ImageDraw

DARKEN = {DIRT: SAND, SAND: SAND, GRASS: FOREST, FOREST: FOREST, MID: DARK, LIGHT: MID, WHITE: LIGHT,
          DARK: BLACK, BLACK: BLACK, WATER: BLUE, BLUE: BLUE, YELLOW: ORANGE, ORANGE: RED, RED: RED}


def _h(x, y, s=0):
    return (x * 73856093 ^ y * 19349663 ^ s * 83492791) & 0xffff


def ground(tiles, kind='dirt', seed=''):
    if kind != 'grass':
        return pixlib.canvas(tiles, kind, seed)
    n = tiles * 16
    im = Image.new('RGB', (n, n), GRASS)
    s = sum(seed.encode())
    for y in range(n):
        for x in range(n):
            r = _h(x, y, s)
            if r % 41 == 0: im.putpixel((x, y), FOREST)
            elif r % 97 == 0: im.putpixel((x, y), DIRT)
    return im


def shadow_poly(im, pts):
    """Darken the ground under polygon pts (one pass, so overlapping shadows don't double-darken)."""
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).polygon(pts, fill=255)
    _apply_shadow(im, m)


def shadow_rect(im, x0, y0, x1, y1):
    shadow_poly(im, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)])


def _apply_shadow(im, m):
    mp = m.load(); p = im.load()
    for y in range(im.height):
        for x in range(im.width):
            if mp[x, y]: p[x, y] = DARKEN.get(p[x, y], p[x, y])


def prism(im, x, y, w, d, h, roof=MID, west=LIGHT, south=DARK, win=None, wstep=3, shadow=None,
          lit=True, base=BLACK, rivets=None):
    """Box whose ROOF is the rect (x, y, w, d); walls drop h px down-left at 45 degrees.
    win: colour of window dots on the south face (None = no windows)."""
    gx, gy = x - h, y + h
    sil = [(x, y), (x + w - 1, y), (x + w - 1, y + d - 1), (gx + w - 1, gy + d - 1), (gx, gy + d - 1), (gx, gy)]
    s = (h // 2 + 2) if shadow is None else shadow
    if s:
        shadow_poly(im, [(px_ + s, py_ + s) for px_, py_ in sil])
    if h > 0:
        poly(im, [(gx, gy), (x, y), (x, y + d - 1), (gx, gy + d - 1)], west)        # west face
        poly(im, [(gx, gy + d - 1), (x, y + d - 1), (x + w - 1, y + d - 1), (gx + w - 1, gy + d - 1)], south)
        line(im, [(gx, gy + d - 1), (gx + w - 1, gy + d - 1)], base)
        if win is not None:
            for k in range(2, h, 2):
                yy = gy + d - 1 - k
                for xx in range(gx + k + 2, gx + k + w - 3, wstep):
                    pixlib.px(im, xx, yy, win)
    rect(im, x, y, x + w - 1, y + d - 1, roof)
    if lit:
        line(im, [(x, y), (x + w - 2, y)], WHITE)
        line(im, [(x, y), (x, y + d - 2)], WHITE)
    line(im, [(x + w - 1, y), (x + w - 1, y + d - 1)], DARK if roof != DARK else BLACK)
    if rivets is None: rivets = w >= 9 and d >= 6 and roof in (MID, LIGHT)
    if rivets:                     # inset dotted parapet line + corner bolts, like the originals' roofs
        rc = DARK if roof == MID else MID
        for xx in range(x + 3, x + w - 3, 2): pixlib.px(im, xx, y + d - 2, rc)
        for (cx_, cy_) in [(x + 2, y + 2), (x + w - 3, y + 2)]: pixlib.px(im, cx_, cy_, rc)
    return gx, gy


def cylinder(im, cx, cy, r, h, top=BLACK, rim=WHITE, body=(WHITE, LIGHT, MID, DARK), shadow=None, ry=None, lift=0):
    """Vertical cylinder: ground circle centre (cx, cy), top centre at (cx+h, cy-h). body = shades lit->dark."""
    ry = r if ry is None else ry
    s = (h // 2 + 2) if shadow is None else shadow
    m = Image.new('L', im.size, 0); dm = ImageDraw.Draw(m)
    for t in range(0, h + 1):
        dm.ellipse([cx + t - r + s, cy - t - ry + s, cx + t + r + s, cy - t + ry + s], fill=255)
    if s: _apply_shadow(im, m)
    p = im.load()
    for t in range(lift, lift + h + 1):
        ox, oy = cx + t, cy - t
        for yy in range(int(oy - ry), int(oy + ry) + 1):
            for xx in range(int(ox - r), int(ox + r) + 1):
                dx, dy = (xx - ox) / (r + 0.5), (yy - oy) / (ry + 0.5)
                if dx * dx + dy * dy <= 1.0 and 0 <= xx < im.width and 0 <= yy < im.height:
                    # normal of the side wall faces (dx, dy); light comes from the west/top-left
                    v = -dx * 0.85 - dy * 0.35
                    c = body[0] if v > 0.45 else body[1] if v > -0.1 else body[2] if v > -0.6 else body[3]
                    p[xx, yy] = c
    ox, oy = cx + lift + h, cy - lift - h
    if top is not None:
        ellipse(im, ox - r, oy - ry, ox + r, oy + ry, top, rim)
    return ox, oy


def pole(im, x, y, h, c=BLACK, w=1):
    """Vertical pole from ground (x, y) up h px (drawn up-right at 45 deg). Returns the top point."""
    line(im, [(x, y), (x + h, y - h)], c, w)
    return x + h, y - h


def pave(im, x0, y0, x1, y1, c=MID, dash=LIGHT, edge=None):
    rect(im, x0, y0, x1, y1, c)
    if dash:
        if x1 - x0 >= y1 - y0:
            yy = (y0 + y1) // 2
            for xx in range(x0 + 1, x1, 4): line(im, [(xx, yy), (xx + 1, yy)], dash)
        else:
            xx = (x0 + x1) // 2
            for yy in range(y0 + 1, y1, 4): line(im, [(xx, yy), (xx, yy + 1)], dash)


def track(im, pts, c=SAND, w=2):
    line(im, pts, c, w)


def fence(im, x0, y0, x1, y1, c=DARK, step=2, gaps=()):
    """Dotted fence rectangle. gaps: [(side 'n'|'s'|'w'|'e', from, to)] for gates."""
    pts = []
    for xx in range(x0, x1 + 1, step): pts += [(xx, y0, 'n'), (xx, y1, 's')]
    for yy in range(y0, y1 + 1, step): pts += [(x0, yy, 'w'), (x1, yy, 'e')]
    for xx, yy, side in pts:
        if any(side == g[0] and g[1] <= (xx if side in 'ns' else yy) <= g[2] for g in gaps): continue
        pixlib.px(im, xx, yy, c)


def tree(im, x, y, big=False):
    """Small round bush/tree like the green blobs in the originals (shadow bottom-right)."""
    shadow_rect(im, x + 1, y + 1, x + 2 + big, y + 2 + big)
    rect(im, x - 1, y - 1, x + big, y + big, FOREST)
    pixlib.px(im, x - 1, y - 1, GRASS)
    if big: pixlib.px(im, x, y - 1, GRASS)


def truck(im, x, y, cab=RED, load=LIGHT, horiz=True):
    """Tiny truck, ~5x2 px."""
    if horiz:
        shadow_rect(im, x + 1, y + 2, x + 5, y + 2)
        rect(im, x, y, x + 3, y + 1, load); pixlib.px(im, x, y, WHITE)
        rect(im, x + 4, y, x + 4, y + 1, cab)
        pixlib.px(im, x + 1, y + 2, BLACK); pixlib.px(im, x + 3, y + 2, BLACK)
    else:
        shadow_rect(im, x + 2, y + 1, x + 2, y + 5)
        rect(im, x, y + 1, x + 1, y + 4, load); pixlib.px(im, x, y + 1, WHITE)
        rect(im, x, y, x + 1, y, cab)


def car(im, x, y, c):
    pixlib.px(im, x, y, c); pixlib.px(im, x + 1, y, c); pixlib.px(im, x + 2, y, BLACK)


def sphere(im, cx, cy, r, shades=(WHITE, LIGHT, MID, DARK), ry=None):
    """Shaded ball/dome lit from the top-left."""
    ry = r if ry is None else ry
    p = im.load()
    for yy in range(int(cy - ry), int(cy + ry) + 1):
        for xx in range(int(cx - r), int(cx + r) + 1):
            dx, dy = (xx - cx) / (r + 0.5), (yy - cy) / (ry + 0.5)
            d2 = dx * dx + dy * dy
            if d2 <= 1.0 and 0 <= xx < im.width and 0 <= yy < im.height:
                dz = math.sqrt(max(0.0, 1 - d2))
                v = -dx * 0.55 - dy * 0.55 + dz * 0.6
                c = shades[0] if v > 0.72 else shades[1] if v > 0.3 else shades[2] if v > -0.15 else shades[3]
                if d2 > 0.86 and (dx + dy) > 0.2: c = shades[3]
                p[xx, yy] = c
