# Night lights for every building, authored per building. Each starts from the detected window dots (a share of
# them lit), then a list of edits shapes it. `python3 lights.py` writes the lights sheet the game draws at night:
#   client/public/assets/micropolis/tiles-night.png   same layout as tiles.png, lit pixels only
#   client/public/assets/buildings/<kind>-night.png   one per custom building (one frame)
# Opaque pixels are lights (they get a soft halo in game); translucent pixels are a wash of light (no halo).
#
# Edits, in building pixel coordinates (x, y), rectangles inclusive:
#   ('none',)                         drop every light so far
#   ('share', s[, 'wide'])            redo the detected windows with share s lit (0..1); 'wide' also finds windows
#                                     across tile edges
#   ('clear', x0, y0, x1, y1)         drop lights in the rectangle
#   ('pix', x0, y0, x1, y1, cols, s)  light share s of the pixels in the rectangle whose day colour is in cols
#   ('win', x0, y0, x1, y1, cols, s)  like pix, but a run of such pixels side by side is one window, lit or not as a whole
#   ('vwin', x0, y0, x1, y1, cols, s) the same with windows running down instead of across
#   ('keep', x0, y0, x1, y1)          drop lights outside the rectangle
#   ('add', [(x, y), ...])            light these pixels
#   ('row', x0, x1, y, step)          light every `step`th pixel from x0 to x1 on row y
#   ('wash', x0, y0, x1, y1, a)       a wash of light over the rectangle, alpha a (0..255)
#   ('pixwash', x0, y0, x1, y1, cols, a)  a wash only over the pixels whose day colour is in cols
#   ('colour', rgb)                   colour for the edits that follow (default: the building's)
import sys
from PIL import Image
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from common import *

LIT = 0.7
BLACK, DGREY, GREY, LGREY, WHITE_, BLUE, LBLUE, RED = 0x000000, 0x3f3f3f, 0x7f7f7f, 0xbfbfbf, 0xffffff, 0x0000e6, 0x6666e6, 0xff0000
TAN, DGREEN, GREEN, YELLOW, ORANGE = 0x997f4c, 0x007f00, 0x00e600, 0xffff00, 0xff7f00
NEON_RED = (255, 60, 70)
RUNWAY, TAXI, GREEN_L, RED_L, FLOOD = (255, 248, 225), (90, 140, 255), (90, 255, 140), (255, 70, 60), (235, 245, 255)
HALL_GLOW = (255, 214, 140)

def runway_edges():
    out = []
    for x in range(6, 91, 4): out += [(x, 12), (x, 24)]  # the east-west runway
    for y in list(range(4, 11, 3)) + list(range(28, 91, 4)): out += [(70, y), (82, y)]  # the north-south one
    return out

# Approved as detected (no edits needed)
APPROVED = {'H01', 'H02', 'H03', 'H04', 'H06', 'R14', 'I01', 'I05'}

