from _civ import *

im = ground(4, 'grass', 'city_hall')
# forecourt plaza + avenue to the south edge
pave(im, 8, 41, 55, 58, LIGHT, WHITE)
for x in range(10, 55, 4):
    for y in range(43, 58, 4): px(im, x, y, MID)
rect(im, 27, 58, 36, 63, MID); line(im, [(31, 59), (31, 63)], WHITE)
# car park behind the east wing
pave(im, 47, 1, 62, 12, MID, LIGHT)
for x in range(49, 62, 3): line(im, [(x, 3), (x, 10)], DARK)
for (cx, cy, c) in [(50, 4, RED), (53, 8, BLUE), (56, 4, YELLOW), (59, 7, WHITE), (50, 9, ORANGE)]:
    car(im, cx, cy, c, vertical=True)

SK = 0
# side wings
for wx in (7, 37):
    X, Y, W, D, H = wx, 15, 20, 15, 8
    block(im, X, Y, W, D, H, roof=LIGHT, west=WHITE, south=MID, skew=SK)
    south_windows(im, X, Y, W, D, H, SK, BLACK, 2, rows=[2, 5], start=2)
    line(im, [(X + 1, Y + D - 2), (X + W - 2, Y + D - 2)], MID)
# central block (taller)
X, Y, W, D, H = 18, 10, 28, 18, 10
block(im, X, Y, W, D, H, roof=LIGHT, west=WHITE, south=MID, skew=SK)
# portico: columns across the central facade under a pediment
rect(im, X + 2, Y + D, X + W - 3, Y + D + H - 2, DARK)
for u in range(X + 3, X + W - 3, 3):
    line(im, [(u, Y + D), (u, Y + D + H - 2)], WHITE)
    line(im, [(u + 1, Y + D), (u + 1, Y + D + H - 2)], LIGHT)
line(im, [(X + 1, Y + D), (X + W - 2, Y + D)], WHITE)
# pediment on the roof front
poly(im, [(X + 2, Y + D - 1), (X + W // 2 - 1, Y + D - 7), (X + W - 3, Y + D - 1)], WHITE)
line(im, [(X + W // 2 - 1, Y + D - 7), (X + W - 3, Y + D - 1)], MID)
line(im, [(X + 2, Y + D - 1), (X + W - 3, Y + D - 1)], MID)
px(im, X + W // 2 - 1, Y + D - 3, YELLOW)
# steps
for i in range(3):
    line(im, [(X + 1 - i, Y + D + H + i), (X + W - 2 + i, Y + D + H + i)], WHITE if i % 2 == 0 else LIGHT)

# rotunda: drum with columns + dome cap + lantern with flag
CX = 31
drum(im, CX, 12, 8, 7)
cap(im, CX, 11, 8, 7)
rect(im, CX - 1, 2, CX + 1, 4, WHITE); px(im, CX + 1, 3, MID)
px(im, CX, 1, YELLOW)
# fountain
ellipse(im, 25, 46, 37, 54, WHITE, MID)
ellipse(im, 26, 47, 36, 53, WATER)
px(im, 31, 49, WHITE); px(im, 30, 50, WHITE); px(im, 32, 50, WHITE); px(im, 31, 50, BLUE)
px(im, 28, 51, BLUE); px(im, 34, 51, BLUE); px(im, 31, 52, BLUE)
# flags flanking the steps
for fx, c in ((11, RED), (15, BLUE), (47, BLUE), (51, RED)):
    flag(im, fx, 43, c, 6)
# hedges / trees
for (tx, ty) in [(1, 3), (6, 1), (12, 3), (19, 1), (40, 2), (1, 34), (3, 40), (2, 47), (2, 54), (57, 40), (58, 47), (57, 54), (9, 59), (17, 60), (43, 59), (50, 60)]:
    tree(im, tx, ty, big=True)
# planters with trees at the plaza corners, benches
for (tx, ty) in [(10, 52), (50, 52)]:
    rect(im, tx - 1, ty - 1, tx + 4, ty + 4, DARK); rect(im, tx, ty, tx + 3, ty + 3, GRASS); tree(im, tx, ty, big=True)
for bx in (19, 41):
    line(im, [(bx, 49), (bx + 2, 49)], SAND); line(im, [(bx + 1, 50), (bx + 3, 50)], MID)
# people
for (x, y) in [(20, 46), (22, 52), (40, 47), (43, 53), (17, 55), (36, 56), (13, 50), (29, 44), (31, 57)]:
    px(im, x, y, BLACK)
border(im, 'civic')
rect(im, 27, 63, 36, 63, MID)

save(im, 'city_hall', 'City Hall',
     'Seat of government: +10% tax collection and lowers crime/unrest citywide, boosts nearby commercial land value.',
     'civic', 'civic')
