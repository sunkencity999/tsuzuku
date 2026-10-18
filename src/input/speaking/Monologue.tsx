/**
 * TSUZUKU — 独白 Monologue Marathon and Reduce & Expand (design 04 §6, 05 §10).
 *
 *  · 60 s on a prompt (120 s from Brown; `params.seconds` wins). With the
 *    recognizer opted in, `services.stt.recognize({maxMs, continuous: true})`
 *    runs for the whole round and the transcript is counted (words and
 *    fillers, both estimated: Japanese has no spaces, so `countWords` is a
 *    script-run heuristic and says so). Otherwise the timer runs alone and
 *    the learner reports the round with a three-item rubric.
 *  · Reduce & Expand (`params.mode === 'reduce-expand'`, Station 37+): the
 *    passage `params.storyId` is shown, then retold in 60 → 45 → 30 s.
 *  · "Finish early" aborts the recognizer (its transcript is gone by
 *    contract) and falls back to the rubric for that round — said plainly.
 *  · A recognizer that gives up before the bell (microphone blocked, no
 *    network, no microphone: `sttFailure`) switches the round to the self
 *    path at once and says why under the clock; the clock runs on and the
 *    rubric follows, so the learner keeps speaking (06 §7 #10).
 *  · Emits one `output:done {kind:'monologue'|'reduce-expand', seconds,
 *    words?, path}` at the end; XP only (ungraded), words/min feeds Perapera 口.
 * Facet `null`; keys `none`. Time comes from `store.now()` through `useTimer`.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { sttFailure } from '@/audio';
import { content, type ContentLoader } from '@/content/loader';
import type { Belt, ContentItem, StoryItem } from '@/content/types';
import { services, type SttResult } from '@/shared/audio';
import { bus } from '@/shared/events';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { foldWidth, isHiragana, isKatakana } from '@/shared/jp';
import type { StepParams } from '@/shared/session-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { Ruby } from '@/shared/ui/Ruby';
import { useTimer } from '@/shared/ui/use-timer';
import { store } from '@/store';
import { S, fill } from '../strings';
import { recognitionAllowed } from './Shadow';
import './speaking.css';

export const meta: ExerciseMeta = {
  id: 'monologue',
  facet: null,
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: false,
  keys: 'none',
};

/** Reduce & Expand rounds (design 04 §6). */
export const REDUCE_EXPAND_SECONDS: readonly number[] = [60, 45, 30];
export const SHORT_SECONDS = 60;
export const LONG_SECONDS = 120;

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/** 60 s, 120 s from Brown (design 04 §6). */
export function defaultSeconds(belt: Belt): number {
  return belt === 'brown' || belt === 'black' ? LONG_SECONDS : SHORT_SECONDS;
}

/** The round lengths for a step: Reduce & Expand 60/45/30, else one round. */
export function roundsFor(params: StepParams, belt: Belt): number[] {
  if (params.mode === 'reduce-expand') return REDUCE_EXPAND_SECONDS.slice();
  const s = params.seconds !== undefined && params.seconds > 0 ? Math.round(params.seconds) : defaultSeconds(belt);
  return [s];
}

const KANJI_RUN = /^[㐀-䶿一-鿿々〆]+$/;
const SEGMENT_SPLIT = /[\s　、。！？!?,.…・「」『』()（）]+/;
const RUNS = /[㐀-䶿一-鿿々〆]+|[ァ-ヺー]+|[ぁ-ゖー]+|[A-Za-z0-9]+/g;
const PARTICLE_CHARS = new Set(['は', 'が', 'を', 'に', 'で', 'と', 'も', 'の', 'へ', 'や', 'か']);
const PARTICLE_START = /^[はがをにでとものへやか]+/;
const ONLY_PARTICLES = /^[はがをにでとものへやか]+$/;

/** Particles strictly inside a hiragana run with at least two characters after them (so です / ます endings never split). */
function innerSplits(run: string): number {
  const chars = Array.from(run);
  let n = 0;
  for (let i = 1; i < chars.length - 2; i++) if (PARTICLE_CHARS.has(chars[i] as string)) n++;
  return n;
}

