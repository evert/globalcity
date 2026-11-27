"""Christmas tree: a tall decorated fir on a small town square, 2 tiles wide by 4 tall (32x64 px).

The fir was generated with the sprite-ai MCP (christmas_tree_ai.png, generation
9200c525-e71c-41f2-8e5e-b3b61c84c4ea) and is mapped here onto the 14 Micropolis colours. The square
round its foot (paving, lamps, benches, people) is drawn by hand. Around the square the ground is transparent,
so the tree stands on whatever biome it is built in; the fir's shadow falls east as a translucent black there and
darkens the paving the way the originals do. Strings of single-pixel bulbs (red, blue,
yellow, white) are added on the needles. At night only the star, the bulbs and the baubles glow, each in its
own colour: their pixels go to christmas_tree_lights.json, which the 'XMAS' entry in
art/nightlights/lights.py reads.

Run: python3 art/prototype/seasonal/christmas_tree.py   (writes christmas_tree.png, @4x, and the game
copy client/public/assets/buildings/christmastree.png; then run art/nightlights/lights.py)
"""
import os, sys, json, shutil, hashlib
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'civic'))
from _civ import *  # noqa: F401,F403  (pixlib colours + ground, shade_mask)

W, H = 32, 64
# The ground is left transparent so the game's own biome ground (grass, sand, tundra, snow) shows through: the
# tiles under a custom building are drawn as bare ground. Drawn on a key colour that becomes transparent at the
# end; the shadow over it becomes a translucent black.
KEY, KEY_SHADE = (255, 0, 255), (254, 0, 254)
SHADOW_ALPHA = 80
SHADE[KEY] = KEY_SHADE
im = Image.new('RGB', (W, H), KEY)
get = lambda x, y: im.getpixel((x, y)) if 0 <= x < W and 0 <= y < H else None

# ---------- the square round the fir's foot: plain paving, sparse joints, a mid-grey kerb, a path south
ellipse(im, 1, 30, 30, 62, LIGHT)
rect(im, 13, 58, 18, 63, LIGHT)
for y in range(H):
    for x in range(W):
        if get(x, y) == LIGHT and x % 4 == 1 and y % 4 == 1: px(im, x, y, MID)   # paving joints
ellipse(im, 1, 30, 30, 62, None, MID)
rect(im, 13, 58, 18, 63, LIGHT)
line(im, [(12, 59), (12, 63)], MID); line(im, [(19, 59), (19, 63)], MID)

# ---------- the fir (sprite-ai), mapped to the palette
FIR = {0x102901: FOREST, 0x235201: GRASS, 0x295a02: GRASS, 0x181c02: BLACK,                # needles
       0xe3a82e: YELLOW, 0xecd49d: WHITE, 0xb97c29: ORANGE, 0x995e21: SAND, 0x824411: SAND,  # tinsel, gold
       0x5d3b11: SAND, 0x461807: DARK,                                                     # trunk, shade
       0xb41327: RED, 0x16437c: BLUE, 0x587ebd: WATER, 0x9d92a5: LIGHT, 0xf4ebe8: WHITE}     # baubles, presents
src = Image.open(os.path.join(HERE, 'christmas_tree_ai.png')).convert('RGBA')
assert src.size == (W, H)
fir = {}
for y in range(H):
    for x in range(W):
        r, g, b, a = src.getpixel((x, y))
        if a: fir[(x, y)] = FIR[(r << 16) | (g << 8) | b]
# light from the west: the needles on the east rim of every bough row go black, the next ones in FOREST
for (x, y), c in list(fir.items()):
    if y < 53 and c in (GRASS, FOREST) and (x + 1, y) not in fir:
        fir[(x, y)] = BLACK
        if fir.get((x - 1, y)) == GRASS: fir[(x - 1, y)] = FOREST

# ---------- strings of Christmas lights: single bulbs on the needles, not touching the tinsel, baubles or the
# outline, at least 3 px apart. Picked in a fixed pseudo-random order so the tree comes out the same every run.
NEEDLE = (GRASS, FOREST)
BULB_COLOURS = [RED, BLUE, YELLOW, WHITE]
baubles = [(x, y) for (x, y), c in fir.items() if 8 <= y <= 52 and c in (RED, BLUE, WATER)]
taken = list(baubles)
bulbs = {}
order = sorted(((x, y) for (x, y), c in fir.items() if 9 <= y <= 51 and c in NEEDLE),
               key=lambda p: hashlib.md5(f'bulb:{p}'.encode()).digest())
