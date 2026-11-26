// Routes server messages into state / map / renderer / ui. Shared by main.ts and the self test
// so synthetic messages take exactly the same path as real ones.
import { CHUNK, WORLD_W, WORLD_H, type ServerMsg } from '@globalcity/shared';
import type { TileMap } from './map.ts';
import type { Renderer } from './renderer.ts';
import type { AppState } from './state.ts';
import type { UI } from './ui.ts';

/** how long news to notice (a disaster, `big` toasts) stays up */
const BIG_TOAST_MS = 12_000;

export interface DispatchTargets { state: AppState; map: TileMap; renderer: Renderer; ui: UI; updater?: { onVersion(v: string): void } }

export function handleServerMsg(msg: ServerMsg, { state, map, renderer, ui, updater }: DispatchTargets): void {
  switch (msg.t) {
    case 'welcome': {
      const { token: _token, ...me } = msg.player;
      state.setMe(me);
      state.replaceClaims(msg.claims);
      state.setStats(msg.stats);
      state.setTime(msg.time, msg.online);
      if (msg.world.chunk !== CHUNK || msg.world.w !== WORLD_W || msg.world.h !== WORLD_H) {
        console.warn('[main] server world size differs from shared constants', msg.world);
      }
      break;
    }
    case 'tiles': map.applyTiles(msg.u); break;
    case 'disasters': renderer.setDisasters(msg.list); break;
    case 'worldStats': ui.showWorldStats(msg.stats); break;
    case 'claim': {
      const prev = state.claimAt(msg.claim.cx, msg.claim.cy);
      state.setClaim(msg.claim);
      if (!prev || prev.ownerId !== msg.claim.ownerId) renderer.rebuildChunk(msg.claim.cx, msg.claim.cy);
      ui.onClaimChanged(msg.claim);
      break;
    }
    case 'claims': state.mergeClaims(msg.claims); break;
    case 'stats': state.setStats(msg.stats); break;
    case 'time': state.setTime(msg.time, msg.online); break;
    case 'freeSpot': ui.onFreeSpot(msg.cx, msg.cy); break;
    case 'query': ui.showQuery(msg.info); break;
    case 'toast': ui.toast(msg.msg, msg.kind, msg.big ? BIG_TOAST_MS : undefined, msg.at, msg.big); break;
    case 'leaderboard': state.setLeaderboard(msg.entries, msg.me, msg.monuments); break;
    case 'presence': state.setPresence(Array.isArray(msg.players) ? msg.players : []); break;
    case 'airports': renderer.flightLayer.set(msg.airports, msg.now); renderer.invalidate(); break;
    case 'shipping': renderer.shipLayer.set(msg.ports, msg.routes, msg.now); renderer.invalidate(); break;
    case 'buildings': renderer.customs.set(msg.list); break;
    case 'building': renderer.customs.apply(msg.op, msg.b); break;
    case 'unclaim': {
      const prev = state.removeClaim(msg.cx, msg.cy);
      if (prev) { renderer.rebuildChunk(msg.cx, msg.cy); ui.onUnclaim(prev); }
      break;
    }
    case 'version': updater?.onVersion(msg.version); break;
    case 'announce': ui.showAnnouncement(msg.id, msg.msg, msg.level, msg.until); break;
    case 'announceClear': ui.clearAnnouncement(); break;
    case 'pong': break;
    default: console.warn('[main] unknown message', msg);
  }
}
