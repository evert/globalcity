"""Solar farm: rows of tilted blue PV panels on mown grass, a gravel spine road and an inverter shed."""
from _style import *

im = ground(4, 'grass', 'solar_farm')

def panel_row(x0, x1, y, rows=4):
    """South-facing tilted panel row: frame, blue cells with grid, dark lower lip, ground shadow."""
    shadow_rect(im, x0 + 1, y + rows + 1, x1 + 1, y + rows + 2)
    rect(im, x0, y, x1, y + rows - 1, BLUE)
    line(im, [(x0, y), (x1, y)], WATER)                     # top edge catches the sky
    for x in range(x0 + 3, x1, 4):                          # module seams
        line(im, [(x, y + 1), (x, y + rows - 1)], DARK)
    for x in range(x0 + 1, x1, 4): px(im, x, y + 1, WATER) # glints
    line(im, [(x0, y + rows), (x1, y + rows)], DARK)        # lower lip
    px(im, x0, y, WHITE)
    for x in range(x0 + 2, x1, 8): px(im, x, y + rows + 1, MID)   # support legs

# gravel spine road and access tracks
rect(im, 29, 1, 32, 62, SAND)
for y in range(1, 63):
    for x in range(29, 33):
        if (x * 7 + y * 5) % 9 == 0: px(im, x, y, DIRT)
for y in range(3, 60, 8): px(im, 30, y, LIGHT)
rect(im, 4, 50, 28, 52, SAND)
# panel blocks
for y in range(4, 44, 7):
    panel_row(4, 27, y)
for y in range(4, 58, 7):
    panel_row(35, 60, y)
# sheep grazing between the rows (solar grazing keeps the grass short)
for (x, y) in [(8, 9), (19, 23), (44, 16), (52, 37), (39, 51), (24, 44), (57, 23)]:
    px(im, x, y, WHITE); px(im, x + 1, y, WHITE); px(im, x + 2, y, BLACK)
# inverter / transformer yard
rect(im, 3, 53, 27, 61, DIRT)
for y in range(53, 62):
    for x in range(3, 28):
        if (x * 5 + y * 3) % 7 == 0: px(im, x, y, SAND)
gx, gy = prism(im, 9, 54, 14, 4, 3, roof=MID, south=DARK, win=None, shadow=2)   # inverter shed
for (bx, by) in [(15, 54), (14, 55), (15, 55), (16, 55), (15, 56), (14, 57)]: px(im, bx, by, YELLOW)  # bolt
for x in (7, 9, 11): px(im, x, 59, YELLOW)                                  # lit windows
rect(im, 15, 59, 16, 60, BLACK)                                             # door
prism(im, 25, 55, 3, 4, 3, roof=LIGHT, shadow=2)                            # transformer
px(im, 26, 56, BLACK); px(im, 26, 58, BLACK)
px(im, 27, 55, RED)
line(im, [(26, 55), (26, 50)], DARK)                                        # line up to the grid
fence(im, 1, 1, 62, 62, DARK, 3, gaps=[('s', 28, 33)])
car(im, 30, 58, WHITE)
truck(im, 30, 20, ORANGE, LIGHT, horiz=False)
border(im, 'power')
save(im, 'solar_farm', 'Solar Farm',
     'Clean power, 250 units by day and none at night; zero pollution, cheap upkeep, desert/low-cloud regions give a bonus.',
     'utilities', 'power')
