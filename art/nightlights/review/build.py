# Builds the night lights review page: every building's day art, its night look as the game draws it, and the
# authored lights. Usage: build.py out.html [round]  (comments of earlier rounds are passed in notes.json if present)
import base64, io, json, math, os, sys
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import *
import lights as L
S = 4
HALO_R, HALO_ALPHA = 3, 0.22
halo = [[max(0.0, HALO_ALPHA * (1 - math.hypot(x - HALO_R, y - HALO_R) / (HALO_R + 0.5))) for x in range(2 * HALO_R + 1)] for y in range(2 * HALO_R + 1)]

def compose(day, lit):
    W, H = day.size
    dp = day.load()
    base = Image.new('RGB', (W, H)); bp = base.load()
    for y in range(H):
        for x in range(W):
            c = dp[x, y]; bp[x, y] = tuple(int(c[i] * 0.52 + (6, 10, 34)[i] * 0.48) for i in range(3))
    ga = [[0.0] * W for _ in range(H)]; gc = [[(0, 0, 0)] * W for _ in range(H)]
    for (x, y), (c, a) in lit.items():
        if a < 255: continue
        for yy in range(2 * HALO_R + 1):
            for xx in range(2 * HALO_R + 1):
                gx, gy = x - HALO_R + xx, y - HALO_R + yy
                if 0 <= gx < W and 0 <= gy < H and halo[yy][xx] > ga[gy][gx]: ga[gy][gx] = halo[yy][xx]; gc[gy][gx] = c
    glow = Image.new('RGBA', (W, H)); gp = glow.load()
    for y in range(H):
        for x in range(W): gp[x, y] = (*gc[y][x], int(round(ga[y][x] * 255)))
    night = base.resize((W * S, H * S), Image.NEAREST).convert('RGBA')
    night.alpha_composite(glow.resize((W * S, H * S), Image.BILINEAR))
    lights = Image.new('RGBA', (W, H)); lp = lights.load()
    for (x, y), (c, a) in lit.items(): lp[x, y] = (*c, a)
    night.alpha_composite(lights.resize((W * S, H * S), Image.NEAREST))
    return day.resize((W * S, H * S), Image.NEAREST), night.convert('RGB')

def b64(im):
    buf = io.BytesIO(); im.save(buf, 'PNG', optimize=True); return base64.b64encode(buf.getvalue()).decode()

prev = json.load(open(os.path.join(HERE, 'notes.json'))) if os.path.exists(os.path.join(HERE, 'notes.json')) else {}
items = []
for (code, name, group, base, n, colour) in BUILDINGS:
    items.append((code, name, group, f'{n}×{n}'))
for (code, name, kind, frames) in CUSTOMS:
    items.append((code, name, 'Civic', 'custom'))
out = []
for (code, name, group, size) in items:
    day, lit = L.render_building(code)
    d, nt = compose(day, lit)
    out.append(dict(code=code, name=name, group=group, size=size, lights=sum(1 for v in lit.values() if v[1] == 255),
                    approved=code in L.APPROVED, prev=prev.get(code, ''), day=b64(d), night=b64(nt)))
rnd = sys.argv[2] if len(sys.argv) > 2 else '2'
t = open(os.path.join(HERE, 'template.html')).read()
html = t.replace('__DATA__', json.dumps(out).replace('</', '<\\/')).replace('__ROUND__', rnd)
open(sys.argv[1], 'w').write(html)
print(len(out), 'buildings,', sum(1 for o in out if o['approved']), 'approved')
