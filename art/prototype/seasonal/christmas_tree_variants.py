"""Christmas tree variants at other sizes, next to the 2x4 one in christmas_tree.py.

  2x2  christmas_tree_2x2.png   a small fir on the grass, presents and snow at its foot
  2x3  christmas_tree_2x3.png   a fir in a red tub on a paved square, two lamps
  3x3  christmas_tree_3x3.png   a bushy fir in the snow on a market square, two striped stalls, lamps
  3x5  christmas_tree_3x5.png   a giant city fir with spiralling tinsel above an ice rink with skaters

Each fir was generated with the sprite-ai MCP (tree_*_ai.png; generation ids in TREES) and is mapped onto the 14
Micropolis colours by hue and brightness here (every generation brings its own colours, so the mapping is by rule
rather than a table). The ground, paving, lamps, stalls, rink and people are drawn by hand, and the shadow falls
east-south-east by darkening the ground, as in the originals. The night images come from the same render as
art/nightlights/lights.py: baubles become coloured bulbs, tinsel amber, the star bright, fairy lights on a share of
the lit needles and a faint warm wash, kept to the fir's own pixels; then lamps, stall lights and floodlights.

Run: python3 art/prototype/seasonal/christmas_tree_variants.py   (writes the PNGs, -night PNGs, @4x copies and
christmas_tree_variants_preview.png, day above night with the 2x4 tree for comparison). Not in the game yet.
"""
import os, sys, json, math, colorsys
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(HERE, '..', 'civic'))
sys.path.insert(0, os.path.join(ROOT, 'art', 'nightlights'))
from _civ import *  # noqa: F401,F403  (pixlib colours + ground, shade_mask, block)
import lights as L

# name: (tiles w, tiles h, sprite-ai file, generation id, where the fir goes)
TREES = {
    '2x2': (2, 2, 'tree_small_ai.png', '8227bd51-66c2-46ba-9b7c-0b96a5369f19', (0, 0)),
    '2x3': (2, 3, 'tree_tub_ai.png', 'ac282819-0a1b-4d07-8e1f-10167c70a1e1', (0, -2)),
    '3x3': (3, 3, 'tree_market_ai.png', '4f5011ac-bd81-4567-b773-a3245918acd3', (8, 0)),
    '3x5': (3, 5, 'tree_giant_ai.png', '3254d42e-7dcd-4d88-bfd3-9c76aa36a2f7', (0, 0)),
}
# where the rule picks wrong: the 3x3 fir's navy needle shade (BLACK would speckle it), the giant's red-brown trunk
OVERRIDE = {'3x3': {0x081825: FOREST, 0x27131b: DARK}, '3x5': {0x762c25: SAND}}

def map_colours(src):
    """sprite-ai colours -> Micropolis colours. Greens split into two tones by brightness (brightest half of the
    needles GRASS, the rest FOREST), near-black goes BLACK, everything else by hue and brightness."""
    cols = {}
    for c in src.getdata():
        if c[3]: cols[c[:3]] = cols.get(c[:3], 0) + 1
    hsv = {c: colorsys.rgb_to_hsv(*(v / 255 for v in c)) for c in cols}
    greens = sorted((c for c, (h, s, v) in hsv.items() if 70 / 360 < h < 175 / 360 and s > 0.25 and v >= 0.15),
                    key=lambda c: -hsv[c][2])
    total, run, out = sum(cols[c] for c in greens), 0, {}
    for c in greens:
        out[c] = GRASS if run < total * 0.5 else FOREST
        run += cols[c]
    for c, (h, s, v) in hsv.items():
        if c in out: continue
        h *= 360
        if v < 0.17: out[c] = BLACK
        elif s < 0.25:                       # greys, snow, white lights
            out[c] = WHITE if v > 0.9 else LIGHT if v > 0.6 else MID if v > 0.35 else DARK
        elif h < 15 or h >= 330:             # reds and pinks
            out[c] = RED if v > 0.45 else DARK
        elif h < 45:                          # orange, gold, brown
            out[c] = ORANGE if v > 0.6 else SAND if v > 0.28 else DARK
        elif h < 70:                          # yellow, olive
            out[c] = YELLOW if v > 0.75 else SAND
        elif h < 175:                         # a pale or dark green that missed the needle test
            out[c] = GRASS if v > 0.5 else FOREST
        elif h < 260:                         # cyan and blue
            out[c] = WATER if v > 0.6 or s < 0.5 else BLUE
        else:                                 # purple
            out[c] = WATER
    return out

