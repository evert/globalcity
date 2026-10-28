// DOM overlay: top bar, toolbar, RCI, toasts, query popover, welcome/about panels, minimap widget.
import type { ClaimInfo, Demand, LeaderboardEntry, MonumentEntry, QueryInfo, ToolId } from '@globalcity/shared';
import { OVERLAY_INFO, OVERLAY_MODES, type OverlayMode } from './overlays.ts';
import { TAX_RATE, TAX_RATE_MIN, TAX_RATE_MAX, TAX_MULT, CITYHALL_TAX_BONUS, taxDemand, MONUMENT_MIN_POP, ABANDON_MAX_FUNDS, STARTING_FUNDS, LIFELINE_AMOUNT, LIFELINE_MAX_FUNDS, LIFELINE_REPAY_SHARE, LIFELINE_EARLY_PEAK_POP, LIFELINE_MAX_DEBT, LOMASK, FIRESTBASE, POLICESTBASE, chunkKey, shipCargo, flightLoad } from '@globalcity/shared';
import { CHUNK, claimCost, MILESTONE_BUILDINGS, MILESTONE_ORDER, isMilestoneTool, nextMilestone, type MilestoneBuilding, MAX_CHUNKS_PER_PLAYER, POWER_PRICE_PER_UNIT, TOOLS, TOOL_ORDER, PLANT_OUTPUT, CUSTOM_BUILDINGS, GRAND_CENTRAL, WORLD_H, WORLD_W, chunkOf, lonLatToTile } from '@globalcity/shared';
import type { Actions } from './actions.ts';
import type { Minimap, SpriteSheet } from './assets.ts';
import { drawTile } from './assets.ts';
import type { Net } from './net.ts';
import type { Renderer } from './renderer.ts';
import { NIGHT_REFRESH_MS } from './night.ts';
import { isFireTile, withAlpha } from './renderer.ts';
import type { AppState } from './state.ts';

/** Toolbar groups: members share one button with a flyout once two or more of them are unlocked. */
const TOOL_GROUPS: { id: string; name: string; members: ToolId[] }[] = [
  { id: 'power', name: 'Power plants', members: ['coal', 'nuclear', 'windfarm', 'offshore'] },
  { id: 'education', name: 'Education', members: ['school', 'university'] },
  { id: 'ports', name: 'Ports', members: ['seaport', 'airport'] },
];
interface ToolGroupUi { def: (typeof TOOL_GROUPS)[number]; wrap: HTMLElement; head: HTMLButtonElement; icon: HTMLCanvasElement; label: HTMLElement; cost: HTMLElement; flyout: HTMLElement; grouped: boolean | null; last: ToolId | null; shown: ToolId | null }

/** Price for a toolbar label; power plants add how many zones they power. */
const priceLabel = (id: ToolId): string => `${fmtMoney(TOOLS[id].cost)}${PLANT_OUTPUT[id] ? ` · ⚡${PLANT_OUTPUT[id]}` : ''}`;

/** Draw a custom building's image (its first frame, when animated) centred in a px x px square. */
function drawCustomFit(g: CanvasRenderingContext2D, img: HTMLImageElement, kind: string, px: number): void {
  const frames = CUSTOM_BUILDINGS[kind]?.frames ?? 1;
  const fw = img.naturalWidth / frames, fh = img.naturalHeight;
  const s = Math.min(px / fw, px / fh), w = fw * s, h = fh * s;
  g.drawImage(img, 0, 0, fw, fh, (px - w) / 2, (px - h) / 2, w, h);
}

