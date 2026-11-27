# The world format

A world is a directory of files. The server plays on the one in `WORLD_DIR` (relative to the repo root; default
`data/world-16384x8192`, the generated Earth). Three things write this format:

- the world generator, `npm run gen:world` (`tools/src/gen-world.ts`), which makes the Earth;
- the gameplay tests' fixture world (`server/test/support/fixture.ts`), 1024 x 512 tiles built in code;
- any custom world, as long as it follows this page.

## Geometry

- The world is a grid of `w` x `h` tiles, row-major, `y * w + x`. Both sides must be multiples of 256 (a region of
  the zoomed-out map). 64 x 64 tiles make a chunk, which is also a plot: a world has `w/64` x `h/64` of them.
- It is drawn as a planet in equirectangular projection: x runs from longitude -180 to 180, y from latitude 90 at the
  top to -90 at the bottom, whatever the size. That is where day and night fall (the real sun, by the real clock).
  The world wraps east to west at the date line: planes, ships and Santa take the short way round. A world twice as
  wide as it is high has square tiles on that planet; the corner minimap is drawn 2:1.
- The size comes from `base.json`. The server sets the game up for it at boot and sends it to every client in the
  welcome; a save is stamped with it (`world.txt`, `<w>x<h>`) and is never loaded into a world of another size.

## Files

| file            | size              | required | what                                                                 |
| --------------- | ----------------- | -------- | -------------------------------------------------------------------- |
| `base.json`     | small             | yes      | the world's description, below                                       |
| `base.bin`      | `w * h` bytes     | yes      | the landscape, a byte per tile, below                                |
| `elevation.bin` | `w * h * 2` bytes | no       | Int16 little-endian per tile: metres above sea level, negative below |
| `hazards.bin`   | `w/64 * h/64`     | no       | a byte per chunk, row-major: bit `d` set = `Disaster` `d` can strike |
| `places.json`   | any               | no       | populated places, to name cities after                               |
| `preview.png`   | any               | no       | the generator's preview picture; the game doesn't read it            |

Without `base.bin` the server makes up a noise world (handy for a quick look, not for play). Without
`elevation.bin` elevation is 0 everywhere (floods then rise anywhere by the water); without `hazards.bin` no
disasters strike; without `places.json` new cities are called "Settlement cx,cy". A file of the wrong size stops
the server at boot.

### base.json

```json
{
  "w": 16384,
  "h": 8192,
  "version": 2,
  "generatedAt": "2026-11-26T20:06:24.028Z"
}
```

- `w`, `h`: the size in tiles. A world without them is taken to be 16384 x 8192 (the generated Earth).
- `generatedAt`: any string that changes whenever the landscape does. It names the world to clients: the zoomed-out
  map images of untouched land are cached by it.
- `version`: the `base.bin` layout, 2.
- Anything else is for people: the generator records its sources and the layout, the fixture its named sites.

### base.bin

One byte per tile (`shared/src/terrain.ts`). It never changes after generation: the game builds its tiles from it at
boot, and it decides each tile's look, whether water is frozen, and what grows back on rubble.

| bits   | meaning                                                                                  |
| ------ | ---------------------------------------------------------------------------------------- |
| 0-3    | biome: 0 temperate, 1 desert, 2 steppe, 3 tundra, 4 boreal, 5 snow (ice sheet)           |
| `0x20` | trees (land only)                                                                        |
| `0x40` | frozen (water only): ice for half the year or more; ships can't cross it, no ports on it |
| `0x80` | water                                                                                    |

Water tiles carry the biome of the land next to them, so their shores draw that ground.

### hazards.bin

A byte per chunk, row-major (`cy * w/64 + cx`), bit `1 << d` for each `Disaster` `d` (`shared/src/disasters.ts`:
0 earthquake, 1 flood, 2 tornado, 3 storm, 4 wildfire, 5 blizzard) that can strike a city there. Floods also need
low land by the water in `elevation.bin` (10 m or less).

### places.json

```json
{ "generatedAt": "...", "source": "...", "places": [["London", 8186, 1751, 9000000, "United Kingdom"], ...] }
```

`places` is `[name, x, y, population, country]` with x and y in tiles, sorted by population, largest first. A new
city takes the name of a big place nearby (within 160 tiles; otherwise the nearest), made unique.
