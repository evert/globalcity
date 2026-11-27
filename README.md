# GlobalCity

A massively multiplayer, browser-based city builder in the style of SimCity Classic,
played on a single tile map of the whole Earth. Everyone shares one world. You find
your spot (optionally from your browser's geolocation), claim a 64x64-tile plot, and
start zoning, wiring and paving. Neighbours see each other's cities grow in real time.

The artwork and tile semantics come from **Micropolis**, the GPLv3 release of the original
SimCity Classic, designed by Will Wright and published by Maxis in 1989, open-sourced by
Electronic Arts in 2008 through the work of Don Hopkins. See [ATTRIBUTION.md](ATTRIBUTION.md).
SimCity is a trademark of Electronic Arts; this project is not affiliated with EA or Maxis.

## How it works

- The world is a 16384 x 8192 tile grid in equirectangular projection (about 2.4 km per
  tile at the equator). Coastlines, lakes, major rivers, glaciers and ice shelves come from
  Natural Earth; biomes (desert, steppe, tundra, snowy boreal forest, ice sheets) from the
  Beck et al. Koppen-Geiger climate map; forests from 1 km satellite tree cover; frozen seas
  from 10 years of NSIDC sea ice (frozen where there was ice at least half of the time).
  Frozen water is still water, but ships can't cross it.
- Natural disasters (earthquake, flood, tornado, tropical storm, wildfire, blizzard) strike only
  where they happen on Earth: the generator writes a hazard byte per chunk (hazards.bin) from plate
  boundaries, elevation (elevation.bin, metres per tile, from ETOPO 2022), climate and storm and
  tornado regions. A disaster strikes about every 15 minutes in the whole world, always a city whose
  mayor is online, and everyone playing is told (shared/src/disasters.ts, server/src/disasters.ts).
- Tiles are 32 bits: Micropolis' 16 (tile kind + flags) plus a look (shared/src/looks.ts): the
  biome the tile is drawn in, frozen water, or a transition at a biome border or an ice edge.
  The server stamps the look from the place; `npm run gen:sheet -w tools` bakes skins.png, the
  sheet of every tile in every look (the Micropolis art in other colours, shared/src/biomeart.ts).
- The grid is split into 64 x 64 tile chunks. A chunk is the unit players claim and the
  unit the client streams. Your first claim is free; each further plot costs more than the last
  ($25,000 for the second, rising 1.75x per plot, 15 plots max) and must touch a chunk you already own.
- A Node server holds the world in memory (one `Uint32Array`, Micropolis tile encoding plus looks),
  runs a simplified Micropolis simulation for every active city once per game month
  (5 seconds), and pushes tile deltas over WebSockets to clients subscribed to those chunks.
- Persistence is plain files under `data/save/` (edited chunks + players/claims JSON),
  flushed every 10 seconds and on shutdown. A save is stamped with its world size
  (`world.txt`) and the server refuses to load it into a world of another size.
- The client is Vite + vanilla TypeScript + Canvas 2D. Zoomed in you see Micropolis tiles.
  Zoomed out you see map images the server renders (`/map/...`, a 7-level pyramid of
  256 x 256 palette PNGs with versioned, cacheable URLs; see shared/src/maptiles.ts), so
  the client only fetches and draws what is on screen at the detail the zoom needs.

## Running it

Requires Node 22+ (24 recommended).

```sh
npm install
bash tools/fetch-terrain-data.sh   # climate, tree cover, elevation, sea ice, plates (~640 MB, one-off, from our terrain-data-v2 release mirror)
npm run gen:world      # downloads Natural Earth data and rasterises the world (one-off, ~2 min)
npm run dev            # server on :8787, Vite client on :5173 (proxies /ws)
```

Open http://localhost:5173.

Production: `npm run build && npm start` serves the built client and the WebSocket
endpoint from the same port (`PORT`, default 8787). The server is a single long-lived
process with in-memory state, so run it on a VM or container, not on a serverless platform.

Server environment variables: `PORT`, `HOST`, `DATA_DIR` (save directory relative to the repo
root, default `data/save`), `TICK_MS` (game-month length, default 5000) and `DEV_HOOKS=1`, which
is for tests only: it accepts non-protocol socket messages (start a fire, grant money, ...) and turns
random fire outbreaks off.

Tests live in `server/test/`. `npm test` runs them all, each against its own throwaway server
(fresh save dir, fast clock, the settings that test needs); `npm test -- water social` runs a few.
They play on the generated world, so run `npm run gen:world` first. CI (`.github/workflows/ci.yml`)
typechecks, builds the client, generates the world (cached) and runs the tests.

Ready-made recipes: a Raspberry Pi behind a Cloudflare Tunnel in [deploy/pi/README.md](deploy/pi/README.md),
or an Oracle Cloud Always Free VM with Caddy TLS in [deploy/oracle/README.md](deploy/oracle/README.md).

## Layout

```
shared/   constants, Micropolis tile ids/tables, tool defs, wire protocol (shared by all)
server/   world state, simulation, WebSocket server, persistence
client/   canvas renderer, input, UI, networking
tools/    gen-world: Natural Earth + climate/tree cover/sea ice rasters -> data/world-<W>x<H>/base.bin (run tools/fetch-terrain-data.sh first)
data/     generated world + save data (git-ignored)
LICENSES/ GPL-3.0 and the Micropolis additional terms
```

## License

GPL-3.0-or-later. See [LICENSE](LICENSE) and [LICENSES/](LICENSES/).
