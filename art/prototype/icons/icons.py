"""App icon concepts for GlobalCity, drawn at a 64 px master in the Micropolis palette.

  earth     Pixel Earth: an orthographic globe rendered from the game's own world map (water, land, forest in
            the in-game colours), lit from the top-left like the tiles, with a thin atmosphere ring.
  planet    Little planet: a small globe with a Micropolis skyline standing on it and a train on a rail ring.
  block     City block: a 4x4 crop of real Micropolis tiles (crossroads, towers, park), with a globe badge.
  skyline   Skyline globe: a bold globe with a white city skyline across it; built to read at 16 px.

Outputs <name>.png (64 px master), <name>@<size>.png for 16/32/180/192/512 (nearest-neighbour; 180 from the
192 render, as iOS scales anyway) and a maskable 512 with the art inside the 80% safe zone.
Run: python3 art/prototype/icons/icons.py
"""
import math, os, sys
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../../..'))
sys.path.insert(0, os.path.join(HERE, '..'))
from pixlib import BLACK, DARK, MID, LIGHT, WHITE, DIRT, SAND, GRASS, FOREST, WATER, BLUE, RED, YELLOW, ORANGE, PALETTE  # noqa

N = 64
BG = (0x0b, 0x0f, 0x17)          # the app's theme colour (index.html theme-color)
BG2 = (0x16, 0x1d, 0x2b)
WORLD = Image.open(os.path.join(ROOT, 'client/public/assets/world-minimap.png')).convert('RGB')
SHEET = Image.open(os.path.join(ROOT, 'art/sheet/micropolis-tiles-original.png')).convert('RGB')
MAPCOL = {(0, 0, 168): WATER, (138, 154, 74): DIRT, (46, 106, 46): GRASS}


