"""Build client/public/assets/micropolis/tiles.png = the original Micropolis sheet (960 tiles, 16 per row)
plus GlobalCity additions appended as extra rows. Each addition is a footprint image whose tiles are laid
out row-major (dy*size+dx) starting at its base tile id, matching shared/src/tiles.ts.

Run: python3 art/sheet/build_sheet.py, then `npm run gen:sheet -w tools` to rebuild skins.png (every tile in every
biome, frozen and border look; see shared/src/looks.ts) from the new tiles.png.
"""
import json, os
from PIL import Image
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
ORIG = os.path.join(ROOT, 'art/sheet/micropolis-tiles-original.png')
OUT = os.path.join(ROOT, 'client/public/assets/micropolis/tiles.png')
T, COLS = 16, 16
# (base id, footprint size, source image) -- keep in sync with shared/src/tiles.ts
ADDITIONS = [
    (960, 4, 'art/prototype/civic/city_hall_v3.png'),  # CITYHALLBASE (oblique redraw)
    (976, 3, 'art/prototype/civic/school.png'),        # SCHOOLBASE
    (985, 4, 'art/prototype/utilities/wind_farm.png'), # WINDBASE
]
# OFFSHOREBASE (1001, 4x4) is added when art/prototype/utilities/offshore_wind.png exists.
if os.path.exists(os.path.join(ROOT, 'art/prototype/utilities/offshore_wind.png')):
    ADDITIONS.append((1001, 4, 'art/prototype/utilities/offshore_wind.png'))
orig = Image.open(ORIG).convert('RGB')
count = max([960] + [b + s * s for b, s, _ in ADDITIONS])
rows = (max(count, 1023) + COLS - 1) // COLS
sheet = Image.new('RGB', (COLS * T, rows * T), (0, 0, 0))
sheet.paste(orig, (0, 0))
for base, size, src in ADDITIONS:
    im = Image.open(os.path.join(ROOT, src)).convert('RGB')
    assert im.size == (size * T, size * T), f'{src}: expected {size*T}px, got {im.size}'
    for k in range(size * size):
        dy, dx = divmod(k, size)
        tid = base + k
        sheet.paste(im.crop((dx * T, dy * T, dx * T + T, dy * T + T)), ((tid % COLS) * T, (tid // COLS) * T))
# Custom-building layer tiles (CUSTOMFILL 1017, CUSTOMCENTRE 1018): plain pavement; the client draws the
# building image on top, so these only show if that image fails to load.
from PIL import ImageDraw
for tid in (1017, 1018):
    t = Image.new('RGB', (T, T), (0x7f, 0x7f, 0x7f))
    d = ImageDraw.Draw(t)
    for i in range(0, T, 4): d.point((i + (tid % 2) * 2, (i * 3) % T), fill=(0x3f, 0x3f, 0x3f))
    sheet.paste(t, ((tid % COLS) * T, (tid // COLS) * T))
# Underwater power line corners (UWPOWER_NE/SE/SW/NW = 1019..1022), in the style of 208/209: two dotted
# cables on water. Straights run at x=6,9 (north-south) and y=5,8 (east-west); a corner bends the outer
# cable around the inner one so both meet the neighbouring straights at the tile edges.
WATER, LIGHT, DARK = (0x66, 0x66, 0xe6), (0xbf, 0xbf, 0xbf), (0x7f, 0x7f, 0x7f)
def corner(vert, horiz):
    # vert: 'N' or 'S' (which edge the cables leave through), horiz: 'E' or 'W'
    t = Image.new('RGB', (T, T), WATER)
    px = t.load()
    lanes_x = [6, 9] if horiz == 'E' else [9, 6]   # outer first (farther from the E/W edge)
    lanes_y = [8, 5] if vert == 'N' else [5, 8]    # outer first (farther from the N/S edge)
    for lx, ly in zip(lanes_x, lanes_y):
        ys = range(0, ly + 1) if vert == 'N' else range(ly, T)
        for y in ys:
            if y % 2 == 0: px[lx, y] = LIGHT if y % 4 == 0 else DARK
        xs = range(lx + 1, T) if horiz == 'E' else range(0, lx)
        for x in xs:
            if x % 2 == 0: px[x, ly] = DARK if x % 4 == 0 else LIGHT
    return t
for tid, (v, h) in zip(range(1019, 1023), [('N', 'E'), ('S', 'E'), ('S', 'W'), ('N', 'W')]):
    sheet.paste(corner(v, h), ((tid % COLS) * T, (tid // COLS) * T))
count = max(count, 1023)
sheet.save(OUT)
json.dump({'tileSize': T, 'width': sheet.width, 'height': sheet.height, 'cols': COLS, 'count': count},
          open(os.path.join(os.path.dirname(OUT), 'tiles.json'), 'w'))
print(f'wrote {OUT}: {sheet.width}x{sheet.height}, {count} tiles')
