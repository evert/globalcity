// Admin: client build version tracking and announcements.
//
// Version: the client build writes dist/version.json; we read it at boot and poll it, so a deploy that
// only rebuilds the client (no restart) still tells every connected client to update.
//
// Announcements: POST /admin/announce {msg, minutes?, level?}, POST /admin/clear, GET /admin/status.
// Grants: POST /admin/grant {name | id (prefix), amount}: add cash to one city, live (no restart).
// World reset (notify.ts): GET /admin/notify (sign-ups), POST /admin/reset-at {at: ISO date | epoch ms | null},
// POST /admin/notify-reset {again?}: send the "new world is open" notification to everyone who signed up.
// Only from the machine itself (loopback, and never through the Cloudflare tunnel, which also connects
// from loopback but adds cf-* headers) and with the token in <data dir>/admin-token (created at boot, 0600).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type http from 'node:http';
import { log, warn } from './util.ts';
import type { Notify } from './notify.ts';

export interface Announcement { id: string; msg: string; level: 'info' | 'warn'; until: number }
export type GrantResult = { ok: true; id: string; name: string; cityName: string; funds: number } | { ok: false; error: string };

export class Admin {
  version = '';
  announcement: Announcement | null = null;
  private readonly token: string;
  private readonly versionFile: string;

  constructor(clientDist: string, dataDir: string, private readonly onVersion: (v: string) => void,
    private readonly onAnnounce: (a: Announcement | null) => void,
    private readonly onGrant: (who: { id?: string; name?: string }, amount: number) => GrantResult = () => ({ ok: false, error: 'grants not available' }),
    private readonly notify: Notify | null = null) {
    this.versionFile = path.join(clientDist, 'version.json');
    this.readVersion();
    fs.watchFile(this.versionFile, { interval: 5000 }, () => {
      const before = this.version;
      this.readVersion();
      if (this.version && this.version !== before) { log(`client build changed: ${before || '(none)'} -> ${this.version}`); this.onVersion(this.version); }
    });
    const tokenFile = path.join(dataDir, 'admin-token');
    try {
      this.token = fs.readFileSync(tokenFile, 'utf8').trim();
    } catch {
      this.token = crypto.randomBytes(24).toString('hex');
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(tokenFile, this.token + '\n', { mode: 0o600 });
      log(`admin token written to ${tokenFile}`);
    }
  }

  private readVersion(): void {
    try { this.version = String(JSON.parse(fs.readFileSync(this.versionFile, 'utf8')).version ?? ''); } catch { /* no build yet */ }
  }

  /** Active announcement, or null once it has expired. */
  active(now = Date.now()): Announcement | null {
    if (this.announcement && this.announcement.until <= now) this.announcement = null;
    return this.announcement;
  }

  /** Handle /admin/* requests. Returns false if the path is not an admin path. */
  handle(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): boolean {
    if (!pathname.startsWith('/admin/')) return false;
    const remote = req.socket.remoteAddress ?? '';
    const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    const tunneled = Object.keys(req.headers).some((h) => h.startsWith('cf-'));
    const given = String(req.headers['x-admin-token'] ?? '');
    const ok = loopback && !tunneled && given.length === this.token.length
      && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(this.token));
    if (!ok) {
      if (loopback && !tunneled) warn(`admin request rejected (bad token) ${req.method} ${pathname}`);
      res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return true;
    }
    const reply = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && pathname === '/admin/status') {
      reply(200, { version: this.version, announcement: this.active(), worldReset: this.notify ? { at: this.notify.resetAt, signups: this.notify.stats().total } : null });
      return true;
    }
    if (pathname === '/admin/notify' || pathname === '/admin/reset-at' || pathname === '/admin/notify-reset') {
      const notify = this.notify;
      if (!notify) { reply(404, { error: 'notifications not available' }); return true; }
      if (req.method === 'GET' && pathname === '/admin/notify') {
        const at = notify.resetAt;
        reply(200, { resetAt: at === null ? null : new Date(at).toISOString(), ...notify.stats() });
        return true;
      }
      if (req.method !== 'POST') { reply(405, { error: 'POST only' }); return true; }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        let j: { at?: unknown; again?: unknown };
        try { j = body.trim() ? JSON.parse(body) : {}; } catch { reply(400, { error: 'invalid JSON' }); return; }
        if (pathname === '/admin/reset-at') {
          const at = j.at === null || j.at === 'none' ? null : typeof j.at === 'number' ? j.at : typeof j.at === 'string' ? Date.parse(j.at) : NaN;
          if (at !== null && !Number.isFinite(at)) { reply(400, { error: 'at must be an ISO date (with time zone), epoch ms, or null/"none"' }); return; }
          notify.resetAt = at;
          log(`admin: world reset ${at === null ? 'cleared' : `set to ${new Date(at).toISOString()}`}`);
          reply(200, { ok: true, resetAt: at === null ? null : new Date(at).toISOString() });
          return;
        }
        log(`admin: sending the world reset notification${j.again === true ? ' (again, to everyone)' : ''}`);
        notify.sendAll(undefined, j.again === true).then((r) => reply(r.skipped < 0 ? 409 : 200, r.skipped < 0 ? { error: 'already sending' } : { ok: true, ...r }),
          (e: Error) => reply(500, { error: e.message }));
      });
      return true;
    }
    if (req.method === 'POST' && pathname === '/admin/clear') {
      this.announcement = null; this.onAnnounce(null); log('admin: announcement cleared'); reply(200, { ok: true }); return true;
    }
    if (req.method === 'POST' && pathname === '/admin/announce') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
      req.on('end', () => {
        let j: { msg?: unknown; minutes?: unknown; level?: unknown };
        try { j = JSON.parse(body); } catch { reply(400, { error: 'invalid JSON' }); return; }
        const msg = typeof j.msg === 'string' ? j.msg.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 280) : '';
        if (!msg) { reply(400, { error: 'msg required' }); return; }
        const minutes = typeof j.minutes === 'number' && j.minutes > 0 ? Math.min(j.minutes, 7 * 24 * 60) : 60;
        const level = j.level === 'warn' ? 'warn' : 'info';
        this.announcement = { id: crypto.randomBytes(6).toString('hex'), msg, level, until: Date.now() + minutes * 60_000 };
        log(`admin: announcement (${level}, ${minutes} min): ${msg}`);
        this.onAnnounce(this.announcement);
        reply(200, { ok: true, announcement: this.announcement });
      });
      return true;
    }
    if (req.method === 'POST' && pathname === '/admin/grant') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        let j: { id?: unknown; name?: unknown; amount?: unknown };
        try { j = JSON.parse(body); } catch { reply(400, { error: 'invalid JSON' }); return; }
        const amount = j.amount;
        if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0 || amount > 10_000_000) { reply(400, { error: 'amount must be a whole number from 1 to 10,000,000' }); return; }
        const who = { id: typeof j.id === 'string' ? j.id : undefined, name: typeof j.name === 'string' ? j.name : undefined };
        if (!who.id && !who.name) { reply(400, { error: 'name or id required' }); return; }
        const r = this.onGrant(who, amount);
        if (r.ok) log(`admin: granted $${amount} to ${r.name} (${r.id.slice(0, 8)}, ${r.cityName || 'no city'}); funds now $${r.funds}`);
        reply(r.ok ? 200 : 400, r);
      });
      return true;
    }
    reply(404, { error: 'unknown admin action' });
    return true;
  }
}
