from _civ import *

im = ground(3, 'grass', 'cathedral')
SK = 0
# cathedral square (paved) in front, path to the south edge
pave(im, 3, 40, 44, 47, LIGHT, WHITE)
for x in range(5, 44, 4): px(im, x, 44, MID)

def gable_ns(x0, y0, x1, y1, lit=MID, shade=DARK):
    """Pitched roof with the ridge running north-south."""
    rx = (x0 + x1) // 2
    rect(im, x0, y0, rx, y1, lit); rect(im, rx + 1, y0, x1, y1, shade)
    for y in range(y0 + 2, y1, 2):
        line(im, [(x0 + 1, y), (rx - 1, y)], LIGHT if y % 4 == 0 else lit)
        line(im, [(rx + 2, y), (x1 - 1, y)], BLACK if y % 4 == 0 else shade)
    line(im, [(rx, y0), (rx, y1)], WHITE)
    line(im, [(x0, y0), (x0, y1)], WHITE); line(im, [(x1, y0), (x1, y1)], BLACK)

def gable_ew(x0, y0, x1, y1, lit=MID, shade=DARK):
    ry = (y0 + y1) // 2
    rect(im, x0, y0, x1, ry, lit); rect(im, x0, ry + 1, x1, y1, shade)
    for x in range(x0 + 2, x1, 2):
        line(im, [(x, y0 + 1), (x, ry - 1)], LIGHT if x % 4 == 0 else lit)
        line(im, [(x, ry + 2), (x, y1 - 1)], BLACK if x % 4 == 0 else shade)
    line(im, [(x0, ry), (x1, ry)], WHITE)
    line(im, [(x0, y0), (x1, y0)], WHITE); line(im, [(x0, y1), (x1, y1)], BLACK)

# shadow of the whole mass
shade_poly(im, [(31, 2), (33, 3), (33, 30), (36, 31), (40, 31), (40, 41), (36, 43), (14, 43), (14, 41), (36, 41)])
# side aisles with buttresses
for (ax0, ax1) in ((12, 16), (31, 35)):
    rect(im, ax0, 4, ax1, 30, MID if ax0 == 12 else DARK)
    line(im, [(ax0, 4), (ax0, 30)], LIGHT if ax0 == 12 else MID)
    for y in range(6, 30, 4):
        line(im, [(ax0 - 1, y), (ax1 + 1, y)], LIGHT if ax0 == 12 else MID)
        px(im, ax0 - 1 if ax0 == 12 else ax1 + 1, y + 1, BLACK)
# nave
gable_ns(17, 1, 30, 30)
# transept
shade_rect(im, 40, 6, 42, 13)
gable_ew(8, 5, 39, 11)
# crossing flèche (small lead spire)
rect(im, 21, 6, 26, 10, LIGHT); line(im, [(21, 6), (21, 10)], WHITE); line(im, [(26, 6), (26, 10)], BLACK)
line(im, [(21, 10), (26, 10)], DARK); px(im, 23, 8, DARK); px(im, 24, 8, DARK)
poly(im, [(21, 6), (23, 0), (24, 0), (26, 6)], MID); line(im, [(21, 6), (23, 0)], WHITE); line(im, [(24, 0), (26, 6)], BLACK)
px(im, 23, 0, YELLOW)
# transept end walls (stone) with small rose windows
for ex in (8, 39):
    line(im, [(ex, 5), (ex, 11)], LIGHT if ex == 8 else MID)

