/**
 * TSUZUKU — hash routes (ARCHITECTURE §6, design 07 §1).
 *
 * `#/` dojo · onboarding · train/:mode · scroll/:id · road · station/:n ·
 * gate/:n · shinsa/:belt · story/:id · story/:id/listen · listen/:id ·
 * taiwa/:id · radio · dan · library · collections/:tab · studio/:wallpaperId ·
 * records · ledger · settings · backup · about. Never hand-write `#/...`: use
 * `href()`. `story/:id/listen` (Read-along) and `radio` (茶屋ラジオ) are
 * design 08 §10.2 / §10.3.
 */
import { signal, type Signal } from '@preact/signals';
import { BELT_IDS, type Belt } from '../content/types';
import { WALLPAPER_IDS, type WallpaperId } from './catalog';
import { SESSION_MODES, type SessionMode } from './session-types';

export const COLLECTION_TABS = ['mon', 'kakejiku', 'goshuin'] as const;
export type CollectionsTab = (typeof COLLECTION_TABS)[number];

export type Route =
  | { name: 'dojo' }
  | { name: 'onboarding' }
  | { name: 'train'; mode: SessionMode }
  | { name: 'scroll'; id: string }
  | { name: 'road' }
  | { name: 'station'; n: number }
  | { name: 'gate'; n: number }
  | { name: 'shinsa'; belt: Belt }
  /** `mode: 'listen'` = Read-along (`#/story/:id/listen`, design 08 §10.3); absent = the plain reader. */
  | { name: 'story'; id: string; mode?: 'listen' }
  | { name: 'listen'; id: string }
  | { name: 'taiwa'; id: string }
  /** 茶屋ラジオ (`#/radio`, design 08 §10.2): a non-session listening surface. */
  | { name: 'radio' }
  | { name: 'dan' }
  | { name: 'library' }
  | { name: 'collections'; tab: CollectionsTab }
  | { name: 'studio'; wallpaperId: WallpaperId }
  | { name: 'records' }
  | { name: 'ledger' }
  | { name: 'settings' }
  | { name: 'backup' }
  | { name: 'about' };

export type RouteName = Route['name'];

export const DEFAULT_ROUTE: Route = { name: 'dojo' };

const enc = encodeURIComponent;

export function href(r: Route): string {
  switch (r.name) {
    case 'dojo':
      return '#/';
    case 'train':
      return `#/train/${r.mode}`;
    case 'story':
      return r.mode ? `#/story/${enc(r.id)}/${r.mode}` : `#/story/${enc(r.id)}`;
    case 'scroll':
    case 'listen':
    case 'taiwa':
      return `#/${r.name}/${enc(r.id)}`;
    case 'station':
    case 'gate':
      return `#/${r.name}/${r.n}`;
    case 'shinsa':
      return `#/shinsa/${r.belt}`;
    case 'collections':
      return `#/collections/${r.tab}`;
    case 'studio':
      return `#/studio/${r.wallpaperId}`;
    default:
      return `#/${r.name}`;
  }
}

