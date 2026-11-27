// Bootstrap: load assets, wire net <-> state <-> map <-> renderer <-> ui <-> input.
import type { ChunkFrame, ServerMsg } from '@globalcity/shared';
import { chunkKey, configureWorld } from '@globalcity/shared';
import { Actions } from './actions.ts';
import { handleServerMsg } from './dispatch.ts';
import { loadSpriteSheet, loadSkinSheet, proceduralMinimap } from './assets.ts';
import { Updater } from './updater.ts';
import { Input, PAINT_TOOLS, ZONE_TOOLS } from './input.ts';
import { TileMap } from './map.ts';
import { Net } from './net.ts';
import { ViewReporter } from './presence.ts';
import { Renderer } from './renderer.ts';
import { AppState } from './state.ts';
import { UI } from './ui.ts';
import { installLongPressTooltips } from './longpress.ts';
import { loadSprites, SpriteEngine } from './sprites.ts';
import { Precipitation } from './weather.ts';

/** Shareable view links: #x=4207&y=855&z=1 (tile coords of the view centre + zoom). */
function applyHashCamera(renderer: Renderer): boolean {
  const m = /^#?(.*)$/.exec(location.hash);
  if (!m) return false;
  const q = new URLSearchParams(m[1]);
  const x = Number(q.get('x')),
    y = Number(q.get('y')),
    z = Number(q.get('z'));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || z <= 0) return false;
  renderer.setCamera(x, y, z);
  return true;
}

function writeHashCamera(cam: { x: number; y: number; zoom: number }): void {
  if (cam.zoom < 0.125) {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    return;
  }
  const h = `#x=${Math.round(cam.x)}&y=${Math.round(cam.y)}&z=${+cam.zoom.toFixed(4)}`;
  if (h !== location.hash) history.replaceState(null, '', h);
}

