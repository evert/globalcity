"""Rail station prototypes that join the existing rail network.

Every track inside a station is a row (or column) of the real Micropolis rail tile (LHRAIL 226 / LVRAIL 227),
pasted pixel for pixel and aligned to the tile grid. The first and last tile of each track are the untouched
rail tile, so a line built up to the station edge runs straight in. Platforms, canopies and halls are drawn
between and beside the tracks, never over the rail pixels at the ends.

Rail in Micropolis is single-line: rail tiles join every rail neighbour, so two parallel lines one tile apart
melt into junction pieces. Every station is therefore a through station on ONE line: the line enters and
leaves on the same tile row (or column), and extra platform tracks branch off and rejoin inside the
footprint. Any straight stretch of existing rail can take a station.

Three sizes, each east-west (tracks horizontal, hall on the north side) and north-south (tracks vertical,
hall on the west side):
  halt      3x2 / 2x3  one track,  a small booking hall and a canopy
  station   4x3 / 3x4  a passing loop: two platform tracks, a ticket hall
  grand     6x5 / 5x6  three platform tracks under a glazed train shed, a grand hall with a clock tower

Run: python3 art/prototype/stations/stations.py
"""
import os, sys, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from pixlib import *  # noqa
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
SHEET = Image.open(os.path.join(ROOT, 'art/sheet/micropolis-tiles-original.png')).convert('RGB')
OUT = os.path.dirname(os.path.abspath(__file__))
T = 16
LHRAIL, LVRAIL = 226, 227


