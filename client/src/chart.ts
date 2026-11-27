// The world population graph in the World panel's stats tab: one series over game time, drawn as inline SVG
// (a 2px line over a faint area, recessive grid, a crosshair and tooltip on hover or touch).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const W = 560,
  H = 170,
  PAD = { l: 44, r: 12, t: 10, b: 22 };
const NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** "Mar 1987" for a game time in years (month / 12 as the fraction). */
export function gameDate(t: number): string {
  const y = Math.floor(t + 1e-6),
    m = Math.min(11, Math.round((t - y) * 12));
  return `${MONTHS[m]} ${y}`;
}

/** Short axis label for a round number: 600M, 1.5B, 20k. */
function axisLabel(v: number): string {
  const f = (x: number, u: string) => `${+x.toFixed(1)}${u}`;
  return v >= 1e9 ? f(v / 1e9, 'B') : v >= 1e6 ? f(v / 1e6, 'M') : v >= 1e3 ? f(v / 1e3, 'k') : String(v);
}

/** Round step for about `n` ticks over `span` (1, 2, 5 x 10^k). */
function niceStep(span: number, n: number): number {
  const raw = span / n,
    p = 10 ** Math.floor(Math.log10(raw)),
    f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

/** The graph for `points` ([game time in years, people], oldest first), or a note while there is too little. */
export function populationChart(points: readonly [number, number][], fmtCompact: (n: number) => string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'ws-chart';
  if (points.length < 2) {
    wrap.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'The graph fills in as the months go by.' }));
    return wrap;
  }
  const t0 = points[0][0],
    t1 = points[points.length - 1][0];
  const maxPop = Math.max(1, ...points.map((p) => p[1]));
  const yStep = niceStep(maxPop, 3),
    yMax = Math.ceil(maxPop / yStep) * yStep;
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / yMax) * (H - PAD.t - PAD.b);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ws-chart-svg', role: 'img' });
  root.setAttribute(
    'aria-label',
    `World population from ${gameDate(t0)} to ${gameDate(t1)}: ${fmtCompact(points[0][1])} to ${fmtCompact(points[points.length - 1][1])} people`,
  );
  // grid and axes: hairlines in a recessive ink, labels in the muted text colour
  for (let v = 0; v <= yMax + 1e-9; v += yStep) {
    root.append(svg('line', { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), class: v === 0 ? 'ws-axis' : 'ws-grid-line' }));
    const label = svg('text', { x: PAD.l - 6, y: y(v) + 4, class: 'ws-tick', 'text-anchor': 'end' });
    label.textContent = axisLabel(v);
    root.append(label);
  }
  const xStep = Math.max(1, niceStep(t1 - t0 || 1, 4));
  for (let t = Math.ceil(t0 / xStep) * xStep; t <= t1 + 1e-9; t += xStep) {
    const at = x(t),
      anchor = at > W - PAD.r - 16 ? 'end' : at < PAD.l + 16 ? 'start' : 'middle';
    const label = svg('text', { x: at, y: H - 6, class: 'ws-tick', 'text-anchor': anchor });
    label.textContent = String(Math.round(t));
    root.append(label);
  }
  // the series: a faint area under a 2px line
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  root.append(svg('path', { d: `${line}L${x(t1).toFixed(1)},${y(0)}L${x(t0).toFixed(1)},${y(0)}Z`, class: 'ws-area' }));
  root.append(svg('path', { d: line, class: 'ws-line' }));
  // hover: crosshair, marker and tooltip at the nearest point
  const cross = svg('line', { y1: PAD.t, y2: H - PAD.b, class: 'ws-cross' });
  const dot = svg('circle', { r: 4, class: 'ws-dot' });
  const hover = svg('g', { class: 'ws-hover' });
  hover.append(cross, dot);
  hover.style.display = 'none';
  root.append(hover);
  const tip = document.createElement('div');
  tip.className = 'ws-tip hidden';
  const hit = svg('rect', { x: PAD.l, y: 0, width: W - PAD.l - PAD.r, height: H, fill: 'transparent' });
  root.append(hit);
  const show = (clientX: number) => {
    const r = root.getBoundingClientRect();
    const t = t0 + ((((clientX - r.left) / r.width) * W - PAD.l) / (W - PAD.l - PAD.r)) * (t1 - t0);
    let best = points[0];
    for (const p of points) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
    const px = x(best[0]),
      py = y(best[1]);
    cross.setAttribute('x1', String(px));
    cross.setAttribute('x2', String(px));
    dot.setAttribute('cx', String(px));
    dot.setAttribute('cy', String(py));
    hover.style.display = '';
    tip.textContent = `${gameDate(best[0])} · ${best[1].toLocaleString('en-US')} people`;
    tip.classList.remove('hidden');
    const left = (px / W) * r.width;
    tip.style.left = `${Math.min(Math.max(left, 70), r.width - 70)}px`;
    tip.style.top = `${(py / H) * r.height}px`;
  };
  const hide = () => {
    hover.style.display = 'none';
    tip.classList.add('hidden');
  };
  hit.addEventListener('pointermove', (e) => show(e.clientX));
  hit.addEventListener('pointerdown', (e) => show(e.clientX));
  hit.addEventListener('pointerleave', hide);
  wrap.append(root, tip);
  return wrap;
}
