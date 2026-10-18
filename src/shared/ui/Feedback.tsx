/**
 * TSUZUKU — `<Feedback>`: the card after a rep (design 04 §0 "Feedback").
 *
 * Correct form, character diff colored by kind (always paired with a glyph:
 * struck = extra, dotted = missing), error-tag chips, one line of why, the
 * Sensei line, belt flip on promotion, Ippon brush flash, XP delta, Judge
 * verdict. Copy lives in `strings.ts`; no shame, ever. `feel === 'zen'`
 * drops the Kiai flourishes (Ippon flash, Kiai chip).
 *
 * Motion (design 09 §7 I): the card is a `.reveal` panel entering as
 * `.ink-nijimi` — a plain panel, never a `.status-window` (§6.7 rule 7: a
 * clipped window is never transformed); `data-kind` stays the `FeedbackState`
 * kind (ui.css maps near / guard / timeout onto the panel tones); the XP delta
 * ticks through `<Ticker>` — armed at 0 on mount and set to its value in the
 * first effect, the End Card's idiom — while the `aria-label` carries the real
 * delta from first paint. 一本 is written through a stroke mask (§3.4: a
 * `.ink-hiku[data-axis="stroke"]` spine over 300 ms, the dashWrite attribute
 * contract; the scale flash is retired). Reduced motion: the tokens zero the
 * entrance, the stroke shows complete and the Ticker sets its value at once.
 */
import type { JSX } from 'preact';
import { useEffect, useId, useState } from 'preact/hooks';
import type { FeedbackState } from '../exercise-types';
import type { Feel } from '../store-types';
import { containsJapanese, diffChars } from '../jp';
import { Ruby } from './Ruby';
import { BELT_LABEL, S, TAG_LABEL, fill } from './strings';
import { Ticker } from './Ticker';
import './ui.css';

export interface FeedbackProps {
  state: FeedbackState;
  /** 「もう一度」 — re-queue the item 3–8 reps later (Recovery). Hidden when absent. */
  onAgain?(): void;
  feel?: Feel;
}

const HEADLINE: Record<FeedbackState['kind'], string> = {
  correct: S.correct,
  near: S.near,
  wrong: S.wrong,
  guard: S.guard,
  timeout: S.timeout,
  info: S.info,
};

const DIFF_CLASS = ['diff--same', 'diff--extra', 'diff--missing'] as const;
const DIFF_TITLE = ['', 'extra', 'missing'] as const;

/** Headline + Sensei line for a live region. */
export function feedbackAnnouncement(st: FeedbackState): string {
  const parts = [st.line ?? HEADLINE[st.kind]];
  if (st.correct && st.kind !== 'correct') parts.push(`${S.answerLabel}: ${st.correct}`);
  if (st.promotion) parts.push(fill(S.promoted, { belt: BELT_LABEL[st.promotion].en }));
  return parts.join(' ');
}

const signed = (n: number): string => `${n > 0 ? '+' : ''}${n} XP`;

/** 一本 in brush, revealed by a single spine stroke drawn left to right through an SVG mask (ui.css sets the 300 ms). */
function Ippon(): JSX.Element {
  const maskId = `${useId()}-ippon`;
  return (
    <span class="ippon" role="img" aria-label={S.ippon}>
      <svg class="ippon__svg" viewBox="0 0 64 32" aria-hidden="true" focusable="false">
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="32">
            <path class="ippon__stroke ink-hiku" data-axis="stroke" d="M1 16H63" pathLength={1} stroke="#fff" stroke-width="32" fill="none" />
          </mask>
        </defs>
        <text class="ippon__text" x="32" y="16" text-anchor="middle" dominant-baseline="central" font-size="26" mask={`url(#${maskId})`} lang="ja">
          一本
        </text>
      </svg>
    </span>
  );
}

export function Feedback(p: FeedbackProps): JSX.Element {
  const st = p.state;
  const zen = p.feel === 'zen';
  // The delta rolls 0 → value once mounted (same frame under act / layout); the label is honest from the start.
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(true), []);
  const showsDiff = st.kind === 'near' || st.kind === 'wrong' || st.kind === 'timeout';
  const diff = st.diff ?? (showsDiff && st.given && st.correct ? diffChars(st.given, st.correct) : undefined);
  const canAgain = typeof p.onAgain === 'function' && showsDiff;

  return (
    <div
      class={`feedback reveal ink-nijimi feedback--${st.kind}`}
      data-kind={st.kind}
      data-feel={p.feel}
      role="group"
      aria-label="Feedback"
    >
      <div class="feedback__head">
        <p class="feedback__line">{st.line ?? HEADLINE[st.kind]}</p>
        {st.ippon && !zen ? <Ippon /> : null}
        {st.kiai && !zen ? (
          <span class="chip chip--kiai">
            <span lang="ja">気合</span> {S.kiai} ×1.5
          </span>
        ) : null}
        {st.xpDelta !== 0 ? (
          <span class="xp-delta" aria-label={signed(st.xpDelta)}>
            <Ticker value={armed ? st.xpDelta : 0} format={signed} />
          </span>
        ) : null}
      </div>

      {st.correct && st.kind !== 'correct' ? (
        <div class="feedback__row">
          <span class="eyebrow">{S.answerLabel}</span>
          <span class="feedback__answer">
            <Ruby ja={st.correct} mode="always" />
          </span>
        </div>
      ) : null}

      {diff && diff.length > 0 ? (
        <div class="feedback__row">
          <span class="eyebrow">{S.givenLabel}</span>
          <span class="feedback__diff" lang="ja" title={S.diffLegend}>
            {diff.map(([ch, k], i) => (
              <span key={i} class={`diff ${DIFF_CLASS[k]}`} data-diff={k} title={DIFF_TITLE[k] || undefined}>
                {ch}
              </span>
            ))}
          </span>
        </div>
      ) : st.given && showsDiff ? (
        <div class="feedback__row">
          <span class="eyebrow">{S.givenLabel}</span>
          <span class="feedback__given" lang="ja">
            {st.given}
          </span>
        </div>
      ) : null}

      {st.why ? (
        <p class="feedback__why" lang={containsJapanese(st.why) ? 'ja' : undefined}>
          {st.why}
        </p>
      ) : null}

      {st.errorTags.length > 0 ? (
        <div class="feedback__tags" aria-label="Error tags">
          {st.errorTags.map((t) => (
            <span key={t} class="chip chip--tag" data-tag={t}>
              {TAG_LABEL[t]}
            </span>
          ))}
        </div>
      ) : null}

      {st.recovery ? <p class="feedback__why feedback__recovery">{S.recovery}</p> : null}

      {st.judge ? (
        <p class="feedback__why feedback__judge" data-judge={st.judge}>
          {st.judge === 'pass' ? S.judgePass : S.judgeFail}
        </p>
      ) : null}

      {st.promotion ? (
        <div class="belt-flip" data-belt={st.promotion} role="status">
          <span lang="ja">{BELT_LABEL[st.promotion].ja}</span>
          <span>{fill(S.promoted, { belt: BELT_LABEL[st.promotion].en })}</span>
        </div>
      ) : null}

      {canAgain ? (
        <div class="feedback__actions">
          <button type="button" class="btn btn--ghost feedback__again" onClick={() => p.onAgain?.()}>
            <span lang="ja">もう一度</span> <span>{S.again}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
