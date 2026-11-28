// DOM overlay: top bar, toolbar, RCI, toasts, query popover, welcome/about panels, minimap widget.
import type { BudgetYear, ClaimInfo, Demand, LeaderboardEntry, MonumentEntry, QueryInfo, ToolId } from '@globalcity/shared';
import { OVERLAY_INFO, OVERLAY_MODES, type OverlayMode } from './overlays.ts';
import {
  budgetTotals,
  MONUMENT_MIN_POP,
  ABANDON_MAX_FUNDS,
  ABANDON_RECLAIM_DAYS,
  MAX_MAYOR_NAME,
  MAX_CITY_NAME,
  STARTING_FUNDS,
  LIFELINE_AMOUNT,
  LIFELINE_MAX_FUNDS,
  LIFELINE_REPAY_SHARE,
  LIFELINE_EARLY_PEAK_POP,
  LIFELINE_MAX_DEBT,
  LOMASK,
  FIRESTBASE,
  POLICESTBASE,
  CITYHALLBASE,
  LASTCITYHALL,
  chunkKey,
  shipCargo,
  flightLoad,
} from '@globalcity/shared';
import {
  CHUNK,
  claimCost,
  chunkLandCount,
  minLandToClaim,
  MILESTONE_BUILDINGS,
  MILESTONE_ORDER,
  isMilestoneTool,
  nextMilestone,
  type MilestoneBuilding,
  MAX_CHUNKS_PER_PLAYER,
  POWER_PRICE_PER_UNIT,
  fmtPower,
  fmtPowerPair,
  TOOLS,
  TOOL_ORDER,
  PLANT_OUTPUT,
  GRAND_CENTRAL,
  WORLD_H,
  WORLD_W,
  chunkOf,
  lonLatToTile,
} from '@globalcity/shared';
import { DISASTERS, DISASTER_COUNT, Disaster, type WorldStats } from '@globalcity/shared';
import type { Actions } from './actions.ts';
import type { Minimap, SpriteSheet } from './assets.ts';
import { iconDpr, ToolIcons } from './icons.ts';
import { precipMmH } from './weather.ts';
import type { Net } from './net.ts';
import type { Renderer } from './renderer.ts';
import { ZONE_TOOLS, type TouchPlan } from './input.ts';
import { NIGHT_REFRESH_MS } from './night.ts';
import { isFireTile, withAlpha } from './renderer.ts';
import { populationChart, warmingChart } from './chart.ts';
import type { AppState } from './state.ts';

/** Megatonnes of CO2 as a short label: "-3 Mt", "286 Mt", "1.2 Gt". */
const mtLabel = (mt: number): string => (Math.abs(mt) >= 1000 ? `${(mt / 1000).toFixed(1)} Gt` : `${Math.round(mt)} Mt`).replace(/^-/, '−');

/** Tabs of the World panel. */
type WorldTab = 'stats' | 'top' | 'monuments';

/** Toolbar groups: members share one button with a flyout once two or more of them are unlocked. */
const TOOL_GROUPS: { id: string; name: string; members: ToolId[] }[] = [
  { id: 'power', name: 'Power plants', members: ['coal', 'nuclear', 'windfarm', 'offshore'] },
  { id: 'education', name: 'Education', members: ['school', 'university'] },
  { id: 'ports', name: 'Ports', members: ['seaport', 'airport'] },
];
interface ToolGroupUi {
  def: (typeof TOOL_GROUPS)[number];
  wrap: HTMLElement;
  head: HTMLButtonElement;
  icon: HTMLCanvasElement;
  label: HTMLElement;
  cost: HTMLElement;
  flyout: HTMLElement;
  grouped: boolean | null;
  last: ToolId | null;
  shown: ToolId | null;
}

/** Price for a toolbar label; power plants add the power they make. */
const priceLabel = (id: ToolId): string => `${fmtMoney(TOOLS[id].cost)}${PLANT_OUTPUT[id] ? ` · ⚡${fmtPower(PLANT_OUTPUT[id])}` : ''}`;

/** Toolbar icon size in CSS px (16 px tiles at 2x); wide buildings are cropped to a square from their middle. */
const TOOL_ICON_PX = 32;
const TOOL_ICON_OPTS = { maxAspect: 1 };

