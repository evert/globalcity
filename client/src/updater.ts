// Keeps clients on the current build. The server announces its client version; when it differs from
// ours we reload, but only when that can't interrupt anything: the tab is in the background or the
// player has not touched anything for IDLE_MS. Otherwise a banner offers a reload button.

const IDLE_MS = 60_000;
const CHECK_MS = 5_000;
const GUARD_KEY = 'globalcity.reloadFor';

export class Updater {
  private latest = '';
  private lastInput = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly current: string,
    private readonly showBanner: (reload: () => void) => void,
  ) {
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      window.addEventListener(
        ev,
        () => {
          this.lastInput = Date.now();
        },
        { passive: true, capture: true },
      );
    }
    document.addEventListener('visibilitychange', () => this.maybeReload());
  }

  get outdated(): boolean {
    return !!this.latest && this.current !== 'dev' && this.latest !== this.current;
  }

  /** Server told us the current build. */
  onVersion(version: string): void {
    this.latest = version;
    if (!this.outdated) return;
    // Don't loop: if we already reloaded for this exact version and still run an old build (a stale
    // cache somewhere), stop auto-reloading and just offer the button.
    let guarded = false;
    try {
      guarded = sessionStorage.getItem(GUARD_KEY) === version;
    } catch {
      /* storage blocked */
    }
    this.showBanner(() => this.reload());
    if (guarded) return;
    if (!this.maybeReload() && !this.timer) this.timer = setInterval(() => this.maybeReload(), CHECK_MS);
  }

  private maybeReload(): boolean {
    if (!this.outdated) return false;
    let guarded = false;
    try {
      guarded = sessionStorage.getItem(GUARD_KEY) === this.latest;
    } catch {
      /* ignore */
    }
    if (guarded) return false;
    const idle = Date.now() - this.lastInput >= IDLE_MS;
    if (document.visibilityState === 'hidden' || idle) {
      this.reload();
      return true;
    }
    return false;
  }

  reload(): void {
    try {
      sessionStorage.setItem(GUARD_KEY, this.latest);
    } catch {
      /* ignore */
    }
    location.reload();
  }
}
