"""Data center: long windowless server halls with rooftop chillers, a cooling-fan yard, generators, fence."""
from _style import *

im = ground(3, 'grass', 'data_center')
rect(im, 3, 3, 44, 44, DIRT)                                      # gravel compound
for y in range(3, 45):
    for x in range(3, 45):
        if (x * 5 + y * 3) % 9 == 0: px(im, x, y, SAND)

def hall(x, y, w, d, h):
    gx, gy = prism(im, x, y, w, d, h, roof=LIGHT, west=LIGHT, south=DARK, shadow=3)
    line(im, [(x + 1, y + d - 1), (x + w - 2, y + d - 1)], MID)  # parapet
    for xx in range(x + 2, x + w - 3, 5):                        # rooftop chiller units
        rect(im, xx, y + 2, xx + 3, y + 4, MID)
        line(im, [(xx, y + 2), (xx + 3, y + 2)], WHITE)
        px(im, xx + 1, y + 3, BLACK); px(im, xx + 2, y + 3, DARK)
    # blue status strip along the windowless south wall + a few doors
    yy = gy + d - 3
    for xx in range(gx + 3, gx + w - 2, 2): px(im, xx + 1, yy, BLUE)
    px(im, gx + 4, gy + d - 2, MID); px(im, gx + w - 6, gy + d - 2, MID)
    return gx, gy

hall(12, 5, 31, 9, 5)
hall(12, 21, 21, 8, 4)
# evaporative cooling towers east of hall 2 (open tops with fan, like mini cooling towers)
for (cx, cy) in [(37, 24), (38, 33)]:
    ox, oy = cylinder(im, cx, cy, 3, 3, top=BLACK, rim=WHITE, shadow=3)
    line(im, [(ox - 1, oy), (ox + 1, oy)], DARK); line(im, [(ox, oy - 1), (ox, oy + 1)], DARK)
    px(im, ox, oy, MID)
line(im, [(33, 26), (35, 26)], MID, 2); line(im, [(33, 29), (36, 32)], MID)                              # chilled-water pipes into the hall
# backup generators + fuel tank along the south
for x in (14, 21):
    prism(im, x, 36, 5, 3, 2, roof=MID, south=DARK, shadow=2)
    px(im, x + 3, 35, BLACK); px(im, x + 3, 34, DARK)               # exhaust stacks
cylinder(im, 29, 40, 2, 2, top=LIGHT, rim=WHITE, shadow=2)                 # diesel tank
# substation feed
# car park + gatehouse
rect(im, 3, 34, 10, 44, MID)
for y in range(36, 44, 2): px(im, 4, y, LIGHT)
car(im, 6, 35, BLUE); car(im, 6, 39, WHITE); car(im, 6, 41, RED)
prism(im, 37, 42, 3, 2, 2, roof=WHITE, shadow=1); px(im, 37, 43, BLUE)
fence(im, 2, 2, 45, 45, BLACK, 2, gaps=[('s', 33, 36)])
for (x, y) in [(2, 2), (45, 2), (2, 45), (45, 45)]: px(im, x, y, BLUE)    # camera posts
border(im, 'com')
save(im, 'data_center', 'Data Center',
     'High-tech jobs and +tax income, attracts commercial growth; draws heavy power and water, very low pollution, needs fiber/education.',
     'utilities', 'com')
