/**
 * TSUZUKU — 影打ち Shadow Strike (design 04 §6, 05 §4, 05 §6).
 *
 * A sentence (a story line, an item's example or a set phrase) with its
 * pitch contour; the voice plays the PLAIN surface with the line's clip key
 * (`params.clip`, else `<storyId>#L<i>`, design 08 §8) and `speaker`; the
 * learner says it back. The pitch strip is labelled "dictionary pattern": it
 * draws the dictionary accent of each word, never a reading of the voice,
 * and `onProgress` (clip path only) sweeps its timing mora by mora.
 *  · Text hides after the first play once every content word of the line
 *    is item-belt Green ("these words are yours"); "Show the text" is a hint,
 *    also offered as the frame's `?` / Hint button while the text is hidden
 *    (`useExerciseKeys.onHint`, contract #32).
 *  · Recognition path (`services.stt`, when the learner opted in through
 *    `settings.speaking` and the browser has a recognizer): best of ≤ 5
 *    alternatives through `scoring.scoreRecognition` (plain / kana / ruby
 *    lattice), bands ≥ 0.80 Good · 0.60 Hard ("Blocked") · Again.
 *  · Fallback path: `<Recorder>` (model vs you + 3-item checklist) → a self
 *    rating; a sampled self-rated Good gets the perception Judge (minimal
 *    pair on the key word) through `requestJudge`; failing forces Again.
 *  · Emits `line:scored {kind:'shadow', path}`; the result carries implicit
 *    `prod` grades for content words due within 3 days (Good / Again only).
 * XP is identical on both paths (B decides it). Facet `null`; keys `none`.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { SHADOW_MAX_MS, sttFailure, voiceAudible } from '@/audio';
import { content, type ContentLoader } from '@/content/loader';
import { hasKanji, segmentsToTokens, toKana, toPlain } from '@/content/ruby';
import type { CardKey, ContentItem, ErrorTag, GrammarItem, StoryItem, VocabItem } from '@/content/types';
import { beltAtLeast, judgeRate, perceptionJudge, shouldJudge } from '@/learn';
import { packWillSpeak, services, speak, type SttResult, type SttService } from '@/shared/audio';
import { bus } from '@/shared/events';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { moraCount, moraSplit, nearMissKind, normalizeJa } from '@/shared/jp';
import type { StepParams } from '@/shared/session-types';
import type { Rating, Settings } from '@/shared/store-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { Ruby } from '@/shared/ui/Ruby';
import { store } from '@/store';
import { itemBeltOf } from '@/store/derived';
import { S, fill } from '../strings';
import { Recorder } from './Recorder';
import { bandFor, checklistToRating, implicitProdGrades, implicitRatingFor, scoreRecognition, type Checklist } from './scoring';
import './speaking.css';

export const meta: ExerciseMeta = {
  id: 'shadow',
  facet: null,
  needsTts: true,
  needsStt: false,
  selfGraded: true,
  timeable: false,
  keys: 'none',
};

/** Self-path ratings reported as a score on `line:scored` (Good / Hard / Again). */
export const SELF_SCORE: Record<Rating, number> = { 1: 0.4, 2: 0.7, 3: 1, 4: 1 };

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ShadowLine {
  /** Japanese with ruby markup (plain when none is known). */
  ja: string;
  kana: string;
  en?: string;
  tokens?: string[];
  tokenIds?: (string | null)[];
  /** The line IS this word (set phrase / isolated vocab). */
  word?: VocabItem;
  /** Clip key (design 08 §8): `params.clip`, else `<storyId>#L<i>` for a story line. */
  clip?: string;
  /** Speaker label of a story line (the cast voice on the clip path). */
  speaker?: string;
}

export function isVocabItem(i: ContentItem | null | undefined): i is VocabItem {
  return !!i && 'meanings' in i && 'pos' in i && 'kana' in i && 'word' in i;
}
function isGrammarItem(i: ContentItem | null | undefined): i is GrammarItem {
  return !!i && 'pattern' in i && 'clozeHints' in i;
}
function isStoryItem(i: ContentItem | null | undefined): i is StoryItem {
  return !!i && 'lines' in i && Array.isArray((i as StoryItem).lines);
}

