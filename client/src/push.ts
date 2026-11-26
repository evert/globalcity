// World reset: when it happens (from the server), and the "Notify me" Web Push sign-up (server/src/notify.ts).
// In the Android app (a Trusted Web Activity with notification delegation) Chrome asks for Android's notification
// permission and the push arrives as an ordinary notification from the app.

export interface WorldReset { at: number | null; vapidKey: string }

export type PushState =
  /** this browser can't do Web Push */
  | 'unsupported'
  /** iPhone/iPad Safari: Web Push only works once the game is added to the home screen */
  | 'ios-install'
  /** the player blocked notifications for the site */
  | 'denied'
  | 'off'
  | 'on';

export async function fetchWorldReset(): Promise<WorldReset | null> {
  try {
    const r = await fetch('/api/world-reset', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json() as WorldReset;
    return { at: typeof j.at === 'number' ? j.at : null, vapidKey: String(j.vapidKey ?? '') };
  } catch { return null; }
}

const isIos = (): boolean => /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const standalone = (): boolean => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/** Which kind of device signed up (only counted, for the sign-up numbers). */
function appKind(): string {
  if (document.referrer.startsWith('android-app://') || (/Android/.test(navigator.userAgent) && standalone())) return 'android-app';
  if (/Android/.test(navigator.userAgent)) return 'android';
  if (isIos()) return 'ios';
  if (/Windows|Macintosh|Linux|CrOS/.test(navigator.userAgent)) return 'desktop';
  return 'other';
}

const supported = (): boolean => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null;
  try {
    if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register('/sw.js');
    return await navigator.serviceWorker.ready;
  } catch { return null; }
}

const sameKey = (sub: PushSubscription, vapidKey: string): boolean => {
  const k = sub.options.applicationServerKey;
  if (!k) return true;
  return b64url(new Uint8Array(k)) === vapidKey.replace(/=+$/, '');
};

export async function pushState(vapidKey: string): Promise<PushState> {
  if (!supported()) return isIos() && !standalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  if (!reg) return 'unsupported';
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  return sub && Notification.permission === 'granted' && sameKey(sub, vapidKey) ? 'on' : 'off';
}

/** Ask for permission, subscribe and tell the server. Returns the new state, or throws with a message to show. */
export async function enablePush(vapidKey: string): Promise<PushState> {
  const reg = await registration();
  if (!reg) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm === 'denied') return 'denied';
  if (perm !== 'granted') return 'off';
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, vapidKey)) { await sub.unsubscribe().catch(() => false); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(vapidKey) });
  const r = await fetch('/api/notify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...sub.toJSON(), app: appKind() }),
  });
  if (!r.ok) throw new Error('The server could not save your sign-up. Please try again later.');
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await fetch('/api/notify/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
    await sub.unsubscribe().catch(() => false);
  }
  return 'off';
}

function b64url(a: Uint8Array): string {
  let s = '';
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
