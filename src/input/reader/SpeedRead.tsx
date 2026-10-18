/**
 * TSUZUKU — 速読 Speed Read (design 04 §7, Station 6+).
 *
 * A previously read episode revealed one line at a time at a chosen pace
 * (`params.rate` in characters per minute: the belt target N5 80 · N4 150 ·
 * N3 250 · N2 350 · N1 450, `cpm.ts`), furigana per setting but never fogged,
 * no gloss. Each line stays for `msPerLine(chars, rate)` (≥ 600 ms); when the
 * last line's time is up the text folds away and ONE comprehension question
 * (seeded pick) decides: correct → XP (B), measured cpm → Perapera 読 and the
 * personal best (`stats.speedReadBestCpm`, B's stats reducer), 速読 badge at
 * ≥ 300 cpm. Emits `story:read` with `mode: 'speed'` once. Works as the
 * `speed-read` exercise (ExerciseProps) and standalone (SpeedReadProps).
 * Registered by the F barrel (`meta`). Copy in `./strings.ts`.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { content, type ContentLoader } from '@/content/loader';
import type { StoryItem, StoryLine } from '@/content/types';
import { bus, type Events } from '@/shared/events';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { rngFor, type Rng } from '@/shared/hash';
import type { FuriganaMode } from '@/shared/store-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { Ruby } from '@/shared/ui/Ruby';
import { store } from '@/store';
import { Comprehension } from './Comprehension';
import { charCount, cpm as cpmOf, cpmBand, cpmTargetForStation, levelForStation, msPerLine, plainChars, type CpmBand } from './cpm';
import { isExerciseProps, isStoryItem } from './StoryReader';
import { S, fill } from './strings';
import './reader.css';

export const meta: ExerciseMeta = {
  id: 'speed-read',
  facet: null,
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: false,
  keys: 'choices',
};

export interface SpeedReadResult {
  storyId: string;
  correct: number;
  total: number;
  /** The one question was answered (full credit). */
  passed: boolean;
  /** Measured characters per minute over the reveal. */
  cpm: number;
  /** The pace the lines were revealed at. */
  targetCpm: number;
  band: CpmBand;
  chars: number;
  ms: number;
  minutes: number;
  /** Beat `stats.speedReadBestCpm` with the question correct. */
  newBest: boolean;
  missing: boolean;
}

export interface SpeedReadProps {
  storyId: string;
  onDone(r: SpeedReadResult): void;
  /** Reveal pace in characters per minute; default the station's target. */
  rate?: number;
  loader?: ContentLoader;
  furigana?: FuriganaMode;
  /** Learner station (default pace, band); default `store.progress.station`. */
  station?: number;
}

/** Cumulative ms at which line `i` appears (line 0 at 0) plus the total at the end. */
export function revealSchedule(lines: readonly StoryLine[], rate: number): number[] {
  const out: number[] = [0];
  let t = 0;
  for (const l of lines) {
    t += msPerLine(plainChars(l.ja), rate);
    out.push(t);
  }
  return out;
}

/** The one question for this run (seeded by the host). */
export function pickQuestionIndex(n: number, rng: Rng): number {
  if (n <= 0) return -1;
  return Math.min(n - 1, Math.floor(rng() * n));
}

export function toAttemptResult(r: SpeedReadResult): AttemptResult {
  return {
    correct: r.missing ? true : r.passed,
    nearMiss: false,
    hintUsed: false,
    guard: false,
    timedOut: false,
    ms: r.ms,
    errorTags: [],
    score: r.total > 0 ? r.correct / r.total : 0,
  };
}

export function SpeedRead(p: SpeedReadProps | ExerciseProps): JSX.Element {
  if (isExerciseProps(p)) {
    const storyId = p.step.params.storyId ?? p.step.itemId ?? '';
    return <SpeedReadView key={p.step.id} storyId={storyId} furigana={p.furigana} onDone={(r) => p.onResult(toAttemptResult(r))} {...(p.step.params.rate !== undefined ? { rate: p.step.params.rate } : {})} />;
  }
  return <SpeedReadView {...p} />;
}

type Phase = 'ready' | 'reading' | 'question';

/** Enter starts / nothing else during the reveal; registered with the frame while mounted. */
function StartKeys(p: { onStart(): void }): null {
  useExerciseKeys({ onSubmit: p.onStart });
  return null;
}

