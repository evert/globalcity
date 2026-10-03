import type { ToolId } from './tools.ts';
import { CHUNK } from './constants.ts';

export interface PlayerPublic {
  id: string;
  name: string; // mayor name
  color: string; // css hex
  cityName: string; // '' until the first claim; defaulted from the nearest Natural Earth populated place
}

export interface ClaimInfo {
  cx: number;
  cy: number;
  ownerId: string;
  ownerName: string;
  cityName: string;
  color: string;
  pop: number; // displayed population of the whole city this chunk belongs to
  idleDays: number; // days since the owner was last seen; >= ABANDON_DECAY_DAYS means decaying, claims released at ABANDON_FREE_DAYS
}

export interface GameTime {
  year: number;
  month: number; // 0..11
}

export interface Demand { r: number; c: number; i: number } // -1..1

export interface PlayerStats {
  funds: number;
  population: number;
  resPop: number;
  comPop: number;
  indPop: number;
  powerSupply: number; // zone-units available
  powerDemand: number; // zone-units needed
  demand: Demand;
  chunks: number; // chunks owned
  lastIncome: number; // funds gained last game year
  // Power trading (per game month, on the last tick)
  powerImported: number; // zone-units bought from neighbours' grids
  powerExported: number; // zone-units sold to neighbours
  powerTradeNet: number; // $ net from power trade last month (positive = income)
  // Fire
  fires: number; // burning tiles in this city right now
  fireStations: number; // powered fire stations
  // Neighbourhood
  neighbours: number; // distinct cities owning a chunk 8-adjacent to one of mine
  neighbourDemand: Demand; // part of `demand` contributed by neighbours (jobs/shoppers across the border)
  railLinks: number; // neighbour cities reachable from my zones over connected rail
  railDemand: number; // commercial demand added by rail links (already included in demand.c)
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  cityName: string;
  color: string;
  population: number;
  chunks: number;
  cx: number; // centroid chunk of the city, for "visit"
  cy: number;
  fires: number;
}

/** Where an online player is looking / pointing. */
export interface Presence {
  id: string;
  name: string;
  cityName: string;
  color: string;
  x: number; // camera centre, tiles
  y: number;
  zoom: number;
  cx?: number; // cursor tile, if hovering the map
  cy?: number;
}

export interface QueryInfo {
  x: number;
  y: number;
  tile: number;
  name: string; // human readable e.g. "Residential zone (24 pop)"
  powered: boolean;
  owner?: PlayerPublic;
  zonePop?: number;
}

// ---------- client -> server (JSON) ----------
export type ClientMsg =
  | { t: 'hello'; id?: string; token?: string; name?: string }
  | { t: 'sub'; chunks: [number, number][] } // replaces the whole subscription set
  | { t: 'claim'; cx: number; cy: number }
  | { t: 'build'; tool: ToolId; x: number; y: number }
  | { t: 'query'; x: number; y: number }
  | { t: 'findFree'; cx: number; cy: number } // nearest claimable chunk to (cx,cy)
  | { t: 'rename'; name: string }
  | { t: 'renameCity'; name: string }
  | { t: 'view'; x: number; y: number; zoom: number; cx?: number; cy?: number } // throttled by the client (~4/s)
  | { t: 'leaderboard' } // ask for the current top list
  | { t: 'ping' };

// ---------- server -> client (JSON) ----------
export type ServerMsg =
  | {
      t: 'welcome';
      player: PlayerPublic & { token: string };
      stats: PlayerStats;
      world: { w: number; h: number; chunk: number };
      claims: ClaimInfo[];
      online: number;
      time: GameTime;
    }
  | { t: 'tiles'; u: number[] } // flat triples: x, y, value
  | { t: 'claim'; claim: ClaimInfo } // a chunk changed owner
  | { t: 'claims'; claims: ClaimInfo[] } // periodic: pops changed
  | { t: 'stats'; stats: PlayerStats } // the receiving player's own stats
  | { t: 'time'; time: GameTime; online: number }
  | { t: 'freeSpot'; cx: number | null; cy: number | null }
  | { t: 'query'; info: QueryInfo }
  | { t: 'toast'; msg: string; kind: 'info' | 'error' | 'success'; at?: { x: number; y: number } } // `at`: clickable, fly there
  | { t: 'leaderboard'; entries: LeaderboardEntry[]; me?: { rank: number; population: number } } // top cities; also pushed periodically
  | { t: 'presence'; players: Presence[] } // every PRESENCE_INTERVAL_MS, online players except the receiver
  | { t: 'unclaim'; cx: number; cy: number } // a chunk was released (abandoned); ruins stay
  | { t: 'pong' };

// ---------- binary frames (server -> client) ----------
// Full chunk: u8 kind=1, u16 cx, u16 cy, then CHUNK*CHUNK u16 tiles, all little-endian.
export const BIN_CHUNK = 1;
export const CHUNK_FRAME_BYTES = 5 + CHUNK * CHUNK * 2;

export function encodeChunk(cx: number, cy: number, tiles: Uint16Array): ArrayBuffer {
  const buf = new ArrayBuffer(CHUNK_FRAME_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, BIN_CHUNK);
  dv.setUint16(1, cx, true);
  dv.setUint16(3, cy, true);
  const out = new Uint8Array(buf, 5);
  // tiles may be a view into a larger array; copy as LE bytes
  for (let i = 0; i < tiles.length; i++) {
    const v = tiles[i];
    out[i * 2] = v & 0xff;
    out[i * 2 + 1] = v >> 8;
  }
  return buf;
}

export function decodeChunk(buf: ArrayBuffer): { cx: number; cy: number; tiles: Uint16Array } | null {
  if (buf.byteLength < 5) return null;
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== BIN_CHUNK || buf.byteLength !== CHUNK_FRAME_BYTES) return null;
  const cx = dv.getUint16(1, true);
  const cy = dv.getUint16(3, true);
  const n = CHUNK * CHUNK;
  const tiles = new Uint16Array(n);
  const src = new Uint8Array(buf, 5);
  for (let i = 0; i < n; i++) tiles[i] = src[i * 2] | (src[i * 2 + 1] << 8);
  return { cx, cy, tiles };
}

/** Deterministic player colour from id. */
export function colorForId(id: string): string {
  const palette = ['#ff5f5f', '#ffb347', '#ffe84d', '#7ddc5c', '#4dd0e1', '#5f8bff', '#b47aff', '#ff7ad9', '#ff9a76', '#9be564'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
