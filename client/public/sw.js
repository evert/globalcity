// GlobalCity service worker: an offline fallback for page loads, and the "new world is open" notification.
// It never caches the game itself, so new builds still arrive straight away (the client's auto-update keeps
// working). The offline page is required for the Android app (Trusted Web Activity), which Google expects to
// show something useful without a connection.
const CACHE = 'globalcity-offline-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, '/icons/icon-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // assets, the WebSocket and API calls go straight to the network
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});

// World reset notification (server/src/notify.ts). The server's pushes carry no payload, so the text lives here;
// a push with a JSON payload { title, body, url } is shown as given.
const RESET_NOTIFICATION = {
  title: 'The new GlobalCity world is open!',
  body: 'Four times the land, new biomes and natural disasters. Claim your spot before the best ones are taken.',
  url: '/',
};

self.addEventListener('push', (e) => {
  let msg = RESET_NOTIFICATION;
  try { if (e.data) msg = { ...RESET_NOTIFICATION, ...e.data.json() }; } catch { /* not JSON: use the default */ }
  e.waitUntil(self.registration.showNotification(msg.title, {
    body: msg.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: 'world-reset',
    data: { url: msg.url },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = open.find((c) => new URL(c.url).origin === self.location.origin);
    if (tab) { await tab.focus(); if ('navigate' in tab) await tab.navigate(url).catch(() => {}); return; }
    await self.clients.openWindow(url);
  })());
});
