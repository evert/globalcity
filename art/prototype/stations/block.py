"""The single-track Grand Central placed in a city block built from real Micropolis tiles (shops, offices,
houses, a church and hospital, industry, roads, a rail line with level crossings, parks) plus the other new
GlobalCity buildings (City Hall, the school), to judge whether the styles sit together at game scale."""
import os, json
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../../..'))
SHEET = Image.open(os.path.join(ROOT, 'art/sheet/micropolis-tiles-original.png')).convert('RGB')
SPR = Image.open(os.path.join(ROOT, 'client/public/assets/micropolis/sprites.png')).convert('RGBA')
SPRJ = json.load(open(os.path.join(ROOT, 'client/public/assets/micropolis/sprites.json')))
T = 16
ROADS, ROADS2 = 66, 67
ROAD_TABLE = [66, 67, 66, 68, 67, 67, 69, 73, 66, 71, 66, 72, 70, 75, 74, 76]   # ROADS..INTERSECTION by N/E/S/W mask
RAIL_TABLE = [226, 227, 226, 228, 227, 227, 229, 233, 226, 231, 226, 232, 230, 235, 234, 236]
HRAILROAD, VRAILROAD = 237, 238
RZB, CZB, IZB, HOSPITAL, CHURCH = 265, 436, 625, 409, 418
HOUSES = list(range(249, 261))
WOODS2 = [40, 41, 42, 43]
FOUNTAIN = 840