/** A line of text in the middle of the page while the game waits for the server (before any UI exists). */
function bootNotice(): HTMLElement {
  const d = document.createElement('div');
  d.id = 'bootnotice';
  d.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;color:#9fb3c8;font-family:system-ui,sans-serif;pointer-events:none';
  d.textContent = 'Connecting…';
  document.body.append(d);
  return d;
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

  // Connect first, while the assets load: the world's size comes with the welcome, and nothing that depends on it
  // (the map, the camera, the zoomed-out map) can be built before it is known. What the server sends meanwhile is
  // kept and handled once everything is built. (The demos play offline on the default size.)
  const net = new Net();
  const early: ({ msg: ServerMsg } | { chunk: ChunkFrame })[] = [];
  const offEarly = [net.on('msg', (msg) => early.push({ msg })), net.on('chunk', (chunk) => early.push({ chunk }))];
  let sized: Promise<void> = Promise.resolve();
  if (!demo) {
    const waiting = bootNotice();
    const offStatus = net.on('status', (s) => (waiting.textContent = s));
    sized = new Promise((resolve) => {
      const off = net.on('msg', (msg) => {
        if (msg.t !== 'welcome') return;
        configureWorld(msg.world.w, msg.world.h);
        off();
        offStatus();
        waiting.remove();
        resolve();
      });
    });
    net.connect();
  }

  const [[sheet, skins, spriteAssets]] = await Promise.all([Promise.all([loadSpriteSheet(), loadSkinSheet(), loadSprites()]), sized]);
  // the corner minimap starts plain and becomes the server's whole-world map image once that loads
  const minimap = proceduralMinimap();

  const state = new AppState();
  const map = new TileMap();
  const renderer = new Renderer(canvas, sheet, minimap, map, state);
  renderer.skins = skins;
  renderer.sprites = new SpriteEngine(map, spriteAssets);
  document.addEventListener('visibilitychange', () => renderer.invalidate()); // sprites pause while hidden, resume on return
  renderer.resizeToWindow();
  new Precipitation(canvas, renderer, renderer.weather);
  if (!applyHashCamera(renderer)) renderer.showWorld();
  const actions = new Actions(state, net, renderer);
  const ui = new UI(state, net, renderer, actions, sheet, minimap);
  installLongPressTooltips();
  const input = new Input(renderer, state, actions, {
    onQueryClick: (x, y) => ui.queryPendingAt(x, y),
    onVehicleClick: (v, x, y) => ui.showVehicle(v, x, y),
    onClearOverlay: () => ui.clearOverlay(),
    onInteract: () => ui.hideQuery(),
    onTouchTarget: (t) => ui.setTouchTarget(t),
    onTouchPlan: (p) => ui.setTouchPlan(p),
  });

  window.addEventListener('resize', () => renderer.resizeToWindow());
  renderer.mapTiles.onUpdate = () => renderer.invalidate();
  renderer.mapTiles.onWorldImage = (img) => {
    Object.assign(minimap, { image: img, width: img.width, height: img.height, procedural: false });
    ui.refreshMinimap();
  };
  renderer.mapTiles.maybeRefresh();
  window.visualViewport?.addEventListener('resize', () => renderer.resizeToWindow());
  // fires after layout, with the size the canvas really has (resize events can come before it settles)
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => renderer.syncSize()).observe(canvas);
  ui.onTouchBuild = () => input.confirmTouch();
  ui.onTouchCancel = () => input.clearTouchTarget();
  state.on('tool', () => {
    input.clearTouchTarget();
    // once, on a touch screen: how drawing and moving the map work with a drawing tool
    const tool = state.tool;
    if (!(PAINT_TOOLS.has(tool) || ZONE_TOOLS.has(tool)) || !window.matchMedia('(pointer: coarse)').matches) return;
    try {
      if (localStorage.getItem('globalcity.drawHint')) return;
      localStorage.setItem('globalcity.drawHint', '1');
    } catch {
      /* no storage: show it anyway */
    }
    ui.toast('Draw with one finger · move the map with two', 'info', 6000);
  });

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
  renderer.on('touchCursor', () => view.poke());
  state.on('me', (me) => {
    if (me) {
      view.reset();
      view.sendNow();
    }
  });

  // ---- network ----
  // Net re-sends hello + the stored subscription itself on (re)connect; just refresh the desired set.
  net.on('open', () => {
    actions.predictor.clear();
    state.setConnected(true);
    updateSubscription();
  });
  net.on('close', () => state.setConnected(false));
  net.on('chunk', ({ cx, cy, tiles }) => map.setChunk(cx, cy, tiles));
  const updater = new Updater(__BUILD_VERSION__, (reload) => ui.showUpdateBanner(reload));
  const targets = { state, map, renderer, ui, updater, predictor: actions.predictor };
  net.on('msg', (msg: ServerMsg) => handleServerMsg(msg, targets));
  // what came before everything was built (the welcome and what followed it), in order
  for (const off of offEarly) off();
  if (net.connected) {
    actions.predictor.clear();
    state.setConnected(true);
    updateSubscription();
  }
  for (const e of early.splice(0)) {
    if ('msg' in e) handleServerMsg(e.msg, targets);
    else map.setChunk(e.chunk.cx, e.chunk.cy, e.chunk.tiles);
  }
  if (demo) {
    // offline demo with synthetic data (for screenshots / eyeballing the leaderboard / social UI)
    const { demoLeaderboard, demoSocial, demoAmbient } = await import('./selftest.ts');
    if (location.hash === '#demo-ambient') demoAmbient(targets);
    else if (location.hash.startsWith('#demo-social')) demoSocial(targets, location.hash.endsWith('-overview'));
    else demoLeaderboard(targets);
  }

  // expose for debugging in the console
  (window as unknown as { gc: unknown }).gc = { state, map, net, renderer, actions, ui };
}

// Offline fallback page (and what makes the game installable as an Android app); not during self-tests.
if ('serviceWorker' in navigator && !location.hash.startsWith('#selftest')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* not fatal */
    });
  });
}

boot().catch((err) => {
  console.error(err);
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;color:#ff5f5f;font-family:monospace;background:#0b0f17';
  d.textContent = `GlobalCity failed to start: ${(err as Error).message}`;
  document.body.append(d);
});
