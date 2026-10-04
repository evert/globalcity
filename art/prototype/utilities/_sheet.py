"""Compose all 'utilities' prototypes at 3x on a dark background with their names underneath."""
import json, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ORDER = ['wind_farm', 'solar_farm', 'hydro_dam', 'water_tower', 'water_treatment', 'landfill',
         'recycling_center', 'data_center', 'space_center']
meta = json.load(open(os.path.join(HERE, 'meta.json')))
S, PAD, LABEL, COLS = 3, 16, 26, 5
cell = 64 * S
rows = (len(ORDER) + COLS - 1) // COLS
sheet = Image.new('RGB', (PAD + COLS * (cell + PAD), PAD + rows * (cell + LABEL + PAD)), (0x1e, 0x1e, 0x28))
d = ImageDraw.Draw(sheet)
font = ImageFont.load_default()
for i, slug in enumerate(ORDER):
    im = Image.open(os.path.join(HERE, f'{slug}.png')).convert('RGB')
    big = im.resize((im.width * S, im.height * S), Image.NEAREST)
    cx = PAD + (i % COLS) * (cell + PAD)
    cy = PAD + (i // COLS) * (cell + LABEL + PAD)
    ox, oy = cx + (cell - big.width) // 2, cy + (cell - big.height)        # bottom-align 3x3 with 4x4
    sheet.paste(big, (ox, oy))
    m = meta.get(slug, {})
    d.text((cx, cy + cell + 4), m.get('name', slug), fill=(0xff, 0xff, 0xff), font=font)
    d.text((cx, cy + cell + 15), f"{m.get('tiles', '?')}x{m.get('tiles', '?')}  {m.get('zone', '')}", fill=(0xbf, 0xbf, 0xbf), font=font)
sheet.save(os.path.join(HERE, '_sheet.png'))
print('saved', os.path.join(HERE, '_sheet.png'), sheet.size)
