import math, random
from _common import *

SLUG = 'golf_course'
rng = random.Random(SLUG)
im = Image.new('RGB', (64, 64), FOREST)
# rough: dark FOREST with GRASS dither
for y in range(64):
    for x in range(64):
        if (x + y) % 2 == 0 and ((x * 73) ^ (y * 151)) % 7 < 3: px(im, x, y, GRASS)

def fairway(pts, w):
    line(im, pts, GRASS, width=w)
    for (x, y) in pts: ellipse(im, x - w // 2, y - w // 2, x + w // 2, y + w // 2, GRASS)

def mow(region):
    """Mowing stripes: subtle diagonal FOREST pixels on GRASS fairway."""
    x0, y0, x1, y1 = region
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if get(im, x, y) == GRASS and get(im, x - 1, y) == GRASS and get(im, x + 1, y) == GRASS and get(im, x, y - 1) == GRASS and get(im, x, y + 1) == GRASS and (x + y) % 4 == 0 and (x // 2 + y // 2) % 2 == 0: px(im, x, y, FOREST)

def green(cx, cy, r):
    ellipse(im, cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, FOREST)
    ellipse(im, cx - r, cy - r, cx + r, cy + r, GRASS)

def flag(x, y, c=RED):
    px(im, x, y, BLACK)                                   # hole
    line(im, [(x, y - 1), (x, y - 5)], WHITE)
    rect(im, x + 1, y - 5, x + 3, y - 4, c); px(im, x + 1, y - 3, c)
    px(im, x + 1, y, BLACK); px(im, x + 1, y - 1, FOREST); px(im, x + 2, y - 1, FOREST)  # pole shadow

def bunker(cx, cy, rx, ry):
    ellipse(im, cx - rx, cy - ry, cx + rx, cy + ry, SAND)
    ellipse(im, cx - rx, cy - ry, cx + rx - 1, cy + ry - 1, DIRT)
    for (dx, dy) in [(0, 0), (-1, 1)]: px(im, cx + dx, cy + dy, SAND)

def tee(x, y):
    rect(im, x, y, x + 4, y + 2, GRASS); line(im, [(x, y), (x + 4, y)], FOREST)
    px(im, x + 1, y + 1, WHITE); px(im, x + 3, y + 1, WHITE)

# hole 1: tee by the clubhouse going north to a green in the NW
fairway([(13, 44), (11, 30), (13, 14)], 8)
# hole 2: dogleg from the north edge east and down to the SE green over water
fairway([(30, 8), (46, 9), (53, 19), (53, 29)], 8)
# hole 3: back west from the SE to a green above the clubhouse
fairway([(53, 53), (42, 51), (32, 47)], 8)
mow((0, 0, 63, 63))

# water hazard between hole 2 and 3
ellipse(im, 27, 18, 41, 30, WATER)
ellipse(im, 33, 24, 45, 33, WATER)
for (x, y) in [(31, 22), (36, 27), (40, 30), (35, 21)]: px(im, x, y, BLUE)
for (x, y) in [(32, 23), (38, 28)]: px(im, x, y, WHITE)
# shoreline highlight (top-left lit)
edge = [(x, y) for y in range(64) for x in range(64) if get(im, x, y) == WATER and (get(im, x - 1, y) not in (WATER, BLUE, WHITE) or get(im, x, y - 1) not in (WATER, BLUE, WHITE))]
for (x, y) in edge: px(im, x, y, LIGHT)
edge = [(x, y) for y in range(64) for x in range(64) if get(im, x, y) in (WATER, BLUE) and (get(im, x + 1, y) not in (WATER, BLUE, WHITE, LIGHT) or get(im, x, y + 1) not in (WATER, BLUE, WHITE, LIGHT))]
for (x, y) in edge: px(im, x, y, BLUE)

green(13, 11, 6); flag(14, 11)
green(52, 33, 5); flag(53, 33, YELLOW)
green(26, 46, 5); flag(27, 46)
bunker(20, 9, 2, 2); bunker(7, 17, 2, 3); bunker(58, 31, 2, 3); bunker(46, 36, 2, 2); bunker(21, 41, 2, 2); bunker(31, 52, 2, 1); bunker(56, 20, 2, 2)
tee(12, 46); tee(26, 6); tee(54, 55)

# cart path (light) looping from the clubhouse
cart = spline([(10, 56), (20, 50), (22, 36), (26, 20), (24, 4), (58, 5), (60, 28), (61, 50), (57, 60), (44, 61), (31, 60)], closed=False)
for (x, y) in cart:
    if get(im, x, y) in (FOREST, GRASS): px(im, x, y, SAND)

# ---------- clubhouse + parking (south-west corner)
rect(im, 1, 52, 30, 62, DIRT)
speckle_on(im, rng, 20, [SAND, DARK], DIRT, (1, 52, 30, 62))
rect(im, 16, 57, 30, 62, MID)                          # parking lot
for x in range(17, 30, 3): px(im, x, 57, LIGHT); px(im, x, 62, LIGHT)
car(im, 17, 58, RED, False); car(im, 23, 58, BLUE, False); car(im, 26, 59, WHITE, False)
bldg(im, 3, 51, 11, 5, 4, roof=RED, wall=DARK, windows='dark', cast_len=2)
line(im, [(4, 53), (12, 53)], ORANGE)                 # roof ridge
rect(im, 5, 60, 6, 60, WHITE); rect(im, 8, 60, 9, 60, WHITE)   # golf carts

# trees in the rough
for (x, y) in [(2, 3), (5, 30), (2, 40), (21, 26), (22, 33), (36, 2), (39, 37), (44, 42), (48, 44), (24, 14), (5, 23), (60, 2), (60, 12), (62, 40), (46, 56), (35, 58), (60, 46), (36, 40), (20, 18), (3, 8)]:
    tree(im, x, y, big=(x + y) % 2 == 0)
# golfers
for (x, y) in [(13, 14), (15, 13), (51, 31), (27, 48), (13, 45), (27, 7), (42, 10)]:
    px(im, x, y, rng.choice([WHITE, YELLOW, RED, BLUE]))
border(im, 'park')
save(im, SLUG, 'Golf Course', 'Prestige: large +land value for residential within 10 tiles (attracts high-wealth), but costs big upkeep and lots of land.', 'park')
