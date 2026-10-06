"""City Hall, second pass: the originals' 45-degree oblique view (skew 1). Every block's roof sits up-right of
its footprint; the lit west wall and the shaded south wall slant down-left from the roof edge; shadows fall
east. The rotunda is a cylinder leaning the same way, the portico columns follow the south wall's slant."""
from _civ import *

im = ground(4, 'grass', 'city_hall')
SK = 1
# forecourt plaza with a fountain, avenue leaving through the south edge
pave(im, 6, 44, 57, 59, LIGHT, WHITE)
for x in range(8, 57, 4):
    for y in range(46, 59, 4): px(im, x, y, MID)
rect(im, 26, 59, 35, 63, MID); line(im, [(30, 60), (30, 63)], WHITE)
# car park, north-east
pave(im, 47, 1, 62, 11, MID, LIGHT)
for x in range(49, 62, 3): line(im, [(x, 3), (x, 9)], DARK)
for (cx, cy, c) in [(50, 4, RED), (53, 7, BLUE), (56, 4, YELLOW), (59, 6, WHITE)]: car(im, cx, cy, c, vertical=True)

# The three blocks touch and are drawn east to west: in this view a block hides the west wall of its
# eastern neighbour, so only the part of the taller central block above the west wing shows.
def wing(wx):
    X, Y, W, D, H = wx, 19, 14, 12, 6
    block(im, X, Y, W, D, H, roof=LIGHT, west=LIGHT, south=DARK, skew=SK, sh=(3, 2))
    south_windows(im, X, Y, W, D, H, SK, YELLOW, 2, rows=[1, 3], start=1)
    west_windows(im, X, Y, W, D, H, SK, MID, 2, cols=[2, 4], start=1)
    rect(im, X + 2, Y + 2, X + W - 3, Y + D - 3, MID)                     # roof light well
    line(im, [(X + 2, Y + 2), (X + W - 3, Y + 2)], DARK)


wing(47)
X, Y, W, D, H = 25, 13, 22, 16, 9
block(im, X, Y, W, D, H, roof=LIGHT, west=LIGHT, south=DARK, skew=SK, sh=(4, 2))
west_windows(im, X, Y, W, D, H, SK, MID, 2, cols=[2, 4, 6], start=1)
# portico: white columns on the dark south wall, slanting with it, every third pixel
for u in range(1, W - 1, 3):
    for v in range(0, H - 1):
        px(im, *south_px(X, Y, W, D, H, SK, u, v), WHITE)
# pediment on the roof's front edge
poly(im, [(X + 2, Y + D - 1), (X + W // 2 - 1, Y + D - 7), (X + W - 3, Y + D - 1)], WHITE)
line(im, [(X + W // 2 - 1, Y + D - 7), (X + W - 3, Y + D - 1)], MID)
line(im, [(X + 2, Y + D - 1), (X + W - 3, Y + D - 1)], MID)
px(im, X + W // 2 - 1, Y + D - 3, YELLOW)
# steps below the portico, following the wall's base line
bx0, by = south_px(X, Y, W, D, H, SK, 0, H - 1)
for i in range(3):
    line(im, [(bx0 - i, by + 1 + i), (bx0 + W - 1 - i, by + 1 + i)], WHITE if i % 2 == 0 else LIGHT)

# rotunda: a drum leaning down-left (stacked rings, lit west), dome cap and lantern on top
CX, CY, R, DH = 37, 9, 6, 5
for k in range(DH, -1, -1):
    cx, cy = CX - k, CY + k
    for x in range(cx - R, cx + R + 1):
        t = (x - cx) / R
        c = WHITE if t < -0.45 else LIGHT if t < 0.25 else MID if t < 0.7 else DARK
        px(im, x, cy, c)
        if k == DH: px(im, x, cy + 1, BLACK)
for k in range(1, DH, 2):                                  # column slits on the drum
    for x in range(CX - k - R + 2, CX - k + R - 1, 2): px(im, x, CY + k, DARK if x < CX - k + 4 else BLACK)
cap(im, CX, CY, R, 6)
rect(im, CX - 1, 1, CX + 1, 3, WHITE); px(im, CX + 1, 2, MID); px(im, CX, 0, YELLOW)
shade_rect(im, CX + R + 1, CY - 2, CX + R + 2, CY + DH)  # rotunda shadow on the roof

wing(11)

# fountain
ellipse(im, 24, 48, 36, 56, WHITE, MID); ellipse(im, 25, 49, 35, 55, WATER)
px(im, 30, 51, WHITE); px(im, 29, 52, WHITE); px(im, 31, 52, WHITE); px(im, 30, 52, BLUE)
# flags, trees, planters, people
for fx, c in ((9, RED), (13, BLUE), (47, BLUE), (51, RED)): flag(im, fx, 45, c, 6)
for (tx, ty) in [(1, 3), (6, 1), (13, 3), (20, 1), (40, 2), (1, 30), (2, 37), (1, 44), (58, 30), (58, 38), (9, 59), (17, 60), (42, 59), (50, 60)]:
    tree(im, tx, ty, big=True)
for (x, y) in [(18, 50), (21, 54), (39, 49), (42, 55), (15, 57), (35, 58), (12, 52), (28, 46), (33, 57)]: px(im, x, y, BLACK)
border(im, 'civic')
rect(im, 26, 63, 35, 63, MID)
save(im, 'city_hall_v2', 'City Hall (oblique)',
     'Seat of government: +10% tax collection and lowers crime/unrest citywide, boosts nearby commercial land value.',
     'civic', 'civic')
