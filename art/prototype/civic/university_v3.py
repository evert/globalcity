"""University campus 5x4 (80 x 64 px), third pass, drawn from scratch in the originals' oblique view.

A long main hall with a terracotta roof closes the north side; a clock tower rises from the middle of its
front. Two side halls frame a green quad with crossing paths and a fountain; a gate opens the quad to the
south. A garden with a pond and trees fills the east side. Draw order follows the oblique rules: the main hall
first, the tower in front of it, then the side halls (south of it), east before west.
"""
import os, json
from _civ import *

W_, H_ = 80, 64
SEED = 'university_v3'


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
    out = os.path.dirname(os.path.abspath(__file__))
    im.save(os.path.join(out, f'{slug}.png'))
    im.resize((im.width * 4, im.height * 4), Image.NEAREST).save(os.path.join(out, f'{slug}@4x.png'))
    mp = os.path.join(out, 'meta.json')
    meta = json.load(open(mp)) if os.path.exists(mp) else {}
    meta[slug] = {'name': name, 'tiles': f'{im.width // 16}x{im.height // 16}', 'zone': zone, 'idea': idea}
    json.dump(meta, open(mp, 'w'), indent=2)


im = ground_rect(W_, H_, SEED)
SK = 1
TERRA, TERRA_LIT, TERRA_SH = DIRT, ORANGE, SAND

# ---------------------------------------------------------------- grounds
QX0, QY0, QX1, QY1 = 24, 27, 54, 55                          # the quad
pave(im, QX0 - 1, QY0 - 1, QX1 + 1, QY1 + 1, LIGHT, None)
rect(im, QX0 + 1, QY0 + 1, QX1 - 1, QY1 - 1, GRASS)
for y in range(QY0 + 1, QY1):
    for x in range(QX0 + 1, QX1):
        if (x + y) % 2 == 0 and rnd(x, y, 'q3') % 5 == 0: px(im, x, y, FOREST)
CX, CY = 39, 41
line(im, [(QX0, QY0), (QX1, QY1)], LIGHT); line(im, [(QX1, QY0), (QX0, QY1)], LIGHT)
rect(im, CX - 1, QY0, CX, 63, LIGHT); rect(im, QX0, CY, QX1, CY, LIGHT)
ellipse(im, CX - 6, CY - 5, CX + 5, CY + 5, LIGHT, WHITE)     # fountain plaza
ellipse(im, CX - 4, CY - 3, CX + 3, CY + 3, WATER, WHITE)
px(im, CX - 1, CY - 1, WHITE); px(im, CX, CY - 2, WHITE); px(im, CX - 1, CY, BLUE); px(im, CX + 1, CY + 1, BLUE)
# south gate and hedge
for gx in (CX - 4, CX + 3):
    rect(im, gx, 57, gx + 1, 59, LIGHT); px(im, gx, 57, WHITE); px(im, gx + 2, 59, BLACK)
for x in list(range(3, CX - 4)) + list(range(CX + 6, 66)):
    if x % 6 != 5: px(im, x, 60, FOREST)
# a garden with a pond on the east side, crossed by a footpath
ellipse(im, 66, 36, 75, 46, WATER, BLUE)
for (x, y) in [(68, 39), (72, 42), (70, 37)]: px(im, x, y, WHITE)
line(im, [(70, 24), (70, 34), (68, 48), (70, 62)], LIGHT)
# trees around the edges (before the buildings, so buildings and their shadows sit on top)
for (tx, ty) in [(1, 2), (6, 1), (66, 2), (72, 1), (76, 6), (70, 13), (75, 20), (69, 24), (2, 26), (2, 36), (2, 46), (3, 55), (74, 27), (76, 32), (73, 50), (76, 55), (72, 58),
                 (26, 29), (51, 29), (26, 52), (51, 52), (31, 35), (46, 35), (31, 47), (46, 47)]:
    tree(im, tx, ty, big=True)


