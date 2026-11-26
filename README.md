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
tools/    gen-world: Natural Earth -> data/world/base.bin + minimap PNG
data/     generated world + save data (git-ignored)
LICENSES/ GPL-3.0 and the Micropolis additional terms
```

## License

GPL-3.0-or-later. See [LICENSE](LICENSE) and [LICENSES/](LICENSES/).
