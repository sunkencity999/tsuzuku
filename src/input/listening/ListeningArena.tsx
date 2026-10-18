/**
 * TSUZUKU — 聴解 Listening Arena (design 04 §5 `listening-set`, 03 §2.3 Input, 08 §9–§11).
 *
 * A dialogue, monologue or audio-first piece (`StoryItem`), AUDIO ONLY, at
 * the step's speed tier — or, in POOL MODE (the Ear Walk, design 08 §10.4),
 * 6–8 pool sentences (`StepParams.refs` / `props.refs`) heard as one set:
 *   1. listen      whole text, no transcript; replay budget 2
 *   2. questions   5–8 items, QUESTIONS FIRST: comprehension questions (gist,
 *                  then by `kind`; a miss on a question with `lineRef` replays
 *                  that line), then per-line choice (meaning ≤ Orange, the
 *                  Japanese line from Green) and dictation (KanaInput, mora
 *                  similarity, ≥ 0.95 Good · ≥ 0.80 Hard · else Again; second
 *                  replay caps at Hard; a line over 22 morae dictates one
 *                  clause when the served cue has clause boundaries)
 *   3. transcript  <Ruby> reveal with karaoke — line highlight on every path,
 *                  a token sweep from the clip player's `onProgress` at ≥ 1.0×,
 *                  mora dots when the served cue is the natural-slow take — the
 *                  VOICEVOX credit per speaker, and the MANDATORY re-listen +0.1×
 *   4. done        emits `listening:set` (genre / bridge / authentic / cold /
 *                  mode; `storyId: null` + `refs` in walk mode); a passed set
 *                  appends the text id to `progress.listened` and stamps
 *                  `progress.arenaAt[id] = today` (design 08 §10.2: the Arena
 *                  is the ONLY writer; Radio reads it for its 14-day "worked
 *                  on recently" rule; a walk writes neither); a clean set at
 *                  the tier rate OFFERS the next tier (never silently)
 * Every line speaks with its clip key (`${story.id}#L${i}`, or the pool ref)
 * and `speaker` (the line's label or the text's `narrator`), so the pack
 * resolves the cast voice and the device voice stays the fallback. The header
 * names the speakers and the source ("3 voices · synthetic" / "2 voices ·
 * device" / "text only"). Listen-facet evidence: a transcribed content word →
 * Good on its `listen` card due within 3 days, a missed one → Again
 * (`result.implicit` in a session; `recordImplicit` standalone); a pool
 * example without tokens is graded over the pool's `ids`. A whole-line
 * dictation in the Good band at ≥ 1× writes its plain surface to
 * `profile.dictatedSentence` (the Waveform kakejiku's text; newest wins).
 * Constants, the set builder and the graders live in `./set.ts`, the walk
 * builder in `./walk.ts`, the karaoke spans in `./karaoke.ts`; all re-exported.
 *
 * Export convention (D): `meta` + the component; `ListeningArena` takes the
 * standalone props OR `ExerciseProps` (`params.storyId` / `params.refs`,
 * `params.rate`): `registerExercise(meta, ListeningArena)`. Deterministic: the
 * set draws from `rngFor(seed, today, storyId)` (walk: `WALK_SEED_TAG` + refs);
 * time comes from `store.now()`. The text fallback gates on `voiceAudible`.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { voiceAudible } from '@/audio';
import { content, type ContentLoader } from '@/content/loader';
import { hasKanji, toPlain } from '@/content/ruby';
import { AUTHENTIC_GENRES, BRIDGE_FROM_STATION, isAuthenticText, type CardKey, type ErrorTag, type PoolRef, type StoryItem, type StoryLine } from '@/content/types';
import { knownSet } from '@/learn';
import { recordImplicit } from '@/learn/apply';
import { SPEED_TIER_RATES, audioSourceOf, services, servicesVersion, sfx, speak, type AudioSource, type ClipCue, type SpeakOptions } from '@/shared/audio';
import { bus, type Events } from '@/shared/events';
import type { ExerciseMeta, ExerciseProps, FeedbackState } from '@/shared/exercise-types';
import { rngFor } from '@/shared/hash';
import { containsJapanese, normalizeJa } from '@/shared/jp';
import type { AttemptResult } from '@/shared/session-types';
import type { Feel, FuriganaMode, Rating, SpeedTier } from '@/shared/store-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { Feedback } from '@/shared/ui/Feedback';
import { KanaInput } from '@/shared/ui/KanaInput';
import { Ruby } from '@/shared/ui/Ruby';
import { TeachOnce, markTeachSeen } from '@/shared/ui/TeachOnce';
import { store } from '@/store';
import { activeToken, clauseKana, clauseText, isSlowCue, speechMoraCount, tokenMoraSpans, type MoraSpan } from './karaoke';
import { IMPLICIT_WINDOW_DAYS, JA_CHOICES_FROM_STATION, PASS_RATIO, REPLAY_BUDGET, buildListeningSet, gradeDictation, implicitListenGrades, isStoryItem, relistenRate, slotFor, voiceSlots, type ListenItem } from './set';
import { GENRE_LABEL, S, fill } from './strings';
import { WALK_SEED_TAG, buildWalkSet, heardLines, parseRef, poolRefFor, resolveRef, type WalkLine } from './walk';
import './ListeningArena.css';

export const meta: ExerciseMeta = {
  id: 'listening-set',
  facet: null,
  needsTts: true,
  needsStt: false,
  selfGraded: false,
  timeable: false,
  keys: 'choices',
};

export {
  CLAUSE_MIN_MORAE,
  DICTATION_MAX_MORAE,
  IMPLICIT_WINDOW_DAYS,
  JA_CHOICES_FROM_STATION,
  PASS_RATIO,
  QUESTION_KIND_RANK,
  RELISTEN_DELTA,
  REPLAY_BUDGET,
  SET_MAX,
  SET_MIN_LINES,
  SET_TARGET,
  buildListeningSet,
  choiceItem,
  dictable,
  dictationTarget,
  gradeDictation,
  implicitListenGrades,
  isStoryItem,
  orderQuestions,
  pickClause,
  relistenRate,
  slotFor,
  voiceSlots,
  wordSurfacesIn,
  type DictationGrade,
  type EvidenceOptions,
  type ListenItem,
  type SetOptions,
} from './set';
export { NATURAL_SLOW_RATE, activeToken, clauseKana, clauseSpans, clauseText, isSlowCue, speechMoraCount, tokenMoraSpans, type MoraSpan } from './karaoke';
export { WALK_MAX, WALK_SEED_TAG, WALK_TARGET, buildWalkSet, heardLines, parseRef, poolRefFor, resolveRef, type ParsedRef, type WalkLine, type WalkOptions } from './walk';

/** A dictation counts as "perfect" for `profile.dictatedSentence` at normal speed or faster (≥ 0.95 at 1×, store-types `Profile`). */
export const DICTATED_MIN_RATE = 1;
/** Pools exist from this station (design 08 §3: Stations 1–3 hold no pieces and no pools). */
export const FIRST_POOL_STATION = 4;
/** TeachOnce ids (design 08 §11; lowercase ASCII per `TEACH_ID_RE`). */
export const TEACH_ARENA_FIRST = 'arena-first';
export const TEACH_ARENA_BRIDGE = 'arena-bridge';