# west front (facing south) between the towers
FX0, FX1, FY, FH = 17, 30, 31, 9
rect(im, FX0, FY, FX1, FY + FH - 1, LIGHT)
line(im, [(FX0, FY), (FX1, FY)], WHITE)
# gable over the facade
poly(im, [(FX0, FY), (23, FY - 6), (FX1, FY)], LIGHT); line(im, [(FX0, FY), (23, FY - 6)], WHITE); line(im, [(23, FY - 6), (FX1, FY)], MID)
# rose window
ellipse(im, 20, FY - 3, 27, FY + 4, WHITE)
ellipse(im, 21, FY - 2, 26, FY + 3, BLUE)
px(im, 23, FY, RED); px(im, 24, FY + 1, RED); px(im, 23, FY + 1, YELLOW); px(im, 24, FY, YELLOW)
px(im, 22, FY - 1, WATER); px(im, 25, FY + 2, WATER); px(im, 25, FY - 1, RED); px(im, 22, FY + 2, RED)
# portal (pointed arch)
rect(im, 21, FY + 6, 26, FY + FH - 1, DARK); rect(im, 22, FY + 5, 25, FY + FH - 1, BLACK); px(im, 23, FY + 4, BLACK); px(im, 24, FY + 4, BLACK)
line(im, [(23, FY + 5), (23, FY + FH - 1)], SAND); line(im, [(24, FY + 5), (24, FY + FH - 1)], SAND)
for x in (19, 28): line(im, [(x, FY + 5), (x, FY + FH - 1)], MID)

# twin towers (square, tall, pointed spires)
for tx in (10, 30):
    TW, TY, TH = 8, 20, 18
    rect(im, tx, TY, tx + TW - 1, TY + TH - 1, WHITE if tx == 10 else LIGHT)    # south face of the tower
    line(im, [(tx + TW - 1, TY), (tx + TW - 1, TY + TH - 1)], MID)
    line(im, [(tx, TY + TH - 1), (tx + TW - 1, TY + TH - 1)], BLACK)
    for wy in (TY + 3, TY + 9):   # lancet windows
        for wx in (tx + 2, tx + 5):
            line(im, [(wx, wy), (wx, wy + 3)], DARK); px(im, wx, wy, MID)
    px(im, tx + 3, TY + 14, DARK); px(im, tx + 4, TY + 14, DARK)
    # spire
    SH = 9
    shade_poly(im, [(tx + TW // 2 + 2, TY - SH + 3), (tx + TW + 2, TY + 1), (tx + TW, TY)])
    poly(im, [(tx, TY), (tx + TW // 2 - 1, TY - SH), (tx + TW // 2, TY - SH), (tx + TW - 1, TY)], MID)
    poly(im, [(tx + TW // 2, TY - SH), (tx + TW - 1, TY), (tx + TW // 2, TY)], DARK)
    line(im, [(tx, TY), (tx + TW // 2 - 1, TY - SH)], WHITE)
    line(im, [(tx + TW // 2, TY - SH), (tx + TW - 1, TY)], BLACK)
    line(im, [(tx, TY), (tx + TW - 1, TY)], LIGHT)
    for k in (TY - 4, TY - 8): px(im, tx + TW // 2 - 1, k, LIGHT)   # lucarnes
    # corner pinnacles
    px(im, tx, TY - 2, WHITE); px(im, tx, TY - 1, LIGHT); px(im, tx + TW - 1, TY - 2, LIGHT); px(im, tx + TW - 1, TY - 1, MID)
    px(im, tx + TW // 2 - 1, TY - SH - 1, YELLOW)
# steps
line(im, [(18, 40), (29, 40)], WHITE); line(im, [(17, 41), (30, 41)], LIGHT)
# churchyard trees & gravestones
for (tx, ty) in [(1, 14), (4, 19), (1, 24), (2, 30), (42, 16), (43, 22), (41, 1), (2, 1)]:
    tree(im, tx, ty, big=True)
for (gx, gy) in [(4, 34), (7, 33), (5, 37), (40, 34), (43, 36), (39, 37)]:
    px(im, gx, gy, LIGHT); px(im, gx + 1, gy + 1, FOREST)
for (x, y) in [(10, 43), (16, 45), (31, 44), (36, 46), (25, 46)]: px(im, x, y, BLACK)
border(im, 'civic')

save(im, 'cathedral', 'Cathedral',
     'Large landmark: reduces crime and raises residential desirability within 12 tiles; draws tourists (+commercial demand).',
     'civic', 'civic')
