/**
 * TSUZUKU — 並べ替え Scramble (design 04 §4): English + shuffled bunsetsu
 * tiles → the learner taps (or presses 1–9) to place them in order.
 *
 *  · `params.tiles` are the pieces; the expected order is read from
 *    `params.answer` / `params.sentence` (`orderTiles`: a greedy walk over the
 *    plain sentence) and falls back to the given order. Punctuation never enters
 *    the bank: the trailing run (。！？) is appended for display, an interior
 *    、 (its own tile from `splitBunsetsu`) is dropped — the correct sentence
 *    is revealed through <Ruby> from `params.sentence` anyway.
 *  · The display order comes from `learn.scrambleTiles` seeded with
 *    `store.seed() + today + step.id`, unless the tiles already arrive
 *    shuffled (differ from the expected order), in which case they stay as given.
 *  · Tap a placed piece, Undo or Clear = one "fix" each. Check (Enter or the
 *    button) grades through `gradeOrdering`: first try Good, one fix Hard,
 *    more Again, wrong order Again — every non-clean outcome tagged
 *    `word-order`. `params.accept` lists alternate orders as sentences.
 *  · Hint (the button or the frame's `?` / Hint button) places the next
 *    correct piece (hintUsed → Hard ceiling).
 * Drag-free by design: tap-to-place works on touch and keyboard alike.
 * Facet `grammar:cloze`; keys `choices`.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { toPlain } from '@/content/ruby';
import { scrambleTiles } from '@/learn';
import type { ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { rngFor } from '@/shared/hash';
import { normalizeAnswer, normalizeJa } from '@/shared/jp';
import type { AttemptResult, StepParams } from '@/shared/session-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { Ruby } from '@/shared/ui/Ruby';
import { store } from '@/store';
import { gradeOrdering } from '../check';
import { useFlip } from '../flip';
import { S } from '../strings';
import { S as S2, fill } from './strings-2';
import './Scramble.css';

export const meta: ExerciseMeta = {
  id: 'scramble',
  facet: 'cloze',
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'choices',
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function isPunct(t: string): boolean {
  return normalizeJa(t).length === 0;
}

/** Splits trailing punctuation tiles off the orderable pieces. */
export function splitTail(tiles: readonly string[]): { pieces: string[]; tail: string[] } {
  let end = tiles.length;
  while (end > 0 && isPunct(tiles[end - 1] as string)) end--;
  return { pieces: tiles.slice(0, end), tail: tiles.slice(end) };
}

/**
 * Orders `pieces` so their concatenation reproduces `plain` (longest match
 * first at every step). Returns `null` when the pieces cannot rebuild it.
 */
export function orderTiles(pieces: readonly string[], plain: string): string[] | null {
  const target = normalizeJa(plain);
  const left = pieces.map((t) => ({ t, n: normalizeJa(t) })).filter((x) => x.n.length > 0);
  const out: string[] = [];
  let pos = 0;
  while (pos < target.length) {
    let best = -1;
    for (let i = 0; i < left.length; i++) {
      const c = left[i] as { t: string; n: string };
      if (target.startsWith(c.n, pos) && (best === -1 || c.n.length > (left[best] as { n: string }).n.length)) best = i;
    }
    if (best === -1) return null;
    const picked = left.splice(best, 1)[0] as { t: string; n: string };
    out.push(picked.t);
    pos += picked.n.length;
  }
  return left.length === 0 ? out : null;
}

export interface ScrambleSetup {
  /** Orderable pieces in the expected order. */
  expected: string[];
  /** Trailing punctuation shown after the row. */
  tail: string[];
  /** Indices into `expected`, in the order the bank shows them. */
  order: number[];
  /** Alternate orders from `params.accept`, as one-element tile arrays (compared joined). */
  alternates: string[][];
}

