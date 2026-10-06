"""University campus, 5x4 tiles (80 x 64 px).

A collegiate main hall with a central clock tower (the focal point, and the campus gate) closes the north
side of a green quad; two long wings frame the quad east and west; crossing paths meet at the founder's
statue. East of the campus: a sports field with a running track and a staff car park.
Drawn in the civic group's front-elevation projection (walls straight down, skew 0, like City Hall and
the Library), light from the top-left, shadows darken the ground to the south-east.
"""
import os, json
from _civ import *

W_, H_ = 80, 64
SEED = 'university_5x4'


def ground_rect(w, h, seed):
    im = Image.new('RGB', (w, h), GRASS)
    for y in range(h):
        for x in range(w):
            r = rnd(x, y, seed) % 1000
            if r < 45: im.putpixel((x, y), FOREST)
            elif r < 52: im.putpixel((x, y), DIRT)
    return im


def save_wide(im, slug, name, idea, zone):
    bad = {im.getpixel((x, y)) for y in range(im.height) for x in range(im.width)} - set(PALETTE)
    assert not bad, f'{slug}: off-palette colours {list(bad)[:5]}'
    assert im.size == (W_, H_), im.size
    out = os.path.dirname(os.path.abspath(__file__))
    im.save(os.path.join(out, f'{slug}.png'))
    im.resize((im.width * 4, im.height * 4), Image.NEAREST).save(os.path.join(out, f'{slug}@4x.png'))
    mp = os.path.join(out, 'meta.json')
    meta = json.load(open(mp)) if os.path.exists(mp) else {}
    meta[slug] = {'name': name, 'tiles': f'{im.width // 16}x{im.height // 16}', 'zone': zone, 'idea': idea}
    json.dump(meta, open(mp, 'w'), indent=2)


im = ground_rect(W_, H_, SEED)
SK = 0

# ---------------------------------------------------------------- quad
QX0, QY0, QX1, QY1 = 15, 25, 45, 54
pave(im, QX0 - 1, QY0 - 1, QX1 + 1, QY1 + 1, LIGHT, None)          # perimeter walk
rect(im, QX0 + 1, QY0 + 1, QX1 - 1, QY1 - 1, GRASS)
for y in range(QY0 + 1, QY1):
    for x in range(QX0 + 1, QX1):
        if (x + y) % 2 == 0 and rnd(x, y, 'q') % 5 == 0: px(im, x, y, FOREST)
CX, CY = 30, 40
line(im, [(QX0, QY0), (QX1, QY1)], LIGHT); line(im, [(QX1, QY0), (QX0, QY1)], LIGHT)
rect(im, CX - 1, QY0, CX, 63, LIGHT)                               # central axis to the south gate
rect(im, QX0, CY, QX1, CY, LIGHT)
# round plaza with a fountain basin; the founder's statue stands in the middle of the water
ellipse(im, CX - 6, CY - 5, CX + 5, CY + 5, LIGHT, WHITE)
shade_poly(im, [(CX + 4, CY - 2), (CX + 6, CY), (CX + 6, CY + 4), (CX + 3, CY + 6), (CX - 1, CY + 6)])
ellipse(im, CX - 4, CY - 3, CX + 3, CY + 3, WATER, WHITE)
line(im, [(CX - 2, CY + 3), (CX + 2, CY + 3)], MID); px(im, CX + 3, CY + 1, MID); px(im, CX + 3, CY, MID)
px(im, CX - 3, CY + 1, BLUE); px(im, CX + 2, CY - 1, BLUE); px(im, CX + 1, CY + 2, BLUE)
rect(im, CX - 1, CY, CX, CY + 1, LIGHT); px(im, CX + 1, CY + 1, BLUE)          # plinth + its shadow
px(im, CX - 1, CY - 2, DARK); px(im, CX - 1, CY - 1, DARK); px(im, CX, CY - 1, BLACK)   # bronze figure
px(im, CX - 3, CY - 1, WHITE); px(im, CX + 1, CY - 2, WHITE)                   # spray glints

# ---------------------------------------------------------------- sports field + track (east)
FX0, FY0, FX1, FY1 = 60, 3, 77, 36
ellipse(im, FX0, FY0, FX1, FY1, DIRT)                               # red running track
for y in range(FY0, FY1 + 1):
    for x in range(FX0, FX1 + 1):
        if im.getpixel((x, y)) == DIRT and (x + 2 * y) % 7 == 0: px(im, x, y, ORANGE)