function wordRuby(w: VocabItem): string {
  return hasKanji(w.word) ? `{${w.word}|${w.kana}}` : w.word;
}

/**
 * The line to shadow: a story line (`storyId` + `lineIndex`), else the item
 * example whose plain surface equals `params.sentence`, else the params
 * themselves, else the vocab item as an isolated word. `null` with nothing.
 */
export function resolveShadowLine(params: StepParams, item: ContentItem | null, get: (id: string) => ContentItem | undefined): ShadowLine | null {
  const clip = params.clip ? { clip: params.clip } : {};
  if (params.storyId !== undefined && params.lineIndex !== undefined) {
    const story = get(params.storyId);
    const line = isStoryItem(story) ? story.lines[params.lineIndex] : undefined;
    if (line) {
      return {
        ja: line.ja,
        kana: line.kana,
        en: line.en,
        tokens: line.tokens,
        tokenIds: line.tokenIds,
        clip: params.clip ?? `${params.storyId}#L${params.lineIndex}`,
        ...(line.speaker ? { speaker: line.speaker } : {}),
      };
    }
  }
  const sentence = params.sentence;
  if (sentence) {
    const plain = toPlain(sentence);
    if (isVocabItem(item) || isGrammarItem(item)) {
      const ex = item.examples.find((e) => toPlain(e.ja) === plain);
      if (ex) return { ja: ex.ja, kana: ex.kana, en: ex.en, ...(isVocabItem(item) ? { tokenIds: [item.id] } : {}), ...clip };
    }
    if (isVocabItem(item) && plain === item.word) return { ja: wordRuby(item), kana: item.kana, en: params.promptEn ?? item.meanings[0], word: item, tokenIds: [item.id], ...clip };
    const kana = params.answer ?? (sentence === plain ? toKana(sentence) : toKana(sentence));
    return { ja: sentence, kana: kana || plain, en: params.promptEn, ...(isVocabItem(item) ? { tokenIds: [item.id] } : {}), ...clip };
  }
  if (isVocabItem(item)) return { ja: wordRuby(item), kana: item.kana, en: item.meanings[0], word: item, tokenIds: [item.id], ...clip };
  return null;
}

/** Item ids behind the line's content tokens (nulls dropped). */
export function contentIds(line: ShadowLine): string[] {
  return (line.tokenIds ?? []).filter((x): x is string => typeof x === 'string');
}

/** Every content item of the line is item-belt Green or better (and there is at least one). */
export function allGreen(ids: readonly string[], beltOf: (id: string) => ReturnType<typeof itemBeltOf> = (id) => itemBeltOf(id)): boolean {
  if (ids.length === 0) return false;
  return ids.every((id) => beltAtLeast(beltOf(id), 'green'));
}

/** Recognition runs only when the learner opted in and the browser has a recognizer (design 06 §7 #10). */
export function recognitionAllowed(settings: Pick<Settings, 'speaking'>, stt: Pick<SttService, 'available'>): boolean {
  return stt.available && (settings.speaking === 'recognition' || settings.speaking === 'auto');
}

export type PitchMark = 'high' | 'low' | null;
export interface PitchCell {
  mora: string;
  mark: PitchMark;
}

/** A strip cell that is punctuation (、。…): drawn, but owning no mora of the cue (design 08 §9 folds the pause into the preceding boundary). */
export function isPunctMora(mora: string): boolean {
  return normalizeJa(mora).length === 0;
}

/** Standard contour from the nucleus: 0 = low then high; 1 = high then low; n = low, high through n, then low. */
export function pitchHighs(pitch: number, n: number): boolean[] {
  const out: boolean[] = [];
  for (let i = 1; i <= n; i++) {
    if (pitch === 0) out.push(i > 1);
    else if (pitch === 1) out.push(i === 1);
    else out.push(i >= 2 && i <= pitch);
  }
  return out;
}