def hall(X, Y, W, D, H, ridge='ew'):
    """Stone hall under a terracotta roof: lit north (or west) slope, shaded south (or east) slope."""
    block(im, X, Y, W, D, H, roof=TERRA, west=LIGHT, south=MID, skew=SK, sh=(3, 2))
    if ridge == 'ew':
        m = Y + D // 2
        rect(im, X + 1, m, X + W - 2, Y + D - 2, TERRA_SH)
        line(im, [(X + 1, m - 1), (X + W - 2, m - 1)], TERRA_LIT)
        for x in range(X + 3, X + W - 3, 6): px(im, x, Y + 2, WHITE); px(im, x, Y + 3, MID)   # dormers
    else:
        m = X + W // 2
        rect(im, m, Y + 1, X + W - 2, Y + D - 2, TERRA_SH)
        line(im, [(m - 1, Y + 1), (m - 1, Y + D - 2)], TERRA_LIT)
        for y in range(Y + 3, Y + D - 3, 5): px(im, X + 2, y, WHITE); px(im, X + 3, y, MID)
    line(im, [(X, Y + D - 1), (X + W - 1, Y + D - 1)], DARK)                 # eaves
    for u in range(0, W):                                                    # string course
        px(im, *south_px(X, Y, W, D, H, SK, u, 0), LIGHT)
    for v in range(2, H - 1, 2):                                             # windows, south face
        for u in range(2, W - 2, 2):
            px(im, *south_px(X, Y, W, D, H, SK, u, v), BLACK)
    for v in range(2, H, 2):                                                 # windows, west face
        for u in range(2, D - 1, 3):
            px(im, *west_px(X, Y, W, D, H, SK, u, v), MID)


# ---------------------------------------------------------------- buildings (back to front)
MX, MY, MW, MD, MH = 20, 6, 42, 11, 8
hall(MX, MY, MW, MD, MH, 'ew')
# clock tower in front of the hall's centre, rising above it
TX, TY, TW, TD, TH = 48, 8, 7, 6, 12   # foot on the ground line of the hall (y = MY + MD + MH - 1)
block(im, TX, TY, TW, TD, TH, roof=LIGHT, west=LIGHT, south=MID, skew=SK, sh=(3, 2))
for v in range(1, TH - 1): px(im, *south_px(TX, TY, TW, TD, TH, SK, TW - 1, v), DARK)
cx_, cy_ = south_px(TX, TY, TW, TD, TH, SK, TW // 2, 3)
ellipse(im, cx_ - 2, cy_ - 2, cx_ + 2, cy_ + 2, WHITE, BLACK)
px(im, cx_, cy_, BLACK); px(im, cx_, cy_ - 1, BLACK); px(im, cx_ + 1, cy_, BLACK)
gx, gy = south_px(TX, TY, TW, TD, TH, SK, TW // 2, TH - 2)                  # archway at the foot
rect(im, gx - 1, gy - 2, gx + 1, gy, BLACK); px(im, gx, gy, YELLOW)
poly(im, [(TX, TY + TD - 1), (TX + TW // 2, TY), (TX + TW - 1, TY + TD - 1)], LIGHT)   # pyramid roof
poly(im, [(TX + TW // 2, TY), (TX + TW - 1, TY + TD - 1), (TX + TW // 2, TY + TD - 1)], MID)
line(im, [(TX, TY + TD - 1), (TX + TW // 2, TY)], WHITE)
px(im, TX + TW // 2, TY - 1, YELLOW)
# side halls framing the quad (south of the main hall: drawn after it, east before west)
hall(60, 20, 9, 30, 5, 'ns')
hall(14, 20, 9, 30, 5, 'ns')
# banners by the archway and students on the paths
for (bx, by) in [(28, 22), (44, 22)]: rect(im, bx, by, bx + 1, by + 2, BLUE); px(im, bx, by, WHITE)
for (x, y) in [(34, 38), (44, 44), (39, 50), (39, 30), (28, 41), (50, 41), (42, 37), (35, 47), (40, 58), (25, 32), (53, 48)]:
    person(im, x, y, BLACK if (x + y) % 3 else BLUE)
border(im, 'civic')
rect(im, CX - 1, 63, CX, 63, LIGHT)
save_wide(im, 'university_v3', 'University',
          'Raises education level of residents within 15 tiles and attracts high-tech industry.', 'civic')
