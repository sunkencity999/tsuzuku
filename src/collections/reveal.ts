/**
 * TSUZUKU — moment E inline, the collections' side (design 09 §7 E, §5.3, §6.7).
 *
 *  newSince(shelf, items, today)  the ids "earned since this shelf was last opened":
 *                                 those not in the shelf's seen set. The set lives in
 *                                 localStorage under its own key (and a module mirror),
 *                                 never in the save — §10 adds no store field for it — so
 *                                 a relaunch (every iOS PWA open is a new tab) still knows
 *                                 what the shelf has shown. With no set yet (a first open)
 *                                 today's ink counts as new, nothing older, so a first open
 *                                 never replays a month of seals.
 *  markOpened(shelf, ids)         writes the seen set once the shelf has rendered: what it
 *                                 shows settled, not what still waits below the fold.
 *  markSeen(shelf, id)            adds one id when its reveal has played (seen, not mounted).
 *  useMomentE(ref, fresh, onSeen) the beats as a phase machine: `wait` (stone / unpressed)
 *                                 until the one-shot `useReveal` fires, `in` (nijimi →
 *                                 osu → kawaku → the era date), `leaving` (kasure), `done`.
 *                                 Reduced motion waits for the viewport too (a crest below
 *                                 the fold must not reveal unseen), then lands the final
 *                                 state at once with the same captions — the verbs' reduced
 *                                 forms are mat fades, and the wet layer is left off. At most
 *                                 two reveals play together — `.ink-wet::after` is one live
 *                                 `#ink-bleed-8` filter per element (§6.7 rule 2) — the rest
 *                                 wait their turn.
 *  eraGloss(day)                  'Reiwa 8 · Oct 18': the Latin line under formatEraDate's
 *                                 令和8年10月18日, so the era date is never unglossed (§3.3).
 *  useColorScheme()               'light' | 'dark' from <html data-color-scheme>, live
 *                                 through a MutationObserver, so an <img> stamp (hex paints,
 *                                 no var() inside an image) re-renders once on moment G.
 */
import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Theme } from '../art/color';
import type { EpochDay } from '../shared/store-types';
import { civilToDay, dayToCivil } from '../shared/time';
import { prefersReducedMotion, useReveal } from '../shared/ui/use-reveal';
import { S, fill } from './strings';

export type Shelf = 'mon' | 'goshuin' | 'library';

/* ── the seen sets ──────────────────────────────────────────────────────── */

const KEY_PREFIX = 'tsuzuku:opened:';
const SHELVES: readonly Shelf[] = ['mon', 'goshuin', 'library'];
const memory = new Map<Shelf, Set<string>>();

/** `localStorage` when the host has one (never Node's flag-gated global, never a throwing private-mode getter). */
function storage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch {
    return null;
  }
}

function readSeen(shelf: Shelf): Set<string> | null {
  const m = memory.get(shelf);
  if (m) return m;
  try {
    const raw = storage()?.getItem(KEY_PREFIX + shelf) ?? null;
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const set = new Set(parsed.filter((x): x is string => typeof x === 'string'));
        memory.set(shelf, set);
        return set;
      }
    }
  } catch {
    /* no localStorage, or a foreign value: memory only */
  }
  return null;
}

function writeSeen(shelf: Shelf, set: Set<string>): void {
  memory.set(shelf, set);
  try {
    storage()?.setItem(KEY_PREFIX + shelf, JSON.stringify(Array.from(set)));
  } catch {
    /* memory only */
  }
}

export interface Earned {
  id: string;
  /** Day earned; absent for items without a date (the Library's). */
  at?: EpochDay;
}

/** Ids new since the shelf was last opened; with no record yet, today's items only (none without a day). */
export function newSince(shelf: Shelf, items: readonly Earned[], today: EpochDay): Set<string> {
  const seen = readSeen(shelf);
  const out = new Set<string>();
  for (const it of items) {
    if (seen ? !seen.has(it.id) : it.at !== undefined && it.at >= today) out.add(it.id);
  }
  return out;
}

/** Records what the shelf showed, so the next open reveals only what arrived in between. */
export function markOpened(shelf: Shelf, ids: readonly string[]): void {
  writeSeen(shelf, new Set(ids));
}

/** Records one item as shown (its reveal played): a fresh item never scrolled to stays fresh for the next open. */
export function markSeen(shelf: Shelf, id: string): void {
  const set = new Set(readSeen(shelf) ?? []);
  set.add(id);
  writeSeen(shelf, set);
}

/** Forgets every seen set and the reveal queue (tests). */
export function resetOpenedForTests(): void {
  memory.clear();
  try {
    for (const shelf of SHELVES) storage()?.removeItem(KEY_PREFIX + shelf);
  } catch {
    /* nothing stored */
  }
  live = 0;
  waiting.length = 0;
}

/* ── the reveal gate: ≤ 2 live wet layers (§6.7 rule 2) ───────────────── */

export const MAX_LIVE_REVEALS = 2;
let live = 0;
const waiting: (() => void)[] = [];

