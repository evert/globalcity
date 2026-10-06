"""Grand Central, single-track variant: the great hall over one fully exposed through line.

East-west 6x3: forecourt, the Beaux-Arts head house (great hall with three arched windows and a clock,
colonnaded wings, domed corner pavilions), a long platform, and the line on tile row 2, drawn entirely
from the real rail tile so it joins anything built up to it. A signal box and semaphore signals guard both
ends. North-south 3x6: the same hall along the west side, the line on tile column 2.

Animation (FRAMES frames, ~0.5 s each): the semaphore arms rise and lamps turn from red to green in turn
(west clears, then east, as if a train is passing), the clock's minute hand steps round, and the flags
flutter. In the game the client would draw these frames in a loop, or switch a signal to clear when a train
sprite is near that end of the station.
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'civic'))
from _civ import *  # noqa
from PIL import Image
import stations as S
from grand import ground_rect, arched_window, lamp

T = 16
FRAMES = 8
# signal states per frame: (west, east), True = clear (arm raised, green lamp)
SIGNALS = [(False, False), (True, False), (True, False), (False, False), (False, False), (False, True), (False, True), (False, False)]


def semaphore(im, x, y, clear, facing=1):
    """Semaphore signal, front elevation. (x, y) = mast foot. Mast 14 px; a 2 px thick arm pivots at the top
    and points away from the mast by `facing` (+1 east, -1 west): horizontal = stop, raised 45 degrees =
    clear. A 2x2 lamp below the pivot shows red or green."""
    top = y - 14
    shade_rect(im, x + 1, y - 1, x + 3, y)                       # ground shadow
    rect(im, x - 1, y - 1, x + 1, y, BLACK)                      # foot
    line(im, [(x, top), (x, y - 1)], WHITE)
    line(im, [(x + 1, top + 1), (x + 1, y - 2)], MID)
    px(im, x, top - 1, BLACK)                                    # finial
    for k in range(1, 9):                                        # arm, 8 px
        ax = x + facing * k
        ay = top + 1 - ((k - 1) if clear else 0)
        c = WHITE if k in (5, 6) else RED
        px(im, ax, ay, c); px(im, ax, ay + 1, c)
        px(im, ax, ay + 2, BLACK)
    lx = x - facing * 2 if facing > 0 else x + 1
    lc = GRASS if clear else RED
    rect(im, min(lx, lx + 1), top + 4, max(lx, lx + 1), top + 5, lc)
    px(im, lx, top + 3, BLACK)


def clock_face(im, cx, cy, frame):
    ellipse(im, cx - 4, cy - 4, cx + 4, cy + 4, WHITE, BLACK)
    ellipse(im, cx - 3, cy - 3, cx + 3, cy + 3, YELLOW)
    ellipse(im, cx - 2, cy - 2, cx + 2, cy + 2, WHITE)
    px(im, cx, cy, BLACK); px(im, cx + 1, cy, BLACK)              # hour hand (fixed at three)
    dx, dy = [(0, -2), (1, -1), (2, 0), (1, 1), (0, 2), (-1, 1), (-2, 0), (-1, -1)][frame % 8]
    px(im, cx + dx // 2, cy + dy // 2, BLACK); px(im, cx + dx, cy + dy, BLACK)   # minute hand


def flag_anim(im, x, y, c, frame, h=4):
    line(im, [(x, y), (x, y + h)], WHITE)
    px(im, x + 1, y + h, BLACK)
    if frame % 2 == 0:
        rect(im, x + 1, y, x + 2, y + 1, c)
    else:
        px(im, x + 1, y, c); px(im, x + 2, y + 1, c); px(im, x + 1, y + 1, c)


def signal_box(im, x, y):
    """Small brick signal box with a red hipped roof and a glazed upper floor (front elevation)."""
    block(im, x, y, 9, 5, 6, roof=RED, west=WHITE, south=SAND, skew=0)
    line(im, [(x + 1, y + 1), (x + 7, y + 1)], ORANGE)
    for u in range(x + 1, x + 8, 2): px(im, u, y + 6, WATER)
    px(im, x + 4, y + 9, BLACK); px(im, x + 4, y + 10, BLACK)


# ======================================================================== east-west 6x3

def hall_ew(frame=0):
    W, H = 6, 3
    im = ground_rect(W * T, H * T, 'gch_ew')
    # forecourt
    pave(im, 0, 0, 95, 5, MID, LIGHT)
    for x in range(2, 95, 4): px(im, x, 3, LIGHT)
    for i, c in enumerate([YELLOW, YELLOW, YELLOW, WHITE]): car(im, 14 + i * 4, 1, c)
    rect(im, 64, 1, 71, 3, RED); line(im, [(64, 1), (71, 1)], ORANGE); px(im, 72, 3, BLACK)
    for xx in range(65, 71, 2): px(im, xx, 2, WATER)
    tree(im, 1, 7, big=True); tree(im, 90, 7, big=True)
    # platform along the line, then the exposed track on tile row 2
    pave(im, 8, 27, 87, 34, LIGHT, WHITE)
    for x in range(8, 88, 2): px(im, x, 33, YELLOW)
    line(im, [(8, 34), (87, 34)], MID)
    for x in (16, 79): rect(im, x, 28, x + 4, 29, DARK); px(im, x + 1, 28, YELLOW); px(im, x + 3, 28, ORANGE)
    for x in range(12, 86, 10): lamp(im, x, 29)
    S.track_row(im, 2, W)
    S.ends_h(im, 2, W)
    # head house (front elevation)
    SK = 0
    for wx in (18, 62):
        X, Y, Wd, D, Hh = wx, 9, 16, 8, 9
        block(im, X, Y, Wd, D, Hh, roof=LIGHT, west=WHITE, south=MID, skew=SK)
        line(im, [(X + 1, Y + 2), (X + Wd - 2, Y + 2)], MID)
        for u in range(X + 2, X + Wd - 2, 3):
            line(im, [(u, Y + D + 1), (u, Y + D + Hh - 2)], WHITE)
            px(im, u + 1, Y + D + 2, BLACK); px(im, u + 1, Y + D + 5, BLACK)
        line(im, [(X, Y + D), (X + Wd - 1, Y + D)], WHITE)
    for px0 in (9, 77):
        X, Y, Wd, D, Hh = px0, 8, 10, 9, 10
        block(im, X, Y, Wd, D, Hh, roof=MID, west=WHITE, south=MID, skew=SK)
        south_windows(im, X, Y, Wd, D, Hh, SK, BLACK, 3, rows=[2, 5, 8], start=2)
        cap(im, X + Wd // 2 - 1, Y + 6, 4, 5)
        px(im, X + Wd // 2 - 1, Y, YELLOW)
    X, Y, Wd, D, Hh = 33, 2, 30, 13, 12
    block(im, X, Y, Wd, D, Hh, roof=LIGHT, west=WHITE, south=MID, skew=SK)
    for yy in range(Y + 1, Y + D - 1):
        t = (yy - Y) / D
        for xx in range(X + 1, X + Wd - 1):
            c = WHITE if t < 0.25 else LIGHT if t < 0.5 else (LIGHT if (xx + yy) % 2 else MID) if t < 0.7 else MID
            px(im, xx, yy, c)
    for xx in range(X + 3, X + Wd - 2, 4): line(im, [(xx, Y + 1), (xx, Y + D - 2)], MID)
    line(im, [(X, Y + D - 1), (X + Wd - 1, Y + D - 1)], WHITE)
    for ax in (36, 45, 54): arched_window(im, ax, Y + D + 1, 7, 9)
    for cx in (34, 43, 52, 61):
        line(im, [(cx, Y + D + 1), (cx, Y + D + Hh - 2)], WHITE)
        line(im, [(cx + 1, Y + D + 1), (cx + 1, Y + D + Hh - 2)], LIGHT)
    for dx in (37, 46, 55):
        rect(im, dx, Y + D + Hh - 3, dx + 4, Y + D + Hh - 1, BLACK); rect(im, dx + 1, Y + D + Hh - 2, dx + 3, Y + D + Hh - 1, ORANGE)
    clock_face(im, 48, 11, frame)
    for sx in (42, 53): rect(im, sx, 10, sx + 1, 14, SAND); px(im, sx, 9, ORANGE)
    line(im, [(X - 1, Y + D + Hh), (X + Wd, Y + D + Hh)], WHITE)
    flag_anim(im, 34, 0, RED, frame); flag_anim(im, 60, 0, BLUE, frame + 1)
    # signal boxes and semaphores at both ends of the platform (north side of the line)
    signal_box(im, 0, 17)
    signal_box(im, 87, 17)
    west, east = SIGNALS[frame % FRAMES]
    semaphore(im, 4, 34, west, facing=1)
    semaphore(im, 91, 34, east, facing=-1)
    # people: waiting on the platform, more of them before a departure
    S.people(im, (9, 30, 86, 32), 16 + (frame % 4), 51 + frame // 4, on=(LIGHT, WHITE))
    for (x, y) in [(6, 4), (30, 5), (44, 4), (58, 5), (84, 4)]: person(im, x, y, BLACK)
    return im


# ======================================================================== north-south 3x6

def hall_ns(frame=0):
    W, H = 3, 6
    im = ground_rect(W * T, H * T, 'gch_ns')
    pave(im, 0, 0, 4, 95, MID, LIGHT)
    for y in range(2, 95, 4): px(im, 2, y, LIGHT)
    for i, c in enumerate([YELLOW, YELLOW, WHITE]): car(im, 1, 20 + i * 4, c, vertical=True)
    rect(im, 1, 66, 3, 73, RED); px(im, 3, 74, BLACK)
    tree(im, 6, 0, big=True); tree(im, 6, 91, big=True)
    # platform and the exposed line on tile column 2
    pave(im, 26, 8, 33, 87, LIGHT, WHITE)
    for y in range(8, 88, 2): px(im, 33, y, YELLOW)
    for y in range(12, 86, 10): lamp(im, 28, y)
    S.track_col(im, 2, H)
    S.ends_v(im, 2, H)
    # head house along the west side (oblique, lit street front), as in the 3-track version
    SK = 1
    for wy in (18, 60):
        X, Y, Wd, D, Hh = 13, wy, 12, 16, 5
        block(im, X, Y, Wd, D, Hh, roof=LIGHT, west=WHITE, south=MID, skew=SK)
        for yy in range(Y + 2, Y + D - 1, 4): line(im, [(X + 2, yy), (X + Wd - 3, yy)], MID)
        line(im, [(X + Wd // 2, Y + 1), (X + Wd // 2, Y + D - 2)], WATER)
        for u in range(1, D - 1, 3):
            for v in (2, 4): px(im, *west_px(X, Y, Wd, D, Hh, SK, u, v), BLACK)
    for py in (8, 76):
        X, Y, Wd, D, Hh = 13, py, 13, 10, 6
        block(im, X, Y, Wd, D, Hh, roof=MID, west=WHITE, south=MID, skew=SK)
        dome(im, X + Wd // 2, Y + D // 2, 4)
        px(im, X + Wd // 2 - 1, Y + D // 2 - 1, YELLOW)
    X, Y, Wd, D, Hh = 15, 34, 12, 26, 9
    block(im, X, Y, Wd, D, Hh, roof=LIGHT, west=WHITE, south=MID, skew=SK)
    for xx in range(X + 1, X + Wd - 1):
        t = (xx - X) / Wd
        for yy in range(Y + 1, Y + D - 1):
            c = WHITE if t < 0.3 else LIGHT if t < 0.55 else (LIGHT if (xx + yy) % 2 else MID) if t < 0.75 else MID
            px(im, xx, yy, c)
    for yy in range(Y + 3, Y + D - 2, 4): line(im, [(X + 1, yy), (X + Wd - 2, yy)], MID)
    for u in range(3, D - 2, 4):
        for v in range(2, Hh - 1): px(im, *west_px(X, Y, Wd, D, Hh, SK, u, v), WATER)
    cxk, cyk = west_px(X, Y, Wd, D, Hh, SK, D // 2, 4)
    clock_face(im, cxk, cyk, frame)
    for u in (6, 13, 20):
        x_, y_ = west_px(X, Y, Wd, D, Hh, SK, u, Hh)
        rect(im, x_, y_ - 2, x_ + 1, y_, BLACK); px(im, x_ + 1, y_ - 1, ORANGE)
    flag_anim(im, 26, 30, RED, frame); flag_anim(im, 26, 56, BLUE, frame + 1)
    # signal boxes and semaphores at the platform ends (west side of the line)
    signal_box(im, 21, 0)
    signal_box(im, 21, 85)
    north, south = SIGNALS[frame % FRAMES]
    semaphore(im, 30, 22, north, facing=1)
    semaphore(im, 30, 94, south, facing=1)
    S.people(im, (27, 9, 32, 86), 16 + (frame % 4), 53 + frame // 4, on=(LIGHT, WHITE))
    return im


def save_all():
    import json
    for key, f, (w, h) in (('hall_ew', hall_ew, (6, 3)), ('hall_ns', hall_ns, (3, 6))):
        frames = [f(i) for i in range(FRAMES)]
        for im in frames:
            bad = {im.getpixel((x, y)) for y in range(im.height) for x in range(im.width)} - set(PALETTE)
            assert not bad, f'{key}: off-palette {list(bad)[:4]}'
        frames[0].save(os.path.join(HERE, f'{key}.png'))
        frames[0].resize((frames[0].width * 4, frames[0].height * 4), Image.NEAREST).save(os.path.join(HERE, f'{key}@4x.png'))
        # animation sheet: frames side by side (what the game would load), plus a 4x GIF preview
        sheet = Image.new('RGB', (frames[0].width * FRAMES, frames[0].height))
        for i, im in enumerate(frames): sheet.paste(im, (i * im.width, 0))
        sheet.save(os.path.join(HERE, f'{key}_frames.png'))
        big = [im.resize((im.width * 4, im.height * 4), Image.NEAREST) for im in frames]
        big[0].save(os.path.join(HERE, f'{key}@4x.gif'), save_all=True, append_images=big[1:], duration=500, loop=0, disposal=1)
        meta = json.load(open(os.path.join(HERE, 'meta.json')))
        meta[key] = {'name': 'Grand Central (single track)', 'w': w, 'h': h, 'orient': key[-2:], 'tracks': '1 platform track', 'frames': FRAMES}
        json.dump(meta, open(os.path.join(HERE, 'meta.json'), 'w'), indent=2)
        print(key, frames[0].size, FRAMES, 'frames')


if __name__ == '__main__':
    save_all()
