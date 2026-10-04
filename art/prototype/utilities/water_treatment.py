"""Water treatment plant: round clarifier tanks, an aeration basin, pipes and a low control building."""
from _style import *

def clarifier(im, cx, cy, r, arm_angle):
    ox, oy = cylinder(im, cx, cy, r, 2, top=None, body=(WHITE, LIGHT, MID, DARK), shadow=2)
    ellipse(im, ox - r, oy - r, ox + r, oy + r, LIGHT, WHITE)          # concrete rim
    ellipse(im, ox - r + 1, oy - r + 1, ox + r - 1, oy + r - 1, WATER, MID)
    ellipse(im, ox - r + 3, oy - r + 3, ox + r - 3, oy + r - 3, WATER, BLUE)   # inner weir ring
    a = math.radians(arm_angle)                                          # rotating bridge
    ex, ey = ox + round(math.cos(a) * (r - 1)), oy + round(math.sin(a) * (r - 1))
    line(im, [(ox, oy), (ex, ey)], WHITE)
    line(im, [(ox + 1, oy + 1), (ex + 1, ey + 1)], DARK)
    rect(im, ox - 1, oy - 1, ox + 1, oy + 1, LIGHT); px(im, ox, oy, RED)
    return ox, oy

im = ground(3, 'dirt', 'water_treatment')
# grass verge along the south with a small car park
rect(im, 1, 42, 46, 46, GRASS)
for x in range(1, 47):
    for y in range(42, 47):
        if (x * 7 + y * 3) % 11 == 0: px(im, x, y, FOREST)
# pipes (drawn first so tanks sit on them)
line(im, [(11, 12), (31, 12)], MID, 2)
line(im, [(4, 12), (4, 30)], MID, 2)
line(im, [(4, 12), (11, 12)], MID, 2)
line(im, [(31, 12), (31, 28)], MID, 2)
line(im, [(31, 20), (43, 20)], MID, 2)
clarifier(im, 10, 15, 8, -30)
clarifier(im, 29, 15, 8, 200)
# chemical dosing tanks on the east edge
for i, ty in enumerate((10, 19)):
    cylinder(im, 41, ty, 2, 3, top=LIGHT, rim=WHITE, shadow=2)
px(im, 44, 7, ORANGE); px(im, 44, 16, YELLOW)
# aeration basin: low concrete box with water cells and bubbles
prism(im, 6, 27, 18, 12, 2, roof=LIGHT, south=MID, shadow=2)
rect(im, 7, 28, 22, 37, WATER)
for xx in (12, 17): line(im, [(xx, 28), (xx, 37)], LIGHT)
for (bx, by) in [(8, 29), (10, 32), (9, 35), (14, 30), (15, 34), (13, 36), (19, 29), (20, 33), (18, 35), (21, 36), (11, 29), (16, 31)]:
    px(im, bx, by, WHITE)
# control building with lit west wall, windows, roof plant
gx, gy = prism(im, 31, 28, 13, 8, 5, roof=MID, win=YELLOW, shadow=3)
rect(im, 33, 30, 36, 32, DARK); rect(im, 33, 30, 35, 31, LIGHT); px(im, 34, 30, BLACK)
px(im, 40, 30, BLACK); px(im, 41, 30, BLACK); px(im, 40, 33, BLACK); px(im, 41, 33, BLACK)
px(im, 31, 28, RED); px(im, 43, 28, RED)                               # corner lights like the originals
rect(im, 27, 42, 45, 45, MID)
for xx in range(29, 45, 4): px(im, xx, 42, LIGHT)
car(im, 29, 43, BLUE); car(im, 37, 44, RED); car(im, 41, 43, WHITE)
tree(im, 3, 43); tree(im, 8, 45); tree(im, 21, 44, True); tree(im, 45, 38); tree(im, 2, 37)
border(im, 'civic')
save(im, 'water_treatment', 'Water Treatment Plant',
     'Supplies clean water to 15,000 residents per plant; without it, dense zones cap out and health drops.',
     'utilities', 'civic')
