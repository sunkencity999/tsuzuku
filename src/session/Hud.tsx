/**
 * TSUZUKU — `<Hud>`: the session status line above the exercise frame
 * (design 01 §4.4 "Forge Bar", 03 §5, ARCHITECTURE §4).
 *
 * Shows only what `<ExerciseFrame>` does not: the plan's block progress and the
 * Forge Bar (due reviews as a depleting bar labelled 百錬). Ki, combo, the Kiai
 * glow and the speed ring belong to the frame and are never duplicated here.
 *   - Backlog mode replaces the bar with the honest count
 *     ("120 of your 310 reviews today; the rest wait without penalty").
 *   - Zen hides everything but the progress.
 * `plan.steps` should be the runner's live queue (re-queues included) so the
 * counts stay honest; `index` is the runner's cursor into it.
 *
 * Motion (design 09 §5.7, §6.3, §7 J): both bars are `.meter`s whose `--value`
 * hiku-fills (motion.css); the current block's vermilion dot is a real
 * `.hud__dot` that glides from the previous block by FLIP — measured with
 * `getBoundingClientRect` relative to the Hud itself, so a page that scrolled
 * between two commits is not read as movement; transform only, --dur-2 —
 * skipped when nothing moved (jsdom measures zeros) or motion is reduced.
 * The 百錬 label carries its English beside it (the zero-Japanese rule).
 */
import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { SessionBlock, SessionPlan, Step } from '../shared/session-types';
import type { Settings } from '../shared/store-types';
import { prefersReducedMotion } from '../shared/ui/use-reveal';
import { BLOCK_LABEL } from './engine-strings';
import { S, fill } from './strings';
import './Hud.css';

/**
 * FLIP's last two letters: `el` is already in its new place; start it `dx, dy`
 * back (no transition), flush, then let the transform transition to none.
 * Returns whether anything moved.
 */
export function glide(el: HTMLElement, dx: number, dy: number): boolean {
  if (!dx && !dy) return false;
  el.style.transition = 'none';
  el.style.transform = `translate(${dx}px, ${dy}px)`;
  el.getBoundingClientRect();
  el.style.transition = 'transform var(--dur-2) var(--ease)';
  el.style.transform = '';
  const clear = (): void => {
    el.style.transition = '';
    el.removeEventListener('transitionend', clear);
  };
  el.addEventListener('transitionend', clear);
  return true;
}

export interface HudProps {
  plan: SessionPlan;
  index: number;
  feel: Settings['feel'];
  backlog: boolean;
}

/** Steps that are graded reviews (a card behind them). Michikusa and output prompts are not. */
export function reviewSteps(steps: readonly Step[]): Step[] {
  return steps.filter((s) => s.cardKey !== null);
}

/**
 * The block a step belongs to. A runner re-queue (`<id>~+3`, `~recovery`, …)
 * is not in any block's `stepIds`; it inherits the block of its source step.
 */
export function blockIndexOf(plan: SessionPlan, step: Step | undefined): number {
  if (!step) return -1;
  const id = step.id.split('~')[0] as string;
  const i = plan.blocks.findIndex((b) => b.stepIds.includes(step.id) || b.stepIds.includes(id));
  if (i >= 0) return i;
  return plan.blocks.findIndex((b) => b.kind === step.block);
}

export interface BlockProgress {
  block: SessionBlock;
  /** Reps of this block answered so far (live queue, re-queues included). */
  done: number;
  total: number;
  state: 'done' | 'current' | 'next';
}

/** Per-block progress over the live queue. */
export function blockProgress(plan: SessionPlan, index: number): BlockProgress[] {
  const current = blockIndexOf(plan, plan.steps[index]);
  const done = plan.blocks.map(() => 0);
  const total = plan.blocks.map(() => 0);
  plan.steps.forEach((s, si) => {
    const bi = blockIndexOf(plan, s);
    if (bi < 0) return;
    total[bi] = (total[bi] ?? 0) + 1;
    if (si < index) done[bi] = (done[bi] ?? 0) + 1;
  });
  return plan.blocks.map((block, bi) => {
    const t = total[bi] ?? 0;
    const d = done[bi] ?? 0;
    const state: BlockProgress['state'] = bi === current ? 'current' : bi < current || (current < 0 && t > 0 && d === t) ? 'done' : 'next';
    return { block, done: d, total: t, state };
  });
}

