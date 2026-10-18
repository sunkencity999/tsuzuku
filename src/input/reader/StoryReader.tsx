/**
 * TSUZUKU — 旅日記 Tabi Nikki episode reader (design 04 §7, 05 §2/§4, 03 §2.3)
 * and the 読み聞かせ Read-along (design 08 §10.3).
 *
 * Works as the `story-read` exercise step (ExerciseProps: `params.storyId`,
 * result through `onResult`) and standalone on `#/story/:id` (StoryReaderProps,
 * result through `onDone`). Lines reveal one at a time; each line has TTS
 * (`speak(toPlain(ja), {kana, clip, speaker})`, dialogue speakers alternate
 * voice slots on the synth path and resolve to their cast voice on the clip
 * path), furigana fog from `fog.ts` (a reveal is a hint), tap-gloss on every
 * token (item via `tokenIds` → `loader.get` / `getAsync` → `<Gloss>`; its
 * backdrop covers the page, so closing always returns focus to the tapped
 * token), the English line once the line is behind you (in the exercise step
 * the frame's `?` / Hint button also turns it on, and the first English reveal
 * there counts as a hint — contract #32), i+1 words marked, vertical text from
 * Blue. A silent `createReadingTimer` measures cpm (paused while hidden). Then
 * `<Comprehension>`; ≥ 2/3 is full credit. On finish:
 *   - a gloss tap on an introduced word graded Hard through `capture.onGlossTap`
 *     only when the card is due today and this is not the first read (05 §4);
 *     "first read" = the episode is absent from `progress.storiesRead` (B's
 *     `story:read` reducer appends it), unless the host passes `firstRead`;
 *   - 「捕まえる」Capture / Bookmark on the gloss writes `store.captured` / `bookmarks`
 *     (vocab only: grammar / kanji tokens show "comes with its station Scroll",
 *     since `intro-policy` routes only `v-` captures into Scrolls);
 *   - Kaiden words read with no gloss tap and ≥ 2/3 log Good on their base
 *     card (`recordImplicit`, 05 §2 "implicit evidence counts");
 *   - `story:read` is emitted once (B grants XP, stats, ledger minutes, the
 *     辞書要らず badge); `ledgerLogged` tells a standalone host whether B's
 *     ledger reducer took the minutes, so nothing is logged twice.
 *
 * `mode: 'listen'` (Read-along, `#/story/:id/listen`) is hearing with the text
 * open, not a read: the lines play in order through the pack player when the
 * pack has `<storyId>#L<i>` (karaoke token sweep from `onProgress`, played
 * seconds from `done.seconds`) and through `speak()` otherwise; a gloss tap
 * never cuts the voice — the line finishes and the player waits at the line
 * boundary while the gloss is open; per-line chips slow (natural) · my tier ·
 * fast name the served rate (slow is "natural" only when the pack serves the
 * 0.85 take unstretched; the honesty chip names what the next line WOULD use,
 * not what `speak()` last did); L loops the line, Space pauses, ←/→ move. It
 * ends in the comprehension
 * questions as an optional self-check and emits ONE `listen:played
 * { source: 'readalong', refs: [id], seconds, rate, cold, authentic, gistCorrect }`
 * (a `listen` ledger row with `source: app`, 0 XP — the store's reducer owns
 * that row and may merge the day's rows, so unlike `story:read` the listen
 * result carries no `ledgerLogged`: a host must not log), appends the id to
 * `progress.listened`, and NEVER emits `story:read` nor touches
 * `progress.storiesRead` — a read-along pays no episode tariff, ticks no
 * read-episode quest and lights no reading badge. A hearing with no audible
 * seconds (text only) emits and marks nothing. Speech is cancelled on unmount
 * (a line must not keep speaking into the next session step). Registered by
 * the F barrel as `story-read` (`meta`). Copy in `./strings.ts`.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { content, type ContentLoader } from '@/content/loader';
import { segmentsToTokens, toKana, toPlain } from '@/content/ruby';
import { isAuthenticText, type CardKey, type ComprehensionQuestion, type ContentItem, type StoryItem, type StoryLine } from '@/content/types';
import { recordImplicit } from '@/learn/apply';
import { DAN_RATE, SPEED_TIER_RATES, audioSourceOf, services, speak, voiceAudible, type AudioService, type AudioSource, type ClipCue, type SpeakOptions, type SpeedTier } from '@/shared/audio';
import { bus, type Events } from '@/shared/events';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { rngFor } from '@/shared/hash';
import { cardKey, tryKindOfId } from '@/shared/ids';
import { moraCount } from '@/shared/jp';
import { CardFlag, hasFlag, type Feel, type FuriganaMode, type Progress, type Settings } from '@/shared/store-types';
import { useExerciseFrame, useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { Ruby } from '@/shared/ui/Ruby';
import { store } from '@/store';
import { knownIds } from '@/store/derived';
import { isCapturableId, isCaptured, onGlossTap } from './capture';
import { Comprehension, passes } from './Comprehension';
import { isPunctToken, storyCoverage } from './coverage';
import { bindVisibility, charCount, cpm as cpmOf, cpmBand, createReadingTimer, levelForStation, type CpmBand } from './cpm';
import { fogPredicate } from './fog';
import { Gloss, type CaptureState } from './Gloss';
import { S, fill } from './strings';
import './reader.css';

export const meta: ExerciseMeta = {
  id: 'story-read',
  facet: null,
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: false,
  keys: 'none',
};

/** Vertical text toggle is offered from Blue (Station 25, design 04 §13). */
export const VERTICAL_FROM_STATION = 25;
/** J-J reveal is the default from Purple (Station 34, design 04 §2). */
export const JJ_FROM_STATION = 34;
/** 辞書要らず: an episode this long, ≥ 2/3, ≤ 2 gloss taps (design 04 §7). */
export const DICTIONARY_FREE_CHARS = 300;
export const DICTIONARY_FREE_TAPS = 2;
/** Native rate of the pack's natural-slow sentence take (design 08 §7 step 4). */
export const NATURAL_SLOW_RATE = 0.85;

export type ReaderMode = 'read' | 'listen';

export interface StoryReadResult {
  storyId: string;
  correct: number;
  total: number;
  /** ≥ 2/3 (full credit). */
  passed: boolean;
  cpm: number;
  band: CpmBand;
  chars: number;
  ms: number;
  /** Whole minutes handed to `story:read` (the ledger row). */
  minutes: number;
  glossTaps: number;
  /** Fog readings revealed (hints). */
  hints: number;
  dictionaryFree: boolean;
  /** Kaiden base cards that received an implicit Good. */
  kaidenConfirmed: CardKey[];
  /** B's ledger reducer logged the minutes during the `story:read` emit. */
  ledgerLogged: boolean;
  bridge: boolean;
  /** The episode could not be loaded; nothing was emitted. */
  missing: boolean;
}

