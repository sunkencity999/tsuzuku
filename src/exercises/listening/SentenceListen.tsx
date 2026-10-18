/**
 * TSUZUKU — 聴写 Sentence Dictation (design 04 §5): TTS plays a sentence at
 * the learner's speed tier; the learner types what they heard through the
 * kana IME (or, with `params.choices`, picks its meaning — the Gatekeeper's
 * 耳 phase and Shinsa 耳 use that shape).
 *
 *  · Playback: `speak(toPlain(sentence), {kana, rate, clip})`; `params.rate`
 *    wins over the tier preset and `params.clip` (design 08 §8: `v-…#ex<k>`,
 *    `s-NN-k#L<i>`) is the voice-pack key the planner set — the pack falls
 *    back to the device voice when it misses, so with no pack nothing changes.
 *    ≤ 2 replays; the second caps the rep at Hard (`replays` on the result,
 *    `learn/grading` applies the ceiling). Latency is measured from the end of
 *    the first play.
 *  · Clause dictation (design 08 §9): when the planner sets `params.clause`
 *    (`[fromMora, toMora)` over the line's speech morae — punctuation and
 *    spaces are not morae) the drill plays that sub-range of the clip
 *    (`SpeakOptions.clause`) and grades against the clause kana
 *    (`clauseKana`); the replay ceiling is unchanged. The clip path is taken
 *    only when the pack can actually cut the span (`canCutClause`: the cue
 *    resolves AND carries mora boundaries that reach the clause end —
 *    example cues ship without `morae`, story lines with); otherwise the
 *    device voice reads the clause kana itself (the synth has no sub-range),
 *    so what plays is always what is graded. A clause never becomes
 *    `profile.dictatedSentence` (the kakejiku shows whole sentences), and
 *    `implicitGrades` runs in fragment mode: a pool word that is not in the
 *    clause gets no grade (it was not heard).
 *  · Score = 1 − normalized mora edit distance on canonical forms
 *    (`normalizeAnswer`: づ/ず, long-vowel spellings and katakana never cost),
 *    graded by `gradeScored` (≥ 0.95 Good, ≥ 0.80 Hard, else Again).
 *  · `moraDiff` aligns the morae and tags every slip cluster — vowel-length,
 *    voicing, small-kana, particle, transcription — for the colored diff and
 *    the result's `errorTags`.
 *  · Not scheduled itself: `implicitGrades` returns Good for `params.pool`
 *    listen cards on a clean dictation, Again for a content word the learner
 *    mis-transcribed (word found in the sentence, absent from the answer).
 *  · Emits `line:scored {kind:'dictation'}` for B's stats.
 *  · A perfect dictation — Good band, no hint, under the replay ceiling — at
 *    a rate ≥ `DICTATED_MIN_RATE` (1×) becomes `profile.dictatedSentence`
 *    (the plain surface, newest wins): the Waveform kakejiku's text, written
 *    the same way as the Listening Arena's `submitDictation` (round 2c).
 * Without an audible Japanese voice (`voiceAudible(services.audio)`: a voice
 * exists AND the master volume is above 0) the sentence is shown (honest
 * degrade). In typed mode the frame's Enter (focus outside the field)
 * finalizes the IME buffer before grading, as the field's own Enter does
 * (hon → ほん), so a pending romaji tail never counts as a slip, and the
 * frame's `?` / Hint button opens the typed-mode hint. Facet `null`; keys
 * `kana`; `needsTts`.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { content } from '@/content/loader';
import { toKana, toPlain } from '@/content/ruby';
import type { CardKey, ContentItem, ErrorTag, VocabItem } from '@/content/types';
import type { ClipCue } from '@/shared/audio';
import { SCORE_BANDS } from '@/learn';
import { services, speak } from '@/shared/audio';
import { bus } from '@/shared/events';
import type { ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { parseCardKey } from '@/shared/ids';
import { finalizeIme } from '@/shared/kana-ime';
import { moraSplit, nearMissKind, normalizeAnswer, normalizeEn, normalizeJa, speechMorae } from '@/shared/jp';
import type { AttemptResult, StepParams } from '@/shared/session-types';
import type { Rating } from '@/shared/store-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { KanaInput } from '@/shared/ui/KanaInput';
import { Ruby } from '@/shared/ui/Ruby';
import { store } from '@/store';
import { ChoiceGrid } from '../ChoiceGrid';
import { clipCue, voiceAudible } from '../voice';
import { SLIP_PARTICLES, gradeChoice, gradeScored, moraScore, voicingSlip } from '../check';
import { S, TAG_LABEL, fill } from './strings';
import './SentenceListen.css';

export const meta: ExerciseMeta = {
  id: 'sentence-listen',
  facet: null,
  needsTts: true,
  needsStt: false,
  selfGraded: false,
  timeable: false,
  keys: 'kana',
};

/** Replays allowed per rep (design 04 §5); the second one caps the rating at Hard. */
export const MAX_REPLAYS = 2;

