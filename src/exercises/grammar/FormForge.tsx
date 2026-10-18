/**
 * TSUZUKU — 活用鍛造 Form Forge (design 04 §4, `grammar:prod`).
 *
 * Dictionary form + target form label (`params.targetForm`) → type the
 * conjugated form through `<TextAnswer mode="ja">`. Accepted surfaces are
 * `params.answer` + `params.accept` (computed by the runner from
 * `learn/conjugate`), merged with the engine's own `conjugate()` result for a
 * conjugable vocab item: the kanji answer, its kana, and every alternate
 * (ら-dropped potential, short causative …) — a kana answer equals the kanji
 * answer. Exact → Good, a slip → Block, a miss → Again tagged `conjugation`;
 * no particle tolerance. Showing the form's rule first is a hint (Hard
 * ceiling). A form the word lacks (ある → potential) is shown, not tested.
 *
 * On a grammar `prod` card the item is the GrammarItem and the verb the
 * planner picked travels in `params.sentence` (its dictionary form),
 * `params.kana` (its reading), `params.pos` (its part of speech),
 * `params.promptEn` (its gloss + the form) and `params.accepts` (accepted
 * surfaces per form). The head word is derived from them
 * (`head-word.inferHeadWord`: the given pos, else the one pos whose engine
 * answer reproduces `params.answer`), so the engine's kana and alternates
 * are accepted exactly as for a vocab head word; the `accepts` row of the
 * target form is graded as given. The frame's `?` / Hint button shows the
 * form's rule (`useExerciseKeys({ onHint })`, withdrawn once shown).
 */
import type { JSX } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import type { ConjForm } from '@/content/types';
import { conjugate } from '@/learn';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { store } from '@/store';
import { attempt } from '../check';
import { S as SD } from '../strings';
import { TextAnswer, type TextAnswerResult } from '../TextAnswer';
import { type HeadWord, acceptsRow, headWordOf, inferHeadWord, isVocabItem } from './head-word';
import { FORM_HINT, FORM_LABEL, POS_GROUP_LABEL, S, fill } from './strings';
import './grammar.css';

export { headWordOf, inferHeadWord, isVocabItem, type HeadWord } from './head-word';

export const meta: ExerciseMeta = {
  id: 'form-forge',
  facet: 'prod',
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'kana',
};

/**
 * Every surface to accept for `form`: step answer / accept and the form's
 * `params.accepts` row first, then the engine's answer, kana and alternates
 * (adapter for `learn/conjugate.acceptedSurfaces`, which the barrel does not
 * re-export). The first entry is the display form. `null` when nothing can
 * be built; `{ accept: [] }` means the form does not exist.
 */
export function forgeAccept(head: HeadWord | null, form: ConjForm | undefined, params: ExerciseProps['step']['params']): { accept: string[]; defective: boolean } | null {
  const out: string[] = [];
  const push = (s: string | undefined): void => {
    const t = (s ?? '').trim();
    if (t && !out.includes(t)) out.push(t);
  };
  push(params.answer);
  for (const a of params.accept ?? []) push(a);
  if (form) {
    const row = params.forms ? params.forms.indexOf(form) : 0;
    for (const a of acceptsRow(params, row)) push(a);
  }
  let defective = false;
  if (head && form) {
    const c = conjugate(head.word, head.kana, head.pos, form);
    if (c) {
      push(c.answer);
      push(c.answerKana);
      for (const a of c.alt) push(a);
    } else if (out.length === 0) defective = true;
  }
  if (out.length === 0 && !defective) return null;
  return { accept: out, defective };
}

type Phase = 'answer' | 'done';

