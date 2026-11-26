// Notifications for the world reset: the reset time, and the players who asked to be told when it happens.
//
// Players subscribe with Web Push (the browser's PushManager; in the Android app Chrome hands the notification to
// the app, so it shows as a normal Android notification). Subscriptions live in an SQLite database next to the save
// directory (<data>/notify.db, so it outlives the world it was made in) together with the VAPID key pair they are
// bound to: a subscription only accepts pushes signed with the key it was made for, so the keys must never change.
// Pushes carry no payload (that would need RFC 8291 encryption); the service worker (client/public/sw.js) knows
// what to say.
//
//   GET  /api/world-reset          { at: epoch ms | null, vapidKey }
//   POST /api/notify               a PushSubscription's JSON (+ app): signs up for the world reset notification
//   POST /api/notify/remove        { endpoint }: signs off again
// Admin (admin.ts): GET /admin/notify (sign-ups), POST /admin/reset-at { at }, POST /admin/notify-reset.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { log, warn } from './util.ts';

/** When the world resets unless an admin sets another time: Thursday 3 December 2026, noon in Toronto (EST). */
export const DEFAULT_RESET_AT = Date.parse('2026-12-03T12:00:00-05:00');
export const TOPIC_WORLD_RESET = 'world-reset';
/** VAPID "sub": who to contact about these pushes. */
const VAPID_SUBJECT = 'https://globalcity.evertpot.com/';
const MAX_SUBSCRIPTIONS = 200_000;
const SEND_CONCURRENCY = 16;
const APPS = new Set(['android-app', 'android', 'ios', 'desktop', 'other']);

export interface NotifyStats { total: number; sent: number; byApp: Record<string, number>; lastDay: number }
export interface SendResult { sent: number; failed: number; removed: number; skipped: number }

const b64url = (b: Buffer): string => b.toString('base64url');

export class Notify {
  private readonly db: DatabaseSync;
  readonly vapidPublic: string;
  private readonly vapidPrivate: crypto.KeyObject;
  private sending = false;

