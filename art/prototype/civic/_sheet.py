"""Compose all civic prototypes at 3x on a dark background with names underneath -> _sheet.png"""
import json, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ORDER = ['city_hall', 'university', 'library', 'museum', 'school', 'cathedral', 'observatory', 'tv_tower', 'prison']
meta = json.load(open(os.path.join(HERE, 'meta.json')))
S, PAD, LABEL, COLS = 3, 16, 26, 5
font = ImageFont.load_default()
cell_w = 64 * S + PAD
row_h = 64 * S + LABEL + PAD
rows = (len(ORDER) + COLS - 1) // COLS
sheet = Image.new('RGB', (PAD + COLS * cell_w, PAD + rows * row_h), (30, 30, 40))
d = ImageDraw.Draw(sheet)
for i, slug in enumerate(ORDER):
    im = Image.open(os.path.join(HERE, f'{slug}.png')).convert('RGB')
    big = im.resize((im.width * S, im.height * S), Image.NEAREST)
    cx = PAD + (i % COLS) * cell_w
    cy = PAD + (i // COLS) * row_h
    ox = cx + (64 * S - big.width) // 2
    oy = cy + (64 * S - big.height)          # bottom-align so labels line up
    sheet.paste(big, (ox, oy))
    m = meta.get(slug, {})
    name = f"{m.get('name', slug)} ({m.get('tiles', im.width // 16)}x{m.get('tiles', im.width // 16)})"
    tw = d.textlength(name, font=font)
    d.text((cx + (64 * S - tw) / 2, cy + 64 * S + 6), name, fill=(220, 220, 220), font=font)
sheet.save(os.path.join(HERE, '_sheet.png'))
print('wrote', os.path.join(HERE, '_sheet.png'), sheet.size)
