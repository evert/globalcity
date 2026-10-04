// DOM overlay: top bar, toolbar, RCI, toasts, query popover, welcome/about panels, minimap widget.
import type { ClaimInfo, Demand, LeaderboardEntry, QueryInfo, ToolId } from '@globalcity/shared';
import { CHUNK, claimCost, MILESTONE_BUILDINGS, MILESTONE_ORDER, isMilestoneTool, type MilestoneBuilding, MAX_CHUNKS_PER_PLAYER, POWER_PRICE_PER_UNIT, TOOLS, TOOL_ORDER, WORLD_H, WORLD_W, chunkOf, lonLatToTile } from '@globalcity/shared';
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
export const POLICE_HELP = 'Police stations cover 14 tiles; uncovered lots lose land value once the city grows (crime)';
export const TRAFFIC_HELP = 'Average traffic on your roads: zones send cars along nearby roads; busy roads are drawn with traffic.';
export const SPECIALS_HELP = 'Powered special buildings boost demand: a stadium attracts residents, a seaport (near water) industry, an airport commerce once another mayor has an airport to fly to.';

/** Traffic word for stats.traffic (0..1), or '' when there is none. */
export function trafficLabel(t: number): '' | 'light' | 'moderate' | 'heavy' {
  if (!(t > 0)) return '';
  return t < 0.15 ? 'light' : t < 0.5 ? 'moderate' : 'heavy';
}

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

/** 1234 -> "1,234", 1234567 -> "1.23M", 1.2e9 -> "1.2B" (top-bar sized). */
/** Community Discord invite (top bar, welcome panel, about panel). */
export const DISCORD_URL = 'https://discord.gg/xUXsw7Vzb';
/** Discord's logo mark (path from Simple Icons, CC0). Used only to link to our Discord server. */
const DISCORD_SVG_PATH = 'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z';
function discordIcon(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'discord-icon');
  const path = document.createElementNS(NS, 'path'); path.setAttribute('d', DISCORD_SVG_PATH); path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}
const discordLink = (text: string, cls = ''): HTMLAnchorElement =>
  el('a', { href: DISCORD_URL, target: '_blank', rel: 'noopener noreferrer', ...(cls ? { class: cls } : {}) }, text);

export function fmtCompact(n: number): string {
  if (n < 10_000) return n.toLocaleString('en-US');
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}

export function fmtMoney(n: number): string {
  const s = Math.abs(Math.round(n)).toLocaleString('en-US');
  return (n < 0 ? '-$' : '$') + s;
}
export function fmtDate(year: number, month: number): string { return `${MONTHS[((month % 12) + 12) % 12]} ${year}`; }