EDITS = {
    # houses: no window dots in the art, so the windows are placed by hand on the walls
    'H05': [('add', [(3, 5), (3, 7), (7, 8), (10, 8)])],
    'H07': [('add', [(3, 3), (3, 6), (11, 8), (11, 11)])],
    'H08': [('add', [(1, 6), (1, 9), (9, 5), (4, 12), (8, 12), (12, 12)])],
    'H09': [('add', [(3, 4), (3, 7), (3, 10), (9, 9), (5, 13)])],
    'H10': [('none',), ('add', [(3, 8), (7, 8), (11, 8)])],
    'H11': [('add', [(2, 8), (2, 11), (13, 8), (13, 11), (6, 9), (9, 9)])],
    'H12': [('add', [(1, 5), (1, 11)])],
    # residential
    'R01': [('pix', 14, 16, 43, 16, {GREY, LGREY, WHITE_}, LIT), ('pix', 14, 17, 30, 19, {GREY, LGREY, WHITE_}, LIT), ('pix', 31, 33, 42, 34, {GREY, LGREY, WHITE_}, LIT)],
    'R02': [('pix', 8, 13, 34, 16, {DGREY}, LIT)],
    'R03': [('clear', 0, 0, 47, 4), ('row', 31, 43, 42, 3), ('row', 33, 43, 44, 4)],
    'R04': [('win', 8, 35, 39, 37, {BLACK, GREY}, LIT), ('win', 6, 38, 44, 44, {BLACK, GREY}, LIT)],
    'R05': [('none',), ('row', 4, 4, 8, 1), ('add', [(4, 12), (4, 16), (4, 20), (4, 24), (4, 28), (4, 32), (4, 36), (4, 40)]),
            ('row', 7, 19, 42, 3), ('row', 32, 42, 26, 3), ('add', [(26, 8), (26, 11)])],
    'R06': [('clear', 17, 18, 27, 28), ('pix', 33, 40, 44, 44, {RED}, 1)],
    'R07': [('none',), ('pix', 18, 20, 41, 24, {TAN}, LIT), ('pix', 0, 37, 13, 43, {TAN}, LIT)],
    'R08': [('pix', 3, 4, 13, 37, {DGREY}, 0.6)],
    'R09': [('add', [(4, 7), (4, 11), (4, 15), (4, 19), (4, 23), (4, 27)]), ('row', 7, 15, 13, 3), ('row', 6, 14, 29, 3),
            ('win', 16, 9, 26, 17, {BLACK}, 1)],
    'R10': [('clear', 17, 3, 45, 10), ('clear', 33, 15, 45, 19), ('clear', 33, 29, 47, 47),
            ('row', 10, 30, 40, 3), ('row', 11, 29, 42, 3)],
    'R11': [('none',), ('pix', 8, 37, 30, 42, {DGREY}, 0.5), ('pix', 2, 2, 8, 44, {GREY}, 0.5),
            ('add', [(41, 31), (41, 33), (41, 35)]), ('row', 34, 41, 37, 2), ('row', 35, 42, 13, 2)],
    'R12': [('share', 0.9)],
    'R13': [('clear', 20, 3, 41, 10), ('clear', 20, 16, 26, 20), ('clear', 33, 29, 38, 34),
            ('row', 20, 40, 12, 3), ('add', [(7, 6), (7, 9), (7, 12), (7, 38), (7, 41), (32, 38), (32, 41)]), ('row', 10, 30, 44, 3)],
    'R15': [('none',), ('pix', 0, 0, 47, 47, {DGREY}, 0.5)],
    'C01': [('none',)],
    'C02': [('none',)],
    'C03': [('clear', 8, 3, 44, 30), ('pix', 3, 4, 7, 32, {BLACK}, 1), ('row', 18, 28, 15, 3)],
    'C04': [('share', 1), ('pix', 8, 35, 44, 44, {BLACK}, 1), ('row', 12, 42, 38, 3), ('row', 10, 42, 41, 3)],
    'C05': [('share', 1), ('pix', 4, 35, 46, 44, {BLACK}, 0.9)],
    'C06': [('none',), ('row', 5, 15, 21, 2), ('row', 19, 35, 44, 2), ('colour', NEON_RED), ('pix', 33, 14, 45, 19, {ORANGE}, 1)],
    'C07': [('clear', 24, 30, 47, 47), ('clear', 0, 39, 23, 47), ('pix', 9, 22, 23, 38, {WHITE_}, 1)],
    'C08': [('pix', 2, 4, 8, 44, {DGREY}, 0.6), ('pix', 17, 2, 25, 33, {DGREY}, 0.6), ('pix', 18, 21, 44, 32, {BLACK}, 0.8),
            ('pix', 26, 33, 33, 42, {DGREY}, 0.6)],
    'C09': [('pix', 10, 28, 47, 43, {BLACK}, 1)],
    'C10': [('pix', 3, 1, 44, 42, {WHITE_}, 0.9)],
    'C11': [('clear', 4, 17, 47, 47)],
    'C12': [('share', 1), ('pix', 4, 15, 32, 19, {BLACK}, 1), ('row', 31, 44, 42, 2), ('row', 12, 17, 33, 2)],
    'C13': [('share', 0.9)],
    'C14': [('pix', 15, 5, 28, 31, {LGREY}, LIT)],
    'C15': [('share', 0.9), ('pix', 36, 26, 45, 43, {GREY}, 0.6)],
    'C16': [('none',), ('row', 22, 42, 10, 3), ('win', 12, 11, 46, 27, {RED, BLUE}, 1)],
    'C17': [('none',)],
    'C18': [('none',), ('vwin', 4, 4, 12, 36, {BLACK}, 0.6), ('win', 6, 36, 44, 45, {BLACK}, 0.7)],
    'C19': [('keep', 8, 30, 20, 37)],
    'C20': [('clear', 5, 2, 24, 20), ('pix', 7, 3, 21, 19, {DGREY}, 0.85), ('clear', 10, 21, 30, 47)],
    'I02': [('pix', 27, 12, 36, 40, {BLACK}, 1), ('pix', 37, 12, 45, 40, {DGREY}, 1), ('win', 3, 23, 24, 26, {BLACK}, 1), ('row', 5, 23, 28, 3)],
    'I03': [('none',), ('pix', 1, 15, 3, 21, {BLACK}, 1), ('pix', 7, 20, 13, 22, {BLACK}, 1)],
    'I04': [('clear', 5, 0, 47, 40)],
    'I06': [('none',)],
    'I07': [('clear', 5, 2, 40, 22), ('clear', 30, 27, 42, 35)],
    'I08': [('clear', 5, 2, 45, 34)],
    'PORT': [('none',), ('row', 17, 45, 38, 3)],
    'COAL': [('clear', 7, 0, 40, 43)],
    'NUC': [('clear', 16, 0, 63, 46)],
    'FIRE': [('pix', 3, 6, 12, 44, {TAN}, 0.6), ('pix', 10, 39, 42, 43, {TAN}, 0.6)],
    'POL': [('pix', 2, 6, 17, 30, {BLUE}, 0.5)],
    'STAD': [('none',)],
    'STAD2': [('clear', 27, 0, 63, 63), ('colour', FLOOD), ('wash', 32, 19, 51, 44, 90),
              ('add', [(31, 6), (32, 6), (31, 7), (32, 7), (53, 6), (54, 6), (53, 7), (54, 7),
                       (31, 53), (32, 53), (31, 54), (32, 54), (53, 53), (54, 53), (53, 54), (54, 54)])],
    'AIR': [('none',), ('colour', RED_L), ('pix', 0, 0, 95, 95, {RED}, 1), ('colour', RUNWAY), ('add', runway_edges()),
            ('row', 8, 90, 18, 6), ('colour', GREEN_L), ('add', [(4, y) for y in range(13, 24, 2)] + [(x, 2) for x in range(71, 82, 2)]),
            ('colour', TAXI), ('add', [(87, y) for y in range(56, 77, 3)] + [(x, 25) for x in range(8, 66, 6)]),
            ('colour', WHITE), ('row', 4, 36, 57, 2), ('add', [(37, y) for y in range(59, 80, 3)]), ('pix', 38, 36, 64, 52, {BLACK}, 0.4)],
    'HOS': [('win', 8, 31, 34, 39, {DGREY}, 0.7)],
    'CHU': [('none',), ('pix', 8, 8, 11, 32, {BLACK}, 1), ('win', 11, 34, 27, 38, {BLACK}, 1), ('win', 35, 34, 38, 38, {BLACK}, 1)],
    'HALL': [('none',), ('pix', 24, 33, 42, 39, {WHITE_}, 0.85), ('pix', 19, 30, 27, 30, {BLACK}, 1), ('add', [(23, 33), (46, 30)])],
    'SCH': [('none',)],
    'UNI': [('clear', 44, 6, 52, 19), ('clear', 36, 38, 44, 46)],
    'GC': [('none',), ('colour', HALL_GLOW), ('pixwash', 38, 16, 64, 23, {BLUE, LBLUE}, 110),
           ('colour', SOFT), ('win', 25, 17, 39, 21, {DGREY}, 0.6), ('win', 67, 18, 82, 22, {DGREY}, 0.6)],
    'R16': [('clear', 30, 31, 34, 35), ('clear', 19, 18, 23, 22), ('clear', 10, 36, 47, 46), ('win', 10, 37, 44, 45, {DGREY}, 0.8)],
}

