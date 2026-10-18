/**
 * TSUZUKU — `<TextAnswer>`: the typed-answer widget (design 04 §0, §2).
 *
 * Two modes, one result shape:
 *  · `en` (default) — a plain English field graded with `fuzzyEn` (articles
 *    and a leading "to" stripped; Levenshtein ≤ 1 on ≥ 5 chars, ≤ 2 on ≥ 9).
 *    On a miss the correct gloss is shown with 「I meant that」: the override
 *    reports `override: true` (the exercise then sends `correct: true,
 *    selfRating: 3`, see `gradeEn`, so the Judge may sample it). The honest
 *    default — Enter, or the focused button — is 「No. Mark it.」.
 *  · `ja` — `<KanaInput>` (romaji → kana IME, katakana mode, Space cycles
 *    kanji `candidates`) graded with `checkJa`: equivalence first (づ/ず,
 *    long vowels, katakana fold), then particle slip, then `nearMissKind`
 *    for Block feedback; the diff against the expected form is shown inline.
 *    Candidates behave like an IME conversion: they are handed to the field
 *    only while the typed kana reads as `candidateReading` (or the field
 *    already shows one of them, so cycling back works); otherwise Space is a
 *    plain character and no kanji is offered. Without a reading, candidates
 *    never cycle from kana.
 *
 * `onSubmit` fires exactly once per widget life; `onAttempt` fires at the
 * first submit (before any override step) so the exercise can stamp latency.
 * The widget never binds keys: Enter inside the field submits; outside it,
 * the frame's Enter reaches the registered `onSubmit`. Copy lives in
 * `strings.ts`.
 *
 * Motion (design 09 §10 C1): the English field sits in `.text-answer__ink`,
 * whose ink rule hiku-draws under it on focus (scaleX, --dur-2) and whose
 * caret is vermilion; the reveal and confirm panels are the shared `.reveal`
 * (ui.css) entering as `.ink-nijimi`, kinds correct · partial · wrong · info
 * (`revealKind`; a kana-only answer under the Hard policy is `partial` with
 * its own why line).
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ErrorTag } from '@/content/types';
import { diffChars, equivalentJa, fuzzyEn, normalizeJa } from '@/shared/jp';
import { finalizeIme, wantsKatakana } from '@/shared/kana-ime';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { KanaInput } from '@/shared/ui/KanaInput';
import { checkJa, whyFor, type CheckResult } from './check';
import { S } from './strings';
import './TextAnswer.css';

export interface TextAnswerResult {
  correct: boolean;
  /** Trimmed answer. */
  given: string;
  /** "I meant that" was taken on an English miss. */
  override: boolean;
  nearMiss: boolean;
  kanaOnly: boolean;
  tags: ErrorTag[];
  /** The accepted form to display. */
  expected: string;
  /** `ja` mode: the full `checkJa` classification. */
  check?: CheckResult;
}

export interface TextAnswerProps {
  /** Accepted answers; the first is the display form. */
  accept: string[];
  onSubmit(r: TextAnswerResult): void;
  autoFocus?: boolean;
  /** `en` English gloss (default) · `ja` Japanese through the kana IME. */
  mode?: 'en' | 'ja';
  /** `ja`: start in katakana mode (default: when `accept[0]` is katakana-only). */
  katakana?: boolean;
  /** `ja`: kanji candidates Space cycles (production-forge). */
  candidates?: string[];
  /** `ja`: the kana every candidate reads as; candidates are offered only once the field reads this way. */
  candidateReading?: string;
  /** `ja`: kana reading of a kanji word → Good (default) or Hard. */
  kanaOnlyPolicy?: 'good' | 'hard';
  /** `ja`: `false` keeps カタカナ and ひらがな distinct (kana-forge). */
  allowKatakanaFold?: boolean;
  /** `ja`: tolerate a particle slip as a Block (default true). */
  particleSlip?: boolean;
  /** Tags attached to a plain miss. */
  missTags?: ErrorTag[];
  /** `en`: offer 「I meant that」 on a miss (default true). */
  allowOverride?: boolean;
  /** Show the correct form and the diff after submitting (default true). */
  reveal?: boolean;
  placeholder?: string;
  /** Accessible name of the field. */
  label?: string;
  disabled?: boolean;
  /** First submit, before any override step. */
  onAttempt?(given: string): void;
  onChange?(value: string): void;
}

