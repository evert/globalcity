"""Hydro dam: a reservoir held back by a curved concrete arch dam with a spillway, turbine house and river."""
from _style import *

N = 64
im = ground(4, 'grass', 'hydro_dam')
P = im.load()
CX, CY, RAD = 32, 92, 70                   # arch: circle centre far below, so the crest bulges north

def crest(x):
    return round(CY - math.sqrt(RAD * RAD - (x - CX) ** 2))

FACE = 8                                    # downstream face height in px
# reservoir: everything north of the dam
for x in range(N):
    for y in range(0, crest(x)):
        P[x, y] = WATER
for (x, y) in [(5, 14), (20, 4), (33, 9), (46, 3), (55, 12), (27, 16), (12, 22), (40, 17), (58, 22), (50, 7), (8, 27), (17, 13), (62, 4)]:
    if y < crest(x) - 1: line(im, [(x, y), (x + 2, y)], BLUE)
# rocky shore in the north-west corner
poly(im, [(0, 0), (14, 0), (9, 4), (4, 9), (0, 11)], GRASS)
for (x, y) in [(2, 2), (6, 3), (3, 6), (9, 1)]: px(im, x, y, FOREST)
line(im, [(14, 0), (9, 4), (4, 9), (0, 11)], SAND)
# river below the dam: from the turbine-house tailrace down to the south edge, widening
for y in range(30, N):
    t = (y - 30) / (N - 30)
    xl = round(22 - 6 * t + 2 * math.sin(y / 5)); xr = round(42 + 4 * t + 2 * math.sin(y / 6 + 1))
    for x in range(xl, xr + 1):
        P[x, y] = BLUE if (y % 4 == 1 and (x + y * 5) % 11 in (0, 1, 2)) else WATER
    P[xl - 1, y] = SAND; P[xr + 1, y] = SAND                  # muddy banks
# dam body
for x in range(N):
    yc = crest(x)
    for y in range(yc, yc + 3): P[x, y] = LIGHT                   # crest road
    P[x, yc] = WHITE
    for y in range(yc + 3, yc + 3 + FACE):                        # stepped downstream face
        P[x, y] = MID if (y - yc) % 3 else DARK
    P[x, yc + 3 + FACE] = BLACK
    if x % 4 == 0: P[x, yc + 1] = MID                             # road dashes / joints
# spillway chute in the middle-right: white water pouring down the face
for x in range(38, 46):
    yc = crest(x)
    P[x, yc] = DARK
    for y in range(yc + 1, yc + 4 + FACE + 4):
        P[x, y] = WATER if (x % 2 == 0 and (y + x) % 5) else WHITE if (y + x * 3) % 7 else LIGHT
    P[37, yc + 1] = BLACK; P[46, yc + 1] = BLACK
for (x, y) in [(36, 32), (39, 34), (44, 33), (47, 32), (41, 36), (35, 34)]: px(im, x, y, WHITE)   # foam
# sluice gate piers on the crest above the spillway
for x in (37, 41, 45):
    yc = crest(x)
    prism(im, x, yc - 3, 2, 2, 2, roof=LIGHT, shadow=0)
# turbine house at the foot of the dam (west of the spillway)
yb = crest(26) + 3 + FACE
prism(im, 17, yb - 3, 17, 7, 4, roof=MID, win=YELLOW, shadow=2)
rect(im, 19, yb - 1, 31, yb + 1, DARK); line(im, [(19, yb - 1), (31, yb - 1)], BLACK)   # roof generator hatch row
for x in range(20, 31, 3): px(im, x, yb, LIGHT)
for (bx, by) in [(27, yb - 2), (26, yb - 1), (27, yb - 1), (28, yb - 1), (27, yb)]: px(im, bx, by, YELLOW)
# tailrace outflow (white churn) just south of the turbine house
for x in range(16, 30):
    for y in range(yb + 9, yb + 12):
        if (x + y) % 2: px(im, x, y, WHITE)
# switchyard on the east bank, line leaving east
rect(im, 50, 38, 61, 46, DIRT)
for y in range(38, 47):
    for x in range(50, 62):
        if (x * 5 + y * 3) % 7 == 0: px(im, x, y, SAND)
fence(im, 50, 38, 61, 46, DARK, 2)
prism(im, 55, 40, 3, 3, 2, roof=LIGHT, shadow=1); prism(im, 60, 40, 2, 3, 2, roof=LIGHT, shadow=1)
line(im, [(34, 36), (50, 41)], BLACK)                                    # cable from turbine house
for x in (52, 56): px(im, x, 44, YELLOW)
line(im, [(57, 46), (59, 63)], BLACK)                                   # line out to the grid
for (x, y) in [(58, 52), (59, 60)]:                                      # pylons
    shadow_rect(im, x + 1, y + 2, x + 3, y + 2)
    rect(im, x - 1, y, x + 1, y + 1, DARK); px(im, x - 1, y, LIGHT); px(im, x + 1, y + 1, BLACK)
# access road down the west bank to the turbine house
line(im, [(0, 39), (6, 42), (12, 42), (16, 40)], MID, 2)
# trees on the banks
for (x, y, b) in [(4, 48, True), (9, 55, False), (3, 58, True), (12, 61, False), (48, 55, True), (52, 61, False), (61, 51, False), (14, 50, False)]:
    tree(im, x, y, b)
border(im, 'power')
save(im, 'hydro_dam', 'Hydroelectric Dam',
     'Clean power, 800 units, must be placed across a river; floods the upstream tiles into a reservoir that boosts nearby land value.',
     'utilities', 'power')
