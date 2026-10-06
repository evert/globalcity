"""Offshore wind farm block: one big 3-blade turbine on a yellow transition piece, standing in open sea.

The block is 100% water so many blocks can be laid side by side; the sea texture is periodic in 16 px
(the same ripple layout as the game's plain water tile), so block edges are seamless and the farm blends
into the surrounding ocean. The turbine is the same model as the land wind farm's (utilities/wind_farm.py),
drawn a little taller, with the tower rising up-right at 45 degrees as in the originals' projection.
"""
from _style import *
from _style import _apply_shadow

N = 64
# BLUE ripple dots of the game's plain water tile (row -> columns), repeated every 16 px
RIPPLE = {1: (3, 10), 3: (13,), 5: (7,), 6: (3,), 7: (11, 15), 9: (0, 4), 11: (10, 14), 12: (4, 5),
          14: (3, 11), 15: (15,)}
im = Image.new('RGB', (N, N), WATER)
for y in range(N):
    for x in range(N):
        if x % 16 in RIPPLE.get(y % 16, ()): px(im, x, y, BLUE)

BX, BY = 21, 45           # monopile at the waterline
TP = 6                    # height of the yellow transition piece
H, L = 16, 11             # tower height (px along the 45-degree axis) and blade length
ANG = -78                 # rotor angle of the first blade (deg)
TX, TY = BX + TP, BY - TP # top of the transition piece = foot of the tower
HX, HY = TX + H, TY - H   # hub


# --- shadow on the water (down-right), like the land turbines' shadows on grass
SX, SY = BX + 14, BY + 9
m = Image.new('L', im.size, 0); dm = ImageDraw.Draw(m)
dm.line([(BX + 2, BY + 2), (SX, SY)], fill=255)
dm.line([(BX + 3, BY + 2), (SX + 1, SY)], fill=255)
for k in range(3):
    a = math.radians(ANG + 120 * k)
    dm.line([(SX, SY), (SX + round(math.cos(a) * (L - 2)), SY + round(math.sin(a) * (L - 4)))], fill=255)
_apply_shadow(im, m)

# --- foam ring where the swell breaks on the monopile (brightest on the up-wave west side)
ellipse(im, BX - 5, BY - 2, BX + 4, BY + 3, None, LIGHT)
for (dx, dy) in [(-5, 0), (-5, 1), (-4, 2), (-3, 3), (-1, 3), (1, 3), (-4, -1), (-2, -2)]:
    px(im, BX + dx, BY + dy, WHITE)
for (dx, dy, c) in [(-7, 1, LIGHT), (-6, 3, WHITE), (-2, 5, LIGHT), (3, 5, WHITE), (6, 3, LIGHT)]:
    px(im, BX + dx, BY + dy, c)
line(im, [(BX - 1, BY + 2), (BX + 3, BY + 2)], BLUE)       # wet shadow at the waterline, east of the pile

# --- yellow transition piece: a short fat cylinder rising up-right out of the sea
for t in range(TP + 1):
    cx, cy = BX + t, BY - t
    line(im, [(cx - 2, cy), (cx + 1, cy)], YELLOW)
    px(im, cx - 2, cy, WHITE if 0 < t < TP else YELLOW)     # sunlit west edge
    px(im, cx + 2, cy, ORANGE)                               # shaded east side
    px(im, cx + 2, cy + 1, ORANGE)
line(im, [(BX - 2, BY + 1), (BX + 1, BY + 1)], ORANGE)
line(im, [(BX - 1, BY + 2), (BX + 2, BY + 2)], DARK)       # dark waterline band / marine growth
px(im, BX + 3, BY, RED); px(im, BX + 3, BY + 1, RED)       # red boat-landing fenders on the east side
# grey access platform with railing, overhanging the transition piece
rect(im, TX - 3, TY - 1, TX + 3, TY + 1, MID)
line(im, [(TX - 2, TY - 2), (TX + 2, TY - 2)], LIGHT)
line(im, [(TX - 3, TY - 1), (TX + 1, TY - 1)], WHITE)
line(im, [(TX - 2, TY + 2), (TX + 3, TY + 2)], BLACK)
px(im, TX + 3, TY + 1, BLACK); px(im, TX - 3, TY + 1, DARK)

# --- white tower: 3 px band at the foot tapering to 2 px, lit on the west
for t in range(H + 1):
    x, y = TX + t, TY - t
    px(im, x, y, LIGHT)
    px(im, x - 1, y, WHITE)
    if t < H * 2 // 3: px(im, x + 1, y, MID if t < H // 3 else LIGHT)
    if t < H // 3: px(im, x - 1, y - 1, WHITE)
# nacelle: a little box pointing into the wind (to the west), lit roof
rect(im, HX - 4, HY - 1, HX + 1, HY + 1, MID)
line(im, [(HX - 4, HY - 1), (HX, HY - 1)], WHITE)
line(im, [(HX - 4, HY + 1), (HX + 1, HY + 1)], DARK)
px(im, HX + 2, HY, BLACK); px(im, HX + 2, HY + 1, BLACK)
# three long white blades with a thicker root
for k in range(3):
    a = math.radians(ANG + 120 * k)
    ex, ey = HX + round(math.cos(a) * L), HY + round(math.sin(a) * L)
    line(im, [(HX, HY), (ex, ey)], WHITE)
    ox, oy = (0, 1) if abs(math.cos(a)) > abs(math.sin(a)) else (1, 0)
    for r in (2, 3, 4):
        mx, my = HX + round(math.cos(a) * r), HY + round(math.sin(a) * r)
        px(im, mx + ox, my + oy, LIGHT)
rect(im, HX - 1, HY - 1, HX, HY, WHITE); px(im, HX, HY, LIGHT); px(im, HX - 1, HY, DARK)   # spinner
px(im, HX - 4, HY - 1, RED)                                  # aviation light

# --- subsea cable marker buoy, on the line joining neighbouring turbines (reads as a cable route)
for (x, y) in [(53, 45)]:
    px(im, x + 1, y + 1, BLUE); px(im, x + 2, y + 1, BLUE)
    rect(im, x, y - 1, x + 1, y, YELLOW); px(im, x + 1, y, ORANGE); px(im, x + 1, y - 1, ORANGE)
    px(im, x, y - 2, BLACK); px(im, x + 1, y - 3, BLACK)
    px(im, x - 1, y + 1, WHITE); px(im, x, y + 1, LIGHT); px(im, x - 2, y + 1, LIGHT)

if __name__ == '__main__':
    save(im, 'offshore_wind', 'Offshore wind farm', '400 units of clean power; must be placed entirely on water',
         'utilities', 'power')
