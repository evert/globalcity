"""Compose each station prototype into a strip of world built from the real Micropolis tiles: rail lines run
in from both ends (one with a curve), plus a road and a train sprite, to check the joins at 1:1 tile scale."""
import os, json
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../../..'))
SHEET = Image.open(os.path.join(ROOT, 'art/sheet/micropolis-tiles-original.png')).convert('RGB')
SPR = Image.open(os.path.join(ROOT, 'client/public/assets/micropolis/sprites.png')).convert('RGBA')
SPRJ = json.load(open(os.path.join(ROOT, 'client/public/assets/micropolis/sprites.json')))
T = 16
DIRT_T, LHRAIL, LVRAIL = 0, 226, 227
RAIL_TABLE = [226, 227, 226, 228, 227, 227, 229, 233, 226, 231, 226, 232, 230, 235, 234, 236]
ROADH, ROADV = 66, 67


def tile(t):
    return SHEET.crop(((t % 16) * T, (t // 16) * T, (t % 16) * T + T, (t // 16) * T + T))


def train(frame):
    f = SPRJ['train']['frames'][frame]
    return SPR.crop((f['x'], f['y'], f['x'] + 32, f['y'] + 32))


def scene(key, meta):
    st = Image.open(os.path.join(HERE, f'{key}.png')).convert('RGB')
    w, h, ew = meta['w'], meta['h'], meta['orient'] == 'ew'
    pad = 4
    W, H = (w + pad * 2, h + 3) if ew else (w + 3, h + pad * 2)
    grid = [[DIRT_T] * W for _ in range(H)]
    ox, oy = (pad, 1) if ew else (1, pad)
    rails = set()
    main = {'halt': h - 1, 'station': 2, 'grand': 3, 'hall': 2}[key.split('_')[0]]  # the row/column the line runs on
    if ew:
        rows = [main]
        for r in rows:
            for x in range(0, ox): rails.add((x, oy + r))
            for x in range(ox + w, W): rails.add((x, oy + r))
        # bottom track curves south on the east side and joins a north-south line
        r = rows[-1]
        for x in range(ox + w + 2, W): rails.discard((x, oy + r))
        for y in range(oy + r, H): rails.add((ox + w + 1, y))
        for x in range(0, W): grid[0][x] = ROADH
    else:
        cols = [main]
        for c in cols:
            for y in range(0, oy): rails.add((ox + c, y))
            for y in range(oy + h, H): rails.add((ox + c, y))
        c = cols[-1]
        for y in range(oy + h + 2, H): rails.discard((ox + c, y))
        for x in range(ox + c, W): rails.add((x, oy + h + 1))
        for y in range(0, H): grid[y][0] = ROADV
    for (x, y) in rails:
        m = 0
        def at(xx, yy):
            if (xx, yy) in rails: return True
            # the station's track ends count as rail neighbours
            return ox <= xx < ox + w and oy <= yy < oy + h and (
                (ew and yy - oy in rows) or (not ew and xx - ox in cols))
        if at(x, y - 1): m |= 1
        if at(x + 1, y): m |= 2
        if at(x, y + 1): m |= 4
        if at(x - 1, y): m |= 8
        grid[y][x] = RAIL_TABLE[m]
    im = Image.new('RGB', (W * T, H * T))
    for y in range(H):
        for x in range(W): im.paste(tile(grid[y][x]), (x * T, y * T))
    im.paste(st, (ox * T, oy * T))
    rgba = im.convert('RGBA')
    # a train arriving on the first track, just outside the station
    if ew:
        tx, ty = (ox - 2) * T, (oy + rows[0]) * T - 8
        rgba.alpha_composite(train(1), (tx, ty))
    else:
        tx, ty = (ox + cols[0]) * T - 8, (oy - 2) * T
        rgba.alpha_composite(train(0), (tx, ty))
    out = rgba.convert('RGB')
    out.resize((out.width * 3, out.height * 3), Image.NEAREST).save(os.path.join(HERE, f'{key}_scene@3x.png'))
    return out.size


if __name__ == '__main__':
    meta = json.load(open(os.path.join(HERE, 'meta.json')))
    for key, m in meta.items(): print(key, scene(key, m))