/** What a finished Read-along reports (design 08 §10.3); mirrors the `listen:played` payload plus the self-check. */
export interface StoryListenResult {
  storyId: string;
  /** Seconds actually played, summed over lines (0 when text only). */
  seconds: number;
  /** The slowest rate any heard line was served at (the honest figure for `authentic`). */
  rate: number;
  /** The text was not in `progress.listened` when the Read-along started. */
  cold: boolean;
  /** `isAuthenticText(story) && rate ≥ 1.0 && gistCorrect`. */
  authentic: boolean;
  /** The first gist question's result; `null` when the questions were skipped or the text has none. */
  gistCorrect: boolean | null;
  correct: number;
  total: number;
  /** The learner took the self-check. */
  answered: boolean;
  /** `seconds > 0`: `listen:played` was emitted and the id appended to `progress.listened`. */
  heard: boolean;
  /** Where the last heard line came from. */
  source: AudioSource;
  /** The text could not be loaded; nothing was emitted. */
  missing: boolean;
}

interface StoryReaderBaseProps {
  storyId: string;
  /** Defaults to the live `content` loader (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
  /** Logged on implicit grades; default `story:<id>`. */
  sessionId?: string;
  /**
   * First read of this episode: gloss taps never grade Hard. Defaults to
   * "not yet in `progress.storiesRead`" (B appends the id on `story:read`),
   * read once at mount so finishing the episode does not flip it mid-read.
   */
  firstRead?: boolean;
  feel?: Feel;
  furigana?: FuriganaMode;
  jj?: boolean;
  /** Learner station (band, vertical toggle); default `store.progress.station`. */
  station?: number;
  /** A fog reveal (hint) happened — and, with `frameHint`, the first English reveal. */
  onHint?(): void;
  /**
   * Exercise-step mode: register the English reveal as the frame's hint (`?` /
   * Hint button) while reading with a line behind you and English off; the
   * first reveal counts as a hint. Standalone readers leave it unset (free toggle).
   */
  frameHint?: boolean;
}

/** The plain reader (default): a read that ends in `story:read`. */
export interface StoryReadProps extends StoryReaderBaseProps {
  mode?: 'read';
  onDone(r: StoryReadResult): void;
}

/** The Read-along (design 08 §10.3): hearing with the text open; ends in `listen:played`, never `story:read`. */
export interface StoryListenProps extends StoryReaderBaseProps {
  mode: 'listen';
  onDone(r: StoryListenResult): void;
}

export type StoryReaderProps = StoryReadProps | StoryListenProps;

export function isStoryItem(i: ContentItem | null | undefined): i is StoryItem {
  return !!i && 'lines' in i && 'comprehension' in i && Array.isArray(i.lines);
}

/** Exercise-step props (`step` + `onResult`) versus a component's own props. */
export function isExerciseProps<T extends object>(p: T | ExerciseProps): p is ExerciseProps {
  return 'step' in p && 'onResult' in p;
}

/** Station number from a story id (`s-07-1` → 7), else `undefined`. */
export function storyStation(id: string): number | undefined {
  const m = /^s-(\d{2})-/.exec(id);
  return m ? Number(m[1]) : undefined;
}

/** The save records this episode as read (`progress.storiesRead`, written by B's `story:read` reducer). */
export function isStoryRead(storyId: string): boolean {
  return store.progress.peek().storiesRead?.includes(storyId) ?? false;
}

/** The save records this text as heard on a listening surface (`progress.listened`, design 08 §10). */
export function isListened(storyId: string): boolean {
  return store.progress.peek().listened?.includes(storyId) ?? false;
}

/** The `Progress` write for a hearing (design 08 §10.3): appends `id` to `listened` once, immutably; idempotent. */
export function markListened<P extends Pick<Progress, 'listened'>>(progress: P, id: string): P {
  const seen = progress.listened ?? [];
  if (seen.includes(id)) return progress;
  return { ...progress, listened: [...seen, id] };
}

export function isDictionaryFree(chars: number, correct: number, total: number, glossTaps: number): boolean {
  return chars >= DICTIONARY_FREE_CHARS && passes(correct, total) && glossTaps <= DICTIONARY_FREE_TAPS;
}

/** Speaker labels in order of first appearance (dialogue voice slots a/b alternate by speaker). */
export function speakerSlots(lines: readonly StoryLine[]): Map<string, 'a' | 'b'> {
  const out = new Map<string, 'a' | 'b'>();
  for (const l of lines) {
    if (l.speaker && !out.has(l.speaker)) out.set(l.speaker, out.size % 2 === 0 ? 'a' : 'b');
  }
  return out;
}

/** Clip key of a story line (design 08 §8): `<storyId>#L<i>`. */
export function lineClipKey(storyId: string, i: number): string {
  return `${storyId}#L${i}`;
}

/**
 * The Read-along's three rates for a speed tier (design 08 §10.3): `slow` is
 * the natural-slow take's 0.85 whenever that is below the tier (so the pack
 * serves it unstretched), else the tier below; `tier` the preset; `fast` the
 * next tier up (the Dan rate above tier 5). At tier 1 (0.75) nothing is
 * slower than the tier itself, so `slow === tier` and `rateChipsFor` hides
 * the duplicate chip.
 */
export type RateChip = 'slow' | 'tier' | 'fast';
export const RATE_CHIPS: readonly RateChip[] = ['slow', 'tier', 'fast'];
export interface ReadAlongRates {
  slow: number;
  tier: number;
  fast: number;
}
export function readAlongRates(tier: SpeedTier): ReadAlongRates {
  const t = SPEED_TIER_RATES[tier];
  const below = SPEED_TIER_RATES[Math.max(1, tier - 1) as SpeedTier];
  const slow = NATURAL_SLOW_RATE < t ? NATURAL_SLOW_RATE : Math.min(below, t);
  return { slow, tier: t, fast: tier < 5 ? SPEED_TIER_RATES[(tier + 1) as SpeedTier] : DAN_RATE };
}

/** The chips a learner sees: one per distinct rate (the slow chip only while it is slower than the tier). */
export function rateChipsFor(rates: ReadAlongRates): RateChip[] {
  return RATE_CHIPS.filter((c) => c !== 'slow' || rates.slow < rates.tier);
}

/**
 * The cue the Read-along would play for a line right now — the gates
 * `playLine` applies: a pack player that is ready, the learner has not forced
 * the device voice, and the key (else the sentence text, design 08 §8) has a
 * cue at the nearest native rate. `undefined` means the line goes to `speak()`.
 */
