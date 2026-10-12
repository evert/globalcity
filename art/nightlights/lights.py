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
#   ('onlyon', x0, y0, x1, y1, cols)  in the rectangle, drop lights whose day colour isn't in cols
#   ('dots', x0, y0, x1, y1, cols)    light the pixels of those colours that stand alone (no such neighbour left or right)
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

# Approved in review: round 1 (as detected), rounds 2 to 5
APPROVED = {'H01', 'H02', 'H03', 'H04', 'H06', 'R14', 'I01', 'I05',
            'C01', 'C02', 'C03', 'C11', 'C17', 'FIRE', 'GC', 'H05', 'H07', 'H08', 'H09', 'H10', 'H11', 'H12', 'HOS', 'I03', 'I04',
            'I06', 'NUC', 'PORT', 'R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R08', 'R12', 'R13', 'R16', 'SCH', 'STAD', 'STAD2', 'UNI',
            'C06', 'C07', 'C08', 'C09', 'C10', 'C12', 'C19', 'C20', 'CHU', 'COAL', 'I02', 'I07', 'R07', 'R10', 'R11', 'R15',
            'AIR', 'C04', 'C05', 'C13', 'C16', 'HALL', 'R09', 'C15', 'C18', 'POL'}

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
    'R07': [('none',), ('pix', 18, 20, 41, 24, {TAN}, LIT), ('pix', 0, 37, 13, 43, {TAN}, LIT), ('pix', 3, 8, 9, 44, {BLACK}, 1)],
    'R08': [('pix', 3, 4, 13, 37, {DGREY}, 0.6)],
    'R09': [('add', [(4, 7), (4, 11), (4, 15), (4, 19), (4, 23), (4, 27)]), ('row', 7, 15, 13, 3), ('row', 6, 14, 29, 3),
            ('pix', 30, 5, 33, 24, {DGREEN}, 0.8), ('row', 33, 42, 26, 2)],
    'R10': [('clear', 17, 3, 45, 10), ('clear', 33, 15, 45, 19), ('clear', 33, 29, 47, 47),
            ('row', 10, 30, 40, 3), ('row', 11, 29, 42, 3), ('pix', 5, 6, 8, 44, {BLUE}, 0.6), ('pix', 28, 14, 32, 24, {TAN}, 1)],
    'R11': [('none',), ('pix', 8, 37, 30, 42, {DGREY}, 0.25), ('pix', 2, 2, 8, 44, {GREY}, 0.25), ('row', 34, 41, 37, 2), ('row', 35, 42, 13, 2)],
    'R12': [('share', 0.9)],
    'R13': [('clear', 20, 3, 41, 10), ('clear', 20, 16, 26, 20), ('clear', 33, 29, 38, 34),
            ('row', 20, 40, 12, 3), ('add', [(7, 6), (7, 9), (7, 12), (7, 38), (7, 41), (32, 38), (32, 41)]), ('row', 10, 30, 44, 3)],
    'R15': [('none',), ('pix', 0, 0, 47, 47, {DGREY}, 0.5), ('clear', 17, 0, 28, 15), ('clear', 34, 18, 47, 33), ('clear', 8, 24, 22, 36)],
    'C01': [('none',)],
    'C02': [('none',)],
    'C03': [('clear', 8, 3, 44, 30), ('pix', 3, 4, 7, 32, {BLACK}, 1), ('row', 18, 28, 15, 3)],
    'C04': [('share', 1), ('pix', 8, 35, 44, 44, {BLACK}, 1), ('row', 12, 42, 38, 3), ('row', 10, 42, 41, 3), ('keep', 16, 35, 47, 47),
            ('onlyon', 0, 0, 47, 47, {BLUE, BLACK})],
    'C05': [('share', 1), ('pix', 4, 35, 46, 44, {BLACK}, 0.9), ('clear', 23, 26, 29, 40), ('pix', 3, 3, 12, 42, {BLUE}, 0.3), ('clear', 35, 27, 41, 33)],
    'C06': [('none',), ('row', 5, 15, 21, 2), ('row', 19, 31, 44, 2), ('colour', NEON_RED), ('pix', 33, 14, 45, 19, {ORANGE}, 1)],
    'C07': [('clear', 24, 30, 47, 47), ('clear', 0, 39, 23, 47), ('pix', 9, 22, 23, 38, {WHITE_}, 1), ('row', 23, 43, 16, 2), ('pix', 21, 5, 24, 15, {BLUE}, 1)],
    'C08': [('none',), ('pix', 3, 8, 6, 37, {DGREY}, 1), ('pix', 18, 9, 24, 21, {DGREY}, 1), ('pix', 3, 38, 16, 42, {DGREY}, 1),
            ('pix', 28, 38, 40, 42, {DGREY}, 1), ('pix', 23, 22, 37, 31, {BLACK}, 1)],
    'C09': [('pix', 10, 28, 47, 43, {BLACK}, 1), ('pix', 6, 1, 20, 40, {WHITE_}, 1)],
    'C10': [('pix', 3, 1, 44, 42, {WHITE_}, 0.9), ('clear', 35, 39, 37, 41)],
    'C11': [('clear', 4, 17, 47, 47)],
    'C12': [('share', 1), ('pix', 4, 15, 32, 19, {BLACK}, 1), ('row', 31, 44, 42, 2), ('row', 12, 17, 33, 2), ('clear', 9, 30, 19, 37),
            ('pix', 28, 17, 32, 42, {BLACK}, 1), ('add', [(30, y) for y in range(22, 41, 4)])],
    'C13': [('share', 0.9), ('row', 7, 41, 42, 3), ('onlyon', 0, 40, 47, 47, {BLUE}), ('clear', 39, 41, 43, 43)],
    'C14': [('pix', 15, 5, 28, 31, {LGREY}, 1), ('dots', 20, 19, 44, 31, {DGREY})],
    'C15': [('none',), ('dots', 23, 26, 43, 43, {GREY, BLACK}), ('dots', 8, 37, 22, 43, {GREY, BLACK})],
    'C16': [('none',)],
    'C17': [('none',)],
    'C18': [('none',), ('vwin', 4, 4, 12, 36, {BLACK}, 0.6), ('win', 6, 36, 44, 45, {BLACK}, 0.7), ('win', 28, 34, 44, 46, {BLACK}, 0.9), ('clear', 29, 34, 44, 39),
            ('win', 27, 12, 43, 14, {DGREY}, 1)],
    'C19': [('none',), ('pix', 8, 41, 30, 43, {BLACK}, 1)],
    'C20': [('none',)],
    'I02': [('pix', 27, 12, 36, 40, {BLACK}, 1), ('pix', 37, 12, 45, 40, {DGREY}, 1), ('win', 3, 23, 24, 26, {BLACK}, 1)],
    'I03': [('none',), ('pix', 1, 15, 3, 21, {BLACK}, 1), ('pix', 7, 20, 13, 22, {BLACK}, 1)],
    'I04': [('clear', 5, 0, 47, 40)],
    'I06': [('none',)],
    'I07': [('clear', 5, 2, 40, 22), ('clear', 30, 27, 42, 35), ('clear', 0, 26, 28, 47)],
    'I08': [('none',), ('pix', 4, 37, 46, 44, {BLACK}, 1), ('row', 10, 38, 41, 4), ('clear', 0, 0, 47, 39), ('clear', 24, 0, 47, 47)],
    'PORT': [('none',), ('row', 17, 45, 38, 3)],
    'COAL': [('clear', 7, 0, 40, 43), ('clear', 7, 44, 40, 54)],
    'NUC': [('clear', 16, 0, 63, 46)],
    'FIRE': [('pix', 3, 6, 12, 44, {TAN}, 0.6), ('pix', 10, 39, 42, 43, {TAN}, 0.6)],
    'POL': [('none',), ('pix', 2, 10, 7, 10, {BLUE}, 1), ('pix', 2, 14, 7, 14, {BLUE}, 1), ('pix', 2, 18, 7, 18, {BLUE}, 1), ('pix', 2, 22, 7, 22, {BLUE}, 1),
            ('vwin', 11, 10, 13, 20, {BLACK}, 1), ('pix', 15, 12, 18, 12, {BLUE}, 1), ('pix', 15, 17, 18, 17, {BLUE}, 1), ('pix', 15, 22, 18, 22, {BLUE}, 1),
            ('row', 19, 37, 24, 3), ('row', 20, 35, 26, 3), ('row', 21, 39, 28, 3), ('dots', 17, 27, 40, 30, {BLACK}), ('dots', 6, 26, 16, 30, {BLACK})],
    'STAD': [('none',)],
    'STAD2': [('clear', 27, 0, 63, 63), ('colour', FLOOD), ('wash', 32, 19, 51, 44, 90),
              ('add', [(31, 6), (32, 6), (31, 7), (32, 7), (53, 6), (54, 6), (53, 7), (54, 7),
                       (31, 53), (32, 53), (31, 54), (32, 54), (53, 53), (54, 53), (53, 54), (54, 54)])],
    'AIR': [('none',), ('colour', RED_L), ('pix', 0, 0, 95, 95, {RED}, 1), ('colour', RUNWAY), ('add', runway_edges()),
            ('row', 8, 90, 18, 6), ('colour', GREEN_L), ('add', [(4, y) for y in range(13, 24, 2)] + [(x, 2) for x in range(71, 82, 2)]),
            ('colour', TAXI), ('add', [(87, y) for y in range(56, 77, 3)] + [(x, 25) for x in range(8, 66, 6)]),
            ('colour', WHITE), ('pix', 38, 36, 64, 52, {BLACK}, 0.4),
            # the terminal is the ring at the bottom left: its window dots, outside and round the courtyard
            ('dots', 1, 60, 33, 92, {LGREY}), ('dots', 9, 65, 27, 82, {GREY})],
    'HOS': [('win', 8, 31, 34, 39, {DGREY}, 0.7)],
    'CHU': [('none',), ('pix', 7, 9, 10, 33, {BLACK, GREY}, 1), ('win', 11, 34, 18, 38, {BLACK}, 1), ('win', 35, 34, 38, 38, {BLACK}, 1)],
    'HALL': [('none',), ('dots', 14, 10, 50, 43, {BLACK}), ('dots', 13, 10, 22, 35, {GREY})],
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
        elif op == 'onlyon':
            _, x0, y0, x1, y1, cols = e
            lit = {(x, y): v for (x, y), v in lit.items() if not (x0 <= x <= x1 and y0 <= y <= y1) or pix(p, x, y) in cols}
        elif op == 'keep':
            _, x0, y0, x1, y1 = e
            lit = {(x, y): v for (x, y), v in lit.items() if x0 <= x <= x1 and y0 <= y <= y1}
        elif op == 'dots':
            _, x0, y0, x1, y1, cols = e
            for y in range(y0, y1 + 1):
                for x in range(x0, x1 + 1):
                    if pix(p, x, y) in cols and pix(p, x - 1, y) not in cols and pix(p, x + 1, y) not in cols: lit[(x, y)] = (col, 255)
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