/**
 * Runs `start` now if fewer than two reveals are live, else when one ends.
 * Returns the release: call it when the wet layer has dried (or on unmount);
 * a release before `start` ran simply withdraws from the queue.
 */
export function acquireReveal(start: () => void): () => void {
  let started = false;
  let released = false;
  const go = (): void => {
    started = true;
    live++;
    start();
  };
  if (live < MAX_LIVE_REVEALS) go();
  else waiting.push(go);
  return () => {
    if (released) return;
    released = true;
    if (!started) {
      const i = waiting.indexOf(go);
      if (i >= 0) waiting.splice(i, 1);
      return;
    }
    live = Math.max(0, live - 1);
    const next = waiting.shift();
    if (next) next();
  };
}

/** Reveals playing right now (tests). */
export function liveReveals(): number {
  return live;
}

/* ── the phase machine ──────────────────────────────────────────────────── */

export type RevealPhase = 'wait' | 'in' | 'leaving' | 'done';

/** How long the era date stays before kasure (choreography, not a timer the learner races). */
export const REVEAL_HOLD_MS = 2400;
/** Fallback for the kasure's end where animationend never fires (reduced motion, jsdom). */
export const REVEAL_LEAVE_MS = 200;

/** The press / wet-ink verbs for the art box while a reveal plays; none under reduced motion (no press, ink shown dry). */
export const REVEAL_ART_CLASS = 'ink-osu ink-wet is-dry';

export interface MomentE {
  phase: RevealPhase;
  /** The crest / stamp is being revealed: `in` or `leaving`. */
  reveal: boolean;
  /** Classes for the art box while revealing (`REVEAL_ART_CLASS`), none otherwise or under reduced motion. */
  artClass: string | undefined;
  /** `animationend` handler for the leaving caption. */
  onLeaveEnd(e: AnimationEvent): void;
}

/**
 * Moment E for one item. `fresh` is read once, at mount; `onSeen` fires the
 * moment the reveal starts (the item was seen and took a slot) so the host can
 * forget it — a remount mid-reveal never replays, and an item never scrolled to
 * stays fresh for the next open.
 */
export function useMomentE<T extends Element>(ref: RefObject<T>, fresh: boolean, onSeen?: () => void): MomentE {
  const [phase, setPhase] = useState<RevealPhase>(() => (fresh ? 'wait' : 'done'));
  const seen = useReveal(ref, { threshold: 0.5, immediate: !fresh });
  const release = useRef<(() => void) | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const shown = useRef(onSeen);
  shown.current = onSeen;

  // the slot is taken when the item is seen and held until the wet layer has dried (or the host unmounts)
  useEffect(() => {
    if (!seen || phaseRef.current !== 'wait') return;
    release.current = acquireReveal(() => {
      setPhase('in');
      shown.current?.();
    });
    return () => {
      release.current?.();
      release.current = null;
    };
  }, [seen]);

  useEffect(() => {
    if (phase === 'in') {
      const t = setTimeout(() => {
        release.current?.();
        release.current = null;
        setPhase('leaving');
      }, REVEAL_HOLD_MS);
      return () => clearTimeout(t);
    }
    if (phase === 'leaving') {
      const t = setTimeout(() => setPhase('done'), prefersReducedMotion() ? 0 : REVEAL_LEAVE_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [phase]);

  const reveal = phase === 'in' || phase === 'leaving';
  return {
    phase,
    reveal,
    artClass: reveal && !prefersReducedMotion() ? REVEAL_ART_CLASS : undefined,
    onLeaveEnd(e) {
      if (phase === 'leaving' && e.target === e.currentTarget) setPhase('done');
    },
  };
}

/* ── the era gloss ──────────────────────────────────────────────────────── */

const ERAS: readonly { name: string; from: { year: number; month: number; day: number } }[] = [
  { name: S.eraReiwa, from: { year: 2019, month: 5, day: 1 } },
  { name: S.eraHeisei, from: { year: 1989, month: 1, day: 8 } },
  { name: S.eraShowa, from: { year: 1926, month: 12, day: 25 } },
];

/** `Reiwa 8 · Oct 18` for the day `formatEraDate` prints as 令和8年10月18日; the western year before 1926. */
export function eraGloss(day: EpochDay): string {
  const c = dayToCivil(day);
  const mon = S.monthsShort[c.month - 1] ?? '';
  for (const era of ERAS) {
    if (day >= civilToDay(era.from)) return fill(S.eraGloss, { era: era.name, y: c.year - era.from.year + 1, mon, d: c.day });
  }
  return fill(S.eraGlossWestern, { y: c.year, mon, d: c.day });
}

/* ── the colour scheme ──────────────────────────────────────────────────── */

function readScheme(): Theme {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-color-scheme') === 'dark' ? 'dark' : 'light';
}

/** The effective scheme (`theme.ts` writes it before first render), live across moment G. */
export function useColorScheme(): Theme {
  const [scheme, setScheme] = useState<Theme>(readScheme);
  useEffect(() => {
    if (typeof MutationObserver !== 'function' || typeof document === 'undefined') return;
    const mo = new MutationObserver(() => setScheme(readScheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-scheme'] });
    return () => mo.disconnect();
  }, []);
  return scheme;
}
