import math, random
from _common import *

SLUG = 'lighthouse'
rng = random.Random(SLUG)
im = canvas(3, 'water', SLUG)
for y in range(48):
    for x in range(48):
        if get(im, x, y) == BLUE and (x * 5 + y * 3) % 4: px(im, x, y, WATER)

# ---------- rocky point (land)
land = [(0, 47), (0, 22), (5, 16), (13, 13), (22, 14), (29, 19), (32, 27), (29, 35), (24, 40), (20, 47)]
poly(im, land, DIRT)
# grass top
poly(im, [(2, 44), (2, 24), (7, 19), (14, 17), (21, 18), (26, 22), (28, 28), (25, 34), (19, 38), (15, 44)], GRASS)
for y in range(48):
    for x in range(48):
        if get(im, x, y) == GRASS and (x + y) % 2 == 0 and (x * 7 + y * 11) % 5 == 0: px(im, x, y, FOREST)
# rocks along the shore: boulders (LIGHT top, DARK bottom-right), surf foam
edge = [(x, y) for y in range(48) for x in range(48) if get(im, x, y) == DIRT and any(get(im, x + dx, y + dy) in (WATER, BLUE) for dx, dy in [(1, 0), (0, 1), (-1, 0), (0, -1)])]
for (x, y) in edge:
    h = (x * 13 + y * 7) % 5
    px(im, x, y, [MID, LIGHT, MID, DARK, MID][h])
for (x, y) in edge:
    for dx, dy in [(1, 1), (2, 0), (0, 2)]:
        if get(im, x + dx, y + dy) in (WATER, BLUE): px(im, x + dx, y + dy, BLUE if (x + y) % 3 else WHITE)
for (x, y) in [(31, 22), (33, 29), (27, 38), (22, 43), (3, 18), (9, 13)]:     # offshore rocks
    rect(im, x, y, x + 1, y, LIGHT); px(im, x, y + 1, DARK); px(im, x + 2, y + 1, BLACK)
    px(im, x - 1, y + 1, WHITE); px(im, x + 2, y, WHITE)

# ---------- keeper's cottage (white walls, red roof)
bldg(im, 4, 29, 10, 5, 3, roof=RED, wall=LIGHT, side=DARK, cast_len=2)
rect(im, 4, 29, 12, 30, ORANGE); line(im, [(4, 29), (12, 29)], YELLOW)   # lit north slope of the roof
line(im, [(4, 31), (12, 31)], DARK)                # ridge
px(im, 6, 35, BLUE); px(im, 9, 35, DARK); px(im, 11, 35, BLUE)
rect(im, 10, 29, 11, 29, DARK)                     # chimney
# path from cottage to the tower, a fence and garden
for (x, y) in spline([(10, 37), (14, 34), (18, 30)], closed=False): px(im, x, y, SAND)
for x in range(3, 15, 2): px(im, x, 41, LIGHT)
for (x, y) in [(5, 39), (8, 39), (11, 39)]: px(im, x, y, YELLOW)
tree(im, 3, 24); tree(im, 23, 34, True)

# ---------- light beam from the lantern sweeping out to sea (north-east)
LX, LY = 21, 5
for y in range(1, 47):
    for x in range(LX + 3, 47):
        dx, dy = x - LX, y - LY
        ang, t = math.atan2(dy, dx), math.hypot(dx, dy)
        if -0.12 <= ang <= 0.36 and get(im, x, y) in (WATER, BLUE):
            edge = ang < -0.05 or ang > 0.29
            if t < 10:   c, on = (YELLOW, (x + y) % 2 == 0 or not edge)
            elif t < 20: c, on = (WHITE, (x + y) % 2 == 0 and not (edge and x % 2))
            else:        c, on = (LIGHT, (x + y) % 2 == 0 and (x % 4 < 2 or not edge))
            if on: px(im, x, y, c)

# ---------- the tower: red/white banded cylinder, oblique so its height runs downward
tx, base_y, top_y, w = 17, 26, 9, 7
# long cast shadow towards the south-east
for k in range(10):
    for d in range(4):
        shade_px(im, tx + w + k, base_y - 1 + k // 2 + d - 2 + (1 if d > 1 else 0))
# column (south face visible)
for y in range(top_y, base_y + 1):
    band = ((y - top_y) // 3) % 2
    for x in range(tx, tx + w):
        c = RED if band == 0 else WHITE
        if x == tx + w - 1: c = DARK if c == WHITE else BLACK          # shaded east edge
        elif x == tx + w - 2 and c == WHITE: c = LIGHT
        elif x == tx: c = WHITE if c == WHITE else ORANGE              # lit west edge
        px(im, x, y, c)
# base plinth
rect(im, tx - 1, base_y, tx + w, base_y + 2, LIGHT); rect(im, tx - 1, base_y + 2, tx + w, base_y + 2, DARK)
px(im, tx + 3, base_y + 1, BLACK)                                      # door
# gallery + lantern room + cap
rect(im, tx - 1, top_y - 1, tx + w, top_y, DARK); line(im, [(tx - 1, top_y - 1), (tx + w - 1, top_y - 1)], LIGHT)
rect(im, tx + 1, top_y - 4, tx + w - 2, top_y - 2, YELLOW); px(im, tx + w - 2, top_y - 3, ORANGE); px(im, tx + 1, top_y - 4, WHITE)
rect(im, tx + 1, top_y - 5, tx + w - 2, top_y - 5, BLACK); rect(im, tx + 2, top_y - 6, tx + w - 3, top_y - 6, DARK)
px(im, tx + 3, top_y - 7, BLACK)
# windows on the column
px(im, tx + 3, top_y + 4, BLACK); px(im, tx + 3, top_y + 10, BLACK)

border(im, 'civic')
save(im, SLUG, 'Lighthouse', 'Coastal landmark: reduces shipwreck disasters and boosts seaport/marina trade within 20 tiles; small tourism bonus.', 'civic')
