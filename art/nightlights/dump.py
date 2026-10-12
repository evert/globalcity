# Text dump of a building's pixels (one letter per colour), lights in upper case brackets. Usage: dump.py CODE [x0 y0 x1 y1]
import sys
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from common import *
import lights as L
CH = {0x000000: 'K', 0x3f3f3f: 'd', 0x7f7f7f: 'g', 0xbfbfbf: 'l', 0xffffff: 'W', 0x0000e6: 'B', 0x6666e6: 'b', 0xff0000: 'R',
      0x00e600: 'G', 0x007f00: 'v', 0x997f4c: 't', 0xcc7f66: '.', 0xffff00: 'Y', 0xff7f00: 'o'}
day, lit = L.render_building(sys.argv[1])
x0, y0, x1, y1 = (int(a) for a in sys.argv[2:6]) if len(sys.argv) > 2 else (0, 0, day.width - 1, day.height - 1)
p = day.load()
print('    ' + ''.join(str(x // 10 % 10) if x % 10 == 0 else ' ' for x in range(x0, x1 + 1)))
print('    ' + ''.join(str(x % 10) for x in range(x0, x1 + 1)))
for y in range(y0, y1 + 1):
    row = ''
    for x in range(x0, x1 + 1):
        c = CH.get(pix(p, x, y), '?')
        row += '*' if (x, y) in lit and lit[(x, y)][1] == 255 else ('~' if (x, y) in lit else c)
    print(f'{y:3d} {row}')