export function FormForge(p: ExerciseProps): JSX.Element {
  const head = useMemo(() => headWordOf(p.item) ?? inferHeadWord(p.step.params), [p.item, p.step.params]);
  const form = p.step.params.targetForm;
  const built = useMemo(() => forgeAccept(head, form, p.step.params), [head, form, p.step.params]);
  const vocab = isVocabItem(p.item) ? p.item : null;

  const started = useRef(store.now());
  const done = useRef(false);
  const [phase, setPhase] = useState<Phase>('answer');
  const [hintShown, setHintShown] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const elapsed = (): number => Math.max(0, store.now() - started.current);

  const emit = (r: AttemptResult): void => {
    if (done.current) return;
    done.current = true;
    setResult(r);
    setPhase('done');
    p.onResult(r);
  };
  const showHint = (): void => {
    if (hintShown || phase !== 'answer') return;
    setHintShown(true);
    p.onHint();
  };
  const onSubmit = (r: TextAnswerResult): void => {
    emit(attempt({ ms: elapsed(), correct: r.correct, nearMiss: r.nearMiss, hintUsed: hintShown, errorTags: r.tags, answer: r.given }));
  };

  const label = form ? FORM_LABEL[form] : null;
  const fromStep = (p.step.params.sentence ?? '').trim();
  const dictionary = head?.word ?? vocab?.word ?? (fromStep.length > 0 ? fromStep : null);
  const dictionaryKana = head?.kana ?? vocab?.kana ?? ((p.step.params.kana ?? '').trim() || null);
  const gloss = vocab ? (vocab.meanings.length > 0 ? vocab.meanings.join(' · ') : null) : ((p.step.params.promptEn ?? '').trim() || null);
  const testable = !!built && !!form && !!label && built.accept.length > 0;

  // The frame's `?` / Hint button shows the form's rule; withdrawn once shown or when nothing is tested.
  useExerciseKeys({ onHint: testable && phase === 'answer' && !hintShown ? showHint : undefined });

  if (!built || !form || !label || built.accept.length === 0) {
    const defective = Boolean(built?.defective);
    return (
      <div class="gr gr-forge" data-state={defective ? 'defective' : 'unavailable'}>
        <div class="gr__reveal reveal ink-nijimi" data-kind="info" role="status">
          <p>{defective ? S.forgeNoForm : S.cannotBuild}</p>
          {dictionary ? (
            <p>
              <span class="eyebrow">{S.forgeDictionary}</span> <span lang="ja">{dictionary}</span>
              {dictionaryKana && dictionaryKana !== dictionary ? (
                <>
                  {' '}
                  <span class="gr__word-kana" lang="ja">
                    {dictionaryKana}
                  </span>
                </>
              ) : null}
              {label ? (
                <>
                  {' '}
                  <span class="eyebrow">{S.forgeTarget}</span> <span>{label}</span>
                </>
              ) : null}
            </p>
          ) : null}
          <p class="gr__why">{S.shownNotTested}</p>
        </div>
        <div class="gr__actions">
          <button type="button" class="hanko" onClick={() => emit(attempt({ ms: elapsed(), correct: true, hintUsed: true }))}>
            {S.continue}
          </button>
        </div>
      </div>
    );
  }

  const revealed = phase === 'done';
  const kind = result ? (result.nearMiss ? 'partial' : result.correct ? 'correct' : 'wrong') : 'info';

  return (
    <div class="gr gr-forge" data-phase={phase} data-form={form}>
      <p class="gr__prompt">{fill(S.forgePrompt, { form: label })}</p>
      <div class="gr__word">
        <span class="eyebrow">{S.forgeDictionary}</span>
        <span class="gr__word-ja" lang="ja" data-dictionary="true">
          {dictionary ?? '—'}
        </span>
        {dictionaryKana && dictionaryKana !== dictionary ? (
          <span class="gr__word-kana" lang="ja">
            {dictionaryKana}
          </span>
        ) : null}
        {head ? <span class="gr__gloss">{POS_GROUP_LABEL[head.pos]}</span> : null}
        {gloss ? (
          <span class="gr__gloss" data-gloss="true">
            {gloss}
          </span>
        ) : null}
      </div>
      <p class="gr__gloss">
        <span class="eyebrow">{S.forgeTarget}</span> <span class="gr__target" data-target-form="true">{label}</span>
      </p>

      {phase === 'answer' ? (
        <div class="gr__actions">
          {hintShown ? null : (
            <button type="button" class="btn btn--ghost" onClick={showHint}>
              {S.forgeShowRule}
            </button>
          )}
        </div>
      ) : null}
      {hintShown && phase === 'answer' ? (
        <div class="gr__reveal reveal ink-nijimi" data-kind="info" data-hint="true">
          <p>
            <span class="eyebrow">{S.forgeRule}</span> <span>{FORM_HINT[form]}</span>
          </p>
          <p class="gr__why">{S.hintUsedNote}</p>
        </div>
      ) : null}

      <TextAnswer mode="ja" accept={built.accept} onSubmit={onSubmit} autoFocus label={SD.answerField} particleSlip={false} kanaOnlyPolicy="good" missTags={['conjugation']} />

      {revealed ? (
        <div class="gr__reveal reveal ink-nijimi" data-kind={kind}>
          <p>
            <span class="eyebrow">{S.forgeTarget}</span> <span>{label}</span>
          </p>
          {result && !result.correct ? (
            <p class="gr__why" data-rule="true">
              {FORM_HINT[form]}
            </p>
          ) : null}
          <p class="gr__why">{S.kanaAccepted}</p>
        </div>
      ) : null}
    </div>
  );
}