export function SpeedReadView(p: SpeedReadProps): JSX.Element {
  const loader = p.loader ?? content;
  const settings = store.settings.value;
  const station = p.station ?? store.progress.value.station;
  const rate = p.rate !== undefined && p.rate > 0 ? Math.round(p.rate) : cpmTargetForStation(station);
  const furigana: FuriganaMode = (p.furigana ?? settings.furigana) === 'off' ? 'off' : 'always';
  const bestBefore = store.stats.value.speedReadBestCpm;

  const [fetched, setFetched] = useState<StoryItem | null | 'missing'>(() => {
    const it = loader.get(p.storyId);
    return isStoryItem(it) ? it : null;
  });
  const story = fetched === 'missing' ? null : fetched;
  useEffect(() => {
    if (fetched !== null) return;
    let alive = true;
    loader
      .getAsync(p.storyId)
      .then((it) => {
        if (alive) setFetched(isStoryItem(it) ? it : 'missing');
      })
      .catch(() => {
        if (alive) setFetched('missing');
      });
    return () => {
      alive = false;
    };
  }, [fetched, loader, p.storyId]);

  const [phase, setPhase] = useState<Phase>('ready');
  const [shown, setShown] = useState(0);
  const startedAt = useRef<number | null>(null);
  const readMs = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const finished = useRef(false);
  const latest = useRef(p);
  latest.current = p;

  const lines = story?.lines ?? [];
  const n = lines.length;
  const chars = useMemo(() => (story ? charCount(story.lines) : 0), [story]);
  const schedule = useMemo(() => revealSchedule(lines, rate), [lines, rate]);
  const rng = useMemo(() => rngFor(store.seed(), store.today(), p.storyId, 'speed-read'), [p.storyId]);
  const questionIndex = useMemo(() => pickQuestionIndex(story?.comprehension.length ?? 0, rng), [story, rng]);
  const question = story && questionIndex >= 0 ? story.comprehension[questionIndex] : undefined;

  const clearTimers = (): void => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const start = (): void => {
    if (phase !== 'ready' || !story) return;
    startedAt.current = store.now();
    setPhase('reading');
    setShown(1);
    clearTimers();
    for (let i = 1; i <= n; i++) {
      const at = schedule[i] ?? 0;
      timers.current.push(
        setTimeout(() => {
          if (i < n) setShown(i + 1);
          else {
            readMs.current = Math.max(0, store.now() - (startedAt.current ?? store.now()));
            setPhase('question');
          }
        }, at),
      );
    }
  };

  const finish = (correct: number, total: number): void => {
    if (finished.current || !story) return;
    finished.current = true;
    clearTimers();
    const ms = readMs.current;
    const measured = cpmOf(chars, ms) || rate;
    const passed = total > 0 && correct >= total;
    const minutes = Math.round(ms / 60_000);
    const payload: Events['story:read'] = { storyId: story.id, mode: 'speed', chars, cpm: measured, correct, total, glossTaps: 0, minutes, bridge: story.bridge === true };
    bus.emit('story:read', payload);
    latest.current.onDone({
      storyId: story.id,
      correct,
      total,
      passed,
      cpm: measured,
      targetCpm: rate,
      band: cpmBand(measured, levelForStation(station) ?? 'n5'),
      chars,
      ms,
      minutes,
      newBest: passed && measured > bestBefore,
      missing: false,
    });
  };

  const skipMissing = (): void => {
    if (finished.current) return;
    finished.current = true;
    latest.current.onDone({ storyId: p.storyId, correct: 0, total: 0, passed: false, cpm: 0, targetCpm: rate, band: 'below', chars: 0, ms: 0, minutes: 0, newBest: false, missing: true });
  };

  if (fetched === 'missing') {
    return (
      <section class="speed" aria-label={S.speedTitle} data-state="missing">
        <div class="notice notice--warn" role="status">
          <strong>{S.speedMissing}</strong>
        </div>
        <div>
          <button type="button" class="btn" onClick={skipMissing} data-action="skip">
            {S.resultContinue}
          </button>
        </div>
      </section>
    );
  }
  if (!story) {
    return (
      <section class="speed" aria-label={S.speedTitle} data-state="loading">
        <p class="reader__hint" role="status">
          {S.storyLoading}
        </p>
      </section>
    );
  }

  return (
    <section class="speed" aria-label={S.speedTitle} data-state={phase} data-rate={rate}>
      <header class="reader__head">
        <h2 class="reader__title" lang="ja">
          <Ruby ja={story.titleJa} mode={furigana} />
        </h2>
        <p class="reader__title-en">
          {S.speedTitle} · {story.titleEn}
        </p>
      </header>

      {phase === 'ready' ? (
        <div class="speed__meta">
          <StartKeys onStart={start} />
          <p>{S.speedIntro}</p>
          <p class="speed__pace" data-field="pace">
            {fill(S.speedPace, { n: rate })}
          </p>
          <p class="reader__hint">
            {fill(S.charsLabel, { n: chars })} · {fill(S.linesLabel, { n })}
          </p>
          <p class="reader__hint" data-field="best">
            {bestBefore > 0 ? fill(S.speedBest, { n: bestBefore }) : S.speedBestNone}
          </p>
          <div>
            <button type="button" class="btn" onClick={start} data-action="start" aria-keyshortcuts="Enter">
              {S.speedStart}
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'reading' ? (
        <>
          <div class="reader__toolbar">
            <span class="reader__progress" aria-live="polite" data-field="progress">
              {fill(S.speedLine, { i: shown, n })}
            </span>
            <span class="reader__hint">{fill(S.speedReading, { n: rate })}</span>
          </div>
          <div class="meter" role="progressbar" aria-valuemin={0} aria-valuemax={n} aria-valuenow={shown} aria-label={S.speedTitle} style={{ '--value': n > 0 ? shown / n : 0, '--meter-tone': 'var(--ai)' } as JSX.CSSProperties}>
            <span class="meter__fill" />
          </div>
          <ol class="speed__lines" aria-label={S.speedTitle}>
            {lines.slice(0, shown).map((line, i) => (
              <li key={i} class="speed__line" data-line={i} data-latest={i === shown - 1 ? 'true' : undefined}>
                {line.speaker ? (
                  <span class="reader__speaker" lang="ja">
                    {line.speaker}{' '}
                  </span>
                ) : null}
                <Ruby ja={line.ja} mode={furigana} />
              </li>
            ))}
          </ol>
        </>
      ) : null}

      {phase === 'question' ? (
        <>
          <p class="reader__hint">{S.speedQuestionIntro}</p>
          <Comprehension questions={question ? [question] : []} onDone={(r) => finish(r.correct, r.total)} />
        </>
      ) : null}
    </section>
  );
}
