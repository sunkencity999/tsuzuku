/**
 * TSUZUKU — `<JudgeCard>`: the 目付 (Metsuke) verification card (design 05 §6, 01 §4.4).
 *
 * Three shapes, resolved through `onPick(pass)` (the host wraps it in the
 * Promise `requestJudge` returns):
 *   meaning     correct + 3 distractors in a seeded order (`rng`); pick → pass
 *               iff it is the correct meaning. Digits 1–4 work through the
 *               enclosing frame (`useExerciseKeys`).
 *   rubric      "Does your sentence contain X? Show it": the learner's
 *               `answer` with `regex` matches highlighted; はい passes only
 *               when the regex really matches, いいえ fails (honest, still Again).
 *   perception  minimal pair after TTS (`heard` = the index the host played);
 *               pick → pass iff it is the one heard. Space replays via the frame.
 * `onPick` fires once. The host supplies `answer` / `heard`, which the
 * `JudgeRequest` from the exercise does not carry. The card is a
 * `role="dialog"` with `tabIndex={-1}` and takes focus when it mounts, so the
 * 目付 title and prompt are read before the options; hosts need not focus it.
 * It enters as `.ink-nijimi` from the right (`--from: 24px 0`, design 09 §6.2)
 * on a plain `.judge-card__wrap`: the `.status-window` card inside is clipped
 * and is never transformed itself (§6.7 rule 7).
 */
import type { JSX } from 'preact';
import { useEffect, useId, useMemo, useRef } from 'preact/hooks';
import { shuffle } from '../hash';
import { containsJapanese } from '../jp';
import { useExerciseKeys } from './ExerciseFrame';
import { S } from './strings';
import './ui.css';

export type JudgeShape =
  | { correct: string; distractors: [string, string, string] }
  | { rubric: string; regex: string; answer: string }
  | { minimalPair: [string, string]; heard: 0 | 1 };

export type JudgeCardProps = JudgeShape & {
  rng: () => number;
  onPick(pass: boolean): void;
  /** Perception shape: replay the key word. */
  onReplay?(): void;
};

/** Compiles the rubric regex; an invalid pattern degrades to a literal substring test. */
export function rubricMatches(answer: string, regex: string): { ok: boolean; ranges: [number, number][] } {
  const ranges: [number, number][] = [];
  try {
    const re = new RegExp(regex, 'gu');
    for (const m of answer.matchAll(re)) {
      const idx = m.index ?? 0;
      if (m[0].length === 0) break;
      ranges.push([idx, idx + m[0].length]);
    }
  } catch {
    let from = 0;
    while (regex.length > 0) {
      const i = answer.indexOf(regex, from);
      if (i < 0) break;
      ranges.push([i, i + regex.length]);
      from = i + regex.length;
    }
  }
  return { ok: ranges.length > 0, ranges };
}

function highlight(answer: string, ranges: [number, number][]): JSX.Element[] {
  const out: JSX.Element[] = [];
  let last = 0;
  ranges.forEach(([a, b], i) => {
    if (a > last) out.push(<span key={`t${i}`}>{answer.slice(last, a)}</span>);
    out.push(<mark key={`m${i}`}>{answer.slice(a, b)}</mark>);
    last = b;
  });
  if (last < answer.length) out.push(<span key="tail">{answer.slice(last)}</span>);
  return out;
}

export function JudgeCard(p: JudgeCardProps): JSX.Element {
  const id = useId();
  const done = useRef(false);
  const rootRef = useRef<HTMLElement>(null);
  // Imperative: a dynamic `autofocus` is ignored once the document has focused anything.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);
  const pick = (pass: boolean): void => {
    if (done.current) return;
    done.current = true;
    p.onPick(pass);
  };

  // Seeded option order, fixed for the card's lifetime.
  const options = useMemo<string[]>(() => {
    if ('correct' in p) return shuffle(p.rng, [p.correct, ...p.distractors]);
    if ('minimalPair' in p) return shuffle(p.rng, p.minimalPair);
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (i: number): void => {
    const opt = options[i];
    if (opt === undefined) return;
    if ('correct' in p) pick(opt === p.correct);
    else if ('minimalPair' in p) pick(opt === p.minimalPair[p.heard]);
  };

  useExerciseKeys({
    onChoice: (i) => {
      if ('rubric' in p) {
        if (i === 0) pick(rubricMatches(p.answer, p.regex).ok);
        else if (i === 1) pick(false);
        return;
      }
      choose(i);
    },
    onReplay: () => p.onReplay?.(),
  });

  const title = (
    <h3 class="judge-card__title" id={`${id}-t`}>
      <span lang="ja">目付</span>
      <span>{S.judgeTitle}</span>
    </h3>
  );

  if ('rubric' in p) {
    const m = rubricMatches(p.answer, p.regex);
    return (
      <div class="judge-card__wrap ink-nijimi" style="--from: 24px 0">
        <aside ref={rootRef} tabIndex={-1} class="judge-card status-window" role="dialog" aria-labelledby={`${id}-t`} data-shape="rubric">
          {title}
          <p class="judge-card__line">{S.judgeLine}</p>
          <p class="judge-card__prompt">
            {S.judgeRubricPrompt} <strong lang={containsJapanese(p.rubric) ? 'ja' : undefined}>{p.rubric}</strong>
          </p>
          <p class="judge-card__answer" lang="ja">
            {highlight(p.answer, m.ranges)}
          </p>
          <div class="judge-card__actions">
            <button type="button" class="btn" data-verdict="yes" onClick={() => pick(m.ok)}>
              <kbd>1</kbd>
              <span lang="ja">はい</span> {S.judgeYes}
            </button>
            <button type="button" class="btn btn--ghost" data-verdict="no" onClick={() => pick(false)}>
              <kbd>2</kbd>
              <span lang="ja">いいえ</span> {S.judgeNo}
            </button>
          </div>
        </aside>
      </div>
    );
  }

  const perception = 'minimalPair' in p;
  return (
    <div class="judge-card__wrap ink-nijimi" style="--from: 24px 0">
      <aside
        ref={rootRef}
        tabIndex={-1}
        class="judge-card status-window"
        role="dialog"
        aria-labelledby={`${id}-t`}
        data-shape={perception ? 'perception' : 'meaning'}
      >
        {title}
        <p class="judge-card__line">{S.judgeLine}</p>
        <p class="judge-card__prompt">{perception ? S.judgePairPrompt : S.judgeMeaningPrompt}</p>
        <ol class="judge-card__options">
          {options.map((opt, i) => (
            <li key={i}>
              <button type="button" class="judge-card__option" data-index={i} onClick={() => choose(i)}>
                <kbd>{i + 1}</kbd>
                <span lang={containsJapanese(opt) ? 'ja' : undefined}>{opt}</span>
              </button>
            </li>
          ))}
        </ol>
        {perception && p.onReplay ? (
          <div class="judge-card__actions">
            <button type="button" class="btn btn--ghost" onClick={() => p.onReplay?.()} aria-keyshortcuts="Space">
              {S.replay}
              <kbd>Space</kbd>
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
