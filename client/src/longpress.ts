// Touch screens have no hover, so `title` tooltips never show. Holding a finger on anything with a
// title shows its text in a bubble instead; that press then does not count as a tap.

const HOLD_MS = 450;
const MOVE_PX = 10;
const SHOW_MS = 4000;

export function installLongPressTooltips(): void {
  const tip = document.createElement('div');
  tip.id = 'touchtip';
  tip.className = 'hidden';
  tip.setAttribute('role', 'tooltip');
  document.body.append(tip);

  let timer = 0,
    hideTimer = 0;
  let start: { id: number; x: number; y: number } | null = null;
  let swallowClick = false; // the press that showed the bubble ends in a click we drop

  const hide = (): void => {
    clearTimeout(hideTimer);
    tip.classList.add('hidden');
  };
  const cancel = (): void => {
    clearTimeout(timer);
    start = null;
  };

  const show = (target: HTMLElement, text: string): void => {
    tip.textContent = text;
    tip.classList.remove('hidden');
    const r = target.getBoundingClientRect(),
      t = tip.getBoundingClientRect();
    const m = 8,
      vw = window.innerWidth,
      vh = window.innerHeight;
    const left = Math.min(Math.max(m, r.left + r.width / 2 - t.width / 2), vw - t.width - m);
    // Above the element (a finger covers what is below it), or underneath when there is no room.
    let top = r.top - t.height - m;
    if (top < m) top = Math.min(r.bottom + m, vh - t.height - m);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(m, top)}px`;
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, SHOW_MS);
  };

  document.addEventListener(
    'pointerdown',
    (e) => {
      hide();
      cancel();
      swallowClick = false;
      if (e.pointerType === 'mouse' || !e.isPrimary) return;
      const target = (e.target as Element | null)?.closest<HTMLElement>('[title]');
      const text = target?.title.trim();
      if (!target || !text || target.id === 'map') return;
      start = { id: e.pointerId, x: e.clientX, y: e.clientY };
      timer = window.setTimeout(() => {
        start = null;
        const now = target.title.trim(); // titles are refreshed live; show the current one
        if (!now || !target.isConnected) return;
        swallowClick = true;
        navigator.vibrate?.(10);
        show(target, now);
      }, HOLD_MS);
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    'pointermove',
    (e) => {
      if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_PX) cancel();
    },
    { capture: true, passive: true },
  );
  document.addEventListener('pointerup', cancel, { capture: true, passive: true });
  document.addEventListener('pointercancel', cancel, { capture: true, passive: true });

  // The tap that ends a long press should not also press the button.
  document.addEventListener(
    'click',
    (e) => {
      if (swallowClick) {
        swallowClick = false;
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { capture: true },
  );
  // Android opens a context menu (or text selection) on long press; the bubble replaces it.
  document.addEventListener(
    'contextmenu',
    (e) => {
      if (!tip.classList.contains('hidden') || start) e.preventDefault();
    },
    { capture: true },
  );
  window.addEventListener('scroll', hide, { capture: true, passive: true });
}
