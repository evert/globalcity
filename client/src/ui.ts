// DOM overlay: top bar, toolbar, RCI, toasts, query popover, welcome/about panels, minimap widget.
import type { ClaimInfo, Demand, LeaderboardEntry, QueryInfo, ToolId } from '@globalcity/shared';
import { CHUNK, EXTRA_CLAIM_COST, MAX_CHUNKS_PER_PLAYER, POWER_PRICE_PER_UNIT, TOOLS, TOOL_ORDER, WORLD_H, WORLD_W, chunkOf, lonLatToTile } from '@globalcity/shared';
import type { Actions } from './actions.ts';
import type { Minimap, SpriteSheet } from './assets.ts';
import { drawTile } from './assets.ts';
import type { Net } from './net.ts';
import type { Renderer } from './renderer.ts';
import { isFireTile, withAlpha } from './renderer.ts';
import type { AppState } from './state.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WELCOMED_KEY = 'globalcity.welcomed';
const TOAST_DEDUP_MS = 3000;
const POWER_TRADE_HELP = 'Power flows over wires across plot borders; surplus is sold at $1 per unit per month.';
export const NEIGHBOUR_HELP = "Neighbouring cities' jobs and shoppers add demand across the border; rail connecting your zones to theirs boosts commerce.";

export type ToastKind = 'info' | 'error' | 'success';
export interface ToastAt { x: number; y: number }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

export function fmtMoney(n: number): string {
  const s = Math.abs(Math.round(n)).toLocaleString('en-US');
  return (n < 0 ? '-$' : '$') + s;
}
export function fmtDate(year: number, month: number): string { return `${MONTHS[((month % 12) + 12) % 12]} ${year}`; }

