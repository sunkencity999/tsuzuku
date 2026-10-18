/**
 * TSUZUKU — <Ticker>: numbers that count (contract tier, design 09 §5.8).
 *
 * `<Ticker value={n} format={fmt} />` renders the FINAL digits in the DOM at
 * once (`.ticker__value`: screen readers and tests read the real number) and,
 * when the value changes, rolls a visual twin (`.ticker__roll`, aria-hidden,
 * laid over the value) from the previous value under ONE shared
 * requestAnimationFrame scheduler over ≤ `TICKER_MAX_MS` on an ease-out, in
 * tabular figures. It announces nothing itself: the surrounding live region
 * announces once. `roll` adds `data-roll` for the Kage cabinet's per-column
 * translateY (its CSS belongs to the Kage surface).
 *
 * Reduced motion (`prefersReducedMotion()`): the value is set at once — no
 * rAF is ever requested, no twin, no fade (the number simply reads its new
 * value; a fade would need a stylesheet rule this self-contained component
 * does not carry). The scheduler never runs while `document.hidden`: pending
 * rolls snap to their final value instead (§6.7 rule 5).
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { prefersReducedMotion } from './use-reveal';

/** Longest roll (design 09 §5.8). */
export const TICKER_MAX_MS = 400;
/** Shortest roll for a one-step change. */
export const TICKER_MIN_MS = 160;

/* ── one shared frame scheduler ─────────────────────────────────────────── */

/** A frame job: receives the frame time, returns `false` when finished. */
export type FrameJob = (now: number) => boolean;

const jobs = new Set<FrameJob>();
let handle: number | null = null;

function hidden(): boolean {
  return typeof document !== 'undefined' && document.hidden === true;
}

function frame(now: number): void {
  handle = null;
  for (const job of Array.from(jobs)) {
    let keep = false;
    try {
      keep = job(now);
    } catch {
      keep = false;
    }
    if (!keep) jobs.delete(job);
  }
  if (jobs.size > 0) pump();
}

function pump(): void {
  if (handle !== null || jobs.size === 0) return;
  if (hidden() || typeof requestAnimationFrame !== 'function') {
    // No frames while the tab is hidden (or without rAF): every job finishes now.
    for (const job of Array.from(jobs)) {
      try {
        job(Number.POSITIVE_INFINITY);
      } catch {
        /* a broken job never blocks the others */
      }
      jobs.delete(job);
    }
    return;
  }
  handle = requestAnimationFrame(frame);
}

/** Runs `job` once per frame until it returns `false`. Returns a canceller. */
export function scheduleFrame(job: FrameJob): () => void {
  jobs.add(job);
  pump();
  return () => {
    jobs.delete(job);
  };
}

/** Pending jobs (tests). */
export function activeFrameJobs(): number {
  return jobs.size;
}

/** Drops every job without finishing it (tests). */
export function resetFrameSchedulerForTests(): void {
  jobs.clear();
  if (handle !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  handle = null;
}

/** `--ease-out` (0, 0, .2, 1) approximated for script: a cubic ease-out. */
export function easeOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

/** Roll length for a change of `delta` steps: 160 ms for one step, 400 ms from ten. */
export function tickerDuration(delta: number): number {
  const steps = Math.min(10, Math.max(1, Math.abs(delta)));
  return Math.round(TICKER_MIN_MS + ((TICKER_MAX_MS - TICKER_MIN_MS) * (steps - 1)) / 9);
}

/* ── component ──────────────────────────────────────────────────────────── */

export interface TickerProps {
  value: number;
  /** Digits → text (default: `Math.round(n)` as a string). */
  format?: (n: number) => string;
  /** Roll length in ms, capped at `TICKER_MAX_MS` (default: by delta). */
  duration?: number;
  class?: string;
  /** Kage cabinet: `data-roll` for the per-column translateY. */
  roll?: boolean;
}

const defaultFormat = (n: number): string => String(Math.round(n));

const BASE_STYLE = 'position:relative;display:inline-block;font-variant-numeric:tabular-nums';
const ROLL_STYLE = 'position:absolute;inset:0;pointer-events:none';

export function Ticker(p: TickerProps): JSX.Element {
  const format = p.format ?? defaultFormat;
  const [ticking, setTicking] = useState(false);
  const prev = useRef<number | null>(null);
  const rollRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const from = prev.current;
    prev.current = p.value;
    // First paint, no change, or reduced motion: the final value stands at once (a same-value set is a no-op in Preact).
    if (from === null || from === p.value || prefersReducedMotion()) {
      setTicking(false);
      return;
    }
    const to = p.value;
    const total = Math.min(TICKER_MAX_MS, Math.max(0, p.duration ?? tickerDuration(to - from)));
    let start: number | null = null;
    setTicking(true);
    const cancel = scheduleFrame((now) => {
      if (start === null) start = now;
      const t = total <= 0 || !Number.isFinite(now) ? 1 : Math.min(1, (now - start) / total);
      const el = rollRef.current;
      if (el) el.textContent = format(from + (to - from) * easeOut(t));
      if (t < 1) return true;
      setTicking(false);
      return false;
    });
    return cancel;
  }, [p.value]);

  return (
    <span class={`ticker${p.class ? ` ${p.class}` : ''}`} style={BASE_STYLE} data-ticking={ticking ? '' : undefined} data-roll={p.roll ? '' : undefined}>
      <span class="ticker__value" style={ticking ? 'opacity:0' : undefined}>
        {format(p.value)}
      </span>
      {ticking ? <span class="ticker__roll" aria-hidden="true" style={ROLL_STYLE} ref={rollRef} /> : null}
    </span>
  );
}
