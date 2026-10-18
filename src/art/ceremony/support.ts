/**
 * TSUZUKU — ceremony support (group G).
 *
 *  Lazy sibling art   MonCrest, GoshuinStamp, mon.ts and wallpapers/index.ts
 *                     are written by sibling G builders. They are loaded
 *                     through `import.meta.glob` (the pattern main.tsx uses for
 *                     optional barrels): a file that is not built yet is simply
 *                     absent and every ceremony falls back to its own art, so a
 *                     half-built tree never breaks a ceremony or a test. Tests
 *                     inject doubles with `setLazyArtForTests`.
 *  Motion / feel      `prefersReducedMotion()` (store setting OR media query),
 *                     `playSfx()` (silent in Zen, design 01 §6).
 *  useTimeline        phase index driven by setTimeout; reduced motion jumps
 *                     to the final phase (static card).
 *  useExit            the kasure exit (design 09 §6.3): `leave()` marks the
 *                     root `data-leaving`, `done` fires on its animationend or
 *                     after EXIT_FALLBACK_MS; at once under reduced motion.
 *  verb               the ink-verb classes, empty under reduced motion (§6.6:
 *                     the static frame carries no .ink-* class).
 *  eraGloss / eraDateNodes  "Reiwa 8 · Oct 18" under 令和8年10月18日 (§7 E).
 *  beltTitleRuby      `{中堅|ちゅうけん}` for the rank line from Green kana on
 *                     (§3.3: romaji below Green, a kana <Ruby> after).
 *  Focus helpers      `FOCUSABLE`, `isInteractive`.
 */