export function servedCue(a: AudioService, settings: Pick<Settings, 'audioSource'>, key: string, text: string, o: { rate: number; speaker?: string }): ClipCue | undefined {
  const clips = a.clips;
  if (!clips || settings.audioSource === 'device' || clips.ready.value !== 'ready') return undefined;
  const where = o.speaker !== undefined ? { rate: o.rate, speaker: o.speaker } : { rate: o.rate };
  return clips.cueFor(key, where) ?? clips.cueForText(text, where);
}

/** The chip reads `slow (natural)` only when the served cue IS the 0.85 take and plays unstretched (`rate === cue.rate`; design 08 §10.3 / §11). */
export function naturalSlowServed(cue: ClipCue | undefined, rate: number): boolean {
  return cue?.rate === NATURAL_SLOW_RATE && rate === NATURAL_SLOW_RATE;
}

/**
 * The source the honesty chip names (design 08 §10.1): what the last heard
 * line came from; before anything was heard, what the next line WOULD use —
 * the pack when it has a cue, the device voice while `voiceAudible`, else
 * text only. Never the service's `source` signal alone: `speak()` writes it,
 * and the pack path never calls `speak()`.
 */
export function listenSource(a: AudioService, cue: ClipCue | undefined, lastHeard: AudioSource = 'none'): AudioSource {
  if (lastHeard !== 'none') return lastHeard;
  if (cue) return 'clips';
  return voiceAudible(a) ? 'synth' : 'none';
}

/**
 * Mora span `[start, end)` of each token over `segmentsToTokens(line.ja, line.tokens)`
 * (design 08 §9: token i owns morae `[k_i, k_{i+1})`, `k` the cumulative
 * `moraCount(toKana(tok.ja))`); punctuation owns no morae (the engine folds
 * its pause into the preceding boundary).
 */
export function tokenMoraSpans(line: Pick<StoryLine, 'ja' | 'tokens'>): [number, number][] {
  const out: [number, number][] = [];
  let k = 0;
  for (const t of segmentsToTokens(line.ja, line.tokens)) {
    const n = isPunctToken(t.token) ? 0 : moraCount(toKana(t.ja));
    out.push([k, k + n]);
    k += n;
  }
  return out;
}

/** The token whose span holds `mora`, or −1 past the end. */
export function activeTokenAt(spans: readonly (readonly [number, number])[], mora: number): number {
  for (let i = 0; i < spans.length; i++) {
    const [s, e] = spans[i] as [number, number];
    if (s <= mora && mora < e) return i;
  }
  return -1;
}

/** The self-check question whose answer feeds `gistCorrect`: the first `kind: 'gist'`, else the first question; `null` without questions. */
export function gistQuestionIndex(questions: readonly ComprehensionQuestion[]): number | null {
  if (questions.length === 0) return null;
  const i = questions.findIndex((q) => q.kind === 'gist');
  return i >= 0 ? i : 0;
}

/** Status-chip copy for an audio source (design 08 §10.1 honesty vocabulary). */
export function sourceLabel(src: AudioSource): string {
  return src === 'clips' ? S.sourceClips : src === 'synth' ? S.sourceSynth : S.sourceNone;
}

/** `1.1×` style rate text (no trailing zeros). */
export function formatRate(rate: number): string {
  return `${rate.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}×`;
}

/** Heard time for a result card. */
export function formatHeard(seconds: number): string {
  const s = Math.round(seconds);
  if (s <= 0) return S.heardNone;
  return s >= 60 ? fill(S.heardMinSec, { m: Math.floor(s / 60), s: s % 60 }) : fill(S.heardSec, { s });
}

export interface CardsLike {
  byItem(itemId: string): Partial<Record<'rec' | 'listen' | 'prod' | 'pitch' | 'read' | 'comp' | 'cloze', readonly number[]>>;
}

/**
 * Kaiden-lane base cards of words the story carries that were read with no
 * gloss tap (design 05 §2: a Kaiden word read in context with ≥ 2/3 logs Good).
 */
export function kaidenEvidence(story: StoryItem, tapped: ReadonlySet<string>, cards: CardsLike, resolve: (id: string) => string = (id) => id): CardKey[] {
  const out: CardKey[] = [];
  const seen = new Set<string>();
  for (const line of story.lines) {
    for (const raw of line.tokenIds ?? []) {
      if (!raw) continue;
      const id = resolve(raw);
      if (seen.has(id) || tapped.has(id)) continue;
      seen.add(id);
      const by = cards.byItem(id);
      const facet = by.rec ? 'rec' : by.prod ? 'prod' : null;
      if (!facet) continue;
      const c = by[facet];
      if (c && hasFlag(c[7] ?? 0, CardFlag.kaiden)) out.push(cardKey(id, facet));
    }
  }
  return out;
}

/** The exercise-step view of a finished read. A missing episode is ungraded (`correct`), never a penalty. */
export function toAttemptResult(r: StoryReadResult): AttemptResult {
  return {
    correct: r.missing ? true : r.passed,
    nearMiss: false,
    hintUsed: r.hints > 0,
    guard: false,
    timedOut: false,
    ms: r.ms,
    errorTags: [],
    score: r.total > 0 ? r.correct / r.total : 0,
  };
}

/**
 * The capture button's meaning for a tapped token. Only vocab is capturable:
 * `learn/intro-policy` routes `v-` captures into the next Scroll and skips
 * every other kind, so a grammar point or kanji gets the `station` line.
 */
