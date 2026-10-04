import math, random
from _common import *

SLUG = 'zoo'
rng = random.Random(SLUG)
im = canvas(4, 'grass', SLUG)

def pen(x0, y0, x1, y1, ground):
    rect(im, x0, y0, x1, y1, ground)
    if ground == DIRT: speckle_on(im, rng, (x1 - x0) * (y1 - y0) // 14, [SAND, DARK], DIRT, (x0, y0, x1, y1))
    if ground == SAND: speckle_on(im, rng, (x1 - x0) * (y1 - y0) // 14, [DIRT], SAND, (x0, y0, x1, y1))

def fence_line(x0, y0, x1, y1):
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            if x in (x0, x1) or y in (y0, y1):
                px(im, x, y, DARK if (x + y) % 2 == 0 else LIGHT)
    # shadow to the outside bottom-right
    for x in range(x0 + 1, x1 + 2): shade_px(im, x, y1 + 1)
    for y in range(y0 + 1, y1 + 2): shade_px(im, x1 + 1, y)

def elephant(x, y, flip=False):
    rect(im, x, y - 1, x + 4, y + 1, MID); rect(im, x + 1, y - 2, x + 3, y - 2, MID)
    px(im, x + 1, y - 2, LIGHT); px(im, x, y - 1, LIGHT)
    rect(im, x, y + 1, x + 4, y + 1, DARK)
    hx = x - 1 if not flip else x + 5
    px(im, hx, y - 1, MID); px(im, hx, y, DARK); px(im, hx, y + 1, DARK)      # head + trunk
    px(im, x, y + 2, DARK); px(im, x + 3, y + 2, DARK)                         # legs
    for dx in range(1, 6): shade_px(im, x + dx, y + 3)
    px(im, x + 5 if not flip else x + 6, y + 1, BLACK)

def giraffe(x, y):
    rect(im, x, y, x + 2, y + 1, YELLOW); px(im, x + 1, y, ORANGE)
    px(im, x + 3, y - 1, YELLOW); px(im, x + 3, y - 2, YELLOW); px(im, x + 4, y - 3, YELLOW); px(im, x + 3, y - 3, ORANGE)
    px(im, x, y + 2, ORANGE); px(im, x + 2, y + 2, ORANGE)
    px(im, x + 3, y + 2, BLACK); px(im, x + 4, y, BLACK)

def lion(x, y):
    rect(im, x, y, x + 3, y + 1, ORANGE); rect(im, x - 1, y - 1, x, y + 1, YELLOW); px(im, x - 1, y, BLACK)
    px(im, x + 4, y, ORANGE); px(im, x, y + 2, DIRT); px(im, x + 3, y + 2, DIRT); px(im, x + 4, y + 2, BLACK)

def rock(x, y, w=3, h=2):
    rect(im, x, y, x + w - 1, y + h - 1, LIGHT); px(im, x, y, WHITE)
    rect(im, x + 1, y + h, x + w, y + h, DARK); px(im, x + w, y + 1, DARK)

# ---------- enclosures (drawn first, paths go over the gaps)
# NW elephants: dusty dirt with a bathing pool
pen(3, 3, 25, 22, DIRT)
ellipse(im, 5, 5, 13, 10, WATER); px(im, 7, 6, WHITE); px(im, 10, 8, BLUE)
tree(im, 20, 5, True); tree(im, 22, 16)
elephant(15, 12); elephant(8, 16, flip=True); elephant(19, 18)
fence_line(2, 2, 26, 23)

# NE giraffes: savanna (sand) with acacias
pen(38, 3, 61, 24, SAND)
for (x, y) in [(41, 5), (55, 6), (50, 17)]:
    rect(im, x, y, x + 4, y + 1, FOREST); px(im, x + 1, y, GRASS); px(im, x + 2, y + 2, DARK); px(im, x + 5, y + 2, BLACK); px(im, x + 3, y + 3, BLACK)
giraffe(44, 12); giraffe(53, 13); giraffe(41, 19); giraffe(57, 20)
fence_line(37, 2, 62, 25)

# SW lions: rocky sand with a den
pen(3, 41, 22, 61, SAND)
rock(5, 44, 5, 3); rock(14, 52, 4, 3); rock(6, 55)
lion(12, 46); lion(17, 47); lion(9, 51)
tree(im, 18, 43)
fence_line(2, 40, 23, 62)

# ---------- central pond with island (flamingos/penguins as white dots)
ellipse(im, 21, 24, 43, 41, WATER)
for (x, y) in [(25, 30), (39, 28), (29, 38), (37, 36), (24, 34)]: px(im, x, y, BLUE)
ellipse(im, 30, 29, 36, 34, GRASS); tree(im, 32, 30, True)
for (x, y) in [(26, 27), (27, 28), (25, 29)]: px(im, x, y, ORANGE)     # flamingos
for (x, y) in [(38, 37), (39, 37), (40, 36)]: px(im, x, y, WHITE)      # swans

# ---------- paths (dirt) ring + entrance avenue
PATH = DIRT
for t in range(0, 360, 2):
    a = math.radians(t)
    x, y = 32 + math.cos(a) * 13.5, 32.5 + math.sin(a) * 10.5
    rect(im, round(x) - 1, round(y) - 1, round(x) + 1, round(y) + 1, PATH)
rect(im, 30, 42, 33, 63, PATH)
rect(im, 30, 2, 33, 22, PATH)        # north walk between pens
ellipse(im, 27, 6, 36, 14, PATH); ellipse(im, 29, 8, 34, 12, GRASS); px(im, 31, 9, WHITE); px(im, 32, 10, LIGHT)  # statue lawn
rect(im, 14, 24, 16, 31, PATH); rect(im, 46, 26, 48, 33, PATH)   # spurs to the pens' gates
rect(im, 13, 23, 17, 23, MID); rect(im, 45, 25, 49, 25, MID)     # gates

# ---------- SE: zoo house (reptiles/aviary) + entrance kiosk
bldg(im, 42, 42, 17, 8, 4, roof=LIGHT, wall=DARK, windows='dark')
rect(im, 45, 44, 55, 47, MID); line(im, [(45, 44), (55, 44)], WHITE)    # skylight
for x in range(46, 55, 2): px(im, x, 45, WATER)
rect(im, 38, 57, 61, 57, PATH)
bldg(im, 35, 54, 6, 3, 2, roof=RED)  # ticket kiosk
px(im, 37, 58, YELLOW)
rect(im, 28, 56, 29, 61, ORANGE); rect(im, 34, 56, 35, 61, ORANGE); rect(im, 28, 55, 35, 55, YELLOW)   # gate arch

# trees around the lawns
for (x, y) in [(27, 44), (35, 45), (25, 50), (36, 50), (25, 57), (52, 31), (58, 36), (5, 27), (10, 33), (20, 30)]:
    tree(im, x, y, big=(x % 2 == 0))
# benches/visitors
pens = [(2, 2, 26, 23), (37, 2, 62, 25), (2, 40, 23, 62)]
n = 0
while n < 34:
    x, y = rng.randint(2, 61), rng.randint(2, 61)
    if any(a <= x <= c and b <= y <= d for a, b, c, d in pens) or get(im, x, y) != DIRT: continue
    px(im, x, y, rng.choice([RED, BLUE, WHITE, YELLOW, BLACK])); n += 1
border(im, 'park')
save(im, SLUG, 'Zoo', 'Attraction: +residential land value within 10 tiles and +tourism; needs road access and draws traffic on weekends.', 'park')
