/**
 * TSUZUKU — 目付 Meaning Judge (design 04 §2, 05 §6): the word → recall the
 * meaning silently → Reveal shows the J-J definition (`definitionJa`; the
 * English sits behind a tap; without a definition the English stands in,
 * said plainly) → self-rate Again / Hard / Good (keys 1–3, Enter reveals).
 * During recall the frame's `?` / Hint button shows the reading under the
 * word while it is hidden — the same hint as a fog tap (Hard ceiling).
 *
 * Judge mechanic: a deterministic sample of self-rated Goods —
 * `shouldJudge(seed, cardKey, reps, judgeRate(honesty, checks))`, 25 % at
 * Honesty ≥ 95 %, 50 % at 90–95 %, 100 % below 90 % and for the first 20
 * checks — gets a 4-option verification through `requestJudge`
 * (`learn/judge.judgeOptions`: the meaning, one confusable, two same-POS
 * distractors). Failing forces `selfRating: 1`; passing keeps 3. The sample
 * is the same function the runner uses, so the two agree.
 * Latency = time to Reveal. Opt-in from Station 34; speed never applies.
 */
import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { CardKey } from '@/content/types';
import type { AttemptResult, ExerciseMeta, ExerciseProps, JudgeRequest } from '@/shared/exercise-types';
import { rngFor } from '@/shared/hash';
import { Ruby } from '@/shared/ui/Ruby';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { judgeOptions, judgeRate, shouldJudge } from '@/learn';
import { store } from '@/store';
import { attempt } from '../check';
import { S as X } from '../strings';
import { MissingItem, missingResult, useLatency } from '../kana/KanaFlash';
import { VocabAfter, WordHead, isVocabItem, readingHidden, vocabPoolFrom } from './MeaningGuard';
import { S } from './strings';
import './vocab.css';

export const meta: ExerciseMeta = {
  id: 'meaning-judge',
  facet: 'rec',
  needsTts: false,
  needsStt: false,
  selfGraded: true,
  timeable: false,
  keys: 'choices',
};

type SelfRating = 1 | 2 | 3;

/** Should this self-rated Good be verified? Same inputs as the runner's `judgeNeeded`. */
export function judgeSampled(cardKey: CardKey | null, stepId: string): boolean {
  const stats = store.stats.value;
  const rate = judgeRate(stats.judgeChecks > 0 ? stats.honesty : null, stats.judgeChecks);
  const key = cardKey ?? (stepId as CardKey);
  const reps = cardKey ? (store.cards.get(cardKey)?.[3] ?? 0) : 0;
  return shouldJudge(store.seed(), key, reps, rate);
}

/** The self-rating as an `AttemptResult` (Again → wrong, Hard → Block, Good → correct). */
export function selfRated(rating: SelfRating, ctx: { ms: number; hintUsed?: boolean }): AttemptResult {
  return attempt({ ms: ctx.ms, hintUsed: Boolean(ctx.hintUsed), correct: rating >= 2, nearMiss: rating === 2, selfRating: rating });
}

export function MeaningJudge(p: ExerciseProps): JSX.Element {
  return <MeaningJudgeBody key={p.step.id} {...p} />;
}

type Phase = 'recall' | 'rate' | 'judging' | 'done';