/** Everything the component needs from the params; `rng` seeds the shuffle. */
export function scrambleSetup(params: StepParams, rng: () => number): ScrambleSetup {
  const tiles = (params.tiles ?? []).map((t) => t.trim()).filter((t) => t.length > 0);
  const { pieces: ordered, tail } = splitTail(tiles);
  // interior punctuation (、 mid-sentence) is never a piece: it has no expected slot and would render an empty tile
  const pieces = ordered.filter((t) => !isPunct(t));
  const plain = params.answer ?? (params.sentence ? toPlain(params.sentence) : undefined);
  const expected = (plain ? orderTiles(pieces, plain) : null) ?? pieces.slice();
  const alreadyShuffled = pieces.some((t, i) => t !== expected[i]);
  let shown: string[];
  if (alreadyShuffled) shown = pieces;
  else shown = splitTail(scrambleTiles({ ja: expected.join(''), kana: '', en: '' }, expected, rng)).pieces;
  // map the shown pieces back onto expected indices (duplicates resolve left to right)
  const used = new Set<number>();
  const order = shown.map((t) => {
    const i = expected.findIndex((e, k) => e === t && !used.has(k));
    used.add(i);
    return i;
  });
  const alternates = (params.accept ?? []).map((a) => [a]).filter((a) => normalizeAnswer(a[0] as string).length > 0);
  return { expected, tail, order, alternates };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

type Outcome = { result: AttemptResult; line: string };

export function Scramble(p: ExerciseProps): JSX.Element {
  const { step } = p;
  const setup = useMemo(() => scrambleSetup(step.params, rngFor(store.seed(), store.today(), step.id, 'scramble')), [step.id, step.params]);
  const { expected, tail, order, alternates } = setup;

  const [placed, setPlaced] = useState<number[]>([]);
  const [fixes, setFixes] = useState(0);
  const [hintUsed, setHintUsed] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const startedAt = useRef(store.now());
  const live = useRef({ placed, fixes, hintUsed, outcome });
  live.current = { placed, fixes, hintUsed, outcome };

  useEffect(() => {
    startedAt.current = store.now();
    setPlaced([]);
    setFixes(0);
    setHintUsed(false);
    setOutcome(null);
  }, [step.id]);

  const complete = placed.length === expected.length && expected.length > 0;
  // reorder = FLIP (design 09 §10 C1): the row's pieces glide when one before them is taken out
  const row = useRef<HTMLDivElement>(null);
  useFlip(row, placed.join(','));
  const placedSet = new Set(placed);

  const place = (idx: number): void => {
    const s = live.current;
    if (s.outcome || s.placed.includes(idx) || idx < 0 || idx >= expected.length) return;
    setPlaced([...s.placed, idx]);
  };
  const placeByKey = (bankPos: number): void => {
    const idx = order[bankPos];
    if (idx !== undefined) place(idx);
  };
  const remove = (pos: number): void => {
    const s = live.current;
    if (s.outcome || pos < 0 || pos >= s.placed.length) return;
    setPlaced(s.placed.filter((_, i) => i !== pos));
    setFixes(s.fixes + 1);
  };
  const undo = (): void => remove(live.current.placed.length - 1);
  const clear = (): void => {
    const s = live.current;
    if (s.outcome || s.placed.length === 0) return;
    setPlaced([]);
    setFixes(s.fixes + 1);
  };
  const hint = (): void => {
    const s = live.current;
    if (s.outcome || s.placed.length >= expected.length) return;
    // next correct piece = the first expected index not yet placed, in expected order
    const next = expected.findIndex((_, i) => !s.placed.includes(i));
    if (next === -1) return;
    setPlaced([...s.placed, next]);
    if (!s.hintUsed) {
      setHintUsed(true);
      p.onHint();
    }
  };

  const check = (): void => {
    const s = live.current;
    if (s.outcome || s.placed.length !== expected.length || expected.length === 0) return;
    const given = s.placed.map((i) => expected[i] as string);
    const ms = Math.max(0, store.now() - startedAt.current);
    const r = gradeOrdering(given, expected, { ms, fixes: s.fixes, hintUsed: s.hintUsed, accept: alternates });
    r.answer = [...given, ...tail].join(' ');
    const joined = normalizeAnswer(given.join(''));
    const right = joined === normalizeAnswer(expected.join('')) || alternates.some((a) => joined === normalizeAnswer(a.join('')));
    const line = !right ? S2.wrongOrder : s.fixes === 0 ? S2.firstTry : s.fixes === 1 ? S2.afterFix : S2.manyFixes;
    setOutcome({ result: r, line });
    p.onResult(r);
  };

  const continueEmpty = (): void => {
    if (live.current.outcome) return;
    const r = gradeOrdering([], [], { ms: 0, fixes: 0 });
    r.correct = true;
    setOutcome({ result: r, line: S2.nothingToOrder });
    p.onResult(r);
  };

  useExerciseKeys({ onChoice: placeByKey, onSubmit: check, onHint: !outcome && !complete && expected.length > 0 ? hint : undefined });

  const kind = outcome ? (outcome.result.nearMiss ? 'partial' : outcome.result.correct ? 'correct' : 'wrong') : undefined;

  if (expected.length === 0) {
    return (
      <div class="scramble" data-feel={p.feel}>
        <p class="scramble__empty" role="status">
          {S2.nothingToOrder}
        </p>
        {!outcome ? (
          <button type="button" class="hanko" onClick={continueEmpty}>
            {S.continue}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div class="scramble" data-feel={p.feel} data-done={outcome ? 'true' : undefined}>
      <p class="scramble__prompt">{S2.scramblePrompt}</p>
      {step.params.promptEn ? <p class="scramble__en">{step.params.promptEn}</p> : null}

      <div class="scramble__row status-window" role="group" aria-label={S2.answerRow} data-complete={complete ? 'true' : undefined} ref={row}>
        {placed.length === 0 ? <span class="scramble__placeholder">{S2.emptyRow}</span> : null}
        {placed.map((idx, pos) => (
          <button
            key={idx}
            type="button"
            class="scramble__placed"
            data-flip={idx}
            lang="ja"
            disabled={outcome !== null}
            aria-label={fill(S2.removeTile, { tile: expected[idx] as string })}
            onClick={() => remove(pos)}
          >
            {expected[idx]}
          </button>
        ))}
        {tail.length > 0 ? (
          <span class="scramble__tail" lang="ja" aria-hidden="true">
            {tail.join('')}
          </span>
        ) : null}
      </div>

      <div class="scramble__bank" role="group" aria-label={S2.tileBank}>
        {order.map((idx, bankPos) => {
          const used = placedSet.has(idx);
          return (
            <button
              key={`${bankPos}:${idx}`}
              type="button"
              class="scramble__tile"
              data-used={used ? 'true' : undefined}
              disabled={used || outcome !== null}
              aria-keyshortcuts={bankPos < 9 ? String(bankPos + 1) : undefined}
              aria-label={fill(S2.placeTile, { tile: expected[idx] as string })}
              onClick={() => place(idx)}
            >
              {bankPos < 9 ? (
                <kbd class="scramble__key" aria-hidden="true">
                  {bankPos + 1}
                </kbd>
              ) : null}
              <span lang="ja">{expected[idx]}</span>
            </button>
          );
        })}
      </div>

      {!outcome ? (
        <div class="scramble__controls">
          <button type="button" class="btn btn--ghost btn--sm" onClick={undo} disabled={placed.length === 0}>
            {S2.undo}
          </button>
          <button type="button" class="btn btn--ghost btn--sm" onClick={clear} disabled={placed.length === 0}>
            {S2.clearRow}
          </button>
          <button type="button" class="btn btn--ghost btn--sm" onClick={hint} disabled={complete}>
            {S2.hint}
          </button>
          <button type="button" class="hanko scramble__check" onClick={check} disabled={!complete} aria-keyshortcuts="Enter">
            {S2.check}
          </button>
          <span class="scramble__fixes" aria-live="polite">
            {fixes > 0 ? fill(S2.fixCount, { n: fixes }) : ''}
            {hintUsed ? ` ${S2.hintCeiling}` : ''}
          </span>
        </div>
      ) : (
        <div class="scramble__result reveal ink-nijimi" data-kind={kind} role="status">
          <p class="scramble__line">{outcome.line}</p>
          {!outcome.result.correct || outcome.result.nearMiss ? (
            <p class="scramble__correct">
              <span class="eyebrow">{S2.correctOrder}</span>
              <span class="scramble__sentence">
                {step.params.sentence ? <Ruby ja={step.params.sentence} mode={p.furigana} /> : <span lang="ja">{[...expected, ...tail].join('')}</span>}
              </span>
            </p>
          ) : null}
          {outcome.result.errorTags.length > 0 ? <p class="scramble__why">{S.whyWordOrder}</p> : null}
        </div>
      )}
    </div>
  );
}