def load_fir(name):
    w, h, fn, _, (ox, oy) = TREES[name]
    src = Image.open(os.path.join(HERE, fn)).convert('RGBA')
    cmap = map_colours(src)
    for k, v in OVERRIDE.get(name, {}).items(): cmap[(k >> 16, (k >> 8) & 255, k & 255)] = v
    fir = {}
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = src.getpixel((x, y))
            X, Y = x + ox, y + oy
            if a and 0 <= X < w * 16 and 0 <= Y < h * 16: fir[(X, Y)] = cmap[(r, g, b)]
    ys = [y for (_, y) in fir]
    top, bot = min(ys), max(ys)
    boughs = top + int((bot - top) * 0.86)          # below this: trunk, tub, presents, snow
    # light from the west: the needles on the east rim of every bough row go black, the next ones FOREST
    for (x, y), c in list(fir.items()):
        if y < boughs and c in (GRASS, FOREST) and (x + 1, y) not in fir:
            fir[(x, y)] = BLACK
            if fir.get((x - 1, y)) == GRASS: fir[(x - 1, y)] = FOREST
    return fir, top, boughs

def cast_shadow(im, fir, reach=3):
    W, H = im.size
    mask = Image.new('L', (W, H), 0)
    for (x, y) in fir:
        for k in range(1, reach + 1):
            if 0 <= x + k < W and 0 <= y + (k + 1) // 2 < H: mask.putpixel((x + k, y + (k + 1) // 2), 255)
    for (x, y) in fir: mask.putpixel((x, y), 0)
    shade_mask(im, mask)

def paving(im, x0, y0, x1, y1, kerb=MID, shape='ellipse'):
    (ellipse if shape == 'ellipse' else rect)(im, x0, y0, x1, y1, LIGHT)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if im.getpixel((x, y)) == LIGHT and x % 4 == 1 and y % 4 == 1: px(im, x, y, MID)
    if kerb:
        if shape == 'ellipse': ellipse(im, x0, y0, x1, y1, None, kerb)
        else: rect(im, x0, y0, x1, y1, None, kerb)

def lamp(im, x, y):
    px(im, x, y + 1, DARK); px(im, x, y + 2, DARK); px(im, x + 1, y + 3, DARK)
    px(im, x, y, WHITE); px(im, x + 1, y + 1, MID)

def person(im, x, y, c):
    px(im, x, y, c); px(im, x + 1, y + 1, MID if im.getpixel((x + 1, y + 1)) in (LIGHT, WHITE) else FOREST)

def round_tree(im, x, y):
    for dx, dy in [(1, 0), (2, 0), (0, 1), (1, 1), (2, 1), (1, 2)]: px(im, x + dx, y + dy, FOREST)
    for dx, dy in [(1, 0), (0, 1)]: px(im, x + dx, y + dy, GRASS)
    for dx, dy in [(3, 1), (2, 2), (1, 3)]: px(im, x + dx, y + dy, BLACK)

