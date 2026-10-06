// Leaderboard: top cities by population, recomputed every LEADERBOARD_PUSH_TICKS ticks and cached.
// Rank is among all players with population > 0 (1-based); players with 0 population are not listed.

import { unlockedOf } from './players.ts';
import { LEADERBOARD_SIZE, milestonePercent, parseChunkKey, type LeaderboardEntry, type ServerMsg } from '@globalcity/shared';
import type { Players, PlayerRecord } from './players.ts';

export class Leaderboard {
  entries: LeaderboardEntry[] = [];
  /** JSON of `entries`, for cheap change detection */
  json = '[]';
  private ranks = new Map<string, number>();

  constructor(private readonly players: Players) {
    this.recompute();
  }

  /** Recompute ranks and the top list. Returns true if the top list changed. */
  recompute(): boolean {
    const ranked = [...this.players.players.values()]
      .filter((p) => p.stats.population > 0 && p.chunks.length > 0)
      .sort((a, b) => b.stats.population - a.stats.population || b.chunks.length - a.chunks.length || a.id.localeCompare(b.id));
    this.ranks = new Map(ranked.map((p, k) => [p.id, k + 1]));
    const entries = ranked.slice(0, LEADERBOARD_SIZE).map((p): LeaderboardEntry => {
      const c = centroid(p);
      return { id: p.id, name: p.name, cityName: p.cityName, color: p.color, population: p.stats.population, chunks: p.chunks.length, cx: c.cx, cy: c.cy, fires: p.stats.fires, milestones: milestonePercent(unlockedOf(p)) };
    });
    const json = JSON.stringify(entries);
    if (json === this.json) return false;
    this.entries = entries;
    this.json = json;
    return true;
  }

  /** The 'leaderboard' message for player p (`me` only if p is ranked). */
  messageFor(p: PlayerRecord | null): ServerMsg {
    const rank = p ? this.ranks.get(p.id) : undefined;
    return rank !== undefined && p
      ? { t: 'leaderboard', entries: this.entries, me: { rank, population: p.stats.population } }
      : { t: 'leaderboard', entries: this.entries };
  }
}

/** Rounded centroid of a player's chunks. */
function centroid(p: PlayerRecord): { cx: number; cy: number } {
  let sx = 0, sy = 0;
  for (const k of p.chunks) { const c = parseChunkKey(k); sx += c.cx; sy += c.cy; }
  const n = p.chunks.length || 1;
  return { cx: Math.round(sx / n), cy: Math.round(sy / n) };
}