export class UI {
  readonly root: HTMLElement;
  private funds!: HTMLElement; private pop!: HTMLElement; private date!: HTMLElement; private online!: HTMLElement;
  private nameBtn!: HTMLButtonElement; private cityNameBtn!: HTMLButtonElement; private plots!: HTMLElement; private plotsStat!: HTMLElement;
  private status!: HTMLElement; private offline!: HTMLElement;
  private claimBtn!: HTMLButtonElement; private findBtn!: HTMLButtonElement; private cityBtn!: HTMLButtonElement; private worldBtn!: HTMLButtonElement;
  private toolButtons = new Map<ToolId, HTMLButtonElement>();
  private rciBars!: Record<'r' | 'c' | 'i', HTMLElement>; private rciBoost!: Record<'r' | 'c' | 'i', HTMLElement>;
  private powerText!: HTMLElement; private stationsText!: HTMLElement; private tradeText!: HTMLElement; private neighbourText!: HTMLElement;
  private toasts!: HTMLElement; private lastToast: { msg: string; kind: ToastKind; el: HTMLElement; at: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private leaderboard!: HTMLElement; private lbRows!: HTMLElement; private lbMe!: HTMLElement; private lbBtn!: HTMLButtonElement;
  private fireBtn!: HTMLButtonElement; private fireCycle = 0;
  private query!: HTMLElement; private queryPos = { x: 0, y: 0 }; private queryTimer: ReturnType<typeof setTimeout> | null = null; private queryPending = false;
  private welcome!: HTMLElement; private welcomeStatus!: HTMLElement; private welcomeDismissed = false; private welcomeMode: 'idle' | 'locating' | 'pick' = 'idle';
  /** we saw this player with zero plots this session, so the next plot is a founding */
  private sawNoPlots = false; private foundedToastShown = false;
  private about!: HTMLElement;
  private mini!: HTMLCanvasElement; private miniDirty = true;

  constructor(
    readonly state: AppState,
    readonly net: Net,
    readonly renderer: Renderer,
    readonly actions: Actions,
    readonly sheet: SpriteSheet,
    readonly minimap: Minimap,
  ) {
    this.root = document.getElementById('ui') ?? document.body.appendChild(el('div', { id: 'ui' }));
    this.buildTopBar();
    this.buildToolbar();
    this.buildRci();
    this.toasts = el('div', { id: 'toasts' });
    this.query = el('div', { id: 'query', class: 'panel hidden' });
    this.buildWelcome();
    this.buildAbout();
    this.buildLeaderboard();
    this.buildMinimap();
    this.root.append(this.toasts, this.query);
    this.bind();
    this.refreshAll();
    this.measureOverlay();
    window.addEventListener('resize', () => this.measureOverlay());
  }

  // ---------- construction ----------
  private buildTopBar(): void {
    this.funds = el('span', { class: 'val', text: '$0' });
    this.pop = el('span', { class: 'val', text: '0' });
    this.date = el('span', { class: 'val', text: fmtDate(this.state.time.year, this.state.time.month) });
    this.online = el('span', { class: 'val', text: '0' });
    this.status = el('span', { id: 'status', class: 'status', text: 'Connecting…' });
    this.nameBtn = el('button', { class: 'btn ghost', id: 'nameBtn', title: 'Click to rename' }, '…');
    this.nameBtn.onclick = () => this.promptRename();
    this.cityNameBtn = el('button', { class: 'btn ghost city hidden', id: 'cityNameBtn', title: 'Your city — click to rename' }, '');
    this.cityNameBtn.onclick = () => this.promptRenameCity();
    this.plots = el('span', { class: 'val', text: `0/${MAX_CHUNKS_PER_PLAYER}` });
    this.plotsStat = el('div', { class: 'stat hidden', id: 'plots', title: `Plots claimed (a city is at most ${MAX_CHUNKS_PER_PLAYER} plots)` }, el('span', { class: 'ico' }, 'Plots'), this.plots);
    this.claimBtn = el('button', { class: 'btn primary hidden', id: 'claimBtn' }, 'Claim this plot');
    this.claimBtn.onclick = () => this.claimCenter();
    this.findBtn = el('button', { class: 'btn hidden', id: 'findBtn', title: 'Ask the server for the nearest free plot' }, 'Find free plot');
    this.findBtn.onclick = () => this.findFree();
    this.cityBtn = el('button', { class: 'btn hidden', id: 'cityBtn', title: 'Fly to your city (G)' }, 'Go to my city');
    this.cityBtn.onclick = () => this.actions.goToMyCity();
    this.worldBtn = el('button', { class: 'btn', id: 'worldBtn', title: 'Show the whole world (H)' }, 'World');
    this.worldBtn.onclick = () => this.renderer.showWorld();
    this.lbBtn = el('button', { class: 'btn', id: 'lbBtn', title: 'Leaderboard: the most populous cities on the planet' }, '🏆 Top cities');
    this.lbBtn.onclick = () => this.toggleLeaderboard();
    this.fireBtn = el('button', { class: 'btn fire hidden', id: 'fireBtn', title: 'Your city is burning! Click to jump to the next fire.' }, '🔥 0 fires');
    this.fireBtn.onclick = () => this.nextFire();
    const aboutBtn = el('button', { class: 'btn ghost round', id: 'aboutBtn', title: 'About & attribution' }, 'ⓘ');
    aboutBtn.onclick = () => this.toggle(this.about);
    const bar = el('div', { id: 'topbar' },
      el('div', { class: 'brand' }, 'GlobalCity'),
      el('div', { class: 'stat', title: 'Funds' }, el('span', { class: 'ico' }, '$'), this.funds),
      el('div', { class: 'stat', title: 'Population' }, el('span', { class: 'ico' }, '👥'), this.pop),
      el('div', { class: 'stat', title: 'Date' }, el('span', { class: 'ico' }, '📅'), this.date),
      el('div', { class: 'stat', title: 'Players online' }, el('span', { class: 'ico' }, '●'), this.online),
      this.plotsStat,
      this.claimBtn, this.findBtn, this.cityBtn, this.worldBtn, this.lbBtn, this.fireBtn,
      el('div', { class: 'spacer' }),
      this.status, this.cityNameBtn, this.nameBtn, aboutBtn,
    );
    this.offline = el('div', { id: 'offline', class: 'hidden' }, 'Connecting to server…');
    this.root.append(bar, this.offline);
  }

  /** Tell the renderer how much of the left / top edge the fixed UI covers, so chunk labels stay readable. */
  measureOverlay(): void {
    const toolbar = this.root.querySelector<HTMLElement>('#toolbar'), topbar = this.root.querySelector<HTMLElement>('#topbar');
    const tb = toolbar?.getBoundingClientRect(), hb = topbar?.getBoundingClientRect();
    // the toolbar sits along the left edge on desktop, along the bottom on phones
    const left = tb && tb.width > 0 && tb.top < window.innerHeight / 2 && tb.right < window.innerWidth / 2 ? tb.right : 0;
    const top = hb && hb.height > 0 ? hb.bottom : 0;
    this.renderer.overlayInset = { left, top };
  }

  private buildToolbar(): void {
    const bar = el('div', { id: 'toolbar' });
    for (const id of TOOL_ORDER) {
      const t = TOOLS[id];
      const icon = el('canvas', { class: 'icon', width: '32', height: '32' });
      const g = icon.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      drawTile(g, this.sheet, t.icon, 0, 0, 32, 32);
      const cost = t.cost ? fmtMoney(t.cost) : 'free';
      const btn = el('button', { class: 'tool', 'data-tool': id, title: `${t.name} — ${cost} (${t.hotkey.toUpperCase()})`, 'aria-label': t.name },
        icon,
        el('span', { class: 'key', text: t.hotkey.toUpperCase() }),
        el('span', { class: 'label', text: t.name }),
        el('span', { class: 'cost', text: t.cost ? fmtMoney(t.cost) : '' }),
      );
      btn.onclick = () => this.state.setTool(id);
      this.toolButtons.set(id, btn);
      bar.append(btn);
    }
    this.root.append(bar);
  }

  private buildRci(): void {
    const mk = (cls: string, label: string) => {
      const fill = el('div', { class: 'fill' });
      const boost = el('div', { class: 'boost', title: NEIGHBOUR_HELP }); // lighter tip: the share coming from neighbours / rail
      const bar = el('div', { class: `bar ${cls}` }, el('div', { class: 'mid' }), fill, boost);
      return { fill, boost, wrap: el('div', { class: 'rci-col' }, bar, el('span', { class: 'lbl', text: label })) };
    };
    const r = mk('r', 'R'), c = mk('c', 'C'), i = mk('i', 'I');
    this.rciBars = { r: r.fill, c: c.fill, i: i.fill };
    this.rciBoost = { r: r.boost, c: c.boost, i: i.boost };
    this.powerText = el('span', { class: 'power', text: '⚡ 0 / 0' });
    this.stationsText = el('span', { class: 'stations hidden', title: 'Powered fire stations (each protects 12 tiles around it)' }, '🚒 0 stations');
    this.tradeText = el('div', { class: 'trade hidden', id: 'powerTrade', title: POWER_TRADE_HELP });
    this.neighbourText = el('div', { class: 'neighbours hidden', id: 'neighbours', title: NEIGHBOUR_HELP });
    const box = el('div', { id: 'rci', class: 'panel', title: 'Residential / Commercial / Industrial demand' },
      el('div', { class: 'rci-bars' }, r.wrap, c.wrap, i.wrap),
      el('div', { class: 'power-line' }, this.powerText, this.stationsText),
      this.tradeText,
      this.neighbourText);
    this.root.append(box);
  }

  private buildWelcome(): void {
    this.welcomeStatus = el('div', { class: 'wstatus' });
    const locBtn = el('button', { class: 'btn primary' }, '📍 Use my location');
    locBtn.onclick = () => this.useMyLocation();
    const pickBtn = el('button', { class: 'btn' }, '🗺 Pick a spot on the map');
    pickBtn.onclick = () => this.pickOnMap();
    const freeBtn = el('button', { class: 'btn' }, '✨ Find nearest free plot');
    freeBtn.onclick = () => this.findFree();
    const close = el('button', { class: 'btn ghost round close', title: 'Close' }, '×');
    close.onclick = () => { this.welcomeDismissed = true; this.hide(this.welcome); };
    this.welcome = el('div', { id: 'welcome', class: 'panel card hidden' },
      close,
      el('h2', { text: 'Welcome to GlobalCity' }),
      el('p', { text: 'The whole Earth is one giant SimCity map shared by everyone online. Claim a 64×64 plot (your first one is free), then zone, wire and pave it to grow a city — neighbours can build right next to you. Zoom in to build, zoom out to see every city on the planet.' }),
      el('div', { class: 'row' }, locBtn, pickBtn, freeBtn),
      this.welcomeStatus,
    );
    this.root.append(this.welcome);
  }

  private buildAbout(): void {
    const close = el('button', { class: 'btn ghost round close', title: 'Close' }, '×');
    close.onclick = () => this.hide(this.about);
    const link = (href: string, text: string) => { const a = el('a', { href, target: '_blank', rel: 'noopener' }, text); return a; };
    this.about = el('div', { id: 'about', class: 'panel card hidden' },
      close,
      el('h2', { text: 'About GlobalCity' }),
      el('p', {}, 'A massively multiplayer SimCity-classic style game on a tile map of the whole Earth.'),
      el('p', {}, 'Tile artwork is from ', link('https://github.com/SimHacker/micropolis', 'Micropolis'),
        ', the GPLv3 release of SimCity Classic by Electronic Arts / Don Hopkins.'),
      el('p', {}, 'Map data is derived from ', link('https://www.naturalearthdata.com/', 'Natural Earth'), ' (public domain).'),
      el('p', {}, 'SimCity is a trademark of Electronic Arts. This project is not affiliated with or endorsed by EA or Maxis.'),
      el('p', {}, 'GlobalCity is free software, licensed GPL-3.0-or-later. See ', el('a', { href: '/ATTRIBUTION.md' }, 'ATTRIBUTION.md'), ' for details.'),
      el('p', { class: 'muted' }, 'Controls: drag to pan (query tool, middle/right button or hold Space), wheel to zoom, double-click a plot in the world view to zoom in, hotkeys select tools, Esc returns to query.'),
    );
    this.root.append(this.about);
  }

  private buildLeaderboard(): void {
    const close = el('button', { class: 'btn ghost round close', title: 'Close' }, '×');
    close.onclick = () => this.hide(this.leaderboard);
    this.lbRows = el('div', { class: 'lb-rows' });
    this.lbMe = el('div', { class: 'lb-me muted' });
    this.leaderboard = el('div', { id: 'leaderboard', class: 'panel card hidden' },
      close,
      el('h2', { text: '🏆 Top cities' }),
      el('div', { class: 'lb-head' },
        el('span', { class: 'rank', text: '#' }), el('span', { class: 'sw' }), el('span', { class: 'name', text: 'City' }),
        el('span', { class: 'pop', text: 'Population' }), el('span', { class: 'chunks', text: 'Plots' }), el('span', { class: 'fires' }), el('span', { class: 'visit' })),
      this.lbRows,
      this.lbMe,
    );
    this.root.append(this.leaderboard);
  }

  private buildMinimap(): void {
    this.mini = el('canvas', { id: 'minimap', width: '256', height: '128', title: 'Click to jump' });
    this.mini.onclick = (e) => {
      const r = this.mini.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * WORLD_W;
      const y = ((e.clientY - r.top) / r.height) * WORLD_H;
      this.actions.flyToTile(x, y, this.renderer.isTileMode() ? this.renderer.cam.zoom : 1, 600);
    };
    this.root.append(el('div', { id: 'miniwrap', class: 'panel' }, this.mini));
  }

  // ---------- binding ----------
  private bind(): void {
    this.state.on('stats', () => { this.refreshStats(); this.refreshTools(); this.refreshClaimButtons(); this.refreshWelcome(); });
    this.state.on('me', () => { this.refreshName(); this.refreshClaimButtons(); this.refreshLeaderboard(); this.miniDirty = true; this.scheduleMini(); });
    this.state.on('city', () => { this.refreshName(); this.refreshWelcome(); });
    this.state.on('leaderboard', () => this.refreshLeaderboard());
    this.state.on('time', () => this.refreshTime());
    this.state.on('tool', () => this.refreshTools());
    this.state.on('claims', () => { this.refreshClaimButtons(); this.refreshWelcome(); this.miniDirty = true; this.scheduleMini(); });
    this.state.on('connection', (v) => { this.offline.classList.toggle('hidden', v); if (v) this.status.textContent = 'Online'; this.status.classList.toggle('bad', !v); });
    this.net.on('status', (s) => { this.status.textContent = s; this.offline.textContent = s; });
    this.renderer.on('camera', () => { this.hideQuery(); this.miniDirty = true; this.scheduleMini(); });
    this.renderer.on('settle', () => this.refreshClaimButtons());
  }

  private refreshAll(): void {
    this.refreshStats(); this.refreshTime(); this.refreshName(); this.refreshTools(); this.refreshClaimButtons(); this.refreshWelcome(); this.drawMini();
  }

  private refreshStats(): void {
    const s = this.state.stats;
    this.funds.textContent = fmtMoney(this.state.funds);
    this.funds.classList.toggle('bad', this.state.funds < 0);
    this.pop.textContent = (s?.population ?? 0).toLocaleString('en-US');
    const d = s?.demand ?? { r: 0, c: 0, i: 0 };
    const nd: Demand = s?.neighbourDemand ?? { r: 0, c: 0, i: 0 };
    const rail = s?.railDemand ?? 0;
    for (const k of ['r', 'c', 'i'] as const) {
      const v = Math.max(-1, Math.min(1, d[k] ?? 0));
      const bar = this.rciBars[k];
      const h = Math.abs(v) * 50;
      bar.style.height = `${h}%`;
      bar.style.top = v >= 0 ? `${50 - h}%` : '50%';
      // boost overlay: the part of a positive demand that neighbours (and, for C, rail links) contribute
      const extra = Math.max(0, (nd[k] ?? 0) + (k === 'c' ? rail : 0));
      const bh = v > 0 ? Math.min(h, extra * 50) : 0;
      const boost = this.rciBoost[k];
      boost.style.height = `${bh}%`;
      boost.style.top = `${50 - h}%`;
      boost.classList.toggle('hidden', bh <= 0);
    }
    const neighbours = s?.neighbours ?? 0, railLinks = s?.railLinks ?? 0;
    this.neighbourText.textContent = `🤝 ${neighbours} ${neighbours === 1 ? 'neighbour' : 'neighbours'} · 🚆 ${railLinks} ${railLinks === 1 ? 'rail link' : 'rail links'}`;
    this.neighbourText.classList.toggle('hidden', neighbours <= 0 && railLinks <= 0);
    const sup = s?.powerSupply ?? 0, dem = s?.powerDemand ?? 0;
    this.powerText.textContent = `⚡ ${sup} / ${dem}`;
    this.powerText.title = `Power supply ${sup} / demand ${dem} (zone units). ${POWER_TRADE_HELP}`;
    this.powerText.classList.toggle('bad', dem > sup);
    this.refreshPowerTrade(s?.powerImported ?? 0, s?.powerExported ?? 0, s?.powerTradeNet ?? 0);
    const stations = s?.fireStations ?? 0;
    this.stationsText.textContent = `🚒 ${stations} ${stations === 1 ? 'station' : 'stations'}`;
    this.stationsText.classList.toggle('hidden', !s);
    const fires = s?.fires ?? 0;
    this.fireBtn.textContent = `🔥 ${fires} ${fires === 1 ? 'fire' : 'fires'}`;
    this.fireBtn.classList.toggle('hidden', fires <= 0);
  }

  /** Second line of the power widget: what we buy/sell over the borders and what it costs/earns. */
  private refreshPowerTrade(imported: number, exported: number, net: number): void {
    const t = this.tradeText;
    t.replaceChildren();
    const money = (n: number) => `${n < 0 ? '−' : '+'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}/mo`;
    if (imported > 0) {
      // the importer's share of the net figure; when both flows exist, split by price
      const cost = exported > 0 ? -imported * POWER_PRICE_PER_UNIT : Math.min(net, 0);
      t.append(el('div', { class: 'paying', text: `⬇ buying ${imported} ${imported === 1 ? 'unit' : 'units'} (${money(cost)})` }));
    }
    if (exported > 0) {
      const income = imported > 0 ? exported * POWER_PRICE_PER_UNIT : Math.max(net, 0);
      t.append(el('div', { class: 'income', text: `⬆ selling ${exported} ${exported === 1 ? 'unit' : 'units'} (${money(income)})` }));
    }
    t.classList.toggle('hidden', imported <= 0 && exported <= 0);
  }

  private refreshTime(): void {
    this.date.textContent = fmtDate(this.state.time.year, this.state.time.month);
    this.online.textContent = String(this.state.online);
  }

  private refreshName(): void {
    this.nameBtn.textContent = this.state.me?.name ?? (this.net.identity.name ?? '…');
    if (this.state.me) this.nameBtn.style.color = this.state.me.color;
    const city = this.state.cityName;
    this.cityNameBtn.textContent = city ? `🏙 ${city}` : '';
    this.cityNameBtn.classList.toggle('hidden', !city);
  }

  private refreshTools(): void {
    for (const [id, btn] of this.toolButtons) {
      btn.classList.toggle('selected', this.state.tool === id);
      btn.classList.toggle('poor', this.state.funds < TOOLS[id].cost);
    }
  }

  private refreshClaimButtons(): void {
    const owned = this.state.ownedChunkCount();
    this.cityBtn.classList.toggle('hidden', owned === 0);
    this.plots.textContent = `${owned}/${MAX_CHUNKS_PER_PLAYER}`;
    this.plots.classList.toggle('bad', owned >= MAX_CHUNKS_PER_PLAYER);
    this.plotsStat.classList.toggle('hidden', !this.state.me);
    this.plotsStat.title = owned >= MAX_CHUNKS_PER_PLAYER
      ? `Your city has reached the maximum of ${MAX_CHUNKS_PER_PLAYER} plots`
      : `Plots claimed (a city is at most ${MAX_CHUNKS_PER_PLAYER} plots)`;
    const tileMode = this.renderer.isTileMode();
    let showClaim = false, showFind = false;
    if (tileMode && this.state.me) {
      const { cx, cy } = this.renderer.centerChunk();
      if (this.state.canClaim(cx, cy)) {
        showClaim = true;
        const cost = owned === 0 ? 0 : EXTRA_CLAIM_COST;
        this.claimBtn.textContent = owned === 0 ? 'Claim this plot (free)' : `Claim this plot (${fmtMoney(cost)})`;
        this.claimBtn.disabled = this.state.funds < cost;
        this.claimBtn.title = this.claimBtn.disabled ? 'Not enough funds' : `Claim chunk ${cx},${cy}`;
      } else if (owned === 0) {
        showFind = true;
      }
    }
    this.claimBtn.classList.toggle('hidden', !showClaim);
    this.findBtn.classList.toggle('hidden', !showFind);
  }

  private refreshWelcome(): void {
    const owned = this.state.ownedChunkCount();
    let welcomed = false;
    try { welcomed = localStorage.getItem(WELCOMED_KEY) === '1'; } catch { /* ignore */ }
    if (owned > 0) {
      try { localStorage.setItem(WELCOMED_KEY, '1'); } catch { /* ignore */ }
      if (this.sawNoPlots && !this.foundedToastShown) {
        // first plot of this session's new city: the server names it after the nearest town (cityName rides on the claim)
        const city = this.state.cityName;
        if (city) {
          this.foundedToastShown = true;
          this.toast(`You founded ${city}! (click the name in the top bar to rename)`, 'success', 7000);
        } else if (!this.welcome.classList.contains('hidden')) {
          this.toast('Plot claimed — happy building!', 'success');
        }
      }
      this.hide(this.welcome);
      return;
    }
    if (!this.state.me) return; // wait for welcome from server
    this.sawNoPlots = true;
    const show = (!welcomed || owned === 0) && !this.welcomeDismissed && this.welcomeMode !== 'pick';
    this.welcome.classList.toggle('hidden', !show);
  }

  // ---------- behaviours ----------
  private promptRename(): void {
    const cur = this.state.me?.name ?? this.net.identity.name ?? '';
    const name = window.prompt('Your mayor name:', cur);
    if (name === null) return;
    if (!this.actions.rename(name)) this.toast('Not connected — try again in a moment.', 'error');
    this.refreshName();
  }

  private promptRenameCity(): void {
    const cur = this.state.cityName;
    const name = window.prompt('Name your city:', cur);
    if (name === null) return;
    if (!this.actions.renameCity(name)) this.toast('Not connected — try again in a moment.', 'error');
    this.refreshName();
  }

  private claimCenter(): void {
    const { cx, cy } = this.renderer.centerChunk();
    if (!this.actions.claim(cx, cy)) this.toast('Not connected — cannot claim right now.', 'error');
  }

  private findFree(): void {
    const { cx, cy } = this.renderer.centerChunk();
    if (this.actions.findFree(cx, cy)) this.setWelcomeStatus('Looking for the nearest free plot…');
    else this.toast('Not connected — try again in a moment.', 'error');
  }

  private useMyLocation(): void {
    if (!('geolocation' in navigator)) {
      this.setWelcomeStatus('Geolocation is not available in this browser. Pick a spot on the map instead.', true);
      return;
    }
    this.welcomeMode = 'locating';
    this.setWelcomeStatus('Locating you…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { x, y } = lonLatToTile(pos.coords.longitude, pos.coords.latitude);
        const { cx, cy } = chunkOf(x, y);
        this.actions.flyToChunk(cx, cy, 1, 900);
        this.welcomeMode = 'idle';
        const claim = this.state.claimAt(cx, cy);
        if (claim) {
          this.setWelcomeStatus(`The plot at your location belongs to ${claim.ownerName}. Try "Find nearest free plot".`, true);
        } else {
          this.setWelcomeStatus('Found you! Use "Claim this plot" in the top bar once the map has loaded. If the server rejects it (e.g. open ocean), try "Find nearest free plot".');
          this.welcomeDismissed = true;
          setTimeout(() => this.hide(this.welcome), 1500);
        }
      },
      (err) => {
        this.welcomeMode = 'idle';
        const why = err.code === err.PERMISSION_DENIED ? 'permission denied' : err.code === err.POSITION_UNAVAILABLE ? 'position unavailable' : 'timed out';
        this.setWelcomeStatus(`Could not get your location (${why}). No problem — pick a spot on the map or find a free plot instead.`, true);
      },
      { timeout: 10_000, maximumAge: 600_000 },
    );
  }