import { h, type FunctionComponent, type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { BeltDef } from '../../content/types';
import { sfx } from '../../shared/audio';
import type { BadgeId, SfxName, WallpaperId } from '../../shared/catalog';
import type { EpochDay } from '../../shared/store-types';
import { dayToCivil, formatEraDate } from '../../shared/time';
import { store } from '../../store';
import type { TextLayer } from '../jtext';
import { fill } from '../strings';
import type { RenderedWallpaper, Revealed, WallpaperSize } from '../wallpapers/spec';
import { S } from './strings';

/* ────────────────────────────────────────────────────────────────────────── */
/* Sibling module shapes (from their module-plan briefs)                      */
/* ────────────────────────────────────────────────────────────────────────── */

export interface MonCrestProps {
  id: BadgeId;
  earned: boolean;
  size?: number;
  describe?: string;
  /** The real crest shows its own caption by default; the ceremonies carry the name themselves. */
  caption?: boolean;
  /** The real crest's own hanko-slam entrance; the ceremonies animate the stage instead. */
  slam?: boolean;
}

export interface GoshuinStampProps {
  station: number;
  at: EpochDay;
  perfect: boolean;
  assisted: boolean;
  size?: number;
}

/** mon.ts's stone-as-image split (design 09 §7 E): the embossed stone rasterised once, the glyph set over it in the page's fonts. */
export interface MonStoneImage {
  url: string;
  glyph: TextLayer;
  view: number;
}

export interface MonModule {
  monSvg(spec: unknown, o: { size: number; earned: boolean; seed: number }): string;
  MON_SPECS: Partial<Record<BadgeId, unknown>>;
  /** The stone twin the slam turns to colour (mon.ts `monStoneImage`); absent on an older module. */
  monStoneImage?(spec: unknown, o: { size: number; seed: number }): MonStoneImage;
  /** The crest's fixed seed (mon.ts `monSeed`), so the stone twin matches `<MonCrest>` stroke for stroke. */
  monSeed?(id: BadgeId): number;
}

export interface WallpaperRenderOptions {
  size: WallpaperSize;
  reforge: number;
  revealed: Revealed;
  locked: boolean;
}

export interface WallpapersModule {
  renderWallpaper(id: WallpaperId, o: WallpaperRenderOptions): Promise<RenderedWallpaper>;
}

export interface LazyArt {
  MonCrest: FunctionComponent<MonCrestProps> | null;
  GoshuinStamp: FunctionComponent<GoshuinStampProps> | null;
  mon: MonModule | null;
  wallpapers: WallpapersModule | null;
}

type AnyModule = Record<string, unknown>;

const FILES = {
  MonCrest: '/src/art/MonCrest.tsx',
  GoshuinStamp: '/src/art/GoshuinStamp.tsx',
  mon: '/src/art/mon.ts',
  wallpapers: '/src/art/wallpapers/index.ts',
} as const;

/** Only files that exist at build time appear here; the keys are the paths above. */
const GLOB = import.meta.glob<AnyModule>(['/src/art/MonCrest.tsx', '/src/art/GoshuinStamp.tsx', '/src/art/mon.ts', '/src/art/wallpapers/index.ts']);

let override: Partial<LazyArt> | null = null;
const cache = new Map<string, Promise<AnyModule | null>>();

/**
 * Tests: `setLazyArtForTests({ MonCrest: Fake })` serves doubles; a key set to
 * `null` means "not built"; `setLazyArtForTests(null)` restores the real
 * loaders and clears the cache.
 */
export function setLazyArtForTests(o: Partial<LazyArt> | null): void {
  override = o;
  cache.clear();
}

async function loadFile(file: string): Promise<AnyModule | null> {
  const loader = GLOB[file];
  if (!loader) return null;
  try {
    return await loader();
  } catch (err) {
    // The file exists but cannot be evaluated yet (e.g. the kakejiku registry
    // before every generator is written). Degrade to the fallback art.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ceremony] ${file} unavailable: ${msg.split('\n')[0]}`);
    return null;
  }
}

function cached(file: string): Promise<AnyModule | null> {
  let p = cache.get(file);
  if (!p) {
    p = loadFile(file);
    cache.set(file, p);
  }
  return p;
}

function has<K extends keyof LazyArt>(k: K): boolean {
  return override !== null && Object.prototype.hasOwnProperty.call(override, k);
}

export async function loadMonCrest(): Promise<FunctionComponent<MonCrestProps> | null> {
  if (has('MonCrest')) return override!.MonCrest ?? null;
  const m = await cached(FILES.MonCrest);
  return m && typeof m.MonCrest === 'function' ? (m.MonCrest as FunctionComponent<MonCrestProps>) : null;
}

export async function loadGoshuinStamp(): Promise<FunctionComponent<GoshuinStampProps> | null> {
  if (has('GoshuinStamp')) return override!.GoshuinStamp ?? null;
  const m = await cached(FILES.GoshuinStamp);
  return m && typeof m.GoshuinStamp === 'function' ? (m.GoshuinStamp as FunctionComponent<GoshuinStampProps>) : null;
}

export async function loadMon(): Promise<MonModule | null> {
  if (has('mon')) return override!.mon ?? null;
  const m = await cached(FILES.mon);
  if (!m || typeof m.monSvg !== 'function' || typeof m.MON_SPECS !== 'object' || m.MON_SPECS === null) return null;
  const mod: MonModule = { monSvg: m.monSvg as MonModule['monSvg'], MON_SPECS: m.MON_SPECS as MonModule['MON_SPECS'] };
  if (typeof m.monStoneImage === 'function') mod.monStoneImage = m.monStoneImage as NonNullable<MonModule['monStoneImage']>;
  if (typeof m.monSeed === 'function') mod.monSeed = m.monSeed as NonNullable<MonModule['monSeed']>;
  return mod;
}

export async function loadWallpapers(): Promise<WallpapersModule | null> {
  if (has('wallpapers')) return override!.wallpapers ?? null;
  const m = await cached(FILES.wallpapers);
  return m && typeof m.renderWallpaper === 'function' ? { renderWallpaper: m.renderWallpaper as WallpapersModule['renderWallpaper'] } : null;
}

/** `useEffect`-friendly loader: resolves to the module (or null) once, ignoring late results after unmount. */
export function useLazy<T>(load: () => Promise<T | null>): { value: T | null; settled: boolean } {
  const [state, setState] = useState<{ value: T | null; settled: boolean }>({ value: null, settled: false });
  useEffect(() => {
    let alive = true;
    load().then(
      (v) => {
        if (alive) setState({ value: v, settled: true });
      },
      () => {
        if (alive) setState({ value: null, settled: true });
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Motion and feel                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/** The store's `reducedMotion` setting OR the OS preference. */
export function prefersReducedMotion(): boolean {
  try {
    if (store.settings.peek().reducedMotion) return true;
  } catch {
    /* store not initialised: fall through to the media query */
  }
  try {
    return typeof matchMedia === 'function' && matchMedia(REDUCED_QUERY).matches;
  } catch {
    return false;
  }
}

export function currentFeel(): 'zen' | 'dojo' | 'arcade' {
  try {
    const f = store.settings.peek().feel;
    return f === 'zen' || f === 'arcade' ? f : 'dojo';
  } catch {
    return 'dojo';
  }
}

/** SFX through the audio slot; Zen keeps the ceremony silent (design 01 §6). */
export function playSfx(name: SfxName): void {
  if (currentFeel() === 'zen') return;
  try {
    sfx(name);
  } catch (err) {
    console.warn('[ceremony] sfx failed', err);
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Timeline                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export interface TimelineOptions {
  /** Static variant: jump to the last phase at once (the `endAt` timer still runs). */
  reduced: boolean;
  /** Fire `onEnd` this many ms after mount (auto-complete). */
  endAt?: number;
  onEnd?: () => void;
}

/**
 * Current phase index for a list of phase start times (ms since mount, `at[0]`
 * is 0). Phases only move forward; timers are cleared on unmount.
 */
export function useTimeline(at: readonly number[], o: TimelineOptions): number {
  const last = Math.max(0, at.length - 1);
  const [phase, setPhase] = useState(o.reduced ? last : 0);
  const onEnd = useRef(o.onEnd);
  onEnd.current = o.onEnd;
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (!o.reduced) {
      at.forEach((ms, i) => {
        if (i === 0) return;
        timers.push(
          setTimeout(() => {
            setPhase((p) => (i > p ? i : p));
          }, Math.max(0, ms)),
        );
      });
    }
    if (o.endAt !== undefined) {
      timers.push(
        setTimeout(() => {
          onEnd.current?.();
        }, Math.max(0, o.endAt)),
      );
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
    // The phase table and the reduced flag are fixed for the life of a ceremony.
  }, []);
  return phase;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Exit, verbs, the era date                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/** The kasure exit's safety net when no animationend arrives (≤ 200 ms, design 09 §10 D1). */
export const EXIT_FALLBACK_MS = 200;

export interface Exit {
  /** `data-leaving` is set: the root plays kasure (motion.css `.ink-nijimi[data-leaving]`). */
  leaving: boolean;
  /** Start the exit (idempotent); under reduced motion `done` fires at once. */
  leave(): void;
  /**
   * Put on the root: its own `animationend` finishes the exit early. A callback
   * ref with `addEventListener`, not a JSX prop — Preact derives the prop's
   * event name from `'onanimationend' in dom`, which jsdom lacks (Lantern.tsx).
   */
  ref(el: HTMLElement | null): void;
}

const NO_EXIT = Symbol('no-exit');

/**
 * Every surface that enters also exits (design 09 §6.3): the host sets
 * `data-leaving` on the root, motion.css dries it out at --dur-1, and `done`
 * (unmount, dismiss) runs on the root's own `animationend` or after
 * `EXIT_FALLBACK_MS`, whichever comes first — never cold. Reduced motion skips
 * the beat. One exit per `resetKey` (the ceremony's key when one hook serves a
 * queue; a constant for a component that is remounted per ceremony).
 */
export function useExit(done: () => void, reduced: boolean, resetKey: unknown = null): Exit {
  const [leavingKey, setLeavingKey] = useState<unknown>(NO_EXIT);
  const doneRef = useRef(done);
  doneRef.current = done;
  const keyRef = useRef(resetKey);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const el = useRef<HTMLElement | null>(null);
  if (keyRef.current !== resetKey) {
    keyRef.current = resetKey;
    fired.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }
  const finish = (): void => {
    if (fired.current) return;
    fired.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    doneRef.current();
  };
  const onEnd = useRef<(e: Event) => void>(() => undefined);
  onEnd.current = (e) => {
    if (!timer.current || e.target !== e.currentTarget) return;
    const name = (e as Partial<AnimationEvent>).animationName;
    if (name && name !== 'kasure') return;
    finish();
  };
  const listener = useRef((e: Event) => onEnd.current(e)).current;
  const ref = useRef((node: HTMLElement | null): void => {
    el.current?.removeEventListener('animationend', listener);
    el.current = node;
    node?.addEventListener('animationend', listener);
  }).current;
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      el.current?.removeEventListener('animationend', listener);
    },
    [],
  );
  const leave = (): void => {
    if (fired.current || timer.current) return;
    if (reduced) {
      finish();
      return;
    }
    setLeavingKey(resetKey);
    timer.current = setTimeout(finish, EXIT_FALLBACK_MS);
  };
  return { leaving: leavingKey !== NO_EXIT && leavingKey === resetKey, leave, ref };
}

/** Ink-verb classes for a frame: none under reduced motion (the final frame is static, §6.6). */
export function verb(reduced: boolean, ...classes: string[]): string {
  return reduced ? '' : classes.join(' ');
}

/** "Reiwa 8 · Oct 18": the Latin gloss of `formatEraDate` (元年 → 1), never an unglossed 令和八年 (design 09 §7 E). */
export function eraGloss(day: EpochDay): string {
  const ja = formatEraDate(day);
  const m = /^(\D+?)(\d+|元)年/.exec(ja);
  const era = m ? (S.eraNames[m[1]!] ?? m[1]!) : '';
  const c = dayToCivil(day);
  const year = m ? (m[2] === '元' ? '1' : m[2]!) : String(c.year);
  return fill(S.eraGloss, { era: era ? `${era} ` : '', y: year, mon: S.months[c.month - 1] ?? String(c.month), d: c.day });
}

/** `{中堅|ちゅうけん}`: the rank title with its kana reading, for `<Ruby>` once kana are Green (design 09 §3.3). */
export function beltTitleRuby(def: Pick<BeltDef, 'id' | 'titleJa'>): string {
  const kana = S.beltTitleKana[def.id];
  return kana ? `{${def.titleJa}|${kana}}` : def.titleJa;
}

/** The era date exactly as `formatEraDate` prints it, each digit run in the pixel face (Mincho carries the kanji; d23). */
export function eraDateNodes(day: EpochDay): JSX.Element[] {
  return formatEraDate(day)
    .split(/(\d+)/)
    .filter((s) => s.length > 0)
    .map((s, i) => (/^\d+$/.test(s) ? h('span', { key: i, class: 'ceremony__era-num' }, s) : h('span', { key: i }, s)));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Focus helpers                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

export const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** True when the event target is (inside) a control that handles its own activation. */
export function isInteractive(t: EventTarget | null): boolean {
  if (!t || typeof (t as Element).closest !== 'function') return false;
  return (t as Element).closest('button, a[href], input, select, textarea, summary, [role="button"]') !== null;
}

/** Tab / Shift+Tab stay inside `root`. */
export function trapTab(e: KeyboardEvent, root: HTMLElement): void {
  if (e.key !== 'Tab') return;
  const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');
  if (items.length === 0) {
    e.preventDefault();
    root.focus();
    return;
  }
  const first = items[0]!;
  const lastEl = items[items.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === root)) {
    e.preventDefault();
    lastEl.focus();
  } else if (!e.shiftKey && active === lastEl) {
    e.preventDefault();
    first.focus();
  }
}

/** Inline-SVG helper: inject extra markup before the closing tag of a document string. */
export function appendToSvg(svg: string, markup: string): string {
  const i = svg.lastIndexOf('</svg>');
  return i < 0 ? svg : svg.slice(0, i) + markup + svg.slice(i);
}
