"""Mock city at game scale: all prototype buildings mixed with original Micropolis buildings on a road grid."""
import json, os, random
from PIL import Image
HERE = os.path.dirname(__file__)
sheet = Image.open(os.path.join(HERE, '../../client/public/assets/micropolis/tiles.png')).convert('RGB')
T = 16
def tile(i): return sheet.crop(((i % 16) * T, (i // 16) * T, (i % 16) * T + T, (i // 16) * T + T))
def block(base, size):
    im = Image.new('RGB', (T * size, T * size))
    for dy in range(size):
        for dx in range(size): im.paste(tile(base + dy * size + dx), (dx * T, dy * T))
    return im
ROAD_TABLE = [66, 67, 66, 68, 67, 67, 69, 73, 66, 71, 66, 72, 70, 75, 74, 76]
random.seed(7)
# new buildings
new = []
for group in ('civic', 'utilities', 'leisure'):
    meta = json.load(open(os.path.join(HERE, group, 'meta.json')))
    for slug, m in meta.items():
        if slug.startswith('_') or slug == 'demo': continue
        new.append(('new', Image.open(os.path.join(HERE, group, slug + '.png')).convert('RGB'), m['tiles'], m['name']))
orig = [(n, b, s) for n, b, s in [('res', 265 + 9 * 15 - 4, 3), ('res', 265 + 9 * 6 - 4, 3), ('res', 265 + 9 * 10 - 4, 3), ('com', 436 + 9 * 19 - 4, 3), ('com', 436 + 9 * 8 - 4, 3),
       ('com', 436 + 9 * 13 - 4, 3), ('ind', 625 - 4, 3), ('ind', 625 + 9 * 7 - 4, 3), ('hospital', 405, 3), ('church', 414, 3), ('coal', 745, 4), ('stadium', 779, 4), ('police', 770, 3)]]
items = new + [('orig', block(b, s), s, n) for n, b, s in orig]
random.shuffle(items)
COLS, ROWS, CELL = 8, 5, 5           # each cell: 4x4 lot + 1 road
W, H = COLS * CELL + 1, ROWS * CELL + 1
scene = Image.new('RGB', (W * T, H * T))
dirt = tile(0)
for y in range(H):
    for x in range(W): scene.paste(dirt, (x * T, y * T))
road = lambda x, y: x % CELL == 0 or y % CELL == 0
for y in range(H):
    for x in range(W):
        if not road(x, y): continue
        m = (1 if y > 0 and road(x, y - 1) else 0) | (2 if x < W - 1 and road(x + 1, y) else 0) | (4 if y < H - 1 and road(x, y + 1) else 0) | (8 if x > 0 and road(x - 1, y) else 0)
        scene.paste(tile(ROAD_TABLE[m]), (x * T, y * T))
for k, (kind, im, size, name) in enumerate(items[:COLS * ROWS]):
    cx, cy = (k % COLS) * CELL + 1, (k // COLS) * CELL + 1
    off = 0 if size == 4 else random.choice([0, 1])
    offy = 0 if size == 4 else random.choice([0, 1])
    scene.paste(im, ((cx + off) * T, (cy + offy) * T))
scene.save(os.path.join(HERE, 'scene.png'))
scene.resize((scene.width * 2, scene.height * 2), Image.NEAREST).save(os.path.join(HERE, 'scene@2x.png'))
print('scene', scene.size, 'new', len(new), 'original', len(orig))