const SESSION_MODE_SET: ReadonlySet<string> = new Set(SESSION_MODES);
const BELT_SET: ReadonlySet<string> = new Set(BELT_IDS);
const TAB_SET: ReadonlySet<string> = new Set(COLLECTION_TABS);
const WALLPAPER_SET: ReadonlySet<string> = new Set(WALLPAPER_IDS);
const PLAIN: ReadonlySet<string> = new Set([
  'onboarding',
  'road',
  'radio',
  'dan',
  'library',
  'records',
  'ledger',
  'settings',
  'backup',
  'about',
]);

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function intParam(s: string | undefined, min: number): number | null {
  if (s === undefined || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= min ? n : null;
}

/** Accepts `#/x`, `/x`, `x`, with or without trailing slash or query; unknown → dojo. */
export function parseHash(hash: string): Route {
  let h = hash.trim();
  if (h.startsWith('#')) h = h.slice(1);
  const q = h.search(/[?&]/);
  if (q >= 0) h = h.slice(0, q);
  const segs = h
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(safeDecode);
  if (segs.length === 0) return DEFAULT_ROUTE;
  const [head, p1] = segs as [string, string | undefined];
  if (segs.length === 1 && PLAIN.has(head)) return { name: head as 'onboarding' };
  // `#/story/:id/listen` — the Read-along (design 08 §10.3); any other third segment is unknown.
  if (segs.length === 3 && head === 'story' && p1 !== undefined && segs[2] === 'listen') return { name: 'story', id: p1, mode: 'listen' };
  if (segs.length !== 2 || p1 === undefined) return DEFAULT_ROUTE;
  switch (head) {
    case 'train':
      return SESSION_MODE_SET.has(p1) ? { name: 'train', mode: p1 as SessionMode } : DEFAULT_ROUTE;
    case 'scroll':
    case 'story':
    case 'listen':
    case 'taiwa':
      return { name: head, id: p1 };
    case 'station': {
      const n = intParam(p1, 0);
      return n === null ? DEFAULT_ROUTE : { name: 'station', n };
    }
    case 'gate': {
      const n = intParam(p1, 1);
      return n === null ? DEFAULT_ROUTE : { name: 'gate', n };
    }
    case 'shinsa':
      return BELT_SET.has(p1) ? { name: 'shinsa', belt: p1 as Belt } : DEFAULT_ROUTE;
    case 'collections':
      return TAB_SET.has(p1) ? { name: 'collections', tab: p1 as CollectionsTab } : DEFAULT_ROUTE;
    case 'studio':
      return WALLPAPER_SET.has(p1) ? { name: 'studio', wallpaperId: p1 as WallpaperId } : DEFAULT_ROUTE;
    default:
      return DEFAULT_ROUTE;
  }
}

export function sameRoute(a: Route, b: Route): boolean {
  return href(a) === href(b);
}

const APP = 'TSUZUKU';

/*
 * Display labels for `document.title`. `shared/` must not import the page
 * string tables (session/strings, collections/strings …), so the closed
 * unions get a small local map here (kept in step with `session/strings.ts
 * modeName`, `collections/strings.ts tab*`), and free-text content ids
 * (scroll/story/listen/taiwa/wallpaper) show only the kind: their names live
 * in async loader content. Pages may set a richer title themselves.
 */
const MODE_TITLE: Record<SessionMode, string> = {
  kata: '型 Kata',
  kumite: '組手 Kumite',
  shugyo: '修行 Shugyō',
  kage: '影 Kage',
  weak: '弱点 Weak Point',
  rapid: '連続技 Rapid Fire',
  gojuon: '五十音ファイター Gojūon Fighter',
  gate: '関守 Gatekeeper',
  shinsa: '審査 Shinsa',
  scroll: '巻物 Scroll',
  welcome: 'おかえり Welcome Back',
  dan: '道場破り Dōjō Yaburi',
};

const BELT_TITLE: Record<Belt, string> = {
  white: '白帯 White',
  yellow: '黄帯 Yellow',
  orange: '橙帯 Orange',
  green: '緑帯 Green',
  blue: '青帯 Blue',
  purple: '紫帯 Purple',
  brown: '茶帯 Brown',
  black: '黒帯 Black',
};

const TAB_TITLE: Record<CollectionsTab, string> = {
  mon: '紋 Mon',
  kakejiku: '掛け軸 Kakejiku',
  goshuin: '御朱印帳 Goshuin-chō',
};

/** `document.title` per screen (display names, never raw route ids). */
export function titleFor(r: Route): string {
  switch (r.name) {
    case 'dojo':
      return `道場 Dojo · ${APP}`;
    case 'onboarding':
      return `日本橋 Nihonbashi · ${APP}`;
    case 'train':
      return `${MODE_TITLE[r.mode]} · ${APP}`;
    case 'scroll':
      return `巻物 Scroll · ${APP}`;
    case 'road':
      return `東海道 Road · ${APP}`;
    case 'station':
      return `Station ${r.n} · ${APP}`;
    case 'gate':
      return `関守 Gatekeeper ${r.n} · ${APP}`;
    case 'shinsa':
      return `審査 Shinsa ${BELT_TITLE[r.belt]} · ${APP}`;
    case 'story':
      return r.mode === 'listen' ? `読み聞かせ Read-along · ${APP}` : `旅日記 Story · ${APP}`;
    case 'listen':
      return `聴解 Listening · ${APP}`;
    case 'taiwa':
      return `対話 Taiwa · ${APP}`;
    case 'radio':
      return `茶屋ラジオ Radio · ${APP}`;
    case 'dan':
      return `段 Dan · ${APP}`;
    case 'library':
      return `書庫 Library · ${APP}`;
    case 'collections':
      return `${TAB_TITLE[r.tab]} · ${APP}`;
    case 'studio':
      return `Print Studio · ${APP}`;
    case 'records':
      return `Records · ${APP}`;
    case 'ledger':
      return `耳目帳 Ledger · ${APP}`;
    case 'settings':
      return `Settings · ${APP}`;
    case 'backup':
      return `Backup · ${APP}`;
    case 'about':
      return `About · ${APP}`;
  }
}

const hasWindow = typeof window !== 'undefined' && typeof location !== 'undefined';

/** The current route; updates on `hashchange` and `navigate()`. */
export const route: Signal<Route> = signal<Route>(hasWindow ? parseHash(location.hash) : DEFAULT_ROUTE);

function apply(r: Route): void {
  if (!sameRoute(route.peek(), r)) route.value = r;
  if (typeof document !== 'undefined') document.title = titleFor(r);
}

/** Re-reads `location.hash` into the signal (tests, or after a manual hash write). */
export function syncRouteFromLocation(): void {
  if (hasWindow) apply(parseHash(location.hash));
}

if (hasWindow) {
  window.addEventListener('hashchange', syncRouteFromLocation);
}

/** Push (default) or replace the history entry, then update the signal synchronously. */
export function navigate(r: Route, o: { replace?: boolean } = {}): void {
  const h = href(r);
  if (hasWindow) {
    if (o.replace) {
      const url = `${location.pathname}${location.search}${h}`;
      history.replaceState(history.state, '', url);
    } else if (location.hash !== h) {
      location.hash = h;
    }
  }
  apply(r);
}
