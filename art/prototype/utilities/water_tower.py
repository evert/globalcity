"""Water tower: a tall white tank on braced legs over a fenced gravel lot, with a little pump house."""
from _style import *

im = ground(3, 'grass', 'water_tower')
# fenced gravel lot
rect(im, 3, 9, 44, 44, DIRT)
for y in range(9, 45):
    for x in range(3, 45):
        r = (x * 73856093 ^ y * 19349663) & 0xffff
        if r % 37 == 0: px(im, x, y, SAND)
        elif r % 61 == 0: px(im, x, y, DARK)
fence(im, 3, 9, 44, 44, DARK, 2, gaps=[('s', 37, 42)])
# access drive out through the gate + pump house apron
rect(im, 37, 40, 42, 47, MID)
for yy in range(42, 47, 3): px(im, 39, yy, LIGHT)

bx, by, H, R = 11, 38, 15, 8              # leg base centre, leg height, tank radius
OFF = [(-7, 0), (0, -6), (7, 0), (0, 6)]                   # splayed legs: W, N, E, S (plan offsets)
TOP = (bx + H, by - H)
def leg_pt(i, f):
    """Point a fraction f up leg i (0 = footing, 1 = under the tank)."""
    gx_, gy_ = bx + OFF[i][0], by + OFF[i][1]
    tx_, ty_ = TOP[0] + round(OFF[i][0] * 0.3), TOP[1] + round(OFF[i][1] * 0.3)
    return round(gx_ + (tx_ - gx_) * f), round(gy_ + (ty_ - gy_) * f)
# shadows first: tank ellipse + leg lines, cast to the bottom-right
shadow_poly(im, [(bx + 9 + round(math.cos(a) * 7), by + 3 + round(math.sin(a) * 5)) for a in [i * math.pi / 8 for i in range(16)]])
for i in range(4):
    (lx, ly) = leg_pt(i, 0)
    shadow_poly(im, [(lx, ly), (bx + 9, by + 3), (bx + 9, by + 4), (lx, ly + 1)])
# back legs (N, E), bracing rings, then front legs (W, S) and the riser
for i, c in ((1, DARK), (2, BLACK)):
    line(im, [leg_pt(i, 0), leg_pt(i, 1)], c)
for f in (0.35, 0.7):
    ring = [leg_pt(i, f) for i in (0, 1, 2, 3, 0)]
    line(im, ring[0:3], DARK)                     # back half of the ring
line(im, [(bx, by), TOP], MID)                    # riser pipe
line(im, [(bx - 1, by), (TOP[0] - 1, TOP[1])], LIGHT)
for f in (0.35, 0.7):
    ring = [leg_pt(i, f) for i in (0, 1, 2, 3, 0)]
    line(im, ring[2:5], DARK)                     # front half of the ring
for i, c in ((3, DARK), (0, MID)):
    line(im, [leg_pt(i, 0), leg_pt(i, 1)], c)
p0, p1 = leg_pt(0, 0), leg_pt(0, 1)
line(im, [(p0[0], p0[1] - 1), (p1[0], p1[1] - 1)], WHITE)
for i in range(4):
    lx, ly = leg_pt(i, 0); rect(im, lx - 1, ly, lx, ly + 1, LIGHT)    # footings
# tank
tx, ty = bx + H + 2, by - H - 2
sphere(im, tx, ty, R, ry=R - 1)
for a in range(15, 175, 4):                                                  # blue band
    rr = math.radians(a)
    px(im, tx + round(math.cos(rr) * (R - 1)), ty + round(math.sin(rr) * 3), BLUE)
rect(im, tx - 1, ty - R + 1, tx, ty - R + 2, LIGHT); px(im, tx, ty - R, RED)  # roof hatch + beacon
# pump house + truck
line(im, [(bx + 1, by + 1), (bx + 3, by + 3), (33, 41)], MID)               # main to pump house
prism(im, 36, 31, 8, 5, 3, roof=LIGHT, south=DARK, win=None, shadow=2)
rect(im, 36, 37, 37, 38, MID); px(im, 39, 36, YELLOW)            # door + lamp
px(im, 39, 32, DARK); px(im, 40, 32, DARK); px(im, 39, 33, BLACK)  # roof vent
px(im, 43, 31, BLUE)
truck(im, 38, 42, BLUE, LIGHT, horiz=False)
# spare pipe sections stacked by the fence
for i, (x, y) in enumerate([(6, 14), (6, 17), (8, 20)]):
    shadow_rect(im, x + 1, y + 2, x + 10, y + 2)
    rect(im, x, y, x + 8, y + 1, LIGHT); line(im, [(x, y), (x + 8, y)], WHITE); line(im, [(x, y + 1), (x + 8, y + 1)], MID)
    px(im, x + 9, y, BLACK); px(im, x + 9, y + 1, DARK)
# shrubs
tree(im, 6, 4, True); tree(im, 22, 5); tree(im, 41, 5, True); tree(im, 46, 20); tree(im, 6, 45); tree(im, 24, 46, True)
for (x, y) in [(40, 14), (8, 27)]: px(im, x, y, FOREST); px(im, x + 1, y, GRASS)
border(im, 'civic')
save(im, 'water_tower', 'Water Tower',
     'Stores pumped water and keeps pressure up for 6,000 residents nearby; cheap, but needs a water plant upstream.',
     'utilities', 'civic')
