/**
 * TSUZUKU — 部品 Component Flash (design 04 §3, `component:rec`).
 *
 * The component glyph (plus its variant glyphs) → its canonical keyword.
 * First two exposures: four keyword choices (`params.choices`, the answer
 * among them); afterwards the keyword is typed and graded with `fuzzyEn`
 * through `<TextAnswer>`. An "I meant that" override reports
 * `correct:true, selfRating:3`, and when three distractors are at hand the
 * Judge is asked right away (design 05 §6). The `hint` is the writer's
 * visual cue; showing it before answering counts as a hint (Hard ceiling);
 * the frame's `?` / Hint button shows it too.
 * Latency is measured with `store.now()` from mount to the answer.
 */
import type { JSX } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentDef, ContentItem } from '@/content/types';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { normalizeEn } from '@/shared/jp';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { store } from '@/store';
import { ChoiceGrid } from '../ChoiceGrid';
import { attempt, gradeChoice, gradeEn } from '../check';
import { S as SD } from '../strings';
import { TextAnswer, type TextAnswerResult } from '../TextAnswer';
import { S } from './strings';
import './kanji.css';

export const meta: ExerciseMeta = {
  id: 'component-flash',
  facet: 'rec',
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'text',
};

/** Multiple choice only for a card's first two exposures (design 04 §0). */
export const CHOICE_EXPOSURES = 2;

export function isComponentDef(i: ContentItem | null | undefined): i is ComponentDef {
  return !!i && 'char' in i && 'name' in i && !('strokes' in i) && !('meanings' in i);
}

/** Three distinct distractors for the Judge, or `null` when the choices cannot supply them. */
export function judgeDistractors(answer: string, choices: readonly string[] | undefined): [string, string, string] | null {
  if (!choices) return null;
  const key = normalizeEn(answer);
  const out: string[] = [];
  const seen = new Set<string>([key]);
  for (const c of choices) {
    const k = normalizeEn(c);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length === 3) return [out[0] as string, out[1] as string, out[2] as string];
  }
  return null;
}

type Phase = 'answer' | 'done';

export function ComponentFlash(p: ExerciseProps): JSX.Element {
  const def = isComponentDef(p.item) ? p.item : null;
  const keyword = (p.step.params.answer ?? def?.name ?? '').trim();
  const accept = useMemo(() => {
    const out = [keyword, ...(p.step.params.accept ?? [])].map((s) => s.trim()).filter(Boolean);
    return Array.from(new Set(out));
  }, [keyword, p.step.params.accept]);
  const choices = p.step.params.choices;
  const correctIdx = useMemo(() => (choices ? choices.findIndex((c) => normalizeEn(c) === normalizeEn(keyword)) : -1), [choices, keyword]);
  const useChoices = p.exposures < CHOICE_EXPOSURES && !!choices && choices.length >= 2 && correctIdx >= 0;

  const started = useRef(store.now());
  const done = useRef(false);
  const [phase, setPhase] = useState<Phase>('answer');
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const [hintShown, setHintShown] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);

  const emit = (r: AttemptResult): void => {
    if (done.current) return;
    done.current = true;
    setResult(r);
    setPhase('done');
    p.onResult(r);
  };
  const elapsed = (): number => Math.max(0, store.now() - started.current);

  const showHint = (): void => {
    if (hintShown || phase !== 'answer') return;
    setHintShown(true);
    p.onHint();
  };
  // The frame's `?` / Hint button shows the writer's cue (hint-only set: ChoiceGrid / TextAnswer keep their keys).
  useExerciseKeys({ onHint: def?.hint && phase === 'answer' && !hintShown ? showHint : undefined });

  const onPick = (i: number): void => {
    if (picked !== undefined || phase !== 'answer') return;
    setPicked(i);
    emit(gradeChoice(i, correctIdx, { ms: elapsed(), hintUsed: hintShown, missTags: ['kanji-meaning'], answer: choices?.[i] }));
  };

  const onTyped = (r: TextAnswerResult): void => {
    const ms = elapsed();
    if (r.override) {
      const base = gradeEn(r.given, accept, { ms, hintUsed: hintShown, override: true });
      const distractors = judgeDistractors(keyword, choices);
      if (distractors) {
        void p.requestJudge({ correct: keyword, distractors }).then(() => emit(base), () => emit(base));
        return;
      }
      emit(base);
      return;
    }
    emit(gradeEn(r.given, accept, { ms, hintUsed: hintShown, missTags: ['kanji-meaning'] }));
  };

  if (!def || keyword.length === 0) {
    return (
      <div class="kj kj-flash" data-state="unavailable">
        <div class="kj__reveal reveal ink-nijimi" data-kind="info" role="status">
          <p>{S.cannotBuild}</p>
          <p class="kj__why">{S.shownNotTested}</p>
        </div>
        <div class="kj__actions">
          <button type="button" class="hanko" onClick={() => emit(attempt({ ms: elapsed(), correct: true, hintUsed: true }))}>
            {S.continue}
          </button>
        </div>
      </div>
    );
  }

  const revealKind = result ? (result.correct ? (result.selfRating !== undefined ? 'partial' : 'correct') : 'wrong') : 'info';

  return (
    <div class="kj kj-flash" data-phase={phase} data-mode={useChoices ? 'choices' : 'typed'}>
      <p class="kj__prompt">{useChoices ? S.componentPromptChoices : S.componentPromptTyped}</p>
      <div class="kj__glyph" lang="ja" role="img" aria-label={S.componentGlyph}>
        {def.char}
      </div>
      {def.variants && def.variants.length > 0 ? (
        <dl class="kj__meta">
          <dt>{S.componentVariants}</dt>
          <dd lang="ja">{def.variants.join('　')}</dd>
        </dl>
      ) : null}

      {def.hint && phase === 'answer' ? (
        <div class="kj__actions">
          {hintShown ? (
            <p class="kj__gloss" data-hint="true">
              {def.hint}
            </p>
          ) : (
            <button type="button" class="btn btn--ghost" onClick={showHint}>
              {S.componentShowHint}
            </button>
          )}
        </div>
      ) : null}
      {hintShown && phase === 'answer' ? <p class="kj__why">{S.hintUsedNote}</p> : null}

      {useChoices ? (
        <ChoiceGrid choices={choices as string[]} onPick={onPick} picked={picked} correct={correctIdx} label={S.componentKeyword} />
      ) : (
        <TextAnswer accept={accept} onSubmit={onTyped} autoFocus label={S.componentKeyword} missTags={['kanji-meaning']} />
      )}

      {phase === 'done' ? (
        <div class="kj__reveal reveal ink-nijimi" data-kind={revealKind}>
          <p>
            <span class="eyebrow">{S.componentKeyword}</span> <strong data-keyword="true">{keyword}</strong>
          </p>
          {def.hint ? (
            <p data-hint="true">
              <span class="eyebrow">{S.componentHint}</span> <span>{def.hint}</span>
            </p>
          ) : null}
          {result && result.correct && result.selfRating !== undefined ? <p class="kj__why">{SD.overrideLogged}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