/**
 * A dictation counts as "perfect" for `profile.dictatedSentence` at normal
 * speed or faster (≥ 0.95 at 1×, store-types `Profile`) — the same bar as the
 * Listening Arena's `DICTATED_MIN_RATE` (`src/input/listening`), kept here
 * because the exercise tier never imports the input tier.
 */
export const DICTATED_MIN_RATE = 1;

export type SentenceListenParams = { sentence: string; rate: number; pool?: CardKey[] };

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

export interface MoraOp {
  mora: string;
  /** 0 same · 1 extra in the answer · 2 missing from the answer. */
  kind: 0 | 1 | 2;
  /** The slip this cluster exemplifies (kinds 1 and 2 only). */
  tag?: ErrorTag;
}

const RE_VOWELISH = /^[ーあいうえお]+$/;
const RE_SMALL = /^[っゃゅょぁぃぅぇぉゎ]+$/;

/** Classifies one differing cluster: `extra` = what the learner added, `missing` = what they dropped. */
export function slipTag(extra: string, missing: string): ErrorTag {
  if (extra && missing) {
    if (voicingSlip(extra, missing)) return 'voicing';
    const k = nearMissKind(extra, missing);
    if (k === 'small-kana') return 'small-kana';
    if (k === 'vowel-length') return 'vowel-length';
    if (SLIP_PARTICLES.includes(extra) && SLIP_PARTICLES.includes(missing)) return 'particle';
    return 'transcription';
  }
  const one = extra || missing;
  if (RE_VOWELISH.test(one)) return 'vowel-length';
  if (RE_SMALL.test(one)) return 'small-kana';
  if (SLIP_PARTICLES.includes(one)) return 'particle';
  return 'transcription';
}

function lcsOps(a: readonly string[], b: readonly string[]): MoraOp[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = [];
  for (let i = 0; i <= n; i++) dp.push(new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: MoraOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ mora: a[i] as string, kind: 0 });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ mora: a[i] as string, kind: 1 });
      i++;
    } else {
      out.push({ mora: b[j] as string, kind: 2 });
      j++;
    }
  }
  while (i < n) out.push({ mora: a[i++] as string, kind: 1 });
  while (j < m) out.push({ mora: b[j++] as string, kind: 2 });
  return out;
}

/**
 * Mora-level diff of the learner's answer against the sentence, every slip
 * cluster tagged. Clusters that are only an equivalent spelling (おう/おー,
 * づ/ず, katakana) collapse to the learner's morae as "same".
 */
