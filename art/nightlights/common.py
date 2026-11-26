# Shared pieces for the night lights: the building list, the window detector, and the tile sheet.
import math
from PIL import Image

ROOT = __file__.rsplit('/art/', 1)[0]
ASSETS = f'{ROOT}/client/public/assets'
SHEET = Image.open(f'{ASSETS}/micropolis/tiles.png').convert('RGB')

GROUND = {0xcc7f66, 0x997f4c, 0x00e600, 0x007f00}
WALL = {0x7f7f7f, 0x3f3f3f, 0xbfbfbf, 0x0000e6, 0x6666e6, 0xff0000}

# light colours (RGB)
WARM = (255, 210, 122)    # homes
WHITE = (255, 240, 200)   # shops, offices
AMBER = (255, 180, 90)    # industry
SOFT = (255, 230, 168)    # civic
KIND = {'H': WARM, 'R': WARM, 'C': WHITE, 'I': AMBER}

VAL = ['low value', 'mid value', 'high value', 'top value']
# code, name, group, first tile, size (tiles), light colour
BUILDINGS = []
for i in range(12): BUILDINGS.append((f'H{i+1:02d}', f'House {i+1}', 'Houses', 249 + i, 1, WARM))
for i in range(16): BUILDINGS.append((f'R{i+1:02d}', f'Residential, {VAL[i // 4]}, density {i % 4 + 1}', 'Residential', 261 + i * 9, 3, WARM))
BUILDINGS += [('HOS', 'Hospital', 'Civic', 405, 3, SOFT), ('CHU', 'Church', 'Civic', 414, 3, SOFT)]
for i in range(20): BUILDINGS.append((f'C{i+1:02d}', f'Commercial, {VAL[i // 5]}, density {i % 5 + 1}', 'Commercial', 432 + i * 9, 3, WHITE))
for i in range(8): BUILDINGS.append((f'I{i+1:02d}', f'Industrial, {"low" if i < 4 else "high"} value, density {i % 4 + 1}', 'Industrial', 621 + i * 9, 3, AMBER))
BUILDINGS += [('PORT', 'Seaport', 'Special', 693, 4, AMBER), ('AIR', 'Airport', 'Special', 709, 6, WHITE), ('COAL', 'Coal power plant', 'Special', 745, 4, AMBER),
              ('FIRE', 'Fire station', 'Civic', 761, 3, SOFT), ('POL', 'Police station', 'Civic', 770, 3, SOFT),
              ('STAD', 'Stadium (empty)', 'Special', 779, 4, WHITE), ('STAD2', 'Stadium (game on)', 'Special', 795, 4, WHITE),
              ('NUC', 'Nuclear power plant', 'Special', 811, 4, AMBER), ('HALL', 'City Hall', 'Civic', 960, 4, SOFT), ('SCH', 'Elementary school', 'Civic', 976, 3, SOFT)]
# custom buildings: code, name, kind (image name), frames
CUSTOMS = [('UNI', 'University', 'university', 1), ('GC', 'Grand Central', 'grandcentral', 8),
           ('XMAS', 'Christmas tree', 'christmastree', 1)]

def pix(p, x, y):
    r, g, b = p[x, y][:3]
    return (r << 16) | (g << 8) | b

def find_windows(get, w, h, is_wall, tile=None):
    """Window dots: a dot set in a wall (same colour left and right), not part of a line, checker or hatch.
    With `tile`, neighbours are only looked up inside the same tile (as the old in-game detector did)."""
    def at(x, y):
        if x < 0 or y < 0 or x >= w or y >= h: return -2
        if tile and (x // tile != cx or y // tile != cy): return -2
        return get(x, y)
    out = []
    for y in range(h):
        for x in range(w):
            cx, cy = (x // tile, y // tile) if tile else (0, 0)
            p, l, r = at(x, y), at(x - 1, y), at(x + 1, y)
            if p < 0 or p in GROUND or l != r or l == p or not is_wall(l): continue
            u, d = at(x, y - 1), at(x, y + 1)
            if u == p and d == p: continue
            if u != l and d != l: continue
            if p in (at(x - 1, y - 1), at(x + 1, y - 1), at(x - 1, y + 1), at(x + 1, y + 1)): continue
            out.append((x, y))
    return out

M = 0xffffffff
def hash01(a, b):
    return (((a * 2654435761) & M) ^ ((b * 2246822519) & M)) % 1000 / 1000

def building_day(base, n):
    im = Image.new('RGB', (n * 16, n * 16))
    for j in range(n):
        for i in range(n):
            t = base + j * n + i
            im.paste(SHEET.crop(((t % 16) * 16, (t // 16) * 16, (t % 16) * 16 + 16, (t // 16) * 16 + 16)), (i * 16, j * 16))
    return im

def custom_day(kind, frames):
    im = Image.open(f'{ASSETS}/buildings/{kind}.png').convert('RGB')
    return im.crop((0, 0, im.width // frames, im.height))
