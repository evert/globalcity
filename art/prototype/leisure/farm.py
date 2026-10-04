import random
from _common import *

SLUG = 'farm'
rng = random.Random(SLUG)
im = canvas(3, 'dirt', SLUG)

def field(x0, y0, x1, y1, base, furrow, every=2, vertical=False):
    rect(im, x0, y0, x1, y1, base)
    if vertical:
        for x in range(x0, x1 + 1, every): line(im, [(x, y0), (x, y1)], furrow)
    else:
        for y in range(y0, y1 + 1, every): line(im, [(x0, y), (x1, y)], furrow)

# ---------- fields (with a farm track between them)
field(25, 2, 45, 19, YELLOW, ORANGE, 3)              # wheat (NE)
for (x, y) in [(28, 4), (35, 10), (41, 6), (31, 16)]: px(im, x, y, SAND)
field(2, 24, 21, 45, GRASS, FOREST, 2, True)          # green crop rows (SW)
field(25, 24, 34, 45, SAND, DIRT, 2)                  # ploughed (S)
field(37, 24, 45, 45, FOREST, GRASS, 3)               # orchard/corn (SE)
for y in range(25, 45, 4):
    for x in range(38, 45, 3): tree(im, x, y)
# hedgerows
for x in range(25, 46, 3): px(im, x, 21, FOREST); px(im, x + 1, 22, BLACK)
for y in range(24, 46, 3): px(im, 35, y, FOREST); px(im, 36, y + 1, BLACK)
# tracks
rect(im, 22, 2, 23, 46, DIRT); rect(im, 2, 21, 45, 22, DIRT)
for y in range(3, 46, 4): px(im, 22, y, SAND)

# tractor ploughing the brown field, leaving fresh dark furrows behind
for y in range(25, 45, 2):
    if y < 37: line(im, [(25, y), (30, y)], DARK)
rect(im, 28, 37, 31, 39, RED); rect(im, 29, 36, 30, 37, ORANGE)   # body + cab
px(im, 30, 36, WHITE)
rect(im, 27, 38, 27, 39, BLACK); rect(im, 32, 38, 32, 39, BLACK)   # big rear wheels
px(im, 28, 40, BLACK); px(im, 31, 40, BLACK); px(im, 33, 40, SAND)
# harvester on the wheat
rect(im, 39, 13, 43, 15, GREEN if False else GRASS); rect(im, 38, 16, 44, 16, DARK); px(im, 42, 13, WHITE)
line(im, [(39, 13), (43, 13)], WHITE); rect(im, 44, 14, 44, 16, BLACK); rect(im, 39, 17, 44, 17, SAND)
for x in range(38, 45): px(im, x, 18, YELLOW if x % 2 else ORANGE)

# ---------- farmyard (NW): barn, silo, farmhouse
rect(im, 2, 2, 21, 20, DIRT)
speckle_on(im, rng, 18, [SAND, DARK, GRASS], DIRT, (2, 2, 21, 20))
# silo: tall cylinder, dome top, oblique height runs downward
sx = 14
cast(im, sx + 5, 4, sx + 7, 17)
ellipse(im, sx, 1, sx + 5, 5, LIGHT, None); px(im, sx + 1, 2, WHITE); px(im, sx + 2, 2, WHITE); px(im, sx + 4, 4, MID)
rect(im, sx, 4, sx + 5, 15, LIGHT)
line(im, [(sx, 4), (sx, 15)], WHITE); line(im, [(sx + 5, 4), (sx + 5, 15)], MID); line(im, [(sx + 6, 5), (sx + 6, 16)], BLACK)
for y in range(6, 15, 3): line(im, [(sx + 1, y), (sx + 4, y)], MID)
rect(im, sx, 16, sx + 5, 16, DARK)
# red barn with white trim and a big X door
bldg(im, 2, 3, 11, 6, 5, roof=RED, wall=RED, side=BLACK, cast_len=2)
rect(im, 3, 4, 11, 4, ORANGE)                                       # lit north roof slope
line(im, [(3, 6), (11, 6)], DARK)                                   # ridge
line(im, [(2, 9), (11, 9)], WHITE)                                  # eave trim
rect(im, 5, 10, 8, 13, DARK)
for k in range(4): px(im, 5 + k, 10 + k, WHITE); px(im, 8 - k, 10 + k, WHITE)
px(im, 3, 11, WHITE); px(im, 10, 11, WHITE)                         # windows
# farmhouse with a little garden
bldg(im, 3, 16, 8, 3, 2, roof=MID, wall=WHITE, side=DARK, cast_len=1)
line(im, [(3, 17), (9, 17)], LIGHT); px(im, 5, 19, BLUE); px(im, 8, 19, DARK)
px(im, 4, 15, DARK)                                                 # chimney
# hay bales + tree
for (x, y) in [(13, 18), (16, 18), (14, 20)]: rect(im, x, y, x + 1, y, YELLOW); px(im, x + 2, y, SAND)
tree(im, 19, 17, True)
# a few cows by the track
for (x, y) in [(3, 22), (8, 22), (17, 21)]: px(im, x, y, WHITE); px(im, x + 1, y, BLACK)

border(im, 'res')
save(im, SLUG, 'Farm', 'Agriculture: produces food (+industrial demand for food processing) and must sit away from pollution; lowers land value of adjacent residential slightly but grows with nearby population.', 'res')