export function moraDiff(given: string, expected: string): MoraOp[] {
  const g = moraSplit(normalizeJa(given, { foldKatakana: true }));
  const e = moraSplit(normalizeJa(expected, { foldKatakana: true }));
  const ops = lcsOps(g, e);
  const out: MoraOp[] = [];
  // Running prefixes of both sides, so a cluster is judged with its context
  // (ー after と equals う after と, but 'ー' alone never equals 'う').
  let gPrefix = '';
  let ePrefix = '';
  let i = 0;
  while (i < ops.length) {
    const op = ops[i] as MoraOp;
    if (op.kind === 0) {
      out.push(op);
      gPrefix += op.mora;
      ePrefix += op.mora;
      i++;
      continue;
    }
    let j = i;
    const extras: MoraOp[] = [];
    const missing: MoraOp[] = [];
    while (j < ops.length && (ops[j] as MoraOp).kind !== 0) {
      ((ops[j] as MoraOp).kind === 1 ? extras : missing).push(ops[j] as MoraOp);
      j++;
    }
    const ex = extras.map((o) => o.mora).join('');
    const mi = missing.map((o) => o.mora).join('');
    if (ex && mi && normalizeAnswer(gPrefix + ex) === normalizeAnswer(ePrefix + mi)) {
      for (const o of extras) out.push({ mora: o.mora, kind: 0 });
    } else {
      const tag = slipTag(ex, mi);
      for (let k = i; k < j; k++) out.push({ ...(ops[k] as MoraOp), tag });
    }
    gPrefix += ex;
    ePrefix += mi;
    i = j;
  }
  return out;
}

/** Distinct tags of a diff, in order of appearance. */
export function diffTags(diff: readonly MoraOp[]): ErrorTag[] {
  const out: ErrorTag[] = [];
  for (const o of diff) if (o.tag && !out.includes(o.tag)) out.push(o.tag);
  return out;
}

function isVocab(i: ContentItem | undefined): i is VocabItem {
  return !!i && 'word' in i && 'kana' in i && 'meanings' in i;
}

/** The kana surface to look for: the word, or its stem for a word of ≥ 3 morae that is inflected in the sentence. */
function surfaceIn(kana: string, sentence: string): string | null {
  const k = normalizeAnswer(kana);
  if (k.length > 0 && sentence.includes(k)) return k;
  const morae = moraSplit(k);
  if (morae.length >= 3) {
    const stem = morae.slice(0, -1).join('');
    if (sentence.includes(stem)) return stem;
  }
  return null;
}

/**
 * Side grades for `pool` (listen cards, design 04 §5): a content word found
 * in the sentence → Good when the answer contains it, Again when it does not;
 * a word that cannot be located (item not loaded, not in the sentence) → Good
 * only on a clean dictation (≥ 0.95) of the WHOLE line, otherwise no grade.
 * `whole` is `false` for a clause step (design 08 §9): `expected` is then a
 * fragment, so an unlocated word may sit in the part the learner never heard
 * and earns nothing.
 */
export function implicitGrades(
  pool: readonly CardKey[],
  expected: string,
  given: string,
  score: number,
  lookup: (id: string) => ContentItem | undefined,
  whole = true,
): { cardKey: CardKey; rating: Rating }[] {
  const e = normalizeAnswer(expected);
  const g = normalizeAnswer(given);
  const out: { cardKey: CardKey; rating: Rating }[] = [];
  for (const key of pool) {
    let itemId: string;
    try {
      itemId = parseCardKey(key).itemId;
    } catch {
      continue;
    }
    const item = lookup(itemId);
    const surface = isVocab(item) ? surfaceIn(item.kana, e) : null;
    if (surface) out.push({ cardKey: key, rating: g.includes(surface) ? 3 : 1 });
    else if (whole && score >= SCORE_BANDS.good) out.push({ cardKey: key, rating: 3 });
  }
  return out;
}

/** Kana reading of the sentence param (ruby → readings; kana stays kana). */
export function sentenceKana(sentence: string): string {
  return toKana(sentence);
}

/**
 * The kana of one clause `[fromMora, toMora)` of a line (design 08 §9), or
 * `null` when there is no clause param or the span is empty / out of range
 * (the drill then dictates the whole line, as before). Indexes are speech
 * morae — `speechMorae` from `shared/jp.ts` strips the same punctuation class
 * the validator's `lineMorae` and the pipeline's `normalizeJa` drop, so on
 * validated kana (V10) the planner's `StepParams.clause` and the cues agree.
 */
