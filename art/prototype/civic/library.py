from _civ import *

im = ground(3, 'dirt', 'library')
SK = 0
# reading garden (east)
rect(im, 35, 2, 46, 40, GRASS)
for y in range(2, 41):
    for x in range(35, 47):
        if rnd(x, y, 'g') % 1000 < 45: px(im, x, y, FOREST)
line(im, [(35, 2), (46, 2)], FOREST); line(im, [(35, 2), (35, 40)], FOREST)
line(im, [(40, 3), (40, 40)], SAND); line(im, [(36, 21), (46, 21)], SAND)
ellipse(im, 38, 19, 42, 23, SAND); px(im, 40, 21, WATER); px(im, 39, 21, WATER)  # bird bath
for (tx, ty) in [(36, 4), (43, 5), (36, 12), (43, 13), (42, 28), (36, 30), (43, 35)]:
    tree(im, tx, ty, big=True)
for (bx, by) in [(37, 25), (42, 17)]:
    line(im, [(bx, by), (bx + 2, by)], SAND); line(im, [(bx, by + 1), (bx + 2, by + 1)], DARK)
for (x, y) in [(38, 26), (43, 18), (41, 33)]: px(im, x, y, BLUE)  # readers

# street with parked cars
rect(im, 1, 41, 46, 46, DARK)
for x in range(3, 46, 4): px(im, x, 44, LIGHT)
car(im, 6, 42, RED); car(im, 30, 42, WHITE); car(im, 40, 45, YELLOW)
# forecourt / sidewalk
pave(im, 1, 34, 34, 40, LIGHT, WHITE)
line(im, [(1, 40), (34, 40)], MID)

X, Y, W, D, H = 3, 5, 30, 17, 10
block(im, X, Y, W, D, H, roof=LIGHT, west=WHITE, south=MID, skew=SK, sh=(3, 2))
# temple roof: ridge runs north-south, lit west slope, shaded east slope
RX = X + W // 2 - 1
rect(im, RX + 1, Y + 1, X + W - 2, Y + D - 1, MID)
line(im, [(RX, Y), (RX, Y + D - 1)], WHITE)
for y in range(Y + 2, Y + D - 1, 3):
    line(im, [(X + 2, y), (RX - 2, y)], WHITE if y % 2 else LIGHT)   # roof tile courses
    line(im, [(RX + 2, y), (X + W - 3, y)], DARK)
line(im, [(X + W - 1, Y + 1), (X + W - 1, Y + D - 1)], BLACK)
for vx in (RX + 4, RX + 9): rect(im, vx, Y + 4, vx + 1, Y + 5, LIGHT); px(im, vx + 2, Y + 5, BLACK)  # vents
# frieze + colonnade across the whole facade
rect(im, X, Y + D, X + W - 2, Y + D + 1, WHITE); line(im, [(X, Y + D + 1), (X + W - 2, Y + D + 1)], LIGHT)
rect(im, X + 1, Y + D + 2, X + W - 3, Y + D + H - 1, DARK)
for u in range(X + 2, X + W - 3, 3):
    line(im, [(u, Y + D + 2), (u, Y + D + H - 1)], WHITE)
    line(im, [(u + 1, Y + D + 2), (u + 1, Y + D + H - 1)], LIGHT)
# door
rect(im, X + 13, Y + D + 5, X + 15, Y + D + H - 1, BLACK); px(im, X + 14, Y + D + 5, YELLOW)
# low pediment
poly(im, [(X + 1, Y + D - 1), (RX, Y + D - 8), (X + W - 2, Y + D - 1)], LIGHT)
line(im, [(X + 1, Y + D - 2), (RX, Y + D - 9)], DARK)
line(im, [(X + 1, Y + D - 1), (RX, Y + D - 8)], WHITE)
line(im, [(RX + 1, Y + D - 8), (X + W - 1, Y + D - 1)], BLACK)
line(im, [(RX, Y + D - 8), (X + W - 2, Y + D - 1)], MID)
line(im, [(X + 1, Y + D - 1), (X + W - 2, Y + D - 1)], MID)
px(im, RX, Y + D - 4, YELLOW); px(im, RX - 1, Y + D - 3, SAND); px(im, RX + 1, Y + D - 3, SAND)
# steps
for i in range(3):
    line(im, [(X + 4 - i, Y + D + H + i), (X + W - 6 + i, Y + D + H + i)], WHITE if i % 2 == 0 else LIGHT)
# lion statues on plinths
for lx in (3, 28):
    rect(im, lx, 36, lx + 3, 38, MID); line(im, [(lx, 36), (lx + 3, 36)], WHITE)
    rect(im, lx, 34, lx + 2, 35, SAND); px(im, lx, 33, SAND); px(im, lx + 1, 33, ORANGE)
    px(im, lx + 4, 37, BLACK); px(im, lx + 4, 38, BLACK); px(im, lx + 3, 35, DARK)
# lamp posts + people
for lx in (11, 23):
    px(im, lx, 34, YELLOW); px(im, lx, 35, DARK); px(im, lx, 36, DARK)
for (x, y) in [(15, 37), (19, 36), (8, 38), (25, 38), (30, 36)]: px(im, x, y, BLACK)
# banners hanging between the outer columns
for bx in (X + 3, X + W - 7):
    rect(im, bx + 1, Y + D + 2, bx + 1, Y + D + 6, RED); px(im, bx + 1, Y + D + 7, ORANGE)
border(im, 'civic')

save(im, 'library', 'Public Library',
     'Small education boost (+literacy) and land-value bonus for residential within 8 tiles; cheap upkeep.',
     'civic', 'civic')