def detected(day, share, base, n, wide=False):
    """Detected window dots with `share` lit. Tiles are looked at one by one with the same pick as the first
    in-game version (what the review started from); `wide` looks across tile edges too. Custom art: n = 0."""
    p = day.load()
    if n == 0:
        wins = find_windows(lambda x, y: pix(p, x, y), day.width, day.height, lambda c: c >= 0 and c not in GROUND)
        return [(x, y) for (x, y) in wins if hash01(x * 4096 + y, 11) < share]
    wins = find_windows(lambda x, y: pix(p, x, y), day.width, day.height, lambda c: c in WALL, tile=None if wide else 16)
    out = []
    for (x, y) in wins:
        t = base + (y // 16) * n + x // 16
        if hash01(t * 256 + (y % 16) * 16 + x % 16, 7) < share: out.append((x, y))
    return out

def render(code, day, colour, base, n):
    p = day.load()
    lit = {}
    col = colour
    for xy in detected(day, LIT, base, n): lit[xy] = (col, 255)
    for e in EDITS.get(code, []):
        op = e[0]
        if op == 'none': lit.clear()
        elif op == 'share':
            lit = {k: v for k, v in lit.items() if v[1] < 255}
            for xy in detected(day, e[1], base, n, len(e) > 2 and e[2] == 'wide'): lit[xy] = (col, 255)
        elif op == 'clear':
            _, x0, y0, x1, y1 = e
            lit = {(x, y): v for (x, y), v in lit.items() if not (x0 <= x <= x1 and y0 <= y <= y1)}
        elif op == 'pix':
            _, x0, y0, x1, y1, cols, s = e
            for y in range(y0, y1 + 1):
                for x in range(x0, x1 + 1):
                    if pix(p, x, y) in cols and hash01(base * 65536 + y * 256 + x, 13) < s: lit[(x, y)] = (col, 255)
        elif op == 'win':
            _, x0, y0, x1, y1, cols, s = e
            for y in range(y0, y1 + 1):
                x = x0
                while x <= x1:
                    if pix(p, x, y) not in cols: x += 1; continue
                    run = x
                    while x <= x1 and pix(p, x, y) in cols: x += 1
                    if hash01(base * 65536 + y * 256 + run, 17) < s:
                        for xx in range(run, x): lit[(xx, y)] = (col, 255)
        elif op == 'vwin':
            _, x0, y0, x1, y1, cols, s = e
            for x in range(x0, x1 + 1):
                y = y0
                while y <= y1:
                    if pix(p, x, y) not in cols: y += 1; continue
                    run = y
                    while y <= y1 and pix(p, x, y) in cols: y += 1
                    if hash01(base * 65536 + run * 256 + x, 19) < s:
                        for yy in range(run, y): lit[(x, yy)] = (col, 255)
        elif op == 'keep':
            _, x0, y0, x1, y1 = e
            lit = {(x, y): v for (x, y), v in lit.items() if x0 <= x <= x1 and y0 <= y <= y1}
        elif op == 'add':
            for xy in e[1]: lit[tuple(xy)] = (col, 255)
        elif op == 'row':
            _, x0, x1, y, step = e
            for x in range(x0, x1 + 1, step): lit[(x, y)] = (col, 255)
        elif op == 'wash':
            _, x0, y0, x1, y1, a = e
            for y in range(y0, y1 + 1):
                for x in range(x0, x1 + 1):
                    if (x, y) not in lit or lit[(x, y)][1] < 255: lit[(x, y)] = (col, a)
        elif op == 'pixwash':
            _, x0, y0, x1, y1, cols, a = e
            for y in range(y0, y1 + 1):
                for x in range(x0, x1 + 1):
                    if pix(p, x, y) in cols and ((x, y) not in lit or lit[(x, y)][1] < 255): lit[(x, y)] = (col, a)
        elif op == 'colour': col = e[1]
        else: raise ValueError(f'{code}: unknown edit {op}')
    return lit

def render_building(code):
    for (c, name, group, base, n, colour) in BUILDINGS:
        if c == code: return building_day(base, n), render(code, building_day(base, n), colour, base, n)
    for (c, name, kind, frames) in CUSTOMS:
        if c == code: return custom_day(kind, frames), render(code, custom_day(kind, frames), SOFT, 0, 0)
    raise KeyError(code)

def build():
    sheet = Image.new('RGBA', SHEET.size, (0, 0, 0, 0))
    sp = sheet.load()
    for (code, name, group, base, n, colour) in BUILDINGS:
        _, lit = render_building(code)
        for (x, y), (c, a) in lit.items():
            t = base + (y // 16) * n + (x // 16)
            sp[(t % 16) * 16 + x % 16, (t // 16) * 16 + y % 16] = (*c, a)
    sheet.save(f'{ASSETS}/micropolis/tiles-night.png', optimize=True)
    for (code, name, kind, frames) in CUSTOMS:
        day, lit = render_building(code)
        im = Image.new('RGBA', day.size, (0, 0, 0, 0))
        for (x, y), (c, a) in lit.items(): im.putpixel((x, y), (*c, a))
        im.save(f'{ASSETS}/buildings/{kind}-night.png', optimize=True)

if __name__ == '__main__':
    build()
    print('wrote tiles-night.png and', ', '.join(k for (_, _, k, _) in CUSTOMS), 'night images')
