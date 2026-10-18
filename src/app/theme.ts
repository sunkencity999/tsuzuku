/**
 * TSUZUKU — theme / feel / calendar applier (group A, ARCHITECTURE §7, design 01 §4.3, §6; design 09 §4.3, §7 G, §8).
 *
 * Writes the learner's `settings` onto the document so CSS can react:
 *   <html data-theme="auto|light|dark" data-color-scheme="light|dark"
 *         data-feel="zen|dojo|arcade" data-crt data-reduced-motion
 *         data-phase="dawn|day|dusk|night" data-season data-sekki data-moon
 *         style="--sky-top --sky-mid --sky-horizon --lamp-alpha
 *                --sekki-pigment --sekki-mix --belt-color">
 *   <body class="feel-zen|feel-dojo|feel-arcade [crt] [reduced-motion]">
 *   <meta name="theme-color" content=…>   (--bg, or the sky horizon mixed 40 % into --bg once the calendar is known)
 *
 * `auto` follows `prefers-color-scheme`; tokens.css applies the dark palette
 * under the media query unless `data-theme="light"`, and always under
 * `data-theme="dark"`. `sky` (Follow the sky, design 09 §2.4, §8) is Dojo
 * Morning from dawn until dusk falls in `profile.tz` (the 17:00 phase
 * boundary) and Arcade Night from dusk on — the change *is* moment G, Kure,
 * so the Dojo's lanterns light inside it (room.ts lights them at dusk).
 * `data-theme` then carries the effective scheme itself so the OS preference
 * cannot leak in.
 *
 * `applyCalendar(now, tz, doc)` is pure in `(now, tz, belt, scheme)` and
 * writes the hour and the season (design 09 §4.3); `startThemeSync` arms a
 * timer for the next 05 / 08 / 17 / 20 h or 04:00 boundary (`koyomi.nextBoundaryMs`,
 * the `msUntilNextDay` + `startDayRoll` idiom of store/day.ts), re-applies on
 * `visibilitychange`, and wraps every *visible* theme change — scheme, feel or
 * CRT — in a View Transition (moment G, Kure): `html[data-vt="theme"]` is set
 * before `startViewTransition`, the callback applies the theme, and the
 * attribute is cleared on `finished`. Under reduced motion, without the API,
 * or while hidden, the change applies directly. Every write is compare-and-set,
 * so a re-apply that changes nothing touches no attribute. The clock never
 * makes a sound.
 */
import { computed, effect } from '@preact/signals';
import { BELT_IDS, type Belt } from '@/content/types';
import { LAMP_ALPHA, SEKKI_MIX_MAX, SKY_STOPS, moonPhase, nextBoundaryMs, seasonOf, sekkiOf, skyPhase, type SkyPhase } from '@/shared/koyomi';
import type { EpochDay, Feel, Settings } from '@/shared/store-types';
import { civilParts, dayToCivil, epochDay } from '@/shared/time';
import { store } from '@/store';

export const FEELS: readonly Feel[] = ['zen', 'dojo', 'arcade'];

/** `--bg` per scheme (mirrors tokens.css; used only when computed styles are unavailable). */
const BG_FALLBACK = { light: '#F4EDE0', dark: '#0B0B10' } as const;
const DARK_QUERY = '(prefers-color-scheme: dark)';
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
/** The horizon's share of the browser-chrome colour (design 09 §4.3: "consumers always mix ≤ 40 % with --bg"). */
export const SKY_META_MIX = 0.4;

export type Scheme = 'light' | 'dark';

export interface ThemeEnv {
  /** Defaults to `document`. */
  doc?: Document;
  /** Overrides the media query (tests); `undefined` = ask `matchMedia`. */
  prefersDark?: boolean;
  /** The instant (ms). When given, `applyTheme` also applies the calendar and reads the sky phase for `theme: 'sky'`. */
  now?: number;
  /** IANA zone for the sky phase and the calendar (`profile.tz`); default UTC — one zone for both. */
  tz?: string;
  /** `profile.belt` → `--belt-color`. */
  belt?: Belt;
  /** Overrides the reduced-motion check (tests); `undefined` = the setting OR the media query. */
  reducedMotion?: boolean;
}

function media(query: string): boolean {
  try {
    return typeof matchMedia === 'function' ? matchMedia(query).matches : false;
  } catch {
    return false;
  }
}

function systemPrefersDark(): boolean {
  return media(DARK_QUERY);
}