type Phase = 'input' | 'confirm' | 'done';

const DIFF_CLASS = ['diff--same', 'diff--extra', 'diff--missing'] as const;

/**
 * The candidates the kana field may cycle for the current display `value`:
 * all of them while the field shows one of them (cycling back) or its kana
 * finalizes to `reading`; otherwise none, so Space stays a plain character.
 */
export function offeredCandidates(candidates: readonly string[] | undefined, reading: string | undefined, value: string): string[] | undefined {
  if (!candidates || candidates.length === 0) return undefined;
  const v = value.trim();
  if (v.length === 0) return undefined;
  if (candidates.includes(v)) return [...candidates];
  if (reading && reading.trim().length > 0 && equivalentJa(finalizeIme(v), reading)) return [...candidates];
  return undefined;
}

/** The `.reveal` kind of a graded answer: a near miss or a kana-only reading is `partial` (design 09 §10 C1). */
export function revealKind(r: Pick<TextAnswerResult, 'correct' | 'nearMiss'>): 'correct' | 'partial' | 'wrong' {
  if (r.nearMiss) return 'partial';
  return r.correct ? 'correct' : 'wrong';
}

function Diff(p: { given: string; expected: string; ja: boolean }): JSX.Element {
  const d = diffChars(p.given, p.expected);
  return (
    <span class="text-answer__diff" lang={p.ja ? 'ja' : undefined}>
      {d.map(([ch, k], i) => (
        <span key={i} class={`diff ${DIFF_CLASS[k]}`} data-diff={k}>
          {ch}
        </span>
      ))}
    </span>
  );
}

