"""Grand Central (single track), second pass in the originals' 45-degree oblique view.

Heights extrude up-right from the footprint: every block's roof sits up-right of its base, the lit west wall
and the shaded south wall slant down-left, shadows fall east, and upright things (signal masts, flag poles)
lean up-right like Micropolis' smokestacks. Same layout and animation as hall.py: forecourt, great hall with
arched windows, wings, domed pavilions, a long platform, one exposed through line on tile row 2,
signal boxes and semaphores whose arms rise in turn.
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'civic'))
from _civ import *  # noqa
from PIL import Image
import stations as S
from grand import ground_rect, lamp

T = 16
FRAMES = 8
SIGNALS = [(False, False), (True, False), (True, False), (False, False), (False, False), (False, True), (False, True), (False, False)]
SK = 1


def mast(im, x, y, h, c=WHITE):
    """An upright pole in the oblique view: from its foot (x, y) it rises up-right, with a shadow to the east."""
    for k in range(h + 1):
        shade_rect(im, x + k + 2, y - k + 1, x + k + 2, y - k + 1)
    for k in range(h + 1):
        px(im, x + k, y - k, c); px(im, x + k + 1, y - k, MID)
    return x + h, y - h


def semaphore(im, x, y, clear):
    """Semaphore on a leaning mast; the 2 px arm points east (stop) or up-east (clear); lamp below the pivot."""
    tx, ty = mast(im, x, y, 10)
    px(im, tx + 1, ty - 1, BLACK)
    for k in range(1, 8):
        ax, ay = (tx + k, ty) if not clear else (tx + k, ty - (k + 1) // 2)
        c = WHITE if k in (4, 5) else RED
        px(im, ax, ay, c); px(im, ax, ay + 1, c); px(im, ax, ay + 2, BLACK)
    rect(im, tx - 2, ty + 2, tx - 1, ty + 3, GRASS if clear else RED)
    px(im, tx - 2, ty + 4, BLACK)


def clock_face(im, cx, cy, frame):
    ellipse(im, cx - 4, cy - 4, cx + 4, cy + 4, WHITE, BLACK)
    ellipse(im, cx - 3, cy - 3, cx + 3, cy + 3, YELLOW)
    ellipse(im, cx - 2, cy - 2, cx + 2, cy + 2, WHITE)
    px(im, cx, cy, BLACK); px(im, cx + 1, cy, BLACK)
    dx, dy = [(0, -2), (1, -1), (2, 0), (1, 1), (0, 2), (-1, 1), (-2, 0), (-1, -1)][frame % 8]
    px(im, cx + dx // 2, cy + dy // 2, BLACK); px(im, cx + dx, cy + dy, BLACK)


def flag_lean(im, x, y, c, frame, h=5):
    tx, ty = mast(im, x, y, h)
    if frame % 2 == 0: rect(im, tx + 1, ty, tx + 2, ty + 1, c)
    else: px(im, tx + 1, ty, c); px(im, tx + 2, ty + 1, c); px(im, tx + 1, ty + 1, c)


def south_arch(im, X, Y, W, D, H, u0, w, v0, v1):
    """Arched window on a slanted south wall: columns u0..u0+w-1, rows v0..v1, rounded top, white mullion."""
    for v in range(v0, v1 + 1):
        for u in range(u0, u0 + w):
            if v == v0 and u in (u0, u0 + w - 1): continue
            px(im, *south_px(X, Y, W, D, H, SK, u, v), WATER if (u + v) % 3 else BLUE)
        px(im, *south_px(X, Y, W, D, H, SK, u0 + w // 2, v), LIGHT)


def signal_box(im, x, y):
    block(im, x, y, 8, 5, 5, roof=RED, west=LIGHT, south=SAND, skew=SK, sh=(2, 1))
    line(im, [(x + 1, y + 1), (x + 6, y + 1)], ORANGE)
    for u in range(1, 7, 2): px(im, *south_px(x, y, 8, 5, 5, SK, u, 1), WATER)


def hall_ew(frame=0):
    W, H = 6, 3
    im = ground_rect(W * T, H * T, 'gch_ew')
    pave(im, 0, 0, 95, 4, MID, LIGHT)
    for x in range(2, 95, 4): px(im, x, 2, LIGHT)
    for i, c in enumerate([YELLOW, YELLOW, YELLOW, WHITE]): car(im, 6 + i * 4, 1, c)
    rect(im, 72, 1, 79, 3, RED); line(im, [(72, 1), (79, 1)], ORANGE); px(im, 80, 3, BLACK)
    for xx in range(73, 79, 2): px(im, xx, 2, WATER)
    # platform and the exposed line
    pave(im, 4, 27, 91, 34, LIGHT, WHITE)
    for x in range(4, 92, 2): px(im, x, 33, YELLOW)
    line(im, [(4, 34), (91, 34)], MID)
    for x in (12, 80): rect(im, x, 28, x + 4, 29, DARK); px(im, x + 1, 28, YELLOW); px(im, x + 3, 28, ORANGE)
    S.track_row(im, 2, W)
    S.ends_h(im, 2, W)

    # head house: the blocks touch, and are drawn east to west, because in this view a block hides the west
    # wall of its eastern neighbour (only the part above a lower block stays visible)
    def pavilion(X, Y=8):
        Wd, D, Hh = 9, 8, 8
        block(im, X, Y, Wd, D, Hh, roof=MID, west=LIGHT, south=DARK, skew=SK, sh=(3, 2))
        south_windows(im, X, Y, Wd, D, Hh, SK, YELLOW, 2, rows=[1, 4], start=1)
        west_windows(im, X, Y, Wd, D, Hh, SK, MID, 2, cols=[2, 5], start=1)
        dome(im, X + Wd // 2 - 1, Y + D // 2, 3)
        px(im, X + Wd // 2 - 1, Y + D // 2 - 4, YELLOW)

    def wing(X, Wd, Y=10):
        D, Hh = 7, 6
        block(im, X, Y, Wd, D, Hh, roof=LIGHT, west=LIGHT, south=DARK, skew=SK, sh=(3, 2))
        for u in range(1, Wd - 1, 3):                              # colonnade: white columns on the dark wall
            for v in range(0, Hh - 1): px(im, *south_px(X, Y, Wd, D, Hh, SK, u, v), LIGHT)
        for u in range(2, Wd - 1, 3): px(im, *south_px(X, Y, Wd, D, Hh, SK, u, 1), YELLOW)
        line(im, [(X + 1, Y + 2), (X + Wd - 2, Y + 2)], MID)       # mansard break
        for u in range(2, Wd - 2, 4): px(im, X + u, Y + 4, WATER)  # skylights

    pavilion(84, Y=9)
    wing(67, 17, Y=11)   # a little further forward than the west wing, out of the hall's shadow
    # great hall: tallest block, barrel-vault roof, three arched windows and doors on the slanted front
    X, Y, Wd, D, Hh = 41, 6, 26, 10, 9
    block(im, X, Y, Wd, D, Hh, roof=LIGHT, west=LIGHT, south=MID, skew=SK, sh=(2, 1))
    for yy in range(Y + 1, Y + D - 1):
        t = (yy - Y) / D
        for xx in range(X + 1, X + Wd - 1):
            c = WHITE if t < 0.3 else LIGHT if t < 0.55 else (LIGHT if (xx + yy) % 2 else MID) if t < 0.75 else MID
            px(im, xx, yy, c)
    for xx in range(X + 3, X + Wd - 2, 4): line(im, [(xx, Y + 1), (xx, Y + D - 2)], MID)
    for u0 in (4, 11, 18):
        south_arch(im, X, Y, Wd, D, Hh, u0, 4, 1, 6)
    for u in (2, 9, 16, 23):                                        # columns between the arches
        for v in range(0, Hh - 1): px(im, *south_px(X, Y, Wd, D, Hh, SK, u, v), WHITE)
    for u0 in (4, 11, 18):                                          # doors at the foot
        for k in range(3):
            px(im, *south_px(X, Y, Wd, D, Hh, SK, u0 + k, Hh - 1), BLACK)
        px(im, *south_px(X, Y, Wd, D, Hh, SK, u0 + 1, Hh - 2), ORANGE)
    line(im, [(X + 1, Y + D - 1), (X + Wd - 2, Y + D - 1)], WHITE)   # cornice along the roof's front edge
    flag_lean(im, X + 1, Y + 2, RED, frame); flag_lean(im, X + Wd - 6, Y + 2, BLUE, frame + 1)
    wing(21, 20)
    pavilion(12)

    # signal boxes and semaphores at both ends, north of the line
    west, east = SIGNALS[frame % FRAMES]
    semaphore(im, 1, 33, west)
    semaphore(im, 77, 33, east)   # arm (7 px east of a 10 px mast) must end inside the lot
    for x in range(14, 88, 12): lamp(im, x, 29)
    S.people(im, (5, 30, 90, 32), 16 + (frame % 4), 51 + frame // 4, on=(LIGHT, WHITE))
    for (x, y) in [(5, 3), (30, 4), (44, 3), (60, 4), (88, 3)]: person(im, x, y, BLACK)
    return im


def save_all():
    frames = [hall_ew(i) for i in range(FRAMES)]
    for im in frames:
        bad = {im.getpixel((x, y)) for y in range(im.height) for x in range(im.width)} - set(PALETTE)
        assert not bad, f'off-palette {list(bad)[:4]}'
    frames[0].save(os.path.join(HERE, 'hall_ew_v2.png'))
    frames[0].resize((frames[0].width * 4, frames[0].height * 4), Image.NEAREST).save(os.path.join(HERE, 'hall_ew_v2@4x.png'))
    sheet = Image.new('RGB', (frames[0].width * FRAMES, frames[0].height))
    for i, im in enumerate(frames): sheet.paste(im, (i * im.width, 0))
    sheet.save(os.path.join(HERE, 'hall_ew_v2_frames.png'))
    big = [im.resize((im.width * 4, im.height * 4), Image.NEAREST) for im in frames]
    big[0].save(os.path.join(HERE, 'hall_ew_v2@4x.gif'), save_all=True, append_images=big[1:], duration=500, loop=0)
    print('hall_ew_v2', frames[0].size)


if __name__ == '__main__':
    save_all()