for (x, y) in order:
    if len(bulbs) >= 32: break
    if not all(fir.get((x + dx, y + dy)) in NEEDLE + (BLACK,) for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1))): continue
    if any(max(abs(x - a), abs(y - b)) < 3 for (a, b) in taken): continue
    bulbs[(x, y)] = BULB_COLOURS[len(bulbs) % 4]
    taken.append((x, y))
fir.update(bulbs)
# what glows at night (art/nightlights/lights.py reads this): the star, the bulbs and the baubles, each in its colour
NAMES = {RED: 'red', BLUE: 'blue', WATER: 'blue', YELLOW: 'yellow', WHITE: 'white'}
glow = {'star': [(x, y) for (x, y), c in fir.items() if y <= 7 and c in (YELLOW, WHITE, ORANGE)]}
for (x, y), c in list(bulbs.items()) + [(p, fir[p]) for p in baubles]:
    glow.setdefault(NAMES[c], []).append((x, y))
json.dump({k: sorted(v) for k, v in glow.items()}, open(os.path.join(HERE, 'christmas_tree_lights.json'), 'w'))

# ---------- lamps round the square (white lamp, dark post, shadow pixel to the east)
LAMPS = [(4, 38), (27, 38), (3, 52), (28, 52)]
for (x, y) in LAMPS:
    px(im, x, y + 1, DARK); px(im, x, y + 2, DARK); px(im, x + 1, y + 3, DARK)
    px(im, x, y, WHITE); px(im, x + 1, y + 1, MID)

# ---------- benches facing the fir and a few people looking up at it
for (x, y) in [(4, 57), (24, 57)]:
    rect(im, x, y, x + 3, y, SAND); line(im, [(x, y + 1), (x + 3, y + 1)], DARK)
for (x, y, c) in [(6, 55, RED), (25, 55, BLUE), (9, 60, ORANGE), (21, 61, BLACK), (4, 45, BLUE), (27, 46, RED)]:
    px(im, x, y, c); px(im, x + 1, y + 1, MID)

# ---------- the fir's shadow falls east-south-east: darken the ground under its outline, shifted
mask = Image.new('L', (W, H), 0)
for (x, y) in fir:
    for k in (1, 2, 3):
        if 0 <= x + k < W and 0 <= y + (k + 1) // 2 < H: mask.putpixel((x + k, y + (k + 1) // 2), 255)
for (x, y) in fir: mask.putpixel((x, y), 0)
shade_mask(im, mask)
for (x, y), c in fir.items(): px(im, x, y, c)

# ---------- save: native PNG, 4x preview, metadata, and the game copy
bad = {c for c in im.getdata() if c not in PALETTE and c not in (KEY, KEY_SHADE)}
assert not bad, f'off-palette colours {list(bad)[:5]}'
out = im.convert('RGBA')
out.putdata([(0, 0, 0, 0) if c[:3] == KEY else (0, 0, 0, SHADOW_ALPHA) if c[:3] == KEY_SHADE else c for c in out.getdata()])
im = out
im.save(os.path.join(HERE, 'christmas_tree.png'))
im.resize((W * 4, H * 4), Image.NEAREST).save(os.path.join(HERE, 'christmas_tree@4x.png'))
meta = json.load(open(os.path.join(HERE, 'meta.json')))
meta['christmas_tree'] = {'name': 'Christmas tree', 'w': 2, 'h': 4, 'zone': 'none',
                          'idea': 'Seasonal decoration: a tall decorated fir on a little town square, on transparent ground so it '
                                  'stands on the local biome; its star, lights and baubles glow at night.'}
json.dump(meta, open(os.path.join(HERE, 'meta.json'), 'w'), indent=2)
shutil.copy(os.path.join(HERE, 'christmas_tree.png'),
            os.path.join(HERE, '..', '..', '..', 'client', 'public', 'assets', 'buildings', 'christmastree.png'))
print('wrote christmas_tree.png (32x64) and client/public/assets/buildings/christmastree.png')