def stall(im, x, y, c=RED):
    """A little market stall, 9 wide: striped awning, counter, a shopkeeper; its lights hang under the awning."""
    block(im, x, y + 3, 9, 3, 3, roof=SAND, west=LIGHT, south=DARK, sh=(2, 1), edge=False)
    for i in range(9):
        for j in range(3): px(im, x + i - j // 2, y + j, c if (i // 2) % 2 == 0 else WHITE)
    line(im, [(x - 1, y + 3), (x + 8, y + 3)], DARK)
    px(im, x + 4, y + 5, ORANGE)

LIGHTS = {}   # name -> extra lit pixels [(x, y, colour)]

def scene(name):
    w, h, *_ = TREES[name]
    W, H = w * 16, h * 16
    im = ground(max(w, h), 'grass', f'christmas_tree_{name}').crop((0, 0, W, H))
    fir, top, boughs = load_fir(name)
    extra = []
    if name == '2x2':
        for (x, y) in [(0, 1), (27, 3), (1, 25)]: round_tree(im, x, y)
    elif name == '2x3':
        paving(im, 1, 22, 30, 46)
        for (x, y) in [(0, 2), (27, 5), (1, 14), (27, 15)]: round_tree(im, x, y)
        for (x, y) in [(3, 36), (28, 36)]: lamp(im, x, y); extra.append((x, y, L.SOFT))
        for (x, y, c) in [(8, 44, RED), (22, 43, BLUE), (25, 45, ORANGE)]: person(im, x, y, c)
    elif name == '3x3':
        paving(im, 0, 22, 47, 47, kerb=None, shape='rect')
        line(im, [(0, 22), (47, 22)], MID)
        for (x, y) in [(1, 2), (42, 4), (2, 13), (42, 14)]: round_tree(im, x, y)
        stall(im, 2, 35, RED); stall(im, 37, 35, BLUE)
        for (x, y) in [(2, 38), (37, 38)]:   # strings of bulbs under each awning
            for i in range(0, 9, 2): extra.append((x + i - 1, y, L.FAIRY))
        for (x, y) in [(1, 24), (45, 24)]: lamp(im, x, y); extra.append((x, y, L.SOFT))
        for (x, y, c) in [(15, 42, RED), (19, 44, BLUE), (28, 43, BLACK), (32, 45, ORANGE), (24, 46, WHITE), (11, 46, BLUE)]:
            person(im, x, y, c)
    elif name == '3x5':
        paving(im, 0, 50, 47, 79, kerb=None, shape='rect')
        line(im, [(0, 50), (47, 50)], MID)
        for (x, y) in [(1, 2), (43, 5), (1, 22), (43, 26)]: round_tree(im, x, y)
        # the rink: white ice with skate marks inside low boards (dark top edge, lit south face), rounded corners
        x0, y0, x1, y1 = 4, 63, 44, 76
        rect(im, x0, y0, x1, y1, WHITE)
        for (sx, sy, n) in [(9, 66, 6), (21, 69, 9), (32, 66, 5), (12, 73, 7), (30, 72, 8)]:
            line(im, [(sx, sy), (sx + n, sy)], LIGHT); px(im, sx + n + 1, sy - 1, LIGHT)
        rect(im, x0, y0, x1, y1, None, DARK)
        line(im, [(x0 + 1, y1 + 1), (x1, y1 + 1)], MID)
        for (x, y) in [(x0, y0), (x1, y0), (x0, y1), (x1, y1)]: px(im, x, y, LIGHT)
        for (x, y) in [(x0 + 1, y0 + 1), (x1 - 1, y0 + 1), (x0 + 1, y1 - 1), (x1 - 1, y1 - 1)]: px(im, x, y, DARK)
        for (x, y, c) in [(9, 68, RED), (15, 71, BLUE), (24, 66, ORANGE), (28, 73, RED), (36, 68, BLACK), (40, 72, BLUE),
                          (19, 74, BLACK), (31, 69, RED)]:
            person(im, x, y, c)
        for (x, y, c) in [(8, 59, BLUE), (12, 60, RED), (35, 59, BLACK), (39, 60, ORANGE), (20, 78, RED), (27, 78, BLUE)]:
            person(im, x, y, c)
        for (x, y) in [(1, 58), (46, 58), (1, 76), (46, 76)]:
            lamp(im, x - 1 if x > 40 else x, y); extra.append((x - 1 if x > 40 else x, y, L.FLOOD))
    cast_shadow(im, fir, 4 if name == '3x5' else 3)
    for (x, y), c in fir.items(): px(im, x, y, c)
    bad = {c for c in im.getdata() if c not in PALETTE}
    assert not bad, f'{name}: off-palette colours {list(bad)[:5]}'
    return im, fir, top, boughs, extra

def night(name, im, fir, top, boughs, extra):
    W, H = im.size
    xs = [x for (x, _) in fir]
    cx = (min(xs) + max(xs)) // 2
    code = f'XMAS{name}'
    L.EDITS[code] = [('none',),
        ('colour', L.RED_L), ('pix', 0, 0, W - 1, boughs, {L.RED}, 1),
        ('colour', L.TAXI), ('pix', 0, 0, W - 1, boughs, {L.BLUE, L.LBLUE}, 1),
        ('colour', L.WHITE), ('pix', 0, 0, W - 1, boughs, {L.WHITE_}, 0.8),
        ('colour', L.AMBER), ('pix', 0, 0, W - 1, boughs, {L.YELLOW, L.ORANGE}, 0.6),
        ('colour', L.FAIRY), ('pix', 0, 0, W - 1, boughs, {L.GREEN}, 0.22),
        ('colour', L.STAR), ('pix', cx - 4, top, cx + 4, top + 5, {L.YELLOW, L.WHITE_, L.ORANGE}, 1),
        ('colour', L.XMAS_GLOW), ('pixwash', 0, 0, W - 1, boughs, {L.GREEN, L.DGREEN}, 70)]
    lit = {xy: v for xy, v in L.render(code, im, L.SOFT, 0, 0).items() if xy in fir}
    for (x, y, c) in extra: lit[(x, y)] = (c, 255)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for (x, y), (c, a) in lit.items(): out.putpixel((x, y), (*c, a))
    return out

def nightview(day, lights, S):
    """As the game draws it: a blue-black shade, a soft halo round each light, then the lights."""
    W, H = day.size
    big = Image.alpha_composite(day.resize((W * S, H * S), Image.NEAREST).convert('RGBA'),
                                Image.new('RGBA', (W * S, H * S), (6, 10, 34, int(255 * 0.48))))
    R = 3; glow = Image.new('RGBA', big.size, (0, 0, 0, 0)); gp = glow.load(); lp = lights.load()
    for y in range(H):
        for x in range(W):
            r, g, b, a = lp[x, y]
            if a != 255: continue
            for yy in range(max(0, (y - R) * S), min(H * S, (y + R + 1) * S)):
                for xx in range(max(0, (x - R) * S), min(W * S, (x + R + 1) * S)):
                    d = math.hypot((xx + .5) / S - (x + .5), (yy + .5) / S - (y + .5)) / (R + .5)
                    if d < 1:
                        al = int(255 * 0.22 * (1 - d))
                        if al > gp[xx, yy][3]: gp[xx, yy] = (r, g, b, al)
    big = Image.alpha_composite(big, glow)
    return Image.alpha_composite(big, lights.resize(big.size, Image.NEAREST)).convert('RGB')

if __name__ == '__main__':
    S, GAP = 4, 24
    shots = []
    meta = json.load(open(os.path.join(HERE, 'meta.json')))
    for name in TREES:
        im, fir, top, boughs, extra = scene(name)
        nt = night(name, im, fir, top, boughs, extra)
        base = os.path.join(HERE, f'christmas_tree_{name}')
        im.save(base + '.png'); nt.save(base + '-night.png', optimize=True)
        im.resize((im.width * 4, im.height * 4), Image.NEAREST).save(base + '@4x.png')
        w, h, _, gen, _ = TREES[name]
        meta[f'christmas_tree_{name}'] = {'name': f'Christmas tree ({name})', 'w': w, 'h': h, 'zone': 'none',
                                          'sprite_ai': gen, 'night': f'christmas_tree_{name}-night.png'}
        shots.append((name, im, nt))
        print(f'{name}: {im.width}x{im.height}, {sum(1 for p in nt.getdata() if p[3] == 255)} lights')
    json.dump(meta, open(os.path.join(HERE, 'meta.json'), 'w'), indent=2)
    # preview: the four variants and the 2x4 original, day on top, night below, all at 4x
    A = os.path.join(ROOT, 'client', 'public', 'assets', 'buildings')
    shots.append(('2x4', Image.open(f'{A}/christmastree.png').convert('RGB'),
                  Image.open(f'{A}/christmastree-night.png').convert('RGBA')))
    Hmax = max(d.height for _, d, _ in shots) * S
    Wtot = sum(d.width * S for _, d, _ in shots) + GAP * (len(shots) + 1)
    out = Image.new('RGB', (Wtot, Hmax * 2 + GAP * 3), (24, 24, 28))
    x = GAP
    for _, d, n in shots:
        out.paste(d.resize((d.width * S, d.height * S), Image.NEAREST), (x, GAP + Hmax - d.height * S))
        out.paste(nightview(d, n, S), (x, GAP * 2 + Hmax * 2 - d.height * S))
        x += d.width * S + GAP
    out.save(os.path.join(HERE, 'christmas_tree_variants_preview.png'))
    print('wrote christmas_tree_variants_preview.png')
