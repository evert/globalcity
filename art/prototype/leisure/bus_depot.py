import random
from _common import *

SLUG = 'bus_depot'
rng = random.Random(SLUG)
im = canvas(3, 'dirt', SLUG)
speckle_on(im, rng, 12, [GRASS, FOREST], DIRT)

# ---------- asphalt yard
rect(im, 2, 16, 45, 45, MID)
for (x, y) in [(5, 44), (20, 17), (33, 40), (41, 22), (12, 33)]: px(im, x, y, DARK)    # oil stains
# bay markings
for x in range(3, 30, 5):
    line(im, [(x, 18), (x, 28)], LIGHT); line(im, [(x, 31), (x, 41)], LIGHT)
rect(im, 30, 46, 41, 47, MID)                    # exit to the street
for x in range(31, 41, 3): px(im, x, 44, WHITE)  # stop line

def bus(x, y, c=YELLOW, L=9, vert=True):
    """Top-down bus: coloured roof with vents, dark window strips down both sides, black windscreen."""
    if vert:
        rect(im, x + 1, y + 1, x + 3, y + L, BLACK)          # shadow
        rect(im, x, y, x + 2, y + L - 1, c)
        line(im, [(x, y + 1), (x, y + L - 2)], DARK if c != ORANGE else RED)
        px(im, x + 1, y + 3, WHITE); px(im, x + 1, y + 6, WHITE)  # roof vents
        line(im, [(x, y + L - 1), (x + 2, y + L - 1)], BLACK)    # windscreen (facing south)
        px(im, x, y, WHITE if c == YELLOW else YELLOW)
    else:
        rect(im, x + 1, y + 1, x + L, y + 3, BLACK)
        rect(im, x, y, x + L - 1, y + 2, c)
        line(im, [(x + 1, y), (x + L - 2, y)], DARK if c != ORANGE else RED)
        px(im, x + 3, y + 1, WHITE); px(im, x + 6, y + 1, WHITE)
        line(im, [(x + L - 1, y), (x + L - 1, y + 2)], BLACK)

# two rows of parked buses
cols = [YELLOW, ORANGE, YELLOW, YELLOW, ORANGE]
for i, x in enumerate(range(4, 29, 5)):
    if i != 3: bus(x, 19, cols[i])
    bus(x, 32, cols[(i + 2) % 5])

# ---------- the garage: sawtooth roof, dark south wall with bay doors
bldg(im, 2, 2, 30, 8, 5, roof=LIGHT, wall=DARK, cast_len=1)
for y in range(3, 10, 3):
    line(im, [(3, y), (30, y)], WHITE); line(im, [(3, y + 1), (30, y + 1)], MID)   # sawtooth skylights
for i, x in enumerate(range(4, 29, 6)):
    rect(im, x, 11, x + 3, 14, BLACK)
    if i in (1, 3): rect(im, x, 13, x + 3, 14, YELLOW); px(im, x + 1, 14, BLACK)   # bus noses peeking out
    line(im, [(x, 11), (x + 3, 11)], ORANGE)                                         # door header stripe

# office with a sign
bldg(im, 35, 3, 9, 6, 4, roof=LIGHT, wall=DARK, windows='dark', cast_len=1)
rect(im, 35, 9, 42, 9, ORANGE)   # livery stripe
rect(im, 37, 5, 41, 6, MID); line(im, [(37, 5), (41, 5)], WHITE); px(im, 39, 6, DARK)   # rooftop AC

# ---------- fuel island with a red canopy
for x in (36, 41): rect(im, x, 24, x + 1, 25, LIGHT); px(im, x, 24, RED)           # pumps
bus(38, 21, YELLOW, L=9)                                                            # refuelling bus
cast(im, 35, 21, 46, 22)
rect(im, 33, 18, 44, 20, RED); line(im, [(33, 18), (44, 18)], ORANGE); line(im, [(44, 18), (44, 20)], DARK)
for x in range(34, 44, 2): px(im, x, 19, WHITE)
# a bus pulling out of the yard
bus(32, 34, ORANGE, L=9)
# the driver's car park
for (x, c) in [(4, RED), (8, BLUE), (12, WHITE)]: car(im, x, 42, c)

# fence + trees
for x in range(1, 47, 2): px(im, x, 46, DARK)
for (x, y) in [(36, 12), (42, 12), (45, 30), (44, 38)]: tree(im, x, y)
border(im, 'civic')
save(im, SLUG, 'Bus Depot', 'Public transit: buses serve zones within 15 tiles, -car traffic and -pollution; requires road connection, upkeep scales with fleet.', 'civic')
