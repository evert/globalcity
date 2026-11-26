"""Christmas tree: a tall decorated fir on a small town square, 2 tiles wide by 4 tall (32x64 px).

The fir was generated with the sprite-ai MCP (christmas_tree_ai.png, generation
9200c525-e71c-41f2-8e5e-b3b61c84c4ea) and is mapped here onto the 14 Micropolis colours. The square
round its foot (paving, lamps, benches, small round trees, people) is drawn by hand, and the fir's shadow
is cast east by darkening the ground, the way the originals do. The baubles, tinsel, star, fairy lights
and lamps light up at night via the edits for 'XMAS' in art/nightlights/lights.py.

Run: python3 art/prototype/seasonal/christmas_tree.py   (writes christmas_tree.png, @4x, and the game
copy client/public/assets/buildings/christmastree.png; then run art/nightlights/lights.py)
"""
import os, sys, json, shutil
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'civic'))
from _civ import *  # noqa: F401,F403  (pixlib colours + ground, shade_mask)

W, H = 32, 64
im = ground(4, 'grass', 'christmas_tree').crop((0, 0, W, H))
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

# small round trees on the grass behind the square
def round_tree(x, y):
    for dx, dy in [(1, 0), (2, 0), (0, 1), (1, 1), (2, 1), (1, 2)]: px(im, x + dx, y + dy, FOREST)
    for dx, dy in [(1, 0), (0, 1)]: px(im, x + dx, y + dy, GRASS)
    for dx, dy in [(3, 1), (2, 2), (1, 3)]: px(im, x + dx, y + dy, BLACK)
for (x, y) in [(1, 2), (26, 4), (2, 14), (27, 17), (1, 26), (27, 28), (0, 60), (28, 60)]: round_tree(x, y)

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
bad = {c for c in im.getdata() if c not in PALETTE}
assert not bad, f'off-palette colours {list(bad)[:5]}'
im.save(os.path.join(HERE, 'christmas_tree.png'))
im.resize((W * 4, H * 4), Image.NEAREST).save(os.path.join(HERE, 'christmas_tree@4x.png'))
json.dump({'christmas_tree': {'name': 'Christmas tree', 'w': 2, 'h': 4, 'zone': 'none',
           'idea': 'Seasonal decoration: a tall decorated fir on a little town square; its baubles, tinsel, star and lamps light up at night.'}},
          open(os.path.join(HERE, 'meta.json'), 'w'), indent=2)
shutil.copy(os.path.join(HERE, 'christmas_tree.png'),
            os.path.join(HERE, '..', '..', '..', 'client', 'public', 'assets', 'buildings', 'christmastree.png'))
print('wrote christmas_tree.png (32x64) and client/public/assets/buildings/christmastree.png')