def tile(t):
    return SHEET.crop(((t % 16) * T, (t // 16) * T, (t % 16) * T + T, (t // 16) * T + T))


def ground(w, h, seed=7):
    im = Image.new('RGB', (w * T, h * T), DIRT)
    for y in range(h * T):
        for x in range(w * T):
            r = (x * 73856093 ^ y * 19349663 ^ seed * 83492791) & 0xffff
            if r % 37 == 0: im.putpixel((x, y), DARK)
            elif r % 53 == 0: im.putpixel((x, y), SAND)
    return im


def rail_mask(t):
    """Pixels of a rail tile that are track (not the dirt around it)."""
    im = tile(t)
    return {(x, y) for y in range(T) for x in range(T) if im.getpixel((x, y)) != DIRT}


H_TRACK = rail_mask(LHRAIL)   # rows 3..13
V_TRACK = rail_mask(LVRAIL)


def track_row(im, row, cols):
    """Paste the rail tile along tile row `row` for `cols` tiles: track pixels only, keep what is around."""
    src = tile(LHRAIL)
    for c in range(cols):
        for (x, y) in H_TRACK:
            im.putpixel((c * T + x, row * T + y), src.getpixel((x, y)))


def track_col(im, col, rows):
    src = tile(LVRAIL)
    for r in range(rows):
        for (x, y) in V_TRACK:
            im.putpixel((col * T + x, r * T + y), src.getpixel((x, y)))


def ends_h(im, row, cols):
    """First and last tile of a horizontal track: the untouched rail tile (dirt above and below)."""
    for c in (0, cols - 1):
        im.paste(tile(LHRAIL), (c * T, row * T))


def ends_v(im, col, rows):
    for r in (0, rows - 1):
        im.paste(tile(LVRAIL), (col * T, r * T))


def _put(im, orient, a, c, col):
    x, y = (a, c) if orient == 'h' else (c, a)
    if 0 <= x < im.width and 0 <= y < im.height: im.putpixel((int(x), int(y)), col)


def branch(im, orient, main_row, loop_row, a0, a1, length):
    """A passing loop drawn in rail-tile style: leaves the main track at along-axis pixel a0, reaches tile row
    (or column) `loop_row` after `length` px, runs straight, and rejoins the main track at a1. Sleepers every
    4 px (K s s, as in the rail tile), rails 5 px apart, drawn sleepers first so switches read as switches."""
    c_main = main_row * T + 7.5
    c_loop = loop_row * T + 7.5
    def centre(a):
        if a < a0 + length: return c_main + (c_loop - c_main) * max(0, a - a0) / length
        if a > a1 - length: return c_main + (c_loop - c_main) * max(0, a1 - a) / length
        return c_loop
    # sleepers
    for a in range(a0 - a0 % 4 + 4, a1 - 3, 4):
        c = centre(a)
        for k, colr in ((0, BLACK), (1, SAND), (2, SAND)):
            cc = centre(a + k)
            for d in range(-4, 6):
                _put(im, orient, a + k, round(cc - 0.5) + d, colr if d < 5 else BLACK)
    # rails
    for off in (-2.5, 2.5):
        for a in range(a0, a1 + 1):
            _put(im, orient, a, round(centre(a) + off - 0.5) + (1 if off > 0 else 0), MID)


# ---------------------------------------------------------------- shared details

def platform_h(im, x0, x1, y0, y1, edge_top=True, edge_bottom=True):
    rect(im, x0, y0, x1, y1, LIGHT)
    if edge_top:
        line(im, [(x0, y0), (x1, y0)], WHITE)
        for x in range(x0, x1 + 1, 2): px(im, x, y0 + 1, YELLOW)
    if edge_bottom:
        line(im, [(x0, y1), (x1, y1)], MID)
        for x in range(x0 + 1, x1 + 1, 2): px(im, x, y1 - 1, YELLOW)


def platform_v(im, x0, x1, y0, y1, edge_left=True, edge_right=True):
    rect(im, x0, y0, x1, y1, LIGHT)
    if edge_left:
        line(im, [(x0, y0), (x0, y1)], WHITE)
        for y in range(y0, y1 + 1, 2): px(im, x0 + 1, y, YELLOW)
    if edge_right:
        line(im, [(x1, y0), (x1, y1)], MID)
        for y in range(y0 + 1, y1 + 1, 2): px(im, x1 - 1, y, YELLOW)


def canopy_h(im, x0, x1, y0, y1):
    """Flat platform roof seen from above: grey with a lit edge, glazing strip, posts and a shadow."""
    for x in range(x0 + 2, x1 + 3):
        px(im, x, y1 + 1, DARK)
    rect(im, x0, y0, x1, y1, MID)
    line(im, [(x0, y0), (x1, y0)], WHITE)
    for x in range(x0 + 2, x1, 3): px(im, x, y0 + 1 + (y1 - y0) // 2, LIGHT)
    line(im, [(x1, y0), (x1, y1)], DARK)


def canopy_v(im, x0, x1, y0, y1):
    for y in range(y0 + 2, y1 + 3):
        px(im, x1 + 1, y, DARK)
    rect(im, x0, y0, x1, y1, MID)
    line(im, [(x0, y0), (x0, y1)], WHITE)
    for y in range(y0 + 2, y1, 3): px(im, x0 + 1 + (x1 - x0) // 2, y, LIGHT)
    line(im, [(x0, y1), (x1, y1)], DARK)


def people(im, area, n, seed, on=(LIGHT, WHITE)):
    x0, y0, x1, y1 = area
    cols = [RED, BLUE, BLACK, ORANGE, DARK, YELLOW]
    k = 0
    for i in range(n * 20):
        x = x0 + (seed * 31 + i * 17) % (x1 - x0 + 1)
        y = y0 + (seed * 7 + i * 13) % (y1 - y0 + 1)
        if im.getpixel((x, y)) in on:
            px(im, x, y, cols[(seed + i) % len(cols)]); k += 1
            if k >= n: break


def car(im, x, y, c, horiz=True):
    if horiz:
        rect(im, x, y, x + 2, y + 1, c); px(im, x + 1, y, DARK); px(im, x + 3, y + 1, BLACK)
    else:
        rect(im, x, y, x + 1, y + 2, c); px(im, x, y + 1, DARK); px(im, x + 1, y + 3, BLACK)


def clock(im, cx, cy, r=2):
    ellipse(im, cx - r, cy - r, cx + r, cy + r, WHITE, BLACK)
    px(im, cx, cy, BLACK); px(im, cx, cy - 1, BLACK); px(im, cx + 1, cy, BLACK)


def sign(im, x, y, w):
    rect(im, x, y, x + w - 1, y + 1, BLUE)
    for i in range(x + 1, x + w - 1, 2): px(im, i, y, WHITE)


# ---------------------------------------------------------------- east-west stations (hall to the north)

def halt_h():
    W, H = 3, 2
    im = ground(W, H, 11)
    # forecourt and booking hall on the north half
    rect(im, 0, 0, 47, 2, MID); [px(im, x, 1, LIGHT) for x in range(1, 47, 4)]
    box(im, 12, 3, 24, 5, 5, roof=RED, wall=DARK, windows='dark')
    rect(im, 22, 10, 25, 12, BLACK); rect(im, 23, 11, 24, 12, ORANGE)       # door
    sign(im, 16, 4, 16)
    car(im, 4, 0, YELLOW); car(im, 40, 0, WHITE)
    # platform right up to the rail, canopy over it
    platform_h(im, 2, 45, 14, 18, edge_top=False)
    canopy_h(im, 6, 41, 14, 16)
    people(im, (2, 17, 45, 18), 6, 3)
    track_row(im, 1, W)
    ends_h(im, 1, W)
    return im


def station_h():
    """Through station: the line enters and leaves on tile row 2; a passing loop serves the hall platform."""
    W, H = 4, 3
    im = ground(W, H, 12)
    rect(im, 0, 0, 63, 2, MID); [px(im, x, 1, LIGHT) for x in range(1, 63, 4)]
    box(im, 6, 3, 52, 6, 6, roof=LIGHT, wall=DARK, windows='dark')
    for x in range(10, 56, 4): px(im, x, 4, WATER); px(im, x, 5, WATER)   # skylights
    rect(im, 29, 11, 34, 14, BLACK); rect(im, 30, 12, 33, 14, ORANGE)
    sign(im, 24, 9, 16)
    clock(im, 31, 6)
    car(im, 2, 0, RED); car(im, 8, 0, YELLOW); car(im, 54, 0, BLUE)
    platform_h(im, 14, 49, 15, 18, edge_top=False)                        # hall platform (loop track)
    platform_h(im, 22, 41, 30, 34)                                        # island platform between the tracks
    canopy_h(im, 16, 47, 15, 16)
    canopy_h(im, 24, 39, 31, 32)
    people(im, (14, 17, 49, 18), 7, 5); people(im, (22, 33, 41, 34), 5, 9)
    track_row(im, 2, W)
    branch(im, 'h', 2, 1, 2, 61, 14)
    ends_h(im, 2, W)
    return im


def grand_h():
    """Grand Central: the line enters and leaves on tile row 3 and fans out to three platform tracks
    (rows 2-4) under a glazed train shed, with the grand hall and its concourse to the north."""
    W, H = 6, 5
    im = ground(W, H, 13)
    rect(im, 0, 0, 95, 4, MID); [px(im, x, 2, LIGHT) for x in range(1, 95, 4)]
    for i, c in enumerate([YELLOW, YELLOW, YELLOW, WHITE, RED]): car(im, 4 + i * 5, 1, c)
    car(im, 70, 1, BLUE); car(im, 76, 1, YELLOW); car(im, 82, 1, YELLOW)
    box(im, 4, 6, 88, 7, 8, roof=LIGHT, wall=DARK)
    for x in range(8, 90, 4):
        px(im, x, 15, YELLOW); px(im, x, 16, YELLOW); px(im, x, 18, YELLOW)
    box(im, 34, 3, 28, 9, 11, roof=MID, wall=DARK)
    for x in range(37, 60, 4):
        px(im, x, 13, WATER); rect(im, x - 1, 14, x + 1, 20, WATER); px(im, x, 21, WATER)
    rect(im, 44, 18, 51, 22, BLACK); rect(im, 45, 19, 50, 22, ORANGE)
    box(im, 44, 0, 8, 4, 6, roof=WHITE, wall=LIGHT, side=DARK)
    clock(im, 47, 6)
    px(im, 47, 0, RED)
    sign(im, 38, 4, 20)
    platform_h(im, 1, 94, 24, 33, edge_top=False)                         # concourse
    people(im, (2, 25, 93, 33), 22, 11)
    for x in (20, 70): rect(im, x, 27, x + 5, 29, DARK); px(im, x + 1, 28, YELLOW); px(im, x + 3, 28, YELLOW)
    platform_h(im, 22, 73, 46, 50)                                        # island platforms
    platform_h(im, 22, 73, 62, 66)
    track_row(im, 3, W)
    branch(im, 'h', 3, 2, 2, 93, 20)
    branch(im, 'h', 3, 4, 2, 93, 20)
    # train shed: thin trusses and glazing over the platforms, open at both ends so the switches show
    for x in range(22, 76, 6):
        line(im, [(x, 34), (x, 78)], MID)
        for y in range(36, 78, 4): px(im, x + 1, y, WHITE)
    line(im, [(22, 34), (74, 34)], WHITE); line(im, [(22, 78), (74, 78)], DARK)
    for x in range(22, 75): px(im, x, 79, BLACK)
    people(im, (23, 47, 72, 49), 8, 17); people(im, (23, 63, 72, 65), 8, 23)
    ends_h(im, 3, W)
    return im


# ---------------------------------------------------------------- north-south stations (hall to the west)

def halt_v():
    W, H = 2, 3
    im = ground(W, H, 21)
    rect(im, 0, 0, 2, 47, MID); [px(im, 1, y, LIGHT) for y in range(1, 47, 4)]
    box(im, 3, 12, 8, 18, 4, roof=RED, wall=DARK, windows='dark')
    rect(im, 11, 22, 12, 25, ORANGE)                                       # door on the platform side
    car(im, 0, 3, YELLOW, horiz=False); car(im, 0, 40, WHITE, horiz=False)
    platform_v(im, 13, 18, 2, 45, edge_left=False)
    canopy_v(im, 13, 16, 6, 41)
    people(im, (17, 2, 18, 45), 6, 4)
    track_col(im, 1, H)
    ends_v(im, 1, H)
    return im


def station_v():
    W, H = 3, 4
    im = ground(W, H, 22)
    rect(im, 0, 0, 2, 63, MID); [px(im, 1, y, LIGHT) for y in range(1, 63, 4)]
    box(im, 3, 6, 9, 46, 5, roof=LIGHT, wall=DARK, windows='dark')
    for y in range(9, 52, 4): px(im, 6, y, WATER); px(im, 7, y, WATER)
    clock(im, 7, 30)
    car(im, 0, 2, RED, horiz=False); car(im, 0, 56, YELLOW, horiz=False)
    platform_v(im, 13, 18, 14, 49, edge_left=False)
    platform_v(im, 30, 34, 22, 41)
    canopy_v(im, 15, 16, 16, 47)
    canopy_v(im, 31, 32, 24, 39)
    people(im, (17, 14, 18, 49), 7, 6); people(im, (33, 22, 34, 41), 5, 10)
    track_col(im, 2, H)
    branch(im, 'v', 2, 1, 2, 61, 14)
    ends_v(im, 2, H)
    return im


def grand_v():
    W, H = 5, 6
    im = ground(W, H, 23)
    rect(im, 0, 0, 4, 95, MID); [px(im, 2, y, LIGHT) for y in range(1, 95, 4)]
    for i, c in enumerate([YELLOW, YELLOW, WHITE, RED]): car(im, 1, 4 + i * 5, c, horiz=False)
    car(im, 1, 78, YELLOW, horiz=False); car(im, 1, 84, BLUE, horiz=False)
    box(im, 5, 4, 14, 82, 5, roof=LIGHT, wall=DARK)
    for y in range(8, 84, 4): px(im, 9, y, YELLOW); px(im, 12, y, YELLOW)
    box(im, 4, 32, 18, 30, 7, roof=MID, wall=DARK)
    for y in range(35, 60, 4): rect(im, 7, y, 19, y, WATER)
    box(im, 6, 42, 8, 8, 6, roof=WHITE, wall=LIGHT, side=DARK)
    clock(im, 10, 46)
    rect(im, 22, 44, 23, 50, ORANGE)
    platform_v(im, 24, 33, 1, 94, edge_left=False)
    people(im, (25, 2, 33, 93), 22, 12)
    for y in (20, 70): rect(im, 27, y, 29, y + 5, DARK); px(im, 28, y + 1, YELLOW); px(im, 28, y + 3, YELLOW)
    platform_v(im, 46, 50, 22, 73)
    platform_v(im, 62, 66, 22, 73)
    track_col(im, 3, H)
    branch(im, 'v', 3, 2, 2, 93, 20)
    branch(im, 'v', 3, 4, 2, 93, 20)
    for y in range(22, 76, 6):
        line(im, [(34, y), (78, y)], MID)
        for x in range(36, 78, 4): px(im, x, y + 1, WHITE)
    line(im, [(34, 22), (34, 74)], WHITE); line(im, [(78, 22), (78, 74)], DARK)
    for y in range(22, 75): px(im, 79, y, BLACK)
    people(im, (47, 23, 49, 72), 8, 18); people(im, (63, 23, 65, 72), 8, 24)
    ends_v(im, 3, H)
    return im


STATIONS = [
    ('halt', 'Halt', halt_h, halt_v, '1 platform track'),
    ('station', 'Station', station_h, station_v, '2 platform tracks'),
    ('grand', 'Grand Central', lambda: __import__('grand').grand_ew(), lambda: __import__('grand').grand_ns(), '3 platform tracks'),
]

if __name__ == '__main__':
    meta = {}
    for slug, name, fh, fv, tracks in STATIONS:
        for orient, f in (('ew', fh), ('ns', fv)):
            im = f()
            bad = {im.getpixel((x, y)) for y in range(im.height) for x in range(im.width)} - set(PALETTE)
            assert not bad, f'{slug}_{orient}: off-palette {list(bad)[:4]}'
            key = f'{slug}_{orient}'
            im.save(os.path.join(OUT, f'{key}.png'))
            im.resize((im.width * 4, im.height * 4), Image.NEAREST).save(os.path.join(OUT, f'{key}@4x.png'))
            meta[key] = {'name': name, 'w': im.width // T, 'h': im.height // T, 'orient': orient, 'tracks': tracks}
            print(key, im.size)
    json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), indent=2)
