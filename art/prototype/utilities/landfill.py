"""Landfill: fenced dirt site with heaped rubbish mounds, a bulldozer, garbage trucks and a gate office."""
from _style import *
import random

R = random.Random(7)
im = ground(3, 'dirt', 'landfill')
TRASH = [WHITE, LIGHT, RED, BLUE, YELLOW, ORANGE, FOREST, DARK, BLACK, WATER, MID]

def mound(cx, cy, rx, ry, density=0.35, shades=(LIGHT, MID, SAND, DARK), junk=True):
    """Heap: shaded dome + scattered colourful junk pixels, shadow to the bottom-right."""
    shadow_poly(im, [(cx + 2 + round(math.cos(a) * rx), cy + 2 + round(math.sin(a) * ry)) for a in [i * math.pi / 10 for i in range(20)]])
    sphere(im, cx, cy, rx, shades=shades, ry=ry)
    if not junk: return
    for y in range(cy - ry, cy + ry + 1):
        for x in range(cx - rx, cx + rx + 1):
            dx, dy = (x - cx) / (rx + 0.5), (y - cy) / (ry + 0.5)
            if dx * dx + dy * dy < 0.85 and R.random() < density:
                c = R.choice(TRASH)
                if (dx + dy) > 0.5 and c in (WHITE, LIGHT, YELLOW): c = DARK   # keep the shaded side dark
                px(im, x, y, c)

def ruts(pts):
    """Dirt haul track: two sand wheel ruts."""
    line(im, [(x, y) for x, y in pts], SAND)
    line(im, [(x + 2, y + 1) for x, y in pts], SAND)

# capped (finished) cell in the north-west: grassed-over hill with methane vents
mound(11, 9, 10, 6, shades=(GRASS, GRASS, FOREST, FOREST), junk=False)
for (x, y) in [(6, 6), (14, 5), (9, 11)]: px(im, x, y, FOREST)
for y0 in (7, 11):                                                  # terraces
    for x in range(3, 20):
        if (x + y0) % 3: px(im, x, y0 + (1 if x > 12 else 0), FOREST)
for x in (7, 15): rect(im, x, 7, x, 8, MID); px(im, x, 6, WHITE)
# haul tracks from the gate to the tipping faces
ruts([(29, 46), (29, 38), (23, 33), (22, 24), (26, 21)])
ruts([(29, 38), (37, 30), (38, 25)])
# active rubbish mounds
mound(36, 12, 9, 7)
mound(10, 28, 8, 6)
mound(41, 35, 4, 4)
# bulldozer pushing on the big mound (blade facing west)
shadow_rect(im, 24, 21, 30, 22)
rect(im, 23, 16, 28, 16, BLACK); rect(im, 23, 20, 28, 20, BLACK)          # tracks
rect(im, 23, 17, 28, 19, YELLOW)
rect(im, 25, 17, 27, 18, ORANGE); px(im, 25, 17, YELLOW)                  # cab
px(im, 26, 17, BLACK)                                                     # window
line(im, [(21, 15), (21, 21)], LIGHT); px(im, 21, 15, WHITE); line(im, [(22, 17), (22, 19)], DARK)  # blade + arms
px(im, 29, 18, DARK)                                                      # exhaust
# garbage trucks on the haul road
truck(im, 31, 33, FOREST, LIGHT)
truck(im, 28, 40, BLUE, WHITE, horiz=False)
# gate office + weighbridge at the south entrance
prism(im, 41, 40, 4, 3, 2, roof=LIGHT, south=MID, shadow=2)
px(im, 40, 43, YELLOW); px(im, 41, 40, RED)
rect(im, 32, 42, 35, 44, MID); line(im, [(32, 42), (35, 42)], LIGHT)      # weighbridge plate
# leachate pond (murky) in the south-west corner
ellipse(im, 4, 38, 18, 44, SAND)
ellipse(im, 5, 39, 17, 43, FOREST)
line(im, [(7, 40), (10, 40)], WATER); line(im, [(12, 42), (14, 42)], WATER)
line(im, [(17, 41), (22, 41)], MID)                                       # outflow pipe
# seagulls circling
for (x, y) in [(20, 5), (28, 3), (44, 24), (17, 19)]:
    px(im, x, y, WHITE); px(im, x + 1, y + 1, WHITE); px(im, x + 2, y, WHITE)
fence(im, 1, 1, 46, 46, DARK, 2, gaps=[('s', 27, 34)])
border(im, 'ind')
save(im, 'landfill', 'Landfill',
     'Absorbs 20 tons/month of city garbage; cheap but polluting and smelly (land value drop nearby), fills up and becomes a park when capped.',
     'utilities', 'ind')