function cellsFor(kana: string, pitch: number | undefined): PitchCell[] {
  const morae = moraSplit(kana);
  if (pitch === undefined || !Number.isFinite(pitch) || pitch < 0 || pitch > morae.length) return morae.map((m) => ({ mora: m, mark: null }));
  const highs = pitchHighs(pitch, morae.length);
  return morae.map((m, i) => ({ mora: m, mark: highs[i] ? 'high' : 'low' }));
}

/**
 * Per-mora pitch cells for the strip: a token's contour is drawn when its
 * vocab item carries `pitch` and the token reads with the item's mora count
 * (uninflected); everything else is drawn flat. `null` when nothing has data.
 */
export function pitchCells(line: ShadowLine, get: (id: string) => ContentItem | undefined): PitchCell[] | null {
  let cells: PitchCell[] = [];
  if (line.word) {
    cells = cellsFor(line.word.kana, line.word.pitch);
  } else if (line.tokens && line.tokens.length > 0) {
    const toks = segmentsToTokens(line.ja, line.tokens);
    toks.forEach((t, i) => {
      const kana = toKana(t.ja);
      const id = line.tokenIds?.[i];
      const item = id ? get(id) : undefined;
      const pitch = isVocabItem(item) && moraCount(normalizeJa(item.kana, { foldKatakana: true })) === moraCount(normalizeJa(kana, { foldKatakana: true })) ? item.pitch : undefined;
      cells.push(...cellsFor(kana, pitch));
    });
  } else {
    return null;
  }
  return cells.some((c) => c.mark !== null) ? cells : null;
}

/** The key word for the perception Judge: the longest content word of the line, plus the vocab pool around it. */
export function keyWord(line: ShadowLine, get: (id: string) => ContentItem | undefined): { word: VocabItem; pool: VocabItem[] } | null {
  const pool: VocabItem[] = [];
  for (const id of contentIds(line)) {
    const it = get(id);
    if (isVocabItem(it) && !pool.some((p) => p.id === it.id)) pool.push(it);
  }
  if (line.word && !pool.some((p) => p.id === line.word?.id)) pool.push(line.word);
  if (pool.length === 0) return null;
  const word = pool.reduce((best, w) => (moraCount(w.kana) > moraCount(best.kana) ? w : best), pool[0] as VocabItem);
  return { word, pool };
}

/** Same sample as the runner's `judgeNeeded` (design 05 §6). */
export function judgeSampled(cardKey: CardKey | null, stepId: string): boolean {
  const stats = store.stats.value;
  const rate = judgeRate(stats.judgeChecks > 0 ? stats.honesty : null, stats.judgeChecks);
  const key = cardKey ?? (stepId as CardKey);
  const reps = cardKey ? (store.cards.get(cardKey)?.[3] ?? 0) : 0;
  return shouldJudge(store.seed(), key, reps, rate);
}

/** Error tags a Blocked / missed recognition can carry (shadow raises vowel-length / pitch / listening). */
export function shadowTags(best: string, kana: string, rating: Rating): ErrorTag[] {
  if (rating === 3 || !best) return [];
  const k = nearMissKind(normalizeJa(best, { foldKatakana: true }), normalizeJa(kana, { foldKatakana: true }));
  return k === 'vowel-length' ? ['vowel-length'] : [];
}

