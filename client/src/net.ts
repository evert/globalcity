// WebSocket client: identity, hello/welcome, auto-reconnect, typed send, ping, binary chunks.
import type { ClientMsg, ServerMsg } from '@globalcity/shared';
import { decodeChunk } from '@globalcity/shared';
import { Emitter } from './emitter.ts';

export interface Identity { id?: string; token?: string; name?: string }

const ID_KEY = 'globalcity.identity';
const PING_MS = 20_000;

export type NetEvents = {
  open: void;
  close: void;
  msg: ServerMsg;
  chunk: { cx: number; cy: number; tiles: Uint16Array };
  status: string;
};

export function loadIdentity(): Identity {
  try {
    const raw = localStorage.getItem(ID_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object') return v as Identity;
    }
  } catch { /* ignore */ }
  return {};
}

export function saveIdentity(id: Identity): void {
  try { localStorage.setItem(ID_KEY, JSON.stringify(id)); } catch { /* ignore */ }
}

export class Net extends Emitter<NetEvents> {
  identity: Identity = loadIdentity();
  subscription: [number, number][] = [];
  connected = false;
  private ws: WebSocket | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closedByUser = false;
  readonly url: string;

  constructor(url?: string) {
    super();
    this.url = url ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  connect(): void {
    this.closedByUser = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.emit('status', this.attempt ? `Reconnecting… (attempt ${this.attempt + 1})` : 'Connecting…');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      console.warn('[net] websocket construct failed', e);
      this.scheduleReconnect();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.connected = true;
      this.sendRaw({ t: 'hello', id: this.identity.id, token: this.identity.token, name: this.identity.name, v: __BUILD_VERSION__ });
      if (this.subscription.length) this.sendRaw({ t: 'sub', chunks: this.subscription });
      this.startPing();
      this.emit('status', 'Connected');
      this.emit('open', undefined);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      if (ev.data instanceof ArrayBuffer) {
        const chunk = decodeChunk(ev.data);
        if (chunk) this.emit('chunk', chunk);
        else console.warn('[net] unknown binary frame', ev.data.byteLength);
        return;
      }
      if (typeof ev.data !== 'string') return;
      let msg: ServerMsg;
      try { msg = JSON.parse(ev.data) as ServerMsg; } catch { console.warn('[net] bad json'); return; }
      if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') return;
      if (msg.t === 'welcome') {
        this.identity = { id: msg.player.id, token: msg.player.token, name: msg.player.name };
        saveIdentity(this.identity);
      }
      this.emit('msg', msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      const was = this.connected;
      this.connected = false;
      this.stopPing();
      if (was) this.emit('close', undefined);
      if (!this.closedByUser) this.scheduleReconnect();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopPing();
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closedByUser) return;
    const base = Math.min(10_000, 500 * 2 ** Math.min(this.attempt, 5));
    const delay = base + Math.random() * base * 0.3;
    this.attempt++;
    this.emit('status', `Disconnected — retrying in ${Math.round(delay / 1000)}s`);
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ t: 'ping' }), PING_MS);
  }
  private stopPing(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  /** Send if connected; returns false when offline (message is dropped, except subscriptions which are remembered). */
  send(msg: ClientMsg): boolean {
    if (msg.t === 'sub') this.subscription = msg.chunks;
    return this.sendRaw(msg);
  }

  private sendRaw(msg: ClientMsg): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try { this.ws.send(JSON.stringify(msg)); return true; } catch { return false; }
  }

  /** Replace the subscription set (sent immediately when connected, otherwise on reconnect). */
  setSubscription(chunks: [number, number][]): void {
    this.send({ t: 'sub', chunks });
  }

  setName(name: string): void {
    this.identity.name = name;
    saveIdentity(this.identity);
  }
}
