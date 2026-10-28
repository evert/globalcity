// Game-level actions shared by the UI and the input handler.
import type { ToolId } from '@globalcity/shared';
import { CHUNK, CHUNKS_X, CHUNKS_Y, clamp, inWorld } from '@globalcity/shared';
import type { Net } from './net.ts';
import type { Renderer } from './renderer.ts';
import type { AppState } from './state.ts';

export class Actions {
  constructor(readonly state: AppState, readonly net: Net, readonly renderer: Renderer) {}

  flyToChunk(cx: number, cy: number, zoom = 1, ms = 700): void {
    cx = clamp(cx, 0, CHUNKS_X - 1); cy = clamp(cy, 0, CHUNKS_Y - 1);
    this.renderer.flyTo((cx + 0.5) * CHUNK, (cy + 0.5) * CHUNK, zoom, ms);
  }

  flyToTile(x: number, y: number, zoom = 1, ms = 700): void {
    this.renderer.flyTo(x, y, zoom, ms);
  }

  goToMyCity(): boolean {
    const c = this.state.myCentroid();
    if (!c) return false;
    this.renderer.flyTo(c.cx * CHUNK, c.cy * CHUNK, Math.max(this.renderer.cam.zoom, 1) > 1 ? this.renderer.cam.zoom : 1, 800);
    return true;
  }

  claim(cx: number, cy: number): boolean {
    return this.net.send({ t: 'claim', cx, cy });
  }

  /** Ask the server for the nearest claimable chunk to (cx,cy); the answer arrives as 'freeSpot'. */
  findFree(cx?: number, cy?: number): boolean {
    if (cx === undefined || cy === undefined) ({ cx, cy } = this.renderer.centerChunk());
    return this.net.send({ t: 'findFree', cx, cy });
  }

  build(tool: ToolId, x: number, y: number): boolean {
    if (!inWorld(x, y) || tool === 'query') return false;
    return this.net.send({ t: 'build', tool, x, y });
  }

  query(x: number, y: number): boolean {
    if (!inWorld(x, y)) return false;
    return this.net.send({ t: 'query', x, y });
  }

  /** Ask for the emergency lifeline loan (the server checks eligibility). */
  lifeline(): boolean { return this.net.send({ t: 'lifeline' }); }

  /** Retire my city as a monument and start over (the server checks the population). */
  monument(): boolean { return this.net.send({ t: 'monument' }); }

  /** Give up my broke city and start over (the server checks funds and the lifeline). */
  abandon(): boolean { return this.net.send({ t: 'abandon' }); }

  /** Set my city's tax rate, percent (the server clamps and echoes it in the next stats). */
  setTaxRate(rate: number): boolean { return this.net.send({ t: 'taxRate', rate: Math.round(rate) }); }

  rename(name: string): boolean {
    name = name.trim().slice(0, 24);
    if (!name) return false;
    this.net.setName(name);
    if (this.state.me) this.state.setMe({ ...this.state.me, name });
    return this.net.send({ t: 'rename', name });
  }

  /** Rename my city (the server is authoritative and echoes the name through the next claims update). */
  renameCity(name: string): boolean {
    name = name.trim().slice(0, 32);
    if (!name) return false;
    this.state.setCityName(name);
    return this.net.send({ t: 'renameCity', name });
  }
}
