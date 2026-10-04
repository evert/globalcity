import random
from _common import *

SLUG = 'train_station'
rng = random.Random(SLUG)
im = canvas(3, 'dirt', SLUG)
speckle_on(im, rng, 12, [GRASS, FOREST], DIRT)

def track(y):
    """5px rail bed running the full width: dark ballast, sand sleepers, two light rails (east-west)."""
    rect(im, 0, y, 47, y + 4, DARK)
    for x in range(1, 48, 3): line(im, [(x, y), (x, y + 4)], SAND)
    line(im, [(0, y + 1), (47, y + 1)], LIGHT); line(im, [(0, y + 3), (47, y + 3)], LIGHT)

def platform(y0, y1):
    rect(im, 0, y0, 47, y1, LIGHT)
    line(im, [(0, y0), (47, y0)], WHITE)
    line(im, [(0, y1), (47, y1)], YELLOW if False else MID)
    for x in range(1, 47, 2): px(im, x, y1 - 1, YELLOW)          # safety line

def canopy(x0, x1, y0, y1):
    cast(im, x0 + 2, y1 + 1, x1 + 2, y1 + 1)
    for x in range(x0 + 4, x1, 6): px(im, x, y1 + 1, DARK)      # columns
    rect(im, x0, y0, x1, y1, MID)
    line(im, [(x0, y0), (x1, y0)], WHITE)
    for x in range(x0 + 2, x1, 4): px(im, x, y0 + 1, LIGHT); px(im, x, y0 + 2, LIGHT)  # glazing strips
    line(im, [(x1, y0), (x1, y1)], DARK); line(im, [(x0, y1), (x1, y1)], DARK)

# ---------- forecourt/street on the north edge, station hall
rect(im, 0, 1, 47, 3, MID)
for x in range(1, 47, 4): px(im, x, 2, LIGHT)
platform(17, 20)
track(21)
platform(26, 31)
track(32)
platform(37, 41)
for x in range(0, 48, 2): px(im, x, 41, MID)
track(42)
rect(im, 0, 47, 47, 47, DIRT)

# station hall (light roof, dark facade with tall windows) + clock tower
bldg(im, 3, 4, 42, 6, 6, roof=LIGHT, wall=DARK, cast_len=1)
for x in range(6, 43, 3):
    px(im, x, 11, LIGHT); px(im, x, 12, WATER); px(im, x, 13, WATER)
rect(im, 6, 6, 41, 7, MID); line(im, [(6, 6), (41, 6)], WHITE)     # glazed ridge
for x in range(8, 41, 3): px(im, x, 7, WATER)
# clock tower (roof at the top, tall lit south face with the clock)
rect(im, 20, 1, 27, 3, MID); line(im, [(20, 1), (27, 1)], WHITE); px(im, 20, 2, WHITE)
rect(im, 20, 4, 27, 14, LIGHT); line(im, [(20, 4), (20, 14)], WHITE); line(im, [(27, 2), (27, 14)], DARK)
rect(im, 28, 3, 28, 15, BLACK)
ellipse(im, 21, 5, 26, 10, WHITE, BLACK)
px(im, 23, 6, BLACK); px(im, 23, 7, BLACK); px(im, 24, 8, BLACK); px(im, 23, 8, BLACK)
rect(im, 22, 12, 25, 14, BLACK); rect(im, 22, 13, 25, 14, ORANGE)   # entrance
px(im, 24, 0, RED)
car(im, 8, 1, YELLOW); car(im, 13, 1, YELLOW); car(im, 36, 1, WHITE); car(im, 41, 1, RED)

# platform canopies
canopy(6, 42, 28, 30)
canopy(6, 42, 38, 39)

# a train in the station: red loco + light carriages with a blue window band
def train(x0, x1, y, loco=RED):
    rect(im, x0 + 1, y + 4, x1 + 1, y + 4, BLACK)
    rect(im, x0, y, x1, y + 3, LIGHT)
    line(im, [(x0, y), (x1, y)], WHITE)
    for x in range(x0 + 1, x1, 2): px(im, x, y + 1, BLUE)
    for x in range(x0 + 7, x1, 8): line(im, [(x, y), (x, y + 3)], DARK)   # coupling gaps
    rect(im, x1 - 3, y, x1, y + 3, loco); px(im, x1, y + 1, YELLOW); px(im, x1, y + 2, YELLOW); px(im, x1 - 2, y + 1, BLACK)
    line(im, [(x0, y + 3), (x1, y + 3)], DARK)
train(4, 33, 32)
# a second train arriving from the west on the bottom track
rect(im, 0, 42, 10, 45, LIGHT); line(im, [(0, 42), (10, 42)], WHITE)
for x in range(0, 10, 2): px(im, x, 43, BLUE)
rect(im, 8, 42, 11, 45, ORANGE); px(im, 11, 43, YELLOW); px(im, 11, 44, YELLOW); line(im, [(0, 45), (11, 45)], DARK)
rect(im, 1, 46, 12, 46, BLACK)

# passengers
for (y0, y1, n) in [(17, 19, 8), (26, 27, 7), (31, 31, 5), (37, 37, 6), (40, 40, 4)]:
    crowd(im, rng, n, (1, y0, 46, y1), on=[LIGHT, WHITE], colours=[RED, BLUE, BLACK, ORANGE, DARK])
# signal lights at the east end
px(im, 46, 24, RED); px(im, 46, 35, GRASS); px(im, 46, 46, RED)
border(im, 'civic')
save(im, SLUG, 'Train Station', 'Transit hub: connects rail lines, -traffic on roads within 12 tiles and +commercial demand; passenger count scales with connected population.', 'civic')