export function TextAnswer(p: TextAnswerProps): JSX.Element {
  const mode = p.mode ?? 'en';
  const ja = mode === 'ja';
  const accept = p.accept.map((a) => a.trim()).filter((a) => a.length > 0);
  const display = accept[0] ?? '';
  const [value, setValue] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [result, setResult] = useState<TextAnswerResult | null>(null);
  const [nudge, setNudge] = useState('');
  const enRef = useRef<HTMLInputElement>(null);
  const declineRef = useRef<HTMLButtonElement>(null);
  const live = useRef({ phase, value, disabled: Boolean(p.disabled) });
  live.current = { phase, value, disabled: Boolean(p.disabled) };

  useEffect(() => {
    if (!ja && p.autoFocus) enRef.current?.focus();
  }, [ja, p.autoFocus]);

  // A new accept list means a new step on a reused instance: start over.
  const sig = `${mode}\u001f${accept.join('\u001f')}`;
  const lastSig = useRef(sig);
  useEffect(() => {
    if (lastSig.current === sig) return;
    lastSig.current = sig;
    setValue('');
    setPhase('input');
    setResult(null);
    setNudge('');
  }, [sig]);

  useEffect(() => {
    if (phase === 'confirm') declineRef.current?.focus();
  }, [phase]);

  const finish = (r: TextAnswerResult): void => {
    setResult(r);
    setPhase('done');
    p.onSubmit(r);
  };

  const submit = (raw: string): void => {
    if (live.current.phase !== 'input' || live.current.disabled) return;
    const given = raw.trim();
    const empty = ja ? normalizeJa(given).length === 0 : given.length === 0;
    if (empty) {
      setNudge(S.nothingTyped);
      return;
    }
    setNudge('');
    p.onAttempt?.(given);
    if (ja) {
      const check = checkJa(given, {
        accept,
        kanaOnlyPolicy: p.kanaOnlyPolicy ?? 'good',
        allowKatakanaFold: p.allowKatakanaFold,
        particleSlip: p.particleSlip,
        missTags: p.missTags,
      });
      finish({
        correct: check.correct,
        given: check.given,
        override: false,
        nearMiss: check.nearMiss,
        kanaOnly: check.kanaOnly,
        tags: check.tags,
        expected: check.expected,
        check,
      });
      return;
    }
    const ok = fuzzyEn(given, accept);
    const r: TextAnswerResult = {
      correct: ok,
      given,
      override: false,
      nearMiss: false,
      kanaOnly: false,
      tags: ok ? [] : [...(p.missTags ?? [])],
      expected: display,
    };
    if (!ok && (p.allowOverride ?? true)) {
      setResult(r);
      setPhase('confirm');
      return;
    }
    finish(r);
  };

  const override = (): void => {
    if (live.current.phase !== 'confirm' || !result) return;
    finish({ ...result, correct: true, override: true, tags: [] });
  };
  const decline = (): void => {
    if (live.current.phase !== 'confirm' || !result) return;
    finish(result);
  };

  useExerciseKeys({
    onSubmit: () => {
      if (live.current.phase === 'confirm') decline();
      else if (live.current.phase === 'input') submit(live.current.value);
    },
  });

  const change = (v: string): void => {
    setValue(v);
    if (nudge) setNudge('');
    p.onChange?.(v);
  };

  const locked = phase !== 'input' || Boolean(p.disabled);
  const canSubmit = !locked && (ja ? normalizeJa(value).length > 0 : value.trim().length > 0);
  const katakana = p.katakana ?? wantsKatakana(display);
  const label = p.label ?? (ja ? S.answerField : S.englishField);
  const showReveal = (p.reveal ?? true) && phase === 'done' && result !== null;
  const why = result?.check ? whyFor(result.check) : undefined;
  const alsoAccepted = accept.slice(1);

  return (
    <div class="text-answer" data-mode={mode} data-phase={phase} data-correct={result ? String(result.correct) : undefined}>
      <div class="text-answer__row">
        {ja ? (
          <span class="text-answer__ink" data-mode="ja">
            <KanaInput
              value={value}
              onChange={change}
              onSubmit={submit}
              katakana={katakana}
              candidates={offeredCandidates(p.candidates, p.candidateReading, value)}
              placeholder={p.placeholder}
              autoFocus={p.autoFocus}
              disabled={locked}
              label={label}
            />
          </span>
        ) : (
          <span class="text-answer__ink">
            <input
              ref={enRef}
              class="text-answer__field"
              type="text"
              lang="en"
              value={value}
              placeholder={p.placeholder}
              disabled={locked}
              aria-label={label}
              autoComplete="off"
              autoCapitalize="off"
              spellcheck={false}
              enterKeyHint="done"
              onInput={(e) => change(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
                e.preventDefault();
                e.stopPropagation();
                submit(e.currentTarget.value);
              }}
            />
          </span>
        )}
        <button
          type="button"
          class="text-answer__submit"
          disabled={!canSubmit}
          aria-keyshortcuts="Enter"
          onClick={() => submit(value)}
        >
          {S.submit}
        </button>
      </div>

      {nudge ? (
        <p class="text-answer__nudge" role="status">
          {nudge}
        </p>
      ) : null}

      {phase === 'confirm' && result ? (
        <div class="text-answer__confirm reveal ink-nijimi" data-kind="info" role="group" aria-label={S.meantPrompt}>
          <p class="text-answer__expected">
            <span class="eyebrow">{S.correctForm}</span>
            <span class="text-answer__form">{display}</span>
          </p>
          {alsoAccepted.length > 0 ? (
            <p class="text-answer__also">
              <span class="eyebrow">{S.alsoAccepted}</span> <span>{alsoAccepted.join(' · ')}</span>
            </p>
          ) : null}
          <p class="text-answer__question">{S.meantPrompt}</p>
          <div class="text-answer__actions">
            <button ref={declineRef} type="button" class="text-answer__decline" onClick={decline}>
              {S.notThat}
            </button>
            <button type="button" class="text-answer__override" onClick={override}>
              {S.iMeantThat}
            </button>
          </div>
        </div>
      ) : null}

      {showReveal && result ? (
        <div class="text-answer__reveal reveal ink-nijimi" data-kind={revealKind(result)}>
          {!result.correct || result.nearMiss ? (
            <p class="text-answer__expected">
              <span class="eyebrow">{S.correctForm}</span>
              <span class="text-answer__form" lang={ja ? 'ja' : undefined}>
                {result.expected}
              </span>
            </p>
          ) : null}
          {!result.correct && !result.override ? (
            <p class="text-answer__yours">
              <span class="eyebrow">{S.yours}</span>
              {ja ? <Diff given={result.given} expected={result.expected} ja /> : <span class="text-answer__given">{result.given}</span>}
            </p>
          ) : null}
          {result.override ? <p class="text-answer__why">{S.overrideLogged}</p> : null}
          {why ? <p class="text-answer__why">{why}</p> : null}
          {!result.correct && !ja && alsoAccepted.length > 0 ? (
            <p class="text-answer__also">
              <span class="eyebrow">{S.alsoAccepted}</span> <span>{alsoAccepted.join(' · ')}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
