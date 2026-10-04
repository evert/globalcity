from _civ import *

im = ground(4, 'grass', 'university')
SK = 1
# perimeter path + diagonal walks across the quad
QX0, QY0, QX1, QY1 = 20, 26, 46, 50
rect(im, QX0 - 2, QY0 - 2, QX1 + 2, QY1 + 2, LIGHT)
rect(im, QX0, QY0, QX1, QY1, GRASS)
for y in range(QY0, QY1 + 1):
    for x in range(QX0, QX1 + 1):
        if rnd(x, y, 'q') % 1000 < 40: px(im, x, y, FOREST)
line(im, [(QX0, QY0), (QX1, QY1)], LIGHT); line(im, [(QX1, QY0), (QX0, QY1)], LIGHT)
line(im, [(33, QY0), (33, 63)], LIGHT); line(im, [(34, QY0), (34, 63)], LIGHT)
line(im, [(QX0, 38), (QX1, 38)], LIGHT)
# statue on a round lawn in the centre
ellipse(im, 29, 34, 38, 42, LIGHT, WHITE)
ellipse(im, 31, 36, 36, 40, GRASS)
rect(im, 33, 36, 34, 38, MID); px(im, 33, 35, WHITE); px(im, 33, 36, LIGHT); px(im, 35, 38, BLACK); px(im, 35, 37, BLACK)

# north hall with bell tower
X, Y, W, D, H = 18, 7, 36, 10, 6
block(im, X, Y, W, D, H, roof=DIRT, west=LIGHT, south=MID, skew=SK)
south_windows(im, X, Y, W, D, H, SK, WHITE, 2, rows=[1, 3])
line(im, [(X + 1, Y + 4), (X + W - 2, Y + 4)], SAND)  # roof ridge
line(im, [(X + 1, Y + 5), (X + W - 2, Y + 5)], ORANGE)
# bell tower: drawn upright (rises straight up from the north hall's ridge), pyramid cap, clock
TX, TB, TW = 33, 16, 6         # left x, base y (on the roof), width
shade_rect(im, TX + TW, TB - 9, TX + TW + 2, TB + 1)
rect(im, TX, TB - 10, TX + TW - 1, TB, LIGHT)                     # tower face (south)
line(im, [(TX, TB - 10), (TX, TB)], WHITE); line(im, [(TX + TW - 1, TB - 10), (TX + TW - 1, TB)], MID)
line(im, [(TX, TB), (TX + TW - 1, TB)], BLACK)
rect(im, TX + 2, TB - 9, TX + 3, TB - 7, BLACK)                  # belfry arch
px(im, TX + 2, TB - 9, DARK)
rect(im, TX + 1, TB - 5, TX + 4, TB - 2, WHITE); line(im, [(TX + 2, TB - 4), (TX + 2, TB - 3)], BLACK); px(im, TX + 3, TB - 3, BLACK)  # clock
rect(im, TX + 1, TB - 1, TX + 4, TB - 1, DARK)
poly(im, [(TX - 1, TB - 10), (TX + 2, TB - 14), (TX + 3, TB - 14), (TX + TW, TB - 10)], ORANGE)   # cap
poly(im, [(TX + 3, TB - 14), (TX + TW, TB - 10), (TX + 3, TB - 10)], DIRT)
line(im, [(TX - 1, TB - 10), (TX + 2, TB - 14)], YELLOW)
line(im, [(TX - 1, TB - 10), (TX + TW, TB - 10)], SAND)
px(im, TX + 2, TB - 15, YELLOW)
# west hall with library dome
X, Y, W, D, H = 9, 20, 10, 30, 5
block(im, X, Y, W, D, H, roof=DIRT, west=LIGHT, south=MID, skew=SK)
west_windows(im, X, Y, W, D, H, SK, MID, 2, cols=[2, 4])
line(im, [(X + 4, Y + 1), (X + 4, Y + D - 2)], ORANGE)
line(im, [(X + 5, Y + 1), (X + 5, Y + D - 2)], SAND)
shade_rect(im, X + 6, Y + 11, X + 9, Y + 18)
drum(im, X + 4, Y + 12, 5, 4)
cap(im, X + 4, Y + 11, 5, 5)
px(im, X + 4, Y + 5, WHITE)

# east hall
X, Y, W, D, H = 50, 20, 10, 30, 5
block(im, X, Y, W, D, H, roof=DIRT, west=LIGHT, south=MID, skew=SK)
west_windows(im, X, Y, W, D, H, SK, MID, 2, cols=[2, 4])
line(im, [(X + 4, Y + 1), (X + 4, Y + D - 2)], ORANGE)
line(im, [(X + 5, Y + 1), (X + 5, Y + D - 2)], SAND)
for (vx, vy) in [(X + 2, Y + 5), (X + 2, Y + 14), (X + 2, Y + 23)]:
    rect(im, vx, vy, vx + 1, vy + 1, MID)   # roof vents

# south gate: two small lodges + path out
for gx in (24, 40):
    block(im, gx, 54, 5, 4, 3, roof=DIRT, west=LIGHT, south=MID, skew=SK, sh=(2, 1))
rect(im, 32, 55, 35, 63, LIGHT)

# trees around the quad and the edges
for (tx, ty) in [(22, 21), (28, 21), (38, 21), (44, 21), (22, 52), (44, 52), (1, 2), (6, 4), (2, 10), (11, 3), (56, 2), (59, 8), (2, 50), (49, 57), (55, 55), (59, 58),
                 (23, 29), (42, 29), (23, 45), (42, 45)]:
    tree(im, tx, ty, big=True)
# students
for (x, y) in [(26, 38), (30, 31), (38, 44), (41, 38), (33, 47), (34, 52), (25, 25), (47, 34), (19, 40), (36, 30)]:
    px(im, x, y, BLACK if (x + y) % 3 else BLUE)
# small staff car park by the gate
pave(im, 2, 56, 19, 62, MID, LIGHT)
for x in range(4, 19, 3): line(im, [(x, 57), (x, 61)], DARK)
for (cx, cy, c) in [(5, 58, RED), (8, 59, WHITE), (14, 58, YELLOW), (17, 59, BLUE)]: car(im, cx, cy, c, vertical=True)
border(im, 'civic')
rect(im, 32, 63, 35, 63, LIGHT); rect(im, 2, 63, 9, 63, MID); rect(im, 2, 62, 9, 62, MID)

save(im, 'university', 'University',
     'Raises education level of residents within 15 tiles and attracts high-tech industry; needs a minimum city population of 20k.',
     'civic', 'civic')
