import math, random
from _common import *

SLUG = 'botanical_garden'
rng = random.Random(SLUG)
im = canvas(3, 'grass', SLUG)

PATH = LIGHT
# ---------- garden paths
rect(im, 22, 20, 25, 46, PATH)             # main axis to the south gate
rect(im, 3, 31, 44, 33, PATH)              # cross walk
ellipse(im, 18, 27, 29, 37, PATH)          # fountain circle
ellipse(im, 20, 29, 27, 35, WATER); ellipse(im, 22, 31, 25, 33, BLUE); px(im, 23, 31, WHITE); px(im, 24, 32, WHITE)
rect(im, 3, 20, 44, 21, PATH)              # terrace in front of the glasshouse

# ---------- flower beds: colour rows framed by low dark hedges
def bed(x0, y0, x1, y1, cols):
    rect(im, x0, y0, x1, y1, FOREST)
    i = 0
    for y in range(y0 + 1, y1, 2):
        c = cols[i % len(cols)]
        for x in range(x0 + 1, x1):
            px(im, x, y, c if (x + y) % 5 else FOREST)
        i += 1
    for x in range(x0 + 1, x1 + 2): shade_px(im, x, y1 + 1)
bed(4, 23, 17, 29, [RED, YELLOW, WHITE])
bed(30, 23, 43, 29, [ORANGE, BLUE, YELLOW])
bed(4, 35, 17, 44, [YELLOW, RED, ORANGE, WHITE])
bed(30, 35, 43, 44, [BLUE, WHITE, RED, YELLOW])

# ---------- the glasshouse: two glazed wings + a central dome
def glass_roof(x0, y0, x1, y1):
    ym = (y0 + y1) // 2
    rect(im, x0, y0, x1, y1, WATER)
    for x in range(x0, x1 + 1, 3):
        line(im, [(x, y0), (x, ym)], WHITE); line(im, [(x, ym + 1), (x, y1)], LIGHT)
    line(im, [(x0, ym), (x1, ym)], WHITE)    # ridge
    line(im, [(x0, y0), (x1, y0)], WHITE)
    for x in range(x0 + 1, x1, 3):           # plants seen through the glass (shaded slope)
        if (x * 7) % 5 < 3: px(im, x, y1 - 1, FOREST); px(im, x + 1, y1, FOREST)
        else: px(im, x + 1, y1 - 1, BLUE)

def glass_wall(x0, y0, x1, y1):
    rect(im, x0, y0, x1, y1, DARK)
    for x in range(x0 + 1, x1, 2):
        for y in range(y0 + 1, y1): px(im, x, y, LIGHT if (x // 2) % 2 else WATER)

# wings (west + east)
cast(im, 6, 18, 45, 19); cast(im, 44, 9, 45, 18)
for (x0, x1) in [(3, 15), (32, 43)]:
    glass_roof(x0, 7, x1, 14)
    glass_wall(x0, 15, x1, 17)
    rect(im, x1 + 1, 8, x1 + 1, 17, BLACK)
    line(im, [(x0, 7), (x0, 17)], WHITE)
# central palm house dome
cx, cy, r = 23, 10, 8
glass_wall(cx - 8, cy + 4, cx + 8, cy + 8)
rect(im, cx + 9, cy + 4, cx + 9, cy + 8, BLACK)
cast(im, cx - 3, cy + 9, cx + 10, cy + 10)
def indome(x, y, rr=r): return (x - cx) ** 2 + (y - cy) ** 2 <= rr * rr + rr * 0.6
for y in range(cy - r - 1, cy + r + 2):
    for x in range(cx - r - 1, cx + r + 2):
        if indome(x, y):
            d = (x - cx) + (y - cy)
            c = WATER
            if not indome(x, y, r - 2) and d > 3: c = BLUE         # shaded rim
            px(im, x, y, c)
for k in range(8):
    a = k * math.pi / 4 + math.pi / 8
    for t in range(5, r + 1):
        x, y = cx + round(math.cos(a) * t), cy + round(math.sin(a) * t)
        px(im, x, y, LIGHT if math.cos(a) + math.sin(a) < 0 else MID)
for y in range(cy - r - 1, cy + r + 2):
    for x in range(cx - r - 1, cx + r + 2):
        if indome(x, y) and not indome(x, y, r - 1):
            px(im, x, y, WHITE if (x - cx) + (y - cy) < 1 else DARK)
        elif indome(x, y, 4.3) and not indome(x, y, 3.3):
            px(im, x, y, WHITE if (x - cx) + (y - cy) < 1 else MID)
px(im, cx, cy, WHITE); px(im, cx - 1, cy, LIGHT); px(im, cx, cy - 1, LIGHT); px(im, cx + 1, cy, MID); px(im, cx, cy + 1, MID)    # lantern
for (x, y) in [(cx + r + 1, cy + 1), (cx + r, cy + 4), (cx + 6, cy + 6)]: px(im, x, y, BLACK)
# entrance door
rect(im, cx - 2, cy + 7, cx + 2, cy + 9, DARK); px(im, cx, cy + 8, YELLOW)

# ---------- trees, gate, visitors
for (x, y) in [(1, 2), (44, 2), (2, 46), (44, 45), (13, 46), (33, 46)]: tree(im, x, y, big=True)
rect(im, 20, 46, 21, 47, DARK); rect(im, 26, 46, 27, 47, DARK)
crowd(im, rng, 14, (3, 20, 44, 46), on=[PATH], colours=[RED, BLUE, BLACK, ORANGE, DARK])
border(im, 'park')
save(im, SLUG, 'Botanical Garden', 'Education + calm: +residential land value within 8 tiles and a small pollution sink (-pollution in radius 4).', 'park')
