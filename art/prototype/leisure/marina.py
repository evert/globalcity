import random
from _common import *

SLUG = 'marina'
rng = random.Random(SLUG)
im = canvas(3, 'water', SLUG)
for y in range(48):
    for x in range(48):
        if get(im, x, y) == BLUE and (x * 5 + y * 3) % 4: px(im, x, y, WATER)
for (x, y) in [(6, 46), (36, 46), (14, 46), (45, 23)]: px(im, x, y, WHITE)   # glints

# ---------- land (north part) with quay wall
land = canvas(3, 'dirt', SLUG + 'l')
im.paste(land.crop((0, 0, 48, 19)), (0, 0))
speckle_on(im, rng, 10, [GRASS, FOREST], DIRT, (1, 1, 46, 17))
rect(im, 0, 17, 47, 18, LIGHT); line(im, [(0, 17), (47, 17)], WHITE)   # quay edge
rect(im, 0, 19, 47, 19, DARK)                                           # quay face
rect(im, 0, 20, 47, 20, BLUE)                                           # shadow on water

# promenade + parking
rect(im, 1, 13, 46, 16, MID)
for x in range(2, 46, 4): px(im, x, 14, LIGHT)
rect(im, 29, 2, 46, 11, MID)
for x in range(30, 46, 3): px(im, x, 2, LIGHT); px(im, x, 11, LIGHT)
car(im, 30, 4, RED, False); car(im, 36, 7, WHITE, False); car(im, 42, 4, BLUE, False); car(im, 39, 4, YELLOW, False)

# harbour office: light roof, dark south wall, blue awning, flagpole
bldg(im, 4, 2, 17, 7, 4, roof=LIGHT, wall=DARK, windows='dark', cast_len=1)
rect(im, 6, 4, 8, 5, MID); px(im, 9, 5, BLACK); rect(im, 13, 4, 18, 6, BLUE); line(im, [(13, 4), (18, 4)], WHITE)
for x in (14, 16): px(im, x, 5, WHITE)   # rooftop sign / solar
rect(im, 4, 13, 20, 13, BLUE)
for x in range(5, 20, 2): px(im, x, 13, WHITE)                          # striped awning
line(im, [(24, 3), (24, 11)], WHITE); px(im, 25, 12, BLACK)
rect(im, 25, 3, 27, 4, RED); px(im, 25, 5, RED)
tree(im, 1, 9); tree(im, 22, 7, True)

# ---------- piers (light boardwalks, dark posts, 1px shadow on the water)
def pier(x0, y0, x1, y1):
    for x in range(x0 + 1, x1 + 2): px(im, x, y1 + 1, BLUE)
    for y in range(y0 + 1, y1 + 2): px(im, x1 + 1, y, BLUE)
    rect(im, x0, y0, x1, y1, LIGHT)
    if x1 - x0 > y1 - y0:
        for x in range(x0, x1 + 1, 4): px(im, x, y1, MID)
    else:
        for y in range(y0, y1 + 1, 4): px(im, x1, y, MID)
pier(22, 21, 23, 43)                     # main pier
for y in (27, 35, 43):
    pier(3, y, 21, y)
    pier(24, y, 41, y)
rect(im, 20, 43, 25, 44, LIGHT); rect(im, 21, 42, 24, 42, MID)    # pier head
px(im, 22, 41, RED); px(im, 23, 41, WHITE)                          # harbour light

# ---------- boats: white hulls moored nose-in under each finger pier
def boat(x, y, L=5, c=WHITE, canopy=None, mast=False):
    rect(im, x + 2, y + 1, x + 2, y + L, BLUE); px(im, x + 1, y + L, BLUE)    # shadow
    rect(im, x, y + 1, x + 1, y + L - 1, c); px(im, x, y, c); px(im, x + 1, y, LIGHT)  # pointed bow
    px(im, x + 1, y + L - 1, LIGHT)
    if canopy: px(im, x, y + L - 3, canopy); px(im, x + 1, y + L - 3, canopy)
    if mast: px(im, x, y + 2, DARK)

for y in (21, 28, 36):
    for x in list(range(4, 20, 4)) + list(range(26, 41, 4)):
        if rng.random() < 0.75:
            L = rng.choice([4, 5, 5, 6]) if y != 21 else 5
            boat(x, y + 1 if y != 21 else y, L=L, canopy=rng.choice([None, None, BLUE, RED, ORANGE]), mast=rng.random() < 0.35)
# a yacht heading out to sea, leaving a wake
boat(43, 28, L=7, canopy=YELLOW, mast=True)
for k, (x, y) in enumerate([(43, 37), (44, 37), (42, 39), (45, 39), (41, 41), (46, 41)]): px(im, x, y, WHITE if k < 4 else LIGHT)
# breakwater


border(im, 'com')
save(im, SLUG, 'Marina', 'Waterfront tourism: +commercial demand and +land value for nearby waterfront tiles; must be placed on a coastline.', 'com')
