// World reset notifications: the reset time, sign-ups, and the pushes sent to a fake push service, signed with
// the server's VAPID key. Run with:
//   npm test -w server -- notify   (starts a throwaway server; see test/run-all.sh)
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const PORT = process.env.PORT, BASE = `http://127.0.0.1:${PORT}`;
const fail = (m) => { console.log('FAIL:', m); process.exit(1); };
const ok = (c, m) => { if (!c) fail(m); console.log('ok', m); };
const token = fs.readFileSync(path.join(process.env.DATA_DIR, 'admin-token'), 'utf8').trim();
const post = (p, body, admin = false) => fetch(BASE + p, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(admin ? { 'x-admin-token': token } : {}) },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
const admin = (p) => fetch(BASE + p, { headers: { 'x-admin-token': token } }).then((r) => r.json());

// the reset time and the key subscriptions are made with
const info = await (await fetch(BASE + '/api/world-reset')).json();
ok(typeof info.at === 'number' && info.at > Date.parse('2026-01-01'), `reset at ${new Date(info.at).toISOString()}`);
const key = Buffer.from(info.vapidKey, 'base64url');
ok(key.length === 65 && key[0] === 4, 'VAPID public key is an uncompressed P-256 point');
const pub = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64(key.subarray(1, 33)), y: b64(key.subarray(33)) } });
function b64(b) { return Buffer.from(b).toString('base64url'); }

// a fake push service: /live accepts pushes, /gone says the subscription expired
const got = [];
const push = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => { got.push({ url: req.url, headers: req.headers, body }); res.writeHead(req.url.startsWith('/gone') ? 410 : 201); res.end(); });
});
await new Promise((r) => push.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${push.address().port}`;
const sub = (p, app = 'desktop') => ({ endpoint: origin + p, expirationTime: null, keys: { p256dh: b64(crypto.randomBytes(65)), auth: b64(crypto.randomBytes(16)) }, app });

ok((await post('/api/notify', { endpoint: 'not a url' })).status === 400, 'rejects a bad endpoint');
ok((await post('/api/notify', { endpoint: 'ftp://127.0.0.1/x' })).status === 400, 'rejects a non-http endpoint');
ok((await post('/api/notify', sub('/live/1', 'android-app'))).status === 200, 'subscribes from the Android app');
ok((await post('/api/notify', sub('/live/1', 'android-app'))).status === 200, 'subscribing again is fine');
ok((await post('/api/notify', sub('/live/2'))).status === 200, 'subscribes a desktop browser');
ok((await post('/api/notify', sub('/gone/3', 'weird'))).status === 200, 'subscribes an unknown app as other');
ok((await post('/api/notify', sub('/live/4'))).status === 200, 'subscribes one more');
ok((await post('/api/notify/remove', { endpoint: origin + '/live/4' })).body.removed === true, 'unsubscribes');

let st = await admin('/admin/notify');
ok(st.total === 3 && st.byApp['android-app'] === 1 && st.byApp.desktop === 1 && st.byApp.other === 1 && st.sent === 0, `admin sees the sign-ups: ${JSON.stringify(st)}`);
ok((await fetch(BASE + '/admin/notify')).status === 404, 'admin needs the token');

// move the reset; clear it; put it back
let r = await post('/admin/reset-at', { at: '2026-12-10T12:00:00-05:00' }, true);
ok(r.body.resetAt === '2026-12-10T17:00:00.000Z', 'admin moves the reset');
ok((await (await fetch(BASE + '/api/world-reset')).json()).at === Date.parse('2026-12-10T17:00:00Z'), 'players see the new time');
await post('/admin/reset-at', { at: 'none' }, true);
ok((await (await fetch(BASE + '/api/world-reset')).json()).at === null, 'no reset planned');
ok((await post('/admin/reset-at', { at: 'next tuesday' }, true)).status === 400, 'rejects a date it cannot read');
await post('/admin/reset-at', { at: info.at }, true);

// send
r = await post('/admin/notify-reset', {}, true);
ok(r.status === 200 && r.body.sent === 2 && r.body.removed === 1 && r.body.failed === 0, `sends: ${JSON.stringify(r.body)}`);
ok(got.length === 3, 'the push service got three pushes');
for (const g of got) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(g.headers.authorization ?? '');
  if (!m) fail(`no VAPID header: ${g.headers.authorization}`);
  const [h, p, s] = m[1].split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  if (m[2] !== info.vapidKey) fail('wrong k');
  if (claims.aud !== origin) fail(`aud ${claims.aud}`);
  if (!(claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 86400)) fail('bad exp');
  if (!/^(mailto:|https:)/.test(claims.sub)) fail('bad sub');
  if (!crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))) fail('bad signature');
  if (!(Number(g.headers.ttl) > 0) || g.body !== '') fail('bad TTL or a body');
}
ok(true, 'every push is signed with the VAPID key and has no payload');
st = await admin('/admin/notify');
ok(st.total === 2 && st.sent === 2, 'the expired subscription is gone, the others are marked sent');
r = await post('/admin/notify-reset', {}, true);
ok(r.body.sent === 0 && r.body.skipped === 2 && got.length === 3, 'sending again skips those already notified');
r = await post('/admin/notify-reset', { again: true }, true);
ok(r.body.sent === 2 && got.length === 5, 'again: true notifies everyone again');

push.close();
console.log('PASS');
