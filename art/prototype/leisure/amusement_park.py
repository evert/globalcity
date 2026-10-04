import math, random
from _common import *

SLUG = 'amusement_park'
rng = random.Random(SLUG)
im = canvas(4, 'dirt', SLUG)
speckle_on(im, rng, 40, [GRASS, FOREST], DIRT)

# --- paths: main avenue from south gate north, plus east-west promenade
PATH = MID
rect(im, 27, 34, 34, 62, PATH)          # north-south avenue
rect(im, 4, 34, 59, 39, PATH)           # east-west promenade
rect(im, 28, 26, 33, 34, PATH)          # up to the wheel plaza
ellipse(im, 23, 30, 38, 42, PATH)       # central plaza
for x in range(5, 59, 4): px(im, x, 36, LIGHT)
for y in range(41, 62, 4): px(im, 30, y, LIGHT)
# fountain in the plaza
ellipse(im, 27, 33, 34, 39, LIGHT); ellipse(im, 28, 34, 33, 38, WATER); px(im, 30, 35, WHITE); px(im, 31, 36, WHITE)

# --- roller coaster (north-east): looping track on stilts over a grassy infield
grass_patch(im, 49, 17, 13, 14, 3)
ctrl = [(44, 27), (39, 22), (39, 9), (43, 5), (56, 5), (59, 9), (59, 14), (56, 18), (52, 20), (51, 16), (54, 14), (57, 17), (59, 22), (57, 27)]
pts = spline(ctrl)
N = len(pts)
for (x, y) in pts: shade_px(im, x + 2, y + 3)
for i, (x, y) in enumerate(pts):
    if i % 7 == 0: px(im, x + 1, y + 2, DARK); px(im, x + 2, y + 3, DARK)    # stilts
for (x, y) in pts: px(im, x + 1, y + 1, BLACK)
for (x, y) in pts: px(im, x, y, WHITE)
for i, (x, y) in enumerate(pts):
    if i % 3 == 1 and get(im, x + 1, y + 1) == BLACK: px(im, x + 1, y + 1, DARK)    # cross-ties
# inner helix in the infield
for (x, y) in [(43, 10), (47, 14), (44, 18), (49, 9)]: tree(im, x, y, big=True)
# train of 5 cars on the top straight
for k, x in enumerate(range(44, 56, 3)):
    rect(im, x, 4, x + 1, 5, RED); px(im, x, 6, BLACK); px(im, x + 1, 6, BLACK)
rect(im, 56, 4, 56, 5, YELLOW)
# station
bldg(im, 44, 26, 13, 3, 2, roof=RED, wall=DARK)
for x in (46, 49, 52): px(im, x, 27, YELLOW)

# --- ferris wheel (north-west)
cx, cy, r = 15, 15, 11
cast(im, cx - 2, cy + r + 1, cx + 8, cy + r + 3)
# A-frame legs
line(im, [(cx, cy), (cx - 6, cy + r + 2)], DARK); line(im, [(cx, cy), (cx + 6, cy + r + 2)], DARK)
line(im, [(cx + 1, cy), (cx + 7, cy + r + 2)], BLACK)
ellipse(im, cx - r, cy - r, cx + r, cy + r, None, LIGHT)
ellipse(im, cx - r + 1, cy - r + 1, cx + r + 1, cy + r + 1, None, BLACK)
ellipse(im, cx - r, cy - r, cx + r, cy + r, None, WHITE)
for k in range(8):
    a = k * math.pi / 4 + 0.2
    ex, ey = cx + round(math.cos(a) * (r - 1)), cy + round(math.sin(a) * (r - 1))
    line(im, [(cx, cy), (ex, ey)], MID)
for k in range(8):
    a = k * math.pi / 4 + 0.2
    gx, gy = cx + round(math.cos(a) * r), cy + round(math.sin(a) * r)
    c = [RED, YELLOW, BLUE, ORANGE][k % 4]
    rect(im, gx - 1, gy, gx, gy + 1, c); px(im, gx + 1, gy + 1, BLACK)
