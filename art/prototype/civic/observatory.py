from _civ import *

im = ground(3, 'grass', 'observatory')
HX, HY, RX, RY = 23, 22, 21, 18
# lowland: denser dark speckle; hill: clean lit grass; south-east slope in shade
for y in range(48):
    for x in range(48):
        dx, dy = (x - HX) / RX, (y - HY) / RY
        d = dx * dx + dy * dy
        side = dx * 0.6 + dy * 0.8
        if d >= 1.0:
            if (x + y) % 2 == 0 and rnd(x, y, 'lo') % 3 == 0: px(im, x, y, FOREST)
        else:
            px(im, x, y, GRASS)
            if d > 0.55 and side > 0.25:
                px(im, x, y, FOREST if (d > 0.72 or (x + y) % 2) else GRASS)
            elif rnd(x, y, 'hi') % 40 == 0:
                px(im, x, y, FOREST)
# dirt clearing at the summit
for y in range(48):
    for x in range(48):
        dx, dy = (x - 22) / 15, (y - 22) / 12
        if dx * dx + dy * dy < 1.0:
            r = rnd(x, y, 'sum') % 100
            px(im, x, y, SAND if r < 6 else DARK if r < 9 else DIRT)
# winding access road up the hill from the south edge
road = [(33, 47), (34, 44), (36, 41), (37, 38), (35, 35), (31, 33)]
for a, b in zip(road, road[1:]):
    line(im, [a, b], SAND, 3)
for a, b in zip(road, road[1:]):
    line(im, [a, b], MID, 1)

# main dome on its drum
CX, CY, R = 20, 21, 10
shade_poly(im, [(CX + R, CY - 7), (CX + R + 4, CY + 1), (CX + R + 4, CY + 8), (CX - R + 3, CY + 8), (CX - R + 3, CY + 6)])
drum(im, CX, CY + 1, R, 5, face=LIGHT, slit=LIGHT)
for x in range(CX - R + 2, CX + R - 1, 4): px(im, x, CY + 3, DARK)
rect(im, CX - 3, CY + 2, CX - 1, CY + 5, DARK); line(im, [(CX - 3, CY + 2), (CX - 1, CY + 2)], BLACK)  # door
cap(im, CX, CY, R, 11, base=WHITE, lit=WHITE, mid=LIGHT, dark=MID)
import math
for a in range(0, 91, 3):   # dark rim on the shaded (east) side of the dome
    t = math.radians(a)
    px(im, CX + round(R * math.sin(t)), CY - round(11 * math.cos(t)), DARK if a > 25 else MID)
# open observing slit with the telescope
for y in range(CY - 11, CY + 1):
    w = 1 if y < CY - 9 else 2
    rect(im, CX + 1, y, CX + 1 + w, y, BLACK)
line(im, [(CX + 4, CY - 9), (CX + 4, CY)], MID)
line(im, [(CX + 1, CY - 8), (CX + 2, CY - 6)], BLUE); px(im, CX + 1, CY - 8, WATER)
line(im, [(CX - R, CY + 1), (CX + R, CY + 1)], MID)
line(im, [(CX - R + 1, CY + 6), (CX + R, CY + 6)], BLACK)

# little lab building + parked car on the summit (east)
X, Y, W, D, H = 8, 31, 10, 5, 3
block(im, X, Y, W, D, H, roof=MID, west=LIGHT, south=DARK, skew=1, sh=(2, 2))
for u in range(2, W - 1, 2): px(im, *south_px(X, Y, W, D, H, 1, u, 1), YELLOW)
rect(im, X + 6, Y + 1, X + 7, Y + 2, MID); px(im, X + 8, Y + 2, BLACK)
line(im, [(X + 3, Y - 4), (X + 3, Y + 2)], WHITE); px(im, X + 2, Y - 3, LIGHT); px(im, X + 4, Y - 3, LIGHT); px(im, X + 3, Y - 5, RED); px(im, X + 4, Y + 2, BLACK)
car(im, 30, 31, RED); car(im, 27, 32, BLUE)

# trees in the lowland and on the slopes
for (tx, ty) in [(2, 2), (8, 1), (1, 9), (41, 2), (44, 9), (2, 40), (8, 43), (41, 41), (44, 33), (16, 44)]:
    tree(im, tx, ty, big=True)
for (x, y) in [(12, 38), (24, 40), (5, 25), (40, 28), (9, 12)]: px(im, x, y, YELLOW)   # wildflowers
for (x, y) in [(13, 30), (27, 33)]: px(im, x, y, BLACK)   # astronomers
border(im, 'civic')
rect(im, 32, 47, 34, 47, MID)

save(im, 'observatory', 'Observatory',
     'Science landmark: +education and +tech-industry demand; must be placed away from heavy pollution and bright high-density zones.',
     'civic', 'civic')
