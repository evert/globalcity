from _civ import *

im = ground(3, 'dirt', 'prison')
O0, O1 = 3, 42          # outer wall square (top-left corner of wall, bottom-right)
# packed-earth compound inside
rect(im, O0 + 3, O0 + 3, O1 - 3, O1 - 3, SAND)
for y in range(O0 + 3, O1 - 2):
    for x in range(O0 + 3, O1 - 2):
        r = rnd(x, y, 'yard') % 100
        if r < 6: px(im, x, y, DIRT)
        elif r < 8: px(im, x, y, DARK)
# outer wall: 3px thick, lit top with razor-wire dots, dark inner face, shadow outside
shade_rect(im, O0 + 2, O1 + 1, O1 + 2, O1 + 2); shade_rect(im, O1 + 1, O0 + 2, O1 + 2, O1 + 2)
for k, c in ((0, WHITE), (1, LIGHT), (2, MID)):
    ImageDraw.Draw(im).rectangle([O0 + k, O0 + k, O1 - k, O1 - k], outline=c)
line(im, [(O1, O0 + 1), (O1, O1)], MID); line(im, [(O0 + 1, O1), (O1, O1)], MID)   # shaded outer faces
line(im, [(O1 - 1, O0 + 2), (O1 - 1, O1 - 1)], LIGHT); line(im, [(O0 + 2, O1 - 1), (O1 - 1, O1 - 1)], LIGHT)
line(im, [(O0 + 3, O0 + 3), (O1 - 3, O0 + 3)], DARK); line(im, [(O0 + 3, O0 + 3), (O0 + 3, O1 - 3)], DARK)  # inner face in shade
for i in range(O0, O1 + 1, 2):   # razor wire along the wall crest
    for (x, y) in [(i, O0 + 1), (i + 1, O1 - 1), (O0 + 1, i + 1), (O1 - 1, i)]:
        px(im, x, y, BLACK)

# cell block (long, tall, barred slit windows)
X, Y, W, D, H = 15, 7, 25, 10, 7
block(im, X, Y, W, D, H, roof=MID, west=LIGHT, south=DARK, skew=1, sh=(3, 2))
for v in (1, 3, 5):
    for u in range(1, W - 1, 2): px(im, *south_px(X, Y, W, D, H, 1, u, v), LIGHT)
for v in (2, 4, 6):
    for u in range(1, D - 1, 2): px(im, *west_px(X, Y, W, D, H, 1, u, v), MID)
for (vx, vy) in [(X + 4, Y + 3), (X + 11, Y + 3), (X + 18, Y + 3)]:
    rect(im, vx, vy, vx + 2, vy + 3, LIGHT); line(im, [(vx, vy), (vx + 2, vy)], WHITE); line(im, [(vx + 3, vy + 1), (vx + 3, vy + 3)], BLACK)
line(im, [(X + 1, Y + D - 2), (X + W - 2, Y + D - 2)], DARK)

# admin block by the gate
X2, Y2, W2, D2, H2 = 29, 30, 9, 5, 3
block(im, X2, Y2, W2, D2, H2, roof=LIGHT, west=WHITE, south=MID, skew=1, sh=(2, 2))
for u in range(2, W2 - 1, 2): px(im, *south_px(X2, Y2, W2, D2, H2, 1, u, 1), BLACK)
px(im, X2 + 3, Y2 + 2, BLUE); px(im, X2 + 4, Y2 + 2, RED)

# exercise yard: court + chain-link fence + inmates in orange
ImageDraw.Draw(im).rectangle([9, 28, 22, 37], fill=DARK, outline=WHITE)
line(im, [(15, 28), (15, 37)], WHITE)
px(im, 9, 32, RED); px(im, 22, 32, RED)
for x in range(7, 25, 2): px(im, x, 26, MID); px(im, x, 39, MID)
for y in range(26, 40, 2): px(im, 7, y, MID); px(im, 24, y, MID)
for (x, y) in [(11, 30), (13, 35), (18, 30), (20, 35), (17, 33), (26, 28), (9, 23), (11, 24)]:
    px(im, x, y, ORANGE)
for (x, y) in [(26, 37), (13, 22)]: px(im, x, y, BLUE)   # guards

# watchtowers on the corners: concrete legs, dark glass cab, searchlight
def tower(x, y):
    shade_rect(im, x + 2, y + 6, x + 7, y + 8); shade_rect(im, x + 6, y + 2, x + 7, y + 8)
    rect(im, x, y + 5, x + 5, y + 7, MID); line(im, [(x, y + 5), (x, y + 7)], LIGHT)    # south face
    rect(im, x, y, x + 5, y + 4, DARK)                                                  # roof
    line(im, [(x, y), (x + 5, y)], LIGHT); line(im, [(x, y), (x, y + 4)], LIGHT)
    rect(im, x + 1, y + 5, x + 4, y + 5, BLACK)                                         # window band
    px(im, x + 2, y + 5, WATER)
    px(im, x + 2, y + 2, YELLOW)
for (x, y) in [(O0 - 1, O0 - 2), (O1 - 4, O0 - 2), (O0 - 1, O1 - 6), (O1 - 4, O1 - 6)]:
    tower(x, y)

# gate in the south wall + road out
rect(im, 30, O1 - 2, 36, O1 + 2, MID)
for x in range(30, 37, 2): line(im, [(x, O1 - 2), (x, O1)], BLACK)
line(im, [(30, O1 - 3), (36, O1 - 3)], YELLOW)
rect(im, 31, O1 + 2, 35, 47, MID)
car(im, 32, 44, WHITE, vertical=True); px(im, 32, 43, BLUE)
border(im, 'civic')
rect(im, 31, 47, 35, 47, MID)

save(im, 'prison', 'Prison',
     'Holds criminals: cuts citywide crime and boosts police effectiveness, but lowers land value and residential demand within 6 tiles.',
     'civic', 'civic')
