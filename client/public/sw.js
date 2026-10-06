// GlobalCity service worker: only an offline fallback for page loads. It never caches the game itself, so
// new builds still arrive straight away (the client's auto-update keeps working). Required for the Android
// app (Trusted Web Activity), which Google expects to show something useful without a connection.
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
