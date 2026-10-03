// Central client state shared by net, renderer, input and ui.
import type { ClaimInfo, GameTime, LeaderboardEntry, PlayerPublic, PlayerStats, Presence, ToolId } from '@globalcity/shared';
import {
  ABANDON_DECAY_DAYS, ABANDON_FREE_DAYS, CHUNKS_X, CHUNKS_Y, MAX_CHUNKS_PER_PLAYER, chunkKey, parseChunkKey, STARTING_FUNDS, START_YEAR,
} from '@globalcity/shared';
import { Emitter } from './emitter.ts';

export type StateEvents = {
  me: PlayerPublic | null;
  /** my city name changed (from a claim update or a rename); cheaper than 'me' which rebuilds chunk canvases */
  city: string;
  stats: PlayerStats | null;
  claims: void;
  time: void;
  connection: boolean;
  tool: ToolId;
  leaderboard: void;
  presence: void;
};

export interface LeaderboardMe { rank: number; population: number }

/** Days of inactivity after which a claim gets the subtle "idle" suffix. */
export const IDLE_HINT_DAYS = 7;

export type ClaimIdle = 'active' | 'idle' | 'abandoned';

/** Old servers omit these fields; treat them as "no city name / seen today". */
export function claimCity(c: ClaimInfo): string { return c.cityName ?? ''; }
export function claimIdleDays(c: ClaimInfo): number { return Math.max(0, Math.floor(c.idleDays ?? 0)); }

export function claimIdleState(c: ClaimInfo): ClaimIdle {
  const d = claimIdleDays(c);
  if (d >= ABANDON_DECAY_DAYS) return 'abandoned';
  if (d >= IDLE_HINT_DAYS) return 'idle';
  return 'active';
}

/** Short label: the city name if the mayor has one, else the mayor. */
export function claimShortLabel(c: ClaimInfo): string { return claimCity(c) || c.ownerName; }

/** Full label for the tile view: "Tilburg — Evert (you) (abandoned, free in 19 days)". */
export function claimLabel(c: ClaimInfo, own: boolean): string {
  const city = claimCity(c);
  let s = city ? `${city} — ${c.ownerName}` : c.ownerName;
  if (own) s += ' (you)';
  const idle = claimIdleState(c);
  if (idle === 'abandoned') s += ` (abandoned, free in ${Math.max(0, ABANDON_FREE_DAYS - claimIdleDays(c))} days)`;
  else if (idle === 'idle') s += ` · idle ${claimIdleDays(c)}d`;
  return s;
}

export class AppState extends Emitter<StateEvents> {
  me: PlayerPublic | null = null;
  stats: PlayerStats | null = null;
  claims = new Map<string, ClaimInfo>();
  time: GameTime = { year: START_YEAR, month: 0 };
  online = 0;
  connected = false;
  tool: ToolId = 'query';
  /** last top list from the server (kept so the panel opens instantly) */
  leaderboard: LeaderboardEntry[] = [];
  leaderboardMe: LeaderboardMe | null = null;
  leaderboardAt = 0; // performance.now() of the last update, 0 = never
  /** latest presence frame (other online players), replaced wholesale */
  presence: Presence[] = [];
  presenceAt = 0; // performance.now() of the last frame, 0 = never

  get funds(): number { return this.stats?.funds ?? STARTING_FUNDS; }
  get cityName(): string { return this.me?.cityName ?? ''; }