def tile(t):
    return SHEET.crop(((t % 16) * T, (t // 16) * T, (t % 16) * T + T, (t // 16) * T + T))


def main(frame=1, out='block', hall='hall_ew_frames.png', city_hall='city_hall.png'):
    W, H = 24, 15
    grid = [[0] * W for _ in range(H)]
    roads, rails = set(), set()
    # roads: three east-west streets and two north-south avenues
    for x in range(W):
        roads.add((x, 0)); roads.add((x, 5)); roads.add((x, 13))
    for y in range(H):
        roads.add((4, y)); roads.add((19, y))
    # the rail line on row 8, running through the station (cols 9..14 belong to the station)
    for x in range(W):
        if not 9 <= x <= 14: rails.add((x, 8))
    for (x, y) in list(roads):
        if (x, y) in rails: rails.discard((x, y))
    crossings = {(4, 8), (19, 8)}
    for c in crossings: roads.discard(c)

    def isroad(x, y): return (x, y) in roads or (x, y) in crossings and False
    def israil(x, y): return (x, y) in rails or (9 <= x <= 14 and y == 8) or (x, y) in crossings
    for (x, y) in roads:
        m = 0
        if (x, y - 1) in roads or (x, y - 1) in crossings: m |= 1
        if (x + 1, y) in roads: m |= 2
        if (x, y + 1) in roads or (x, y + 1) in crossings: m |= 4
        if (x - 1, y) in roads: m |= 8
        grid[y][x] = ROAD_TABLE[m]
    for (x, y) in rails:
        m = 0
        if israil(x, y - 1): m |= 1
        if israil(x + 1, y): m |= 2
        if israil(x, y + 1): m |= 4
        if israil(x - 1, y): m |= 8
        grid[y][x] = RAIL_TABLE[m]
    for (x, y) in crossings: grid[y][x] = VRAILROAD   # north-south road over the east-west line

    def zone(centre, col, row):
        base = centre - 4
        for k in range(9):
            dy, dx = divmod(k, 3)
            grid[row + dy][col + dx] = base + k

    # north blocks (rows 1..4): offices and shops, City Hall on the station's axis, the school
    zone(CZB + 9 * 15, 0, 2); zone(CZB + 9 * 11, 5, 2)
    zone(CZB + 9 * 19, 15, 2)
    zone(CZB + 9 * 18, 20, 2)
    for x, t in [(0, 249), (1, 252), (2, 255), (3, 258), (5, 250), (6, 253), (7, 41), (8, 40), (14, 42), (15, 254), (16, 257), (17, 40), (18, 43), (20, 251), (21, 256), (22, 41), (23, 259)]:
        grid[1][x] = t
    # beside the station (rows 6..7): park with a fountain to the west, houses to the east
    for x in range(5, 9):
        for y in (6, 7): grid[y][x] = WOODS2[(x + y) % 4]
    grid[6][6] = FOUNTAIN
    for x in range(0, 4):
        for y in (6, 7): grid[y][x] = HOUSES[(x * 3 + y) % 12]
    for x in range(15, 19):
        for y in (6, 7): grid[y][x] = HOUSES[(x * 5 + y * 2) % 12]
    for x in range(20, 24):
        for y in (6, 7): grid[y][x] = WOODS2[(x + y + 1) % 4]
    # south of the line (rows 9..12): homes, a church, a hospital, industry to the east by the tracks
    for x in range(W):
        if (x, 9) not in roads: grid[9][x] = WOODS2[x % 4] if x % 3 else 0
    zone(RZB + 9 * 13, 0, 10); zone(CHURCH, 5, 10); zone(RZB + 9 * 15, 8, 10); zone(HOSPITAL, 11, 10)
    zone(RZB + 9 * 10, 14, 10); zone(IZB + 9 * 6, 20, 10)
    grid[10][17] = HOUSES[2]; grid[11][17] = HOUSES[7]; grid[12][17] = 41; grid[10][18] = 40; grid[11][18] = HOUSES[9]; grid[12][18] = HOUSES[4]
    for x, t in [(0, 251), (1, 254), (2, 40), (3, 258), (5, 41), (6, 252), (7, 255), (8, 249), (9, 42), (10, 253), (11, 256), (12, 41), (14, 250), (15, 257), (16, 40), (17, 259), (18, 43), (20, 40), (21, 41), (22, 42), (23, 43)]:
        grid[14][x] = t

    im = Image.new('RGB', (W * T, H * T))
    for y in range(H):
        for x in range(W): im.paste(tile(grid[y][x]), (x * T, y * T))
    # GlobalCity buildings: City Hall 4x4 (cols 10..13, rows 1..4), school 3x3 (cols 0..2 would clash) at 9..? -> rows 2..4 col 20? keep it beside City Hall
    ch = Image.open(os.path.join(ROOT, 'art/prototype/civic', city_hall)).convert('RGB')
    im.paste(ch, (10 * T, 1 * T))
    sc = Image.open(os.path.join(ROOT, 'art/prototype/civic/school.png')).convert('RGB')
    for y in range(1, 5):
        for x in (14,):
            im.paste(tile(WOODS2[y % 4]), (x * T, y * T))
    grid_school = (5, 2)  # replaces the shops at cols 5..7
    im.paste(sc, (grid_school[0] * T, grid_school[1] * T))
    for x in (8, 9):
        for y in range(1, 5): im.paste(tile(WOODS2[(x + y) % 4]), (x * T, y * T))
    # the station (animation frame `frame`), rows 6..8, cols 9..14
    frames = Image.open(os.path.join(HERE, hall)).convert('RGB')
    fw = frames.width // 8
    im.paste(frames.crop((frame * fw, 0, (frame + 1) * fw, frames.height)), (9 * T, 6 * T))
    rgba = im.convert('RGBA')
    f = SPRJ['train']['frames'][1]
    rgba.alpha_composite(SPR.crop((f['x'], f['y'], f['x'] + 32, f['y'] + 32)), (5 * T, 8 * T - 8))
    out_im = rgba.convert('RGB')
    out_im.save(os.path.join(HERE, f'{out}.png'))
    out_im.resize((out_im.width * 2, out_im.height * 2), Image.NEAREST).save(os.path.join(HERE, f'{out}@2x.png'))
    return out_im


if __name__ == '__main__':
    import sys
    v2 = len(sys.argv) > 1 and sys.argv[1] == 'v2'
    kw = dict(hall='hall_ew_v2_frames.png', city_hall='city_hall_v3.png') if v2 else {}
    frames = [main(i, f'block_f{i}', **kw) for i in range(8)]
    big = [f.resize((f.width * 2, f.height * 2), Image.NEAREST) for f in frames]
    big[0].save(os.path.join(HERE, 'block_v2@2x.gif' if v2 else 'block@2x.gif'), save_all=True, append_images=big[1:], duration=500, loop=0)
    for i in range(8):
        os.remove(os.path.join(HERE, f'block_f{i}.png'))
        if i != 1: os.remove(os.path.join(HERE, f'block_f{i}@2x.png'))
    os.replace(os.path.join(HERE, 'block_f1@2x.png'), os.path.join(HERE, 'block_v2@2x.png' if v2 else 'block@2x.png'))
    print('ok', frames[0].size)
