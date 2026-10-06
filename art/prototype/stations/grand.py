"""Grand Central, second pass: drawn in the civic group's front-elevation style (walls straight down, light
from the top-left, shadows darken the ground), at the detail level of City Hall and the University.

East-west (6x5): forecourt with a taxi rank and buses, a Beaux-Arts head house (barrel-vaulted great hall
with three arched windows, a clock group, colonnaded wings, domed corner pavilions), a concourse, and a
gravel yard where the single through line (tile row 3) fans out to three platform tracks under a glazed
barrel-vault train shed. Signal gantries guard both throats. North-south (5x6) is the same station turned:
the head house runs along the west side and the shed vault runs north-south.
The line's first and last tile stay the untouched Micropolis rail tile, so it joins any rail built up to it.
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'civic'))
from _civ import *  # noqa  (pixlib + civic helpers)
from PIL import Image
import stations as S

T = 16


def get(im, x, y):
    return im.getpixel((x, y)) if 0 <= x < im.width and 0 <= y < im.height else None


def ground_rect(w, h, seed):
    im = Image.new('RGB', (w, h), DIRT)
    for y in range(h):
        for x in range(w):
            r = rnd(x, y, seed) % 1000
            if r < 18: im.putpixel((x, y), DARK)
            elif r < 34: im.putpixel((x, y), SAND)
            elif r < 44: im.putpixel((x, y), GRASS)
    return im


def gravel(im, x0, y0, x1, y1, seed):
    """Railway yard ballast: dark gravel with sand and grey specks."""
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            r = rnd(x, y, seed) % 100
            px(im, x, y, SAND if r < 55 else DIRT if r < 80 else DARK)


def glass(im, x0, y0, x1, y1, lit, axis='h'):
    """See-through glazing: a glazing bar every third row (or column) in the glass colour; between the bars
    the tracks, platforms and trains below stay visible."""
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if (y if axis == 'h' else x) % 3 == 0: px(im, x, y, lit)


def arched_window(im, x, y, w, h, frame=WHITE, pane=WATER):
    """Tall window with a round top: x,y = top-left of the arch, w odd."""
    r = w // 2
    rect(im, x, y + r, x + w - 1, y + h - 1, pane)
    ellipse(im, x, y, x + w - 1, y + 2 * r, pane)
    line(im, [(x + r, y + 1), (x + r, y + h - 1)], frame)          # mullion
    for yy in range(y + r + 2, y + h - 1, 3): line(im, [(x, yy), (x + w - 1, yy)], frame)  # transoms
    line(im, [(x + w, y + r), (x + w, y + h - 1)], DARK)            # reveal shadow


def lamp(im, x, y):
    px(im, x, y, YELLOW); px(im, x, y + 1, WHITE); px(im, x + 1, y + 2, BLACK)


def train_h(im, x0, x1, row, loco=RED):
    """A parked train on the platform track of tile row `row` (rails at row*16+5..+10)."""
    y = row * T + 4
    rect(im, x0, y, x1, y + 6, LIGHT)
    line(im, [(x0, y), (x1, y)], WHITE)
    for x in range(x0 + 1, x1, 2): px(im, x, y + 2, BLUE)
    for x in range(x0 + 9, x1 - 4, 10): line(im, [(x, y), (x, y + 6)], MID)
    line(im, [(x0, y + 6), (x1, y + 6)], DARK)
    rect(im, x1 - 4, y, x1, y + 6, loco); px(im, x1, y + 2, YELLOW); px(im, x1, y + 4, YELLOW); px(im, x1 - 2, y + 1, BLACK)
    line(im, [(x0 + 1, y + 7), (x1 + 1, y + 7)], BLACK)


def train_v(im, y0, y1, col, loco=RED):
    x = col * T + 4
    rect(im, x, y0, x + 6, y1, LIGHT)
    line(im, [(x, y0), (x, y1)], WHITE)
    for y in range(y0 + 1, y1, 2): px(im, x + 2, y, BLUE)
    for y in range(y0 + 9, y1 - 4, 10): line(im, [(x, y), (x + 6, y)], MID)
    line(im, [(x + 6, y0), (x + 6, y1)], DARK)
    rect(im, x, y1 - 4, x + 6, y1, loco); px(im, x + 2, y1, YELLOW); px(im, x + 4, y1, YELLOW); px(im, x + 1, y1 - 2, BLACK)
    line(im, [(x + 7, y0 + 1), (x + 7, y1 + 1)], BLACK)


def gantry_h(im, x, y0, y1):
    """Signal gantry across the tracks (seen from above): a beam with a red/green head per track."""
    shade_rect(im, x + 1, y0 + 1, x + 1, y1 + 1)
    line(im, [(x, y0), (x, y1)], LIGHT)
    for y in (y0, y1): px(im, x, y, WHITE)
    for k, y in enumerate(range(y0 + 7, y1, 16)):
        px(im, x, y, RED if k % 2 == 0 else GRASS)


def gantry_v(im, y, x0, x1):
    shade_rect(im, x0 + 1, y + 1, x1 + 1, y + 1)
    line(im, [(x0, y), (x1, y)], LIGHT)
    for k, x in enumerate(range(x0 + 7, x1, 16)):
        px(im, x, y, RED if k % 2 == 0 else GRASS)


# ======================================================================== east-west

def grand_ew():
    W, H = 6, 5
    im = ground_rect(W * T, H * T, 'gc_ew')
    # ---- forecourt: paved plaza, taxi rank, buses, trees
    pave(im, 0, 0, 95, 6, MID, LIGHT)
    for x in range(2, 95, 4): px(im, x, 3, LIGHT)
    for i, c in enumerate([YELLOW, YELLOW, YELLOW, YELLOW, WHITE]):
        car(im, 6 + i * 4, 1, c)
    rect(im, 64, 1, 71, 3, RED); line(im, [(64, 1), (71, 1)], ORANGE); px(im, 72, 3, BLACK)   # bus
    for x in range(65, 71, 2): px(im, x, 2, WATER)
    rect(im, 75, 4, 82, 6, BLUE); line(im, [(75, 4), (82, 4)], WATER); px(im, 83, 6, BLACK)
    for (tx, ty) in [(0, 7), (92, 7)]: tree(im, tx, ty, big=True)

    # ---- yard: gravel bed where the fan of tracks runs, tracks, platforms
    gravel(im, 12, 33, 83, 78, 'gc_ew_yard')
    S.track_row(im, 3, W)
    S.branch(im, 'h', 3, 2, 2, 93, 20)
    S.branch(im, 'h', 3, 4, 2, 93, 20)
    for y0, y1 in ((46, 50), (62, 66)):                    # island platforms
        S.platform_h(im, 24, 71, y0, y1)
        for x in range(28, 70, 8): lamp(im, x, y0 + 1)
    train_h(im, 26, 60, 2, RED)                             # a train waiting on the north platform track
    train_h(im, 40, 71, 4, BLUE)

    # ---- glazed barrel-vault train shed over the platforms (x 22..73, y 33..78)
    X0, X1, Y0, Y1 = 22, 73, 33, 78
    shade_rect(im, X0 + 3, Y1 + 1, X1 + 3, Y1 + 1); shade_rect(im, X1 + 1, Y0 + 3, X1 + 3, Y1 + 1)
    mid = (Y0 + Y1) // 2
    glass(im, X0, Y0, X1, mid - 6, WHITE)                    # lit north slope
    glass(im, X0, mid - 5, X1, mid + 6, LIGHT)               # crown
    glass(im, X0, mid + 7, X1, Y1, MID)                      # shaded south slope
    for x in range(X0, X1 + 1, 6):                           # transverse ribs
        line(im, [(x, Y0), (x, Y1)], MID)
        px(im, x, Y0, WHITE); px(im, x, Y1, DARK)
    line(im, [(X0, mid - 6), (X1, mid - 6)], WHITE)          # purlins
    line(im, [(X0, mid + 6), (X1, mid + 6)], DARK)
    line(im, [(X0, mid), (X1, mid)], LIGHT)                  # ridge
    line(im, [(X0, Y0), (X1, Y0)], WHITE); line(im, [(X0, Y1), (X1, Y1)], BLACK)
    line(im, [(X0, Y0), (X0, Y1)], WHITE)                    # lit west arch, shaded east arch
    line(im, [(X1, Y0), (X1, Y1)], DARK)
    for y in range(Y0 + 2, Y1, 4): px(im, X0 + 1, y, LIGHT); px(im, X1 - 1, y, MID)
    gantry_h(im, 15, 33, 79); gantry_h(im, 80, 33, 79)

    # ---- concourse between the head house and the shed
    pave(im, 2, 28, 93, 33, LIGHT, WHITE)
    for x in range(4, 93, 6): px(im, x, 32, YELLOW)
    for x in (16, 79): rect(im, x, 29, x + 4, 30, DARK); px(im, x + 1, 29, YELLOW); px(im, x + 3, 29, ORANGE)  # boards

    # ---- head house (front elevation, skew 0)
    SK = 0
    for wx in (10, 62):                                       # colonnaded wings
        X, Y, Wd, D, Hh = wx, 9, 24, 8, 9
        block(im, X, Y, Wd, D, Hh, roof=LIGHT, west=WHITE, south=MID, skew=SK)
        line(im, [(X + 1, Y + 2), (X + Wd - 2, Y + 2)], MID)      # mansard break
        for u in range(X + 2, X + Wd - 2, 3):
            line(im, [(u, Y + D + 1), (u, Y + D + Hh - 2)], WHITE)     # pilasters
            px(im, u + 1, Y + D + 2, BLACK); px(im, u + 1, Y + D + 5, BLACK)
        line(im, [(X, Y + D), (X + Wd - 1, Y + D)], WHITE)
    for px0 in (3, 84):                                       # domed corner pavilions
        X, Y, Wd, D, Hh = px0, 8, 10, 9, 11
        block(im, X, Y, Wd, D, Hh, roof=MID, west=WHITE, south=MID, skew=SK)
        south_windows(im, X, Y, Wd, D, Hh, SK, BLACK, 3, rows=[2, 5, 8], start=2)
        cap(im, X + Wd // 2 - 1, Y + 6, 4, 5)
        px(im, X + Wd // 2 - 1, Y, YELLOW)
    # great hall: barrel-vaulted roof, three arched windows, clock group
    X, Y, Wd, D, Hh = 33, 3, 30, 13, 13
    block(im, X, Y, Wd, D, Hh, roof=LIGHT, west=WHITE, south=MID, skew=SK)
    for yy in range(Y + 1, Y + D - 1):                        # vault shading north (lit) to south
        t = (yy - Y) / D
        for xx in range(X + 1, X + Wd - 1):
            c = WHITE if t < 0.25 else LIGHT if t < 0.5 else (LIGHT if (xx + yy) % 2 else MID) if t < 0.7 else MID
            px(im, xx, yy, c)
    for xx in range(X + 3, X + Wd - 2, 4): line(im, [(xx, Y + 1), (xx, Y + D - 2)], MID)   # vault ribs
    line(im, [(X, Y + D - 1), (X + Wd - 1, Y + D - 1)], WHITE)                            # cornice
    for i, ax in enumerate((36, 45, 54)):
        arched_window(im, ax, Y + D + 1, 7, 10)
    for cx in (34, 43, 52, 61):                                                           # paired columns
        line(im, [(cx, Y + D + 1), (cx, Y + D + Hh - 2)], WHITE)
        line(im, [(cx + 1, Y + D + 1), (cx + 1, Y + D + Hh - 2)], LIGHT)
    for dx in (37, 46, 55):                                                               # doors
        rect(im, dx, Y + D + Hh - 3, dx + 4, Y + D + Hh - 1, BLACK); rect(im, dx + 1, Y + D + Hh - 2, dx + 3, Y + D + Hh - 1, ORANGE)
    # clock and sculpture group on the cornice
    ellipse(im, 44, 8, 52, 16, WHITE, BLACK)
    ellipse(im, 45, 9, 51, 15, YELLOW)
    ellipse(im, 46, 10, 50, 14, WHITE)
    px(im, 48, 11, BLACK); px(im, 48, 12, BLACK); px(im, 49, 12, BLACK)
    for sx, c in ((42, SAND), (53, SAND)): rect(im, sx, 11, sx + 1, 15, c); px(im, sx, 10, ORANGE)
    # steps down to the concourse
    for i in range(2):
        line(im, [(X - 1 - i, Y + D + Hh + i), (X + Wd + i, Y + D + Hh + i)], WHITE if i == 0 else LIGHT)
    # flags on the parapet
    for fx, c in ((34, RED), (60, BLUE)): flag(im, fx, Y - 3, c, 4)
    # lamps and people on the forecourt and concourse
    for x in (8, 30, 66, 88): lamp(im, x, 25)
    for (x, y) in [(5, 4), (14, 5), (27, 4), (40, 5), (49, 4), (56, 5), (61, 3), (86, 5)]: person(im, x, y, BLACK)
    S.people(im, (3, 29, 92, 31), 20, 31, on=(LIGHT, WHITE))
    S.people(im, (24, 47, 71, 49), 8, 37, on=(LIGHT,))
    S.people(im, (24, 63, 71, 65), 8, 41, on=(LIGHT,))
    S.ends_h(im, 3, W)
    return im


# ======================================================================== north-south

def grand_ns():
    W, H = 5, 6
    im = ground_rect(W * T, H * T, 'gc_ns')
    # ---- street along the west edge with a taxi rank
    pave(im, 0, 0, 5, 95, MID, LIGHT)
    for y in range(2, 95, 4): px(im, 3, y, LIGHT)
    for i, c in enumerate([YELLOW, YELLOW, YELLOW, WHITE]): car(im, 1, 6 + i * 4, c, vertical=True)
    rect(im, 1, 70, 3, 77, RED); line(im, [(1, 70), (1, 77)], ORANGE); px(im, 3, 78, BLACK)
    for (tx, ty) in [(7, 0), (7, 91)]: tree(im, tx, ty, big=True)

    # ---- yard, tracks, platforms
    gravel(im, 33, 12, 78, 83, 'gc_ns_yard')
    S.track_col(im, 3, H)
    S.branch(im, 'v', 3, 2, 2, 93, 20)
    S.branch(im, 'v', 3, 4, 2, 93, 20)
    for x0, x1 in ((46, 50), (62, 66)):
        S.platform_v(im, x0, x1, 24, 71)
        for y in range(28, 70, 8): lamp(im, x0 + 1, y)
    train_v(im, 26, 60, 2, RED)
    train_v(im, 40, 71, 4, BLUE)

    # ---- glazed barrel-vault shed running north-south (x 33..78, y 22..73)
    X0, X1, Y0, Y1 = 33, 78, 22, 73
    shade_rect(im, X1 + 1, Y0 + 3, X1 + 1, Y1 + 3); shade_rect(im, X0 + 3, Y1 + 1, X1 + 1, Y1 + 3)
    mid = (X0 + X1) // 2
    glass(im, X0, Y0, mid - 6, Y1, WHITE, 'v')               # lit west slope
    glass(im, mid - 5, Y0, mid + 6, Y1, LIGHT, 'v')
    glass(im, mid + 7, Y0, X1, Y1, MID, 'v')                 # shaded east slope
    for y in range(Y0, Y1 + 1, 6):
        line(im, [(X0, y), (X1, y)], MID)
        px(im, X0, y, WHITE); px(im, X1, y, DARK)
    line(im, [(mid - 6, Y0), (mid - 6, Y1)], WHITE)
    line(im, [(mid + 6, Y0), (mid + 6, Y1)], DARK)
    line(im, [(mid, Y0), (mid, Y1)], LIGHT)
    line(im, [(X0, Y0), (X0, Y1)], WHITE); line(im, [(X1, Y0), (X1, Y1)], BLACK)
    line(im, [(X0, Y0), (X1, Y0)], WHITE)                    # lit north arch
    line(im, [(X0, Y1), (X1, Y1)], DARK)                     # shaded south arch, the open end
    for x in range(X0 + 2, X1, 4): px(im, x, Y1 - 1, MID)
    gantry_v(im, 15, 33, 79); gantry_v(im, 80, 33, 79)

    # ---- concourse along the shed's west side
    pave(im, 27, 2, 32, 93, LIGHT, WHITE)
    for y in range(4, 93, 6): px(im, 31, y, YELLOW)

    # ---- head house along the west side. Drawn with skew 1 so its lit street front (west face) shows,
    # like the originals' oblique buildings: wings, domed end pavilions and the great hall in the middle.
    SK = 1
    for wy in (10, 60):                                       # wings
        X, Y, Wd, D, Hh = 13, wy, 12, 24, 5
        block(im, X, Y, Wd, D, Hh, roof=LIGHT, west=WHITE, south=MID, skew=SK)
        for yy in range(Y + 2, Y + D - 1, 4): line(im, [(X + 2, yy), (X + Wd - 3, yy)], MID)     # roof bays
        line(im, [(X + Wd // 2, Y + 1), (X + Wd // 2, Y + D - 2)], WATER)                        # skylight
        for u in range(1, D - 1, 3):                                                            # street windows
            for v in (2, 4): px(im, *west_px(X, Y, Wd, D, Hh, SK, u, v), BLACK)
    for py in (1, 84):                                        # domed end pavilions
        X, Y, Wd, D, Hh = 13, py, 13, 10, 6
        block(im, X, Y, Wd, D, Hh, roof=MID, west=WHITE, south=MID, skew=SK)
        dome(im, X + Wd // 2, Y + D // 2, 4)
        px(im, X + Wd // 2 - 1, Y + D // 2 - 1, YELLOW)
        for u in range(2, D - 1, 3): px(im, *west_px(X, Y, Wd, D, Hh, SK, u, 3), BLACK)
    # great hall: taller, vault running north-south (lit west half), street front with tall windows and a clock
    X, Y, Wd, D, Hh = 15, 33, 12, 28, 9
    block(im, X, Y, Wd, D, Hh, roof=LIGHT, west=WHITE, south=MID, skew=SK)
    for xx in range(X + 1, X + Wd - 1):
        t = (xx - X) / Wd
        for yy in range(Y + 1, Y + D - 1):
            c = WHITE if t < 0.3 else LIGHT if t < 0.55 else (LIGHT if (xx + yy) % 2 else MID) if t < 0.75 else MID
            px(im, xx, yy, c)
    for yy in range(Y + 3, Y + D - 2, 4): line(im, [(X + 1, yy), (X + Wd - 2, yy)], MID)   # vault ribs
    for u in range(3, D - 2, 4):                              # tall windows on the street front
        for v in range(2, Hh - 1): px(im, *west_px(X, Y, Wd, D, Hh, SK, u, v), WATER)
        px(im, *west_px(X, Y, Wd, D, Hh, SK, u + 1, 2), WHITE)
    cxk, cyk = west_px(X, Y, Wd, D, Hh, SK, D // 2, 4)        # clock on the street front
    ellipse(im, cxk - 3, cyk - 3, cxk + 3, cyk + 3, WHITE, BLACK)
    ellipse(im, cxk - 2, cyk - 2, cxk + 2, cyk + 2, YELLOW)
    px(im, cxk, cyk - 1, BLACK); px(im, cxk, cyk, BLACK); px(im, cxk + 1, cyk, BLACK)
    for u in (6, 14, 22):                                     # doors at street level
        x_, y_ = west_px(X, Y, Wd, D, Hh, SK, u, Hh)
        rect(im, x_, y_ - 2, x_ + 1, y_, BLACK); px(im, x_ + 1, y_ - 1, ORANGE)
    for yy in (38, 46, 54): rect(im, 27, yy, 27, yy + 3, ORANGE)   # concourse doors (east side)
    for fy, c in ((34, RED), (56, BLUE)): flag(im, 26, fy - 4, c, 4)
    for y in (6, 30, 66, 90): lamp(im, 27, y)
    S.people(im, (28, 3, 30, 92), 18, 33, on=(LIGHT, WHITE))
    S.people(im, (47, 24, 49, 71), 8, 38, on=(LIGHT,))
    S.people(im, (63, 24, 65, 71), 8, 42, on=(LIGHT,))
    for (x, y) in [(4, 30), (2, 44), (4, 58), (2, 86)]: person(im, x, y, BLACK)
    S.ends_v(im, 3, H)
    return im
