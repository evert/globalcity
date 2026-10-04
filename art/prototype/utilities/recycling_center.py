"""Recycling centre: sorting warehouse with a recycle mark on the roof, conveyor, colour-sorted skips, bales and trucks."""
from _style import *

im = ground(3, 'dirt', 'recycling_center')
# paved yard along the south
rect(im, 1, 37, 46, 46, MID)
for x in range(3, 46, 6): px(im, x, 41, LIGHT); px(im, x + 1, 41, LIGHT)
line(im, [(1, 37), (46, 37)], LIGHT)

# warehouse
gx, gy = prism(im, 19, 4, 26, 14, 6, roof=MID, south=DARK, shadow=3)
for y in range(6, 17, 3): line(im, [(20, y), (43, y)], LIGHT)          # roof panel seams
for x in (22, 40): rect(im, x, 6, x + 1, 7, DARK); px(im, x, 6, WHITE)  # roof vents
# recycle mark: three-arrow triangle in green
cx, cy = 31, 11
tri = [(cx, cy - 4), (cx + 5, cy + 4), (cx - 5, cy + 4)]
rect(im, cx - 6, cy - 5, cx + 6, cy + 5, LIGHT)
line(im, [(cx - 6, cy - 5), (cx + 6, cy - 5)], WHITE)
line(im, [(a + 1, b + 1) for a, b in tri + [tri[0]]], FOREST)
line(im, tri + [tri[0]], GRASS)
for (ax, ay) in [(cx + 2, cy - 1), (cx + 1, cy + 4), (cx - 3, cy)]:   # breaks between the three arrows
    px(im, ax, ay, LIGHT)
for (ax, ay) in [(cx + 3, cy - 1), (cx, cy + 3), (cx - 4, cy + 1)]:   # arrow heads
    px(im, ax, ay, GRASS)
# roller doors on the south face
for x in (17, 24, 31):
    for y in range(20, 24):
        line(im, [(x - (y - 18), y), (x + 3 - (y - 18), y)], LIGHT if y % 2 else MID)
# conveyor from the sorting hopper up into the west wall
line(im, [(4, 30), (15, 19)], BLACK, 3)
line(im, [(4, 29), (15, 18)], LIGHT)
for t in range(0, 11, 2): px(im, 5 + t, 29 - t, WHITE)
for t in (2, 7): line(im, [(4 + t, 30 - t), (4 + t, 33 - t)], DARK)     # legs
prism(im, 4, 28, 5, 4, 2, roof=DARK, shadow=2)                         # hopper
px(im, 5, 29, YELLOW); px(im, 6, 29, BLUE); px(im, 7, 30, RED)
# colour-sorted skips in a row
for i, c in enumerate((BLUE, FOREST, YELLOW, RED, LIGHT)):
    x = 12 + i * 6
    prism(im, x, 28, 5, 4, 2, roof=c, south=DARK, west=MID, shadow=1, lit=False)
    line(im, [(x, 28), (x + 4, 28)], MID)                               # skip rim
    if c == LIGHT:
        for (a, b) in [(x + 1, 29), (x + 3, 30)]: px(im, a, b, DARK)
    else:
        px(im, x + 1, 29, WHITE if c != YELLOW else ORANGE)
# stacked bales on the east side (paper = blue, cardboard = sand, metal = light)
for (x, y, c) in [(37, 27, SAND), (41, 27, BLUE), (37, 31, LIGHT), (41, 31, SAND)]:
    prism(im, x, y, 4, 3, 1, roof=c, west=MID, south=DARK, shadow=1, lit=False)
    line(im, [(x, y + 1), (x + 3, y + 1)], DARK if c != BLUE else WATER)    # strapping
# trucks in the yard
truck(im, 6, 39, FOREST, LIGHT)
truck(im, 22, 43, BLUE, YELLOW)
truck(im, 33, 39, WHITE, BLUE)
car(im, 42, 44, RED)
prism(im, 6, 4, 9, 5, 3, roof=LIGHT, south=DARK, win=YELLOW, wstep=2, shadow=2)   # site office
px(im, 14, 4, RED)
car(im, 3, 16, BLUE); car(im, 8, 16, WHITE)
for (x, y, b) in [(17, 3, False), (2, 22, True)]: tree(im, x, y, b)
border(im, 'ind')
save(im, 'recycling_center', 'Recycling Center',
     'Diverts 40% of garbage from landfills and earns a little income from sold materials; needs road access and creates light traffic.',
     'utilities', 'ind')