  private pickOnMap(): void {
    this.welcomeMode = 'pick';
    this.hide(this.welcome);
    if (this.renderer.isTileMode()) this.renderer.showWorld();
    this.toast('Double-click anywhere on the world to zoom in, then press "Claim this plot" in the top bar.', 'info', 7000);
  }

  private setWelcomeStatus(text: string, bad = false): void {
    this.welcomeStatus.textContent = text;
    this.welcomeStatus.classList.toggle('bad', bad);
    this.show(this.welcome);
  }

  /** Handle the server's answer to findFree. */
  onFreeSpot(cx: number | null, cy: number | null): void {
    if (cx === null || cy === null) {
      this.setWelcomeStatus('No free plot found near here. Try another part of the world.', true);
      this.toast('No free plot found near here.', 'error');
      return;
    }
    this.actions.flyToChunk(cx, cy, 1, 900);
    this.welcomeDismissed = true;
    this.hide(this.welcome);
    this.toast('Found a free plot — press "Claim this plot" in the top bar.', 'success', 6000);
  }

  // ---------- leaderboard ----------
  isLeaderboardOpen(): boolean { return !this.leaderboard.classList.contains('hidden'); }

  openLeaderboard(): void {
    this.hide(this.about);
    this.show(this.leaderboard);
    this.refreshLeaderboard();
    this.net.send({ t: 'leaderboard' }); // the server also pushes it periodically; this just freshens it
  }

