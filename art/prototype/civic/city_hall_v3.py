"""City Hall, third pass (drawn from scratch) in the originals' 45-degree oblique view.

One solid capitol block rather than a cluster: a long two-storey hall, a columned portico with a pediment
projecting from its south front, and a rotunda (a drum leaning with the view, under a dome and lantern) in
the middle of the roof. Blocks are drawn back to front so nothing cuts through anything. A paved plaza with
a fountain and flags lies south of the steps; trees frame the lot, more trees fill the north-east corner.
"""
from _civ import *

im = ground(4, 'grass', 'city_hall_v3')
SK = 1

# ---- grounds: plaza, avenue, car park, trees (drawn first; buildings and shadows go on top)
pave(im, 8, 44, 55, 58, LIGHT, WHITE)
for x in range(10, 55, 4):
    for y in range(46, 58, 4): px(im, x, y, MID)
rect(im, 27, 58, 34, 63, MID); line(im, [(30, 59), (30, 63)], WHITE); line(im, [(31, 59), (31, 63)], WHITE)
for (tx, ty) in [(2, 3), (8, 1), (15, 3), (52, 2), (57, 5), (53, 9), (58, 11), (47, 1), (2, 12), (3, 22), (2, 31), (57, 18), (58, 26), (57, 34), (2, 41), (58, 42), (3, 52), (57, 52), (10, 59), (17, 60), (42, 59), (49, 60)]:
    tree(im, tx, ty, big=True)

# ---- the main hall: roof x 22..51, y 10..27; walls slant down-left 9 px
MX, MY, MW, MD, MH = 22, 10, 30, 18, 9
block(im, MX, MY, MW, MD, MH, roof=LIGHT, west=LIGHT, south=MID, skew=SK, sh=(4, 3))
# roof: a parapet line and a darker inner roof, so the rotunda has something to stand on
line(im, [(MX + 2, MY + 2), (MX + MW - 3, MY + 2)], MID)      # parapet: a thin inner edge
line(im, [(MX + 2, MY + 2), (MX + 2, MY + MD - 3)], MID)
for x in range(MX + 4, MX + MW - 3, 4): px(im, x, MY + MD - 3, MID)   # roof vents
# two storeys of windows on the south front and the west end
for v in (2, 5):
    for u in range(2, MW - 2, 2):
        px(im, *south_px(MX, MY, MW, MD, MH, SK, u, v), BLACK)
for v in (2, 5):
    for u in range(2, MD - 1, 2):
        px(im, *west_px(MX, MY, MW, MD, MH, SK, u, v + 1), MID)
for u in range(0, MW):                                        # cornice under the parapet
    px(im, *south_px(MX, MY, MW, MD, MH, SK, u, 0), WHITE)

# ---- rotunda on the roof: a drum leaning down-left (stacked discs, lit west), dome, lantern
CX, CY, R, DH = 40, 15, 6, 5
shade_rect(im, CX + 2, CY + 2, CX + R + 3, CY + DH + R)            # rotunda shadow on the roof, east
for k in range(DH, 0, -1):                                    # drum: full discs stacked down-left
    cx, cy = CX - k, CY + k
    for y in range(cy - R, cy + R + 1):
        for x in range(cx - R, cx + R + 1):
            if (x - cx) ** 2 + (y - cy) ** 2 > R * R + 2: continue
            t = (x - cx) / R
            c = WHITE if t < -0.5 else LIGHT if t < 0.15 else MID if t < 0.6 else DARK
            if k in (2, 4) and (x - cx) % 2 == 0 and y > cy: c = DARK if t < 0.6 else BLACK   # columns
            px(im, x, y, c)
line(im, [(CX - DH - R, CY + DH), (CX - DH + R, CY + DH)], BLACK) if False else None
dome(im, CX, CY, R, shadow=False)
rect(im, CX - 1, CY - 2, CX, CY - 1, WHITE); px(im, CX + 1, CY - 1, MID)   # lantern on the dome's crown
px(im, CX - 1, CY - 3, YELLOW)

# ---- portico in front of the south facade (drawn after the hall: it stands in front of it)
PX, PY, PW, PD, PH = 30, MY + MD - 1, 15, 5, 9
block(im, PX, PY, PW, PD, PH, roof=WHITE, west=LIGHT, south=DARK, skew=SK, sh=(3, 2))
for u in range(1, PW - 1, 2):                                  # columns
    for v in range(0, PH - 1):
        px(im, *south_px(PX, PY, PW, PD, PH, SK, u, v), WHITE)
for u in range(0, PW):
    px(im, *south_px(PX, PY, PW, PD, PH, SK, u, 0), LIGHT)     # entablature
# pediment on the portico roof
poly(im, [(PX + 1, PY + PD - 1), (PX + PW // 2, PY - 2), (PX + PW - 2, PY + PD - 1)], WHITE)
line(im, [(PX + PW // 2, PY - 2), (PX + PW - 2, PY + PD - 1)], MID)
line(im, [(PX + 1, PY + PD - 1), (PX + PW - 2, PY + PD - 1)], MID)
px(im, PX + PW // 2, PY + 2, YELLOW)
# steps from the portico down to the plaza, following the slant
bx, by = south_px(PX, PY, PW, PD, PH, SK, 0, PH - 1)
for i in range(3):
    line(im, [(bx - 1 - i, by + 1 + i), (bx + PW - i, by + 1 + i)], WHITE if i % 2 == 0 else LIGHT)

# ---- flag on the dome lantern? no: two flagpoles leaning with the view at the steps, more in the plaza
for (fx, fy, c) in [(20, 52, RED), (24, 52, BLUE), (38, 52, BLUE), (42, 52, RED)]:
    for k in range(6): px(im, fx + k, fy - k, WHITE)
    rect(im, fx + 6, fy - 6, fx + 7, fy - 5, c)
# fountain in the plaza
ellipse(im, 25, 47, 37, 55, WHITE, MID); ellipse(im, 26, 48, 36, 54, WATER)
px(im, 31, 50, WHITE); px(im, 30, 51, WHITE); px(im, 32, 51, WHITE); px(im, 31, 51, BLUE)
for (x, y) in [(13, 49), (17, 55), (45, 48), (49, 54), (22, 57), (40, 56), (35, 45), (11, 53)]: px(im, x, y, BLACK)
border(im, 'civic')
rect(im, 27, 63, 34, 63, MID)
save(im, 'city_hall_v3', 'City Hall (oblique, redrawn)',
     'Seat of government: +10% tax collection and lowers crime/unrest citywide, boosts nearby commercial land value.',
     'civic', 'civic')