type PrevRun = 'none' | 'kanji' | 'other';

/**
 * Words in one hiragana run. Leading particles attach to the previous word
 * (私は, コーヒーを); after a kanji run the rest is okurigana / inflection
 * (食べます) and counts nothing extra; otherwise the run is one word plus
 * its inner particle splits.
 */
function hiraganaWords(run: string, prev: PrevRun): number {
  const startsWithParticle = PARTICLE_START.test(run);
  const r = prev === 'none' ? run : run.replace(PARTICLE_START, '');
  if (r.length === 0 || ONLY_PARTICLES.test(r)) return 0;
  if (prev === 'kanji' && !startsWithParticle) return innerSplits(r);
  return 1 + innerSplits(r);
}

/**
 * Estimated word count for Japanese without spaces: kanji runs with their
 * okurigana count once, katakana runs once, hiragana runs split at common
 * particles (particles themselves are not counted). An estimate, labelled so.
 */
export function countWords(text: string): number {
  let n = 0;
  for (const seg of foldWidth(text).split(SEGMENT_SPLIT)) {
    if (!seg) continue;
    const runs = seg.match(RUNS) ?? [];
    let prev: PrevRun = 'none';
    for (const run of runs) {
      const bare = run.replace(/ー/g, '');
      if (KANJI_RUN.test(run)) {
        n++;
        prev = 'kanji';
      } else if (bare.length > 0 && isHiragana(bare)) {
        n += hiraganaWords(run, prev);
        prev = 'other';
      } else if (bare.length > 0 && isKatakana(bare)) {
        n++;
        prev = 'other';
      } else {
        n++;
        prev = 'other';
      }
    }
  }
  return n;
}

export const FILLER_RE = /えっと|ええと|えーと|あのー|あのう|えー|うーん|んー|なんか/g;

/** Fillers the recognizer caught (an estimate; あの / その / まあ are real words too and are not counted). */
export function countFillers(text: string): number {
  return (foldWidth(text).match(FILLER_RE) ?? []).length;
}

export function wordsPerMinute(words: number, seconds: number): number {
  if (seconds <= 0) return 0;
  return Math.round((words / seconds) * 60);
}

export interface Rubric {
  kept: boolean;
  topic: boolean;
  pauses: boolean;
}

function isStoryItem(i: ContentItem | null | undefined): i is StoryItem {
  return !!i && 'lines' in i && Array.isArray((i as StoryItem).lines);
}