const STATE_LABEL: Record<BlockProgress['state'], string> = {
  done: S.blockDone,
  current: S.blockCurrent,
  next: S.blockNext,
};

export function Hud(p: HudProps): JSX.Element {
  const total = p.plan.steps.length;
  const index = Math.max(0, Math.min(p.index, total));
  const zen = p.feel === 'zen';
  const pct = total > 0 ? Math.round((index / total) * 100) : 0;

  const reviews = reviewSteps(p.plan.steps);
  const reviewsLeft = reviews.filter((s) => p.plan.steps.indexOf(s) >= index).length;
  const reviewsTotal = reviews.length;
  const fillPct = reviewsTotal > 0 ? Math.round((reviewsLeft / reviewsTotal) * 100) : 0;

  const blocks = blockProgress(p.plan, index);
  const currentIndex = blocks.findIndex((b) => b.state === 'current');
  const current = currentIndex >= 0 ? blocks[currentIndex] : undefined;

  // The dot's last measured place (relative to the Hud); when the current block changes, the new dot glides from it.
  const hud = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const dotAt = useRef<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = dot.current;
    const prev = dotAt.current;
    const base = hud.current?.getBoundingClientRect();
    const r = el ? el.getBoundingClientRect() : null;
    const next = r ? { left: r.left - (base?.left ?? 0), top: r.top - (base?.top ?? 0) } : null;
    dotAt.current = next;
    if (!el || !prev || !next || prefersReducedMotion()) return;
    glide(el, prev.left - next.left, prev.top - next.top);
  }, [currentIndex]);

  return (
    <div ref={hud} class="hud" data-feel={p.feel} data-backlog={p.backlog ? 'true' : undefined} role="group" aria-label={S.hudLabel}>
      <div class="hud__progress">
        <div
          class="meter hud__bar"
          style={`--value:${pct / 100}`}
          role="progressbar"
          aria-label={S.progressAria}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={index}
          aria-valuetext={fill(S.repOf, { i: Math.min(index + 1, Math.max(total, 1)), n: total })}
        >
          <div class="meter__fill" />
        </div>
        <span class="hud__count" aria-hidden="true">
          {Math.min(index + 1, Math.max(total, 1))} / {total}
        </span>
      </div>

      {!zen && p.plan.blocks.length > 1 ? (
        <ol class="hud__blocks" aria-label={S.blocksAria}>
          {blocks.map((b, i) => (
            <li key={`${b.block.kind}-${i}`} class="hud__block" data-state={b.state} aria-current={b.state === 'current' ? 'step' : undefined}>
              {b.state === 'current' ? <span class="hud__dot" ref={dot} aria-hidden="true" /> : null}
              <span class="hud__block-label">{b.block.label || BLOCK_LABEL[b.block.kind]}</span>
              <span class="sr-only">
                {' '}
                {STATE_LABEL[b.state]}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {!zen && current && current.total > 0 ? (
        <p class="hud__current">{fill(S.blockOf, { label: current.block.label || BLOCK_LABEL[current.block.kind], i: Math.min(current.done + 1, current.total), n: current.total })}</p>
      ) : null}

      {!zen && p.backlog ? (
        <p class="hud__backlog notice" data-testid="backlog-line">
          {fill(S.backlogLine, { shown: p.plan.meta.dueTaken, due: p.plan.meta.dueTotal })}
        </p>
      ) : null}

      {!zen && !p.backlog && reviewsTotal > 0 ? (
        <div
          class="hud__forge"
          role="meter"
          aria-label={S.forgeAria}
          aria-valuemin={0}
          aria-valuemax={reviewsTotal}
          aria-valuenow={reviewsLeft}
          aria-valuetext={reviewsLeft > 0 ? fill(S.forgeLeft, { left: reviewsLeft, total: reviewsTotal }) : S.forgeDone}
        >
          <span class="forge-bar__label" lang="ja">
            {S.forgeLabel}
          </span>
          <span class="eyebrow">{S.forgeEn}</span>
          <div class="meter forge-bar" style={`--value:${fillPct / 100}`}>
            <div class="meter__fill" />
          </div>
          <span class="forge-bar__count" aria-hidden="true">
            {reviewsLeft}
          </span>
        </div>
      ) : null}
    </div>
  );
}