/**
 * The store's `reducedMotion` setting OR the OS preference — the same rule as
 * `art/ceremony/support.prefersReducedMotion`, restated here because the shell
 * may not import the art tier (the architecture lint's import rule).
 */
export function reducedMotionFor(s: Settings, override?: boolean): boolean {
  if (override !== undefined) return override;
  return Boolean(s.reducedMotion) || media(REDUCED_QUERY);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Compare-and-set writes                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** `setAttribute` only when the value differs: an idempotent re-apply (a belt or clock tick) never invalidates styles. */
function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function toggleAttr(el: Element, name: string, on: boolean): void {
  if (on) {
    if (!el.hasAttribute(name)) el.setAttribute(name, '');
  } else if (el.hasAttribute(name)) el.removeAttribute(name);
}

function setProp(st: CSSStyleDeclaration, name: string, value: string): void {
  if (st.getPropertyValue(name) !== value) st.setProperty(name, value);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Calendar                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

interface LocalNow {
  hour: number;
  day: EpochDay;
}

/** Wall-clock hour and learner day of `now` in `tz`; an unresolvable zone falls back to the host zone. */
function localNow(now: number, tz?: string): LocalNow {
  try {
    return { hour: civilParts(now, tz).hour, day: epochDay(now, tz) };
  } catch {
    return { hour: civilParts(now).hour, day: epochDay(now) };
  }
}

/** The sky phase at `now` in `tz`. */
export function phaseAt(now: number, tz?: string): SkyPhase {
  return skyPhase(localNow(now, tz).hour);
}

/** `#rrggbb` of `a` with `t` of `b` mixed in (sRGB, rounded). */
export function mixHex(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const expand = (hex: string): string => (hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex);
  const A = expand(a);
  const B = expand(b);
  const out = [0, 1, 2].map((i) => Math.round(ch(A, i) * (1 - t) + ch(B, i) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** The browser-chrome colour: the sky horizon mixed `SKY_META_MIX` into `--bg`, so the chrome tells the hour. */
export function skyMetaColor(bg: string, horizon: string): string {
  return mixHex(bg, horizon, SKY_META_MIX);
}

export interface CalendarOptions {
  /** `profile.belt`; written as `--belt-color: var(--belt-<belt>)` when it is a known belt. */
  belt?: Belt;
  /** The effective scheme (for `--bg`); default: read `data-color-scheme` from the document. */
  scheme?: Scheme;
}

/**
 * Design 09 §4.3: `data-phase` / `data-season` / `data-sekki` / `data-moon` on
 * `<html>`, the sky stops, the lamp alpha, the sekki pigment and mix (≤ 3 %),
 * `--belt-color`, and `<meta theme-color>` from the sky horizon. A pure
 * function of `(now, tz, belt, scheme)`: the test feeds fixed instants.
 * Reads `--bg` once.
 */
export function applyCalendar(now: number, tz: string, doc: Document, o: CalendarOptions = {}): void {
  const html = doc.documentElement;
  const { hour, day } = localNow(now, tz);
  const phase = skyPhase(hour);
  const season = seasonOf(dayToCivil(day).month);
  const sekki = sekkiOf(day);
  const moon = moonPhase(day);

  setAttr(html, 'data-phase', phase);
  setAttr(html, 'data-season', season);
  setAttr(html, 'data-sekki', sekki.id);
  setAttr(html, 'data-moon', moon.name);

  const st = html.style;
  const [top, mid, horizon] = SKY_STOPS[phase];
  setProp(st, '--sky-top', top);
  setProp(st, '--sky-mid', mid);
  setProp(st, '--sky-horizon', horizon);
  setProp(st, '--lamp-alpha', String(LAMP_ALPHA[phase]));
  setProp(st, '--sekki-pigment', `var(--${sekki.pigment})`);
  setProp(st, '--sekki-mix', `${Math.min(SEKKI_MIX_MAX, sekki.mix)}%`);
  if (o.belt !== undefined && BELT_IDS.includes(o.belt)) setProp(st, '--belt-color', `var(--belt-${o.belt})`);

  const scheme: Scheme = o.scheme ?? (html.getAttribute('data-color-scheme') === 'dark' ? 'dark' : 'light');
  setMetaThemeColor(doc, skyMetaColor(readBg(doc, scheme), horizon));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Theme                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The scheme the learner actually sees. `sky` reads the phase: Morning through
 * dawn and day, Night from the moment dusk falls (design 09 §2.4 "turn to
 * Arcade Night at dusk", §7 G "dusk falls"); without a known phase it stays Morning.
 */
export function effectiveTheme(s: Settings, prefersDark?: boolean, phase?: SkyPhase): Scheme {
  if (s.theme === 'light' || s.theme === 'dark') return s.theme;
  if (s.theme === 'sky') return phase === 'dusk' || phase === 'night' ? 'dark' : 'light';
  return (prefersDark ?? systemPrefersDark()) ? 'dark' : 'light';
}

function readBg(doc: Document, scheme: Scheme): string {
  try {
    const view = doc.defaultView;
    const v = view ? view.getComputedStyle(doc.documentElement).getPropertyValue('--bg').trim() : '';
    if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  } catch {
    /* jsdom or detached document */
  }
  return BG_FALLBACK[scheme];
}

function setMetaThemeColor(doc: Document, color: string): void {
  let meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    if (!doc.head) return;
    meta = doc.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    doc.head.appendChild(meta);
  }
  if (meta.getAttribute('content') !== color) meta.setAttribute('content', color);
}

/**
 * Applies theme, feel, CRT and reduced-motion to `<html>` / `<body>`, and —
 * when `env.now` is given — the calendar (`applyCalendar`). Idempotent; one
 * `--bg` read and one meta write per call.
 */
export function applyTheme(s: Settings, env: ThemeEnv = {}): void {
  const doc = env.doc ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return;
  const html = doc.documentElement;
  const body = doc.body;
  // One zone for the sky phase and the calendar (design 09 §4.3: a function of (now, tz, belt, settings)).
  const tz = env.tz ?? 'UTC';
  const phase = env.now !== undefined ? phaseAt(env.now, tz) : undefined;
  const scheme = effectiveTheme(s, env.prefersDark, phase);
  const feel: Feel = FEELS.includes(s.feel) ? s.feel : 'dojo';
  // CRT scanlines live on arcade screens only (design 01 §4.4).
  const crt = Boolean(s.crt) && feel === 'arcade';
  const reduced = Boolean(s.reducedMotion);

  // `sky` pins the palette to the effective scheme (tokens.css keys off data-theme, not data-color-scheme).
  setAttr(html, 'data-theme', s.theme === 'light' || s.theme === 'dark' ? s.theme : s.theme === 'sky' ? scheme : 'auto');
  setAttr(html, 'data-color-scheme', scheme);
  setAttr(html, 'data-feel', feel);
  toggleAttr(html, 'data-crt', crt);
  toggleAttr(html, 'data-reduced-motion', reduced);

  if (body) {
    for (const f of FEELS) body.classList.toggle(`feel-${f}`, f === feel);
    body.classList.toggle('crt', crt);
    body.classList.toggle('reduced-motion', reduced);
  }

  // With a clock the calendar writes the horizon-mixed meta; without one, the plain --bg.
  if (env.now !== undefined) applyCalendar(env.now, tz, doc, { belt: env.belt, scheme });
  else setMetaThemeColor(doc, readBg(doc, scheme));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Moment G · Kure — dusk falls                                               */
/* ────────────────────────────────────────────────────────────────────────── */

interface ViewTransitionLike {
  finished: Promise<void>;
}
type VtDocument = Document & { startViewTransition?: (update: () => void | Promise<void>) => ViewTransitionLike };

/** True when a theme change may ride a View Transition: the API exists, the page is visible, and motion is not reduced. */
export function canThemeTransition(doc: Document, reduced: boolean): boolean {
  return !reduced && typeof (doc as VtDocument).startViewTransition === 'function' && !doc.hidden;
}

/**
 * The newest theme transition's generation: when a second transition starts
 * while the first is in flight (two radio taps, a boundary beside a tap), the
 * first one's `finished` must not clear `data-vt` from under the second, or
 * A2's four fixed `view-transition-name`s would return mid-capture.
 */
let vtGen = 0;

/**
 * Runs `apply` inside `document.startViewTransition` with `html[data-vt="theme"]`
 * set for the transition's life (so A2's fixed `view-transition-name`s drop and
 * the whole page falls into `root` for the top-down wipe, design 09 §6.4 / §7 G);
 * the attribute is cleared on `finished`. Returns whether a transition ran;
 * otherwise `apply` has run directly.
 */
export function transitionTheme(doc: Document, apply: () => void, reduced: boolean): boolean {
  if (!canThemeTransition(doc, reduced)) {
    apply();
    return false;
  }
  const html = doc.documentElement;
  const gen = ++vtGen;
  const clear = (): void => {
    if (gen === vtGen && html.getAttribute('data-vt') === 'theme') html.removeAttribute('data-vt');
  };
  html.setAttribute('data-vt', 'theme');
  let vt: ViewTransitionLike | undefined;
  try {
    vt = (doc as VtDocument).startViewTransition!(apply);
  } catch {
    clear();
    apply();
    return false;
  }
  if (vt && vt.finished && typeof vt.finished.then === 'function') vt.finished.then(clear, clear);
  else clear();
  return true;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Sync                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ThemeSyncEnv extends ThemeEnv {
  /** The clock; default `store.now()`. (`now` in `ThemeEnv` freezes the instant instead — tests.) */
  clock?: () => number;
}

/** `ThemeEnv` with the instant and the zone resolved. */
type ResolvedEnv = ThemeEnv & { now: number; tz: string };

/** What a theme View Transition is for: the parts of the document a change of scheme, feel or CRT repaints. */
function visualKey(s: Settings, scheme: Scheme): string {
  const feel: Feel = FEELS.includes(s.feel) ? s.feel : 'dojo';
  return `${scheme}|${feel}|${Boolean(s.crt) && feel === 'arcade'}`;
}

/**
 * Keeps the document in sync with `store.settings`, `profile.belt` / `tz`, the
 * system scheme while `theme: 'auto'`, and the clock (the 05 / 08 / 17 / 20 h sky
 * boundaries and the 04:00 day roll, re-applied on `visibilitychange`). A
 * visible change after the first paint rides moment G. Returns a disposer.
 */
export function startThemeSync(env: ThemeSyncEnv = {}): () => void {
  const doc = env.doc ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return () => {};
  const clock = env.clock ?? ((): number => (env.now !== undefined ? env.now : store.now()));
  let lastKey: string | null = null;
  let lastTz: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  // Only the belt and the zone matter here. Computeds notify on a change of *value*, so the XP,
  // level or name patches `profile` takes on every graded answer never re-apply the document.
  const beltSig = computed(() => store.profile.value.belt);
  const tzSig = computed(() => store.profile.value.tz);

  const envFor = (): ResolvedEnv => ({ ...env, now: clock(), tz: env.tz ?? tzSig.peek(), belt: env.belt ?? beltSig.peek() });

  const sync = (s: Settings): void => {
    const e = envFor();
    const key = visualKey(s, effectiveTheme(s, e.prefersDark, phaseAt(e.now, e.tz)));
    const apply = (): void => applyTheme(s, e);
    // The save arriving at boot is still the first paint (A2's arrival transition owns that moment), never a dusk.
    const visibleChange = lastKey !== null && key !== lastKey && store.ready.peek();
    if (visibleChange) transitionTheme(doc, apply, reducedMotionFor(s, e.reducedMotion));
    else apply();
    lastKey = key;
    // A new zone moves the boundaries: re-arm the timer (the first run is followed by arm() below).
    if (lastTz !== null && e.tz !== lastTz) arm();
    lastTz = e.tz;
  };

  const arm = (): void => {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    const now = clock();
    const tz = env.tz ?? tzSig.peek();
    let wait: number;
    try {
      wait = nextBoundaryMs(now, tz);
    } catch {
      wait = nextBoundaryMs(now);
    }
    timer = setTimeout(() => {
      timer = null;
      sync(store.settings.peek());
      arm();
    }, Math.max(1000, wait + 1000));
  };

  const dispose = effect(() => {
    const s = store.settings.value;
    beltSig.value; // --belt-color follows the belt
    tzSig.value; // the calendar and the boundaries follow the zone
    sync(s);
  });
  arm();

  const onChange = (): void => sync(store.settings.peek());
  const onVisible = (): void => {
    if (doc.hidden) return;
    sync(store.settings.peek());
    arm();
  };
  let mql: MediaQueryList | null = null;
  try {
    if (typeof matchMedia === 'function') {
      mql = matchMedia(DARK_QUERY);
      if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
    }
  } catch {
    mql = null;
  }
  doc.addEventListener('visibilitychange', onVisible);

  return () => {
    stopped = true;
    dispose();
    if (timer !== null) clearTimeout(timer);
    timer = null;
    doc.removeEventListener('visibilitychange', onVisible);
    if (mql && typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onChange);
  };
}
