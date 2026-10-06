// Bootstrap: load assets, wire net <-> state <-> map <-> renderer <-> ui <-> input.
import type { ServerMsg } from '@globalcity/shared';
import { chunkKey } from '@globalcity/shared';
import { Actions } from './actions.ts';
import { handleServerMsg } from './dispatch.ts';
import { loadMinimap, loadSpriteSheet } from './assets.ts';
import { recolourMinimap } from './overviewmap.ts';
import { Updater } from './updater.ts';
import { Input } from './input.ts';
import { TileMap } from './map.ts';
import { Net } from './net.ts';
import { ViewReporter } from './presence.ts';
import { Renderer } from './renderer.ts';
import { AppState } from './state.ts';
import { UI } from './ui.ts';
import { loadSprites, SpriteEngine } from './sprites.ts';

/** Shareable view links: #x=4207&y=855&z=1 (tile coords of the view centre + zoom). */
function applyHashCamera(renderer: Renderer): boolean {
  const m = /^#?(.*)$/.exec(location.hash);
  if (!m) return false;
  const q = new URLSearchParams(m[1]);
  const x = Number(q.get('x')), y = Number(q.get('y')), z = Number(q.get('z'));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || z <= 0) return false;
  renderer.setCamera(x, y, z);
  return true;
}

function writeHashCamera(cam: { x: number; y: number; zoom: number }): void {
  if (cam.zoom < 0.125) { if (location.hash) history.replaceState(null, '', location.pathname + location.search); return; }
  const h = `#x=${Math.round(cam.x)}&y=${Math.round(cam.y)}&z=${+cam.zoom.toFixed(4)}`;
  if (h !== location.hash) history.replaceState(null, '', h);
}

async function boot(): Promise<void> {
  if (location.hash === '#selftest') {
    const { runSelfTest } = await import('./selftest.ts');
    await runSelfTest();
    return;
  }
  const demo = location.hash === '#demo-leaderboard' || location.hash.startsWith('#demo-social') || location.hash === '#demo-ambient';
  const canvas = document.getElementById('map') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('#map canvas missing');

  const [sheet, minimap, spriteAssets] = await Promise.all([loadSpriteSheet(), loadMinimap(), loadSprites()]);
  // Recolour the terrain once to the Micropolis tile palette; the world view and the corner minimap share it.
  if (!minimap.procedural) {
    try { minimap.image = recolourMinimap(minimap.image, minimap.width, minimap.height); } catch { /* keep the original colours */ }
  }

  const state = new AppState();
  const map = new TileMap();
  const net = new Net();
  const renderer = new Renderer(canvas, sheet, minimap, map, state);
  renderer.sprites = new SpriteEngine(map, spriteAssets);
  document.addEventListener('visibilitychange', () => renderer.invalidate()); // sprites pause while hidden, resume on return
  renderer.resizeToWindow();
  if (!applyHashCamera(renderer)) renderer.showWorld();
  const actions = new Actions(state, net, renderer);
  const ui = new UI(state, net, renderer, actions, sheet, minimap);
  const input = new Input(renderer, state, actions, {
    onQueryClick: (x, y) => ui.queryPendingAt(x, y),
    onVehicleClick: (v, x, y) => ui.showVehicle(v, x, y),
    onClearOverlay: () => ui.clearOverlay(),
    onInteract: () => ui.hideQuery(),
    onTouchTarget: (t) => ui.setTouchTarget(t),
  });

  window.addEventListener('resize', () => renderer.resizeToWindow());
  renderer.overviewMap.onUpdate = () => renderer.invalidate();
  window.visualViewport?.addEventListener('resize', () => renderer.resizeToWindow());
  ui.onTouchBuild = () => input.buildAtHover();
  ui.onTouchCancel = () => input.clearTouchTarget();
  state.on('tool', () => input.clearTouchTarget());

  // ---- subscriptions follow the camera ----
  let lastSubKey = '';
  const updateSubscription = (): void => {
    const chunks = renderer.desiredSubscription();
    const key = chunks.map(([x, y]) => `${x},${y}`).join(';');
    if (key === lastSubKey) return;
    lastSubKey = key;
    renderer.subscribed = new Set(chunks.map(([x, y]) => chunkKey(x, y)));
    net.setSubscription(chunks);
    renderer.invalidate();
  };
  renderer.on('settle', updateSubscription);
  renderer.on('settle', (cam) => writeHashCamera(cam));

  // ---- presence: tell the server where we look / point (max 4/s) ----
  const view = new ViewReporter(net, renderer);
  renderer.on('camera', () => view.poke());
  renderer.on('hover', () => view.poke());
  state.on('me', (me) => { if (me) { view.reset(); view.sendNow(); } });

  // ---- network ----
  // Net re-sends hello + the stored subscription itself on (re)connect; just refresh the desired set.
  net.on('open', () => { state.setConnected(true); updateSubscription(); });
  net.on('close', () => state.setConnected(false));
  net.on('chunk', ({ cx, cy, tiles }) => map.setChunk(cx, cy, tiles));
  const updater = new Updater(__BUILD_VERSION__, (reload) => ui.showUpdateBanner(reload));
  const targets = { state, map, renderer, ui, updater };
  net.on('msg', (msg: ServerMsg) => handleServerMsg(msg, targets));
  if (demo) {
    // offline demo with synthetic data (for screenshots / eyeballing the leaderboard / social UI)
    const { demoLeaderboard, demoSocial, demoAmbient } = await import('./selftest.ts');
    if (location.hash === '#demo-ambient') demoAmbient(targets);
    else if (location.hash.startsWith('#demo-social')) demoSocial(targets, location.hash.endsWith('-overview'));
    else demoLeaderboard(targets);
  } else {
    net.connect();
  }

  // expose for debugging in the console
  (window as unknown as { gc: unknown }).gc = { state, map, net, renderer, actions, ui };
}

// Offline fallback page (and what makes the game installable as an Android app); not during self-tests.
if ('serviceWorker' in navigator && !location.hash.startsWith('#selftest')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* not fatal */ }); });
}

boot().catch((err) => {
  console.error(err);
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;color:#ff5f5f;font-family:monospace;background:#0b0f17';
  d.textContent = `GlobalCity failed to start: ${(err as Error).message}`;
  document.body.append(d);
});