export function clauseKana(kana: string, clause: readonly [number, number] | undefined): string | null {
  if (!clause) return null;
  const morae = speechMorae(kana);
  const [a, b] = clause;
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > morae.length || b <= a) return null;
  return morae.slice(a, b).join('');
}

/**
 * Whether the pack can play clause `[from, to)` of `clip` right now (design
 * 08 §9): the cue resolves (pack present, allowed and holding the key) AND
 * it carries mora boundaries at least up to `to`. A cue without `morae`
 * (example cues are indexed without them; only story lines carry `m`) would
 * play the WHOLE line against a clause-sized answer, so it does not count.
 */
export function canCutClause(clip: string | undefined, clause: readonly [number, number], rate: number, cue: (key: string, o: { rate: number }) => ClipCue | undefined = clipCue): boolean {
  if (!clip) return false;
  const c = cue(clip, { rate });
  return c !== undefined && (c.morae?.length ?? 0) >= clause[1];
}

/** Index of the correct choice: `params.answer` by exact, then fuzzy-English match; `-1` when unknown. */
export function choiceAnswerIndex(params: StepParams): number {
  const choices = params.choices ?? [];
  const want = params.answer ?? params.promptEn;
  if (!want) return -1;
  const exact = choices.indexOf(want);
  if (exact >= 0) return exact;
  const n = normalizeEn(want);
  return choices.findIndex((c) => normalizeEn(c) === n);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

interface Done {
  result: AttemptResult;
  diff: MoraOp[];
  score: number;
}

const DIFF_CLASS = ['diff--same', 'diff--extra', 'diff--missing'] as const;

export function SentenceListen(p: ExerciseProps<SentenceListenParams>): JSX.Element {
  const { step } = p;
  const params: StepParams = step.params;
  const sentence = params.sentence ?? '';
  const plain = toPlain(sentence);
  const kana = sentenceKana(sentence);
  const choiceMode = (params.choices?.length ?? 0) >= 2;
  const rate = params.rate ?? services.audio.rateForTier(p.speedTier);
  const hasVoice = voiceAudible(services.audio);
  const clip = params.clip;
  // Clause dictation (design 08 §9): the graded kana is the clause's; `null` = the whole line.
  const clause = choiceMode ? null : clauseKana(kana, params.clause);
  const target = clause ?? kana;

  const [playing, setPlaying] = useState(false);
  const [plays, setPlays] = useState(0);
  const [replays, setReplays] = useState(0);
  const [hint, setHint] = useState(false);
  const [value, setValue] = useState('');
  const [nudge, setNudge] = useState('');
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const [done, setDone] = useState<Done | null>(null);
  const startedAt = useRef<number | null>(null);
  const live = useRef({ playing, replays, hint, value, done, picked });
  live.current = { playing, replays, hint, value, done, picked };
  const stepRef = useRef(step.id);

  const play = async (): Promise<void> => {
    if (!sentence) return;
    const id = step.id;
    setPlaying(true);
    try {
      if (clause !== null && params.clause && !canCutClause(clip, params.clause, rate)) {
        // No clip the pack can cut a sub-range from: the device voice reads the clause kana itself, so what plays is what is graded.
        await speak(clause, { kana: clause, rate });
      } else {
        await speak(plain, {
          kana: kana !== plain ? kana : undefined,
          rate,
          ...(clip ? { clip } : {}),
          ...(clause !== null && params.clause ? { clause: params.clause } : {}),
        });
      }
    } finally {
      if (stepRef.current === id) {
        setPlaying(false);
        setPlays((n) => n + 1);
        if (startedAt.current === null) startedAt.current = store.now();
      }
    }
  };

  useEffect(() => {
    stepRef.current = step.id;
    startedAt.current = null;
    setPlaying(false);
    setPlays(0);
    setReplays(0);
    setHint(false);
    setValue('');
    setNudge('');
    setPicked(undefined);
    setDone(null);
    void play();
    return () => {
      services.audio.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id]);

  const replay = (): void => {
    const s = live.current;
    if (s.done || s.playing || s.replays >= MAX_REPLAYS || !sentence) return;
    setReplays(s.replays + 1);
    p.onReplay();
    void play();
  };

  const useHint = (): void => {
    if (live.current.hint || live.current.done) return;
    setHint(true);
    p.onHint();
  };

  const elapsed = (): number => Math.max(0, store.now() - (startedAt.current ?? store.now()));

  const submit = (raw: string): void => {
    const s = live.current;
    if (s.done || choiceMode) return;
    const given = raw.trim();
    if (normalizeJa(given).length === 0) {
      setNudge(S.nothingTyped);
      return;
    }
    const score = moraScore(normalizeAnswer(given), normalizeAnswer(target));
    const diff = moraDiff(given, target);
    const tags = diffTags(diff);
    const r = gradeScored(score, { ms: elapsed(), replays: s.replays, hintUsed: s.hint, missTags: tags, answer: given });
    r.errorTags = tags;
    const implicit = implicitGrades(params.pool ?? [], target, given, score, (id) => content.get(id), clause === null);
    if (implicit.length > 0) r.implicit = implicit;
    if (r.correct && !s.hint && s.replays < MAX_REPLAYS && rate >= DICTATED_MIN_RATE && clause === null) {
      // The Waveform kakejiku's text: the most recent perfect dictation, plain surface (mirrors the Listening Arena).
      store.patch('profile', (pr) => (pr.dictatedSentence === plain ? pr : { ...pr, dictatedSentence: plain }));
    }
    bus.emit('line:scored', { kind: 'dictation', score, pass: score >= SCORE_BANDS.good, tier: p.speedTier, replays: s.replays });
    setDone({ result: r, diff, score });
    p.onResult(r);
  };

  const pick = (i: number): void => {
    const s = live.current;
    if (s.done || s.picked !== undefined || !choiceMode) return;
    const correct = choiceAnswerIndex(params);
    setPicked(i);
    const r = gradeChoice(i, correct, { ms: elapsed(), replays: s.replays, hintUsed: s.hint, missTags: ['listening'], answer: params.choices?.[correct] });
    setDone({ result: r, diff: [], score: r.correct ? 1 : 0 });
    p.onResult(r);
  };

  /** The frame's Enter (focus outside the field): finalize the IME buffer first, as `KanaInput` does on its own Enter. */
  const submitLive = (): void => {
    const final = finalizeIme(live.current.value);
    if (final !== live.current.value) setValue(final);
    submit(final);
  };

  useExerciseKeys(choiceMode ? { onReplay: replay, onChoice: pick } : { onReplay: replay, onSubmit: submitLive, onHint: !hint && !done ? useHint : undefined });

  const replaysLeft = MAX_REPLAYS - replays;
  const bandLine = done ? (done.result.correct ? S.bandGood : done.result.nearMiss ? S.bandHard : S.bandAgain) : '';
  const kind = done ? (done.result.nearMiss ? 'partial' : done.result.correct ? 'correct' : 'wrong') : undefined;
  const hintText = params.promptEn && clause === null ? `${S.hintMeaning}: ${params.promptEn}` : `${S.hintStart} ${moraSplit(target).slice(0, 2).join('')}…`;

  if (!sentence) {
    return (
      <div class="listen" data-feel={p.feel}>
        <p class="listen__note" role="status">
          {S.noVoice}
        </p>
      </div>
    );
  }

  return (
    <div class="listen" data-feel={p.feel} data-mode={choiceMode ? 'choose' : 'type'} data-done={done ? 'true' : undefined} data-clause={clause !== null ? 'true' : undefined}>
      <p class="listen__prompt">{choiceMode ? S.listenChoosePrompt : S.listenPrompt}</p>
      {clause !== null ? <p class="listen__note listen__clause-note">{S.clauseNote}</p> : null}

      <div class="listen__player status-window">
        <button
          type="button"
          class="listen__play"
          onClick={plays === 0 && !playing ? () => void play() : replay}
          disabled={playing || (plays > 0 && (replays >= MAX_REPLAYS || done !== null))}
          aria-keyshortcuts="Space"
          aria-label={plays === 0 ? S.play : S.replay}
        >
          <span class="listen__play-icon" aria-hidden="true">
            {playing ? '…' : '▶'}
          </span>
          {playing ? S.playing : plays === 0 ? S.play : S.replay}
        </button>
        <span class="listen__meta">
          <span class="listen__rate">{fill(S.speedLabel, { rate: rate.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') })}</span>
          <span class="listen__replays" aria-live="polite">
            {replaysLeft > 0 ? fill(S.replaysLeft, { n: replaysLeft }) : S.noReplaysLeft}
          </span>
        </span>
        {replays >= MAX_REPLAYS && !done ? <p class="listen__ceiling">{S.secondReplayCeiling}</p> : null}
        {!hasVoice ? (
          <p class="listen__novoice" role="status">
            {S.noVoice}
            <span class="listen__shown" lang="ja">
              {clause !== null ? clause : <Ruby ja={sentence} mode={p.furigana} />}
            </span>
          </p>
        ) : null}
      </div>

      {choiceMode ? (
        <ChoiceGrid choices={params.choices ?? []} onPick={pick} picked={picked} correct={done ? choiceAnswerIndex(params) : undefined} label={S.meaningLabel} />
      ) : (
        <div class="listen__answer">
          <div class="listen__row">
            <KanaInput
              value={value}
              onChange={(v) => {
                setValue(v);
                if (nudge) setNudge('');
              }}
              onSubmit={submit}
              disabled={done !== null}
              autoFocus
              label={S.typedField}
              placeholder={S.listenPrompt}
            />
            <button type="button" class="listen__submit" disabled={done !== null || normalizeJa(value).length === 0} onClick={() => submit(value)} aria-keyshortcuts="Enter">
              {S.submit}
            </button>
          </div>
          {nudge ? (
            <p class="listen__nudge" role="status">
              {nudge}
            </p>
          ) : null}
          {!done ? (
            <div class="listen__tools">
              <button type="button" class="btn btn--ghost btn--sm" onClick={useHint} disabled={hint} aria-pressed={hint}>
                {S.hint}
              </button>
              {hint ? (
                <p class="listen__hint reveal ink-nijimi" data-kind="teach" role="status">
                  <span lang={params.promptEn && clause === null ? undefined : 'ja'}>{hintText}</span>
                  <small>{S.hintCeiling}</small>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {done ? (
        <div class="listen__result reveal ink-nijimi" data-kind={kind} role="status">
          <p class="listen__line">{choiceMode ? (done.result.correct ? S.choiceCorrect : S.choiceMiss) : bandLine}</p>
          {!choiceMode ? (
            <p class="listen__score">
              <span class="eyebrow listen__label">{S.score}</span> {fill(S.scoreLine, { pct: Math.round(done.score * 100) })}
            </p>
          ) : null}
          {!choiceMode && done.diff.length > 0 ? (
            <p class="listen__yours">
              <span class="eyebrow listen__label">{S.yours}</span>
              <span class="listen__diff" lang="ja" title={S.diffLegend}>
                {done.diff.map((o, i) => (
                  <span key={i} class={`diff ${DIFF_CLASS[o.kind]}`} data-diff={o.kind} data-tag={o.tag} title={o.tag ? TAG_LABEL[o.tag] : undefined}>
                    {o.mora}
                  </span>
                ))}
              </span>
            </p>
          ) : null}
          {clause !== null ? (
            <p class="listen__sentence listen__clause">
              <span class="eyebrow listen__label">{S.theClause}</span>
              <span lang="ja">{clause}</span>
            </p>
          ) : null}
          <p class="listen__sentence">
            <span class="eyebrow listen__label">{S.theSentence}</span>
            <Ruby ja={sentence} mode="always" />
          </p>
          {done.result.errorTags.length > 0 ? (
            <p class="listen__tags">
              {done.result.errorTags.map((t) => (
                <span key={t} class="chip chip--tag" data-tag={t}>
                  {TAG_LABEL[t]}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