/* ────────────────────────────────────────────────────────────────────────── */
/* Props                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export interface ListeningArenaResult {
  correct: number;
  total: number;
}

/** The loader the Arena needs: items by id, and (walk mode) the station pools when the loader has them. */
export type ArenaLoader = Pick<ContentLoader, 'get' | 'getAsync'> & Partial<Pick<ContentLoader, 'pool'>>;

export interface ListeningArenaProps {
  /** Text mode: the story / piece id. Ignored when `refs` is given. */
  storyId?: string;
  /** Pool mode — the Ear Walk (design 08 §10.4): the pool refs to hear instead of a text. */
  refs?: readonly string[];
  /** Playback rate (the learner's speed tier preset, or the step's `params.rate`). */
  rate: number;
  onDone(r: ListeningArenaResult): void;
  /** Content access (default: the live loader); tests pass `createFakeLoader()`. */
  loader?: ArenaLoader;
  /** Logged on implicit grades; default `listen:<storyId>` / `listen:walk`. */
  sessionId?: string;
}

interface ArenaProps extends ListeningArenaProps {
  story?: StoryItem;
  feel?: Feel;
  furigana?: FuriganaMode;
  /** Session path: the runner applies `implicit`; the Arena then never writes cards itself. */
  onResult?(r: AttemptResult): void;
  onReplay?(): void;
}

type Phase = 'listen' | 'questions' | 'transcript' | 'done';

interface ItemOutcome {
  correct: boolean;
  rating: Rating | null;
  score?: number;
  tags: ErrorTag[];
  feedback: FeedbackState;
}

/** What the set is over: a text, or the walk's resolved pool refs. */
type Source = { kind: 'text'; story: StoryItem } | { kind: 'walk'; refs: PoolRef[]; lines: WalkLine[] };

/** Karaoke level of a line on the re-listen (design 08 §9): the sweep needs ≥ 1.0×, the dots a natural-slow cue, synth stays line-level. */
type Karaoke = 'line' | 'tokens' | 'morae';

/* ────────────────────────────────────────────────────────────────────────── */
/* Walk resolution                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Resolves the planner's refs to `PoolRef`s: the items are loaded, then every
 * pool ≤ `station` that the loader can serve is consulted for the refs' ids
 * (the planner read those same pools, so they are already in memory); a ref
 * no pool holds is rebuilt from the content (`poolRefFor`) or dropped. A
 * pool-held ref whose sentence the content cannot resolve (a stale pool, a
 * failed item fetch) comes back as-is: the caller zips refs and lines and
 * drops it there, so the two arrays stay aligned index by index.
 */
