"""Build client/public/assets/micropolis/tiles.png = the original Micropolis sheet (960 tiles, 16 per row)
plus GlobalCity additions appended as extra rows. Each addition is a footprint image whose tiles are laid
out row-major (dy*size+dx) starting at its base tile id, matching shared/src/tiles.ts.

Run: python3 art/sheet/build_sheet.py
"""
import json, os
from PIL import Image
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
ORIG = os.path.join(ROOT, 'art/sheet/micropolis-tiles-original.png')
OUT = os.path.join(ROOT, 'client/public/assets/micropolis/tiles.png')
T, COLS = 16, 16
# (base id, footprint size, source image) -- keep in sync with shared/src/tiles.ts
ADDITIONS = [
    (960, 4, 'art/prototype/civic/city_hall.png'),  # CITYHALLBASE
]
orig = Image.open(ORIG).convert('RGB')
count = max([960] + [b + s * s for b, s, _ in ADDITIONS])
rows = (count + COLS - 1) // COLS
sheet = Image.new('RGB', (COLS * T, rows * T), (0, 0, 0))
sheet.paste(orig, (0, 0))
for base, size, src in ADDITIONS:
    im = Image.open(os.path.join(ROOT, src)).convert('RGB')
    assert im.size == (size * T, size * T), f'{src}: expected {size*T}px, got {im.size}'
    for k in range(size * size):
        dy, dx = divmod(k, size)
        tid = base + k
        sheet.paste(im.crop((dx * T, dy * T, dx * T + T, dy * T + T)), ((tid % COLS) * T, (tid // COLS) * T))
sheet.save(OUT)
json.dump({'tileSize': T, 'width': sheet.width, 'height': sheet.height, 'cols': COLS, 'count': count},
          open(os.path.join(os.path.dirname(OUT), 'tiles.json'), 'w'))
print(f'wrote {OUT}: {sheet.width}x{sheet.height}, {count} tiles')