function MeaningJudgeBody(p: ExerciseProps): JSX.Element {
  const item = isVocabItem(p.item) ? p.item : null;
  const ms = useLatency(p.step.id);
  const [phase, setPhase] = useState<Phase>('recall');
  const [en, setEn] = useState(false);
  const [rated, setRated] = useState<SelfRating | null>(null);
  const [judge, setJudge] = useState<'pass' | 'fail' | null>(null);
  const [done, setDone] = useState<AttemptResult | null>(null);
  const phaseRef = useRef<Phase>('recall');
  phaseRef.current = phase;
  const recallMs = useRef(0);
  const hinted = useRef(false);
  const [hintTaken, setHintTaken] = useState(false);
  const [readingShown, setReadingShown] = useState(false);
  const fired = useRef(false);
  const def = item?.definitionJa;

  const finish = (r: AttemptResult): void => {
    if (fired.current) return;
    fired.current = true;
    setDone(r);
    setPhase('done');
    p.onResult(r);
  };

  const reveal = (): void => {
    if (phaseRef.current !== 'recall' || !item) return;
    recallMs.current = ms();
    setPhase('rate');
  };

  const rate = (r: SelfRating): void => {
    if (phaseRef.current !== 'rate' || !item) return;
    setRated(r);
    if (r < 3 || !judgeSampled(p.step.cardKey, p.step.id)) {
      finish(selfRated(r, { ms: recallMs.current, hintUsed: hinted.current }));
      return;
    }
    setPhase('judging');
    const rng = rngFor(store.seed(), store.today(), p.step.id, 'judge');
    const req: JudgeRequest = judgeOptions(item, vocabPoolFrom(item, p.step.params), rng);
    p.requestJudge(req)
      .then((pass) => {
        setJudge(pass ? 'pass' : 'fail');
        finish(selfRated(pass ? 3 : 1, { ms: recallMs.current, hintUsed: hinted.current }));
      })
      .catch(() => {
        // the card could not be shown: the learner's own rating stands
        finish(selfRated(3, { ms: recallMs.current, hintUsed: hinted.current }));
      });
  };

  /** A fogged reading tapped open: the hint is taken (Hard ceiling). */
  const hint = (): void => {
    if (hinted.current || fired.current) return;
    hinted.current = true;
    setHintTaken(true);
    p.onHint();
  };
  /** The frame's `?` / Hint button during recall: show the reading under the word — the same hint as a fog tap. */
  const showReading = (): void => {
    if (hinted.current || fired.current || phaseRef.current !== 'recall') return;
    setReadingShown(true);
    hint();
  };
  const canShowReading = !!item && phase === 'recall' && !hintTaken && readingHidden(item, p.furigana);

  useExerciseKeys({
    onSubmit: reveal,
    onChoice: (i) => {
      if (i === 0 || i === 1 || i === 2) rate((i + 1) as SelfRating);
    },
    onHint: canShowReading ? showReading : undefined,
  });

  if (!item) return <MissingItem onContinue={() => finish(missingResult(ms()))} />;

  const ratings: { r: SelfRating; label: string }[] = [
    { r: 1, label: X.rateAgain },
    { r: 2, label: X.rateHard },
    { r: 3, label: X.rateGood },
  ];
  const locked = phase === 'judging' || phase === 'done';

  return (
    <div class="drill meaning-judge" data-exercise="meaning-judge" data-phase={phase}>
      <p class="drill__prompt">{phase === 'recall' ? X.recallSilently : X.rateYourself}</p>
      <WordHead item={item} mode={p.furigana} onReveal={hint} kana={phase !== 'recall' || readingShown} />

      {phase === 'recall' ? (
        <div class="drill__row">
          <button type="button" class="hanko" onClick={reveal} aria-keyshortcuts="Enter">
            {X.reveal}
          </button>
          <span class="drill__hint">{S.revealHint}</span>
        </div>
      ) : (
        <div class="drill__after vocab__after" data-correct={done ? (done.correct ? (done.nearMiss ? 'near' : 'true') : 'false') : undefined}>
          {def ? (
            <div>
              <span class="eyebrow">{S.jjLabel}</span>
              <p class="vocab__definition">
                <Ruby ja={def.ja} mode={p.furigana} />
              </p>
              <button type="button" class="btn btn--ghost btn--sm" aria-pressed={en} onClick={() => setEn((v) => !v)}>
                {en ? S.hideEnglish : X.showEnglish}
              </button>
              {en ? <p class="vocab__meaning-en">{item.meanings.join(' · ')}</p> : null}
            </div>
          ) : (
            <p class="vocab__meaning-en">
              <span class="eyebrow">{S.meaningLabel}</span> <span>{item.meanings.join(' · ')}</span>
              <span class="drill__hint"> · {S.noDefinition}</span>
            </p>
          )}
        </div>
      )}

      {phase !== 'recall' ? (
        <div>
          <div class="drill__row drill__row--between">
            <span class="eyebrow">{S.rateLabel}</span>
            <span class="drill__hint">{S.rateHint}</span>
          </div>
          <div class="judge-rate" role="group" aria-label={S.rateLabel}>
            {ratings.map((o) => (
              <button
                key={o.r}
                type="button"
                class="judge-rate__btn"
                data-rating={o.r}
                aria-pressed={rated === o.r}
                aria-keyshortcuts={String(o.r)}
                disabled={locked}
                onClick={() => rate(o.r)}
              >
                <kbd class="judge-rate__key" aria-hidden="true">
                  {o.r}
                </kbd>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {phase === 'judging' ? (
        <p class="drill__hint" role="status">
          {S.judgeWaiting}
        </p>
      ) : null}
      {judge ? (
        <p class="drill__prompt" role="status" data-judge={judge}>
          {judge === 'pass' ? S.judgePassed : S.judgeFailed}
        </p>
      ) : null}
      {done && !judge ? (
        <p class="drill__hint" role="status">
          {rated === 1 ? S.ratedAgain : rated === 2 ? S.ratedHard : S.ratedGood}
        </p>
      ) : null}

      {done ? <VocabAfter item={item} correct={done.correct ? (done.nearMiss ? 'near' : 'true') : 'false'} jj={false} furigana={p.furigana} meaning={false} /> : null}
    </div>
  );
}
