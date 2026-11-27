"""Santa's sleigh: Santa in a red sleigh full of presents, pulled by two reindeer, flying west (64x32 px).

Generated with the sprite-ai MCP (sleigh_ai.png, generation bf11bfc6-15a5-4dcd-af1d-446dc65ce121) and mapped here
onto the 14 Micropolis colours. The lead reindeer's nose is made red: at night the game draws a glow on it
(SLEIGH_NOSE in shared/src/santa.ts must match the position printed here).

Run: python3 art/prototype/seasonal/sleigh.py   (writes sleigh.png, sleigh@4x.png and the game copy
client/public/assets/vehicles/sleigh.png)
"""
import os, sys, shutil
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
from pixlib import *  # noqa: F401,F403

MAP = {0x272524: BLACK, 0x2d2b2b: DARK,                                   # harness, runners, outlines
       0x764f34: SAND, 0x7c553a: SAND, 0x845b41: DIRT, 0x5a3519: DARK,    # reindeer
       0x8b0f17: RED, 0xc61d29: RED, 0xf81c37: RED,                       # sleigh, Santa's coat
       0xedb33b: YELLOW, 0xfdf45a: YELLOW,                                 # gold trim, star
       0xeecfbe: WHITE, 0xfbfbfa: WHITE, 0xef8375: ORANGE,                # beard, fur, face, cheeks
       0x115928: FOREST, 0x44955a: GRASS}                                  # the little tree in the sack
src = Image.open(os.path.join(HERE, 'sleigh_ai.png')).convert('RGBA')
W, H = src.size
im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
for y in range(H):
    for x in range(W):
        r, g, b, a = src.getpixel((x, y))
        if a: im.putpixel((x, y), (*MAP[(r << 16) | (g << 8) | b], 255))
# the sleigh's dark red shading: the lower half of the body in the darker shade Micropolis has for red, DARK
for y in range(H):
    for x in range(W):
        r, g, b, a = src.getpixel((x, y))
        if a and (r << 16 | g << 8 | b) == 0x8b0f17: im.putpixel((x, y), (*DARK, 255)) if y > 20 else None
# Rudolph: the lead reindeer's nose is the frontmost pixel of its head
nose = min(((x, y) for y in range(10, 20) for x in range(W) if im.getpixel((x, y))[3]), key=lambda p: (p[0], p[1]))
im.putpixel(nose, (*RED, 255))
im.save(os.path.join(HERE, 'sleigh.png'))
im.resize((W * 4, H * 4), Image.NEAREST).save(os.path.join(HERE, 'sleigh@4x.png'))
shutil.copy(os.path.join(HERE, 'sleigh.png'), os.path.join(HERE, '..', '..', '..', 'client', 'public', 'assets', 'vehicles', 'sleigh.png'))
print(f'wrote sleigh.png ({W}x{H}); nose at {nose}')