export function captureStateFor(itemId: string | null, token: string, introduced: boolean): CaptureState {
  if (!itemId) return store.bookmarks.value.includes(token.trim()) ? 'bookmarked' : 'bookmark';
  if (!isCapturableId(itemId)) return 'none';
  if (introduced) return 'introduced';
  if (tryKindOfId(itemId) !== 'vocab') return 'station';
  return isCaptured(itemId) ? 'captured' : 'capture';
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Line playback (design 08 §8 / §10.3)                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export interface LinePlayOptions {
  kana?: string;
  rate: number;
  clip: string;
  speaker?: string;
  voice?: 'a' | 'b';
  onProgress?: SpeakOptions['onProgress'];
}

export interface LinePlayOutcome {
  source: AudioSource;
  /** Seconds actually played: `done.seconds` on the clip path, wall clock on the device voice, 0 when nothing could be heard. */
  seconds: number;
  /** The served cue's native rate on the clip path, else `null`. */
  cueRate: number | null;
}

export interface LinePlayHandle {
  done: Promise<LinePlayOutcome>;
  /** Stops the line; `done` still resolves with the seconds played so far. */
  stop(): void;
}

/**
 * Plays one line the way the Read-along counts it: through the pack player
 * when the pack is ready, the learner has not forced the device voice and
 * the key (or the sentence text) has a cue — `done.seconds` are media-event
 * seconds — else through `speak()` (the clip-runtime resolves clips there
 * too; seconds are the wall clock of the utterance, 0 when nothing can be
 * heard). A locked player (before the first gesture) resolves `source: 'none'`
 * and the line falls through to the device voice instead of hanging.
 */
export function playLine(text: string, o: LinePlayOptions, now: () => number = () => store.now()): LinePlayHandle {
  let stopped = false;
  let stop: () => void = () => {
    stopped = true;
    services.audio.cancel();
  };
  const run = async (): Promise<LinePlayOutcome> => {
    const a = services.audio;
    const settings = store.settings.peek();
    const cue = servedCue(a, settings, o.clip, text, o.speaker !== undefined ? { rate: o.rate, speaker: o.speaker } : { rate: o.rate });
    if (cue && a.clips) {
      a.cancel();
      const pb = a.clips.play(cue, { rate: o.rate, volume: settings.sound, ...(o.onProgress ? { onProgress: o.onProgress } : {}) });
      stop = () => {
        stopped = true;
        pb.stop();
      };
      const r = await pb.done;
      if (r.source === 'clips' || stopped) return { source: 'clips', seconds: r.seconds, cueRate: cue.rate };
    }
    if (stopped) return { source: 'none', seconds: 0, cueRate: null };
    stop = () => {
      stopped = true;
      a.cancel();
    };
    const t0 = now();
    const so: SpeakOptions = { rate: o.rate, clip: o.clip, interrupt: true };
    if (o.kana !== undefined) so.kana = o.kana;
    if (o.speaker !== undefined) so.speaker = o.speaker;
    if (o.voice !== undefined) so.voice = o.voice;
    if (o.onProgress) so.onProgress = o.onProgress;
    await speak(text, so);
    const source = audioSourceOf(a);
    return { source, seconds: source === 'none' ? 0 : Math.max(0, (now() - t0) / 1000), cueRate: null };
  };
  return { done: run(), stop: () => stop() };
}

/* ────────────────────────────────────────────────────────────────────────── */

export function StoryReader(p: StoryReaderProps | ExerciseProps): JSX.Element {
  if (isExerciseProps(p)) {
    const storyId = p.step.params.storyId ?? p.step.itemId ?? '';
    return (
      <StoryReaderView
        key={p.step.id}
        storyId={storyId}
        sessionId={p.step.id}
        feel={p.feel}
        furigana={p.furigana}
        jj={p.jj}
        onHint={p.onHint}
        frameHint
        onDone={(r) => p.onResult(toAttemptResult(r))}
      />
    );
  }
  return <StoryReaderView {...p} />;
}

interface GlossState {
  lineIndex: number;
  tokenIndex: number;
  token: string;
  reading: string;
  itemId: string | null;
  item: ContentItem | null;
  loading: boolean;
  capture: CaptureState;
}

/** Registers reading-phase keys (Enter = next line, Space = replay) with the frame; unmounts with the phase. */
function ReadingKeys(p: { onNext(): void; onReplay(): void }): null {
  useExerciseKeys({ onSubmit: p.onNext, onReplay: p.onReplay });
  return null;
}

/** Read-along transport state (design 08 §10.3). */
export type ListenPhase = 'ready' | 'playing' | 'paused' | 'held' | 'ended';

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return t.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'INPUT';
}

