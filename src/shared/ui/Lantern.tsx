/**
 * TSUZUKU — <Lantern>: one drawn flame everywhere (contract tier, design 09 §5.10).
 *
 * A 20 px inline tongue — a self-contained six-node path whose shape copies
 * `src/art/dojo/flames.ts tongue()` (module-private there; B1 may later export
 * it and point this file at it so hearth and header share one tongue) —
 * coloured by `FlameState` through motion.css's `.lantern[data-state]` rules
 * (`--lantern-tone` on `.lantern__tongue`, `fill: currentColor`) and STATIC: the
 * header is chrome and §6.3 forbids loops there, so the tongue tells its state
 * by colour and by the glow twin's opacity alone (`.lantern::before`, `--glow-kin`
 * at `--lamp-alpha`). Beside it a VISIBLE English state word (`label`) and,
 * visually hidden, the longer sentence (`detail`) — so the shell's last
 * unlabelled Japanese glyph is gone.
 *
 * Store-free and string-free like `TeachOnce`: callers pass their own copy
 * (the shell from `@/i18n/strings`, the End Card from `session/strings`), so a
 * contract-tier file never imports a group's strings. `lanternChips()` turns
 * the forgiveness the streak machine already grants (`freezes`, `restDaysTaken`,
 * `weekly`, `repairWindow`) into chip data; the shell maps it to copy and draws
 * the `.kintsugi` seam only while the repair window is open (§8 ³).
 *
 * `state="unlit"` (`streak.totalDays === 0`): the tongue stays grey and the
 * caller passes "Unlit…" — never "The flame is out." (§7 A ethical line).
 */
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { EpochDay, Streak } from '../store-types';
import type { FlameState } from '@/store/derived';

/*
 * Mirrors of `store/streak.ts` (not contract tier, so not importable here; the
 * contract index re-exports only REPAIR_NEEDED). Lantern.test.tsx asserts both
 * against the originals, so a drift fails loudly.
 */
/** Practice REPAIR_NEEDED of the next REPAIR_WINDOW_DAYS days. */
export const REPAIR_WINDOW_DAYS = 5;
export const REPAIR_NEEDED = 3;

/* ── the tongue ─────────────────────────────────────────────────────────── */

export interface TongueShape {
  cx: number;
  base: number;
  height: number;
  width: number;
  lean: number;
}

/** The header tongue inside a 20 × 20 viewBox. */
export const HEADER_TONGUE: TongueShape = { cx: 10, base: 18, height: 14, width: 9, lean: 1 };

const f = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * Six nodes: move, two quadratic curves (control + end each), close — the same
 * construction as `flames.ts tongue()` (M · Q · Q · Z).
 */
export function tonguePath(s: TongueShape = HEADER_TONGUE): string {
  const { cx, base, height: h, width: w, lean } = s;
  const tipX = cx + lean;
  const tipY = base - h;
  return [
    `M${f(cx - w / 2)} ${f(base)}`,
    `Q${f(cx - w * 0.7)} ${f(base - h * 0.45)} ${f(tipX)} ${f(tipY)}`,
    `Q${f(cx + w * 0.7)} ${f(base - h * 0.45)} ${f(cx + w / 2)} ${f(base)}`,
    'Z',
  ].join(' ');
}

export const TONGUE_PATH = tonguePath();

/* ── forgiveness chips ──────────────────────────────────────────────────── */

export type LanternChipKind = 'freeze' | 'rest' | 'weekly' | 'repair';

export interface LanternChip {
  kind: LanternChipKind;
  /** freeze: tokens held · rest: rest days taken (0 when only the weekday is set) · weekly: weekly flames · repair: days done. */
  n: number;
  /** rest only: a planned rest weekday is set. */
  set?: boolean;
  /** repair only: the window is open, so the chip carries the kintsugi seam. */
  kintsugi?: boolean;
}

export type StreakForgiveness = Pick<Streak, 'freezes' | 'restDaysTaken' | 'weekly'> & Pick<Partial<Streak>, 'repairWindow'>;

/** `true` while `repairWindow` exists and `today` is still inside its five days. */
export function repairOpen(s: Pick<Partial<Streak>, 'repairWindow'>, today: EpochDay): boolean {
  const w = s.repairWindow;
  return w !== undefined && today >= w.start && today <= w.start + REPAIR_WINDOW_DAYS - 1;
}

/**
 * What exists and is invisible today: 氷 tokens held, planned rest, weekly
 * flames, and the open repair window. Nothing for a slice with none of them.
 */
export function lanternChips(o: { streak: StreakForgiveness; today: EpochDay; restDay?: number | null }): LanternChip[] {
  const { streak: s } = o;
  const out: LanternChip[] = [];
  if (s.freezes > 0) out.push({ kind: 'freeze', n: s.freezes });
  const restSet = o.restDay !== undefined && o.restDay !== null;
  if (restSet || s.restDaysTaken > 0) out.push({ kind: 'rest', n: s.restDaysTaken, set: restSet });
  if (s.weekly > 0) out.push({ kind: 'weekly', n: s.weekly });
  const w = s.repairWindow;
  if (w && repairOpen(s, o.today)) out.push({ kind: 'repair', n: w.done, kintsugi: true });
  return out;
}

/* ── component ──────────────────────────────────────────────────────────── */

/** The six flame states plus `unlit`: the never-lit hearth of day one (`streak.totalDays === 0`). */
export type LanternState = FlameState | 'unlit';

export interface LanternProps {
  state: LanternState;
  /** The visible English state word ("Lit", "Embers", …). */
  label: string;
  /** Longer sentence for assistive tech (visually hidden). */
  detail?: string;
  /** Name of the thing ("Tsuzuku Flame"), visually hidden before the word. */
  title?: string;
  /** Pixel size of the tongue (default 20). Set inline, so it beats motion.css's 20 px rule. */
  size?: number;
  class?: string;
  /**
   * Fires when an animation on the lantern ends — the `::before` glow twin's
   * tomosu reports here (its `animationend` targets the owning element), so
   * the caller can drop `.ink-tomosu`. Attached with addEventListener, not a
   * JSX prop: Preact derives the event name from `'onanimationend' in dom`,
   * which jsdom lacks, so the prop would listen for `AnimationEnd` in tests
   * and `animationend` in browsers.
   */
  onAnimationEnd?: (e: AnimationEvent) => void;
}

export function Lantern(p: LanternProps): JSX.Element {
  const size = p.size ?? 20;
  const ref = useRef<HTMLSpanElement>(null);
  const onEnd = useRef(p.onAnimationEnd);
  onEnd.current = p.onAnimationEnd;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: Event): void => onEnd.current?.(e as AnimationEvent);
    el.addEventListener('animationend', handler);
    return () => el.removeEventListener('animationend', handler);
  }, []);
  return (
    <span ref={ref} class={`lantern${p.class ? ` ${p.class}` : ''}`} data-state={p.state}>
      <svg
        class="lantern__tongue"
        viewBox="0 0 20 20"
        width={size}
        height={size}
        style={size === 20 ? undefined : `width:${size}px;height:${size}px`}
        focusable="false"
        aria-hidden="true"
      >
        <path class="lantern__path" d={TONGUE_PATH} fill="currentColor" />
      </svg>
      {p.title ? <span class="visually-hidden">{p.title}: </span> : null}
      <span class="lantern__word">{p.label}</span>
      {p.detail && p.detail !== p.label ? <span class="visually-hidden"> {p.detail}</span> : null}
    </span>
  );
}