def tile(t):
    return SHEET.crop(((t % 16) * 16, (t // 16) * 16, (t % 16) * 16 + 16, (t // 16) * 16 + 16))


def backdrop(im, r=10):
    """Dark rounded square with a faint dither towards the top (the app's colours)."""
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, N - 1, N - 1], r, fill=BG)
    for y in range(0, N // 2):
        for x in range(N):
            if (x + y) % 2 == 0 and y < (N // 2 - abs(x - N // 2) // 3) and im.getpixel((x, y)) == BG and (x * 7 + y * 3) % 5 == 0:
                im.putpixel((x, y), BG2)


def globe(im, cx, cy, r, lon0=10, lat0=20, shade=True):
    """Orthographic globe from the world map, top-left lit: a dither band then a darker limb at the bottom-right."""
    W, H = WORLD.size
    la0, lo0 = math.radians(lat0), math.radians(lon0)
    for y in range(cy - r, cy + r + 1):
        for x in range(cx - r, cx + r + 1):
            dx, dy = (x - cx + 0.5) / r, (y - cy + 0.5) / r
            rho2 = dx * dx + dy * dy
            if rho2 > 1: continue
            z = math.sqrt(1 - rho2)
            # inverse orthographic
            lat = math.asin(z * math.sin(la0) - dy * math.cos(la0))
            lon = lo0 + math.atan2(dx, z * math.cos(la0) + dy * math.sin(la0))
            u = int(((math.degrees(lon) + 180) % 360) / 360 * W)
            v = int((90 - math.degrees(lat)) / 180 * H)
            c = MAPCOL.get(WORLD.getpixel((min(W - 1, u), min(H - 1, v))), WATER)
            if shade:
                t = dx * 0.7 + dy * 0.7 + (1 - z) * 0.4      # light from the top-left
                darker = {WATER: BLUE, DIRT: SAND, GRASS: FOREST}
                lighter = {WATER: WATER, DIRT: DIRT, GRASS: GRASS}
                if t > 0.75: c = darker.get(c, c)
                elif t > 0.45 and (x + y) % 2 == 0: c = darker.get(c, c)
                elif t < -0.8 and (x + y) % 3 == 0: c = WHITE if c == WATER else lighter.get(c, c)
            if 0 <= x < N and 0 <= y < N: im.putpixel((x, y), c)


def ring(im, cx, cy, r, c, gap=None):
    for a in range(0, 720):
        ang = math.radians(a / 2)
        x, y = round(cx + r * math.cos(ang)), round(cy + r * math.sin(ang))
        if gap and gap[0] <= a / 2 <= gap[1]: continue
        if 0 <= x < N and 0 <= y < N: im.putpixel((x, y), c)


def tower(im, x, y, w, h, roof=LIGHT, wall=MID, win=YELLOW, side=DARK):
    """Front-elevation tower: lit roof strip, wall with window grid, a dark east side."""
    ImageDraw.Draw(im).rectangle([x, y, x + w - 1, y + h - 1], fill=wall)
    ImageDraw.Draw(im).line([(x, y), (x + w - 1, y)], fill=roof)
    ImageDraw.Draw(im).line([(x + w - 1, y + 1), (x + w - 1, y + h - 1)], fill=side)
    for yy in range(y + 2, y + h - 1, 2):
        for xx in range(x + 1, x + w - 2, 2):
            if (xx * 3 + yy) % 7: im.putpixel((xx, yy), win)


# ------------------------------------------------------------------ concepts

def earth():
    im = Image.new('RGB', (N, N), BG); backdrop(im)
    globe(im, 32, 32, 25, lon0=12, lat0=25)
    ring(im, 32, 32, 27, MID)
    ring(im, 32, 32, 27, LIGHT, gap=(0, 200))       # lit upper-left rim
    # a few city lights on the night side
    for (x, y) in [(43, 38), (46, 33), (40, 44), (48, 40)]: im.putpixel((x, y), YELLOW)
    return im


def planet():
    im = Image.new('RGB', (N, N), BG); backdrop(im)
    globe(im, 32, 50, 20, lon0=-20, lat0=60)
    # skyline standing on the planet's crown
    for (x, w, h, c) in [(17, 5, 12, MID), (22, 6, 20, LIGHT), (28, 5, 14, MID), (33, 7, 25, LIGHT), (40, 5, 16, MID), (45, 4, 10, MID)]:
        base = 50 - int(math.sqrt(max(0, 20 ** 2 - (x + w / 2 - 32) ** 2))) + 2
        tower(im, x, base - h, w, h, roof=WHITE, wall=c)
    im.putpixel((36, 50 - 20 + 2 - 25 - 1), RED)      # beacon on the tallest tower
    ring(im, 32, 50, 21, LIGHT, gap=(0, 180))      # lit rim on the planet's upper-left
    return im


def block():
    im = Image.new('RGB', (N, N), BG)
    # 4x4 real tiles: one complete Micropolis office tower (3x3) on the corner of two streets
    c0 = 436 + 9 * 17 - 4
    grid = [
        [c0, c0 + 1, c0 + 2, 67],
        [c0 + 3, c0 + 4, c0 + 5, 67],
        [c0 + 6, c0 + 7, c0 + 8, 67],
        [66, 66, 66, 76],
    ]
    for gy, row in enumerate(grid):
        for gx, t in enumerate(row): im.paste(tile(t), (gx * 16, gy * 16))
    # round the corners into the app shape
    mask = Image.new('L', (N, N), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, N - 1, N - 1], 10, fill=255)
    bg = Image.new('RGB', (N, N), BG); bg.paste(im, (0, 0), mask); im = bg
    # globe badge in the lower right
    ImageDraw.Draw(im).ellipse([37, 37, 62, 62], fill=BG)
    globe(im, 50, 50, 11, lon0=10, lat0=20)
    ring(im, 50, 50, 12, WHITE, gap=(60, 300))
    return im


def skyline():
    im = Image.new('RGB', (N, N), BG); backdrop(im)
    globe(im, 32, 32, 26, lon0=-5, lat0=10, shade=True)
    # a white skyline band across the globe's middle, bold enough to read at 16 px
    sky = [(9, 6, 8), (15, 5, 12), (20, 6, 6), (26, 7, 17), (33, 5, 10), (38, 6, 14), (44, 5, 7), (49, 6, 10)]
    for (x, w, h) in sky:
        ImageDraw.Draw(im).rectangle([x, 38 - h, x + w - 1, 38], fill=WHITE)
        for yy in range(38 - h + 2, 37, 3):
            for xx in range(x + 1, x + w - 1, 2): im.putpixel((xx, yy), LIGHT)
    ImageDraw.Draw(im).rectangle([7, 38, 56, 39], fill=WHITE)
    im.putpixel((29, 38 - 17 - 1), RED)
    ring(im, 32, 32, 27, MID)
    return im


CONCEPTS = [('earth', 'Pixel Earth', earth), ('planet', 'Little planet', planet), ('block', 'City block', block), ('skyline', 'Skyline globe', skyline)]

if __name__ == '__main__':
    for slug, name, f in CONCEPTS:
        im = f()
        im.save(os.path.join(HERE, f'{slug}.png'))
        for s in (16, 32):
            im.resize((s, s), Image.LANCZOS if s < 64 else Image.NEAREST).save(os.path.join(HERE, f'{slug}@{s}.png'))
        for s in (192, 512):
            im.resize((s, s), Image.NEAREST).save(os.path.join(HERE, f'{slug}@{s}.png'))
        im.resize((192, 192), Image.NEAREST).resize((180, 180), Image.NEAREST).save(os.path.join(HERE, f'{slug}@180.png'))
        # maskable: art scaled into the central 80% on the theme colour
        m = Image.new('RGB', (640, 640), BG)
        m.paste(im.resize((512, 512), Image.NEAREST), (64, 64))
        m.resize((512, 512), Image.NEAREST).save(os.path.join(HERE, f'{slug}-maskable@512.png'))
        print(slug)