/** Leaderboard cell: the share of milestones unlocked, as a number over a thin bar. */
function milestoneCell(pct: number | undefined): HTMLElement {
  if (pct === undefined) return el('span', { class: 'ms' });
  const fill = el('i', { class: 'lbms-fill' });
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  return el('span', { class: `ms${pct >= 100 ? ' full' : ''}`, title: `${pct}% of milestones unlocked` }, el('b', { text: `${pct}%` }), el('span', { class: 'lbms-bar' }, fill));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WELCOMED_KEY = 'globalcity.welcomed';
const TOAST_DEDUP_MS = 3000;
const POWER_TRADE_HELP = 'Power flows over wires across plot borders; surplus is sold at $1 per unit per month.';
export const NEIGHBOUR_HELP = "Neighbouring cities' jobs and shoppers add demand across the border; rail connecting your zones to theirs boosts commerce.";
export const POLICE_HELP = 'Police stations cover 14 tiles; uncovered lots lose land value once the city grows (crime)';
export const TRAFFIC_HELP = 'Average traffic on your roads: zones send cars along nearby roads; busy roads are drawn with traffic.';

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
  private toolGroups: ToolGroupUi[] = [];
  private openGroup: ToolGroupUi | null = null;
  private autoOverlay: OverlayMode | null = null; // map view opened by clicking a station
  private rciBars!: Record<'r' | 'c' | 'i', HTMLElement>; private rciBoost!: Record<'r' | 'c' | 'i', HTMLElement>;
  private powerText!: HTMLElement; private tradeText!: HTMLElement; private neighbourText!: HTMLElement; private budgetText!: HTMLElement;
  private crimeText!: HTMLElement; private trafficText!: HTMLElement; private trafficWord!: HTMLElement; private trafficFill!: HTMLElement;
  private toasts!: HTMLElement; private lastToast: { msg: string; kind: ToastKind; el: HTMLElement; at: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private lifelineBtn!: HTMLButtonElement; private lifelinePanel!: HTMLElement;
  private monumentBtn!: HTMLButtonElement; private monumentPanel!: HTMLElement; private monumentCity!: HTMLElement;
  private abandonBtn!: HTMLButtonElement; private abandonPanel!: HTMLElement; private abandonCity!: HTMLElement;
  private budgetBtn!: HTMLButtonElement; private budgetPanel!: HTMLElement; private taxSlider!: HTMLInputElement; private taxLabel!: HTMLElement; private taxEffect!: HTMLElement; private budgetTable!: HTMLElement;
  /** slider position while the mayor is dragging it (not yet confirmed by the server), else null */
  private taxPending: number | null = null;
  private milestones!: HTMLElement; private msRows!: HTMLElement; private msBtn!: HTMLButtonElement;
  private leaderboard!: HTMLElement; private lbRows!: HTMLElement; private lbMe!: HTMLElement; private lbBtn!: HTMLButtonElement;
  /** the Top cities panel has two pages: the ranking and the monuments */
  private lbTitle!: HTMLElement; private lbPageBtn!: HTMLButtonElement; private lbView!: HTMLElement; private monView!: HTMLElement; private monRows!: HTMLElement;
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
    this.buildOverlayBar();
    this.buildLifeline();
    this.buildMonument();
    this.buildAbandon();
    this.buildBudget();
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
    this.budgetBtn = el('button', { class: 'btn hidden', id: 'budgetBtn', title: 'Budget: set the tax rate, see what your city earns and pays' }, '💰 Budget');
    this.budgetBtn.onclick = () => this.toggleBudget();
    this.lbBtn = el('button', { class: 'btn', id: 'lbBtn', title: 'Leaderboard: the most populous cities on the planet' }, '🏆 Top cities');
    this.lbBtn.onclick = () => this.toggleLeaderboard();
    this.lifelineBtn = el('button', { class: 'btn lifeline hidden', id: 'lifelineBtn', title: 'Your city is nearly broke: an emergency loan is available' }, '🛟 Lifeline');
    this.lifelineBtn.onclick = () => this.toggleLifeline();
    this.monumentBtn = el('button', { class: 'btn hidden', id: 'monumentBtn', title: `Your city has over ${MONUMENT_MIN_POP.toLocaleString('en-US')} people: you can retire it as a monument and start over` }, '🏛 Monument');
    this.monumentBtn.onclick = () => this.toggleMonument();
    this.abandonBtn = el('button', { class: 'btn hidden', id: 'abandonBtn', title: 'Your city is broke and already used its lifeline: you can abandon it and start over' }, '🏳 Abandon city');
    this.abandonBtn.onclick = () => this.toggleAbandon();
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
      this.claimBtn, this.findBtn, this.cityBtn, this.worldBtn, this.msBtn, this.budgetBtn, this.lbBtn, this.lifelineBtn, this.abandonBtn, this.monumentBtn, this.fireBtn,
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
      if (t.custom) {
        const img = this.renderer.customs.images.get(t.custom);
        const paint = () => { if (img && img.naturalWidth) { g.clearRect(0, 0, 32, 32); drawCustomFit(g, img, t.custom!, 32); } };
        if (img?.complete) paint(); else img?.addEventListener('load', paint, { once: true });
      }
      const cost = t.cost ? priceLabel(id) : 'free';
      const btn = el('button', { class: 'tool', 'data-tool': id, title: `${t.name} — ${cost} (${t.hotkey.toUpperCase()})`, 'aria-label': t.name },
        icon,
        el('span', { class: 'key', text: t.hotkey.toUpperCase() }),
        el('span', { class: 'label', text: t.name }),
        el('span', { class: 'cost', text: t.cost ? priceLabel(id) : '' }),
      );
      btn.onclick = () => { this.state.setTool(id); this.closeToolGroup(); };
      this.toolButtons.set(id, btn);
      const def = TOOL_GROUPS.find((g) => g.members.includes(id));
      if (!def) { bar.append(btn); continue; }
      const grp = this.toolGroups.find((x) => x.def === def) ?? this.buildToolGroup(def, bar);
      grp.flyout.append(btn); // layoutToolGroups() moves it into the bar while the group is not needed
    }
    bar.addEventListener('scroll', () => this.closeToolGroup(), { passive: true });
    document.addEventListener('pointerdown', (e) => {
      const g = this.openGroup;
      if (g && !g.flyout.contains(e.target as Node) && !g.head.contains(e.target as Node)) this.closeToolGroup();
    });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeToolGroup(); });
    window.addEventListener('resize', () => this.closeToolGroup());
    this.root.append(bar);
    this.layoutToolGroups();
  }

  private buildToolGroup(def: (typeof TOOL_GROUPS)[number], bar: HTMLElement): ToolGroupUi {
    const icon = el('canvas', { class: 'icon', width: '32', height: '32' });
    const label = el('span', { class: 'label', text: def.name });
    const cost = el('span', { class: 'cost' });
    const head = el('button', { class: 'tool group-head', 'data-group': def.id, 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-label': def.name },
      icon, label, cost, el('span', { class: 'caret', text: '▸' }));
    const flyout = el('div', { class: 'tool-flyout panel hidden', role: 'menu', 'aria-label': def.name });
    const wrap = el('div', { class: 'tool-group', 'data-group': def.id }, head);
    this.root.append(flyout); // outside the toolbar so it stacks above the minimap and RCI panel
    const g: ToolGroupUi = { def, wrap, head, icon, label, cost, flyout, grouped: null, last: null, shown: null };
    head.onclick = () => (this.openGroup === g ? this.closeToolGroup() : this.openToolGroup(g));
    bar.append(wrap);
    this.toolGroups.push(g);
    return g;
  }

  private openToolGroup(g: ToolGroupUi): void {
    this.closeToolGroup();
    this.openGroup = g;
    g.flyout.classList.remove('hidden');
    g.head.setAttribute('aria-expanded', 'true');
    const r = g.head.getBoundingClientRect(), f = g.flyout.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    if (r.right < vw / 2 && r.top < vh - 120) { // toolbar down the left edge: open to the right
      g.flyout.style.left = `${Math.round(r.right + 6)}px`;
      g.flyout.style.top = `${Math.round(Math.max(8, Math.min(r.top, vh - f.height - 8)))}px`;
    } else { // toolbar along the bottom (phones): open upwards
      g.flyout.style.left = `${Math.round(Math.max(8, Math.min(r.left, vw - f.width - 8)))}px`;
      g.flyout.style.top = `${Math.round(Math.max(8, r.top - f.height - 6))}px`;
    }
  }

  private closeToolGroup(): void {
    const g = this.openGroup;
    if (!g) return;
    this.openGroup = null;
    g.flyout.classList.add('hidden');
    g.head.setAttribute('aria-expanded', 'false');
  }

  private toolUnlocked(id: ToolId): boolean {
    return !isMilestoneTool(id) || (this.state.stats?.unlocked?.includes(id) ?? false);
  }

  /** Group members share one button once two or more are unlocked; otherwise they sit in the bar as before. */
  private layoutToolGroups(): void {
    for (const g of this.toolGroups) {
      const unlocked = g.def.members.filter((id) => this.toolUnlocked(id));
      const grouped = unlocked.length >= 2;
      if (grouped !== g.grouped) {
        g.grouped = grouped;
        for (const id of g.def.members) {
          const btn = this.toolButtons.get(id)!;
          if (grouped) g.flyout.append(btn); else g.wrap.before(btn);
        }
        g.wrap.classList.toggle('hidden', !grouped);
        if (!grouped && this.openGroup === g) this.closeToolGroup();
      }
      if (!grouped) continue;
      const tool = this.state.tool as ToolId;
      if (g.def.members.includes(tool)) g.last = tool;
      const cur = g.last && unlocked.includes(g.last) ? g.last : unlocked[0];
      const active = g.def.members.includes(tool);
      g.head.classList.toggle('selected', active);
      g.label.textContent = active ? TOOLS[cur].name : g.def.name;
      g.cost.textContent = active ? priceLabel(cur) : `${unlocked.length} buildings`;
      g.head.title = `${g.def.name}: ${unlocked.map((id) => `${TOOLS[id].name} (${TOOLS[id].hotkey.toUpperCase()})`).join(', ')}`;
      if (g.shown !== cur) {
        g.shown = cur;
        const src = this.toolButtons.get(cur)!.querySelector('canvas')!;
        const ctx = g.icon.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, 32, 32);
        ctx.drawImage(src, 0, 0);
      }
    }
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
    this.crimeText = el('span', { class: 'crime bad hidden', id: 'crime', title: `Crime is high and no police station is powered. ${POLICE_HELP}` }, '⚠ crime');
    this.trafficWord = el('span', { class: 'word' });
    this.trafficFill = el('span', { class: 'fill' });
    this.trafficText = el('div', { class: 'traffic hidden', id: 'traffic', title: TRAFFIC_HELP }, el('span', { text: '🚗 ' }), this.trafficWord, el('span', { class: 'meter' }, this.trafficFill));
    this.tradeText = el('div', { class: 'trade hidden', id: 'powerTrade', title: POWER_TRADE_HELP });
    this.neighbourText = el('div', { class: 'neighbours hidden', id: 'neighbours', title: NEIGHBOUR_HELP });
    this.budgetText = el('div', { class: 'budget', id: 'budget', title: 'Net budget over the last game year: taxes on your population minus upkeep for roads, rail, stations and power plants. Click for the budget screen.' });
    this.budgetText.onclick = () => this.toggleBudget();
    const box = el('div', { id: 'rci', class: 'panel', title: 'Residential / Commercial / Industrial demand' },
      el('div', { class: 'rci-bars' }, r.wrap, c.wrap, i.wrap),
      el('div', { class: 'power-line' }, this.powerText),
      el('div', { class: 'power-line', id: 'safety' }, this.crimeText),
      this.trafficText,
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
      el('p', { class: 'muted' }, 'Controls: drag to pan (query tool, middle/right button or hold Space) or use WASD / the arrow keys, wheel or +/- to zoom, H shows the whole world, G goes to your city, double-click a plot in the world view to zoom in, hotkeys select tools, drag roads, rail, power lines, parks and zones to lay several at once (Shift for a freeform line), Esc returns to query.'),
    );
    this.root.append(this.about);
  }

  private buildLeaderboard(): void {
    const close = el('button', { class: 'btn ghost round close', title: 'Close' }, '×');
    close.onclick = () => this.hide(this.leaderboard);
    this.lbRows = el('div', { class: 'lb-rows' });
    this.lbMe = el('div', { class: 'lb-me muted' });
    this.lbWorld = el('div', { class: 'lb-world muted' });
    this.lbTitle = el('h2', { text: '🏆 Top cities' });
    this.lbPageBtn = el('button', { class: 'btn lb-page', type: 'button' });
    this.lbPageBtn.onclick = () => this.setLeaderboardPage(this.monView.classList.contains('hidden') ? 'monuments' : 'top');
    this.lbView = el('div', { class: 'lb-view' },
      el('div', { class: 'lb-head' },
        el('span', { class: 'rank', text: '#' }), el('span', { class: 'sw' }), el('span', { class: 'name', text: 'City' }),
        el('span', { class: 'pop', text: 'Population' }), el('span', { class: 'ms', text: 'Milestones', title: 'Share of milestone buildings unlocked (see 🏛 Milestones)' }), el('span', { class: 'chunks', text: 'Plots' }), el('span', { class: 'fires' }), el('span', { class: 'visit' })),
      this.lbRows,
      this.lbMe,
      this.lbWorld,
    );
    this.monRows = el('div', { class: 'lb-rows' });
    this.monView = el('div', { class: 'lb-view mon-view hidden' },
      el('p', { class: 'muted mon-intro', text: `Cities whose mayors retired them as monuments after passing ${MONUMENT_MIN_POP.toLocaleString('en-US')} people. They stand forever, frozen as they were left.` }),
      el('div', { class: 'lb-head' },
        el('span', { class: 'rank', text: '#' }), el('span', { class: 'sw' }), el('span', { class: 'name', text: 'City' }),
        el('span', { class: 'pop', text: 'Population' }), el('span', { class: 'chunks', text: 'Plots' }), el('span', { class: 'date', text: 'Retired' }), el('span', { class: 'visit' })),
      this.monRows,
    );
    this.leaderboard = el('div', { id: 'leaderboard', class: 'panel card hidden' },
      close,
      el('div', { class: 'lb-title' }, this.lbTitle, this.lbPageBtn),
      this.lbView,
      this.monView,
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
    setInterval(() => { this.miniDirty = true; this.scheduleMini(); }, NIGHT_REFRESH_MS); // the corner map's night shade moves with the sun
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
    const debt = s?.debt ?? 0;
    this.budgetText.textContent = `💰 ${net >= 0 ? '+' : '−'}${fmtMoney(Math.abs(net))} last year${debt > 0 ? ` · 🛟 owes ${fmtMoney(debt)}` : ''}`;
    this.lifelineBtn.classList.toggle('hidden', !s?.lifelineAvailable);
    const canRetire = (s?.population ?? 0) >= MONUMENT_MIN_POP && this.state.ownedChunkCount() > 0;
    this.monumentBtn.classList.toggle('hidden', !canRetire);
    if (!canRetire) this.monumentPanel?.classList.add('hidden');
    const canAbandon = this.state.ownedChunkCount() > 0 && (s?.funds ?? Infinity) < ABANDON_MAX_FUNDS && (s?.debt ?? 0) > 0;
    this.abandonBtn.classList.toggle('hidden', !canAbandon);
    if (!canAbandon) this.abandonPanel?.classList.add('hidden');
    if (!s?.lifelineAvailable) this.lifelinePanel?.classList.add('hidden');
    this.budgetText.classList.toggle('bad', net < 0);
    this.budgetText.classList.toggle('hidden', !s);
    this.budgetBtn.classList.toggle('hidden', this.state.ownedChunkCount() === 0);
    if (this.state.ownedChunkCount() === 0) this.budgetPanel?.classList.add('hidden');
    this.refreshBudget();
    const neighbours = s?.neighbours ?? 0, railLinks = s?.railLinks ?? 0;
    this.neighbourText.textContent = `🤝 ${neighbours} ${neighbours === 1 ? 'neighbour' : 'neighbours'} · 🚆 ${railLinks} ${railLinks === 1 ? 'rail link' : 'rail links'}`;
    this.neighbourText.classList.toggle('hidden', neighbours <= 0 && railLinks <= 0);
    const sup = s?.powerSupply ?? 0, dem = s?.powerDemand ?? 0;
    this.powerText.textContent = `⚡ ${dem} / ${sup}`;
    this.powerText.title = `Power: ${dem} zones in use of ${sup} capacity. ${POWER_TRADE_HELP}`;
    this.powerText.classList.toggle('bad', dem > sup);
    this.refreshPowerTrade(s?.powerImported ?? 0, s?.powerExported ?? 0, s?.powerTradeNet ?? 0);
    const fires = s?.fires ?? 0;
    this.fireBtn.textContent = `🔥 ${fires} ${fires === 1 ? 'fire' : 'fires'}`;
    this.fireBtn.classList.toggle('hidden', fires <= 0);
    // crime warning (old servers omit these: treat as no police, no crime)
    const police = s?.policeStations ?? 0, crime = s?.crime ?? 0;
    this.crimeText.classList.toggle('hidden', !(crime >= 0.5 && police === 0));
    // traffic
    const traffic = Math.max(0, Math.min(1, s?.traffic ?? 0));
    const word = trafficLabel(traffic);
    this.trafficWord.textContent = word ? `${word} traffic` : '';
    this.trafficFill.style.width = `${Math.round(traffic * 100)}%`;
    this.trafficFill.className = `fill ${word}`;
    this.trafficText.classList.toggle('hidden', !word);
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
      if (id === 'grandcentral') {
        // unlocked by a rail link to another mayor's city rather than by population; hidden until then
        const unlocked = st?.unlocked?.includes(id) ?? false, built = (st?.built?.grandcentral ?? 0) >= 1;
        btn.classList.toggle('hidden', !unlocked);
        btn.classList.toggle('built', built);
        const cost = btn.querySelector('.cost');
        if (cost) cost.textContent = built ? 'Built' : priceLabel(id);
        btn.title = built ? 'Grand Central: your city already has one (one per city). It can be rebuilt if it is destroyed.'
          : `Grand Central — ${priceLabel(id)} (${TOOLS[id].hotkey.toUpperCase()}). Click your east-west rail line: the track runs through the station. ${GRAND_CENTRAL.benefits.slice(0, 2).join('. ')}.`;
        continue;
      }
      if (!isMilestoneTool(id)) continue;
      // Milestone buildings: show what is unlocked plus only the next one, so the toolbar never fills with
      // locked choices. A per-city limit (city hall) shows as "Built" once reached.
      const m = MILESTONE_BUILDINGS[id];
      const unlocked = st?.unlocked?.includes(id) ?? false;
      const isNext = !unlocked && nextMilestone(st?.peakPop ?? 0)?.building === id;
      const atMax = unlocked && m.max !== undefined && (st?.built?.[id] ?? 0) >= m.max;
      btn.classList.toggle('hidden', !unlocked && !isNext);
      btn.classList.toggle('locked', !unlocked);
      btn.classList.toggle('built', atMax);
      const cost = btn.querySelector('.cost');
      if (cost) cost.textContent = !unlocked ? `🔒 ${fmtCompact(m.pop)} pop` : atMax ? 'Built' : priceLabel(id);
      btn.title = !unlocked ? `${m.name}: unlocks at ${m.pop.toLocaleString('en-US')} people. ${m.benefits.join('. ')}.`
        : atMax ? `${m.name}: your city already has one (one per city). It can be rebuilt if it is destroyed.`
        : `${m.name} — ${priceLabel(id)} (${TOOLS[id].hotkey.toUpperCase()}). ${m.benefits.join('. ')}.`;
    }
    this.layoutToolGroups();
  }

  // ---------- lifeline ----------
  private buildLifeline(): void {
    const close = el('button', { class: 'btn ghost round close', title: 'Close' }, '×');
    close.onclick = () => this.hide(this.lifelinePanel);
    const take = el('button', { class: 'btn primary', type: 'button' }, `Take the ${fmtMoney(LIFELINE_AMOUNT)} lifeline`);
    take.onclick = () => { this.actions.lifeline(); this.hide(this.lifelinePanel); };
    const later = el('button', { class: 'btn', type: 'button' }, 'Not now');
    later.onclick = () => this.hide(this.lifelinePanel);
    this.lifelinePanel = el('div', { id: 'lifeline', class: 'panel card hidden' },
      close,
      el('h2', { text: '🛟 Lifeline' }),
      el('p', { text: `Your city has less than ${fmtMoney(LIFELINE_MAX_FUNDS)}. Take an emergency loan of ${fmtMoney(LIFELINE_AMOUNT)} to get it running again: enough for a power plant and repairs.` }),
      el('ul', { class: 'ms-benefits' },
        el('li', { text: 'No interest' }),
        el('li', { text: `Repaid automatically from ${Math.round(LIFELINE_REPAY_SHARE * 100)}% of each month's surplus` }),
        el('li', { text: 'Nothing is taken in months that run at a loss' }),
        el('li', { text: `New cities (under ${LIFELINE_EARLY_PEAK_POP.toLocaleString('en-US')} people) may take another while still repaying, up to ${fmtMoney(LIFELINE_MAX_DEBT)} owed` }),
        el('li', { text: 'Bigger cities: one lifeline at a time' })),
      el('div', { class: 'row' }, take, later),
    );
    this.root.append(this.lifelinePanel);
  }
  private buildMonument(): void {
    const close = el('button', { class: 'btn ghost round close', title: 'Close' }, '×');
    close.onclick = () => this.hide(this.monumentPanel);
    const go = el('button', { class: 'btn primary', type: 'button' }, 'Make it a monument and start over');
    go.onclick = () => { this.actions.monument(); this.hide(this.monumentPanel); };
    const later = el('button', { class: 'btn', type: 'button' }, 'Keep playing');
    later.onclick = () => this.hide(this.monumentPanel);
    this.monumentCity = el('p');
    this.monumentPanel = el('div', { id: 'monument', class: 'panel card hidden' },
      close,
      el('h2', { text: '🏛 Make your city a monument' }),
      this.monumentCity,
      el('ul', { class: 'ms-benefits' },
        el('li', { text: 'The city stays on the map forever under your name, exactly as it is now' }),
        el('li', { text: 'It is frozen: no growth, no decline, no fires, no costs, and it is never released' }),
        el('li', { text: 'It leaves the leaderboard; its airports and seaports stay on the world routes' }),
        el('li', { text: `You start over with ${fmtMoney(STARTING_FUNDS)} and claim a new first plot anywhere; milestones start again from zero` }),
        el('li', { text: 'This cannot be undone' })),
      el('div', { class: 'row' }, go, later),
    );
    this.root.append(this.monumentPanel);
  }
  private buildAbandon(): void {
    const close = el('button', { class: 'btn ghost round close', title: 'Close' }, '×');
    close.onclick = () => this.hide(this.abandonPanel);
    const go = el('button', { class: 'btn danger', type: 'button' }, 'Abandon my city and start over');
    go.onclick = () => { this.actions.abandon(); this.hide(this.abandonPanel); };
    const later = el('button', { class: 'btn', type: 'button' }, 'Keep trying');
    later.onclick = () => this.hide(this.abandonPanel);
    this.abandonCity = el('p');
    this.abandonPanel = el('div', { id: 'abandon', class: 'panel card hidden' },
      close,
      el('h2', { text: '🏳 Abandon your city' }),
      this.abandonCity,
      el('ul', { class: 'ms-benefits' },
        el('li', { text: 'All your plots are released: anyone can claim them' }),
        el('li', { text: 'The empty city slowly crumbles into ruins until someone takes over a plot' }),
        el('li', { text: `You start over with ${fmtMoney(STARTING_FUNDS)} and claim a new first plot anywhere; your lifeline debt is written off` }),
        el('li', { text: 'Milestones start again from zero' }),
        el('li', { text: 'This cannot be undone' })),
      el('div', { class: 'row' }, go, later),
    );
    this.root.append(this.abandonPanel);
  }
  private toggleAbandon(): void {
    if (!this.abandonPanel.classList.contains('hidden')) { this.hide(this.abandonPanel); return; }
    this.hide(this.milestones); this.hide(this.leaderboard); this.hide(this.about); this.hide(this.lifelinePanel); this.hide(this.monumentPanel); this.hide(this.budgetPanel);
    const s = this.state.stats, city = this.state.cityName || 'Your city';
    this.abandonCity.textContent = `${city} has run out of money and still owes ${fmtMoney(s?.debt ?? 0)} on its lifeline. If it can't recover, you can leave it behind and found a new city.`;
    this.abandonPanel.classList.remove('hidden');
  }

  private toggleMonument(): void {
    if (!this.monumentPanel.classList.contains('hidden')) { this.hide(this.monumentPanel); return; }
    this.hide(this.milestones); this.hide(this.leaderboard); this.hide(this.about); this.hide(this.lifelinePanel); this.hide(this.budgetPanel);
    const s = this.state.stats, city = this.state.cityName || 'Your city';
    this.monumentCity.textContent = `${city} has ${(s?.population ?? 0).toLocaleString('en-US')} people. You can retire it as a monument: a lasting record of what you built, while you start a new city somewhere else.`;
    this.monumentPanel.classList.remove('hidden');
  }

  private toggleLifeline(): void {
    if (!this.lifelinePanel.classList.contains('hidden')) { this.hide(this.lifelinePanel); return; }
    this.hide(this.milestones); this.hide(this.leaderboard); this.hide(this.about); this.hide(this.budgetPanel);
    this.lifelinePanel.classList.remove('hidden');
  }

  // ---------- map overlays ----------
  private overlayBar!: HTMLElement;
  private overlayLegend!: HTMLElement;
  private overlayToggle!: HTMLButtonElement;
  private overlayBody!: HTMLElement;
  private buildOverlayBar(): void {
    const btns = OVERLAY_MODES.map((m) => {
      const info = OVERLAY_INFO[m];
      const b = el('button', { class: 'btn ov-btn', type: 'button', 'data-mode': m, title: `Map view: ${info.name}`, 'aria-pressed': String(m === 'none') }, `${info.icon} ${m === 'none' ? 'Normal' : info.name}`);
      b.onclick = () => { this.autoOverlay = null; this.setOverlay(m); };
      return b;
    });
    this.overlayLegend = el('div', { class: 'ov-legend hidden' });
    this.overlayBody = el('div', { class: 'ov-body hidden', id: 'ovBody' }, el('div', { class: 'ov-buttons', role: 'group', 'aria-label': 'Map view' }, ...btns), this.overlayLegend);
    // Collapsed by default to a single small button; remembers the viewer's choice.
    this.overlayToggle = el('button', { class: 'btn ov-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'ovBody', title: 'Map views: power, fire hazard, crime, traffic, pollution, land value, density (V)' }, '🗺 Map view');
    this.overlayToggle.onclick = () => this.setOverlayOpen(this.overlayBody.classList.contains('hidden'));
    this.overlayBar = el('div', { id: 'overlays', class: 'panel' }, this.overlayToggle, this.overlayBody);
    this.root.append(this.overlayBar);
    let open = false;
    try { open = localStorage.getItem('globalcity.mapViewOpen') === '1'; } catch { /* ignore */ }
    this.setOverlayOpen(open);
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() !== 'v' || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      const i = OVERLAY_MODES.indexOf(this.renderer.overlay.mode);
      this.autoOverlay = null; this.setOverlay(OVERLAY_MODES[(i + 1) % OVERLAY_MODES.length]);
    });
  }
  private setOverlayOpen(open: boolean): void {
    this.overlayBody.classList.toggle('hidden', !open);
    this.overlayToggle.setAttribute('aria-expanded', String(open));
    this.overlayBar.classList.toggle('open', open);
    try { localStorage.setItem('globalcity.mapViewOpen', open ? '1' : '0'); } catch { /* ignore */ }
    this.refreshOverlayToggle();
  }
  private refreshOverlayToggle(): void {
    const m = this.renderer.overlay.mode, info = OVERLAY_INFO[m];
    const open = !this.overlayBody.classList.contains('hidden');
    this.overlayToggle.textContent = `${m === 'none' ? '🗺 Map view' : `${info.icon} ${info.name}`} ${open ? '▴' : '▾'}`;
    this.overlayToggle.classList.toggle('active', m !== 'none');
  }
  /** Turn the map view off; false when it was already off. */
  clearOverlay(): boolean {
    if (this.renderer.overlay.mode === 'none') return false;
    this.autoOverlay = null;
    this.setOverlay('none');
    return true;
  }

  setOverlay(m: OverlayMode): void {
    this.renderer.overlay.setMode(m);
    for (const b of this.overlayBar.querySelectorAll<HTMLButtonElement>('.ov-btn')) {
      const on = b.dataset.mode === m;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    }
    const info = OVERLAY_INFO[m];
    this.overlayLegend.replaceChildren(
      ...info.legend.map((l) => el('span', { class: 'ov-key' }, el('i', { style: `background:${l.color}` }), l.label)),
      ...(info.note ? [el('p', { class: 'ov-note', text: info.note })] : []),
    );
    this.overlayLegend.classList.toggle('hidden', m === 'none');
    this.refreshOverlayToggle();
    if (m !== 'none' && !this.renderer.isTileMode()) this.toast('Zoom in to see the map view', 'info');
    this.renderer.invalidate();
  }

  // ---------- budget ----------
  private buildBudget(): void {
    const close = el('button', { class: 'btn ghost round close', title: 'Close' }, '×');
    close.onclick = () => this.hide(this.budgetPanel);
    this.taxSlider = el('input', { type: 'range', id: 'taxSlider', min: String(TAX_RATE_MIN), max: String(TAX_RATE_MAX), step: '1', value: String(TAX_RATE) });
    this.taxSlider.oninput = () => { this.taxPending = Number(this.taxSlider.value); this.refreshBudget(); };
    this.taxSlider.onchange = () => {
      const rate = Number(this.taxSlider.value);
      if (rate !== (this.state.stats?.taxRate ?? TAX_RATE)) this.actions.setTaxRate(rate); else this.taxPending = null;
      this.refreshBudget();
    };
    this.taxLabel = el('span', { class: 'tax-val' });
    this.taxEffect = el('div', { class: 'tax-effect muted' });
    this.budgetTable = el('table', { class: 'budget-table' });
    this.budgetPanel = el('div', { id: 'budgetPanel', class: 'panel card hidden' },
      close,
      el('h2', { text: '💰 Budget' }),
      el('div', { class: 'tax-row' }, el('label', { for: 'taxSlider', text: 'Tax rate' }), this.taxSlider, this.taxLabel),
      this.taxEffect,
      this.budgetTable,
      el('p', { class: 'muted small', text: `Taxes are collected every month on residents and jobs; ${TAX_RATE}% is neutral for demand, a lower rate attracts people and businesses, a higher one drives them away. Upkeep is charged monthly on everything standing. Nothing is earned or charged while you are away.` }),
    );
    this.root.append(this.budgetPanel);
  }
  toggleBudget(): void {
    if (!this.budgetPanel.classList.contains('hidden')) { this.hide(this.budgetPanel); return; }
    this.hide(this.about); this.hide(this.leaderboard); this.hide(this.milestones); this.hide(this.lifelinePanel); this.hide(this.monumentPanel); this.hide(this.abandonPanel);
    this.taxPending = null;
    this.budgetPanel.classList.remove('hidden');
    this.refreshBudget();
  }
  /** Yearly tax income at a rate, from the same figures the server uses (for the slider preview). */
  private taxesAt(rate: number): number {
    const s = this.state.stats;
    if (!s) return 0;
    const jobs = ((s.comPop ?? 0) + (s.indPop ?? 0)) * 8;
    return Math.round(((s.resPop ?? 0) + jobs) * rate * TAX_MULT * ((s.cityHall ?? 0) > 0 ? 1 + CITYHALL_TAX_BONUS : 1));
  }
  private refreshBudget(): void {
    if (!this.budgetPanel || this.budgetPanel.classList.contains('hidden')) return;
    const s = this.state.stats;
    const serverRate = s?.taxRate ?? TAX_RATE;
    if (this.taxPending !== null && this.taxPending === serverRate) this.taxPending = null; // the server caught up
    const rate = this.taxPending ?? serverRate;
    if (this.taxPending === null && document.activeElement !== this.taxSlider) this.taxSlider.value = String(serverRate);
    this.taxLabel.textContent = `${rate}%`;
    const d = taxDemand(rate);
    this.taxEffect.textContent = d === 0 ? `Demand: neutral (the ${TAX_RATE}% default)` : `Demand: ${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)} on R, C and I${d < 0 ? ' — people and businesses stay away' : ' — people and businesses move in'}`;
    this.taxEffect.classList.toggle('bad', d < 0);
    this.taxEffect.classList.toggle('good', d > 0);

    const b = s?.budget ?? { taxes: 0, upkeep: { roads: 0, rail: 0, power: 0, services: 0 }, lastYear: { taxes: 0, upkeep: 0, power: 0, repaid: 0, net: 0 } };
    const taxes = rate === serverRate ? b.taxes : this.taxesAt(rate);
    const upkeep = b.upkeep.roads + b.upkeep.rail + b.upkeep.power + b.upkeep.services;
    const power = (s?.powerTradeNet ?? 0) * 12; // last month's trade, as a yearly figure
    const before = taxes - upkeep + power;
    const debt = s?.debt ?? 0;
    const repaid = debt > 0 ? Math.min(debt, Math.max(0, Math.round(before * LIFELINE_REPAY_SHARE))) : 0;
    const net = before - repaid;
    const ly = b.lastYear;
    const money = (n: number, sign: 1 | -1 = 1): HTMLElement => {
      const v = n * sign;
      return el('td', { class: `num ${v < 0 ? 'bad' : v > 0 ? 'good' : 'muted'}`, text: n === 0 ? '—' : `${v < 0 ? '−' : '+'}${fmtMoney(Math.abs(v))}` });
    };
    const row = (cls: string, label: string, now: number, last: number | null, sign: 1 | -1 = 1): HTMLElement =>
      el('tr', { class: cls }, el('td', { text: label }), money(now, sign), last === null ? el('td', { class: 'num muted', text: '' }) : money(last, sign));
    const rows = [
      el('tr', { class: 'head' }, el('th', { text: '' }), el('th', { text: `Per year, at ${rate}%` }), el('th', { text: 'Last year' })),
      row('income', 'Taxes', taxes, ly.taxes),
      row('sub', 'Upkeep', upkeep, ly.upkeep, -1),
      row('detail', 'Roads', b.upkeep.roads, null, -1),
      row('detail', 'Rail', b.upkeep.rail, null, -1),
      row('detail', 'Power plants', b.upkeep.power, null, -1),
      row('detail', 'Services', b.upkeep.services, null, -1),
    ];
    if (power !== 0 || ly.power !== 0) rows.push(row('income', 'Power trade', power, ly.power));
    if (repaid !== 0 || ly.repaid !== 0 || debt > 0) rows.push(row('sub', 'Lifeline repayment', repaid, ly.repaid, -1));
    rows.push(row('total', 'Net', net, ly.net));
    this.budgetTable.replaceChildren(...rows);
    this.budgetTable.title = 'Services: fire and police stations, schools, the university, city hall and Grand Central. Power trade: last month, as a yearly figure.';
  }

  // ---------- milestones ----------
  private buildMilestones(): void {
    const close = el('button', { class: 'btn ghost round close', title: 'Close' }, '×');
    close.onclick = () => this.hide(this.milestones);
    this.msRows = el('div', { class: 'ms-rows' });
    this.milestones = el('div', { id: 'milestones', class: 'panel card hidden' },
      close,
      el('h2', { text: '🏛 Milestones' }),
      el('p', { class: 'muted', text: 'As your city grows it unlocks special buildings. Here is what you have unlocked, and the next one to work towards.' }),
      this.msRows,
    );
    this.root.append(this.milestones);
  }
  toggleMilestones(): void {
    if (!this.milestones.classList.contains('hidden')) { this.hide(this.milestones); return; }
    this.hide(this.about); this.hide(this.leaderboard); this.hide(this.budgetPanel);
    this.milestones.classList.remove('hidden');
    this.refreshMilestones();
  }
  private msIcon(b: MilestoneBuilding): HTMLCanvasElement {
    const t = TOOLS[MILESTONE_BUILDINGS[b].tool];
    const n = t.size, px = 72;
    const c = el('canvas', { class: 'ms-icon', width: String(px), height: String(px) });
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    if (t.custom) {
      const img = this.renderer.customs.images.get(t.custom);
      const paint = () => { if (img && img.naturalWidth) drawCustomFit(g, img, t.custom!, px); };
      if (img?.complete) paint(); else img?.addEventListener('load', paint, { once: true });
      return c;
    }
    const cell = px / n;
    for (let k = 0; k < n * n; k++) drawTile(g, this.sheet, t.base! + k, (k % n) * cell, Math.floor(k / n) * cell, cell, cell);
    return c;
  }
  private refreshMilestones(): void {
    if (!this.milestones || this.milestones.classList.contains('hidden')) return;
    const st = this.state.stats;
    const peak = st?.peakPop ?? 0;
    const next = nextMilestone(peak)?.building;
    const shown = MILESTONE_ORDER.filter((b) => (st?.unlocked?.includes(b) ?? false) || b === next).reverse(); // next one on top
    const rows = shown.map((b) => {
      const m = MILESTONE_BUILDINGS[b];
      const unlocked = st?.unlocked?.includes(b) ?? false;
      const built = m.max !== undefined && (st?.built?.[b] ?? 0) >= m.max;
      const status = built ? { cls: 'done', text: 'Built (one per city)' } : unlocked ? { cls: 'ready', text: 'Unlocked: build it from the toolbar' }
        : { cls: 'locked', text: `${(m.pop - peak).toLocaleString('en-US')} more people` };
      const pct = Math.max(0, Math.min(100, (peak / m.pop) * 100));
      const t = TOOLS[m.tool];
      return el('div', { class: `ms-row ${status.cls}` },
        this.msIcon(b),
        el('div', { class: 'ms-body' },
          el('div', { class: 'ms-head' }, el('strong', { text: m.name }), el('span', { class: 'chip', text: `${m.pop.toLocaleString('en-US')} people` })),
          el('ul', { class: 'ms-benefits' }, ...m.benefits.map((x) => el('li', { text: x }))),
          el('div', { class: 'ms-meta muted', text: `${fmtMoney(t.cost)} · ${t.w ?? t.size}×${t.h ?? t.size} tiles` }),
          unlocked ? el('div', { class: `ms-status ${status.cls}`, text: status.text })
            : el('div', { class: 'ms-progress' }, el('div', { class: 'ms-bar' }, el('div', { class: 'ms-fill', style: `width:${pct.toFixed(1)}%` })), el('span', { class: 'ms-status locked', text: status.text })),
        ));
    });
    rows.unshift(this.grandCentralRow());
    this.msRows.replaceChildren(...rows);
  }

  /** Grand Central's row in the milestones panel: unlocked by a rail link, not by population. */
  private grandCentralRow(): HTMLDivElement {
    const st = this.state.stats;
    const t = TOOLS.grandcentral;
    const unlocked = st?.unlocked?.includes('grandcentral') ?? false, built = (st?.built?.grandcentral ?? 0) >= 1;
    const status = built ? { cls: 'done', text: 'Built (one per city)' } : unlocked ? { cls: 'ready', text: 'Unlocked: click your east-west rail line with it' }
      : { cls: 'locked', text: GRAND_CENTRAL.unlock };
    const c = el('canvas', { class: 'ms-icon', width: '72', height: '72' });
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    const img = this.renderer.customs.images.get('grandcentral');
    const paint = () => { if (img && img.naturalWidth) drawCustomFit(g, img, 'grandcentral', 72); };
    if (img?.complete) paint(); else img?.addEventListener('load', paint, { once: true });
    return el('div', { class: `ms-row ${status.cls}` }, c,
      el('div', { class: 'ms-body' },
        el('div', { class: 'ms-head' }, el('strong', { text: 'Grand Central' }), el('span', { class: 'chip', text: '🚆 rail link' })),
        el('ul', { class: 'ms-benefits' }, ...GRAND_CENTRAL.benefits.map((x) => el('li', { text: x }))),
        el('div', { class: 'ms-meta muted', text: `${fmtMoney(t.cost)} · ${t.w}×${t.h} tiles` }),
        el('div', { class: `ms-status ${status.cls}`, text: status.text })));
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
    this.setLeaderboardPage('top');
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

  /** Switch the Top cities panel between the ranking and the monuments. */
  private setLeaderboardPage(page: 'top' | 'monuments'): void {
    const mon = page === 'monuments';
    this.lbView.classList.toggle('hidden', mon);
    this.monView.classList.toggle('hidden', !mon);
    this.lbTitle.textContent = mon ? '🏛 Monuments' : '🏆 Top cities';
    this.refreshLeaderboard();
  }

  private refreshLeaderboard(): void {
    if (!this.isLeaderboardOpen()) return;
    const mons = this.state.monuments;
    // old servers don't send monuments: no button then
    this.lbPageBtn.classList.toggle('hidden', mons === null);
    const onMon = !this.monView.classList.contains('hidden');
    this.lbPageBtn.textContent = onMon ? '← Top cities' : `🏛 Monuments${mons?.length ? ` (${mons.length})` : ''}`;
    this.lbPageBtn.title = onMon ? 'Back to the most populous cities' : 'Cities retired as monuments';
    if (onMon) {
      this.monRows.replaceChildren(...(mons?.length
        ? mons.map((m, i) => this.monumentRow(m, i + 1))
        : [el('div', { class: 'lb-empty muted', text: `No monuments yet. Grow a city past ${MONUMENT_MIN_POP.toLocaleString('en-US')} people and you can retire it as the first.` })]));
      return;
    }
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

  private monumentRow(m: MonumentEntry, rank: number): HTMLElement {
    const city = m.cityName || `${m.name}'s city`;
    const visit = el('button', { class: 'btn visit', title: `Fly to ${city} (plot ${m.cx},${m.cy})` }, 'Visit');
    visit.onclick = () => { this.actions.flyToChunk(m.cx, m.cy, 1, 900); this.hide(this.leaderboard); };
    const sw = el('span', { class: 'sw' });
    sw.style.background = m.color;
    const name = el('span', { class: 'name' }, el('span', { class: 'city', text: city }), el('span', { class: 'mayor muted', text: `by ${m.name}` }));
    name.style.color = m.color;
    const when = new Date(m.at);
    return el('div', { class: 'lb-row', 'data-id': m.id },
      el('span', { class: 'rank', text: `${rank}` }),
      sw, name,
      el('span', { class: 'pop', text: m.population.toLocaleString('en-US') }),
      el('span', { class: 'chunks', text: `${m.chunks}` }),
      el('span', { class: 'date muted', text: when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }), title: when.toLocaleString() }),
      visit,
    );
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
      milestoneCell(e.milestones),
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
    // Clicking a fire or police station shows its coverage map; clicking elsewhere drops a map view opened that way.
    const id = info.tile & LOMASK;
    const auto: OverlayMode | null = id >= FIRESTBASE && id < FIRESTBASE + 9 ? 'fire' : id >= POLICESTBASE && id < POLICESTBASE + 9 ? 'crime' : null;
    if (auto) { if (this.renderer.overlay.mode !== auto) { this.setOverlay(auto); this.autoOverlay = auto; } }
    else if (this.autoOverlay && this.renderer.overlay.mode === this.autoOverlay) { this.setOverlay('none'); this.autoOverlay = null; }
    const q = this.query;
    q.replaceChildren(
      el('div', { class: 'qname', text: info.name }),
      el('div', { class: 'qrow', text: `Tile ${info.x}, ${info.y}  #${info.tile}` }),
      el('div', { class: `qrow ${info.powered ? 'good' : 'bad'}`, text: info.powered ? '⚡ Powered' : '⚡ Unpowered' }),
      el('div', { class: 'qrow', text: info.owner ? `Owner: ${info.owner.cityName ? `${info.owner.cityName} — ` : ''}${info.owner.name}` : 'Unclaimed land' }),
      ...(info.zonePop !== undefined ? [el('div', { class: 'qrow', text: `${info.zoneKind === 'com' || info.zoneKind === 'ind' ? 'Jobs' : 'Residents'}: ${info.zonePop.toLocaleString('en-US')}` })] : []),
    );
    if (info.owner) (q.firstElementChild as HTMLElement).style.color = info.owner.color;
    this.placeQuery();
  }

  /** Where a plane or ship is going, where from, and what it carries (cargo is cosmetic, the same for everyone). */
  showVehicle(v: NonNullable<ReturnType<Renderer['pickVehicle']>>, cssX: number, cssY: number): void {
    this.queryPos = { x: cssX, y: cssY };
    this.queryPending = false;
    const city = (x: number, y: number): { text: string; color: string } => {
      const { cx, cy } = chunkOf(((Math.round(x) % WORLD_W) + WORLD_W) % WORLD_W, Math.round(y));
      const c = this.state.claims.get(chunkKey(cx, cy));
      return c ? { text: c.cityName ? `${c.cityName} (${c.ownerName})` : c.ownerName, color: c.color } : { text: 'Unknown port', color: '' };
    };
    const row = (label: string, p: { text: string; color: string }) => {
      const r = el('div', { class: 'qrow' }, `${label}: `, el('b', { text: p.text }));
      if (p.color) (r.lastElementChild as HTMLElement).style.color = p.color;
      return r;
    };
    const eta = (progress: number, duration: number): string => {
      const s = Math.max(0, Math.round((1 - progress) * duration / 1000));
      return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
    };
    const q = this.query;
    if (v.kind === 'plane') {
      const f = v.flight, load = flightLoad(f.key);
      q.replaceChildren(
        el('div', { class: 'qname', text: `✈ Flight ${load.flight}` }),
        row('From', city(f.fromX, f.fromY)),
        row('To', city(f.toX, f.toY)),
        el('div', { class: 'qrow', text: `Carrying ${load.passengers} passengers and ${load.freightT} t of ${load.freight}` }),
        el('div', { class: 'qrow muted', text: `Lands in ${eta(f.progress, f.duration)}` }),
      );
    } else {
      const s = v.voyage, cargo = shipCargo(s.key);
      q.replaceChildren(
        el('div', { class: 'qname', text: `🚢 ${cargo.kind}` }),
        row('From', city(s.from.x, s.from.y)),
        row('To', city(s.to.x, s.to.y)),
        el('div', { class: 'qrow', text: `Carrying ${cargo.amount.toLocaleString('en-US')} ${cargo.unit} of ${cargo.goods}` }),
        el('div', { class: 'qrow muted', text: `Docks in ${eta(s.progress, s.duration)}` }),
      );
    }
    this.placeQuery();
  }

  private placeQuery(): void {
    const q = this.query;
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
    // real-time night over the corner map too
    this.renderer.night.update();
    g.imageSmoothingEnabled = true;
    g.drawImage(this.renderer.night.canvas, 0, 0, cssW, cssH);
    g.imageSmoothingEnabled = false;
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
