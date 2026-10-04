from _civ import *

im = ground(3, 'dirt', 'school')
SK = 1
# sports field (east) with a dirt running track
rect(im, 23, 17, 46, 37, SAND)
rect(im, 25, 19, 44, 35, GRASS)
for y in range(19, 36):
    for x in range(25, 45):
        if (x // 2 + y) % 4 == 0 and x % 2 == 0: px(im, x, y, FOREST)   # mowing stripes
ImageDraw.Draw(im).rectangle([26, 20, 43, 34], outline=WHITE)
line(im, [(26, 27), (43, 27)], WHITE)
ellipse(im, 32, 25, 37, 29, None, WHITE)
rect(im, 33, 19, 36, 19, WHITE); rect(im, 33, 35, 36, 35, WHITE)        # goals
px(im, 30, 23, RED); px(im, 39, 31, BLUE); px(im, 35, 24, RED); px(im, 34, 30, BLUE); px(im, 34, 27, WHITE)  # players + ball
# asphalt playground with hopscotch + hoop
rect(im, 2, 31, 21, 39, DARK)
line(im, [(2, 31), (21, 31)], MID)
ImageDraw.Draw(im).rectangle([4, 33, 19, 38], outline=WHITE)
line(im, [(11, 33), (11, 38)], WHITE); ellipse(im, 10, 34, 12, 37, None, WHITE)
rect(im, 3, 35, 3, 36, RED); rect(im, 20, 35, 20, 36, RED)
for (x, y) in [(9, 37), (13, 33), (15, 37), (6, 38), (20, 36)]: px(im, x, y, [RED, BLUE, YELLOW, WHITE, ORANGE][(x + y) % 5])

# L-shaped building: west-wing shadow, north wing, then west wing on top; roofs merged
X, Y, W, D, H = 9, 3, 33, 9, 4
X2, Y2, W2, D2, H2 = 9, 3, 10, 24, 4
shade_poly(im, [(a + 3, b + 2) for a, b in block_pts(X2, Y + D, W2, D2 - D, H2, SK)])
block(im, X, Y, W, D, H, roof=LIGHT, west=WHITE, south=MID, skew=SK, sh=(3, 2))
for u in range(10, W - 1, 1):
    for v in (1, 2):
        if u % 4: px(im, *south_px(X, Y, W, D, H, SK, u, v), WATER)
for (vx, vy) in [(X + 14, Y + 3), (X + 20, Y + 3), (X + 26, Y + 3)]:
    rect(im, vx, vy, vx + 2, vy + 2, MID); line(im, [(vx, vy), (vx + 2, vy)], WHITE); px(im, vx + 3, vy + 2, BLACK)
block(im, X2, Y2, W2, D2, H2, roof=LIGHT, west=WHITE, south=MID, skew=SK, sh=None)
for u in range(2, D2 - 1, 3):
    px(im, *west_px(X2, Y2, W2, D2, H2, SK, u, 2), WATER)
for u in range(1, W2 - 1):
    for v in (1, 2):
        if u % 4: px(im, *south_px(X2, Y2, W2, D2, H2, SK, u, v), WATER)
rect(im, X2 + W2 - 1, Y + 1, X2 + W2, Y + D - 1, LIGHT)
for vy in (Y + 12, Y + 18):
    rect(im, X2 + 3, vy, X2 + 5, vy + 2, MID); line(im, [(X2 + 3, vy), (X2 + 5, vy)], WHITE); px(im, X2 + 6, vy + 2, BLACK)
# entrance canopy + door at the inside corner, red accent
rect(im, X2 + W2, Y + D, X2 + W2 + 3, Y + D, RED)
px(im, X2 + W2 + 1, Y + D + 1, BLACK); px(im, X2 + W2 + 2, Y + D + 1, BLACK)
# gym block with a curved-ish roof on the north wing's east end
rect(im, 36, 2, 44, 10, MID); line(im, [(36, 2), (44, 2)], WHITE); line(im, [(36, 2), (36, 10)], WHITE)
for y in range(4, 10, 2): line(im, [(37, y), (43, y)], LIGHT)
line(im, [(45, 3), (45, 12)], BLACK)
# flag + bike rack
flag(im, 22, 13, RED, 5)
for x in range(2, 8, 2): px(im, x, 29, BLUE)

# drop-off road with the yellow school bus
rect(im, 1, 41, 46, 46, MID)
line(im, [(1, 41), (46, 41)], LIGHT)
for x in range(3, 46, 4): px(im, x, 44, WHITE)
BX, BY = 8, 42
rect(im, BX + 1, BY + 1, BX + 13, BY + 3, DARK)        # shadow
rect(im, BX, BY, BX + 12, BY + 2, YELLOW)
for x in range(BX + 3, BX + 12, 2): px(im, x, BY, BLACK)
px(im, BX, BY + 1, BLACK); px(im, BX + 12, BY, ORANGE)
line(im, [(BX + 1, BY + 2), (BX + 11, BY + 2)], ORANGE)
car(im, 30, 42, RED); car(im, 38, 45, BLUE)
# trees
for (tx, ty) in [(1, 2), (1, 9), (2, 16), (1, 23), (42, 12)]:
    tree(im, tx, ty, big=True)
border(im, 'civic')

save(im, 'school', 'Elementary School',
     'Raises education of children within 8 tiles (feeds the education quotient); residents nearby pay more rent.',
     'civic', 'civic')
