"""Wind farm: four 3-blade turbines on farmland with gravel service tracks and a small substation."""
from _style import *

im = ground(4, 'grass', 'wind_farm')
# a hedgerow splitting the fields
for x in range(34, 63, 1):
    if x % 5: px(im, x, 30 - (x - 34) // 6, FOREST)
def turbine(bx, by, H, ang, L=7):
    """Tower from ground (bx, by) up H px; rotor star of 3 blades at angle ang (deg)."""
    sx, sy = bx + 9, by + 6                                  # shadow on the ground, to the bottom-right
    line(im, [(bx + 1, by + 1), (sx, sy)], FOREST)
    for k in range(3):
        a = math.radians(ang + 120 * k)
        line(im, [(sx, sy), (sx + round(math.cos(a) * (L - 2)), sy + round(math.sin(a) * (L - 3)))], FOREST)
    rect(im, bx - 1, by - 1, bx + 1, by + 1, LIGHT); px(im, bx - 1, by - 1, WHITE)   # concrete pad
    hx, hy = bx + H, by - H
    line(im, [(bx, by), (hx, hy)], LIGHT)                    # tower body
    line(im, [(bx, by - 1), (hx - 1, hy)], WHITE)            # sunlit left edge
    line(im, [(bx + 1, by), (bx + H // 2, by - H // 2 + 1)], MID)   # shaded right edge (lower half)
    rect(im, hx - 2, hy - 1, hx + 1, hy, MID); line(im, [(hx - 2, hy - 1), (hx, hy - 1)], WHITE)  # nacelle
    for k in range(3):
        a = math.radians(ang + 120 * k)
        ex, ey = hx + round(math.cos(a) * L), hy + round(math.sin(a) * L)
        line(im, [(hx, hy), (ex, ey)], WHITE)
        mx, my = hx + round(math.cos(a) * 3), hy + round(math.sin(a) * 3)
        px(im, mx + (1 if math.sin(a) < 0 else 0), my + 1, LIGHT)     # blade root thickness
    rect(im, hx, hy, hx + 1, hy + 1, DARK); px(im, hx, hy, BLACK)       # hub
    px(im, hx - 2, hy - 1, RED)                                          # aviation light

# gravel service tracks
for pts in [[(20, 53), (26, 48), (26, 22), (8, 27)], [(26, 34), (31, 22)], [(26, 48), (34, 52), (46, 42)]]:
    line(im, pts, SAND, 2)
# substation: fenced gravel pad with transformers, gantry and control hut
rect(im, 2, 44, 20, 61, DIRT)
for y in range(44, 62):
    for x in range(2, 21):
        if (x * 5 + y * 3) % 11 == 0: px(im, x, y, SAND)
fence(im, 2, 44, 20, 61, DARK, 2, gaps=[('e', 51, 56)])
for x in (6, 13):                                                 # two transformers with cooling fins
    prism(im, x, 48, 4, 4, 3, roof=MID, shadow=2)
    px(im, x + 1, 49, BLACK); px(im, x + 2, 49, BLACK)
line(im, [(4, 46), (18, 46)], BLACK)                              # busbar gantry
for x in (5, 11, 17): px(im, x, 45, WHITE)
prism(im, 10, 55, 9, 3, 3, roof=LIGHT, south=MID, shadow=2)       # control hut
px(im, 9, 59, YELLOW); px(im, 12, 59, YELLOW); px(im, 15, 59, YELLOW)
px(im, 18, 55, RED)
line(im, [(1, 50), (3, 50)], BLACK)                               # outgoing line to the grid
truck(im, 22, 57, YELLOW, LIGHT)

# turbines, back to front
turbine(31, 22, 13, -100)
turbine(6, 27, 13, -70)
turbine(46, 42, 12, -85)
turbine(25, 48, 13, -115)
for (x, y, b) in [(58, 60, True), (61, 50, False), (40, 60, False), (3, 4, True), (12, 3, False), (60, 4, False), (2, 38, False)]:
    tree(im, x, y, b)
border(im, 'power')
save(im, 'wind_farm', 'Wind Farm',
     'Clean power, 300 units, zero pollution; output varies with wind, coastal/plains bonus, turbines annoy adjacent homes (noise).',
     'utilities', 'power')