ellipse(im, FX0 + 3, FY0 + 3, FX1 - 3, FY1 - 3, GRASS, WHITE)
for y in range(FY0 + 5, FY1 - 4):
    if (y // 3) % 2:
        for x in range(FX0 + 4, FX1 - 3):
            if im.getpixel((x, y)) == GRASS: px(im, x, y, FOREST)
ImageDraw.Draw(im).rectangle([FX0 + 5, FY0 + 7, FX1 - 5, FY1 - 7], outline=WHITE)
line(im, [(FX0 + 5, (FY0 + FY1) // 2), (FX1 - 5, (FY0 + FY1) // 2)], WHITE)
rect(im, (FX0 + FX1) // 2 - 1, FY0 + 6, (FX0 + FX1) // 2 + 1, FY0 + 6, WHITE)
rect(im, (FX0 + FX1) // 2 - 1, FY1 - 6, (FX0 + FX1) // 2 + 1, FY1 - 6, WHITE)
for (x, y, c) in [(66, 14, RED), (71, 17, RED), (67, 24, BLUE), (72, 27, BLUE), (69, 20, WHITE)]: px(im, x, y, c)
# field house / bleachers between the track and the car park
block(im, 62, 36, 13, 3, 2, roof=LIGHT, west=WHITE, south=DARK, skew=SK, sh=(2, 1))
for x in range(64, 74, 2): px(im, x, 39, WHITE)
px(im, 63, 37, RED); px(im, 73, 37, RED)

# ---------------------------------------------------------------- staff car park (south-east)
pave(im, 57, 42, 77, 59, MID, LIGHT)
for x in range(59, 77, 3): line(im, [(x, 43), (x, 47)], WHITE); line(im, [(x, 54), (x, 58)], WHITE)
for (cx, cy, c) in [(60, 44, RED), (63, 45, WHITE), (69, 44, YELLOW), (75, 45, BLUE), (60, 55, BLUE), (66, 56, ORANGE), (72, 55, WHITE)]:
    car(im, cx, cy, c, vertical=True)
rect(im, 57, 60, 61, 63, MID)                                       # driveway out through the border

# ---------------------------------------------------------------- buildings
ROOF, RIDGE_LIT, RIDGE_SH = DIRT, ORANGE, SAND


def hall(X, Y, W, D, H, ridge='ew', win_rows=(1, 3)):
    """Stone hall with a terracotta gable roof (lit north/west slope, shaded south/east slope)."""
    block(im, X, Y, W, D, H, roof=ROOF, west=LIGHT, south=MID, skew=SK, sh=(3, 2))
    if ridge == 'ew':
        m = Y + (D * 3 + 3) // 5
        rect(im, X + 1, m, X + W - 2, Y + D - 1, SAND)
        line(im, [(X + 1, m - 1), (X + W - 2, m - 1)], ORANGE)
    else:
        m = X + W // 2
        rect(im, m, Y + 1, X + W - 2, Y + D - 1, SAND)
        line(im, [(m - 1, Y + 1), (m - 1, Y + D - 1)], ORANGE)
    line(im, [(X, Y), (X + W - 1, Y)], WHITE); line(im, [(X, Y), (X, Y + D - 1)], WHITE)
    line(im, [(X + W - 1, Y + 1), (X + W - 1, Y + D - 1)], DARK)
    line(im, [(X, Y + D - 1), (X + W - 1, Y + D - 1)], DARK)  # eaves shadow
    for u in range(2, W - 2, 3):                             # tall windows
        for v in win_rows:
            px(im, X + u, Y + D + v, BLACK); px(im, X + u, Y + D + v + 1, BLACK)
    line(im, [(X, Y + D), (X + W - 1, Y + D)], LIGHT)        # string course under the eaves


# west + east wings first (the main hall overlaps their north ends)
hall(3, 21, 10, 27, 4, ridge='ns', win_rows=(1,))
hall(47, 21, 10, 27, 4, ridge='ns', win_rows=(1,))
# dormers on the wings' lit (west) roof slopes
for wy in range(25, 46, 5):
    for dx in (5, 49):
        px(im, dx, wy, WHITE); px(im, dx + 1, wy, LIGHT); px(im, dx, wy + 1, BLACK); px(im, dx + 1, wy + 1, MID)
        px(im, dx + 2, wy + 1, SAND)
# main hall
MX, MY, MW, MD, MH = 3, 6, 54, 10, 7
hall(MX, MY, MW, MD, MH, ridge='ew', win_rows=(1, 4))
# chimneys on the main roof
for cx_ in (9, 19, 40, 50):
    rect(im, cx_, MY + 2, cx_ + 1, MY + 3, MID); px(im, cx_, MY + 2, WHITE); px(im, cx_ + 2, MY + 3, SAND)
# clock tower: square shaft rising straight up from the main hall's facade, then an open belfry
# stage, corner pinnacles and a lead spire
TX, TW = 26, 9
TB = MY + MD + MH - 1         # ground line of the facade
TC = 11                       # cornice line between shaft and belfry
shade_rect(im, TX + TW, 2, TX + TW + 2, TB)
rect(im, TX, TC, TX + TW - 1, TB, LIGHT)                            # shaft
line(im, [(TX, TC), (TX, TB)], WHITE)
line(im, [(TX + TW - 1, TC), (TX + TW - 1, TB)], MID)
line(im, [(TX, TB), (TX + TW - 1, TB)], BLACK)
ellipse(im, TX + 1, TC + 1, TX + 7, TC + 7, WHITE, BLACK)          # big clock face
px(im, TX + 4, TC + 2, DARK); px(im, TX + 4, TC + 6, DARK); px(im, TX + 2, TC + 4, DARK); px(im, TX + 6, TC + 4, DARK)
px(im, TX + 4, TC + 3, BLACK); px(im, TX + 4, TC + 4, BLACK); px(im, TX + 5, TC + 4, BLACK)
rect(im, TX + 3, TB - 2, TX + 5, TB - 1, BLACK); px(im, TX + 4, TB - 3, BLACK)   # arched gateway
px(im, TX + 4, TB - 1, YELLOW)
rect(im, TX + 1, 6, TX + TW - 2, TC - 1, LIGHT)                    # belfry stage (set back)
line(im, [(TX + 1, 6), (TX + 1, TC - 1)], WHITE); line(im, [(TX + TW - 2, 6), (TX + TW - 2, TC - 1)], MID)
for ox in (TX + 3, TX + 5):
    rect(im, ox, 7, ox, TC - 1, BLACK)
px(im, TX + 4, 9, YELLOW)                                          # the bell
line(im, [(TX - 1, TC), (TX + TW, TC)], WHITE)                     # cornice
line(im, [(TX, TC + 1), (TX + TW - 1, TC + 1)], LIGHT)
for pxx in (TX - 1, TX + TW - 1):                                  # corner pinnacles
    rect(im, pxx, TC - 2, pxx + 1, TC - 1, LIGHT); px(im, pxx, TC - 3, WHITE); px(im, pxx + 1, TC - 2, MID)
poly(im, [(TX + 1, 5), (TX + TW // 2, 0), (TX + TW - 2, 5)], MID)  # spire
poly(im, [(TX + 1, 5), (TX + TW // 2, 0), (TX + TW // 2, 5)], LIGHT)
line(im, [(TX + 1, 5), (TX + TW // 2, 0)], WHITE)
line(im, [(TX + 1, 5), (TX + TW - 2, 5)], DARK)
px(im, TX + TW // 2, 0, YELLOW)
# steps down to the quad
for i in range(2):
    line(im, [(TX - 1 - i, TB + 1 + i), (TX + TW + i, TB + 1 + i)], WHITE if i == 0 else LIGHT)
# banners on the main facade
for bx_ in (TX - 4, TX + TW + 3):
    rect(im, bx_, MY + MD + 1, bx_ + 1, MY + MD + 3, BLUE); px(im, bx_, MY + MD + 1, WHITE)

# south gate posts + low hedge along the south edge
for gx in (CX - 4, CX + 3):
    rect(im, gx, 57, gx + 1, 59, LIGHT); px(im, gx, 57, WHITE); px(im, gx + 2, 59, BLACK)
for x in list(range(2, CX - 4)) + list(range(CX + 6, 55)):
    if x % 6 != 5: px(im, x, 60, FOREST)

# trees: quad corners, along the paths, edges
for (tx, ty) in [(17, 27), (42, 27), (17, 50), (42, 50), (22, 33), (37, 33), (22, 45), (37, 45),
                 (2, 52), (7, 55), (12, 51), (46, 53), (51, 56), (1, 1), (57, 2), (57, 37), (54, 50)]:
    tree(im, tx, ty, big=True)
# students
for (x, y) in [(25, 36), (35, 43), (30, 50), (29, 30), (19, 40), (41, 40), (33, 37), (26, 47), (31, 58),
               (16, 30), (44, 46), (23, 40), (38, 28), (31, 25)]:
    person(im, x, y, BLACK if (x + y) % 3 else BLUE)

border(im, 'civic')
rect(im, CX - 1, 63, CX, 63, LIGHT); rect(im, 57, 63, 61, 63, MID)

save_wide(im, 'university_5x4', 'University',
          'Raises education level of residents within 15 tiles and attracts high-tech industry; needs a minimum city population of 20k.',
          'civic')