async function resolveWalk(refs: readonly string[], loader: ArenaLoader, station: number): Promise<PoolRef[]> {
  const parsed = refs.map(parseRef);
  const ids = Array.from(new Set(parsed.flatMap((p) => (p ? [p.id] : []))));
  await Promise.all(ids.map((id) => loader.getAsync(id).catch(() => undefined)));
  const index = new Map<string, PoolRef>();
  if (loader.pool && parsed.some((p) => p?.kind === 'ex')) {
    const wanted = new Set(refs);
    const stations: number[] = [];
    for (let n = FIRST_POOL_STATION; n <= station; n++) stations.push(n);
    const pools = await Promise.all(stations.map((n) => (loader.pool as NonNullable<ArenaLoader['pool']>)(n).catch(() => null)));
    for (const pool of pools) {
      if (!pool) continue;
      for (const r of pool.refs) if (wanted.has(r.ref) && !index.has(r.ref)) index.set(r.ref, r);
    }
  }
  const get = (id: string): ReturnType<ArenaLoader['get']> => loader.get(id);
  const out: PoolRef[] = [];
  for (const ref of refs) {
    const pr = index.get(ref) ?? poolRefFor(ref, get);
    if (pr) out.push(pr);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/** The session path may carry the test-injection `loader` beside the contract props (the `src/input/index.ts` convention). */
type ArenaExerciseProps = ExerciseProps & Partial<Pick<ListeningArenaProps, 'loader'>>;

export function ListeningArena(p: ListeningArenaProps | ArenaExerciseProps): JSX.Element {
  if ('step' in p) {
    const params = p.step.params;
    const refs = params.refs && params.refs.length > 0 ? params.refs : undefined;
    const storyId = params.storyId ?? p.step.itemId ?? '';
    const rate = params.rate ?? SPEED_TIER_RATES[p.speedTier];
    const story = !refs && isStoryItem(p.item) && p.item.id === storyId ? p.item : undefined;
    return (
      <Arena
        key={refs ? `walk:${refs.join(',')}` : storyId}
        storyId={storyId}
        refs={refs}
        rate={rate}
        story={story}
        feel={p.feel}
        furigana={p.furigana}
        sessionId={p.step.id}
        loader={p.loader}
        onDone={() => undefined}
        onResult={p.onResult}
        onReplay={p.onReplay}
      />
    );
  }
  return <Arena key={p.refs && p.refs.length > 0 ? `walk:${p.refs.join(',')}` : (p.storyId ?? '')} {...p} />;
}

function Arena(p: ArenaProps): JSX.Element {
  const loader = p.loader ?? content;
  const settings = store.settings.value;
  const furigana = p.furigana ?? settings.furigana;
  const feel = p.feel ?? settings.feel;
  const progress = store.progress.value;
  const station = progress.station;
  const inSession = typeof p.onResult === 'function';
  const walkRefs = p.refs && p.refs.length > 0 ? p.refs : undefined;
  const storyId = walkRefs ? '' : (p.storyId ?? '');
  const sessionId = p.sessionId ?? (walkRefs ? 'listen:walk' : `listen:${storyId}`);

  const [source, setSource] = useState<Source | null | undefined>(() => {
    if (walkRefs) return undefined;
    if (p.story) return { kind: 'text', story: p.story };
    const it = loader.get(storyId);
    return it === undefined ? undefined : isStoryItem(it) ? { kind: 'text', story: it } : null;
  });
  useEffect(() => {
    if (source !== undefined) return;
    let alive = true;
    const settle = (s: Source | null): void => {
      if (alive) setSource(s);
    };
    if (walkRefs) {
      resolveWalk(walkRefs, loader, station)
        .then((refs) => {
          // Zip before dropping: `refs[k]` and `lines[k]` must always name the same sentence
          // (the set's `lineIndex`, the clip keys and the payload's `refs` all index them together).
          const resolved = refs.flatMap((r) => {
            const l = resolveRef(r, (id) => loader.get(id));
            return l ? [{ r, l }] : [];
          });
          settle(resolved.length > 0 ? { kind: 'walk', refs: resolved.map((x) => x.r), lines: resolved.map((x) => x.l) } : null);
        })
        .catch(() => settle(null));
    } else {
      loader
        .getAsync(storyId)
        .then((it) => settle(isStoryItem(it) ? { kind: 'text', story: it } : null))
        .catch(() => settle(null));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, loader, storyId, walkRefs?.join(',')]);

  const story = source?.kind === 'text' ? source.story : null;
  const walk = source?.kind === 'walk' ? source : null;
  const lines: readonly StoryLine[] = useMemo(() => (story ? story.lines : (walk?.lines ?? [])), [story, walk]);
  const slots = useMemo(() => voiceSlots(lines), [lines]);
  const narratorName = story?.narrator ?? S.narrationName;
  const speakerOf = (line: StoryLine): string | undefined => line.speaker ?? story?.narrator;
  const clipKeyOf = (i: number): string | undefined => (walk ? (lines[i] as WalkLine | undefined)?.ref : story ? `${story.id}#L${i}` : undefined);
  const cueFor = (i: number, atRate: number): ClipCue | undefined => {
    const key = clipKeyOf(i);
    const line = lines[i];
    if (!key || !line || !services.audio.clipFor) return undefined;
    const speaker = speakerOf(line);
    return services.audio.clipFor(key, speaker ? { rate: atRate, speaker } : { rate: atRate });
  };

  const items = useMemo<ListenItem[]>(() => {
    if (story) {
      return buildListeningSet(story, {
        rng: rngFor(store.seed(), store.today(), story.id),
        station,
        clauses: (i) => {
          const line = story.lines[i];
          const speaker = line?.speaker ?? story.narrator;
          return services.audio.clipFor?.(`${story.id}#L${i}`, speaker ? { rate: p.rate, speaker } : { rate: p.rate })?.clauses;
        },
      });
    }
    if (walk) {
      return buildWalkSet(walk.refs, (id) => loader.get(id), {
        rng: rngFor(store.seed(), store.today(), WALK_SEED_TAG, ...walk.refs.map((r) => r.ref)),
        station,
        known: knownSet(store.cards, store.today()),
        // The same lookup playback makes (`cueFor`): the pack narrows a key's variants by speaker.
        clauses: (ref) => {
          const speaker = walk.lines.find((l) => l.ref === ref)?.speaker;
          return services.audio.clipFor?.(ref, speaker ? { rate: p.rate, speaker } : { rate: p.rate })?.clauses;
        },
      });
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story, walk, station]);
  /** Line indexes the set plays and shows: every line of a text, the walk's chosen sentences. */
  const heard = useMemo<readonly number[]>(() => (walk ? heardLines(items) : lines.map((_, i) => i)), [walk, items, lines]);
  const spans = useMemo(() => lines.map((l) => tokenMoraSpans(l)), [lines]);

  // Re-render when the real audio service lands after first paint (`#/listen/:id` at boot): the chip and the voice gate read `services.audio`.
  servicesVersion.value;
  const hasVoice = voiceAudible(services.audio);
  const relisten = relistenRate(p.rate);

  const [phase, setPhase] = useState<Phase>('listen');
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [fullPlays, setFullPlays] = useState(0);
  const [qi, setQi] = useState(0);
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [itemReplays, setItemReplays] = useState(0);
  const [answered, setAnswered] = useState<ItemOutcome | null>(null);
  const [outcomes, setOutcomes] = useState<ItemOutcome[]>([]);
  const [relistened, setRelistened] = useState(false);
  const [showEn, setShowEn] = useState(station < JA_CHOICES_FROM_STATION);
  const [result, setResult] = useState<ListeningArenaResult | null>(null);
  const [tierChoice, setTierChoice] = useState<'offer' | 'kept' | number>('offer');

  const startedAt = useRef(store.now());
  const run = useRef(0);
  const totalReplays = useRef(0);
  const implicit = useRef<{ cardKey: CardKey; rating: Rating }[]>([]);
  const finished = useRef(false);
  /** Design 08 §10.4: the text was not in `progress.listened` when the set started (fixed on first sight of the story). */
  const cold = useRef<boolean | null>(null);
  if (story && cold.current === null) cold.current = !(progress.listened ?? []).includes(story.id);
  const transcriptRef = useRef<HTMLOListElement>(null);

  useEffect(
    () => () => {
      run.current++;
      services.audio.cancel();
    },
    [],
  );

  /* ── karaoke (design 08 §9): DOM marks on the token spans / mora dots `<Ruby>` renders; Preact does not manage them ── */
  const karaokeOf = (i: number): Karaoke => {
    const cue = cueFor(i, relisten);
    if (!cue) return 'line';
    if (isSlowCue(cue)) return 'morae';
    return relisten >= 1 ? 'tokens' : 'line';
  };
  const lineEl = (i: number): HTMLElement | null => transcriptRef.current?.querySelector<HTMLElement>(`li[data-line="${i}"]`) ?? null;
  const clearMarks = (li: ParentNode): void => {
    li.querySelectorAll<HTMLElement>('[data-sung]').forEach((el) => el.removeAttribute('data-sung'));
    li.querySelectorAll<HTMLElement>('.arena__mora-dot').forEach((el) => el.removeAttribute('data-on'));
  };
  const paint = (i: number, mora: number, mode: Karaoke): void => {
    const li = lineEl(i);
    if (!li) return;
    if (mode === 'tokens') {
      const active = activeToken(spans[i] ?? [], mora);
      li.querySelectorAll<HTMLElement>('.ruby__token[data-token]').forEach((span) => {
        const ti = Number(span.dataset.token);
        if (ti < active) span.setAttribute('data-sung', 'true');
        else if (ti === active) span.setAttribute('data-sung', 'now');
        else span.removeAttribute('data-sung');
      });
    } else if (mode === 'morae') {
      li.querySelectorAll<HTMLElement>('.arena__mora-dot').forEach((dot) => {
        const m = Number(dot.dataset.mora);
        if (m < mora) dot.setAttribute('data-on', 'done');
        else if (m === mora) dot.setAttribute('data-on', 'true');
        else dot.removeAttribute('data-on');
      });
    }
  };

  interface PlayOptions {
    /** One clause `[fromMora, toMora)` of a single line (design 08 §9). */
    clause?: MoraSpan;
    /** Drive the transcript's karaoke marks from `onProgress`. */
    karaoke?: boolean;
  }

  /** Speaks `indices` in order at `atRate`; resolves false when superseded or unmounted. */
  const playLines = async (indices: readonly number[], atRate: number, o: PlayOptions = {}): Promise<boolean> => {
    const id = ++run.current;
    setBusy(true);
    for (let k = 0; k < indices.length; k++) {
      if (run.current !== id) return false;
      const i = indices[k] as number;
      const line = lines[i];
      if (!line) continue;
      setSpeakingIdx(i);
      const mode = o.karaoke ? karaokeOf(i) : 'line';
      if (o.karaoke) {
        const li = lineEl(i);
        if (li) clearMarks(li);
      }
      const clip = clipKeyOf(i);
      const speaker = speakerOf(line);
      const opts: SpeakOptions = { voice: slotFor(line, slots), rate: atRate, interrupt: k === 0 };
      if (clip) opts.clip = clip;
      if (speaker) opts.speaker = speaker;
      if (mode !== 'line') opts.onProgress = (_t, mora) => paint(i, mora, mode);
      let text = toPlain(line.ja);
      if (o.clause) {
        const kana = clauseKana(line.kana, o.clause);
        text = clauseText(line, o.clause) ?? kana;
        opts.kana = kana;
        opts.clause = o.clause;
      }
      await speak(text, opts);
    }
    if (run.current !== id) return false;
    setSpeakingIdx(null);
    setBusy(false);
    return true;
  };

  const fullReplaysLeft = Math.max(0, REPLAY_BUDGET - Math.max(0, fullPlays - 1));

  const playAll = (): void => {
    if (busy || heard.length === 0) return;
    if (fullPlays > 0) {
      if (fullReplaysLeft <= 0) return;
      totalReplays.current++;
      p.onReplay?.();
    }
    void playLines(heard, p.rate).then((ok) => {
      if (ok) setFullPlays((n) => n + 1);
    });
  };

  const item = items[qi];
  const itemLine = item && item.kind !== 'gist' ? lines[item.lineIndex] : undefined;
  const itemClause = item && item.kind === 'dictation' ? item.clause : undefined;

  const playItemLine = (): Promise<boolean> | undefined => {
    if (!item || item.kind === 'gist') return undefined;
    return playLines([item.lineIndex], p.rate, itemClause ? { clause: itemClause } : {});
  };

  // A line item plays its line (or clause) once when it opens (the learner just tapped Next).
  useEffect(() => {
    if (phase !== 'questions' || !item || item.kind === 'gist' || !hasVoice) return;
    void playItemLine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, qi]);

  const replayItem = (): void => {
    if (phase !== 'questions' || !item || busy || answered) return;
    if (item.kind === 'gist') {
      playAll();
      return;
    }
    if (itemReplays >= REPLAY_BUDGET) return;
    setItemReplays((n) => n + 1);
    totalReplays.current++;
    p.onReplay?.();
    void playItemLine();
  };

  const settle = (o: ItemOutcome): void => {
    setAnswered(o);
    setOutcomes((xs) => [...xs, o]);
    sfx(o.correct ? 'correct' : 'wrong');
  };

  const pickChoice = (i: number): void => {
    if (phase !== 'questions' || !item || answered || item.kind === 'dictation') return;
    const choices = item.kind === 'gist' ? item.q.choices : item.choices;
    const answer = item.kind === 'gist' ? item.q.answer : item.answer;
    if (i < 0 || i >= choices.length) return;
    const correct = i === answer;
    const tags: ErrorTag[] = correct ? [] : ['listening'];
    // Design 08 §9: a miss on a question that names its line replays that line.
    const lineRef = !correct && item.kind === 'gist' && typeof item.q.lineRef === 'number' && lines[item.q.lineRef] ? item.q.lineRef : null;
    settle({
      correct,
      rating: null,
      tags,
      feedback: {
        kind: correct ? 'correct' : 'wrong',
        correct: correct ? undefined : choices[answer],
        given: correct ? undefined : choices[i],
        errorTags: tags,
        line: correct ? S.correct : S.wrong,
        why: lineRef !== null && hasVoice ? fill(S.lineRefReplay, { i: lineRef + 1 }) : undefined,
        rating: null,
        ippon: false,
        kiai: false,
        xpDelta: 0,
      },
    });
    if (lineRef !== null && hasVoice) void playLines([lineRef], p.rate);
  };

  const submitDictation = (value: string): void => {
    if (phase !== 'questions' || !item || item.kind !== 'dictation' || answered || !itemLine) return;
    if (normalizeJa(value).length === 0) {
      setNote(S.nothingTyped);
      return;
    }
    setNote(null);
    const g = gradeDictation(value, itemLine, item.clause);
    let rating = g.rating;
    if (itemReplays >= REPLAY_BUDGET && rating > 2) rating = 2;
    if (rating === 3 && !item.clause && p.rate >= DICTATED_MIN_RATE) {
      // The Waveform kakejiku's text: the most recent perfect dictation, plain surface (art request, round 2b).
      const plain = toPlain(itemLine.ja);
      store.patch('profile', (pr) => (pr.dictatedSentence === plain ? pr : { ...pr, dictatedSentence: plain }));
    }
    const walkLine = walk ? (itemLine as WalkLine) : null;
    implicit.current.push(
      ...implicitListenGrades(itemLine, value, (id) => loader.get(id), store.cards, store.today(), {
        ...(item.clause ? { clause: item.clause } : {}),
        ...(walkLine ? { ids: walkLine.ids } : {}),
      }),
    );
    const kind = rating === 3 ? 'correct' : rating === 2 ? 'near' : 'wrong';
    const shown = item.clause ? (clauseText(itemLine, item.clause) ?? clauseKana(itemLine.kana, item.clause)) : itemLine.ja;
    settle({
      correct: g.correct,
      rating,
      score: g.score,
      tags: g.tags,
      feedback: {
        kind,
        correct: shown,
        given: value,
        diff: g.diff,
        errorTags: g.tags,
        why: fill(S.scoreLine, { pct: Math.round(g.score * 100) }),
        line: kind === 'correct' ? S.correct : kind === 'near' ? S.near : S.wrong,
        rating,
        ippon: false,
        kiai: false,
        xpDelta: 0,
      },
    });
  };

  const next = (): void => {
    if (phase !== 'questions' || !answered) return;
    setAnswered(null);
    setTyped('');
    setNote(null);
    setItemReplays(0);
    if (qi + 1 < items.length) setQi(qi + 1);
    else {
      run.current++;
      services.audio.cancel();
      setBusy(false);
      setSpeakingIdx(null);
      setPhase('transcript');
    }
  };

  const doRelisten = (): void => {
    if (busy || heard.length === 0) return;
    const root = transcriptRef.current;
    if (root) clearMarks(root);
    void playLines(heard, relisten, { karaoke: true }).then((ok) => {
      if (ok) setRelistened(true);
    });
  };

  const finish = (): void => {
    if (finished.current || !source || (!relistened && hasVoice)) return;
    finished.current = true;
    const correct = outcomes.filter((o) => o.correct).length;
    const total = items.length;
    const passed = total > 0 && correct / total >= PASS_RATIO;
    const ms = Math.max(0, store.now() - startedAt.current);
    const minutes = Math.round((ms / 60000) * 10) / 10;
    const tags = Array.from(new Set(outcomes.flatMap((o) => o.tags)));
    const payload: Events['listening:set'] = { storyId: story ? story.id : null, correct, total, rate: p.rate, minutes };
    if (story) {
      payload.mode = 'text';
      if (story.genre) payload.genre = story.genre;
      payload.bridge = !!story.bridge;
      payload.authentic = isAuthenticText(story);
      payload.cold = cold.current ?? true;
    } else if (walk) {
      payload.mode = 'walk';
      payload.refs = heard.map((i) => (walk.lines[i] as WalkLine).ref);
      payload.cold = false;
    }
    bus.emit('listening:set', payload);
    if (story && passed) {
      // Design 08 §10.2 / §10.4: the heard-set grows once; `arenaAt` always takes today (the Arena is its only writer — Radio reads it, the store caps it).
      const id = story.id;
      const today = store.today();
      store.patch('progress', (pr) => ({
        ...pr,
        listened: pr.listened?.includes(id) ? pr.listened : [...(pr.listened ?? []), id],
        arenaAt: { ...(pr.arenaAt ?? {}), [id]: today },
      }));
    }
    if (p.onResult) {
      p.onResult({
        correct: passed,
        nearMiss: false,
        hintUsed: false,
        guard: false,
        timedOut: false,
        ms,
        errorTags: tags,
        score: total > 0 ? correct / total : 0,
        replays: totalReplays.current,
        implicit: implicit.current.slice(),
      });
    } else {
      for (const g of implicit.current) {
        recordImplicit({ cardKey: g.cardKey, rating: g.rating, exercise: 'listening-set', sessionId, dueWithin: IMPLICIT_WINDOW_DAYS });
      }
    }
    sfx('submit');
    setResult({ correct, total });
    setPhase('done');
    p.onDone({ correct, total });
  };

  useExerciseKeys({
    onChoice: (i) => pickChoice(i),
    onSubmit: () => {
      if (phase === 'questions' && answered) next();
      else if (phase === 'transcript' && relistened) finish();
    },
    onReplay: () => {
      if (phase === 'listen') playAll();
      else if (phase === 'questions') replayItem();
      else if (phase === 'transcript' && !relistened) doRelisten();
    },
  });

  /* ── states ─────────────────────────────────────────────────────────── */

  if (source === undefined) {
    return (
      <div class="arena" data-feel={feel}>
        <p class="arena__state" role="status">
          {S.loading}
        </p>
      </div>
    );
  }
  if (source === null) {
    return (
      <div class="arena" data-feel={feel}>
        <p class="arena__state arena__state--missing" role="status">
          {walkRefs ? S.walkEmpty : S.notFound}
        </p>
      </div>
    );
  }
  if (heard.length === 0) {
    return (
      <div class="arena" data-feel={feel}>
        <p class="arena__state arena__state--missing" role="status">
          {S.noLines}
        </p>
      </div>
    );
  }

  /* ── header: speakers and the source (design 08 §10.4) ──────────────── */

  const speakerName = (l: StoryLine): string => l.speaker ?? '';
  const speakers = Array.from(new Set(heard.map((i) => (lines[i] as StoryLine).speaker ?? narratorName)));
  /** The chip counts the voices of the lines actually heard (a walk hears ≤ `WALK_MAX` of its refs), so it agrees with the names. */
  const voiceCount = speakers.length;
  const nameRuby = (name: string): string => story?.names?.find((n) => toPlain(n) === name) ?? name;
  /** `AudioService.source` holds the idle default before the first speak() (contract), so the chip is capability-correct before anything is heard. */
  const sourceNow: AudioSource = audioSourceOf(services.audio);
  const sourceChip =
    sourceNow === 'none' ? S.sourceNone : sourceNow === 'clips' ? (voiceCount > 1 ? fill(S.sourceClips, { n: voiceCount }) : S.sourceClipsOne) : voiceCount > 1 ? fill(S.sourceDevice, { n: voiceCount }) : S.sourceDeviceOne;
  const titleEn = story ? story.titleEn : fill(S.walkStoryTitle, { n: heard.length });
  const teachSeen = progress.teachSeen;
  const dismissTeach = (id: string): void => store.patch('progress', (pr) => markTeachSeen(pr, id));
  const bridgeTeach = !!story && station >= BRIDGE_FROM_STATION && (!!story.bridge || (!!story.genre && AUTHENTIC_GENRES.has(story.genre)));

  const header = (
    <header class="arena__head">
      <span class="arena__band" aria-hidden="true" title={sourceChip} />
      <h2 class="arena__title">
        <span lang="ja" class="arena__title-ja">
          {walk ? S.walkTitleJa : S.titleJa}
        </span>
        <span>{walk ? S.walkTitle : S.title}</span>
      </h2>
      <div class="arena__meta">
        <span class="chip">{fill(S.speedLabel, { rate: p.rate })}</span>
        <span class="chip arena__source" data-source={sourceNow}>
          {sourceChip}
        </span>
        {story?.genre ? (
          <span class="chip arena__genre">
            {fill(S.genreLabel, { genre: GENRE_LABEL[story.genre] })}
            {story.audioFirst ? ` · ${S.listenFirstChip}` : ''}
          </span>
        ) : null}
        <span class="chip arena__story-title">{titleEn}</span>
      </div>
      <p class="arena__speakers">
        <span class="eyebrow">{S.speakersLabel}</span>
        {speakers.map((name) => {
          const ja = containsJapanese(name);
          const ruby = nameRuby(name);
          return (
            <span key={name} class="arena__speaker-name" lang={ja ? 'ja' : undefined}>
              {ja && hasKanji(ruby) ? <Ruby ja={ruby} mode="always" /> : name}
            </span>
          );
        })}
      </p>
    </header>
  );

  /* ── listen ─────────────────────────────────────────────────────────── */

  if (phase === 'listen') {
    return (
      <div class="arena arena--listen" data-feel={feel} data-phase="listen" data-mode={walk ? 'walk' : 'text'}>
        {header}
        <TeachOnce id={TEACH_ARENA_FIRST} title={S.teachArenaFirstTitle} body={S.teachArenaFirstBody} seen={teachSeen} onDismiss={dismissTeach} dismissLabel={S.teachDismiss} />
        {bridgeTeach ? <TeachOnce id={TEACH_ARENA_BRIDGE} title={S.teachArenaBridgeTitle} body={S.teachArenaBridgeBody} seen={teachSeen} onDismiss={dismissTeach} dismissLabel={S.teachDismiss} /> : null}
        {hasVoice ? (
          <p class="arena__hint">{walk ? S.walkIntro : S.audioOnly}</p>
        ) : (
          <div class="notice notice--warn arena__notice" role="status">
            {services.audio.hasJaVoice.value ? S.volumeOff : S.noVoice}
          </div>
        )}
        <div class="arena__stage status-window" aria-live="polite">
          {hasVoice ? (
            <div class="arena__waves" data-busy={busy ? 'true' : undefined} aria-hidden="true">
              {heard.map((i) => {
                const l = lines[i] as StoryLine;
                return <span key={i} class="arena__wave" data-slot={slotFor(l, slots)} data-on={speakingIdx === i ? 'true' : undefined} />;
              })}
            </div>
          ) : (
            <ol class="arena__lines">
              {heard.map((i) => {
                const l = lines[i] as StoryLine;
                return (
                  <li key={i} class="arena__line" data-slot={slotFor(l, slots)}>
                    {l.speaker ? (
                      <span class="arena__speaker" lang="ja">
                        {speakerName(l)}
                      </span>
                    ) : null}
                    <Ruby ja={l.ja} mode={furigana} />
                  </li>
                );
              })}
            </ol>
          )}
          <p class="arena__progress">{speakingIdx !== null ? fill(S.lineOf, { i: heard.indexOf(speakingIdx) + 1, n: heard.length }) : busy ? S.playing : ''}</p>
        </div>
        <div class="arena__controls">
          {hasVoice ? (
            fullPlays === 0 ? (
              <button type="button" class="hanko" onClick={playAll} disabled={busy} aria-keyshortcuts="Space">
                {busy ? S.playing : S.play}
              </button>
            ) : (
              <button type="button" class="btn" onClick={playAll} disabled={busy || fullReplaysLeft <= 0} aria-keyshortcuts="Space">
                {S.replay}
                <small>{fullReplaysLeft > 0 ? fill(S.replaysLeft, { n: fullReplaysLeft }) : S.noReplaysLeft}</small>
              </button>
            )
          ) : null}
          {fullPlays > 0 || !hasVoice ? (
            <button type="button" class="hanko" onClick={() => setPhase('questions')} disabled={busy}>
              {S.toQuestions}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  /* ── questions ──────────────────────────────────────────────────────── */

  if (phase === 'questions' && item) {
    const prompt = item.kind === 'gist' ? S.gistPrompt : item.kind === 'choice' ? (item.ja ? S.choicePromptJa : S.choicePromptEn) : item.clause ? S.clausePrompt : S.dictationPrompt;
    const choices = item.kind === 'gist' ? item.q.choices : item.kind === 'choice' ? item.choices : [];
    const correctIdx = item.kind === 'gist' ? item.q.answer : item.kind === 'choice' ? item.answer : -1;
    const pickedIdx = answered && item.kind !== 'dictation' ? choices.findIndex((c, i) => (answered.correct ? i === correctIdx : c === answered.feedback.given)) : -1;
    const jaChoices = item.kind === 'choice' ? item.ja : false;
    const itemReplaysLeft = Math.max(0, REPLAY_BUDGET - itemReplays);
    return (
      <div class="arena arena--questions" data-feel={feel} data-phase="questions" data-mode={walk ? 'walk' : 'text'}>
        {header}
        <p class="arena__progress">{fill(S.questionOf, { i: qi + 1, n: items.length })}</p>
        <div class="arena__question">
          <p class="arena__prompt">{prompt}</p>
          {item.kind === 'gist' ? (
            <p class="arena__q" lang={containsJapanese(item.q.q) ? 'ja' : undefined}>
              {containsJapanese(item.q.q) ? <Ruby ja={item.q.q} mode={furigana} /> : item.q.q}
            </p>
          ) : (
            <div class="arena__line-audio">
              <button type="button" class="btn" onClick={replayItem} disabled={busy || !!answered || itemReplaysLeft <= 0 || !hasVoice} aria-keyshortcuts="Space">
                {busy ? S.playing : S.playLine}
                <small>{itemReplaysLeft > 0 ? fill(S.replaysLeft, { n: itemReplaysLeft }) : S.noReplaysLeft}</small>
              </button>
              {itemClause ? <p class="arena__clause-note">{fill(S.clauseNote, { n: itemClause[1] - itemClause[0] })}</p> : null}
              {item.kind === 'dictation' && itemReplays >= REPLAY_BUDGET && !answered ? <p class="arena__ceiling">{S.secondReplayCeiling}</p> : null}
              {!hasVoice && itemLine ? (
                <p class="arena__fallback-line" lang="ja">
                  {itemClause ? (clauseText(itemLine, itemClause) ?? clauseKana(itemLine.kana, itemClause)) : <Ruby ja={itemLine.ja} mode={furigana} />}
                </p>
              ) : null}
            </div>
          )}
          {item.kind === 'dictation' ? (
            <div class="arena__dictation">
              <KanaInput
                key={`${qi}`}
                value={typed}
                onChange={setTyped}
                onSubmit={submitDictation}
                autoFocus
                disabled={!!answered}
                label={S.typedField}
                placeholder={S.typedField}
              />
              {!answered ? (
                <button type="button" class="hanko arena__submit" onClick={() => submitDictation(typed)}>
                  {S.submit}
                </button>
              ) : null}
              {note ? (
                <p class="arena__note" role="status">
                  {note}
                </p>
              ) : null}
            </div>
          ) : (
            <ol class="arena__choices" aria-label={S.choicesLabel} data-locked={answered ? 'true' : undefined}>
              {choices.map((c, i) => {
                const state = !answered ? 'idle' : i === correctIdx ? (pickedIdx === i ? 'correct' : 'missed') : pickedIdx === i ? 'wrong' : 'idle';
                const ja = jaChoices || containsJapanese(c);
                return (
                  <li key={i}>
                    <button
                      type="button"
                      class="arena__choice"
                      data-state={state}
                      disabled={!!answered}
                      aria-label={fill(S.choiceN, { n: i + 1 })}
                      aria-keyshortcuts={String(i + 1)}
                      onClick={() => pickChoice(i)}
                    >
                      <kbd aria-hidden="true">{i + 1}</kbd>
                      <span class="arena__choice-text" lang={ja ? 'ja' : undefined}>
                        {ja ? <Ruby ja={c} mode={furigana} /> : c}
                      </span>
                      {state === 'correct' || state === 'missed' ? <span class="arena__mark" aria-hidden="true">○</span> : null}
                      {state === 'wrong' ? <span class="arena__mark" aria-hidden="true">×</span> : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        {answered ? (
          <div class="arena__feedback">
            <Feedback state={answered.feedback} feel={feel} />
            <button type="button" class="hanko" onClick={next} aria-keyshortcuts="Enter">
              {qi + 1 < items.length ? S.next : S.toTranscript}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  /* ── transcript ─────────────────────────────────────────────────────── */

  if (phase === 'transcript') {
    const credits = speakers.flatMap((name) => {
      const i = heard.find((k) => ((lines[k] as StoryLine).speaker ?? narratorName) === name);
      const cue = i === undefined ? undefined : cueFor(i, relisten);
      if (!cue) return [];
      const credit = cue.voice.startsWith('VOICEVOX:') ? cue.voice : `VOICEVOX:${cue.voice}`;
      return [{ name, credit }];
    });
    return (
      <div class="arena arena--transcript" data-feel={feel} data-phase="transcript" data-mode={walk ? 'walk' : 'text'}>
        {header}
        <div class="arena__transcript-head">
          <h3 class="arena__subtitle">{S.transcript}</h3>
          <button type="button" class="btn btn--ghost btn--sm" onClick={() => setShowEn((v) => !v)} aria-pressed={showEn}>
            {showEn ? S.hideEnglish : S.showEnglish}
          </button>
        </div>
        <ol ref={transcriptRef} class="arena__transcript" aria-live="off">
          {heard.map((i) => {
            const l = lines[i] as StoryLine;
            const mode = karaokeOf(i);
            const beats = mode === 'morae' ? speechMoraCount(l.kana) : 0;
            return (
              <li
                key={i}
                class="arena__line"
                data-line={i}
                data-slot={slotFor(l, slots)}
                data-karaoke={mode}
                data-speaking={speakingIdx === i ? 'true' : undefined}
                aria-current={speakingIdx === i ? 'true' : undefined}
              >
                {l.speaker ? (
                  <span class="arena__speaker" lang="ja" aria-label={fill(S.speakerLabel, { name: l.speaker })}>
                    {speakerName(l)}
                  </span>
                ) : null}
                <span class="arena__line-ja">
                  <Ruby ja={l.ja} mode={furigana} {...(l.tokens.length > 0 ? { tokens: l.tokens } : {})} />
                </span>
                {beats > 0 ? (
                  <span class="arena__mora-dots" role="img" aria-label={fill(S.moraDotsLabel, { n: beats })}>
                    {Array.from({ length: beats }, (_, m) => (
                      <span key={m} class="arena__mora-dot" data-mora={m} />
                    ))}
                  </span>
                ) : null}
                {showEn ? <span class="arena__line-en">{l.en}</span> : null}
                {speakingIdx === i ? <span class="sr-only">{S.nowSpeaking}</span> : null}
              </li>
            );
          })}
        </ol>
        {credits.length > 0 ? (
          <ul class="arena__credits" aria-label={S.creditsTitle}>
            <li class="eyebrow">{S.creditsTitle}</li>
            {credits.map((c) => (
              <li key={c.name} class="arena__credit">
                <span lang={containsJapanese(c.name) ? 'ja' : undefined}>{c.name}</span>
                {` · ${c.credit}`}
              </li>
            ))}
          </ul>
        ) : null}
        <div class="arena__controls">
          {hasVoice ? (
            <>
              <p class="arena__hint" role="status">
                {relistened ? S.relistenDone : busy ? fill(S.relistening, { rate: relisten }) : S.relistenRequired}
              </p>
              {!relistened ? (
                <button type="button" class="hanko" onClick={doRelisten} disabled={busy} aria-keyshortcuts="Space">
                  {fill(S.relisten, { rate: relisten })}
                </button>
              ) : null}
            </>
          ) : null}
          <button type="button" class={relistened || !hasVoice ? 'hanko' : 'btn'} onClick={finish} disabled={hasVoice && !relistened} aria-keyshortcuts="Enter">
            {S.finish}
          </button>
        </div>
      </div>
    );
  }

  /* ── done ───────────────────────────────────────────────────────────── */

  const r = result ?? { correct: 0, total: items.length };
  const pass = r.total > 0 && r.correct / r.total >= PASS_RATIO;
  const dictationScores = outcomes.map((o) => o.score).filter((s): s is number => typeof s === 'number');
  const clean = r.total > 0 && r.correct === r.total && dictationScores.every((s) => s >= 0.9);
  const tier = settings.speedTier;
  const atTierRate = Math.abs(SPEED_TIER_RATES[tier] - p.rate) < 1e-9;
  const offerTier = !inSession && clean && atTierRate && tier < 5 && tierChoice === 'offer';
  const acceptTier = (): void => {
    const nextTier = Math.min(5, tier + 1) as SpeedTier;
    store.patch('settings', (s) => ({ ...s, speedTier: nextTier }));
    setTierChoice(nextTier);
  };
  return (
    <div class="arena arena--done" data-feel={feel} data-phase="done" data-mode={walk ? 'walk' : 'text'}>
      {header}
      <div class="arena__result status-window" role="status">
        <h3 class="arena__subtitle">{S.resultTitle}</h3>
        <p class="arena__result-line">{fill(S.resultLine, { correct: r.correct, total: r.total, rate: p.rate })}</p>
        <p class="arena__result-note">{pass ? S.resultPass : S.resultMiss}</p>
        {offerTier ? (
          <div class="arena__tier">
            <p>{S.tierOffer}</p>
            <p class="arena__result-note">{S.tierOfferNote}</p>
            <div class="arena__controls">
              <button type="button" class="hanko" onClick={acceptTier}>
                {fill(S.tierAccept, { tier: tier + 1 })}
              </button>
              <button type="button" class="btn btn--ghost" onClick={() => setTierChoice('kept')}>
                {S.tierKeep}
              </button>
            </div>
          </div>
        ) : null}
        {typeof tierChoice === 'number' ? <p class="arena__result-note">{fill(S.tierAccepted, { tier: tierChoice })}</p> : null}
        {!inSession && clean && atTierRate && tier >= 5 ? <p class="arena__result-note">{S.tierTop}</p> : null}
      </div>
    </div>
  );
}
