"""Space center: octagonal launch pad with a white rocket on its red service gantry, flame trench,
spherical fuel tanks and a blockhouse control centre with a dish."""
from _style import *

im = ground(4, 'dirt', 'space_center')
for (x, y) in [(4, 4), (40, 6), (56, 6), (60, 14), (3, 34), (58, 30), (34, 58), (12, 60)]:   # scrub
    px(im, x, y, FOREST); px(im, x + 1, y, GRASS)

PX, PY = 20, 44
# crawlerway (two gravel lanes) from the north edge to the pad
for x0 in (22, 27):
    rect(im, x0, 0, x0 + 1, 32, MID)
for y in range(2, 32, 4): px(im, 24, y, SAND); px(im, 25, y + 2, SAND)
# launch pad: concrete octagon
oct_ = lambda r: [(PX + round(math.cos(math.radians(22.5 + 45 * i)) * r), PY + round(math.sin(math.radians(22.5 + 45 * i)) * r)) for i in range(8)]
shadow_poly(im, [(x + 2, y + 2) for x, y in oct_(14)])
poly(im, oct_(14), LIGHT)
poly(im, oct_(9), MID)
line(im, oct_(14)[4:7], WHITE)
for i in range(8):
    a = math.radians(22.5 + 45 * i)
    px(im, PX + round(math.cos(a) * 12), PY + round(math.sin(a) * 12), YELLOW)
# flame trench running west off the pad, scorched at the mouth
rect(im, 1, PY - 2, PX - 4, PY + 2, BLACK)
line(im, [(1, PY - 3), (PX - 4, PY - 3)], DARK)
for (x, y) in [(2, PY + 3), (4, PY + 4), (1, PY + 5), (3, PY - 4), (6, PY + 3), (5, PY - 5)]: px(im, x, y, SAND)
px(im, 3, PY, DARK); px(im, 7, PY + 1, DARK)
rect(im, PX - 4, PY - 4, PX + 4, PY + 4, DARK)                # launch mount
line(im, [(PX - 4, PY - 4), (PX + 4, PY - 4)], MID)

# service gantry (red lattice) standing just east of the rocket, drawn before the rocket
H = 22
gx0, gy0 = PX + 6, PY + 1
shadow_poly(im, [(gx0 + 1, gy0 + 1), (gx0 + 13, gy0 + 7), (gx0 + 13, gy0 + 9), (gx0 + 1, gy0 + 3)])
for t in range(0, H + 2):
    px(im, gx0 + t, gy0 - t, RED)
    px(im, gx0 + t + 2, gy0 - t + 1, DARK)
    if t % 3 == 0: line(im, [(gx0 + t, gy0 - t), (gx0 + t + 2, gy0 - t + 1)], RED)
    if t % 3 == 1: px(im, gx0 + t + 1, gy0 - t, BLACK)
prism(im, gx0 + H + 1, gy0 - H - 3, 4, 3, 1, roof=LIGHT, shadow=0)   # crane head
px(im, gx0 + H + 4, gy0 - H - 3, RED)
# rocket: lit white cylinder (r=3) built bottom-up in segments: black interstage bands, red stripe, cone
W4 = (WHITE, WHITE, LIGHT, MID)
cylinder(im, PX, PY, 3, H, top=None, body=W4, shadow=5)
BK = (DARK, DARK, BLACK, BLACK)
for (t0, h, body) in [(6, 1, BK), (8, 3, W4), (12, 0, (RED, RED, RED, ORANGE)), (13, 2, W4),
                      (16, 0, BK), (17, H - 17, W4)]:
    cylinder(im, PX, PY, 3, h, top=None, body=body, shadow=0, lift=t0)
for k, r in enumerate((3, 3, 2, 2, 2, 1, 1, 0)):                   # pointed nose cone
    cylinder(im, PX + H + k, PY - H - k, r, 0, top=None, body=W4, shadow=0)
px(im, PX + H + 8, PY - H - 8, LIGHT)
px(im, PX + 9, PY - 12, BLUE)                                        # agency mark on the lit side
for (dx, dy) in [(-5, 1), (-4, 1), (-1, 4), (-1, 5)]: px(im, PX + dx, PY + dy, DARK)        # fins
for t in (6, 14):                                                  # swing arms gantry -> rocket
    line(im, [(gx0 + t, gy0 - t), (PX + t + 3, PY - t + 1)], DARK)
# lightning masts
for (x, y) in [(PX - 10, PY - 6), (PX + 9, PY + 10)]:
    line(im, [(x, y), (x + 7, y - 7)], DARK); px(im, x + 7, y - 7, WHITE)
# spherical propellant tanks (LOX blue tag, fuel orange tag) piped to the pad
line(im, [(9, 22), (13, 32)], MID, 2); line(im, [(13, 13), (20, 30)], MID, 2)
for (x, y, c) in [(7, 20, BLUE), (14, 10, ORANGE)]:
    shadow_poly(im, [(x + 2 + round(math.cos(a) * 5), y + 3 + round(math.sin(a) * 4)) for a in [i * math.pi / 8 for i in range(16)]])
    sphere(im, x, y, 5)
    px(im, x - 3, y + 6, DARK); px(im, x + 3, y + 6, DARK)
    px(im, x - 1, y - 2, c)
# blockhouse / mission control (south-east) with dish and badge
prism(im, 47, 43, 14, 8, 5, roof=MID, win=YELLOW, shadow=3)
ellipse(im, 54, 44, 58, 48, BLUE, LIGHT); px(im, 56, 46, WHITE)
sphere(im, 49, 46, 2, shades=(WHITE, WHITE, LIGHT, MID)); px(im, 50, 45, DARK); px(im, 51, 44, DARK)
line(im, [(PX + 12, PY + 6), (42, 52)], DARK)
# a small hangar (vehicle assembly) north-east
prism(im, 49, 3, 12, 7, 5, roof=LIGHT, south=DARK, shadow=3)
for y in range(11, 15): line(im, [(49 - (y - 9), y), (51 - (y - 9), y)], MID)   # tall door
px(im, 59, 3, RED)
# access road + cars
rect(im, 30, 59, 62, 61, MID)
for x in range(32, 62, 4): px(im, x, 60, LIGHT)
car(im, 36, 59, WHITE); car(im, 44, 61, RED)
truck(im, 52, 59, BLUE, WHITE)
border(im, 'civic')
save(im, 'space_center', 'Space Center',
     'Prestige landmark: big tourism and high-tech industry boost, rare launch events; needs a large budget, power and an airport nearby.',
     'utilities', 'civic')