rect(im, cx - 1, cy - 1, cx + 1, cy + 1, DARK); px(im, cx, cy, YELLOW)
for (lx, ly) in [(cx - 6, cy + r + 2), (cx + 6, cy + r + 2)]:
    line(im, [(cx + (lx - cx) * 0.55, cy + r * 0.55 + 1), (lx, ly)], DARK)
# base platform
rect(im, cx - 7, cy + r + 2, cx + 7, cy + r + 3, LIGHT)

# --- big top circus tent (south-west)
tx, ty, tr = 13, 51, 8
cast(im, tx - tr + 2, ty - tr + 2, tx + tr + 2, ty + tr + 2)
ellipse(im, tx - tr + 1, ty - tr + 1, tx + tr + 2, ty + tr + 2, BLACK)
for yy in range(ty - tr, ty + tr + 1):
    for xx in range(tx - tr, tx + tr + 1):
        if (xx - tx) ** 2 + (yy - ty) ** 2 <= tr * tr:
            ang = math.atan2(yy - ty, xx - tx)
            stripe = int((ang + math.pi) / (math.pi / 5)) % 2
            c = RED if stripe else WHITE
            if (xx - tx) + (yy - ty) > 5 and c == WHITE: c = LIGHT   # shaded side
            if (xx - tx) + (yy - ty) > 5 and c == RED: c = ORANGE if False else RED
            px(im, xx, yy, c)
px(im, tx, ty, YELLOW); px(im, tx, ty - 1, BLACK); px(im, tx + 1, ty - 2, RED); px(im, tx + 2, ty - 2, RED)

# --- small striped stalls along the promenade
def stall(x, y, c):
    cast(im, x + 4, y + 2, x + 5, y + 5)
    rect(im, x, y, x + 3, y + 3, WHITE)
    for k in range(0, 4, 2): rect(im, x + k, y, x + k, y + 3, c)
    rect(im, x, y + 3, x + 3, y + 4, DARK); px(im, x + 1, y + 4, YELLOW)
    rect(im, x + 4, y + 1, x + 4, y + 4, BLACK)
for (x, c) in [(38, BLUE)]:
    stall(x, 29, c)
stall(41, 41, ORANGE); stall(48, 41, BLUE); stall(55, 41, RED)

# --- carousel (south-east)
cx2, cy2 = 48, 54
ellipse(im, cx2 - 6, cy2 - 5, cx2 + 7, cy2 + 7, BLACK)
cast(im, cx2 - 3, cy2 + 6, cx2 + 9, cy2 + 8)
ellipse(im, cx2 - 7, cy2 - 6, cx2 + 6, cy2 + 6, YELLOW)
for yy in range(cy2 - 6, cy2 + 7):
    for xx in range(cx2 - 7, cx2 + 7):
        if get(im, xx, yy) == YELLOW:
            ang = math.atan2(yy - cy2, xx - cx2 + 0.5)
            if int((ang + math.pi) / (math.pi / 4)) % 2: px(im, xx, yy, ORANGE)
ellipse(im, cx2 - 2, cy2 - 2, cx2 + 1, cy2 + 1, RED); px(im, cx2 - 1, cy2 - 1, WHITE)

# --- entrance gate at the south edge + ticket booths
rect(im, 24, 58, 37, 59, RED); rect(im, 24, 60, 24, 62, DARK); rect(im, 37, 60, 37, 62, DARK)
line(im, [(25, 58), (36, 58)], YELLOW)
px(im, 38, 60, BLACK); px(im, 38, 61, BLACK)

# trees
for (x, y) in [(2, 2), (2, 40), (2, 44), (22, 42), (36, 44), (58, 33), (60, 46), (59, 58), (28, 3), (31, 9), (28, 16), (33, 22), (23, 30), (2, 30), (8, 30), (58, 34)]:
    tree(im, x, y, big=(x + y) % 3 == 0)

# crowds on paths and plaza
crowd(im, rng, 38, (3, 26, 60, 62), on=[MID, LIGHT])
border(im, 'park')
save(im, SLUG, 'Amusement Park', 'Tourism: +commercial demand and land value within 12 tiles; draws visitors from neighbouring cities, but noisy (-residential desirability adjacent).', 'park')