  setMe(me: PlayerPublic | null): void {
    this.me = me ? { ...me, cityName: me.cityName ?? '' } : null;
    this.emit('me', this.me);
    if (this.me) this.syncCityFromClaims();
  }
  /** Rename my city locally (the server confirms through the next claims update). */
  setCityName(name: string): void {
    if (!this.me || this.me.cityName === name) return;
    this.me = { ...this.me, cityName: name };
    this.emit('city', name);
  }
  setStats(stats: PlayerStats): void { this.stats = stats; this.emit('stats', stats); }
  setTime(time: GameTime, online: number): void { this.time = time; this.online = online; this.emit('time', undefined); }
  setConnected(v: boolean): void { if (this.connected !== v) { this.connected = v; this.emit('connection', v); } }
  setTool(t: ToolId): void { if (this.tool !== t) { this.tool = t; this.emit('tool', t); } }
  setLeaderboard(entries: LeaderboardEntry[], me?: LeaderboardMe): void {
    this.leaderboard = entries;
    this.leaderboardMe = me ?? null;
    this.leaderboardAt = performance.now();
    this.emit('leaderboard', undefined);
  }
  setPresence(players: Presence[], now = performance.now()): void {
    this.presence = players;
    this.presenceAt = now;
    this.emit('presence', undefined);
  }

  replaceClaims(list: ClaimInfo[]): void {
    this.claims.clear();
    for (const c of list) this.claims.set(chunkKey(c.cx, c.cy), c);
    this.syncCityFromClaims();
    this.emit('claims', undefined);
  }
  /** Periodic 'claims' message: update pops/names of listed claims (and add unknown ones). */
  mergeClaims(list: ClaimInfo[]): void {
    for (const c of list) this.claims.set(chunkKey(c.cx, c.cy), c);
    this.syncCityFromClaims();
    this.emit('claims', undefined);
  }
  setClaim(c: ClaimInfo): void {
    this.claims.set(chunkKey(c.cx, c.cy), c);
    this.syncCityFromClaims();
    this.emit('claims', undefined);
  }
  /** 'unclaim': a chunk was released. Returns the removed claim, if any. */
  removeClaim(cx: number, cy: number): ClaimInfo | undefined {
    const key = chunkKey(cx, cy);
    const prev = this.claims.get(key);
    if (!prev) return undefined;
    this.claims.delete(key);
    this.emit('claims', undefined);
    return prev;
  }
  /** `me.cityName` follows the first of my claims that carries a city name (the server names the city on the first claim). */
  private syncCityFromClaims(): void {
    if (!this.me) return;
    for (const c of this.claims.values()) {
      if (c.ownerId !== this.me.id) continue;
      const city = claimCity(c);
      if (city) { this.setCityName(city); return; }
    }
  }

  claimAt(cx: number, cy: number): ClaimInfo | undefined { return this.claims.get(chunkKey(cx, cy)); }
  ownsChunk(cx: number, cy: number): boolean {
    const c = this.claims.get(chunkKey(cx, cy));
    return !!c && !!this.me && c.ownerId === this.me.id;
  }
  myChunks(): ClaimInfo[] {
    if (!this.me) return [];
    const out: ClaimInfo[] = [];
    for (const c of this.claims.values()) if (c.ownerId === this.me.id) out.push(c);
    return out;
  }
  /** Centroid (in chunk units, fractional) of the player's chunks, or null. */
  myCentroid(): { cx: number; cy: number } | null {
    const mine = this.myChunks();
    if (!mine.length) return null;
    let sx = 0, sy = 0;
    for (const c of mine) { sx += c.cx + 0.5; sy += c.cy + 0.5; }
    return { cx: sx / mine.length, cy: sy / mine.length };
  }
  isAdjacentToMine(cx: number, cy: number): boolean {
    return this.ownsChunk(cx - 1, cy) || this.ownsChunk(cx + 1, cy) || this.ownsChunk(cx, cy - 1) || this.ownsChunk(cx, cy + 1);
  }
  atClaimCap(): boolean { return this.ownedChunkCount() >= MAX_CHUNKS_PER_PLAYER; }
  /** Client-side hint only; the server is authoritative. Released (unclaimed) ruins are plain unclaimed chunks. */
  canClaim(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= CHUNKS_X || cy >= CHUNKS_Y) return false;
    if (this.claims.has(chunkKey(cx, cy))) return false;
    const owned = this.ownedChunkCount();
    if (owned >= MAX_CHUNKS_PER_PLAYER) return false;
    if (owned === 0) return true;
    return this.isAdjacentToMine(cx, cy);
  }
  ownedChunkCount(): number { return this.myChunks().length; }
}

export { parseChunkKey };
