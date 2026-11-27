// World reset notifications: the reset time, sign-ups, and the pushes sent to a fake push service, signed with
// the server's VAPID key.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetServer, server, httpUrl } from './support/client.ts';

const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
type Json = Record<string, any>; // oxlint-disable-line typescript/no-explicit-any -- loose JSON from the API

describe('world reset notifications', () => {
  let BASE: string, token: string;
  let info: { at: number; vapidKey: string };
  let pub: crypto.KeyObject;
  let origin: string;
  const got: { url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
  // a fake push service: /live accepts pushes, /gone says the subscription expired
  const push = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      got.push({ url: req.url ?? '', headers: req.headers, body });
      res.writeHead(req.url?.startsWith('/gone') ? 410 : 201);
      res.end();
    });
  });
  const post = (p: string, body: unknown, admin = false): Promise<{ status: number; body: Json }> =>
    fetch(BASE + p, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(admin ? { 'x-admin-token': token } : {}) },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: (await r.json()) as Json }));
  const admin = (p: string): Promise<Json> => fetch(BASE + p, { headers: { 'x-admin-token': token } }).then((r) => r.json() as Promise<Json>);
  const sub = (p: string, app = 'desktop'): Json => ({
    endpoint: origin + p,
    expirationTime: null,
    keys: { p256dh: b64(crypto.randomBytes(65)), auth: b64(crypto.randomBytes(16)) },
    app,
  });

  beforeAll(async () => {
    await resetServer();
    BASE = httpUrl();
    token = fs.readFileSync(path.join(server().dataDir, 'admin-token'), 'utf8').trim();
    await new Promise<void>((r) => push.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${(push.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    push.close();
  });

  it('publishes the reset time and the VAPID key', async () => {
    info = (await (await fetch(BASE + '/api/world-reset')).json()) as typeof info;
    expect(typeof info.at).toBe('number');
    expect(info.at).toBeGreaterThan(Date.parse('2026-01-01'));
    const key = Buffer.from(info.vapidKey, 'base64url');
    expect(key.length, 'VAPID public key is an uncompressed P-256 point').toBe(65);
    expect(key[0]).toBe(4);
    pub = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64(key.subarray(1, 33)), y: b64(key.subarray(33)) } });
  });

  it('takes sign-ups', async () => {
    expect((await post('/api/notify', { endpoint: 'not a url' })).status, 'rejects a bad endpoint').toBe(400);
    expect((await post('/api/notify', { endpoint: 'ftp://127.0.0.1/x' })).status, 'rejects a non-http endpoint').toBe(400);
    expect((await post('/api/notify', sub('/live/1', 'android-app'))).status, 'subscribes from the Android app').toBe(200);
    expect((await post('/api/notify', sub('/live/1', 'android-app'))).status, 'subscribing again is fine').toBe(200);
    expect((await post('/api/notify', sub('/live/2'))).status, 'subscribes a desktop browser').toBe(200);
    expect((await post('/api/notify', sub('/gone/3', 'weird'))).status, 'subscribes an unknown app as other').toBe(200);
    expect((await post('/api/notify', sub('/live/4'))).status, 'subscribes one more').toBe(200);
    expect((await post('/api/notify/remove', { endpoint: origin + '/live/4' })).body.removed, 'unsubscribes').toBe(true);
    const st = await admin('/admin/notify');
    expect(st, 'admin sees the sign-ups').toMatchObject({ total: 3, sent: 0, byApp: { 'android-app': 1, desktop: 1, other: 1 } });
    expect((await fetch(BASE + '/admin/notify')).status, 'admin needs the token').toBe(404);
  });

  it('lets the admin move the reset, clear it and put it back', async () => {
    const r = await post('/admin/reset-at', { at: '2026-12-10T12:00:00-05:00' }, true);
    expect(r.body.resetAt, 'admin moves the reset').toBe('2026-12-10T17:00:00.000Z');
    expect(((await (await fetch(BASE + '/api/world-reset')).json()) as Json).at, 'players see the new time').toBe(Date.parse('2026-12-10T17:00:00Z'));
    await post('/admin/reset-at', { at: 'none' }, true);
    expect(((await (await fetch(BASE + '/api/world-reset')).json()) as Json).at, 'no reset planned').toBeNull();
    expect((await post('/admin/reset-at', { at: 'next tuesday' }, true)).status, 'rejects a date it cannot read').toBe(400);
    await post('/admin/reset-at', { at: info.at }, true);
  });

  it('sends signed pushes without a payload', async () => {
    let r = await post('/admin/notify-reset', {}, true);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sent: 2, removed: 1, failed: 0 });
    expect(got.length, 'the push service got three pushes').toBe(3);
    for (const g of got) {
      const m = /^vapid t=([^,]+), k=(.+)$/.exec(g.headers.authorization ?? '');
      expect(m, `VAPID header: ${g.headers.authorization}`).not.toBeNull();
      const [h, p, s] = m![1].split('.');
      const claims = JSON.parse(Buffer.from(p, 'base64url').toString()) as Json;
      expect(m![2], 'k').toBe(info.vapidKey);
      expect(claims.aud).toBe(origin);
      expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
      expect(claims.exp).toBeLessThan(Date.now() / 1000 + 86400);
      expect(claims.sub).toMatch(/^(mailto:|https:)/);
      expect(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), 'signature').toBe(true);
      expect(Number(g.headers.ttl), 'TTL').toBeGreaterThan(0);
      expect(g.body, 'no payload').toBe('');
    }
    const st = await admin('/admin/notify');
    expect(st, 'the expired subscription is gone, the others are marked sent').toMatchObject({ total: 2, sent: 2 });
    r = await post('/admin/notify-reset', {}, true);
    expect(r.body, 'sending again skips those already notified').toMatchObject({ sent: 0, skipped: 2 });
    expect(got.length).toBe(3);
    r = await post('/admin/notify-reset', { again: true }, true);
    expect(r.body.sent, 'again: true notifies everyone again').toBe(2);
    expect(got.length).toBe(5);
  });
});
