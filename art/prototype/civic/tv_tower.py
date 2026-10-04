from _civ import *

im = ground(3, 'dirt', 'tv_tower')
# paved yard + car park for the studio
pave(im, 22, 22, 46, 46, MID, LIGHT)
for x in range(25, 46, 3): line(im, [(x, 40), (x, 45)], DARK)
for (cx, c) in [(26, WHITE), (29, RED), (35, WHITE), (41, BLUE)]: car(im, cx, 42, c, vertical=True)
rect(im, 44, 46, 46, 47, MID)

# studio building with roof dishes
X, Y, W, D, H = 28, 21, 17, 11, 5
block(im, X, Y, W, D, H, roof=LIGHT, west=WHITE, south=MID, skew=1, sh=(3, 2))
for u in range(2, W - 2, 2): px(im, *south_px(X, Y, W, D, H, 1, u, 1), BLACK)
for u in range(2, W - 2, 2): px(im, *south_px(X, Y, W, D, H, 1, u, 3), BLACK)
for v in range(0, 4): px(im, *south_px(X, Y, W, D, H, 1, 4, v), RED)        # red stripe/logo band
px(im, *south_px(X, Y, W, D, H, 1, 5, 1), RED)
def dish(x, y, r=2):
    shade_rect(im, x + 1, y + 1, x + 2 * r + 1, y + 2 * r)
    ellipse(im, x, y, x + 2 * r, y + 2 * r, WHITE)
    ellipse(im, x + 1, y + 1, x + 2 * r, y + 2 * r, LIGHT)
    px(im, x + r, y + r, MID); px(im, x + r - 1, y + r - 1, DARK)
    line(im, [(x + r, y + r), (x + 2 * r + 1, y + r - 2)], DARK)
dish(X + 3, Y + 2, 2); dish(X + 9, Y + 3, 2)
rect(im, X + 13, Y + 2, X + 14, Y + 4, MID); px(im, X + 15, Y + 4, BLACK)
# big ground dish (uplink)
DX, DY = 33, 4
shade_poly(im, [(DX + 3, DY + 6), (DX + 12, DY + 6), (DX + 12, DY + 13), (DX + 3, DY + 13)])
ellipse(im, DX, DY, DX + 10, DY + 10, WHITE)
ellipse(im, DX + 2, DY + 2, DX + 10, DY + 10, LIGHT)
ellipse(im, DX + 4, DY + 4, DX + 9, DY + 9, MID)
line(im, [(DX + 5, DY + 5), (DX + 2, DY + 2)], DARK); px(im, DX + 2, DY + 2, BLACK)
rect(im, DX + 4, DY + 11, DX + 6, DY + 13, DARK)
# perimeter fence dots
for x in range(22, 47, 2): px(im, x, 20, DARK)

# --- the tower ---
TX = 13         # shaft left x
BASE = 40
# long thin shadow on the ground
for i in range(9):
    shade_rect(im, TX + 3 + i, BASE + 1 + i // 2, TX + 4 + i, BASE + 1 + i // 2)
# tripod base
poly(im, [(TX - 4, BASE), (TX, BASE - 8), (TX + 3, BASE - 8), (TX + 7, BASE)], LIGHT)
poly(im, [(TX + 2, BASE - 8), (TX + 3, BASE - 8), (TX + 7, BASE), (TX + 3, BASE)], MID)
line(im, [(TX - 4, BASE), (TX, BASE - 8)], WHITE)
rect(im, TX - 1, BASE - 3, TX + 1, BASE, DARK)
line(im, [(TX - 3, BASE + 1), (TX + 8, BASE + 1)], BLACK)
# shaft (white lit edge, light body, mid shade)
rect(im, TX, 13, TX + 3, BASE - 6, LIGHT)
line(im, [(TX, 13), (TX, BASE - 6)], WHITE)
line(im, [(TX + 3, 13), (TX + 3, BASE - 6)], MID)
for y in range(18, BASE - 6, 5): px(im, TX + 1, y, MID)
# observation pod (lit top-left, dark underside, window band)
PY = 9
shade_rect(im, TX + 9, PY + 3, TX + 12, PY + 8)
ellipse(im, TX - 7, PY, TX + 10, PY + 8, LIGHT)
ellipse(im, TX - 7, PY, TX + 10, PY + 8, None, MID)
ellipse(im, TX - 6, PY, TX + 4, PY + 4, WHITE)
rect(im, TX - 6, PY + 5, TX + 9, PY + 6, DARK)
for x in range(TX - 5, TX + 9, 2): px(im, x, PY + 5, YELLOW)
rect(im, TX - 4, PY + 7, TX + 7, PY + 8, MID)
line(im, [(TX - 3, PY + 9), (TX + 6, PY + 9)], DARK)
# antenna mast: red/white bands with aircraft-warning lights
for y in range(0, PY + 1):
    c = RED if (y // 2) % 2 == 0 else WHITE
    px(im, TX + 1, y, c); px(im, TX + 2, y, MID if c == WHITE else RED)
for y in (1, 5):
    px(im, TX, y, RED)
px(im, TX - 7, PY + 4, RED); px(im, TX + 10, PY + 4, RED)
# little ticket kiosk + visitors near the base
rect(im, 3, 42, 5, 43, RED); line(im, [(3, 42), (5, 42)], ORANGE); px(im, 6, 43, BLACK); px(im, 6, 42, BLACK)
for (x, y) in [(10, 44), (5, 45), (19, 43), (8, 38)]: px(im, x, y, BLACK)
for (tx, ty) in [(1, 2), (3, 20), (1, 30), (24, 2), (18, 30)]:
    tree(im, tx, ty, big=True)
border(im, 'civic')
rect(im, 44, 47, 46, 47, MID)

save(im, 'tv_tower', 'TV Tower',
     'Broadcast mast: raises commercial demand and city happiness (news/entertainment); slight land-value penalty right next to it.',
     'civic', 'civic')
