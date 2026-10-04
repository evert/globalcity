from _civ import *

im = ground(3, 'dirt', 'museum')
SK = 1
# paved sculpture plaza in front
pave(im, 1, 26, 46, 46, LIGHT, WHITE)
for y in range(28, 46, 3):
    for x in range(2 + (y % 2) * 2, 46, 4): px(im, x, y, MID)

# main gallery: long low block with sawtooth skylights
X, Y, W, D, H = 9, 3, 36, 16, 5
block(im, X, Y, W, D, H, roof=LIGHT, west=WHITE, south=MID, skew=SK, sh=(3, 2))
for y in range(Y + 2, Y + D - 2, 3):
    line(im, [(X + 3, y), (X + W - 5, y)], WATER)
    line(im, [(X + 3, y + 1), (X + W - 5, y + 1)], MID)
    for x in range(X + 6, X + W - 5, 6): px(im, x, y, WHITE)
south_windows(im, X, Y, W, D, H, SK, BLACK, 4, rows=[2], start=3)
west_windows(im, X, Y, W, D, H, SK, MID, 4, cols=[2])
# entrance canopy + banners on the facade
for u in (8, 20):
    for v in range(0, 4): px(im, *south_px(X, Y, W, D, H, SK, u, v), RED)
for v in range(0, 4): px(im, *south_px(X, Y, W, D, H, SK, 26, v), YELLOW)

# glass pyramid: square base, apex pushed up by its height (oblique view)
CX, CY, R = 23, 36, 9
x0, y0, x1, y1 = CX - R, CY + 1, CX + R, CY + 7
ap = (CX - 1, CY - 7)
shade_poly(im, [(ap[0] + 4, ap[1] + 3), (x1 + 4, y1 + 2), (x0 + 2, y1 + 2)])
poly(im, [(x0, y0), (x1, y0), ap], WATER)                  # north face (lit, small)
poly(im, [(x0, y0), (x0, y1), ap], WHITE)                  # west face (catches the light)
poly(im, [(x1, y0), (x1, y1), ap], BLUE)                   # east face (dark)
poly(im, [(x0, y1), (x1, y1), ap], WATER)                  # south face (facing viewer)
# glazing grid on the south face (sparse) and west face
for yy in range(ap[1] + 4, y1, 4):
    f = (yy - ap[1]) / (y1 - ap[1])
    for xx in range(int(CX - R * f) + 2, int(CX + R * f) - 1, 2): px(im, xx, yy, BLUE)
line(im, [(ap[0], ap[1] + 1), (CX, y1)], BLUE)
for yy in range(y0 + 3, y1 - 1, 3):
    f = min(yy - y0, y1 - yy) / (y1 - y0)
    for xx in range(x0 + 1, x0 + int(R * f * 2) + 1, 2): px(im, xx, yy, WATER)
# edges
line(im, [(x0, y0), ap], WHITE); line(im, [(x0, y1), ap], WHITE); line(im, [(x1, y1), ap], BLUE)
line(im, [(x1, y0), ap], WATER)
line(im, [(x0, y1), (x1, y1)], BLACK); line(im, [(x1, y0), (x1, y1)], BLACK)
px(im, ap[0], ap[1], WHITE)

# sculptures: red abstract arc (left) and bronze figure (right)
for (x, y) in [(4, 37), (4, 36), (5, 35), (6, 34), (7, 34), (8, 35), (9, 36), (9, 37)]: px(im, x, y, RED)
px(im, 10, 37, BLACK); px(im, 10, 38, BLACK); px(im, 5, 38, DARK)
rect(im, 37, 39, 40, 41, MID); line(im, [(37, 39), (40, 39)], WHITE)
line(im, [(38, 35), (38, 38)], SAND); px(im, 39, 36, SAND); px(im, 37, 36, SAND); px(im, 38, 34, SAND)
px(im, 41, 40, BLACK); px(im, 41, 41, BLACK); px(im, 39, 38, BLACK)
# yellow mobile sculpture
rect(im, 40, 29, 41, 30, YELLOW); px(im, 42, 31, BLACK); px(im, 39, 31, ORANGE)
# planters
for (tx, ty) in [(2, 28), (2, 42), (43, 43), (12, 43)]:
    tree(im, tx, ty, big=True)
# visitors
for (x, y) in [(12, 30), (16, 27), (30, 28), (33, 32), (35, 36), (13, 38), (27, 45), (20, 45), (44, 34), (7, 31)]:
    px(im, x, y, BLACK if (x * y) % 4 else BLUE)
# trees behind the museum
for (tx, ty) in [(1, 2), (3, 8), (1, 15)]:
    tree(im, tx, ty, big=True)
border(im, 'civic')

save(im, 'museum', 'Art Museum',
     'Tourism magnet: boosts commercial demand and land value within 12 tiles; +culture.',
     'civic', 'civic')