export class UI {
  readonly root: HTMLElement;
  private funds!: HTMLElement; private pop!: HTMLElement; private date!: HTMLElement; private online!: HTMLElement; private worldPop!: HTMLElement; private lbWorld!: HTMLElement;
  private nameBtn!: HTMLButtonElement; private cityNameBtn!: HTMLButtonElement; private plots!: HTMLElement; private plotsStat!: HTMLElement;
  private status!: HTMLElement; private offline!: HTMLElement;
  private claimBtn!: HTMLButtonElement; private findBtn!: HTMLButtonElement; private cityBtn!: HTMLButtonElement; private worldBtn!: HTMLButtonElement;
  private toolButtons = new Map<ToolId, HTMLButtonElement>();
  private rciBars!: Record<'r' | 'c' | 'i', HTMLElement>; private rciBoost!: Record<'r' | 'c' | 'i', HTMLElement>;
  private powerText!: HTMLElement; private stationsText!: HTMLElement; private tradeText!: HTMLElement; private neighbourText!: HTMLElement; private budgetText!: HTMLElement;
  private policeText!: HTMLElement; private crimeText!: HTMLElement; private trafficText!: HTMLElement; private trafficWord!: HTMLElement; private trafficFill!: HTMLElement; private specialsText!: HTMLElement;
  private toasts!: HTMLElement; private lastToast: { msg: string; kind: ToastKind; el: HTMLElement; at: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private milestones!: HTMLElement; private msRows!: HTMLElement; private msBtn!: HTMLButtonElement;
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
    this.buildTouchBar();
    this.buildBanners();
    this.buildWelcome();
    this.buildAbout();
    this.buildLeaderboard();
    this.buildMilestones();
    this.buildMinimap();
    this.root.append(this.toasts, this.query, this.touchBar, this.banners);
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
    this.worldPop = el('span', { class: 'val', text: '0' });
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
    this.msBtn = el('button', { class: 'btn', id: 'msBtn', title: 'Milestones: special buildings your city unlocks as it grows' }, '🏛 Milestones');
    this.msBtn.onclick = () => this.toggleMilestones();
    this.lbBtn = el('button', { class: 'btn', id: 'lbBtn', title: 'Leaderboard: the most populous cities on the planet' }, '🏆 Top cities');
    this.lbBtn.onclick = () => this.toggleLeaderboard();
    this.fireBtn = el('button', { class: 'btn fire hidden', id: 'fireBtn', title: 'Your city is burning! Click to jump to the next fire.' }, '🔥 0 fires');
    this.fireBtn.onclick = () => this.nextFire();
    const discordBtn = discordLink('', 'btn ghost discord-btn');
    discordBtn.append(discordIcon(), el('span', { class: 'discord-label' }, 'Discord'));
    discordBtn.setAttribute('aria-label', 'GlobalCity Discord');
    discordBtn.title = 'Join the GlobalCity Discord: chat with other mayors, report bugs, suggest features';
    const aboutBtn = el('button', { class: 'btn ghost round', id: 'aboutBtn', title: 'About & attribution' }, 'ⓘ');
    aboutBtn.onclick = () => this.toggle(this.about);
    const bar = el('div', { id: 'topbar' },
      el('div', { class: 'brand' }, 'GlobalCity'),
      el('div', { class: 'stat', title: 'Funds' }, el('span', { class: 'ico' }, '$'), this.funds),
      el('div', { class: 'stat', title: 'Population' }, el('span', { class: 'ico' }, '👥'), this.pop),
      el('div', { class: 'stat', title: 'Date' }, el('span', { class: 'ico' }, '📅'), this.date),
      el('div', { class: 'stat', title: 'Players online' }, el('span', { class: 'ico' }, '●'), this.online),
      el('div', { class: 'stat world-pop', title: 'World population: every city on the planet combined' }, el('span', { class: 'ico' }, '🌍'), this.worldPop),
      this.plotsStat,
      this.claimBtn, this.findBtn, this.cityBtn, this.worldBtn, this.msBtn, this.lbBtn, this.fireBtn,
      el('div', { class: 'spacer' }),
      this.status, this.cityNameBtn, this.nameBtn, discordBtn, aboutBtn,
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
    this.root.style.setProperty('--overlay-top', `${top + 8}px`);
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
    this.policeText = el('span', { class: 'police hidden', id: 'police', title: POLICE_HELP }, '👮 0 police');
    this.crimeText = el('span', { class: 'crime bad hidden', id: 'crime', title: `Crime is high and no police station is powered. ${POLICE_HELP}` }, '⚠ crime');
    this.trafficWord = el('span', { class: 'word' });
    this.trafficFill = el('span', { class: 'fill' });
    this.trafficText = el('div', { class: 'traffic hidden', id: 'traffic', title: TRAFFIC_HELP }, el('span', { text: '🚗 ' }), this.trafficWord, el('span', { class: 'meter' }, this.trafficFill));
    this.specialsText = el('div', { class: 'specials hidden', id: 'specials', title: SPECIALS_HELP });
    this.tradeText = el('div', { class: 'trade hidden', id: 'powerTrade', title: POWER_TRADE_HELP });
    this.neighbourText = el('div', { class: 'neighbours hidden', id: 'neighbours', title: NEIGHBOUR_HELP });
    this.budgetText = el('div', { class: 'budget', id: 'budget', title: 'Net budget over the last game year: taxes on your population minus upkeep for roads, rail, stations and power plants. The economy idles while you are away.' });
    const box = el('div', { id: 'rci', class: 'panel', title: 'Residential / Commercial / Industrial demand' },
      el('div', { class: 'rci-bars' }, r.wrap, c.wrap, i.wrap),
      el('div', { class: 'power-line' }, this.powerText, this.stationsText),
      el('div', { class: 'power-line', id: 'safety' }, this.policeText, this.crimeText),
      this.trafficText,
      this.specialsText,
      this.tradeText,
      this.neighbourText,
      this.budgetText);
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
      el('p', { class: 'muted community' }, 'Meet your neighbours, find trading partners and suggest features on ', discordLink('our Discord'), '.'),
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
      el('p', {}, 'Tile artwork is the original SimCity Classic art by Will Wright and Maxis (1989), used via ',
        link('https://github.com/SimHacker/micropolis', 'Micropolis'),
        ', the GPLv3 release of SimCity that Electronic Arts open-sourced in 2008 through the work of Don Hopkins.'),
      el('p', {}, 'Map data is derived from ', link('https://www.naturalearthdata.com/', 'Natural Earth'), ' (public domain).'),
      el('p', {}, 'SimCity is a trademark of Electronic Arts. This project is not affiliated with or endorsed by EA or Maxis.'),
      el('p', {}, 'Community, bug reports and feature ideas: ', discordLink('join the GlobalCity Discord'), '.'),
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
    this.lbWorld = el('div', { class: 'lb-world muted' });
    this.leaderboard = el('div', { id: 'leaderboard', class: 'panel card hidden' },
      close,
      el('h2', { text: '🏆 Top cities' }),
      el('div', { class: 'lb-head' },
        el('span', { class: 'rank', text: '#' }), el('span', { class: 'sw' }), el('span', { class: 'name', text: 'City' }),
        el('span', { class: 'pop', text: 'Population' }), el('span', { class: 'chunks', text: 'Plots' }), el('span', { class: 'fires' }), el('span', { class: 'visit' })),
      this.lbRows,
      this.lbMe,
      this.lbWorld,
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
    this.state.on('stats', () => { this.refreshStats(); this.refreshTools(); this.refreshClaimButtons(); this.refreshWelcome(); this.refreshMilestones(); });
    this.state.on('me', () => { this.refreshName(); this.refreshClaimButtons(); this.refreshLeaderboard(); this.miniDirty = true; this.scheduleMini(); });
    this.state.on('city', () => { this.refreshName(); this.refreshWelcome(); });
    this.state.on('leaderboard', () => this.refreshLeaderboard());
    this.state.on('time', () => this.refreshTime());
    this.state.on('tool', () => this.refreshTools());
    this.state.on('claims', () => { this.refreshClaimButtons(); this.refreshWelcome(); this.miniDirty = true; this.scheduleMini(); this.refreshWorldPop(); this.refreshLeaderboard(); });
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
    const net = s?.lastIncome ?? 0;
    this.budgetText.textContent = `💰 ${net >= 0 ? '+' : '−'}${fmtMoney(Math.abs(net))} last year`;
    this.budgetText.classList.toggle('bad', net < 0);
    this.budgetText.classList.toggle('hidden', !s);
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
    // police / crime (old servers omit these: treat as no police, no crime)
    const police = s?.policeStations ?? 0, crime = s?.crime ?? 0;
    this.policeText.textContent = `👮 ${police} police`;
    this.policeText.classList.toggle('hidden', !s);
    this.crimeText.classList.toggle('hidden', !(crime >= 0.5 && police === 0));
    // traffic
    const traffic = Math.max(0, Math.min(1, s?.traffic ?? 0));
    const word = trafficLabel(traffic);
    this.trafficWord.textContent = word ? `${word} traffic` : '';
    this.trafficFill.style.width = `${Math.round(traffic * 100)}%`;
    this.trafficFill.className = `fill ${word}`;
    this.trafficText.classList.toggle('hidden', !word);
    // special-building boosts
    const sp = s?.specials;
    const chips: string[] = [];
    if (sp && sp.stadium > 0) chips.push('🏟 stadium');
    if (sp && sp.seaport > 0) chips.push('⚓ seaport');
    if (sp && sp.airport > 0) chips.push('✈ airport');
    this.specialsText.replaceChildren(...chips.map((c) => el('span', { class: 'chip', text: c })));
    this.specialsText.classList.toggle('hidden', chips.length === 0);
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
    const st = this.state.stats;
    for (const [id, btn] of this.toolButtons) {
      btn.classList.toggle('selected', this.state.tool === id);
      btn.classList.toggle('poor', this.state.funds < TOOLS[id].cost);
      if (!isMilestoneTool(id)) continue;
      // Milestone buildings: locked until the population milestone, then one per city.
      const m = MILESTONE_BUILDINGS[id];
      const unlocked = st?.unlocked?.includes(id) ?? false;
      const built = (st?.built?.[id] ?? 0) > 0;
      btn.classList.toggle('locked', !unlocked);
      btn.classList.toggle('built', unlocked && built);
      const cost = btn.querySelector('.cost');
      if (cost) cost.textContent = !unlocked ? `🔒 ${fmtCompact(m.pop)} pop` : built ? 'Built' : fmtMoney(TOOLS[id].cost);
      btn.title = !unlocked ? `${m.name}: unlocks at ${m.pop.toLocaleString('en-US')} people. ${m.benefits.join('. ')}.`
        : built ? `${m.name}: your city already has one (one per city). It can be rebuilt if it is destroyed.`
        : `${m.name} — ${fmtMoney(TOOLS[id].cost)} (${TOOLS[id].hotkey.toUpperCase()}). ${m.benefits.join('. ')}.`;
    }
  }

  // ---------- milestones ----------
  private buildMilestones(): void {
    const close = el('button', { class: 'btn ghost round close', title: 'Close' }, '×');
    close.onclick = () => this.hide(this.milestones);
    this.msRows = el('div', { class: 'ms-rows' });
    this.milestones = el('div', { id: 'milestones', class: 'panel card hidden' },
      close,
      el('h2', { text: '🏛 Milestones' }),
      el('p', { class: 'muted', text: 'As your city grows it unlocks special buildings. Each city can have one of each, and a destroyed one can be rebuilt.' }),
      this.msRows,
    );
    this.root.append(this.milestones);
  }
  toggleMilestones(): void {
    if (!this.milestones.classList.contains('hidden')) { this.hide(this.milestones); return; }
    this.hide(this.about); this.hide(this.leaderboard);
    this.milestones.classList.remove('hidden');
    this.refreshMilestones();
  }
  private msIcon(b: MilestoneBuilding): HTMLCanvasElement {
    const t = TOOLS[MILESTONE_BUILDINGS[b].tool];
    const n = t.size, px = 72;
    const c = el('canvas', { class: 'ms-icon', width: String(px), height: String(px) });
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    const cell = px / n;
    for (let k = 0; k < n * n; k++) drawTile(g, this.sheet, t.base! + k, (k % n) * cell, Math.floor(k / n) * cell, cell, cell);
    return c;
  }
  private refreshMilestones(): void {
    if (!this.milestones || this.milestones.classList.contains('hidden')) return;
    const st = this.state.stats;
    const peak = st?.peakPop ?? 0;
    const rows = MILESTONE_ORDER.map((b) => {
      const m = MILESTONE_BUILDINGS[b];
      const unlocked = st?.unlocked?.includes(b) ?? false;
      const built = (st?.built?.[b] ?? 0) > 0;
      const status = built ? { cls: 'done', text: 'Built' } : unlocked ? { cls: 'ready', text: 'Unlocked: build it from the toolbar' }
        : { cls: 'locked', text: `${(m.pop - peak).toLocaleString('en-US')} more people` };
      const pct = Math.max(0, Math.min(100, (peak / m.pop) * 100));
      const t = TOOLS[m.tool];
      return el('div', { class: `ms-row ${status.cls}` },
        this.msIcon(b),
        el('div', { class: 'ms-body' },
          el('div', { class: 'ms-head' }, el('strong', { text: m.name }), el('span', { class: 'chip', text: `${m.pop.toLocaleString('en-US')} people` })),
          el('ul', { class: 'ms-benefits' }, ...m.benefits.map((x) => el('li', { text: x }))),
          el('div', { class: 'ms-meta muted', text: `${fmtMoney(t.cost)} · ${t.size}×${t.size} tiles` }),
          unlocked ? el('div', { class: `ms-status ${status.cls}`, text: status.text })
            : el('div', { class: 'ms-progress' }, el('div', { class: 'ms-bar' }, el('div', { class: 'ms-fill', style: `width:${pct.toFixed(1)}%` })), el('span', { class: 'ms-status locked', text: status.text })),
        ));
    });
    this.msRows.replaceChildren(...rows);
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
        const cost = claimCost(owned);
        this.claimBtn.textContent = owned === 0 ? 'Claim this plot (free)' : `Claim plot #${owned + 1} (${fmtMoney(cost)})`;
        this.claimBtn.disabled = this.state.funds < cost;
        this.claimBtn.title = this.claimBtn.disabled ? `Not enough funds: plot #${owned + 1} costs ${fmtMoney(cost)}` : `Claim chunk ${cx},${cy}. Each extra plot costs more than the last.`;
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

  private refreshWorldPop(): void {
    const { total, cities } = this.state.worldPopulation();
    this.worldPop.textContent = fmtCompact(total);
    this.worldPop.parentElement!.title = `World population: ${total.toLocaleString('en-US')} people in ${cities} ${cities === 1 ? 'city' : 'cities'}`;
  }

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
    const w = this.state.worldPopulation();
    this.lbWorld.textContent = `🌍 World population: ${w.total.toLocaleString('en-US')} in ${w.cities} ${w.cities === 1 ? 'city' : 'cities'}`;
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
  // ---------- banners: admin announcements and "new version" ----------
  private banners!: HTMLElement;
  private annBanner!: HTMLElement;
  private annText!: HTMLElement;
  private annId = '';
  private annTimer: ReturnType<typeof setTimeout> | null = null;
  private updBanner!: HTMLElement;
  private buildBanners(): void {
    this.annText = el('span', { class: 'banner-text' });
    const annClose = el('button', { class: 'btn ghost round', title: 'Dismiss', type: 'button' }, '×');
    annClose.onclick = () => {
      try { localStorage.setItem('globalcity.annDismissed', this.annId); } catch { /* ignore */ }
      this.annBanner.classList.add('hidden');
    };
    this.annBanner = el('div', { class: 'banner announce hidden', role: 'status' }, el('span', { class: 'banner-ico' }, '📣'), this.annText, annClose);
    this.updBanner = el('div', { class: 'banner update hidden', role: 'status' }, el('span', { class: 'banner-text' }, '✨ A new version of GlobalCity is available.'));
    this.banners = el('div', { id: 'banners' }, this.annBanner, this.updBanner);
  }
  showAnnouncement(id: string, msg: string, level: 'info' | 'warn', until: number): void {
    this.annId = id;
    let dismissed = false;
    try { dismissed = localStorage.getItem('globalcity.annDismissed') === id; } catch { /* ignore */ }
    this.annText.textContent = msg;
    this.annBanner.classList.toggle('warn', level === 'warn');
    this.annBanner.classList.toggle('hidden', dismissed);
    if (this.annTimer) clearTimeout(this.annTimer);
    const left = until - Date.now();
    if (left > 0 && left < 2 ** 31) this.annTimer = setTimeout(() => this.clearAnnouncement(), left);
  }
  clearAnnouncement(): void { this.annBanner.classList.add('hidden'); this.annId = ''; }
  showUpdateBanner(reload: () => void): void {
    if (!this.updBanner.querySelector('button')) {
      const btn = el('button', { class: 'btn primary', type: 'button' }, 'Reload');
      btn.onclick = reload;
      this.updBanner.append(btn);
    }
    this.updBanner.classList.remove('hidden');
  }

  // ---------- touch placement confirm bar ----------
  private touchBar!: HTMLElement;
  private touchWhat!: HTMLElement;
  private touchTile: { x: number; y: number } | null = null;
  onTouchBuild: () => void = () => {};
  onTouchCancel: () => void = () => {};
  private buildTouchBar(): void {
    this.touchWhat = el('span', { class: 'what' });
    const build = el('button', { class: 'primary', type: 'button' }, 'Build');
    const cancel = el('button', { type: 'button' }, 'Cancel');
    build.addEventListener('click', () => this.onTouchBuild());
    cancel.addEventListener('click', () => this.onTouchCancel());
    this.touchBar = el('div', { id: 'touchbar', class: 'hidden' }, this.touchWhat, build, cancel);
  }
  /** Touch aimed a build tool at a tile (null = hide). Tap the same tile again or press Build. */
  setTouchTarget(tile: { x: number; y: number } | null): void {
    this.touchTile = tile;
    if (!tile) { this.touchBar.classList.add('hidden'); return; }
    const t = TOOLS[this.state.tool];
    this.touchWhat.textContent = `${t.name} here${t.cost ? ` · ${fmtMoney(t.cost)}` : ''} — tap again or`;
    this.touchBar.classList.remove('hidden');
  }

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