function attempt(over: Partial<AttemptResult> & Pick<AttemptResult, 'ms'>): AttemptResult {
  return { correct: false, nearMiss: false, hintUsed: false, guard: false, timedOut: false, errorTags: [], ...over };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export interface MonologueExtraProps {
  /** Content access (default: the live loader); tests pass `createFakeLoader()`. */
  loader?: Pick<ContentLoader, 'get'>;
}

type Phase = 'intro' | 'running' | 'waiting' | 'report' | 'review' | 'done';

interface RoundResult {
  seconds: number;
  /** Recognizer transcript; `null` on the self path. */
  transcript: string | null;
  words: number;
  fillers: number;
  rubric: Rubric | null;
}

export function Monologue(p: ExerciseProps & MonologueExtraProps): JSX.Element {
  return <MonologueBody key={p.step.id} {...p} />;
}

function MonologueBody(p: ExerciseProps & MonologueExtraProps): JSX.Element {
  const loader = p.loader ?? content;
  const params = p.step.params;
  const belt = store.profile.value.belt;
  const rounds = useMemo(() => roundsFor(params, belt), [params, belt]);
  const reduceExpand = params.mode === 'reduce-expand';
  const recognition = recognitionAllowed(store.settings.value, services.stt);
  const story = reduceExpand && params.storyId ? loader.get(params.storyId) : undefined;
  const passage = isStoryItem(story) ? story : null;

  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<Phase>('intro');
  const [results, setResults] = useState<RoundResult[]>([]);
  const [rubric, setRubric] = useState<Rubric>({ kept: false, topic: false, pauses: false });
  const [transcript, setTranscript] = useState<string | null>(null);
  const [path, setPath] = useState<'recognition' | 'self'>(recognition ? 'recognition' : 'self');
  /** Why the recognizer gave up this round (`STT_STATE_LABEL`), shown under the clock and in the report. */
  const [sttNote, setSttNote] = useState('');

  const live = useRef({ phase, round, results, rubric, transcript, path });
  live.current = { phase, round, results, rubric, transcript, path };
  const alive = useRef(true);
  const sttDone = useRef(false);
  const sttResult = useRef<SttResult | null>(null);
  const timedOut = useRef(false);
  const startedAt = useRef<number | null>(null);
  const emitted = useRef(false);

  const seconds = rounds[round] ?? rounds[rounds.length - 1] ?? SHORT_SECONDS;

  const toReview = (text: string | null): void => {
    if (!alive.current) return;
    setTranscript(text);
    setPhase('review');
  };

  const timer = useTimer({
    running: phase === 'running',
    deadlineMs: seconds * 1000,
    now: () => store.now(),
    onTimeout: () => {
      const s = live.current;
      if (s.phase !== 'running') return;
      timedOut.current = true;
      if (s.path === 'recognition') {
        if (sttDone.current) toReview(sttResult.current?.alternatives[0] ?? '');
        else setPhase('waiting');
      } else setPhase('report');
    },
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      services.stt.abort();
    };
  }, []);

  const start = (): void => {
    if (live.current.phase !== 'intro') return;
    if (startedAt.current === null) startedAt.current = store.now();
    timedOut.current = false;
    sttDone.current = false;
    sttResult.current = null;
    setTranscript(null);
    setSttNote('');
    setRubric({ kept: false, topic: false, pauses: false });
    timer.reset();
    setPhase('running');
    if (live.current.path === 'recognition') {
      services.stt
        .recognize({ maxMs: seconds * 1000, continuous: true })
        .then((res) => {
          if (!alive.current) return;
          sttDone.current = true;
          sttResult.current = res;
          if (!res) {
            const gaveUp = sttFailure(services.stt);
            if (gaveUp) setSttNote(gaveUp.label);
            // Gave up before the bell (mic blocked, network, no mic): the round goes on as self-report.
            if (gaveUp && !timedOut.current) setPath('self');
          }
          if (timedOut.current && live.current.phase !== 'report' && live.current.phase !== 'review') toReview(res?.alternatives[0] ?? '');
        })
        .catch(() => {
          if (!alive.current) return;
          sttDone.current = true;
          sttResult.current = null;
          if (timedOut.current) toReview('');
        });
    }
  };

  const finishEarly = (): void => {
    if (live.current.phase !== 'running') return;
    timedOut.current = true;
    if (live.current.path === 'recognition') services.stt.abort();
    setPhase('report');
  };

  const commitRound = (r: RoundResult): void => {
    const all = [...live.current.results, r];
    setResults(all);
    if (live.current.round + 1 < rounds.length) {
      setRound(live.current.round + 1);
      setPhase('intro');
    } else {
      setPhase('done');
      emitDone(all);
    }
  };

  const report = (): void => {
    if (live.current.phase !== 'report') return;
    const rb = live.current.rubric;
    const text = live.current.transcript;
    commitRound({ seconds, transcript: text, words: text ? countWords(text) : 0, fillers: text ? countFillers(text) : 0, rubric: rb });
  };

  const acceptReview = (): void => {
    if (live.current.phase !== 'review') return;
    const text = live.current.transcript ?? '';
    if (text.length === 0) {
      // Nothing recognized: the learner reports the round instead.
      setPhase('report');
      return;
    }
    commitRound({ seconds, transcript: text, words: countWords(text), fillers: countFillers(text), rubric: null });
  };

  const emitDone = (all: RoundResult[]): void => {
    if (emitted.current) return;
    emitted.current = true;
    const total = all.reduce((a, r) => a + r.seconds, 0);
    const recognized = all.filter((r) => r.transcript !== null);
    const words = recognized.length > 0 ? recognized.reduce((a, r) => a + r.words, 0) : undefined;
    const usedPath: 'recognition' | 'self' = recognized.length > 0 ? 'recognition' : 'self';
    bus.emit('output:done', { kind: reduceExpand ? 'reduce-expand' : 'monologue', seconds: total, ...(words !== undefined ? { words } : {}), path: usedPath });
    const r = attempt({
      ms: Math.max(0, store.now() - (startedAt.current ?? store.now())),
      correct: true,
      answer: recognized.map((x) => x.transcript ?? '').join(' / ') || undefined,
    });
    if (r.answer === undefined) delete r.answer;
    p.onResult(r);
  };

  useExerciseKeys({
    onSubmit: () => {
      const ph = live.current.phase;
      if (ph === 'intro') start();
      else if (ph === 'report') report();
      else if (ph === 'review') acceptReview();
    },
  });

  const remaining = Math.ceil(timer.remaining.value / 1000);
  const progress = timer.progress.value;
  const title = reduceExpand ? S.reduceExpandTitle : S.monologueTitle;
  const titleJa = reduceExpand ? S.reduceExpandTitleJa : S.monologueTitleJa;
  const intro = reduceExpand
    ? fill(S.reduceExpandIntro, { a: rounds[0] ?? 60, b: rounds[1] ?? 45, c: rounds[2] ?? 30 })
    : fill(path === 'recognition' ? S.monologueIntro : S.monologueIntroSelf, { n: seconds });
  const totalSeconds = results.reduce((a, r) => a + r.seconds, 0);
  const totalWords = results.reduce((a, r) => a + r.words, 0);

  return (
    <div class="speak monologue" data-exercise="monologue" data-feel={p.feel} data-phase={phase} data-path={path} data-round={round} data-mode={reduceExpand ? 'reduce-expand' : 'monologue'}>
      <header class="speak__head">
        <h2 class="speak__title">
          <span class="speak__title-ja" lang="ja">
            {titleJa}
          </span>
          <span>{title}</span>
        </h2>
        {params.promptEn ? <p class="speak__prompt">{params.promptEn}</p> : null}
        <p class="speak__note">{intro}</p>
        {reduceExpand ? (
          <ol class="monologue__rounds" aria-label={S.reduceExpandTitle}>
            {rounds.map((s, i) => (
              <li key={i} class="monologue__round" aria-current={i === round && phase !== 'done' ? 'step' : undefined} data-done={i < results.length ? 'true' : undefined}>
                {fill(S.reduceExpandRound, { i: i + 1, n: s })}
              </li>
            ))}
          </ol>
        ) : null}
      </header>

      {reduceExpand && phase === 'intro' ? (
        passage ? (
          <blockquote class="monologue__passage" lang="ja" aria-label={S.reduceExpandPassage}>
            {passage.lines.map((l, i) => (
              <p key={i}>
                <Ruby ja={l.ja} mode={p.furigana} />
              </p>
            ))}
          </blockquote>
        ) : (
          <p class="speak__note" role="status">
            {S.monologueStoryMissing}
          </p>
        )
      ) : null}

      {phase === 'intro' ? (
        <div class="speak__row">
          <button type="button" class="hanko" onClick={start} aria-keyshortcuts="Enter" data-action="start">
            {S.monologueStart}
          </button>
        </div>
      ) : null}

      {phase === 'running' || phase === 'waiting' ? (
        <div class="monologue__clock" role="timer" aria-live="off" aria-label={fill(S.monologueSpeaking, { n: remaining })}>
          <span class="monologue__seconds" data-remaining={remaining}>
            {phase === 'waiting' ? 0 : remaining}
          </span>
          <div class="meter" aria-hidden="true" style={{ '--value': progress, '--meter-tone': 'var(--ai)' } as JSX.CSSProperties}>
            <span class="meter__fill" />
          </div>
          <p class="speak__status" role="status">
            {phase === 'waiting' ? S.monologueTime : fill(S.monologueSpeaking, { n: remaining })}
          </p>
          {sttNote ? (
            <p class="speak__note" role="status" data-field="stt-note">
              {sttNote}
            </p>
          ) : null}
          {phase === 'running' ? (
            <button type="button" class="btn btn--ghost btn--sm" onClick={finishEarly} title={path === 'recognition' ? S.monologueFinishEarlyNote : undefined} data-action="finish-early">
              {S.monologueFinishEarly}
            </button>
          ) : null}
        </div>
      ) : null}

      {phase === 'report' ? (
        <fieldset class="monologue__rubric">
          <legend>{S.monologueReportTitle}</legend>
          {sttNote ? (
            <p class="speak__note" data-field="stt-note">
              {sttNote}
            </p>
          ) : path === 'recognition' ? (
            <p class="speak__note">{S.monologueFinishEarlyNote}</p>
          ) : null}
          <label class="recorder__check">
            <input type="checkbox" checked={rubric.kept} onChange={() => setRubric((r) => ({ ...r, kept: !r.kept }))} data-rubric="kept" />
            <span>{S.monologueReportKept}</span>
          </label>
          <label class="recorder__check">
            <input type="checkbox" checked={rubric.topic} onChange={() => setRubric((r) => ({ ...r, topic: !r.topic }))} data-rubric="topic" />
            <span>{S.monologueReportTopic}</span>
          </label>
          <label class="recorder__check">
            <input type="checkbox" checked={rubric.pauses} onChange={() => setRubric((r) => ({ ...r, pauses: !r.pauses }))} data-rubric="pauses" />
            <span>{S.monologueReportPauses}</span>
          </label>
          <div class="speak__row">
            <button type="button" class="hanko" onClick={report} aria-keyshortcuts="Enter" data-action="report">
              {S.monologueReport}
            </button>
          </div>
        </fieldset>
      ) : null}

      {phase === 'review' ? (
        <div class="speak__result" data-kind="correct">
          <p class="speak__verdict">{S.monologueTime}</p>
          {transcript ? (
            <>
              <p class="eyebrow">{S.monologueTranscript}</p>
              <p class="monologue__transcript" lang="ja" data-transcript="true">
                {transcript}
              </p>
              <p class="speak__meta">
                <span class="chip">{fill(S.monologueWords, { n: countWords(transcript) })}</span>
                <span class="chip">{fill(S.monologueWpm, { n: wordsPerMinute(countWords(transcript), seconds) })}</span>
                <span class="chip">{countFillers(transcript) > 0 ? fill(S.monologueFillers, { n: countFillers(transcript) }) : S.monologueFillersNone}</span>
              </p>
            </>
          ) : (
            <p class="speak__note">{sttNote ? `${sttNote} ${S.monologueNoTranscript}` : S.monologueNoTranscript}</p>
          )}
          <div class="speak__row">
            <button type="button" class="hanko" onClick={acceptReview} aria-keyshortcuts="Enter" data-action="accept">
              {round + 1 < rounds.length ? S.monologueNextRound : S.monologueFinish}
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'done' ? (
        <div class="speak__result" data-kind="correct" role="status">
          <p class="speak__verdict">{reduceExpand ? S.reduceExpandDone : fill(S.monologueDone, { n: totalSeconds })}</p>
          <p class="speak__meta">
            {totalWords > 0 ? <span class="chip">{fill(S.monologueWords, { n: totalWords })}</span> : null}
            {totalWords > 0 ? <span class="chip">{fill(S.monologueWpm, { n: wordsPerMinute(totalWords, totalSeconds) })}</span> : null}
            <span class="chip">{path === 'recognition' && totalWords > 0 ? S.shadowPathRecognition : S.shadowPathSelf}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
