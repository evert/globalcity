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

- The world is an 8192 x 4096 tile grid in equirectangular projection (about 5 km per
  tile at the equator). Coastlines, lakes and major rivers come from Natural Earth,
  forests from deterministic noise.
- The grid is split into 64 x 64 tile chunks. A chunk is the unit players claim and the
  unit the client streams. Your first claim is free; each further plot costs more than the last
  ($25,000 for the second, rising 1.75x per plot, 10 plots max) and must touch a chunk you already own.
- A Node server holds the world in memory (one `Uint16Array`, Micropolis tile encoding),
  runs a simplified Micropolis simulation for every active city once per game month
  (5 seconds), and pushes tile deltas over WebSockets to clients subscribed to those chunks.
- Persistence is plain files under `data/save/` (edited chunks + players/claims JSON),
  flushed every 10 seconds and on shutdown.
- The client is Vite + vanilla TypeScript + Canvas 2D. Zoomed out you see the Earth with
  every claimed plot coloured by owner; zoomed in you see Micropolis tiles.

## Running it

Requires Node 22+ (24 recommended).

```sh
npm install
npm run gen:world      # downloads Natural Earth data and rasterises the world (one-off, ~1-2 min)
npm run dev            # server on :8787, Vite client on :5173 (proxies /ws)
```

Open http://localhost:5173.

Production: `npm run build && npm start` serves the built client and the WebSocket
endpoint from the same port (`PORT`, default 8787). The server is a single long-lived
process with in-memory state, so run it on a VM or container, not on a serverless platform.

Server environment variables: `PORT`, `HOST`, `DATA_DIR` (save directory relative to the repo
root, default `data/save`), `TICK_MS` (game-month length, default 5000) and `DEV_HOOKS=1`, which
is for tests only: it accepts the non-protocol socket message `{t:'devIgnite', x, y}` to start a
fire and turns random fire outbreaks off. Tests run against a throwaway instance:

```sh
cd server
PORT=8791 DATA_DIR=data/save-test DEV_HOOKS=1 TICK_MS=500 npx tsx src/index.ts   # one terminal
PORT=8791 npm run smoke; PORT=8791 TICK_MS=500 npm run smoke:features             # another
```
Ready-made recipes: a Raspberry Pi behind a Cloudflare Tunnel in [deploy/pi/README.md](deploy/pi/README.md),
or an Oracle Cloud Always Free VM with Caddy TLS in [deploy/oracle/README.md](deploy/oracle/README.md).

## Layout

```
shared/   constants, Micropolis tile ids/tables, tool defs, wire protocol (shared by all)
server/   world state, simulation, WebSocket server, persistence
client/   canvas renderer, input, UI, networking
tools/    gen-world: Natural Earth -> data/world/base.bin + minimap PNG
data/     generated world + save data (git-ignored)
LICENSES/ GPL-3.0 and the Micropolis additional terms
```

## Simulation notes

The simulation is a deliberately simplified Micropolis: power flood-fill through conductive
tiles from coal/nuclear plants, R/C/I zones that need power and a nearby road to grow,
density levels mapped to the original building tiles, a simple land-value heuristic, an
RCI demand model with an external market so new towns can start, and yearly taxes.

The budget screen (💰 Budget, or click your cash) shows the city's money per game year: tax income
(a flat `TAX_RATE` on residents and jobs, collected monthly), upkeep by line (roads, rail, power
plants, services), power trade, lifeline repayments and construction spending, for the year so far
and the completed years before it. Every player's closed years are kept on their record
(`budgetHistory`, up to 100), so a history view can be added later.

Power grids cross city borders: wires connect to a neighbour's grid, and a city whose plants
produce more than its zones need sells the surplus to connected cities that lack power, at
`POWER_PRICE_PER_UNIT` per zone-unit per game month (importers must be able to pay; unmet
zones brown out). Fire follows Micropolis `doFire`/`fireZone`: random outbreaks scale with city
size, a hit building collapses to rubble around one burning tile, fire spreads to burnable
neighbours (including across the border into a neighbour's city, never into unclaimed land)
and burns out into rubble; a powered fire station within `FIRE_STATION_RANGE` halves the
spread and quadruples the burn-out rate. A leaderboard of the biggest cities is pushed every
`LEADERBOARD_PUSH_TICKS` ticks. Traffic simulation, crime and pollution maps are not
implemented (yet).

## License

GPL-3.0-or-later. See [LICENSE](LICENSE) and [LICENSES/](LICENSES/).
