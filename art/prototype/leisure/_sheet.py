"""Compose all leisure prototypes at 3x on a dark background with their names underneath -> _sheet.png"""
import json, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROWS = [['amusement_park', 'zoo', 'golf_course'],
        ['botanical_garden', 'marina', 'lighthouse', 'train_station', 'bus_depot', 'farm']]
S, GAP, LABEL, BG = 3, 16, 14, (0x1e, 0x1e, 0x28)
meta = json.load(open(os.path.join(HERE, 'meta.json')))
font = ImageFont.load_default()

def row_size(row):
    ims = [Image.open(os.path.join(HERE, f'{s}.png')) for s in row]
    return ims, sum(i.width * S for i in ims) + GAP * (len(ims) + 1), max(i.height * S for i in ims) + LABEL + GAP

rows = [row_size(r) for r in ROWS]
W = max(w for _, w, _ in rows); H = sum(h for _, _, h in rows) + GAP
sheet = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(sheet)
y = GAP
for (ims, w, h), slugs in zip(rows, ROWS):
    x = GAP + (W - w) // 2
    for im, slug in zip(ims, slugs):
        big = im.resize((im.width * S, im.height * S), Image.NEAREST)
        sheet.paste(big, (x, y))
        name = f"{meta[slug]['name']} ({meta[slug]['tiles']}x{meta[slug]['tiles']})"
        tw = d.textlength(name, font=font)
        d.text((x + (big.width - tw) / 2, y + big.height + 3), name, fill=(220, 220, 220), font=font)
        x += big.width + GAP
    y += h
sheet.save(os.path.join(HERE, '_sheet.png'))
print('wrote', os.path.join(HERE, '_sheet.png'), sheet.size)