  constructor(file: string, private readonly allowInsecureEndpoints = false) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint   TEXT PRIMARY KEY,
        topic      TEXT NOT NULL,
        p256dh     TEXT,
        auth       TEXT,
        app        TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        sent_at    INTEGER,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS push_subscriptions_topic ON push_subscriptions (topic);
    `);
    let pub = this.setting('vapid_public'), priv = this.setting('vapid_private');
    if (!pub || !priv) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const jwk = publicKey.export({ format: 'jwk' });
      pub = b64url(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]));
      priv = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
      this.setSetting('vapid_public', pub); this.setSetting('vapid_private', priv);
      log(`notify: new VAPID key pair in ${file}`);
    }
    this.vapidPublic = pub;
    this.vapidPrivate = crypto.createPrivateKey(priv);
  }

  private setting(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }
  private setSetting(key: string, value: string): void {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  /** When the world resets (epoch ms), or null when no reset is planned. */
  get resetAt(): number | null {
    const v = this.setting('world_reset_at');
    if (v === undefined) return DEFAULT_RESET_AT;
    return v === 'none' ? null : Number(v);
  }
  set resetAt(at: number | null) { this.setSetting('world_reset_at', at === null ? 'none' : String(at)); }

  stats(topic = TOPIC_WORLD_RESET): NotifyStats {
    const byApp: Record<string, number> = {};
    for (const r of this.db.prepare('SELECT app, COUNT(*) AS n FROM push_subscriptions WHERE topic = ? GROUP BY app').all(topic) as { app: string; n: number }[]) byApp[r.app] = r.n;
    const one = (sql: string, ...a: (string | number)[]): number => (this.db.prepare(sql).get(...a) as { n: number }).n;
    return {
      total: one('SELECT COUNT(*) AS n FROM push_subscriptions WHERE topic = ?', topic),
      sent: one('SELECT COUNT(*) AS n FROM push_subscriptions WHERE topic = ? AND sent_at IS NOT NULL', topic),
      lastDay: one('SELECT COUNT(*) AS n FROM push_subscriptions WHERE topic = ? AND created_at > ?', topic, Date.now() - 86_400_000),
      byApp,
    };
  }

  /** Store a subscription; an error message if it isn't one. */
  subscribe(body: unknown, topic = TOPIC_WORLD_RESET): string | null {
    const j = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; app?: unknown } | null;
    const endpoint = typeof j?.endpoint === 'string' ? j.endpoint : '';
    if (!this.validEndpoint(endpoint)) return 'invalid endpoint';
    const key = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}={0,2}$/.test(v) ? v : null);
    const app = typeof j?.app === 'string' && APPS.has(j.app) ? j.app : 'other';
    const exists = this.db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
    if (!exists && this.stats(topic).total >= MAX_SUBSCRIPTIONS) return 'too many subscriptions';
    this.db.prepare(`INSERT INTO push_subscriptions (endpoint, topic, p256dh, auth, app, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (endpoint) DO UPDATE SET topic = excluded.topic, p256dh = excluded.p256dh, auth = excluded.auth, app = excluded.app, sent_at = NULL, last_error = NULL`)
      .run(endpoint, topic, key(j?.keys?.p256dh), key(j?.keys?.auth), app, Date.now());
    return null;
  }

  unsubscribe(endpoint: string): boolean {
    return Number(this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint).changes) > 0;
  }

  private validEndpoint(s: string): boolean {
    if (s.length > 1024) return false;
    let u: URL;
    try { u = new URL(s); } catch { return false; }
    if (u.protocol === 'https:') return true;
    return this.allowInsecureEndpoints && u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  }

  /** VAPID (RFC 8292) Authorization header for a push service origin. */
  private vapidAuth(audience: string): string {
    const enc = (o: object): string => b64url(Buffer.from(JSON.stringify(o)));
    const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT })}`;
    const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: this.vapidPrivate, dsaEncoding: 'ieee-p1363' });
    return `vapid t=${unsigned}.${b64url(sig)}, k=${this.vapidPublic}`;
  }

  /** Push to one endpoint: 'ok', 'gone' (the subscription is dead: delete it) or an error. */
  private async push(endpoint: string): Promise<'ok' | 'gone' | string> {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: this.vapidAuth(new URL(endpoint).origin), ttl: String(3 * 86_400), urgency: 'high', topic: 'worldreset' },
        body: '',
        signal: AbortSignal.timeout(15_000),
      });
      await res.arrayBuffer().catch(() => undefined);
      if (res.ok) return 'ok';
      if (res.status === 404 || res.status === 410) return 'gone';
      return `HTTP ${res.status}`;
    } catch (e) {
      return (e as Error).message || 'network error';
    }
  }

  /** Notify every subscriber of a topic that hasn't been notified yet (or all of them again with `again`). */
  async sendAll(topic = TOPIC_WORLD_RESET, again = false): Promise<SendResult> {
    const result: SendResult = { sent: 0, failed: 0, removed: 0, skipped: 0 };
    if (this.sending) { result.skipped = -1; return result; }
    this.sending = true;
    try {
      const rows = this.db.prepare(`SELECT endpoint FROM push_subscriptions WHERE topic = ?${again ? '' : ' AND sent_at IS NULL'}`).all(topic) as { endpoint: string }[];
      result.skipped = again ? 0 : this.stats(topic).sent;
      const markSent = this.db.prepare('UPDATE push_subscriptions SET sent_at = ?, last_error = NULL WHERE endpoint = ?');
      const markFailed = this.db.prepare('UPDATE push_subscriptions SET last_error = ? WHERE endpoint = ?');
      let next = 0;
      const worker = async (): Promise<void> => {
        while (next < rows.length) {
          const { endpoint } = rows[next++];
          const r = await this.push(endpoint);
          if (r === 'ok') { markSent.run(Date.now(), endpoint); result.sent++; }
          else if (r === 'gone') { this.unsubscribe(endpoint); result.removed++; }
          else { markFailed.run(r.slice(0, 200), endpoint); result.failed++; }
        }
      };
      await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, rows.length) }, worker));
      log(`notify: ${topic}: ${result.sent} sent, ${result.failed} failed, ${result.removed} expired and removed, ${result.skipped} already notified`);
      return result;
    } finally {
      this.sending = false;
    }
  }

  /** Handle /api/world-reset and /api/notify*. Returns false if the path isn't one of them. */
  handle(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): boolean {
    const reply = (code: number, body: unknown): void => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (pathname === '/api/world-reset') {
      if (req.method !== 'GET' && req.method !== 'HEAD') { reply(405, { error: 'GET only' }); return true; }
      reply(200, { at: this.resetAt, vapidKey: this.vapidPublic });
      return true;
    }
    if (pathname !== '/api/notify' && pathname !== '/api/notify/remove') return false;
    if (req.method !== 'POST') { reply(405, { error: 'POST only' }); return true; }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) { reply(413, { error: 'too large' }); req.destroy(); } });
    req.on('end', () => {
      if (res.headersSent) return;
      let j: unknown;
      try { j = JSON.parse(body); } catch { reply(400, { error: 'invalid JSON' }); return; }
      try {
        if (pathname === '/api/notify') {
          const err = this.subscribe(j);
          reply(err ? 400 : 200, err ? { error: err } : { ok: true });
        } else {
          const endpoint = (j as { endpoint?: unknown } | null)?.endpoint;
          reply(200, { ok: true, removed: typeof endpoint === 'string' && this.unsubscribe(endpoint) });
        }
      } catch (e) {
        warn(`notify: ${pathname}: ${(e as Error).message}`);
        reply(500, { error: 'server error' });
      }
    });
    return true;
  }
}