/** Leaderboard cell: the share of milestones unlocked, as a number over a thin bar. */
function milestoneCell(pct: number | undefined): HTMLElement {
  if (pct === undefined) return el('span', { class: 'ms' });
  const fill = el('i', { class: 'lbms-fill' });
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  return el(
    'span',
    { class: `ms${pct >= 100 ? ' full' : ''}`, title: `${pct}% of milestones unlocked` },
    el('b', { text: `${pct}%` }),
    el('span', { class: 'lbms-bar' }, fill),
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WELCOMED_KEY = 'globalcity.welcomed';
/** how many times this browser has opened the game, and whether it has been invited to the Discord yet */
const VISITS_KEY = 'globalcity.visits';
const DISCORD_ASKED_KEY = 'globalcity.discordAsked';
/** The Discord invite (main had it off while its world reset countdown linked the Discord instead). */
const DISCORD_INVITE_ENABLED = true;
const TOAST_DEDUP_MS = 3000;
const POWER_TRADE_HELP = 'Power flows over wires across plot borders; surplus is sold at $1 per MW per month.';
export const NEIGHBOUR_HELP = "Neighbouring cities' jobs and shoppers add demand across the border; rail connecting your zones to theirs boosts commerce.";
export const POLICE_HELP = 'Police stations cover 14 tiles; uncovered lots lose land value once the city grows (crime)';
export const TRAFFIC_HELP = 'Average traffic on your roads: zones send cars along nearby roads; busy roads are drawn with traffic.';

/** Traffic word for stats.traffic (0..1), or '' when there is none. */
export function trafficLabel(t: number): '' | 'light' | 'moderate' | 'heavy' {
  if (!(t > 0)) return '';
  return t < 0.15 ? 'light' : t < 0.5 ? 'moderate' : 'heavy';
}

export type ToastKind = 'info' | 'error' | 'success';
export interface ToastAt {
  x: number;
  y: number;
}

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
export const DISCORD_URL = 'https://discord.gg/xgtC47ux4z';
/** Discord's logo mark (path from Simple Icons, CC0). Used only to link to our Discord server. */
const DISCORD_SVG_PATH =
  'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z';
function discordIcon(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'discord-icon');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', DISCORD_SVG_PATH);
  path.setAttribute('fill', 'currentColor');
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
export function fmtDate(year: number, month: number): string {
  return `${MONTHS[((month % 12) + 12) % 12]} ${year}`;
}

export class UI {
  readonly root: HTMLElement;
  private funds!: HTMLElement;
  private pop!: HTMLElement;
  private date!: HTMLElement;
  private online!: HTMLElement;
  private worldPop!: HTMLElement;
  private lbWorld!: HTMLElement;
  private nameBtn!: HTMLButtonElement;
  private cityNameBtn!: HTMLButtonElement;
  private plots!: HTMLElement;
  private plotsStat!: HTMLElement;
  private status!: HTMLElement;
  private offline!: HTMLElement;
  private claimBtn!: HTMLButtonElement;
  private findBtn!: HTMLButtonElement;
  private cityBtn!: HTMLButtonElement;
  private worldBtn!: HTMLButtonElement;
  private toolButtons = new Map<ToolId, HTMLButtonElement>();
  private toolGroups: ToolGroupUi[] = [];
  private openGroup: ToolGroupUi | null = null;
  private icons!: ToolIcons;
  private autoOverlay: OverlayMode | null = null; // map view opened by clicking a station
  private rciBars!: Record<'r' | 'c' | 'i', HTMLElement>;
  private rciBoost!: Record<'r' | 'c' | 'i', HTMLElement>;
  private powerText!: HTMLElement;
  private tradeText!: HTMLElement;
  private neighbourText!: HTMLElement;
  private budgetText!: HTMLElement;
  private crimeText!: HTMLElement;
  private trafficText!: HTMLElement;
  private trafficWord!: HTMLElement;
  private trafficFill!: HTMLElement;
  private toasts!: HTMLElement;
  private lastToast: { msg: string; kind: ToastKind; el: HTMLElement; at: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private lifelineBtn!: HTMLButtonElement;
  private lifelinePanel!: HTMLElement;
  private monumentBtn!: HTMLButtonElement;
  private monumentPanel!: HTMLElement;
  private monumentCity!: HTMLElement;
  private abandonBtn!: HTMLButtonElement;
  /** the mayor dialog (behind the mayor name): rename the mayor and the city, and abandon the city to start over */
  private mayorPanel!: HTMLElement;
  private mayorName!: HTMLInputElement;
  private mayorCity!: HTMLInputElement;
  private mayorCityRow!: HTMLElement;
  private mayorStart!: HTMLElement;
  private mayorStartText!: HTMLElement;
  private mayorAbandonBtn!: HTMLButtonElement;
  /** when this mayor last abandoned their city: the plots it releases are not "released after inactivity" */
  private abandonedAt = 0;
  private mayorConfirm!: HTMLElement;
  private mayorConfirmList!: HTMLElement;
  private mayorMonumentBtn!: HTMLButtonElement;
  private mayorConfirmBtn!: HTMLButtonElement;
  private budgetBtn!: HTMLButtonElement;
  private budgetPanel!: HTMLElement;
  private budgetTable!: HTMLElement;
  private milestones!: HTMLElement;
  private msRows!: HTMLElement;
  private msBtn!: HTMLButtonElement;
  /** the World panel: tabs for the world stats, the top cities and the monuments */
  private leaderboard!: HTMLElement;
  private lbRows!: HTMLElement;
  private lbMe!: HTMLElement;
  /** the World panel views: world stats, top cities, monuments */
  private lbTitle!: HTMLElement;
  private lbView!: HTMLElement;
  private monView!: HTMLElement;
  private monRows!: HTMLElement;
  private worldTab: WorldTab = 'stats';
  private worldTabBtns = new Map<WorldTab, HTMLButtonElement>();
  private wsView!: HTMLElement;
  private wsYear: number | null = null;
  private fireBtn!: HTMLButtonElement;
  private fireCycle = 0;
  private query!: HTMLElement;
  private queryPos = { x: 0, y: 0 };
  private queryTimer: ReturnType<typeof setTimeout> | null = null;
  private queryPending = false;
  private welcome!: HTMLElement;
  private welcomeStatus!: HTMLElement;
  private welcomeDismissed = false;
  private welcomeMode: 'idle' | 'locating' | 'pick' = 'idle';
  /** we saw this player with zero plots this session, so the next plot is a founding */
  private sawNoPlots = false;
  private foundedToastShown = false;
  private discordInvite!: HTMLElement;
  private about!: HTMLElement;
  private mini!: HTMLCanvasElement;
  private miniDirty = true;

  constructor(
    readonly state: AppState,
    readonly net: Net,
    readonly renderer: Renderer,
    readonly actions: Actions,
    readonly sheet: SpriteSheet,
    readonly minimap: Minimap,
  ) {
    this.root = document.getElementById('ui') ?? document.body.appendChild(el('div', { id: 'ui' }));
    this.icons = new ToolIcons(sheet, renderer.customs);
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
    this.buildMayor();
    this.buildBudget();
    this.buildDiscordInvite();
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
    this.nameBtn = el('button', { class: 'btn ghost', id: 'nameBtn', title: 'You, the mayor: rename yourself or your city, or start over' }, '…');
    this.nameBtn.onclick = () => this.toggleMayor('mayor');
    this.cityNameBtn = el('button', { class: 'btn ghost city hidden', id: 'cityNameBtn', title: 'Your city — click to rename' }, '');
    this.cityNameBtn.onclick = () => this.toggleMayor('city');
    this.plots = el('span', { class: 'val', text: `0/${MAX_CHUNKS_PER_PLAYER}` });
    this.plotsStat = el(
      'div',
      { class: 'stat hidden', id: 'plots', title: `Plots claimed (a city is at most ${MAX_CHUNKS_PER_PLAYER} plots)` },
      el('span', { class: 'ico' }, 'Plots'),
      this.plots,
    );
    this.claimBtn = el('button', { class: 'btn primary hidden', id: 'claimBtn' }, 'Claim this plot');
    this.claimBtn.onclick = () => this.claimCenter();
    this.findBtn = el('button', { class: 'btn hidden', id: 'findBtn', title: 'Ask the server for the nearest free plot' }, 'Find free plot');
    this.findBtn.onclick = () => this.findFree();
    this.cityBtn = el('button', { class: 'btn hidden', id: 'cityBtn', title: 'Fly to your city (G)' }, 'Go to my city');
    this.cityBtn.onclick = () => this.actions.goToMyCity();
    this.worldBtn = el('button', { class: 'btn', id: 'worldBtn', title: 'World: stats, top cities and monuments' }, '🌍 World');
    this.worldBtn.onclick = () => this.toggleWorld();
    this.msBtn = el('button', { class: 'btn', id: 'msBtn', title: 'Milestones: special buildings your city unlocks as it grows' }, '🏛 Milestones');
    this.msBtn.onclick = () => this.toggleMilestones();
    this.budgetBtn = el('button', { class: 'btn hidden', id: 'budgetBtn', title: 'Budget: what your city earns and pays' }, '💰 Budget');
    this.budgetBtn.onclick = () => this.toggleBudget();
    this.lifelineBtn = el(
      'button',
      { class: 'btn lifeline hidden', id: 'lifelineBtn', title: 'Your city is nearly broke: an emergency loan is available' },
      '🛟 Lifeline',
    );
    this.lifelineBtn.onclick = () => this.toggleLifeline();
    this.monumentBtn = el(
      'button',
      {
        class: 'btn hidden',
        id: 'monumentBtn',
        title: `Your city has over ${MONUMENT_MIN_POP.toLocaleString('en-US')} people: you can retire it as a monument and start over`,
      },
      '🏛 Monument',
    );
    this.monumentBtn.onclick = () => this.toggleMonument();
    this.abandonBtn = el(
      'button',
      { class: 'btn hidden', id: 'abandonBtn', title: 'Your city is broke and already used its lifeline: you can abandon it and start over' },
      '🏳 Abandon city',
    );
    this.abandonBtn.onclick = () => this.toggleMayor('abandon');
    this.fireBtn = el('button', { class: 'btn fire hidden', id: 'fireBtn', title: 'Your city is burning! Click to jump to the next fire.' }, '🔥 0 fires');
    this.fireBtn.onclick = () => this.nextFire();
    const discordBtn = discordLink('', 'btn ghost discord-btn');
    discordBtn.append(discordIcon(), el('span', { class: 'discord-label' }, 'Discord'));
    discordBtn.setAttribute('aria-label', 'GlobalCity Discord');
    discordBtn.title = 'Join the GlobalCity Discord: chat with other mayors, report bugs, suggest features';
    const aboutBtn = el('button', { class: 'btn ghost round', id: 'aboutBtn', title: 'About & attribution' }, 'ⓘ');
    aboutBtn.onclick = () => this.toggle(this.about);
    const fundsStat = el(
      'div',
      { class: 'stat clickable', id: 'fundsStat', title: 'Funds — click for the budget' },
      el('span', { class: 'ico' }, '💵'),
      this.funds,
    );
    fundsStat.onclick = () => this.toggleBudget();
    const bar = el(
      'div',
      { id: 'topbar' },
      el('div', { class: 'brand' }, 'GlobalCity'),
      fundsStat,
      el('div', { class: 'stat', title: 'Population' }, el('span', { class: 'ico' }, '👥'), this.pop),
      el('div', { class: 'stat', title: 'Date' }, el('span', { class: 'ico' }, '📅'), this.date),
      el('div', { class: 'stat', title: 'Players online' }, el('span', { class: 'ico online-dot' }, '●'), this.online),
      (this.worldPopStat = el(
        'div',
        {
          class: 'stat world-pop clickable',
          title: 'World population: every city on the planet combined. Click for the world stats',
          role: 'button',
          tabindex: '0',
        },
        el('span', { class: 'ico' }, '🌍'),
        this.worldPop,
      )),
      this.plotsStat,
      this.claimBtn,
      this.findBtn,
      this.cityBtn,
      this.worldBtn,
      this.msBtn,
      this.budgetBtn,
      this.lifelineBtn,
      this.abandonBtn,
      this.monumentBtn,
      this.fireBtn,
      el('div', { class: 'spacer' }),
      this.status,
      this.cityNameBtn,
      this.nameBtn,
      discordBtn,
      aboutBtn,
    );
    this.offline = el('div', { id: 'offline', class: 'hidden' }, 'Connecting to server…');
    this.root.append(bar, this.offline);
  }

  /** Tell the renderer how much of the left / top edge the fixed UI covers, so chunk labels stay readable. */
  measureOverlay(): void {
    const toolbar = this.root.querySelector<HTMLElement>('#toolbar'),
      topbar = this.root.querySelector<HTMLElement>('#topbar');
    const tb = toolbar?.getBoundingClientRect(),
      hb = topbar?.getBoundingClientRect();
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
      const icon = el('canvas', { class: 'icon' });
      this.icons.paint(icon, id, TOOL_ICON_PX, TOOL_ICON_OPTS);
      const cost = t.cost ? priceLabel(id) : 'free';
      const btn = el(
        'button',
        {
          class: 'tool',
          'data-tool': id,
          title: `${t.name} — ${cost} (${t.hotkey.toUpperCase()})${t.tradeoff ? `. ${t.tradeoff}` : ''}`,
          'aria-label': t.name,
        },
        icon,
        el('span', { class: 'key', text: t.hotkey.toUpperCase() }),
        el('span', { class: 'label', text: t.name }),
        el('span', { class: 'cost', text: t.cost ? priceLabel(id) : '' }),
      );
      btn.onclick = () => {
        this.state.setTool(id);
        this.closeToolGroup();
      };
      this.toolButtons.set(id, btn);
      const def = TOOL_GROUPS.find((g) => g.members.includes(id));
      if (!def) {
        bar.append(btn);
        continue;
      }
      const grp = this.toolGroups.find((x) => x.def === def) ?? this.buildToolGroup(def, bar);
      grp.flyout.append(btn); // layoutToolGroups() moves it into the bar while the group is not needed
    }
    bar.addEventListener('scroll', () => this.closeToolGroup(), { passive: true });
    document.addEventListener('pointerdown', (e) => {
      const g = this.openGroup;
      if (g && !g.flyout.contains(e.target as Node) && !g.head.contains(e.target as Node)) this.closeToolGroup();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeToolGroup();
    });
    window.addEventListener('resize', () => this.closeToolGroup());
    this.root.append(bar);
    this.layoutToolGroups();
    this.watchIconDpr();
  }

  /** Redraw the toolbar icons when the pixel density changes (browser zoom, another monitor). */
  private watchIconDpr(): void {
    matchMedia(`(resolution: ${iconDpr()}dppx)`).addEventListener(
      'change',
      () => {
        for (const [id, btn] of this.toolButtons) this.icons.paint(btn.querySelector('canvas')!, id, TOOL_ICON_PX, TOOL_ICON_OPTS);
        for (const g of this.toolGroups) g.shown = null;
        this.layoutToolGroups();
        this.watchIconDpr();
      },
      { once: true },
    );
  }

  private buildToolGroup(def: (typeof TOOL_GROUPS)[number], bar: HTMLElement): ToolGroupUi {
    const icon = el('canvas', { class: 'icon' });
    const label = el('span', { class: 'label', text: def.name });
    const cost = el('span', { class: 'cost' });
    const head = el(
      'button',
      { class: 'tool group-head', 'data-group': def.id, 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-label': def.name },
      icon,
      label,
      cost,
      el('span', { class: 'caret', text: '▸' }),
    );
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
    const r = g.head.getBoundingClientRect(),
      f = g.flyout.getBoundingClientRect();
    const vw = window.innerWidth,
      vh = window.innerHeight;
    if (r.right < vw / 2 && r.top < vh - 120) {
      // toolbar down the left edge: open to the right
      g.flyout.style.left = `${Math.round(r.right + 6)}px`;
      g.flyout.style.top = `${Math.round(Math.max(8, Math.min(r.top, vh - f.height - 8)))}px`;
    } else {
      // toolbar along the bottom (phones): open upwards
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
          if (grouped) g.flyout.append(btn);
          else g.wrap.before(btn);
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
        this.icons.paint(g.icon, cur, TOOL_ICON_PX, TOOL_ICON_OPTS);
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
    const r = mk('r', 'R'),
      c = mk('c', 'C'),
      i = mk('i', 'I');
    this.rciBars = { r: r.fill, c: c.fill, i: i.fill };
    this.rciBoost = { r: r.boost, c: c.boost, i: i.boost };
    this.powerText = el('span', { class: 'power', text: '⚡ 0 / 0 MW' });
    this.crimeText = el('span', { class: 'crime bad hidden', id: 'crime', title: `Crime is high and no police station is powered. ${POLICE_HELP}` }, '⚠ crime');
    this.trafficWord = el('span', { class: 'word' });
    this.trafficFill = el('span', { class: 'fill' });
    this.trafficText = el(
      'div',
      { class: 'traffic hidden', id: 'traffic', title: TRAFFIC_HELP },
      el('span', { text: '🚗 ' }),
      this.trafficWord,
      el('span', { class: 'meter' }, this.trafficFill),
    );
    this.tradeText = el('div', { class: 'trade hidden', id: 'powerTrade', title: POWER_TRADE_HELP });
    this.neighbourText = el('div', { class: 'neighbours hidden', id: 'neighbours', title: NEIGHBOUR_HELP });
    this.budgetText = el('div', {
      class: 'budget',
      id: 'budget',
      title:
        'Net budget over the last game year: taxes on your population minus upkeep for roads, rail, stations and power plants. Click for the budget screen.',
    });
    this.budgetText.onclick = () => this.toggleBudget();
    const box = el(
      'div',
      { id: 'rci', class: 'panel', title: 'Residential / Commercial / Industrial demand' },
      el('div', { class: 'rci-bars' }, r.wrap, c.wrap, i.wrap),
      el('div', { class: 'power-line' }, this.powerText),
      el('div', { class: 'power-line', id: 'safety' }, this.crimeText),
      this.trafficText,
      this.tradeText,
      this.neighbourText,
      this.budgetText,
    );
    // phones show only the bars, power and budget; a tap on the panel opens or closes the rest
    box.addEventListener('click', (e) => {
      if (this.budgetText.contains(e.target as Node) || !window.matchMedia('(max-width: 760px)').matches) return;
      box.classList.toggle('expanded');
    });
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
    close.onclick = () => {
      this.welcomeDismissed = true;
      this.hide(this.welcome);
    };
    this.welcome = el(
      'div',
      { id: 'welcome', class: 'panel card hidden' },
      close,
      el('h2', { text: 'Welcome to GlobalCity' }),
      el('p', {
        text: 'The whole Earth is one giant SimCity map shared by everyone online. Claim a 64×64 plot (your first one is free), then zone, wire and pave it to grow a city — neighbours can build right next to you. Zoom in to build, zoom out to see every city on the planet.',
      }),
      el('div', { class: 'row' }, locBtn, pickBtn, freeBtn),
      this.welcomeStatus,
      el('p', { class: 'muted community' }, 'Meet your neighbours, find trading partners and suggest features on ', discordLink('our Discord'), '.'),
    );
    this.root.append(this.welcome);
  }

  private buildAbout(): void {
    const close = el('button', { class: 'btn ghost round close', title: 'Close' }, '×');
    close.onclick = () => this.hide(this.about);
    const link = (href: string, text: string) => {
      const a = el('a', { href, target: '_blank', rel: 'noopener' }, text);
      return a;
    };
    this.about = el(
      'div',
      { id: 'about', class: 'panel card hidden' },
      close,
      el('h2', { text: 'About GlobalCity' }),
      el('p', {}, 'A massively multiplayer SimCity-classic style game on a tile map of the whole Earth.'),
      el(
        'p',
        {},
        'Tile artwork is the original SimCity Classic art by Will Wright and Maxis (1989), used via ',
        link('https://github.com/SimHacker/micropolis', 'Micropolis'),
        ', the GPLv3 release of SimCity that Electronic Arts open-sourced in 2008 through the work of Don Hopkins.',
      ),
      el('p', {}, 'Map data is derived from ', link('https://www.naturalearthdata.com/', 'Natural Earth'), ' (public domain).'),
      el('p', {}, 'SimCity is a trademark of Electronic Arts. This project is not affiliated with or endorsed by EA or Maxis.'),
      el('p', {}, 'Community, bug reports and feature ideas: ', discordLink('join the GlobalCity Discord'), '.'),
      el('p', {}, 'GlobalCity is free software, licensed GPL-3.0-or-later. See ', el('a', { href: '/ATTRIBUTION.md' }, 'ATTRIBUTION.md'), ' for details.'),
      el(
        'p',
        { class: 'muted' },
        'Controls: drag to pan (query tool, middle/right button or hold Space) or use WASD / the arrow keys, wheel or +/- to zoom, H shows the whole world, G goes to your city, double-click a plot in the world view to zoom in, hotkeys select tools, drag roads, rail, power lines, parks and zones to lay several at once (Shift for a freeform line), Esc returns to query.',
      ),
    );
    this.root.append(this.about);
  }

  private buildLeaderboard(): void {
    const close = el('button', { class: 'btn ghost round close', title: 'Close' }, '×');
    close.onclick = () => this.closeWorld();
    this.lbRows = el('div', { class: 'lb-rows' });
    this.lbMe = el('div', { class: 'lb-me muted' });
    this.lbWorld = el('div', { class: 'lb-world muted' });
    this.lbTitle = el('h2', { text: '🌍 World' });
    const tabs = el('div', { class: 'world-tabs', role: 'tablist' });
    for (const [tab, label] of [
      ['stats', '📊 Stats'],
      ['top', '🏆 Top cities'],
      ['monuments', '🏛 Monuments'],
    ] as const) {
      const b = el('button', { class: 'btn world-tab', type: 'button', role: 'tab', 'data-tab': tab }, label);
      b.onclick = () => this.setWorldTab(tab);
      this.worldTabBtns.set(tab, b);
      tabs.append(b);
    }
    this.wsBody = el('div', { class: 'ws-body' }, el('p', { class: 'muted', text: 'Counting…' }));
    this.wsView = el('div', { class: 'ws-view' }, this.wsBody);
    this.lbView = el(
      'div',
      { class: 'lb-view hidden' },
      el(
        'div',
        { class: 'lb-head' },
        el('span', { class: 'rank', text: '#' }),
        el('span', { class: 'sw' }),
        el('span', { class: 'name', text: 'City' }),
        el('span', { class: 'pop', text: 'Population' }),
        el('span', { class: 'ms', text: 'Milestones', title: 'Share of milestone buildings unlocked (see 🏛 Milestones)' }),
        el('span', { class: 'chunks', text: 'Plots' }),
        el('span', { class: 'fires' }),
        el('span', { class: 'visit' }),
      ),
      this.lbRows,
      this.lbMe,
      this.lbWorld,
    );
    this.monRows = el('div', { class: 'lb-rows' });
    this.monView = el(
      'div',
      { class: 'lb-view mon-view hidden' },
      el('p', {
        class: 'muted mon-intro',
        text: `Cities whose mayors retired them as monuments after passing ${MONUMENT_MIN_POP.toLocaleString('en-US')} people. They stand forever, frozen as they were left.`,
      }),
      el(
        'div',
        { class: 'lb-head' },
        el('span', { class: 'rank', text: '#' }),
        el('span', { class: 'sw' }),
        el('span', { class: 'name', text: 'City' }),
        el('span', { class: 'pop', text: 'Population' }),
        el('span', { class: 'chunks', text: 'Plots' }),
        el('span', { class: 'date', text: 'Retired' }),
        el('span', { class: 'visit' }),
      ),
      this.monRows,
    );
    this.leaderboard = el(
      'div',
      { id: 'world', class: 'panel card hidden' },
      close,
      el('div', { class: 'lb-title' }, this.lbTitle),
      tabs,
      this.wsView,
      this.lbView,
      this.monView,
    );
    this.root.append(this.leaderboard);
    const open = () => this.openWorld('stats');
    this.worldPopStat.onclick = open;
    this.worldPopStat.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    };
  }

  // ---------- the World panel: stats, top cities, monuments ----------
  private worldPopStat!: HTMLElement;
  private wsBody!: HTMLElement;
  private wsTimer: ReturnType<typeof setInterval> | null = null;

  isWorldOpen(): boolean {
    return !this.leaderboard.classList.contains('hidden');
  }

  /** Open the World panel on a tab (default: the one used last). */
  openWorld(tab: WorldTab = this.worldTab): void {
    this.closePanels();
    this.show(this.leaderboard);
    this.setWorldTab(tab);
  }

  toggleWorld(): void {
    if (this.isWorldOpen()) this.closeWorld();
    else this.openWorld();
  }

  private closeWorld(): void {
    this.hide(this.leaderboard);
    if (this.wsTimer) {
      clearInterval(this.wsTimer);
      this.wsTimer = null;
    }
  }

  private setWorldTab(tab: WorldTab): void {
    this.worldTab = tab;
    for (const [t, b] of this.worldTabBtns) {
      b.classList.toggle('selected', t === tab);
      b.setAttribute('aria-selected', String(t === tab));
    }
    this.wsView.classList.toggle('hidden', tab !== 'stats');
    this.lbView.classList.toggle('hidden', tab !== 'top');
    this.monView.classList.toggle('hidden', tab !== 'monuments');
    this.refreshWorldTitle();
    if (tab === 'stats') {
      this.net.send({ t: 'worldStats' });
      // fresh numbers while it's open (the server counts them at most every 30 s)
      if (!this.wsTimer)
        this.wsTimer = setInterval(() => {
          if (!this.isWorldOpen()) {
            this.closeWorld();
            return;
          }
          if (this.worldTab === 'stats') this.net.send({ t: 'worldStats' });
        }, 30_000);
    } else {
      this.refreshLeaderboard();
      if (tab === 'top') this.net.send({ t: 'leaderboard' }); // the server also pushes it periodically; this just freshens it
    }
  }

  private refreshWorldTitle(): void {
    this.lbTitle.textContent =
      this.worldTab === 'stats' ? `🌍 The world${this.wsYear ? ` in ${this.wsYear}` : ''}` : this.worldTab === 'top' ? '🏆 Top cities' : '🏛 Monuments';
  }

  /** Fill the world stats dialog (a 'worldStats' message). */
  showWorldStats(s: WorldStats): void {
    const n = (v: number) => v.toLocaleString('en-US');
    this.wsYear = s.year;
    this.refreshWorldTitle();
    const tile = (value: string, label: string, title?: string) =>
      el('div', { class: 'ws-tile', title: title ?? '' }, el('div', { class: 'ws-val', text: value }), el('div', { class: 'ws-label', text: label }));
    const share = s.landPlots ? Math.round((s.plots / s.landPlots) * 1000) / 10 : 0;
    const top = el(
      'div',
      { class: 'ws-grid' },
      tile(fmtCompact(s.population), 'people', `${n(s.population)} people in every city combined`),
      tile(n(s.cities), s.cities === 1 ? 'city' : 'cities'),
      tile(n(s.online), 'mayors online'),
      tile(`${share}%`, 'of the land claimed', `${n(s.plots)} of ${n(s.landPlots)} plots with land`),
    );
    const present = (...xs: (HTMLElement | null)[]): HTMLElement[] => xs.filter((x): x is HTMLElement => x !== null);
    const built = el(
      'div',
      { class: 'ws-grid small' },
      tile(n(s.zones.res), 'Residential', 'residential zones'),
      tile(n(s.zones.com), 'Commercial', 'commercial zones'),
      tile(n(s.zones.ind), 'Industrial', 'industrial zones'),
      tile(n(s.roads), 'road tiles'),
      tile(n(s.rail), 'rail tiles'),
      tile(n(s.powerLines), 'power line tiles'),
      tile(n(s.plants), 'power plants'),
      tile(fmtPower(s.powerSupply), 'power supplied', "what the world's power plants can produce"),
      tile(n(s.airports), 'airports'),
      tile(n(s.seaports), 'seaports'),
      tile(n(s.seaRoutes), 'sea routes'),
    );
    const quakes = s.disasters
      .map((c: number, k: number) =>
        c ? `${DISASTERS[k as Disaster].emoji} ${n(c)} ${DISASTERS[k as Disaster].name.toLowerCase()}${c === 1 ? '' : 's'}` : null,
      )
      .filter(Boolean) as string[];
    const disasters = el(
      'div',
      { class: 'ws-section' },
      ...present(
        el(
          'div',
          { class: 'ws-row' },
          el('span', { class: 'ws-k', text: 'Last 24 hours' }),
          el('span', { class: 'ws-v', text: quakes.length ? quakes.join(' · ') : 'No disasters: a quiet day on Earth' }),
        ),
        s.activeDisasters
          ? el(
              'div',
              { class: 'ws-row' },
              el('span', { class: 'ws-k', text: 'Right now' }),
              el('span', { class: 'ws-v', text: `${n(s.activeDisasters)} on the go` }),
            )
          : null,
      ),
    );
    const totalBiome = s.biomes.reduce((a: number, b: number) => a + b, 0) || 1;
    const biomeLabels = ['Temperate', 'Desert', 'Steppe', 'Tundra', 'Boreal', 'Ice sheet'];
    const biomeColours = ['#cc7f66', '#e6c68a', '#b8b47c', '#a8a48c', '#dde4ec', '#f6f9fc'];
    const biomes = el(
      'div',
      { class: 'ws-bars' },
      ...s.biomes.map((c: number, b: number) => {
        const bar = el('div', { class: 'ws-bar-fill' });
        bar.style.width = `${(c / totalBiome) * 100}%`;
        bar.style.background = biomeColours[b] ?? '#888';
        return el(
          'div',
          { class: 'ws-bar', title: `${n(c)} plots` },
          el('span', { class: 'ws-k', text: biomeLabels[b] ?? `Biome ${b}` }),
          el('div', { class: 'ws-bar-track' }, bar),
          el('span', { class: 'ws-pct', text: `${Math.round((c / totalBiome) * 100)}%` }),
        );
      }),
    );
    this.wsBody.replaceChildren(
      top,
      el('h3', { text: 'Population' }),
      populationChart(s.history ?? [], fmtCompact),
      ...(s.climate ? [el('h3', { text: 'Climate' }), this.climateSection(s.climate)] : []),
      el('h3', { text: 'Built' }),
      built,
      el('h3', { text: 'Where cities are' }),
      biomes,
      el('h3', { text: 'Disasters' }),
      disasters,
    );
  }

  /** The world stats' climate: clean power, CO2 and warming (the model is shared/src/climate.ts). */
  private climateSection(c: NonNullable<WorldStats['climate']>): HTMLElement {
    const tile = (value: string, label: string, title: string) =>
      el('div', { class: 'ws-tile', title }, el('div', { class: 'ws-val', text: value }), el('div', { class: 'ws-label', text: label }));
    const sign = c.warming >= 0 ? '+' : '';
    return el(
      'div',
      { class: 'ws-section' },
      el(
        'div',
        { class: 'ws-grid' },
        tile(`${Math.round(c.cleanShare * 100)}%`, 'clean power', "Share of the world's power from wind, offshore wind and nuclear: no CO2"),
        tile(
          mtLabel(c.emissions),
          'CO₂ a year',
          c.sources
            ? `CO₂ the world emits a year: coal power ${mtLabel(c.sources.power)}, industry ${mtLabel(c.sources.industry)}, cars ${mtLabel(c.sources.traffic)}, forests ${mtLabel(c.sources.land)}`
            : 'CO₂ the world emits a year',
        ),
        tile(`${c.co2.toFixed(0)} ppm`, 'CO₂ in the air', 'CO2 in the atmosphere, parts per million (296 in 1900)'),
        tile(`${sign}${c.warming.toFixed(2)} °C`, 'warming since 1900', 'Global temperature compared with 1900'),
      ),
      warmingChart(c.history),
    );
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
    this.state.on('stats', () => {
      this.refreshStats();
      this.refreshTools();
      this.refreshClaimButtons();
      this.refreshWelcome();
      this.refreshMilestones();
    });
    this.state.on('me', () => {
      this.refreshName();
      this.refreshClaimButtons();
      this.refreshLeaderboard();
      this.miniDirty = true;
      this.scheduleMini();
    });
    this.state.on('city', () => {
      this.refreshName();
      this.refreshWelcome();
    });
    this.state.on('leaderboard', () => this.refreshLeaderboard());
    setInterval(() => {
      this.miniDirty = true;
      this.scheduleMini();
    }, NIGHT_REFRESH_MS); // the corner map's night shade moves with the sun
    this.state.on('time', () => this.refreshTime());
    this.state.on('tool', () => this.refreshTools());
    this.state.on('claims', () => {
      this.refreshClaimButtons();
      this.refreshWelcome();
      this.miniDirty = true;
      this.scheduleMini();
      this.refreshWorldPop();
      this.refreshLeaderboard();
    });
    // The status label only shows while not connected ("Connecting…", "Reconnecting…"): online is the normal state.
    this.state.on('connection', (v) => {
      this.offline.classList.toggle('hidden', v);
      this.status.classList.toggle('hidden', v);
      this.status.classList.toggle('bad', !v);
    });
    this.net.on('status', (s) => {
      this.status.textContent = s;
      this.offline.textContent = s;
    });
    this.renderer.on('camera', () => {
      this.hideQuery();
      this.miniDirty = true;
      this.scheduleMini();
    });
    this.renderer.on('settle', () => this.refreshClaimButtons());
    // the land check needs the centre chunk's tiles, which may arrive after the camera settled
    this.renderer.map.on('chunk', ({ cx, cy }) => {
      if (!this.renderer.isTileMode()) return;
      const c = this.renderer.centerChunk();
      if (c.cx === cx && c.cy === cy) this.refreshClaimButtons();
    });
  }

  private refreshAll(): void {
    this.refreshStats();
    this.refreshTime();
    this.refreshName();
    this.refreshTools();
    this.refreshClaimButtons();
    this.refreshWelcome();
    this.drawMini();
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
    this.budgetText.textContent = `💰 ${net >= 0 ? '+' : '−'}${fmtMoney(Math.abs(net))} last month${debt > 0 ? ` · 🛟 owes ${fmtMoney(debt)}` : ''}`;
    this.lifelineBtn.classList.toggle('hidden', !s?.lifelineAvailable);
    const canRetire = (s?.population ?? 0) >= MONUMENT_MIN_POP && this.state.ownedChunkCount() > 0;
    this.monumentBtn.classList.toggle('hidden', !canRetire);
    if (!canRetire) this.monumentPanel?.classList.add('hidden');
    const canAbandon = this.state.ownedChunkCount() > 0 && (s?.funds ?? Infinity) < ABANDON_MAX_FUNDS && (s?.debt ?? 0) > 0;
    this.abandonBtn.classList.toggle('hidden', !canAbandon);
    if (this.mayorPanel && !this.mayorPanel.classList.contains('hidden')) this.refreshMayorStart();
    if (!s?.lifelineAvailable) this.lifelinePanel?.classList.add('hidden');
    this.budgetText.classList.toggle('bad', net < 0);
    this.budgetText.classList.toggle('hidden', !s);
    this.budgetBtn.classList.toggle('hidden', this.state.ownedChunkCount() === 0);
    if (this.state.ownedChunkCount() === 0) this.budgetPanel?.classList.add('hidden');
    this.refreshBudget();
    const neighbours = s?.neighbours ?? 0,
      railLinks = s?.railLinks ?? 0;
    this.neighbourText.textContent = `🤝 ${neighbours} ${neighbours === 1 ? 'neighbour' : 'neighbours'} · 🚆 ${railLinks} ${railLinks === 1 ? 'rail link' : 'rail links'}`;
    this.neighbourText.classList.toggle('hidden', neighbours <= 0 && railLinks <= 0);
    const sup = s?.powerSupply ?? 0,
      dem = s?.powerDemand ?? 0;
    this.powerText.textContent = `⚡ ${fmtPowerPair(dem, sup)}`;
    this.powerText.title = `Power: ${fmtPower(dem)} in use of ${fmtPower(sup)} capacity. ${POWER_TRADE_HELP}`;
    this.powerText.classList.toggle('bad', dem > sup);
    this.refreshPowerTrade(s?.powerImported ?? 0, s?.powerExported ?? 0, s?.powerTradeNet ?? 0);
    const fires = s?.fires ?? 0;
    this.fireBtn.textContent = `🔥 ${fires} ${fires === 1 ? 'fire' : 'fires'}`;
    this.fireBtn.classList.toggle('hidden', fires <= 0);
    // crime warning (old servers omit these: treat as no police, no crime)
    const police = s?.policeStations ?? 0,
      crime = s?.crime ?? 0;
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
      t.append(el('div', { class: 'paying', text: `⬇ buying ${fmtPower(imported)} (${money(cost)})` }));
    }
    if (exported > 0) {
      const income = imported > 0 ? exported * POWER_PRICE_PER_UNIT : Math.max(net, 0);
      t.append(el('div', { class: 'income', text: `⬆ selling ${fmtPower(exported)} (${money(income)})` }));
    }
    t.classList.toggle('hidden', imported <= 0 && exported <= 0);
  }

  private refreshTime(): void {
    this.date.textContent = fmtDate(this.state.time.year, this.state.time.month);
    this.online.textContent = String(this.state.online);
  }

  private refreshName(): void {
    this.nameBtn.textContent = this.state.me?.name ?? this.net.identity.name ?? '…';
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
        const unlocked = st?.unlocked?.includes(id) ?? false,
          built = (st?.built?.grandcentral ?? 0) >= 1;
        btn.classList.toggle('hidden', !unlocked);
        btn.classList.toggle('built', built);
        const cost = btn.querySelector('.cost');
        if (cost) cost.textContent = built ? 'Built' : priceLabel(id);
        btn.title = built
          ? 'Grand Central: your city already has one (one per city). It can be rebuilt if it is destroyed.'
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
      // seasonal (the Christmas tree): unlocked for good, but it can only be built in its months
      const offSeason = unlocked && m.months !== undefined && !(st?.inSeason?.includes(id) ?? false);
      btn.classList.toggle('hidden', !unlocked && !isNext);
      btn.classList.toggle('locked', !unlocked || offSeason);
      btn.classList.toggle('built', atMax);
      const cost = btn.querySelector('.cost');
      if (cost) cost.textContent = !unlocked ? `🔒 ${fmtCompact(m.pop)} pop` : offSeason ? `🔒 ${m.seasonName}` : atMax ? 'Built' : priceLabel(id);
      btn.title = !unlocked
        ? `${m.name}: unlocks at ${m.pop.toLocaleString('en-US')} people. ${m.benefits.join('. ')}.`
        : offSeason
          ? `${m.name}: can only be built in ${m.seasonName}. ${m.benefits.join('. ')}.`
          : atMax
            ? `${m.name}: your city already has one (one per city). It can be rebuilt if it is destroyed.`
            : `${m.name} — ${priceLabel(id)} (${TOOLS[id].hotkey.toUpperCase()}). ${TOOLS[id].tradeoff ?? `${m.benefits.join('. ')}.`}`;
    }
    this.layoutToolGroups();
  }

  // ---------- lifeline ----------
  /** Asks returning players (from their second visit, once) to join the Discord for news of world resets and updates. */
  private buildDiscordInvite(): void {
    const close = el('button', { class: 'btn ghost round close', title: 'Close' }, '×');
    close.onclick = () => this.hide(this.discordInvite);
    const join = el(
      'a',
      { class: 'btn primary', href: DISCORD_URL, target: '_blank', rel: 'noopener noreferrer' },
      discordIcon(),
      el('span', {}, 'Join the Discord'),
    );
    join.addEventListener('click', () => this.hide(this.discordInvite));
    const later = el('button', { class: 'btn', type: 'button' }, 'Maybe later');
    later.onclick = () => this.hide(this.discordInvite);
    this.discordInvite = el(
      'div',
      { id: 'discordInvite', class: 'panel card hidden' },
      close,
      el('h2', { text: 'Welcome back, mayor!' }),
      el('p', {
        text: 'Join the GlobalCity Discord to get notified of game updates and to hear when the next world reset is coming, so you can plan your next city.',
      }),
      el('p', { text: "It's also where neighbours meet, find trading partners, and suggest what to build next." }),
      el('div', { class: 'row' }, join, later),
    );
    this.root.append(this.discordInvite);
    let visits = 0,
      asked = false;
    try {
      visits = (Number(localStorage.getItem(VISITS_KEY)) || 0) + 1;
      localStorage.setItem(VISITS_KEY, String(visits));
      asked = localStorage.getItem(DISCORD_ASKED_KEY) === '1';
    } catch {
      return;
    } // no storage: we can't tell a second visit from the first
    if (!DISCORD_INVITE_ENABLED || visits < 2 || asked) return;
    // a few seconds in, once nothing else (the welcome, a budget screen, ...) is open; give up after a minute
    let tries = 0;
    const attempt = (): void => {
      const busy = !this.state.me || [...this.root.querySelectorAll('.card')].some((c) => c !== this.discordInvite && !c.classList.contains('hidden'));
      if (busy) {
        if (++tries < 12) setTimeout(attempt, 5000);
        return;
      }
      try {
        localStorage.setItem(DISCORD_ASKED_KEY, '1');
      } catch {
        /* ignore */
      }
      this.show(this.discordInvite);
    };
    setTimeout(attempt, 4000);
  }

  // ---------- test servers: start a disaster ----------
  private testDisasters: HTMLElement | null = null;
  /** The server lets players start disasters (DISASTER_TRIGGER=1): a 🧪 button in the top bar opens a dialog. */
  enableTestDisasters(): void {
    if (this.testDisasters) return;
    const close = el('button', { class: 'btn ghost round close', title: 'Close', type: 'button' }, '×');
    const where = el(
      'select',
      { class: 'td-where' },
      el('option', { value: 'here' }, 'The city in the middle of the screen'),
      el('option', { value: 'random' }, 'A random city'),
    );
    const kinds = Array.from({ length: DISASTER_COUNT }, (_, kind) => {
      const d = DISASTERS[kind as Disaster];
      const b = el('button', { class: 'btn td-kind', type: 'button' }, el('span', { class: 'td-emoji', text: d.emoji }), el('span', { text: d.name }));
      b.onclick = () => {
        const msg = where.value === 'here' ? { t: 'testDisaster' as const, kind, ...this.renderer.centerChunk() } : { t: 'testDisaster' as const, kind };
        if (!this.net.send(msg)) this.toast('Not connected — try again in a moment.', 'error');
      };
      return b;
    });
    const panel = el(
      'div',
      { id: 'testDisasters', class: 'panel card hidden', role: 'dialog', 'aria-label': 'Start a disaster' },
      close,
      el('h2', { text: '🧪 Start a disaster' }),
      el('p', {
        class: 'muted',
        text: 'Test server only. It strikes right away, wherever you send it: the usual rules about where each disaster can happen and how often are skipped.',
      }),
      el('label', { class: 'mp-field' }, el('span', { text: 'Where' }), where),
      el('div', { class: 'td-kinds' }, ...kinds),
    );
    close.onclick = () => this.hide(panel);
    this.testDisasters = panel;
    this.root.append(panel);
    const btn = el('button', { class: 'btn', id: 'testDisastersBtn', title: 'Test server: start a disaster' }, '🧪 Disasters');
    btn.onclick = () => this.toggle(panel);
    const spacer = this.root.querySelector('#topbar .spacer');
    spacer?.parentElement?.insertBefore(btn, spacer);
  }

  private buildLifeline(): void {
    const close = el('button', { class: 'btn ghost round close', title: 'Close' }, '×');
    close.onclick = () => this.hide(this.lifelinePanel);
    const take = el('button', { class: 'btn primary', type: 'button' }, `Take the ${fmtMoney(LIFELINE_AMOUNT)} lifeline`);
    take.onclick = () => {
      this.actions.lifeline();
      this.hide(this.lifelinePanel);
    };
    const later = el('button', { class: 'btn', type: 'button' }, 'Not now');
    later.onclick = () => this.hide(this.lifelinePanel);
    this.lifelinePanel = el(
      'div',
      { id: 'lifeline', class: 'panel card hidden' },
      close,
      el('h2', { text: '🛟 Lifeline' }),
      el('p', {
        text: `Your city has less than ${fmtMoney(LIFELINE_MAX_FUNDS)}. Take an emergency loan of ${fmtMoney(LIFELINE_AMOUNT)} to get it running again: enough for a power plant and repairs.`,
      }),
      el(
        'ul',
        { class: 'ms-benefits' },
        el('li', { text: 'No interest' }),
        el('li', { text: `Repaid automatically from ${Math.round(LIFELINE_REPAY_SHARE * 100)}% of each month's surplus` }),
        el('li', { text: 'Nothing is taken in months that run at a loss' }),
        el('li', {
          text: `New cities (under ${LIFELINE_EARLY_PEAK_POP.toLocaleString('en-US')} people) may take another while still repaying, up to ${fmtMoney(LIFELINE_MAX_DEBT)} owed`,
        }),
        el('li', { text: 'Bigger cities: one lifeline at a time' }),
      ),
      el('div', { class: 'row' }, take, later),
    );
    this.root.append(this.lifelinePanel);
  }
  private buildMonument(): void {
    const close = el('button', { class: 'btn ghost round close', title: 'Close' }, '×');
    close.onclick = () => this.hide(this.monumentPanel);
    const go = el('button', { class: 'btn primary', type: 'button' }, 'Make it a monument and start over');
    go.onclick = () => {
      this.actions.monument();
      this.hide(this.monumentPanel);
    };
    const later = el('button', { class: 'btn', type: 'button' }, 'Keep playing');
    later.onclick = () => this.hide(this.monumentPanel);
    this.monumentCity = el('p');
    this.monumentPanel = el(
      'div',
      { id: 'monument', class: 'panel card hidden' },
      close,
      el('h2', { text: '🏛 Make your city a monument' }),
      this.monumentCity,
      el(
        'ul',
        { class: 'ms-benefits' },
        el('li', { text: 'The city stays on the map forever under your name, exactly as it is now' }),
        el('li', { text: 'It is frozen: no growth, no decline, no fires, no costs, and it is never released' }),
        el('li', { text: 'It leaves the leaderboard; its airports and seaports stay on the world routes' }),
        el('li', { text: `You start over with ${fmtMoney(STARTING_FUNDS)} and claim a new first plot anywhere; milestones start again from zero` }),
        el('li', { text: 'This cannot be undone' }),
      ),
      el('div', { class: 'row' }, go, later),
    );
    this.root.append(this.monumentPanel);
  }
  private buildMayor(): void {
    const close = el('button', { class: 'btn ghost round close', title: 'Close', type: 'button' }, '×');
    close.onclick = () => this.hide(this.mayorPanel);
    this.mayorName = el('input', { type: 'text', maxlength: String(MAX_MAYOR_NAME), autocomplete: 'off', spellcheck: 'false' });
    this.mayorCity = el('input', { type: 'text', maxlength: String(MAX_CITY_NAME), autocomplete: 'off', spellcheck: 'false' });
    this.mayorCityRow = el('label', { class: 'mp-field' }, el('span', { text: 'City name' }), this.mayorCity);
    const save = el('button', { class: 'btn primary', type: 'submit' }, 'Save');
    const cancel = el('button', { class: 'btn', type: 'button' }, 'Close');
    cancel.onclick = () => this.hide(this.mayorPanel);
    const form = el(
      'form',
      { class: 'mp-form' },
      el('label', { class: 'mp-field' }, el('span', { text: 'Mayor name' }), this.mayorName),
      this.mayorCityRow,
      el('div', { class: 'row' }, save, cancel),
    );
    form.onsubmit = (e) => {
      e.preventDefault();
      this.saveMayor();
    };

    this.mayorStartText = el('p');
    this.mayorAbandonBtn = el('button', { class: 'btn danger', type: 'button' }, '🏳 Abandon my city…');
    this.mayorAbandonBtn.onclick = () => this.showAbandonConfirm(true);
    this.mayorConfirmList = el('ul', { class: 'ms-benefits' });
    this.mayorConfirmBtn = el('button', { class: 'btn danger', type: 'button' }, 'Yes, abandon it');
    this.mayorConfirmBtn.onclick = () => {
      if (!this.actions.abandon()) {
        this.toast('Not connected — try again in a moment.', 'error');
        return;
      }
      this.abandonedAt = Date.now();
      this.hide(this.mayorPanel);
    };
    const keep = el('button', { class: 'btn', type: 'button' }, 'Keep my city');
    keep.onclick = () => this.showAbandonConfirm(false);
    this.mayorMonumentBtn = el('button', { class: 'btn hidden', type: 'button' }, '🏛 Retire it as a monument instead');
    this.mayorMonumentBtn.onclick = () => {
      this.hide(this.mayorPanel);
      this.toggleMonument();
    };
    this.mayorConfirm = el(
      'div',
      { class: 'mp-confirm hidden' },
      this.mayorConfirmList,
      el('div', { class: 'row' }, this.mayorConfirmBtn, keep, this.mayorMonumentBtn),
    );
    this.mayorStart = el(
      'div',
      { class: 'mp-start' },
      el('h3', { text: 'Start over' }),
      this.mayorStartText,
      el('div', { class: 'row' }, this.mayorAbandonBtn),
      this.mayorConfirm,
    );

    this.mayorPanel = el(
      'div',
      { id: 'mayorPanel', class: 'panel card hidden', role: 'dialog', 'aria-label': 'Mayor' },
      close,
      el('h2', { text: '🎩 Mayor' }),
      form,
      this.mayorStart,
    );
    this.root.append(this.mayorPanel);
  }

  /** Open (or close) the mayor dialog, focused on the mayor name, the city name, or the abandon confirmation. */
  private toggleMayor(focus: 'mayor' | 'city' | 'abandon'): void {
    if (!this.mayorPanel.classList.contains('hidden') && focus !== 'abandon') {
      this.hide(this.mayorPanel);
      return;
    }
    this.hide(this.milestones);
    this.hide(this.leaderboard);
    this.hide(this.about);
    this.hide(this.lifelinePanel);
    this.hide(this.monumentPanel);
    this.hide(this.budgetPanel);
    this.mayorName.value = this.state.me?.name ?? this.net.identity.name ?? '';
    this.mayorCity.value = this.state.cityName;
    this.mayorCityRow.classList.toggle('hidden', !this.state.cityName);
    this.showAbandonConfirm(focus === 'abandon');
    this.show(this.mayorPanel);
    if (focus === 'abandon') this.mayorConfirmBtn.focus();
    else (focus === 'city' && this.state.cityName ? this.mayorCity : this.mayorName).select();
  }

  private saveMayor(): void {
    const name = this.mayorName.value.trim(),
      city = this.mayorCity.value.trim();
    const curName = this.state.me?.name ?? this.net.identity.name ?? '',
      curCity = this.state.cityName;
    if (!name) {
      this.toast('Your mayor needs a name', 'error');
      this.mayorName.focus();
      return;
    }
    let ok = true;
    if (name !== curName) ok = this.actions.rename(name) && ok;
    if (curCity && city && city !== curCity) ok = this.actions.renameCity(city) && ok;
    if (!ok) {
      this.toast('Not connected — try again in a moment.', 'error');
      return;
    }
    this.refreshName();
    this.hide(this.mayorPanel);
  }

  private showAbandonConfirm(on: boolean): void {
    this.mayorConfirm.classList.toggle('hidden', !on);
    this.mayorAbandonBtn.classList.toggle('hidden', on);
    this.refreshMayorStart();
  }

  /** The "Start over" part of the mayor dialog: only with a city, and worded for a broke city or a healthy one. */
  private refreshMayorStart(): void {
    const owned = this.state.ownedChunkCount(),
      s = this.state.stats,
      city = this.state.cityName || 'your city';
    this.mayorStart.classList.toggle('hidden', owned === 0);
    if (owned === 0) return;
    const funds = s?.funds ?? 0,
      debt = s?.debt ?? 0;
    this.mayorStartText.textContent =
      funds < ABANDON_MAX_FUNDS && debt > 0
        ? `${city} has run out of money and still owes ${fmtMoney(debt)} on its lifeline. If it can't recover, you can leave it behind and found a new city.`
        : `Stuck, or want to build somewhere else? You can leave ${city} behind and found a new city anywhere in the world.`;
    this.mayorConfirmBtn.textContent = `Yes, abandon ${this.state.cityName || 'my city'}`;
    const canRetire = (s?.population ?? 0) >= MONUMENT_MIN_POP;
    this.mayorMonumentBtn.classList.toggle('hidden', !canRetire);
    const plots = owned === 1 ? 'Your plot is released: anyone can claim it' : `All ${owned} of your plots are released: anyone can claim them`;
    this.mayorConfirmList.replaceChildren(
      el('li', { text: `${plots}, with everything you built still standing` }),
      el('li', {
        text: `You start over with ${fmtMoney(STARTING_FUNDS)}${funds > STARTING_FUNDS ? ` (you have ${fmtMoney(funds)} now)` : ''} and claim a new first plot for free${debt > 0 ? '; your lifeline debt is written off' : ''}`,
      }),
      el('li', { text: `You can't claim your old plots back for ${ABANDON_RECLAIM_DAYS} days` }),
      el('li', { text: 'Milestones start again from zero' }),
      el('li', { text: 'This cannot be undone' }),
    );
  }

  private toggleMonument(): void {
    if (!this.monumentPanel.classList.contains('hidden')) {
      this.hide(this.monumentPanel);
      return;
    }
    this.hide(this.milestones);
    this.hide(this.leaderboard);
    this.hide(this.about);
    this.hide(this.lifelinePanel);
    this.hide(this.budgetPanel);
    const s = this.state.stats,
      city = this.state.cityName || 'Your city';
    this.monumentCity.textContent = `${city} has ${(s?.population ?? 0).toLocaleString('en-US')} people. You can retire it as a monument: a lasting record of what you built, while you start a new city somewhere else.`;
    this.monumentPanel.classList.remove('hidden');
  }

  private toggleLifeline(): void {
    if (!this.lifelinePanel.classList.contains('hidden')) {
      this.hide(this.lifelinePanel);
      return;
    }
    this.hide(this.milestones);
    this.hide(this.leaderboard);
    this.hide(this.about);
    this.hide(this.budgetPanel);
    this.lifelinePanel.classList.remove('hidden');
  }

  // ---------- map overlays ----------
  private overlayBar!: HTMLElement;
  private overlayLegend!: HTMLElement;
  private overlayToggle!: HTMLButtonElement;
  private overlayBody!: HTMLElement;
  private weatherBtn!: HTMLButtonElement;
  private globeBtn!: HTMLButtonElement;
  /** switch between the globe and the flat map (set by main.ts); returns whether the globe is now showing */
  onGlobeToggle: (() => boolean) | null = null;
  private overlayTileMode: boolean | null = null;
  private buildOverlayBar(): void {
    const btns = OVERLAY_MODES.map((m) => {
      const info = OVERLAY_INFO[m];
      const b = el(
        'button',
        { class: 'btn ov-btn', type: 'button', 'data-mode': m, title: `Map view: ${info.name}`, 'aria-pressed': String(m === 'none') },
        `${info.icon} ${m === 'none' ? 'Normal' : info.name}`,
      );
      b.onclick = () => {
        this.autoOverlay = null;
        this.setOverlay(m);
      };
      return b;
    });
    this.overlayLegend = el('div', { class: 'ov-legend hidden' });
    this.overlayBody = el(
      'div',
      { class: 'ov-body hidden', id: 'ovBody' },
      el('div', { class: 'ov-buttons', role: 'group', 'aria-label': 'Map view' }, ...btns),
      this.overlayLegend,
    );
    // Collapsed by default to a single small button; remembers the viewer's choice.
    this.overlayToggle = el(
      'button',
      {
        class: 'btn ov-toggle',
        type: 'button',
        'aria-expanded': 'false',
        'aria-controls': 'ovBody',
        title: 'Map views: power, fire hazard, crime, traffic, pollution, land value, density (V)',
      },
      '🗺 Map view',
    );
    this.overlayToggle.onclick = () => this.setOverlayOpen(this.overlayBody.classList.contains('hidden'));
    // zoomed out the map views don't apply: the corner holds the weather switch instead
    this.weatherBtn = el(
      'button',
      {
        class: 'btn ov-toggle hidden',
        type: 'button',
        title: "Clouds on the world map: this hour's real weather (NOAA forecast). Zoomed in, rain and snow always show.",
      },
      '🌦 Weather',
    );
    this.weatherBtn.onclick = () => {
      this.renderer.weather.setEnabled(!this.renderer.weather.enabled);
      this.refreshWeatherBtn();
    };
    this.globeBtn = el('button', { class: 'btn ov-toggle hidden', type: 'button', title: 'See the world as a globe' }, '🌐 Globe');
    this.globeBtn.onclick = () => this.setGlobeShown(this.onGlobeToggle?.() ?? false);
    this.overlayBar = el(
      'div',
      { id: 'overlays', class: 'panel' },
      el('div', { class: 'ov-row' }, this.globeBtn, this.weatherBtn),
      this.overlayToggle,
      this.overlayBody,
    );
    this.root.append(this.overlayBar);
    let open = false;
    try {
      open = localStorage.getItem('globalcity.mapViewOpen') === '1';
    } catch {
      /* ignore */
    }
    this.setOverlayOpen(open);
    this.refreshWeatherBtn();
    this.refreshOverlayMode();
    this.renderer.on('camera', () => this.refreshOverlayMode());
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() !== 'v' || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      const i = OVERLAY_MODES.indexOf(this.renderer.overlay.mode);
      this.autoOverlay = null;
      this.setOverlay(OVERLAY_MODES[(i + 1) % OVERLAY_MODES.length]);
    });
  }
  /** Zoomed in: the map view menu; zoomed out: the weather switch. */
  private refreshOverlayMode(): void {
    const tile = this.renderer.isTileMode();
    if (tile === this.overlayTileMode) return;
    this.overlayTileMode = tile;
    this.weatherBtn.classList.toggle('hidden', tile);
    this.globeBtn.classList.toggle('hidden', tile || !this.onGlobeToggle);
    this.overlayToggle.classList.toggle('hidden', !tile);
    this.overlayBody.classList.toggle('hidden', !tile || this.overlayToggle.getAttribute('aria-expanded') !== 'true');
    this.overlayBar.classList.toggle('open', tile && this.overlayToggle.getAttribute('aria-expanded') === 'true');
  }
  /** The globe opened or closed (from its button, or by zooming into the flat map). */
  setGlobeShown(on: boolean): void {
    this.globeBtn.textContent = on ? '🗺 Flat map' : '🌐 Globe';
    this.globeBtn.classList.toggle('active', on);
    this.globeBtn.title = on ? 'Back to the flat map' : 'See the world as a globe';
    this.overlayTileMode = null;
    this.refreshOverlayMode();
  }
  private refreshWeatherBtn(): void {
    const on = this.renderer.weather.enabled;
    this.weatherBtn.classList.toggle('active', on);
    this.weatherBtn.setAttribute('aria-pressed', String(on));
  }
  private setOverlayOpen(open: boolean): void {
    this.overlayBody.classList.toggle('hidden', !open);
    this.overlayToggle.setAttribute('aria-expanded', String(open));
    this.overlayBar.classList.toggle('open', open);
    try {
      localStorage.setItem('globalcity.mapViewOpen', open ? '1' : '0');
    } catch {
      /* ignore */
    }
    this.refreshOverlayToggle();
  }
  private refreshOverlayToggle(): void {
    const m = this.renderer.overlay.mode,
      info = OVERLAY_INFO[m];
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
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
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
    this.budgetTable = el('table', { class: 'budget-table' });
    this.budgetPanel = el('div', { id: 'budgetPanel', class: 'panel card hidden' }, close, el('h2', { text: '💰 Budget' }), this.budgetTable);
    this.root.append(this.budgetPanel);
  }
  toggleBudget(): void {
    if (!this.budgetPanel.classList.contains('hidden')) {
      this.hide(this.budgetPanel);
      return;
    }
    this.hide(this.about);
    this.hide(this.leaderboard);
    this.hide(this.milestones);
    this.hide(this.lifelinePanel);
    this.hide(this.monumentPanel);
    this.hide(this.mayorPanel);
    this.budgetPanel.classList.remove('hidden');
    this.refreshBudget();
  }
  private refreshBudget(): void {
    if (!this.budgetPanel || this.budgetPanel.classList.contains('hidden')) return;
    const s = this.state.stats;
    const b = s?.budget;
    if (!b) {
      this.budgetTable.replaceChildren();
      return;
    }
    // columns: the last completed years, then the year so far (3 on a desktop, 2 on a phone)
    const past = window.matchMedia('(max-width: 760px)').matches ? 1 : 2;
    const cols: { y: BudgetYear; head: string }[] = [
      ...b.years.slice(-past).map((y) => ({ y, head: String(y.year) })),
      { y: b.current, head: `${this.state.time.year} so far` },
    ]; // the clock's year: a city without land never gets its book stamped
    const money = (n: number, sign: 1 | -1 = 1): HTMLElement => {
      const v = n * sign;
      return el('td', { class: `num ${v < 0 ? 'bad' : v > 0 ? 'good' : 'muted'}`, text: n === 0 ? '—' : `${v < 0 ? '−' : '+'}${fmtMoney(Math.abs(v))}` });
    };
    const row = (cls: string, label: string, get: (y: BudgetYear) => number, sign: 1 | -1 = 1): HTMLElement =>
      el('tr', { class: cls }, el('td', { text: label }), ...cols.map((c) => money(get(c.y), sign)));
    const any = (get: (y: BudgetYear) => number): boolean => cols.some((c) => get(c.y) !== 0);
    const rows = [
      el('tr', { class: 'head' }, el('th', { text: '' }), ...cols.map((c) => el('th', { text: c.head }))),
      row('income', 'Taxes', (y) => y.taxes),
      row('sub', 'Upkeep', (y) => budgetTotals(y).upkeep, -1),
      row('detail', 'Roads', (y) => y.roads, -1),
      row('detail', 'Rail', (y) => y.rail, -1),
      row('detail', 'Power plants', (y) => y.power, -1),
      row('detail', 'Services', (y) => y.services, -1),
    ];
    if (any((y) => budgetTotals(y).trade)) rows.push(row('income', 'Power trade', (y) => budgetTotals(y).trade));
    if (any((y) => y.repaid) || (s?.debt ?? 0) > 0) rows.push(row('sub', 'Lifeline repayment', (y) => y.repaid, -1));
    // below the operating result: one-off money (building, land, loans, gifts), each row only when it happened
    const extras: [string, (y: BudgetYear) => number, 1 | -1][] = [
      ['Construction', (y) => y.construction, -1],
      ['New plots', (y) => y.plots, -1],
      ['Lifeline taken', (y) => y.lifeline, 1],
      ['Gifts', (y) => y.gifts, 1],
    ];
    const shown = extras.filter(([, get]) => any(get));
    rows.push(row(shown.length ? 'subtotal' : 'total', shown.length ? 'Operating result' : 'Net', (y) => budgetTotals(y).operating));
    for (const [label, get, sign] of shown) rows.push(row(sign < 0 ? 'sub' : 'income', label, get, sign));
    if (shown.length) rows.push(row('total', 'Net', (y) => budgetTotals(y).net));
    this.budgetTable.replaceChildren(...rows);
    this.budgetTable.title =
      'Services: fire and police stations, schools, the university, city hall and Grand Central. Construction: building and bulldozing. Net: how your funds changed.';
  }

  // ---------- milestones ----------
  private buildMilestones(): void {
    const close = el('button', { class: 'btn ghost round close', title: 'Close' }, '×');
    close.onclick = () => this.hide(this.milestones);
    this.msRows = el('div', { class: 'ms-rows' });
    this.milestones = el(
      'div',
      { id: 'milestones', class: 'panel card hidden' },
      close,
      el('h2', { text: '🏛 Milestones' }),
      el('p', { class: 'muted', text: 'As your city grows it unlocks special buildings. Here is what you have unlocked, and the next one to work towards.' }),
      this.msRows,
    );
    this.root.append(this.milestones);
  }
  toggleMilestones(): void {
    if (!this.milestones.classList.contains('hidden')) {
      this.hide(this.milestones);
      return;
    }
    this.hide(this.about);
    this.hide(this.leaderboard);
    this.hide(this.budgetPanel);
    this.milestones.classList.remove('hidden');
    this.refreshMilestones();
  }
  private msIcon(b: MilestoneBuilding): HTMLCanvasElement {
    const c = el('canvas', { class: 'ms-icon' });
    this.icons.paint(c, MILESTONE_BUILDINGS[b].tool, 72);
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
      const offSeason = unlocked && m.months !== undefined && !(st?.inSeason?.includes(b) ?? false);
      const status = built
        ? { cls: 'done', text: 'Built (one per city)' }
        : offSeason
          ? { cls: 'ready', text: `Unlocked: build it in ${m.seasonName}` }
          : unlocked
            ? { cls: 'ready', text: 'Unlocked: build it from the toolbar' }
            : { cls: 'locked', text: `${(m.pop - peak).toLocaleString('en-US')} more people` };
      const pct = Math.max(0, Math.min(100, (peak / m.pop) * 100));
      const t = TOOLS[m.tool];
      return el(
        'div',
        { class: `ms-row ${status.cls}` },
        this.msIcon(b),
        el(
          'div',
          { class: 'ms-body' },
          el('div', { class: 'ms-head' }, el('strong', { text: m.name }), el('span', { class: 'chip', text: `${m.pop.toLocaleString('en-US')} people` })),
          el('ul', { class: 'ms-benefits' }, ...m.benefits.map((x) => el('li', { text: x }))),
          el('div', { class: 'ms-meta muted', text: `${fmtMoney(t.cost)} · ${t.w ?? t.size}×${t.h ?? t.size} tiles` }),
          unlocked
            ? el('div', { class: `ms-status ${status.cls}`, text: status.text })
            : el(
                'div',
                { class: 'ms-progress' },
                el('div', { class: 'ms-bar' }, el('div', { class: 'ms-fill', style: `width:${pct.toFixed(1)}%` })),
                el('span', { class: 'ms-status locked', text: status.text }),
              ),
        ),
      );
    });
    rows.unshift(this.grandCentralRow());
    this.msRows.replaceChildren(...rows);
  }

  /** Grand Central's row in the milestones panel: unlocked by a rail link, not by population. */
  private grandCentralRow(): HTMLDivElement {
    const st = this.state.stats;
    const t = TOOLS.grandcentral;
    const unlocked = st?.unlocked?.includes('grandcentral') ?? false,
      built = (st?.built?.grandcentral ?? 0) >= 1;
    const status = built
      ? { cls: 'done', text: 'Built (one per city)' }
      : unlocked
        ? { cls: 'ready', text: 'Unlocked: click your east-west rail line with it' }
        : { cls: 'locked', text: GRAND_CENTRAL.unlock };
    const c = el('canvas', { class: 'ms-icon' });
    this.icons.paint(c, 'grandcentral', 72);
    return el(
      'div',
      { class: `ms-row ${status.cls}` },
      c,
      el(
        'div',
        { class: 'ms-body' },
        el('div', { class: 'ms-head' }, el('strong', { text: 'Grand Central' }), el('span', { class: 'chip', text: '🚆 rail link' })),
        el('ul', { class: 'ms-benefits' }, ...GRAND_CENTRAL.benefits.map((x) => el('li', { text: x }))),
        el('div', { class: 'ms-meta muted', text: `${fmtMoney(t.cost)} · ${t.w}×${t.h} tiles` }),
        el('div', { class: `ms-status ${status.cls}`, text: status.text }),
      ),
    );
  }

  private refreshClaimButtons(): void {
    const owned = this.state.ownedChunkCount();
    this.cityBtn.classList.toggle('hidden', owned === 0);
    this.plots.textContent = `${owned}/${MAX_CHUNKS_PER_PLAYER}`;
    this.plots.classList.toggle('bad', owned >= MAX_CHUNKS_PER_PLAYER);
    this.plotsStat.classList.toggle('hidden', !this.state.me);
    this.plotsStat.title =
      owned >= MAX_CHUNKS_PER_PLAYER
        ? `Your city has reached the maximum of ${MAX_CHUNKS_PER_PLAYER} plots`
        : `Plots claimed (a city is at most ${MAX_CHUNKS_PER_PLAYER} plots)`;
    const tileMode = this.renderer.isTileMode();
    let showClaim = false,
      showFind = false;
    let findTitle = 'Ask the server for the nearest free plot';
    if (tileMode && this.state.me) {
      const { cx, cy } = this.renderer.centerChunk();
      // Same land rule as the server (a founding plot needs much more land than an extra one). Hint only: an
      // unloaded chunk counts as fine and the server has the final say.
      const minLand = minLandToClaim(owned);
      const tiles = this.renderer.map.getChunk(cx, cy);
      const land = tiles ? chunkLandCount(tiles) : Infinity;
      if (this.state.canClaim(cx, cy) && land < minLand) {
        if (owned === 0) {
          showFind = true;
          findTitle = `Too little land here for a first plot: it needs at least ${minLand.toLocaleString('en-US')} land tiles, this one has ${land.toLocaleString('en-US')}. Ask the server for the nearest plot with enough land.`;
        }
      } else if (this.state.canClaim(cx, cy)) {
        showClaim = true;
        const cost = claimCost(owned);
        this.claimBtn.textContent = owned === 0 ? 'Claim this plot (free)' : `Claim plot #${owned + 1} (${fmtMoney(cost)})`;
        this.claimBtn.disabled = this.state.funds < cost;
        this.claimBtn.title = this.claimBtn.disabled
          ? `Not enough funds: plot #${owned + 1} costs ${fmtMoney(cost)}`
          : `Claim chunk ${cx},${cy}. Each extra plot costs more than the last.`;
      } else if (owned === 0) {
        showFind = true;
      }
    }
    this.claimBtn.classList.toggle('hidden', !showClaim);
    this.findBtn.classList.toggle('hidden', !showFind);
    this.findBtn.title = findTitle;
  }

  private refreshWelcome(): void {
    const owned = this.state.ownedChunkCount();
    let welcomed = false;
    try {
      welcomed = localStorage.getItem(WELCOMED_KEY) === '1';
    } catch {
      /* ignore */
    }
    if (owned > 0) {
      try {
        localStorage.setItem(WELCOMED_KEY, '1');
      } catch {
        /* ignore */
      }
      if (this.sawNoPlots && !this.foundedToastShown) {
        // first plot of this session's new city: the server names it after the nearest town (cityName rides on the claim)
        const city = this.state.cityName;
        if (city) {
          this.foundedToastShown = true;
          this.toast(`You founded ${city}!`, 'success', 7000); // (renaming, from the top bar or the city hall, goes unadvertised)
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
          this.setWelcomeStatus(
            'Found you! Use "Claim this plot" in the top bar once the map has loaded. If there is too little land there (a first plot needs plenty), try "Find nearest free plot".',
          );
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
  /** The World panel is open on the top cities or the monuments. */
  isLeaderboardOpen(): boolean {
    return this.isWorldOpen() && this.worldTab !== 'stats';
  }

  openLeaderboard(): void {
    this.openWorld('top');
  }

  toggleLeaderboard(): void {
    if (this.isLeaderboardOpen()) this.closeWorld();
    else this.openLeaderboard();
  }

  private refreshWorldPop(): void {
    const { total, cities } = this.state.worldPopulation();
    this.worldPop.textContent = fmtCompact(total);
    this.worldPop.parentElement!.title = `World population: ${total.toLocaleString('en-US')} people in ${cities} ${cities === 1 ? 'city' : 'cities'}`;
  }

  private refreshLeaderboard(): void {
    if (!this.isLeaderboardOpen()) return;
    const mons = this.state.monuments;
    // old servers don't send monuments: no tab then
    const monTab = this.worldTabBtns.get('monuments')!;
    monTab.classList.toggle('hidden', mons === null);
    monTab.textContent = `🏛 Monuments${mons?.length ? ` (${mons.length})` : ''}`;
    const onMon = this.worldTab === 'monuments';
    if (onMon) {
      this.monRows.replaceChildren(
        ...(mons?.length
          ? mons.map((m, i) => this.monumentRow(m, i + 1))
          : [
              el('div', {
                class: 'lb-empty muted',
                text: `No monuments yet. Grow a city past ${MONUMENT_MIN_POP.toLocaleString('en-US')} people and you can retire it as the first.`,
              }),
            ]),
      );
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
    visit.onclick = () => {
      this.actions.flyToChunk(m.cx, m.cy, 1, 900);
      this.closeWorld();
    };
    const sw = el('span', { class: 'sw' });
    sw.style.background = m.color;
    const name = el('span', { class: 'name' }, el('span', { class: 'city', text: city }), el('span', { class: 'mayor muted', text: `by ${m.name}` }));
    name.style.color = m.color;
    const when = new Date(m.at);
    return el(
      'div',
      { class: 'lb-row', 'data-id': m.id },
      el('span', { class: 'rank', text: `${rank}` }),
      sw,
      name,
      el('span', { class: 'pop', text: m.population.toLocaleString('en-US') }),
      el('span', { class: 'chunks', text: `${m.chunks}` }),
      el('span', {
        class: 'date muted',
        text: when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
        title: when.toLocaleString(),
      }),
      visit,
    );
  }

  private leaderboardRow(e: LeaderboardEntry, rank: number, mine: boolean): HTMLElement {
    const city = e.cityName ?? '';
    const visit = el('button', { class: 'btn visit', title: `Fly to ${city || `${e.name}'s city`} (plot ${e.cx},${e.cy})` }, 'Visit');
    visit.onclick = () => {
      this.actions.flyToChunk(e.cx, e.cy, 1, 900);
      this.closeWorld();
    };
    const sw = el('span', { class: 'sw' });
    sw.style.background = e.color;
    // city first (bold), mayor beneath (muted); without a city name the mayor takes the bold slot
    const mayor = mine ? `${e.name} (you)` : e.name;
    const name = city
      ? el('span', { class: 'name' }, el('span', { class: 'city', text: city }), el('span', { class: 'mayor muted', text: mayor }))
      : el('span', { class: 'name' }, el('span', { class: 'city', text: mayor }));
    name.style.color = e.color;
    return el(
      'div',
      { class: `lb-row${mine ? ' me' : ''}`, 'data-id': e.id },
      el('span', { class: 'rank', text: `${rank}` }),
      sw,
      name,
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
      try {
        localStorage.setItem('globalcity.annDismissed', this.annId);
      } catch {
        /* ignore */
      }
      this.annBanner.classList.add('hidden');
    };
    this.annBanner = el('div', { class: 'banner announce hidden', role: 'status' }, el('span', { class: 'banner-ico' }, '📣'), this.annText, annClose);
    this.updBanner = el(
      'div',
      { class: 'banner update hidden', role: 'status' },
      el('span', { class: 'banner-text' }, '✨ A new version of GlobalCity is available.'),
    );
    this.banners = el('div', { id: 'banners' }, this.annBanner, this.updBanner);
  }
  showAnnouncement(id: string, msg: string, level: 'info' | 'warn', until: number): void {
    this.annId = id;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem('globalcity.annDismissed') === id;
    } catch {
      /* ignore */
    }
    this.annText.textContent = msg;
    this.annBanner.classList.toggle('warn', level === 'warn');
    this.annBanner.classList.toggle('hidden', dismissed);
    if (this.annTimer) clearTimeout(this.annTimer);
    const left = until - Date.now();
    if (left > 0 && left < 2 ** 31) this.annTimer = setTimeout(() => this.clearAnnouncement(), left);
  }
  clearAnnouncement(): void {
    this.annBanner.classList.add('hidden');
    this.annId = '';
  }
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
  private touchPlan: TouchPlan | null = null;
  private touchBuild!: HTMLButtonElement;
  onTouchBuild: () => void = () => {};
  onTouchCancel: () => void = () => {};
  private buildTouchBar(): void {
    this.touchWhat = el('span', { class: 'what' });
    const build = (this.touchBuild = el('button', { class: 'primary', type: 'button' }, 'Build'));
    const cancel = el('button', { type: 'button' }, 'Cancel');
    build.addEventListener('click', () => this.onTouchBuild());
    cancel.addEventListener('click', () => this.onTouchCancel());
    this.touchBar = el('div', { id: 'touchbar', class: 'hidden' }, this.touchWhat, build, cancel);
  }
  /** Touch aimed a build tool at a tile (null = hide). Tap the same tile again or press Build. */
  setTouchTarget(tile: { x: number; y: number } | null): void {
    this.touchTile = tile;
    if (!tile) {
      if (!this.touchPlan) this.touchBar.classList.add('hidden');
      return;
    }
    const t = TOOLS[this.state.tool];
    this.touchWhat.textContent = `${t.name} here${t.cost ? ` · ${fmtMoney(t.cost)}` : ''} — tap again or`;
    this.touchBuild.disabled = false;
    this.touchBar.classList.remove('hidden');
  }
  /** A touch drawing waits for confirmation (null = hide): how many tiles it builds and roughly what it costs. */
  setTouchPlan(plan: TouchPlan | null): void {
    this.touchPlan = plan;
    if (!plan) {
      if (!this.touchTile) this.touchBar.classList.add('hidden');
      return;
    }
    const t = TOOLS[plan.tool],
      zone = ZONE_TOOLS.has(plan.tool);
    const what = zone ? `${plan.count} zone${plan.count === 1 ? '' : 's'}` : `${plan.count} tile${plan.count === 1 ? '' : 's'}`;
    // the server can charge more (bridges, clearing trees), so the cost is an estimate
    this.touchWhat.textContent = plan.count ? `${t.name} · ${what}${plan.cost ? ` · about ${fmtMoney(plan.cost)}` : ''}` : 'Only on your own plots';
    this.touchBuild.disabled = plan.count === 0;
    this.touchBar.classList.remove('hidden');
  }

  toast(msg: string, kind: ToastKind = 'info', ms = 4000, at?: ToastAt, big = false): HTMLElement {
    const now = performance.now();
    const last = this.lastToast;
    if (last && last.msg === msg && last.kind === kind && now - last.at < TOAST_DEDUP_MS && last.el.isConnected) {
      clearTimeout(last.timer);
      last.at = now;
      last.el.classList.remove('out');
      last.el.classList.remove('bump');
      void last.el.offsetWidth;
      last.el.classList.add('bump');
      last.timer = setTimeout(() => this.dismissToast(last.el), ms);
      return last.el;
    }
    const t = el('div', { class: `toast ${kind}${big ? ' big' : ''}`, text: msg });
    if (at) {
      t.classList.add('clickable');
      t.setAttribute('role', 'button');
      t.title = `Click to go to tile ${at.x}, ${at.y}`;
      t.onclick = () => {
        this.goToTile(at.x, at.y);
        this.dismissToast(t);
      };
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
    if (auto) {
      if (this.renderer.overlay.mode !== auto) {
        this.setOverlay(auto);
        this.autoOverlay = auto;
      }
    } else if (this.autoOverlay && this.renderer.overlay.mode === this.autoOverlay) {
      this.setOverlay('none');
      this.autoOverlay = null;
    }
    const q = this.query;
    q.replaceChildren(
      el('div', { class: 'qname', text: info.name }),
      el('div', { class: 'qrow', text: `Tile ${info.x}, ${info.y}  #${info.tile}` }),
      el('div', { class: `qrow ${info.powered ? 'good' : 'bad'}`, text: info.powered ? '⚡ Powered' : '⚡ Unpowered' }),
      el('div', { class: 'qrow', text: info.owner ? `Owner: ${info.owner.cityName ? `${info.owner.cityName} — ` : ''}${info.owner.name}` : 'Unclaimed land' }),
      ...(info.zonePop !== undefined
        ? [
            el('div', {
              class: 'qrow',
              text: `${info.zoneKind === 'com' || info.zoneKind === 'ind' ? 'Jobs' : 'Residents'}: ${info.zonePop.toLocaleString('en-US')}`,
            }),
          ]
        : []),
      ...(info.elev !== undefined
        ? [
            el('div', {
              class: 'qrow',
              text: info.elev < 0 ? `🌊 ${(-info.elev).toLocaleString('en-US')} m below sea level` : `⛰ Elevation: ${info.elev.toLocaleString('en-US')} m`,
            }),
          ]
        : []),
      ...this.weatherRow(info.x, info.y),
    );
    if (info.owner) (q.firstElementChild as HTMLElement).style.color = info.owner.color;
    if (id >= CITYHALLBASE && id <= LASTCITYHALL && info.owner && info.owner.id === this.state.me?.id) {
      const rename = el('button', { class: 'btn', type: 'button' }, '✎ Rename city');
      rename.onclick = () => {
        this.hideQuery();
        this.toggleMayor('city');
      };
      q.append(el('div', { class: 'qrow qactions' }, rename));
    }
    this.placeQuery();
  }

  /** The weather at a tile right now, in words: sky, rain or snow, temperature. */
  private weatherRow(x: number, y: number): HTMLElement[] {
    const wx = this.renderer.weather;
    const w = wx.at(x, y);
    if (w.temp === null) return [];
    const mmh = precipMmH(w.precip);
    const strength = mmh < 2.5 ? 'Light' : mmh < 7.6 ? 'Moderate' : 'Heavy';
    const sky =
      mmh >= 0.1
        ? w.snow
          ? `❄ ${strength} snow`
          : `🌧 ${strength} rain`
        : w.cloud < 0.1
          ? '☀ Clear'
          : w.cloud < 0.35
            ? '🌤 Mostly clear'
            : w.cloud < 0.65
              ? '⛅ Partly cloudy'
              : w.cloud < 0.9
                ? '🌥 Mostly cloudy'
                : '☁ Overcast';
    const c = Math.round(w.temp);
    const at = wx.validAt;
    const when = at ? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'now';
    return [el('div', { class: 'qrow', text: `${sky}, ${c} °C`, title: `Real weather here at ${when}: NOAA GFS forecast` })];
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
      const s = Math.max(0, Math.round(((1 - progress) * duration) / 1000));
      return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
    };
    const q = this.query;
    if (v.kind === 'plane') {
      const f = v.flight,
        load = flightLoad(f.key);
      q.replaceChildren(
        el('div', { class: 'qname', text: `✈ Flight ${load.flight}` }),
        row('From', city(f.fromX, f.fromY)),
        row('To', city(f.toX, f.toY)),
        el('div', { class: 'qrow', text: `Carrying ${load.passengers} passengers and ${load.freightT} t of ${load.freight}` }),
        el('div', { class: 'qrow muted', text: `Lands in ${eta(f.progress, f.duration)}` }),
      );
    } else {
      const s = v.voyage,
        cargo = shipCargo(s.key);
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
    const w = q.offsetWidth,
      h = q.offsetHeight;
    const x = Math.min(window.innerWidth - w - pad, this.queryPos.x + 14);
    const y = Math.min(window.innerHeight - h - pad, this.queryPos.y + 14);
    q.style.left = `${Math.max(pad, x)}px`;
    q.style.top = `${Math.max(pad, y)}px`;
    if (this.queryTimer) clearTimeout(this.queryTimer);
    this.queryTimer = setTimeout(() => this.hideQuery(), 8000);
  }

  hideQuery(): void {
    this.query.classList.add('hidden');
    if (this.queryTimer) {
      clearTimeout(this.queryTimer);
      this.queryTimer = null;
    }
  }

  closePanels(): void {
    this.hide(this.about);
    this.closeWorld();
    this.hideQuery();
  }

  // ---------- minimap ----------
  /** Redraw the corner map (its image changed). */
  refreshMinimap(): void {
    this.miniDirty = true;
    this.scheduleMini();
  }
  private miniScheduled = false;
  private scheduleMini(): void {
    if (this.miniScheduled) return;
    this.miniScheduled = true;
    requestAnimationFrame(() => {
      this.miniScheduled = false;
      if (this.miniDirty) this.drawMini();
    });
  }

  private drawMini(): void {
    this.miniDirty = false;
    const c = this.mini;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = 256,
      cssH = 128;
    if (c.width !== cssW * dpr) {
      c.width = cssW * dpr;
      c.height = cssH * dpr;
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.minimap.image, 0, 0, this.minimap.width, this.minimap.height, 0, 0, cssW, cssH);
    // real-time night over the corner map too
    this.renderer.night.update();
    g.imageSmoothingEnabled = true;
    g.drawImage(this.renderer.night.canvas, 0, 0, cssW, cssH);
    g.imageSmoothingEnabled = false;
    const sx = cssW / WORLD_W,
      sy = cssH / WORLD_H;
    // claimed chunks as tiny dots
    for (const cl of this.state.claims.values()) {
      g.fillStyle = withAlpha(cl.color, 0.9);
      g.fillRect(cl.cx * CHUNK * sx, cl.cy * CHUNK * sy, Math.max(1.5, CHUNK * sx), Math.max(1.5, CHUNK * sy));
    }
    // own city
    const mine = this.state.myCentroid();
    if (mine) {
      g.fillStyle = '#fff';
      g.strokeStyle = '#000';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(mine.cx * CHUNK * sx, mine.cy * CHUNK * sy, 3, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    // viewport
    const v = this.renderer.viewRect();
    const x0 = Math.max(0, v.x0 * sx),
      y0 = Math.max(0, v.y0 * sy);
    const x1 = Math.min(cssW, v.x1 * sx),
      y1 = Math.min(cssH, v.y1 * sy);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 1;
    g.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.max(2, Math.round(x1 - x0) - 1), Math.max(2, Math.round(y1 - y0) - 1));
  }

  // ---------- helpers ----------
  private show(e: HTMLElement): void {
    e.classList.remove('hidden');
  }
  private hide(e: HTMLElement): void {
    e.classList.add('hidden');
  }
  private toggle(e: HTMLElement): void {
    e.classList.toggle('hidden');
  }

  /** For claims arriving as a single update: notify when it's ours. */
  onClaimChanged(c: ClaimInfo): void {
    if (this.state.me && c.ownerId === this.state.me.id) this.refreshWelcome();
  }

  /** A chunk was released after its owner went idle (state already dropped it; its buildings stay on the map). */
  onUnclaim(prev: ClaimInfo): void {
    if (this.state.me && prev.ownerId === this.state.me.id && Date.now() - this.abandonedAt > 30_000) {
      this.toast(`Your plot ${prev.cx},${prev.cy} was released after inactivity. Anyone can now claim it with what you built there.`, 'error', 8000, {
        x: prev.cx * CHUNK + CHUNK / 2,
        y: prev.cy * CHUNK + CHUNK / 2,
      });
    }
  }
}