function attempt(over: Partial<AttemptResult> & Pick<AttemptResult, 'ms'>): AttemptResult {
  return { correct: false, nearMiss: false, hintUsed: false, guard: false, timedOut: false, errorTags: [], ...over };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ShadowExtraProps {
  /** Content access (default: the live loader); tests pass `createFakeLoader()`. */
  loader?: Pick<ContentLoader, 'get'>;
}

type Phase = 'playing' | 'ready' | 'listening' | 'done';

interface Done {
  rating: Rating;
  score: number;
  path: 'recognition' | 'self';
  heard?: string;
  judge?: 'pass' | 'fail';
}

export function Shadow(p: ExerciseProps & ShadowExtraProps): JSX.Element {
  return <ShadowBody key={p.step.id} {...p} />;
}

function ShadowBody(p: ExerciseProps & ShadowExtraProps): JSX.Element {
  const loader = p.loader ?? content;
  const get = (id: string): ContentItem | undefined => loader.get(id);
  const line = useMemo(() => resolveShadowLine(p.step.params, p.item, get), [p.step.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const ids = useMemo(() => (line ? contentIds(line) : []), [line]);
  const cells = useMemo(() => (line ? pitchCells(line, get) : null), [line]); // eslint-disable-line react-hooks/exhaustive-deps
  const hideWhenGreen = useMemo(() => allGreen(ids), [ids]);
  const settings = store.settings.value;
  const recognition = recognitionAllowed(settings, services.stt);
  const hasVoice = voiceAudible(services.audio);
  const rate = p.step.params.rate ?? services.audio.rateForTier(p.speedTier);

  const [phase, setPhase] = useState<Phase>('playing');
  const [plays, setPlays] = useState(0);
  const [replays, setReplays] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [selfPath, setSelfPath] = useState(!recognition);
  const [nudge, setNudge] = useState('');
  const [judging, setJudging] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const startedAt = useRef<number | null>(null);
  const live = useRef({ phase, plays, replays, revealed, done, selfPath });
  live.current = { phase, plays, replays, revealed, done, selfPath };
  const alive = useRef(true);
  const strip = useRef<HTMLOListElement | null>(null);

  const plain = line ? toPlain(line.ja) : '';
  const kanaText = line ? line.kana : '';

  /**
   * Karaoke timing on the strip (clip path only, design 08 §9): morae before
   * `mora` settle, `mora` lights. The cue's mora count owns no punctuation, so
   * punctuation cells do not advance the count and read as past once the
   * voice is beyond them — the active cell never drifts after a mid-line 、.
   */
  const sweepStrip = (mora: number): void => {
    let k = 0;
    strip.current?.querySelectorAll<HTMLElement>('.pitch-strip__mora').forEach((el) => {
      if (el.dataset.punct === 'true') {
        el.setAttribute('data-timing', k <= mora ? 'past' : 'ahead');
        return;
      }
      el.setAttribute('data-timing', k < mora ? 'past' : k === mora ? 'active' : 'ahead');
      k++;
    });
  };
  const clearStrip = (): void => {
    strip.current?.querySelectorAll<HTMLElement>('.pitch-strip__mora[data-timing]').forEach((el) => el.removeAttribute('data-timing'));
  };

  const play = async (): Promise<void> => {
    if (!line) return;
    setPhase('playing');
    try {
      const isolated = !!line.word || (plain.length <= 8 && !/[。！？、]/.test(plain));
      await speak(plain, {
        kana: isolated && kanaText !== plain ? kanaText : undefined,
        rate,
        ...(line.clip ? { clip: line.clip } : {}),
        ...(line.speaker ? { speaker: line.speaker } : {}),
        onProgress: (_t, mora) => {
          if (alive.current) sweepStrip(mora);
        },
      });
    } finally {
      if (!alive.current) return;
      clearStrip();
      setPlays((n) => n + 1);
      if (startedAt.current === null) startedAt.current = store.now();
      setPhase((ph) => (ph === 'playing' ? 'ready' : ph));
    }
  };

  useEffect(() => {
    alive.current = true;
    void play();
    return () => {
      alive.current = false;
      services.audio.cancel();
      services.stt.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const elapsed = (): number => Math.max(0, store.now() - (startedAt.current ?? store.now()));

  const replay = (): void => {
    const s = live.current;
    if (s.done || s.phase === 'playing' || s.phase === 'listening' || !line) return;
    setReplays(s.replays + 1);
    p.onReplay();
    void play();
  };

  const reveal = (): void => {
    if (live.current.revealed || live.current.done) return;
    setRevealed(true);
    p.onHint();
  };

  const finish = (d: Done, heardText: string): void => {
    if (!line || live.current.done) return;
    const implicitRating = implicitRatingFor(d.score);
    const implicit = d.rating !== 2 && implicitRating !== null ? implicitProdGrades(ids, get, store.cards, store.today(), implicitRating) : [];
    bus.emit('line:scored', { kind: 'shadow', score: d.score, pass: d.rating === 3, path: d.path, replays: live.current.replays });
    const r = attempt({
      ms: elapsed(),
      correct: d.rating >= 2,
      nearMiss: d.rating === 2,
      hintUsed: live.current.revealed,
      score: d.score,
      replays: live.current.replays,
      errorTags: shadowTags(heardText, kanaText, d.rating),
    });
    if (d.path === 'self') r.selfRating = d.rating === 4 ? 3 : d.rating;
    if (heardText) r.answer = heardText;
    if (implicit.length > 0) r.implicit = implicit;
    setDone(d);
    setPhase('done');
    p.onResult(r);
  };

  const speakNow = async (): Promise<void> => {
    const s = live.current;
    if (s.done || s.phase !== 'ready' || s.selfPath || !line) return;
    setNudge('');
    setPhase('listening');
    let res: SttResult | null = null;
    try {
      res = await services.stt.recognize({ maxMs: SHADOW_MAX_MS });
    } catch {
      res = null;
    }
    if (!alive.current || live.current.done) return;
    if (!res || res.alternatives.length === 0) {
      setNudge(sttFailure(services.stt)?.label ?? S.shadowNoSpeech);
      setPhase('ready');
      return;
    }
    const sc = scoreRecognition(res.alternatives, { ja: line.ja, kana: line.kana });
    const rating = bandFor(sc.score);
    finish({ rating, score: sc.score, path: 'recognition', heard: sc.best }, sc.best);
  };

  const onSelfGrade = (c: Checklist): void => {
    if (!line || live.current.done) return;
    const rating = checklistToRating(c);
    const emit = (r: Rating, judge?: 'pass' | 'fail'): void => finish({ rating: r, score: SELF_SCORE[r], path: 'self', ...(judge ? { judge } : {}) }, '');
    if (rating !== 3 || !judgeSampled(p.step.cardKey, p.step.id)) {
      emit(rating);
      return;
    }
    const kw = keyWord(line, get);
    if (!kw) {
      emit(rating);
      return;
    }
    setJudging(true);
    p.requestJudge(perceptionJudge(kw.word, kw.pool))
      .then((pass) => {
        if (!alive.current) return;
        setJudging(false);
        emit(pass ? 3 : 1, pass ? 'pass' : 'fail');
      })
      .catch(() => {
        if (!alive.current) return;
        setJudging(false);
        emit(rating);
      });
  };

  const hidden = hideWhenGreen && plays > 0 && !revealed && !done && hasVoice;
  useExerciseKeys({
    onReplay: replay,
    onSubmit: () => {
      if (!live.current.selfPath) void speakNow();
    },
    // The frame's `?` / Hint button is the same "Show the text" hint; gone once shown.
    onHint: hidden ? reveal : undefined,
  });

  if (!line) {
    return (
      <div class="speak shadow" data-exercise="shadow" data-feel={p.feel}>
        <p class="speak__note" role="status">
          {S.shadowNoVoice}
        </p>
      </div>
    );
  }

  const kind = done ? (done.rating === 3 ? 'correct' : done.rating === 2 ? 'near' : 'wrong') : undefined;
  const verdict = done ? (done.path === 'recognition' ? (done.rating === 3 ? S.shadowGood : done.rating === 2 ? S.shadowHard : S.shadowAgain) : done.rating === 3 ? S.shadowSelfGood : done.rating === 2 ? S.shadowSelfHard : S.shadowSelfAgain) : '';
  const meaning = line.en ?? p.step.params.promptEn;

  return (
    <div class="speak shadow" data-exercise="shadow" data-feel={p.feel} data-phase={phase} data-path={selfPath ? 'self' : 'recognition'} data-hidden={hidden ? 'true' : undefined}>
      <header class="speak__head">
        <h2 class="speak__title">
          <span class="speak__title-ja" lang="ja">
            {S.shadowTitleJa}
          </span>
          <span>{S.shadowTitle}</span>
        </h2>
        <p class="speak__meta">
          <span class="chip">{selfPath ? S.shadowPathSelf : S.shadowPathRecognition}</span>
          <span class="chip">{`${rate.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}×`}</span>
        </p>
        <p class="speak__prompt">{hideWhenGreen && hasVoice ? S.shadowPromptHidden : S.shadowPrompt}</p>
      </header>

      {hidden ? (
        <div class="speak__line speak__line--hidden" role="group" aria-label={S.shadowPromptHidden}>
          <button type="button" class="btn btn--ghost" onClick={reveal} title={S.shadowShowTextHint}>
            {S.shadowShowText}
          </button>
        </div>
      ) : (
        <p class="speak__line" data-line="true">
          <Ruby ja={line.ja} mode={done ? 'always' : p.furigana} />
        </p>
      )}
      {!hidden && cells ? (
        <div data-field="pitch-strip">
          <p class="speak__meta" data-field="strip-caption" title={S.shadowPitchDictionaryHint}>
            <span class="speak__label">{S.shadowPitchLabel}</span>
            <span data-field="strip-label">{S.shadowPitchDictionary}</span>
          </p>
          <ol ref={strip} class="pitch-strip" aria-label={`${S.shadowPitchLabel}: ${S.shadowPitchDictionary}`} lang="ja">
            {cells.map((c, i) => (
              <li key={i} class="pitch-strip__mora" data-pitch={c.mark ?? 'none'} data-punct={isPunctMora(c.mora) ? 'true' : undefined}>
                {c.mora}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {meaning ? (
        <p class="speak__en">
          <span class="speak__label">{S.shadowMeaning}</span>
          {meaning}
        </p>
      ) : null}
      {!hasVoice ? (
        <p class="speak__note" role="status">
          {packWillSpeak(services.audio, settings.audioSource !== 'device') || services.audio.hasJaVoice.value ? S.shadowMuted : S.shadowNoVoice}
        </p>
      ) : null}

      <div class="speak__row">
        <button type="button" class="btn" onClick={replay} disabled={phase === 'playing' || phase === 'listening' || !!done} aria-keyshortcuts="Space" data-action="play">
          {phase === 'playing' ? S.shadowPlaying : plays === 0 ? S.shadowPlay : S.shadowReplay}
        </button>
        {!selfPath ? (
          <button type="button" class="hanko" onClick={() => void speakNow()} disabled={phase !== 'ready' || !!done} aria-keyshortcuts="Enter" data-action="speak">
            {phase === 'listening' ? S.shadowListening : S.shadowSpeak}
          </button>
        ) : null}
        {!selfPath && !done && nudge ? (
          <button type="button" class="btn btn--ghost btn--sm" onClick={() => setSelfPath(true)} data-action="self-instead">
            {S.shadowSelfInstead}
          </button>
        ) : null}
      </div>
      <p class="speak__status" role="status" aria-live="polite">
        {judging ? S.shadowJudgeWaiting : phase === 'listening' ? S.shadowListening : nudge}
      </p>
      {!selfPath && !done ? <p class="speak__note speak__note--small">{S.shadowNetworkNote}</p> : null}

      {selfPath && !done && plays > 0 ? (
        <Recorder modelKana={line.kana} modelJa={line.ja} pitch={line.word?.pitch} clip={line.clip} speaker={line.speaker} onSelfGrade={onSelfGrade} onPlayModel={() => play()} disabled={judging} />
      ) : null}

      {done ? (
        <div class="speak__result" data-kind={kind} role="status">
          <p class="speak__verdict">{verdict}</p>
          {done.path === 'recognition' ? (
            <p class="speak__meta">
              <span>{fill(S.shadowMatch, { pct: Math.round(done.score * 100) })}</span>
            </p>
          ) : null}
          {done.heard ? (
            <p class="speak__heard" lang="ja">
              <span class="speak__label">{S.shadowHeard}</span>
              {done.heard}
            </p>
          ) : null}
          {done.judge ? (
            <p class="speak__judge" data-judge={done.judge}>
              {done.judge === 'pass' ? S.shadowJudgePass : S.shadowJudgeFail}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
