/**
 * TSUZUKU — 連続技 Rapid Fire (design 04 §9, 05 §4/§8): a 60-second blitz
 * over mature cards only (`params.pool`, built by `learn.rapidFirePool`:
 * rec / read / cloze with S ≥ 14 d). Combo counter, arcade skin; speed is
 * trained apart from accuracy.
 *
 *  · Prompts (`promptFor`): rec → meaning in English (kana → romaji,
 *    component → keyword); read → reading of an example word; cloze → the
 *    missing piece of an example sentence. Order = seeded shuffle of the pool
 *    (`store.seed() + today + step.id`), wrapping if the clock outlasts it.
 *  · Every rep goes through `recordAttempt` (the contract writer) with a
 *    synthetic per-card step: `learn/grading` turns a miss into the card's
 *    `recheck` flag (re-tested untimed next session, never Again directly) and
 *    a correct answer into nothing — except Good on a Kaiden-lane card.
 *  · The round ends on the clock or on Finish: `arcade:done {mode:'rapid',
 *    correct, misses, ms, recheck}` is emitted once; B decides XP (first run
 *    of the day only) and `stats.rapidBest`. Then Continue hands the runner a
 *    clean summary result (facet null, nothing to grade).
 * Keys `kana` (the frame forwards Enter; the typed widgets own the field).
 * The Start / Continue buttons are rendered after load and take focus through
 * `useAutoFocus` (a dynamic `autofocus` attribute is ignored).
 *
 * Design 09 §2.5 / §5.6–§5.8 / §10 D1: the round is a woodblock print — the
 * head is a `.poster-title`, the clock has a `.meter`, every count rolls through
 * `<Ticker roll>`, the card is a `.sheet` that presses (osu) on a hit, the tally
 * tiles stagger in (`--i`), and the BEST eyebrow compares the round with the
 * learner's OWN `stats.rapidBest` only, never on a miss (footnote 5). The
 * frame's step turn is the result panel's exit (C1's ghost, `data-leaving`).
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { content } from '@/content/loader';
import { toPlain } from '@/content/ruby';
import type { CardKey, ComponentDef, ContentItem, ErrorTag, Facet, GrammarItem, KanaItem, KanjiItem, VocabItem } from '@/content/types';
import { recordAttempt } from '@/learn/apply';
import { bus } from '@/shared/events';
import type { ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { rngFor, shuffle } from '@/shared/hash';
import { parseCardKey } from '@/shared/ids';
import type { AttemptResult, Step } from '@/shared/session-types';
import { Ticker } from '@/shared/ui/Ticker';
import { useAutoFocus } from '@/shared/ui/use-auto-focus';
import { useTimer } from '@/shared/ui/use-timer';
import { store } from '@/store';
import { attempt } from '../check';
import { TextAnswer, type TextAnswerResult } from '../TextAnswer';
import { S as RS } from './rapid-strings';
import { S, fill } from './strings';
import './RapidFire.css';

export const meta: ExerciseMeta = {
  id: 'rapid-fire',
  facet: null,
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'kana',
};

/** Round length (design 04 §9); `params.seconds` overrides it. */
export const ROUND_MS = 60_000;

/* ────────────────────────────────────────────────────────────────────────── */
/* Prompts                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export interface RapidPrompt {
  key: CardKey;
  itemId: string;
  facet: Facet;
  item: ContentItem;
  /** `en` → English field (fuzzy), `ja` → kana IME (checkJa). */
  mode: 'en' | 'ja';
  label: string;
  /** Japanese shown (plain, no ruby — kanji are the point of a read card). */
  promptJa: string;
  /** Kana shown small under the prompt (rec on a kanji word). */
  sub?: string;
  accept: string[];
  missTags?: ErrorTag[];
  particleSlip?: boolean;
}

const isVocab = (i: ContentItem): i is VocabItem => 'word' in i && 'kana' in i && 'meanings' in i;
const isKana = (i: ContentItem): i is KanaItem => 'kana' in i && 'romaji' in i && 'script' in i;
const isKanji = (i: ContentItem): i is KanjiItem => 'char' in i && 'strokes' in i;
const isGrammar = (i: ContentItem): i is GrammarItem => 'pattern' in i && 'clozeHints' in i;
const isComponent = (i: ContentItem): i is ComponentDef => 'char' in i && 'name' in i && !('strokes' in i);