  toggleLeaderboard(): void { if (this.isLeaderboardOpen()) this.hide(this.leaderboard); else this.openLeaderboard(); }

  private refreshLeaderboard(): void {
    if (!this.isLeaderboardOpen()) return;
    const me = this.state.me;
    const entries = this.state.leaderboard;
    const rows: HTMLElement[] = entries.map((e, i) => this.leaderboardRow(e, i + 1, !!me && e.id === me.id));
    if (!rows.length) {
      rows.push(el('div', { class: 'lb-empty muted', text: this.state.leaderboardAt ? 'No cities yet — be the first!' : 'Loading…' }));
    }
    this.lbRows.replaceChildren(...rows);
    const m = this.state.leaderboardMe;
    if (m) {
      this.lbMe.textContent = `Your rank: #${m.rank} · ${m.population.toLocaleString('en-US')} pop`;
      this.lbMe.classList.remove('muted');
    } else {
      this.lbMe.textContent = 'Not ranked yet — build something!';
      this.lbMe.classList.add('muted');
    }
  }

  private leaderboardRow(e: LeaderboardEntry, rank: number, mine: boolean): HTMLElement {
    const city = e.cityName ?? '';
    const visit = el('button', { class: 'btn visit', title: `Fly to ${city || `${e.name}'s city`} (plot ${e.cx},${e.cy})` }, 'Visit');
    visit.onclick = () => { this.actions.flyToChunk(e.cx, e.cy, 1, 900); this.hide(this.leaderboard); };
    const sw = el('span', { class: 'sw' });
    sw.style.background = e.color;
    // city first (bold), mayor beneath (muted); without a city name the mayor takes the bold slot
    const mayor = mine ? `${e.name} (you)` : e.name;
    const name = city
      ? el('span', { class: 'name' }, el('span', { class: 'city', text: city }), el('span', { class: 'mayor muted', text: mayor }))
      : el('span', { class: 'name' }, el('span', { class: 'city', text: mayor }));
    name.style.color = e.color;
    return el('div', { class: `lb-row${mine ? ' me' : ''}`, 'data-id': e.id },
      el('span', { class: 'rank', text: `${rank}` }),
      sw, name,
      el('span', { class: 'pop', text: e.population.toLocaleString('en-US') }),
      el('span', { class: 'chunks', text: `${e.chunks}` }),
      el('span', { class: `fires${e.fires > 0 ? '' : ' none'}`, text: e.fires > 0 ? `🔥 ${e.fires}` : '' }),
      visit,
    );
  }

  // ---------- fire ----------
  /** Burning tiles (world coords) in the viewer's own loaded chunks, in a stable order. */
  burningTiles(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    const mine = this.state.myChunks().sort((a, b) => a.cy - b.cy || a.cx - b.cx);
    for (const c of mine) {
      const tiles = this.renderer.map.getChunk(c.cx, c.cy);
      if (!tiles) continue;
      for (let i = 0; i < tiles.length; i++) {
        if (isFireTile(tiles[i])) out.push({ x: c.cx * CHUNK + (i % CHUNK), y: c.cy * CHUNK + Math.floor(i / CHUNK) });
      }
    }
    return out;
  }

  /** Fly to the next burning tile in the viewer's own chunks (cycles). */
  nextFire(): boolean {
    const fires = this.burningTiles();
    if (!fires.length) {
      // the stats say fires>0 but none of the burning chunks are loaded: go home and let the chunks stream in
      if (!this.actions.goToMyCity()) this.toast('No burning tiles in view — fly to your city first.', 'info');
      return false;
    }
    const f = fires[this.fireCycle % fires.length];
    this.fireCycle++;
    this.goToTile(f.x, f.y);
    return true;
  }

  /** Fly to a tile at zoom 2 and flash a marker there. */
  goToTile(x: number, y: number): void {
    this.actions.flyToTile(x + 0.5, y + 0.5, 2, 700);
    this.renderer.flashTile(x, y);
  }

  // ---------- toasts ----------
  /** Show a toast. With `at` the toast is clickable and flies to that tile. Identical toasts within 3 s refresh instead of stacking. */
  toast(msg: string, kind: ToastKind = 'info', ms = 4000, at?: ToastAt): HTMLElement {
    const now = performance.now();
    const last = this.lastToast;
    if (last && last.msg === msg && last.kind === kind && now - last.at < TOAST_DEDUP_MS && last.el.isConnected) {
      clearTimeout(last.timer);
      last.at = now;
      last.el.classList.remove('out');
      last.el.classList.remove('bump'); void last.el.offsetWidth; last.el.classList.add('bump');
      last.timer = setTimeout(() => this.dismissToast(last.el), ms);
      return last.el;
    }
    const t = el('div', { class: `toast ${kind}`, text: msg });
    if (at) {
      t.classList.add('clickable');
      t.setAttribute('role', 'button');
      t.title = `Click to go to tile ${at.x}, ${at.y}`;
      t.onclick = () => { this.goToTile(at.x, at.y); this.dismissToast(t); };
    }
    this.toasts.append(t);
    while (this.toasts.children.length > 5) this.toasts.firstElementChild?.remove();
    const timer = setTimeout(() => this.dismissToast(t), ms);
    this.lastToast = { msg, kind, el: t, at: now, timer };
    return t;
  }

  private dismissToast(t: HTMLElement): void {
    t.classList.add('out');
    setTimeout(() => t.remove(), 300);
  }

  // ---------- query popover ----------
  queryPendingAt(cssX: number, cssY: number): void {
    this.queryPos = { x: cssX, y: cssY };
    this.queryPending = true;
  }

  showQuery(info: QueryInfo): void {
    this.queryPending = false;
    const q = this.query;
    q.replaceChildren(
      el('div', { class: 'qname', text: info.name }),
      el('div', { class: 'qrow', text: `Tile ${info.x}, ${info.y}  #${info.tile}` }),
      el('div', { class: `qrow ${info.powered ? 'good' : 'bad'}`, text: info.powered ? '⚡ Powered' : '⚡ Unpowered' }),
      el('div', { class: 'qrow', text: info.owner ? `Owner: ${info.owner.cityName ? `${info.owner.cityName} — ` : ''}${info.owner.name}` : 'Unclaimed land' }),
      ...(info.zonePop !== undefined ? [el('div', { class: 'qrow', text: `Population: ${info.zonePop}` })] : []),
    );
    if (info.owner) (q.firstElementChild as HTMLElement).style.color = info.owner.color;
    q.classList.remove('hidden');
    const pad = 12;
    const w = q.offsetWidth, h = q.offsetHeight;
    const x = Math.min(window.innerWidth - w - pad, this.queryPos.x + 14);
    const y = Math.min(window.innerHeight - h - pad, this.queryPos.y + 14);
    q.style.left = `${Math.max(pad, x)}px`;
    q.style.top = `${Math.max(pad, y)}px`;
    if (this.queryTimer) clearTimeout(this.queryTimer);
    this.queryTimer = setTimeout(() => this.hideQuery(), 8000);
  }

  hideQuery(): void {
    this.query.classList.add('hidden');
    if (this.queryTimer) { clearTimeout(this.queryTimer); this.queryTimer = null; }
  }

  closePanels(): void { this.hide(this.about); this.hide(this.leaderboard); this.hideQuery(); }

  // ---------- minimap ----------
  private miniScheduled = false;
  private scheduleMini(): void {
    if (this.miniScheduled) return;
    this.miniScheduled = true;
    requestAnimationFrame(() => { this.miniScheduled = false; if (this.miniDirty) this.drawMini(); });
  }

  private drawMini(): void {
    this.miniDirty = false;
    const c = this.mini;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = 256, cssH = 128;
    if (c.width !== cssW * dpr) { c.width = cssW * dpr; c.height = cssH * dpr; }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.minimap.image, 0, 0, this.minimap.width, this.minimap.height, 0, 0, cssW, cssH);
    const sx = cssW / WORLD_W, sy = cssH / WORLD_H;
    // claimed chunks as tiny dots
    for (const cl of this.state.claims.values()) {
      g.fillStyle = withAlpha(cl.color, 0.9);
      g.fillRect(cl.cx * CHUNK * sx, cl.cy * CHUNK * sy, Math.max(1.5, CHUNK * sx), Math.max(1.5, CHUNK * sy));
    }
    // own city
    const mine = this.state.myCentroid();
    if (mine) {
      g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1;
      g.beginPath(); g.arc(mine.cx * CHUNK * sx, mine.cy * CHUNK * sy, 3, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // viewport
    const v = this.renderer.viewRect();
    const x0 = Math.max(0, v.x0 * sx), y0 = Math.max(0, v.y0 * sy);
    const x1 = Math.min(cssW, v.x1 * sx), y1 = Math.min(cssH, v.y1 * sy);
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1;
    g.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.max(2, Math.round(x1 - x0) - 1), Math.max(2, Math.round(y1 - y0) - 1));
  }

  // ---------- helpers ----------
  private show(e: HTMLElement): void { e.classList.remove('hidden'); }
  private hide(e: HTMLElement): void { e.classList.add('hidden'); }
  private toggle(e: HTMLElement): void { e.classList.toggle('hidden'); }

  /** For claims arriving as a single update: notify when it's ours. */
  onClaimChanged(c: ClaimInfo): void {
    if (this.state.me && c.ownerId === this.state.me.id) this.refreshWelcome();
  }

  /** A chunk was released after its owner went idle (state already dropped it; the ruins stay on the map). */
  onUnclaim(prev: ClaimInfo): void {
    if (this.state.me && prev.ownerId === this.state.me.id) {
      this.toast(`Your plot ${prev.cx},${prev.cy} was released after inactivity.`, 'error', 8000, { x: prev.cx * CHUNK + CHUNK / 2, y: prev.cy * CHUNK + CHUNK / 2 });
    }
  }
}