export function StoryReaderView(p: StoryReaderProps): JSX.Element {
  const loader = p.loader ?? content;
  const listenMode = p.mode === 'listen';
  const settings = store.settings.value;
  const cardsVersion = store.cards.version.value;
  const learnerStation = p.station ?? store.progress.value.station;
  const furigana = p.furigana ?? settings.furigana;
  const jj = p.jj ?? (settings.jj || learnerStation >= JJ_FROM_STATION);
  // Read once per episode: finishing emits `story:read`, which must not flip the gloss rule mid-read.
  const recorded = useMemo(() => isStoryRead(p.storyId), [p.storyId]);
  const firstRead = p.firstRead ?? !recorded;
  // Read-along: a hearing is cold when the id is absent at start (design 08 §10.4), read once at mount.
  const cold = useMemo(() => !isListened(p.storyId), [p.storyId]);
  const sessionId = p.sessionId ?? `story:${p.storyId}`;
  const frame = useExerciseFrame();

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

  const [phase, setPhase] = useState<'reading' | 'questions'>('reading');
  const [revealed, setRevealed] = useState(1);
  const [showEn, setShowEn] = useState(false);
  const [vertical, setVertical] = useState(settings.verticalText && learnerStation >= VERTICAL_FROM_STATION);
  const [glossTaps, setGlossTaps] = useState(0);
  const [hints, setHints] = useState(0);
  const [gloss, setGloss] = useState<GlossState | null>(null);
  const tapped = useRef(new Set<string>());
  const tappedTokens = useRef(new Set<string>());
  const finished = useRef(false);
  const latest = useRef(p);
  latest.current = p;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const timer = useMemo(() => createReadingTimer(store.now), []);
  useEffect(() => {
    if (!story || listenMode || timer.started()) return;
    timer.start();
    const unbind = bindVisibility(timer, document);
    return unbind;
  }, [story, timer, listenMode]);

  const fog = useMemo(() => fogPredicate(store.cards, furigana), [furigana, cardsVersion]);
  const slots = useMemo(() => speakerSlots(story?.lines ?? []), [story]);
  const coverage = useMemo(() => (story ? storyCoverage(story, knownIds()) : null), [story, cardsVersion]);
  const chars = useMemo(() => (story ? charCount(story.lines) : 0), [story]);
  const rng = useMemo(() => rngFor(store.seed(), store.today(), p.storyId, 'comprehension'), [p.storyId]);
  const spans = useMemo(() => (story ? story.lines.map((l) => tokenMoraSpans(l)) : []), [story]);

  const listRef = useRef<HTMLOListElement>(null);
  // i+1 and tapped marks on the token spans `<Ruby>` renders (attributes Preact does not manage).
  useEffect(() => {
    const root = listRef.current;
    if (!root || !story) return;
    root.querySelectorAll<HTMLElement>('li[data-line]').forEach((li) => {
      const li_ = Number(li.dataset.line);
      const line = story.lines[li_];
      if (!line) return;
      const plus = new Set((line.plusOne ?? []).map((id) => loader.resolveId(id)));
      li.querySelectorAll<HTMLElement>('.ruby__token[data-token]').forEach((span) => {
        const ti = Number(span.dataset.token);
        const raw = line.tokenIds?.[ti] ?? null;
        const id = raw ? loader.resolveId(raw) : null;
        if (id && plus.has(id)) span.setAttribute('data-plus-one', 'true');
        else span.removeAttribute('data-plus-one');
        if (tappedTokens.current.has(`${li_}:${ti}`)) span.setAttribute('data-tapped', 'true');
      });
    });
  });

  const lines = story?.lines ?? [];
  const n = lines.length;

  /* ── Read-along transport (design 08 §10.3) ─────────────────────────── */

  const rates = useMemo(() => readAlongRates(settings.speedTier), [settings.speedTier]);
  const chips = useMemo(() => rateChipsFor(rates), [rates]);
  const [listenPhase, setListenPhase] = useState<ListenPhase>('ready');
  const [cursor, setCursor] = useState(0);
  const [playingLine, setPlayingLine] = useState<number | null>(null);
  const [rateChip, setRateChip] = useState<RateChip>('tier');
  const [loop, setLoop] = useState(false);
  const live = useRef({ phase: 'ready' as ListenPhase, cursor: 0, rateChip: 'tier' as RateChip, loop: false, gloss: false, held: null as number | null, advanceOnResume: false, reading: true });
  live.current.reading = phase === 'reading';
  const playRun = useRef(0);
  const handle = useRef<LinePlayHandle | null>(null);
  const heard = useRef({ seconds: 0, rates: [] as number[], source: 'none' as AudioSource });
  const gist = useRef<boolean | null>(null);
  // A line still being spoken must not carry into the next step: stop the pack playback and the voice alike.
  useEffect(
    () => () => {
      playRun.current++;
      handle.current?.stop();
      handle.current = null;
      services.audio.cancel();
    },
    [],
  );

  const setLPhase = (ph: ListenPhase): void => {
    live.current.phase = ph;
    setListenPhase(ph);
  };
  const setLCursor = (i: number): void => {
    live.current.cursor = i;
    setCursor(i);
  };

  const sweep = (i: number, mora: number): void => {
    const li = listRef.current?.querySelector<HTMLElement>(`li[data-line="${i}"]`);
    const sp = spans[i];
    if (!li || !sp) return;
    const active = activeTokenAt(sp, mora);
    li.querySelectorAll<HTMLElement>('.ruby__token[data-token]').forEach((span) => {
      const ti = Number(span.dataset.token);
      const [s, e] = sp[ti] ?? [0, 0];
      const state = ti === active ? 'active' : e <= mora && (s < e || s <= mora) ? 'past' : 'ahead';
      span.setAttribute('data-sweep', state);
    });
  };
  const clearSweep = (i: number): void => {
    listRef.current?.querySelectorAll<HTMLElement>(`li[data-line="${i}"] .ruby__token[data-sweep]`).forEach((span) => span.removeAttribute('data-sweep'));
  };

  const stopPlayback = (): void => {
    playRun.current++;
    handle.current?.stop();
    handle.current = null;
    services.audio.cancel();
  };

  const playAt = (i: number): void => {
    const line = lines[i];
    if (!story || !line || finished.current) return;
    const id = ++playRun.current;
    setLCursor(i);
    setPlayingLine(i);
    setRevealed((r) => Math.max(r, i + 1));
    setLPhase('playing');
    live.current.advanceOnResume = false;
    const rate = rates[live.current.rateChip];
    const slot = line.speaker ? slots.get(line.speaker) : undefined;
    const speaker = line.speaker ?? story.narrator;
    const o: LinePlayOptions = {
      kana: line.kana,
      rate,
      clip: lineClipKey(story.id, i),
      onProgress: (_t, mora) => {
        if (playRun.current === id) sweep(i, mora);
      },
    };
    if (speaker !== undefined) o.speaker = speaker;
    if (slot !== undefined) o.voice = slot;
    const h = playLine(toPlain(line.ja), o);
    handle.current = h;
    void h.done.then((r) => {
      // Every played second counts, even on a line the learner interrupted.
      heard.current.seconds += r.seconds;
      if (r.seconds > 0) {
        heard.current.rates.push(rate);
        heard.current.source = r.source;
      }
      if (playRun.current !== id || !alive.current) return;
      handle.current = null;
      clearSweep(i);
      setPlayingLine(null);
      if (r.source === 'none') {
        // Text only: nothing was heard, so nothing advances on its own — the learner taps Next line.
        live.current.advanceOnResume = true;
        setLPhase('paused');
        return;
      }
      if (live.current.loop) {
        playAt(i);
        return;
      }
      if (live.current.gloss) {
        live.current.held = i + 1;
        setLPhase('held');
        return;
      }
      if (i + 1 < n) playAt(i + 1);
      else setLPhase('ended');
    });
  };

  const startListening = (): void => {
    if (!story) return;
    services.audio.warmUp();
    playAt(0);
  };
  const pauseListening = (): void => {
    if (live.current.phase !== 'playing') return;
    stopPlayback();
    setPlayingLine(null);
    setLPhase('paused');
  };
  const resumeListening = (): void => {
    const ph = live.current.phase;
    if (ph === 'ready') {
      startListening();
      return;
    }
    if (ph !== 'paused') return;
    if (live.current.advanceOnResume) {
      live.current.advanceOnResume = false;
      if (live.current.cursor + 1 < n) playAt(live.current.cursor + 1);
      else setLPhase('ended');
      return;
    }
    playAt(live.current.cursor);
  };
  const togglePlayback = (): void => {
    if (live.current.phase === 'playing') pauseListening();
    else resumeListening();
  };
  const jumpTo = (i: number): void => {
    if (i < 0 || i >= n) return;
    stopPlayback();
    playAt(i);
  };
  const toggleLoop = (): void => {
    live.current.loop = !live.current.loop;
    setLoop(live.current.loop);
  };
  const chooseRate = (chip: RateChip): void => {
    live.current.rateChip = chip;
    setRateChip(chip);
    if (live.current.phase === 'playing') {
      stopPlayback();
      playAt(live.current.cursor);
    }
  };
  const stepRate = (dir: 1 | -1): void => {
    const i = chips.indexOf(live.current.rateChip) + dir;
    const chip = chips[i];
    if (chip) chooseRate(chip);
  };

  const toQuestions = (): void => {
    if (phase !== 'reading' || !story) return;
    stopPlayback();
    setPlayingLine(null);
    closeGloss();
    setPhase('questions');
  };

  // Standalone Read-along keys: Space pause / resume · L loop line · ←/→ line · [ ] speed (design 08 §10.2 set) · Enter = the questions once the text has ended.
  const keyActions = useRef({ togglePlayback, toggleLoop, jumpTo, stepRate, toQuestions });
  keyActions.current = { togglePlayback, toggleLoop, jumpTo, stepRate, toQuestions };
  useEffect(() => {
    if (!listenMode || frame.inFrame) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      if (!live.current.reading) return;
      const k = keyActions.current;
      if (e.key === ' ') {
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        k.togglePlayback();
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        k.toggleLoop();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        k.jumpTo(live.current.cursor + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        k.jumpTo(live.current.cursor - 1);
      } else if (e.key === ']') {
        e.preventDefault();
        k.stepRate(1);
      } else if (e.key === '[') {
        e.preventDefault();
        k.stepRate(-1);
      } else if (e.key === 'Enter') {
        // a focused control owns Enter; otherwise it is "Check what you caught" (the button advertises it)
        if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement || live.current.phase !== 'ended') return;
        e.preventDefault();
        k.toQuestions();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listenMode, frame.inFrame]);

  /* ── reading ─────────────────────────────────────────────────────────── */

  const current = listenMode ? Math.min(cursor, Math.max(0, n - 1)) : Math.min(revealed, n) - 1;

  const speakLine = (i: number): void => {
    const line = lines[i];
    if (!line || !story) return;
    if (listenMode) {
      jumpTo(i);
      return;
    }
    const slot = line.speaker ? slots.get(line.speaker) : undefined;
    const speaker = line.speaker ?? story.narrator;
    void speak(toPlain(line.ja), { kana: line.kana, clip: lineClipKey(story.id, i), ...(speaker !== undefined ? { speaker } : {}), ...(slot ? { voice: slot } : {}) });
  };

  const closeGloss = (): void => {
    setGloss(null);
    live.current.gloss = false;
    if (live.current.phase === 'held' && live.current.held !== null) {
      const next_ = live.current.held;
      live.current.held = null;
      if (next_ < n) playAt(next_);
      else setLPhase('ended');
    }
  };

  const next = (): void => {
    if (phase !== 'reading' || !story) return;
    closeGloss();
    if (revealed < n) setRevealed(revealed + 1);
    else {
      timer.pause();
      setPhase('questions');
    }
  };

  const onReveal = (): void => {
    setHints((h) => h + 1);
    latest.current.onHint?.();
  };

  // English on: in the exercise step the first reveal is a hint (by `?`, the Hint button or the toolbar alike).
  const enHinted = useRef(false);
  const showEnglish = (): void => {
    if (showEn) return;
    setShowEn(true);
    if (latest.current.frameHint && !enHinted.current) {
      enHinted.current = true;
      onReveal();
    }
  };
  const canRevealEn = p.frameHint === true && phase === 'reading' && !showEn && current > 0;
  // Hint-only set: transparent to `ReadingKeys` / `Comprehension` keys; `?` reads it while reading.
  useExerciseKeys({ onHint: canRevealEn ? showEnglish : undefined });

  const onTokenTap =
    (lineIndex: number) =>
    (token: string, index: number): void => {
      const line = lines[lineIndex];
      if (!line || isPunctToken(token)) return;
      const raw = line.tokenIds?.[index] ?? null;
      const itemId = raw ? loader.resolveId(raw) : null;
      const tokenJa = segmentsToTokens(line.ja, line.tokens)[index]?.ja ?? token;
      const reading = toKana(tokenJa);
      setGlossTaps((t) => t + 1);
      tappedTokens.current.add(`${lineIndex}:${index}`);
      let introduced = false;
      if (itemId) {
        tapped.current.add(itemId);
        if (isCapturableId(itemId)) {
          const by = store.cards.byItem(itemId);
          introduced = Object.keys(by).length > 0;
          if (introduced) {
            const base = by.rec ?? by.prod ?? by.comp ?? by.cloze;
            const dueToday = !!base && base[0] <= store.today();
            onGlossTap({ token, itemId, introduced: true, dueWithin3: dueToday && !firstRead, sessionId, exercise: 'story-read' });
          }
        }
      }
      const item = itemId ? (loader.get(itemId) ?? null) : null;
      // Read-along: the voice keeps going; the player waits at the line boundary while this is open.
      live.current.gloss = true;
      setGloss({ lineIndex, tokenIndex: index, token, reading, itemId, item, loading: !!itemId && !item, capture: captureStateFor(itemId, token, introduced) });
      if (itemId && !item) {
        loader
          .getAsync(itemId)
          .then((it) => setGloss((g) => (g && g.itemId === itemId ? { ...g, item: it ?? null, loading: false } : g)))
          .catch(() => setGloss((g) => (g && g.itemId === itemId ? { ...g, loading: false } : g)));
      }
    };

  const onCapture = (): void => {
    if (!gloss || (gloss.capture !== 'capture' && gloss.capture !== 'bookmark')) return;
    const out = onGlossTap({ token: gloss.token, itemId: gloss.itemId, introduced: false, dueWithin3: false, sessionId, exercise: 'story-read' });
    const next_: CaptureState = out.kind === 'captured' || out.kind === 'already-captured' ? 'captured' : out.kind === 'bookmarked' || out.kind === 'already-bookmarked' ? 'bookmarked' : gloss.capture;
    setGloss({ ...gloss, capture: next_ });
  };

  const finish = (correct: number, total: number): void => {
    if (finished.current || !story) return;
    const cur = latest.current;
    if (cur.mode === 'listen') return;
    finished.current = true;
    const ms = timer.stop();
    const measured = cpmOf(chars, ms);
    const passed = passes(correct, total);
    const kaidenConfirmed: CardKey[] = [];
    if (passed) {
      for (const k of kaidenEvidence(story, tapped.current, store.cards, (id) => loader.resolveId(id))) {
        if (recordImplicit({ cardKey: k, rating: 3, exercise: 'story-read', sessionId })) kaidenConfirmed.push(k);
      }
    }
    const minutes = Math.round(ms / 60_000);
    const payload: Events['story:read'] = { storyId: story.id, mode: 'read', chars, cpm: measured, correct, total, glossTaps, minutes, bridge: story.bridge === true };
    const before = store.ledger.peek().entries.length;
    bus.emit('story:read', payload);
    const ledgerLogged = store.ledger.peek().entries.length > before;
    cur.onDone({
      storyId: story.id,
      correct,
      total,
      passed,
      cpm: measured,
      band: cpmBand(measured, levelForStation(learnerStation) ?? 'n5'),
      chars,
      ms,
      minutes,
      glossTaps,
      hints,
      dictionaryFree: isDictionaryFree(chars, correct, total, glossTaps),
      kaidenConfirmed,
      ledgerLogged,
      bridge: story.bridge === true,
      missing: false,
    });
  };

  /**
   * Read-along end (design 08 §10.3): one `listen:played`, the id into
   * `progress.listened`, never `story:read`. Nothing heard → nothing emitted.
   */
  const finishListen = (gistCorrect: boolean | null, correct: number, total: number, answered: boolean): void => {
    if (finished.current || !story) return;
    const cur = latest.current;
    if (cur.mode !== 'listen') return;
    finished.current = true;
    stopPlayback();
    const seconds = Math.round(heard.current.seconds * 10) / 10;
    const heardAny = seconds > 0;
    const rate = heard.current.rates.length > 0 ? Math.min(...heard.current.rates) : rates[live.current.rateChip];
    const authentic = heardAny && isAuthenticText(story) && rate >= 1 && gistCorrect === true;
    if (heardAny) {
      const payload: Events['listen:played'] = { source: 'readalong', refs: [story.id], seconds, rate, cold, authentic, gistCorrect };
      bus.emit('listen:played', payload);
      store.patch('progress', (pr) => markListened(pr, story.id));
    }
    cur.onDone({ storyId: story.id, seconds, rate, cold, authentic, gistCorrect, correct, total, answered, heard: heardAny, source: heard.current.source, missing: false });
  };

  const skipMissing = (): void => {
    if (finished.current) return;
    finished.current = true;
    const cur = latest.current;
    if (cur.mode === 'listen') {
      cur.onDone({ storyId: p.storyId, seconds: 0, rate: rates.tier, cold, authentic: false, gistCorrect: null, correct: 0, total: 0, answered: false, heard: false, source: 'none', missing: true });
      return;
    }
    cur.onDone({
      storyId: p.storyId,
      correct: 0,
      total: 0,
      passed: false,
      cpm: 0,
      band: 'below',
      chars: 0,
      ms: 0,
      minutes: 0,
      glossTaps: 0,
      hints: 0,
      dictionaryFree: false,
      kaidenConfirmed: [],
      ledgerLogged: false,
      bridge: false,
      missing: true,
    });
  };

  if (fetched === 'missing') {
    return (
      <section class="reader" aria-label={listenMode ? S.listenTitle : S.episodeLabel} data-state="missing" data-mode={p.mode ?? 'read'}>
        <div class="notice notice--warn" role="status">
          <strong>{S.storyMissing}</strong>
          <span>{S.storyMissingHint}</span>
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
      <section class="reader" aria-label={listenMode ? S.listenTitle : S.episodeLabel} data-state="loading" data-mode={p.mode ?? 'read'}>
        <p class="reader__hint" role="status">
          {S.storyLoading}
        </p>
      </section>
    );
  }

  const titleMode: FuriganaMode = furigana === 'off' ? 'off' : 'always';
  const allShown = revealed >= n;
  const cursorLine = lines[current];
  // The cue the pack would serve the current line at a rate (design 08 §8); `undefined` → the device voice or text only.
  const cueAt = (rate: number): ClipCue | undefined => {
    if (!listenMode || !cursorLine) return undefined;
    const speaker = cursorLine.speaker ?? story.narrator;
    return servedCue(services.audio, settings, lineClipKey(story.id, current), toPlain(cursorLine.ja), speaker !== undefined ? { rate, speaker } : { rate });
  };
  const source = listenSource(services.audio, cueAt(rates[rateChip]), heard.current.source);
  const textOnly = source === 'none';
  const naturalSlow = naturalSlowServed(cueAt(rates.slow), rates.slow);
  const rateLabel = (chip: RateChip): string => (chip === 'slow' ? (naturalSlow ? S.rateSlowNatural : S.rateSlow) : chip === 'tier' ? S.rateTier : S.rateFast);
  // The chip's title names the take: the natural one, a stretched one (by its native rate), or the device voice slowing down.
  const rateHint = (chip: RateChip, cue: ClipCue | undefined): string | undefined => {
    if (chip === 'slow' && naturalSlow) return S.rateSlowNaturalHint;
    if (cue && cue.rate !== rates[chip]) return fill(S.rateFromTakeHint, { rate: formatRate(rates[chip]), take: formatRate(cue.rate) });
    return chip === 'slow' ? S.rateSlowHint : undefined;
  };
  const gistIdx = gistQuestionIndex(story.comprehension);

  return (
    <section class="reader" aria-label={listenMode ? S.listenTitle : S.episodeLabel} data-state={phase} data-mode={p.mode ?? 'read'} data-feel={p.feel ?? settings.feel} data-listen-phase={listenMode ? listenPhase : undefined}>
      <header class="reader__head">
        {listenMode ? (
          <p class="eyebrow reader__mode" data-field="mode">
            <span lang="ja">{S.listenTitleJa}</span> {S.listenTitle}
          </p>
        ) : null}
        <h2 class="reader__title" lang="ja">
          <Ruby ja={story.titleJa} mode={titleMode} />
        </h2>
        <p class="reader__title-en">{story.titleEn}</p>
        <ul class="reader__chips" aria-label={S.episodeLabel}>
          <li class="chip">{story.kind === 'dialogue' ? S.dialogueLabel : S.episodeLabel}</li>
          <li class="chip">{S.registerLabel[story.register] ?? story.register}</li>
          {story.bridge ? (
            <li class="chip chip--accent" title={S.bridgeHint} data-field="bridge">
              {S.bridgeChip}
            </li>
          ) : null}
          <li class="chip">{fill(S.charsLabel, { n: chars })}</li>
          {coverage ? (
            <li class="chip" data-field="coverage">
              {fill(S.coverage, { known: coverage.known, total: coverage.total })}
            </li>
          ) : null}
          {listenMode ? (
            <li class="chip" data-field="source" data-source={source}>
              {sourceLabel(source)}
            </li>
          ) : null}
        </ul>
        {story.bridge ? <p class="reader__hint">{S.bridgeHint}</p> : null}
      </header>

      <div class="reader__toolbar">
        <button type="button" class="btn btn--ghost btn--sm" aria-pressed={showEn ? 'true' : 'false'} onClick={() => (showEn ? setShowEn(false) : showEnglish())} data-action="toggle-en">
          {showEn ? S.hideEnglish : S.showEnglish}
        </button>
        {learnerStation >= VERTICAL_FROM_STATION ? (
          <button
            type="button"
            class="btn btn--ghost btn--sm"
            aria-pressed={vertical ? 'true' : 'false'}
            data-action="toggle-vertical"
            onClick={() => {
              const v = !vertical;
              setVertical(v);
              store.patch('settings', (s) => (s.verticalText === v ? s : { ...s, verticalText: v }));
            }}
          >
            {vertical ? S.horizontal : S.vertical}
          </button>
        ) : null}
        <span class="reader__progress" aria-live="polite" data-field="progress">
          {fill(S.readingProgress, { i: listenMode ? current + 1 : Math.min(revealed, n), n })}
        </span>
      </div>
      <p class="reader__hint">{listenMode ? S.listenHint : furigana === 'fog' || furigana === 'tap' ? `${S.tapGlossHint} ${S.revealHint}` : S.tapGlossHint}</p>
      {listenMode && textOnly ? (
        <p class="notice notice--warn reader__hint" role="status" data-field="text-only">
          {S.listenTextOnly}
        </p>
      ) : null}

      <ol ref={listRef} class={vertical ? 'reader__lines reader__lines--vertical' : 'reader__lines'} data-vertical={vertical ? 'true' : undefined}>
        {lines.slice(0, revealed).map((line, i) => {
          const hasTokens = line.tokens.length > 0;
          const enVisible = showEn && (i < current || phase === 'questions');
          const plus = (line.plusOne ?? []).length > 0;
          return (
            <li
              key={i}
              class="reader__line"
              data-line={i}
              data-current={i === current && phase === 'reading' ? 'true' : undefined}
              data-speaking={listenMode && playingLine === i ? 'true' : undefined}
              data-plus-one={plus ? 'true' : undefined}
            >
              {line.speaker ? (
                <span class="reader__speaker" lang="ja">
                  {line.speaker}
                </span>
              ) : null}
              <Ruby
                ja={line.ja}
                mode={furigana}
                fog={fog}
                onReveal={onReveal}
                vertical={vertical}
                class="reader__ja"
                {...(hasTokens ? { tokens: line.tokens, onTokenTap: onTokenTap(i) } : {})}
              />
              {enVisible ? (
                <p class="reader__en" data-field="en">
                  {line.en}
                </p>
              ) : null}
              <div class="reader__line-tools">
                <button type="button" class="btn btn--ghost btn--sm" onClick={() => speakLine(i)} aria-label={listenMode ? S.playFromHere : S.listenLine} data-action="listen">
                  {listenMode ? S.playFromHere : S.listenLine}
                </button>
                {plus ? (
                  <span class="chip chip--accent" title={S.plusOneHint} data-field="plus-one">
                    {S.plusOneChip}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {phase === 'reading' && !listenMode ? (
        <div class="reader__toolbar">
          <ReadingKeys onNext={next} onReplay={() => speakLine(current)} />
          <button type="button" class="btn" onClick={next} data-action="next" aria-keyshortcuts="Enter">
            {allShown ? S.finishReading : S.nextLine}
          </button>
          {!allShown ? (
            <button type="button" class="btn btn--ghost" onClick={() => setRevealed(n)} data-action="show-rest">
              {S.showRest}
            </button>
          ) : null}
          {!showEn && current === 0 ? <span class="reader__hint">{S.englishLocked}</span> : null}
        </div>
      ) : null}

      {phase === 'reading' && listenMode ? (
        <div class="reader__transport" data-field="transport">
          {listenPhase === 'ready' ? (
            <button type="button" class="hanko" onClick={startListening} data-action="start" aria-keyshortcuts="Space">
              {S.listenStart}
            </button>
          ) : null}
          {listenPhase === 'playing' ? (
            <button type="button" class="btn" onClick={pauseListening} data-action="pause" aria-keyshortcuts="Space">
              {S.listenPause}
            </button>
          ) : null}
          {listenPhase === 'paused' ? (
            <button type="button" class="btn" onClick={resumeListening} data-action="resume" aria-keyshortcuts="Space">
              {live.current.advanceOnResume ? S.nextLine : S.listenResume}
            </button>
          ) : null}
          {listenPhase === 'held' ? (
            <span class="reader__hint" role="status" data-field="held">
              {S.listenHeld}
            </span>
          ) : null}
          {listenPhase === 'ended' ? (
            <>
              <span class="reader__hint" role="status" data-field="ended">
                {S.listenEnded}
              </span>
              <button type="button" class="hanko" onClick={toQuestions} data-action="to-questions" aria-keyshortcuts="Enter">
                {S.listenToQuestions}
              </button>
              <button type="button" class="btn btn--ghost" onClick={() => finishListen(null, 0, story.comprehension.length, false)} data-action="finish-listen">
                {S.listenSkipQuestions}
              </button>
              <button type="button" class="btn btn--ghost" onClick={() => jumpTo(0)} data-action="listen-again">
                {S.listenAgain}
              </button>
            </>
          ) : null}
          {listenPhase !== 'ready' && listenPhase !== 'ended' ? (
            <>
              <button type="button" class="btn btn--ghost btn--sm" onClick={() => jumpTo(current - 1)} disabled={current <= 0} data-action="prev-line" aria-keyshortcuts="ArrowLeft">
                {S.listenPrevLine}
              </button>
              <button type="button" class="btn btn--ghost btn--sm" onClick={() => jumpTo(current + 1)} disabled={current + 1 >= n} data-action="next-line" aria-keyshortcuts="ArrowRight">
                {S.nextLine}
              </button>
            </>
          ) : null}
          <button type="button" class="btn btn--ghost btn--sm" onClick={toggleLoop} aria-pressed={loop ? 'true' : 'false'} data-action="loop" aria-keyshortcuts="L" title={S.loopLineHint}>
            {S.loopLine}
          </button>
          <div class="reader__rates" role="group" aria-label={S.rateLabel} data-field="rates">
            {chips.map((chip) => {
              const cue = cueAt(rates[chip]);
              return (
                <button
                  key={chip}
                  type="button"
                  class="chip reader__rate"
                  data-rate-chip={chip}
                  data-rate={rates[chip]}
                  data-cue-rate={cue?.rate}
                  aria-pressed={rateChip === chip ? 'true' : 'false'}
                  onClick={() => chooseRate(chip)}
                  title={rateHint(chip, cue)}
                >
                  {rateLabel(chip)}
                  <small>{formatRate(rates[chip])}</small>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {phase === 'questions' ? (
        <>
          {listenMode ? <p class="reader__hint">{S.listenQuestionsHint}</p> : null}
          <Comprehension
            questions={story.comprehension}
            rng={rng}
            onAnswer={(i, ok) => {
              if (i === gistIdx) gist.current = ok;
            }}
            onDone={(r) => (listenMode ? finishListen(gist.current, r.correct, r.total, true) : finish(r.correct, r.total))}
          />
        </>
      ) : null}

      {gloss ? <Gloss item={gloss.item} token={gloss.token} reading={gloss.reading} jj={jj} loading={gloss.loading} capture={gloss.capture} onCapture={onCapture} onClose={closeGloss} /> : null}
    </section>
  );
}