/** The prompt for one card, or `null` when the card cannot be drilled (item missing, facet not arcade-shaped). */
export function promptFor(key: CardKey, item: ContentItem | undefined, rep: number): RapidPrompt | null {
  let parsed: { itemId: string; facet: Facet };
  try {
    parsed = parseCardKey(key);
  } catch {
    return null;
  }
  if (!item) return null;
  const base = { key, itemId: parsed.itemId, facet: parsed.facet, item };
  if (parsed.facet === 'rec') {
    if (isVocab(item)) return { ...base, mode: 'en', label: S.promptRec, promptJa: item.word, sub: item.kana !== item.word ? item.kana : undefined, accept: item.meanings, missTags: ['word-choice'] };
    if (isKana(item)) return { ...base, mode: 'en', label: S.promptRomaji, promptJa: item.kana, accept: [item.romaji] };
    if (isComponent(item)) return { ...base, mode: 'en', label: S.promptKeyword, promptJa: item.char, accept: [item.name], missTags: ['kanji-meaning'] };
    return null;
  }
  if (parsed.facet === 'read' && isKanji(item)) {
    const n = item.examples.length;
    const ex = n > 0 ? item.examples[rep % n] : undefined;
    const word = ex?.word ?? item.char;
    const accept = ex ? [ex.kana] : [...item.kun.map((k) => k.replace('.', '')), ...item.on];
    if (accept.length === 0) return null;
    return { ...base, mode: 'ja', label: S.promptRead, promptJa: word, accept, missTags: ['kanji-reading'], particleSlip: false };
  }
  if (parsed.facet === 'cloze' && isGrammar(item)) {
    const n = item.examples.length;
    if (n === 0 || item.clozeHints.length === 0) return null;
    const ex = item.examples[rep % n] as GrammarItem['examples'][number];
    const plain = toPlain(ex.ja);
    const hint = item.clozeHints.find((h) => plain.includes(h)) ?? (item.clozeHints[0] as string);
    const shown = plain.includes(hint) ? plain.replace(hint, '＿＿') : plain;
    return { ...base, mode: 'ja', label: S.promptCloze, promptJa: shown, sub: ex.en, accept: [hint], particleSlip: false };
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

type Phase = 'intro' | 'run' | 'over';

interface Tally {
  correct: number;
  misses: number;
  combo: number;
  bestCombo: number;
  recheck: CardKey[];
  reps: number;
}

interface Summary extends Tally {
  ms: number;
  bestBefore: number;
  paid: boolean | null;
}

const freshTally = (): Tally => ({ correct: 0, misses: 0, combo: 0, bestCombo: 0, recheck: [], reps: 0 });

export function RapidFire(p: ExerciseProps): JSX.Element {
  const { step } = p;
  const pool = useMemo(() => (step.params.pool ?? []).filter((k, i, a) => a.indexOf(k) === i), [step.params]);
  const roundMs = step.params.seconds ? Math.max(5, step.params.seconds) * 1000 : ROUND_MS;
  const order = useMemo(() => shuffle(rngFor(store.seed(), store.today(), step.id, 'rapid'), pool), [pool, step.id]);

  const [phase, setPhase] = useState<Phase>('intro');
  const [idx, setIdx] = useState(0);
  const [tally, setTally] = useState<Tally>(freshTally);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [flash, setFlash] = useState<'hit' | 'miss' | null>(null);
  const promptAt = useRef(store.now());
  const live = useRef({ phase, idx, tally });
  live.current = { phase, idx, tally };
  const finishRef = useRef<() => void>(() => undefined);

  const timer = useTimer({
    deadlineMs: roundMs,
    running: phase === 'run',
    now: store.now,
    onTimeout: () => finishRef.current(),
  });

  useEffect(() => {
    setPhase('intro');
    setIdx(0);
    setTally(freshTally());
    setSummary(null);
    setFlash(null);
  }, [step.id]);

  const prompt = useMemo(() => {
    if (phase !== 'run' || order.length === 0) return null;
    // skip cards whose item is not loaded or not drillable (at most one lap)
    for (let n = 0; n < order.length; n++) {
      const i = (idx + n) % order.length;
      const key = order[i] as CardKey;
      const pr = promptFor(key, content.get(key.split('#')[0] as string), Math.floor((idx + n) / order.length));
      if (pr) return { ...pr, at: idx + n };
    }
    return null;
  }, [phase, idx, order]);

  useEffect(() => {
    promptAt.current = store.now();
  }, [prompt?.at]);

  // The one primary button of the intro / summary screens (Start, Continue).
  const primary = useRef<HTMLButtonElement>(null);
  useAutoFocus(primary, [phase]);

  const start = (): void => {
    if (live.current.phase !== 'intro') return;
    setTally(freshTally());
    setIdx(0);
    setSummary(null);
    timer.reset();
    setPhase('run');
  };

  const finish = (): void => {
    if (live.current.phase !== 'run') return;
    const t = live.current.tally;
    const ms = Math.round(Math.min(roundMs, timer.elapsed.peek()));
    const bestBefore = store.stats.value.rapidBest;
    let paid: boolean | null = bus.listenerCount('arcade:done') > 0 ? false : null;
    const off = bus.on('xp:gained', (e) => {
      if (e.reason === 'rapid-fire') paid = true;
    });
    bus.emit('arcade:done', { mode: 'rapid', correct: t.correct, misses: t.misses, ms, recheck: t.recheck.slice() });
    off();
    setSummary({ ...t, ms, bestBefore, paid });
    setPhase('over');
  };
  finishRef.current = finish;

  const record = (pr: RapidPrompt & { at: number }, result: AttemptResult): void => {
    const card = store.cards.get(pr.key);
    const repStep: Step = {
      id: `${step.id}:${pr.at}`,
      block: step.block,
      exercise: 'rapid-fire',
      itemId: pr.itemId,
      cardKey: pr.key,
      params: {},
      timed: true,
      timerMs: roundMs,
      isNew: false,
      stepTag: null,
      exposures: card ? card[3] : 0,
      estMs: 3000,
    };
    try {
      recordAttempt({ sessionId: step.id, step: repStep, result, keys: pr.mode === 'ja' ? 'kana' : 'text', item: pr.item, speedRingShown: p.feel !== 'zen' });
    } catch (err) {
      console.error('[rapid-fire] recordAttempt failed', err);
    }
  };

  const advance = (hit: boolean, pr: RapidPrompt & { at: number }, result: AttemptResult): void => {
    const s = live.current;
    if (s.phase !== 'run') return;
    record(pr, result);
    const t = s.tally;
    const combo = hit ? t.combo + 1 : 0;
    const next: Tally = {
      correct: t.correct + (hit ? 1 : 0),
      misses: t.misses + (hit ? 0 : 1),
      combo,
      bestCombo: Math.max(t.bestCombo, combo),
      recheck: hit || t.recheck.includes(pr.key) ? t.recheck : [...t.recheck, pr.key],
      reps: t.reps + 1,
    };
    setTally(next);
    setFlash(hit ? 'hit' : 'miss');
    setIdx(pr.at + 1);
  };

  const onSubmit = (pr: RapidPrompt & { at: number }) => (r: TextAnswerResult) => {
    const ms = Math.max(0, store.now() - promptAt.current);
    const hit = r.correct && !r.nearMiss;
    advance(hit, pr, attempt({ ms, correct: r.correct, nearMiss: r.nearMiss, errorTags: r.tags, answer: r.given }));
  };

  const pass = (pr: RapidPrompt & { at: number }): void => {
    const ms = Math.max(0, store.now() - promptAt.current);
    advance(false, pr, attempt({ ms, correct: false, answer: '' }));
  };

  const continueOut = (): void => {
    const sm = summary;
    const total = sm ? sm.reps : 0;
    p.onResult(attempt({ ms: sm?.ms ?? 0, correct: true, score: total > 0 && sm ? sm.correct / total : 0, answer: sm ? `${sm.correct}/${total}` : '0/0' }));
  };

  const zen = p.feel === 'zen';
  const secondsLeft = Math.ceil(timer.remaining.value / 1000);
  const timeLeft = Math.max(0, Math.min(1, timer.remaining.value / roundMs));
  const best = store.stats.value.rapidBest;

  if (phase === 'intro') {
    return (
      <div class="rapid" data-feel={p.feel} data-phase="intro">
        <h2 class="rapid__title poster-title">
          <span lang="ja">連続技</span> {S.rapidTitle}
        </h2>
        <p class="rapid__intro">{roundMs === ROUND_MS ? S.rapidIntro : fill(S.rapidIntroSeconds, { n: Math.round(roundMs / 1000) })}</p>
        <p class="rapid__meta">
          <span>{fill(S.cardsInPool, { n: pool.length })}</span>
          <span>
            {S.personalBest}:{' '}
            <strong class="rapid__num">
              <Ticker value={best} />
            </strong>
          </span>
        </p>
        {pool.length > 0 ? (
          <button type="button" class="hanko hanko--lg" onClick={start} ref={primary}>
            {S.start}
          </button>
        ) : (
          <>
            <p class="rapid__empty" role="status">
              {S.emptyPool}
            </p>
            <button type="button" class="hanko" onClick={continueOut} ref={primary}>
              {S.continue}
            </button>
          </>
        )}
      </div>
    );
  }

  if (phase === 'over' && summary) {
    const newBest = summary.correct > summary.bestBefore;
    // the BEST eyebrow: only against the learner's own previous best, and only once there is one (footnote 5)
    const bestEyebrow = newBest && summary.bestBefore > 0;
    const tiles: [string, number, string | undefined][] = [
      [S.correctLabel, summary.correct, undefined],
      [S.missesLabel, summary.misses, undefined],
      ...(!zen ? ([[S.bestCombo, summary.bestCombo, undefined]] as [string, number, string | undefined][]) : []),
      [S.personalBest, Math.max(summary.bestBefore, summary.correct), newBest ? 'true' : undefined],
    ];
    return (
      <div class="rapid" data-feel={p.feel} data-phase="over">
        <h2 class="rapid__title poster-title poster-title--m">{S.roundOver}</h2>
        <p class="eyebrow rapid__eyebrow">{RS.tallyEyebrow}</p>
        {bestEyebrow ? <p class="eyebrow rapid__best-eyebrow">{fill(RS.bestEyebrow, { n: summary.bestBefore })}</p> : null}
        <dl class="rapid__tally sheet hiscore">
          {tiles.map(([label, value, isNew], i) => (
            <div key={label} class="ink-nijimi" style={{ '--i': String(i) }}>
              <dt class="eyebrow">{label}</dt>
              <dd class="rapid__num" data-new={isNew}>
                <Ticker value={value} roll />
              </dd>
            </div>
          ))}
        </dl>
        {newBest ? <p class="rapid__best">{S.newBest}</p> : null}
        <p class="rapid__note">{S.recheckNote}</p>
        {summary.paid === true ? <p class="rapid__xp">{S.firstRunXp}</p> : summary.paid === false ? <p class="rapid__xp">{S.freePlay}</p> : null}
        <button type="button" class="hanko" onClick={continueOut} ref={primary}>
          {S.continue}
        </button>
      </div>
    );
  }

  return (
    <div class="rapid" data-feel={p.feel} data-phase="run" data-flash={flash ?? undefined}>
      <div class="rapid__hud">
        <span class="rapid__clock" role="timer" aria-label={S.timerLabel} data-low={secondsLeft <= 10 ? 'true' : undefined}>
          <span class="rapid__num">{fill(S.secondsLeft, { n: secondsLeft })}</span>
        </span>
        <span class="meter rapid__time" style={{ '--value': timeLeft.toFixed(3) }} data-low={secondsLeft <= 10 ? 'true' : undefined} aria-hidden="true">
          <span class="meter__fill" />
        </span>
        {/* the press (osu) lands here: the card is replaced by the next prompt at the moment of the hit, so the count — the number that matters — takes the press while its Ticker ticks (RapidFire.css) */}
        <span class="rapid__count" aria-live="polite">
          <Ticker value={tally.correct} roll format={(n) => fill(S.correctCount, { n: Math.round(n) })} />
        </span>
        {!zen && tally.combo > 1 ? (
          <span class="combo" data-tier={tally.combo >= 50 ? 3 : tally.combo >= 25 ? 2 : tally.combo >= 10 ? 1 : 0} aria-label={`${tally.combo} ${S.combo}`}>
            {tally.combo}
            <small>{S.combo}</small>
          </span>
        ) : null}
      </div>

      {prompt ? (
        <div class="rapid__card sheet" key={prompt.at}>
          <p class="eyebrow rapid__label">{prompt.label}</p>
          <p class="rapid__prompt" lang="ja">
            {prompt.promptJa}
          </p>
          {prompt.sub ? (
            <p class="rapid__sub" lang={prompt.facet === 'cloze' ? undefined : 'ja'}>
              {prompt.sub}
            </p>
          ) : null}
          <TextAnswer
            key={`${step.id}:${prompt.at}`}
            mode={prompt.mode}
            accept={prompt.accept}
            missTags={prompt.missTags}
            particleSlip={prompt.particleSlip}
            allowOverride={false}
            reveal={false}
            autoFocus
            onSubmit={onSubmit(prompt)}
          />
          <div class="rapid__controls">
            <button type="button" class="btn btn--ghost btn--sm" onClick={() => pass(prompt)}>
              {S.pass}
            </button>
            <button type="button" class="btn btn--ghost btn--sm" onClick={finish}>
              {S.finish}
            </button>
          </div>
        </div>
      ) : (
        <div class="rapid__card sheet">
          <p class="rapid__empty" role="status">
            {S.itemMissing}
          </p>
          <button type="button" class="hanko" onClick={finish}>
            {S.finish}
          </button>
        </div>
      )}
    </div>
  );
}
