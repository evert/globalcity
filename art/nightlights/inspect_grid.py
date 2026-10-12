# Zoomed building views with a pixel grid and coordinates, current lights marked. Usage: inspect_grid.py out.png CODE...
import sys
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from common import *
import lights as L
Z = 10
font = ImageFont.load_default()
def view(code):
    day, lit = L.render_building(code)
    W, H = day.size
    im = day.resize((W * Z, H * Z), Image.NEAREST).convert('RGB')
    pad = 24
    out = Image.new('RGB', (W * Z + pad, H * Z + pad + 16), (30, 30, 30))
    out.paste(im, (pad, pad + 16))
    d = ImageDraw.Draw(out)
    d.text((2, 2), code, fill=(255, 255, 255), font=font)
    for x in range(W + 1):
        col = (255, 255, 255) if x % 16 == 0 else (90, 90, 90) if x % 4 == 0 else (55, 55, 55)
        d.line([(pad + x * Z, pad + 16), (pad + x * Z, pad + 16 + H * Z)], fill=col, width=1)
        if x % 4 == 0 and x < W: d.text((pad + x * Z + 1, pad + 4), str(x), fill=(220, 220, 220), font=font)
    for y in range(H + 1):
        col = (255, 255, 255) if y % 16 == 0 else (90, 90, 90) if y % 4 == 0 else (55, 55, 55)
        d.line([(pad, pad + 16 + y * Z), (pad + W * Z, pad + 16 + y * Z)], fill=col, width=1)
        if y % 4 == 0 and y < H: d.text((2, pad + 16 + y * Z + 1), str(y), fill=(220, 220, 220), font=font)
    for (x, y), (c, a) in lit.items():
        x0, y0 = pad + x * Z, pad + 16 + y * Z
        d.rectangle([x0 + 2, y0 + 2, x0 + Z - 2, y0 + Z - 2], outline=(255, 0, 255) if a == 255 else (0, 255, 255), width=2)
    return out
ims = [view(c) for c in sys.argv[2:]]
W = sum(i.width for i in ims) + 8 * (len(ims) - 1); H = max(i.height for i in ims)
o = Image.new('RGB', (W, H), (0, 0, 0)); x = 0
for i in ims: o.paste(i, (x, 0)); x += i.width + 8
o.save(sys.argv[1])
