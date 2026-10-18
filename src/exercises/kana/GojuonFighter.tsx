/**
 * TSUZUKU — 五十音ファイター Gojūon Fighter (design 04 §1, 05 §4): the kana
 * arcade round. 46 kana glide in from the right, one at a time; type the
 * romaji before each one lands — the IME spelling or the display romaji the
 * corpus teaches (`isDisplayRomaji`: o for を, as Kana Flash accepts it). The
 * deadline tightens from 3.5 s to 1.5 s over the round. Rows are the "opponents" (か行 …); the rival's lantern dims
 * per miss (no health bars).
 *
 * Fluency mode, nothing is graded here (`learn/grading` treats the drill as
 * arcade). `params.pool` holds the mature kana `rec` card keys (S ≥ 14 d); the
 * rest of the 46 are younger kana shown for practice. At the end the round:
 *   · sets the `recheck` flag (16) on every missed pool card, so the builder
 *     re-tests it untimed next session (Again only if that fails),
 *   · writes one review-log row per pool kana that already has a history
 *     (exercise gojuon-fighter, rating 3 hit / 1 miss, ms = reaction) — the
 *     `kana-grid` wallpaper reads these for its reaction-time heatmap,
 *   · emits `arcade:done {mode:'gojuon', correct, misses, ms, recheck}`
 *     (B reduces XP, stats, badges), then calls `onResult` with the round's
 *     ms, `score` = hits / total and `correct` = no misses.
 * Reduced motion: the kana stays put and the countdown bar does the moving.
 *
 * Design 09 §2.5 / §5.6–§5.8 / §10 D1: the round is a woodblock print — the
 * heads are `.poster-title`s on `.sheet` panels, the landing bar is a `.meter`,
 * the counts roll through `<Ticker roll>`, labels are `.eyebrow`s, and the BEST
 * eyebrow compares the round's hits with the learner's OWN `stats.gojuonBest`
 * only, never on a miss (footnote 5). `.crt` stays opt-in (arcade.css gates it
 * on the CRT setting). The frame's step turn is the result panel's exit.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { content } from '@/content/loader';
import { DRILL_IDS, type CardKey, type ContentItem, type KanaItem } from '@/content/types';
import { sfx } from '@/shared/audio';
import { bus } from '@/shared/events';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { rngFor, sample, shuffle } from '@/shared/hash';
import { parseCardKey } from '@/shared/ids';
import { containsKatakana, equivalentJa, moraSplit, toHiragana } from '@/shared/jp';
import { finalizeIme, imeStep } from '@/shared/kana-ime';
import { CardFlag, hasFlag, withFlag, type CardTuple, type LogEntry } from '@/shared/store-types';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { Ticker } from '@/shared/ui/Ticker';
import { store } from '@/store';
import { attempt } from '../check';
import { S as X } from '../strings';
import { S as GS } from './gojuon-strings';
import { isDisplayRomaji, isKanaItem, kanaFromId } from './KanaFlash';
import { ROW_JA, S, fill } from './strings';
import './kana.css';

export const meta: ExerciseMeta = {
  id: 'gojuon-fighter',
  facet: null,
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'text',
};

export const GOJUON_ROUND_SIZE = 46;
export const GLIDE_START_MS = 3500;
export const GLIDE_END_MS = 1500;
export const TICK_MS = 50;
const GOJUON_IDX = DRILL_IDS.indexOf('gojuon-fighter');

export interface GojuonKana {
  id: string;
  cardKey: CardKey | null;
  glyph: string;
  romaji: string;
  row: string;
  /** From the mature pool: a miss sets `recheck`. */
  graded: boolean;
}
export interface GojuonReaction extends GojuonKana {
  ms: number;
  hit: boolean;
}
export interface GojuonRound {
  total: number;
  hits: number;
  misses: number;
  ms: number;
  reactions: GojuonReaction[];
  recheck: CardKey[];
}

/** Time to land for kana `i` of `n`: 3.5 s → 1.5 s, linear over the round. */
export function landMs(i: number, n: number): number {
  if (n <= 1) return GLIDE_START_MS;
  const t = Math.max(0, Math.min(1, i / (n - 1)));
  return Math.round(GLIDE_START_MS - (GLIDE_START_MS - GLIDE_END_MS) * t);
}

const HIRA_46 = Array.from('あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん');
const KATA_46 = Array.from('アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン');
const ROMAJI_46 = ['a', 'i', 'u', 'e', 'o', 'ka', 'ki', 'ku', 'ke', 'ko', 'sa', 'shi', 'su', 'se', 'so', 'ta', 'chi', 'tsu', 'te', 'to', 'na', 'ni', 'nu', 'ne', 'no', 'ha', 'hi', 'fu', 'he', 'ho', 'ma', 'mi', 'mu', 'me', 'mo', 'ya', 'yu', 'yo', 'ra', 'ri', 'ru', 're', 'ro', 'wa', 'wo', 'n'];

const ROW_OF_CONSONANT: Record<string, string> = { '': 'a', k: 'k', g: 'g', s: 's', sh: 's', z: 'z', j: 'z', t: 't', ch: 't', ts: 't', d: 'd', n: 'n', h: 'h', f: 'h', b: 'b', p: 'p', m: 'm', y: 'y', r: 'r', w: 'w' };

/** Gojūon row of a romaji syllable (`shi` → s, `n` → nn, `fa` → ext). */
export function rowOf(romaji: string): string {
  if (romaji === 'n') return 'nn';
  const c = romaji.replace(/[aiueo]+$/, '').replace(/y$/, '');
  return ROW_OF_CONSONANT[c] ?? 'ext';
}

function entryFor(id: string, cardKey: CardKey | null, graded: boolean, get: (id: string) => ContentItem | undefined): GojuonKana | null {
  const item = get(id);
  if (isKanaItem(item)) return { id, cardKey, glyph: item.kana, romaji: item.romaji, row: item.row, graded };
  const d = kanaFromId(id);
  if (!d) return null;
  return { id, cardKey, glyph: d.glyph, romaji: d.romaji, row: rowOf(d.romaji), graded };
}

export interface BuildRoundOptions {
  seed: string;
  day: number;
  stepId: string;
  /** Item lookup (default: the content loader's sync cache). */
  get?: (id: string) => ContentItem | undefined;
  size?: number;
}

/**
 * The round: every pool kana (deduped by item, sampled to `size` when larger),
 * padded with younger kana of the pool's dominant script, shuffled. Seeded by
 * `seed + day + stepId`, so a resumed round is the same round.
 */
export function buildRound(pool: readonly CardKey[], o: BuildRoundOptions): GojuonKana[] {
  const size = o.size ?? GOJUON_ROUND_SIZE;
  const get = o.get ?? ((id: string): ContentItem | undefined => content.get(id));
  const rng = rngFor(o.seed, o.day, o.stepId, 'gojuon');
  const seen = new Set<string>();
  const graded: GojuonKana[] = [];
  for (const key of pool) {
    let itemId: string;
    try {
      itemId = parseCardKey(key).itemId;
    } catch {
      continue;
    }
    if (seen.has(itemId)) continue;
    seen.add(itemId);
    const e = entryFor(itemId, key, true, get);
    if (e) graded.push(e);
  }
  const chosen = graded.length > size ? sample(rng, graded, size) : graded.slice();
  const katakana = chosen.filter((k) => containsKatakana(k.glyph)).length > chosen.length / 2;
  const alphabet = katakana ? KATA_46 : HIRA_46;
  const have = new Set(chosen.map((k) => k.glyph));
  const fillers: GojuonKana[] = [];
  alphabet.forEach((glyph, i) => {
    if (have.has(glyph)) return;
    const romaji = ROMAJI_46[i] as string;
    const id = `k-${katakana ? 'k' : 'h'}-${romaji}`;
    if (seen.has(id)) return;
    fillers.push(entryFor(id, null, false, get) ?? { id, cardKey: null, glyph, romaji, row: rowOf(romaji), graded: false });
  });
  const room = Math.max(0, size - chosen.length);
  return shuffle(rng, [...chosen, ...sample(rng, fillers, room)]);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : Math.round(((s[mid - 1] as number) + (s[mid] as number)) / 2);
}

function fmt(ms: number): string {
  return (Math.round(ms / 100) / 10).toFixed(1);
}

/** Flags, log rows and the bus event for a finished round (see the header). Exported for the tests. */
export function commitRound(round: GojuonRound): void {
  for (const key of round.recheck) {
    const c = store.cards.get(key);
    if (c && !hasFlag(c[7], CardFlag.recheck)) {
      const next: CardTuple = [c[0], c[1], c[2], c[3], c[4], c[5], c[6], withFlag(c[7], CardFlag.recheck)];
      store.cards.set(key, next);
    }
  }
  const now = store.now();
  for (const r of round.reactions) {
    if (!r.graded || !r.cardKey) continue;
    if (store.log.forCard(r.cardKey).length === 0) continue; // never the first row of a card's history
    store.log.push([now, r.cardKey, r.hit ? 3 : 1, Math.max(0, Math.round(r.ms)), GOJUON_IDX, 0] as LogEntry);
  }
  bus.emit('arcade:done', { mode: 'gojuon', correct: round.hits, misses: round.misses, ms: round.ms, recheck: round.recheck.slice() });
}

export type GojuonFighterProps = ExerciseProps<{ pool: CardKey[] }> & {
  /** Additive: the finished round (tests, the Records page). */
  onRound?(r: GojuonRound): void;
};

export function GojuonFighter(p: GojuonFighterProps): JSX.Element {
  return <GojuonFighterBody key={p.step.id} {...p} />;
}

type Phase = 'ready' | 'play' | 'over';

function GojuonFighterBody(p: GojuonFighterProps): JSX.Element {
  const pool = p.step.params.pool ?? [];
  const round = useMemo(() => buildRound(pool, { seed: store.seed(), day: store.today(), stepId: p.step.id }), [pool, p.step.id]);
  const n = round.length;
  const [phase, setPhase] = useState<Phase>('ready');
  const [idx, setIdx] = useState(0);
  const [value, setValue] = useState('');
  const [remain, setRemain] = useState(1);
  const [misses, setMisses] = useState(0);
  const [last, setLast] = useState<'hit' | 'miss' | null>(null);
  const [result, setResult] = useState<GojuonRound | null>(null);
  const idxRef = useRef(0);
  const shownAt = useRef(0);
  const startedAt = useRef(0);
  const reactions = useRef<GojuonReaction[]>([]);
  const fired = useRef(false);
  /** The learner's OWN best before this round: the only number the BEST eyebrow compares with. */
  const bestBefore = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const phaseRef = useRef<Phase>('ready');
  phaseRef.current = phase;

  const start = (): void => {
    if (phaseRef.current !== 'ready' || n === 0) return;
    const now = store.now();
    startedAt.current = now;
    shownAt.current = now;
    idxRef.current = 0;
    reactions.current = [];
    setIdx(0);
    setRemain(1);
    setPhase('play');
  };

  const finishRound = (): void => {
    if (fired.current) return;
    fired.current = true;
    const list = reactions.current;
    const hits = list.filter((r) => r.hit).length;
    const recheck = list.filter((r) => !r.hit && r.graded && r.cardKey).map((r) => r.cardKey as CardKey);
    const r: GojuonRound = { total: list.length, hits, misses: list.length - hits, ms: Math.max(0, store.now() - startedAt.current), reactions: list.slice(), recheck };
    bestBefore.current = store.stats.value.gojuonBest;
    setResult(r);
    setPhase('over');
    commitRound(r);
    p.onRound?.(r);
    p.onResult(attempt({ ms: r.ms, correct: r.misses === 0, score: r.total > 0 ? hits / r.total : 0, answer: `${hits}/${r.total}` }));
  };

  const advance = (hit: boolean): void => {
    if (phaseRef.current !== 'play') return;
    const i = idxRef.current;
    const k = round[i];
    if (!k) return;
    const now = store.now();
    reactions.current.push({ ...k, ms: Math.max(0, now - shownAt.current), hit });
    sfx(hit ? 'correct' : 'wrong');
    setLast(hit ? 'hit' : 'miss');
    if (!hit) setMisses((m) => m + 1);
    setValue('');
    const next = i + 1;
    if (next >= n) {
      finishRound();
      return;
    }
    idxRef.current = next;
    shownAt.current = now;
    setIdx(next);
    setRemain(1);
  };

  // Glide clock: a 50 ms tick on `store.now()`; landing is a miss.
  useEffect(() => {
    if (phase !== 'play') return;
    const tick = (): void => {
      const i = idxRef.current;
      const land = landMs(i, n);
      const el = store.now() - shownAt.current;
      setRemain(Math.max(0, 1 - el / land));
      if (el >= land) advance(false);
    };
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, idx, n]);

  useEffect(() => {
    if (phase === 'play') inputRef.current?.focus();
  }, [phase, idx]);

  const judge = (raw: string): void => {
    const k = round[idxRef.current];
    if (!k) return;
    if (isDisplayRomaji(raw, k.romaji, k.glyph)) {
      advance(true);
      return;
    }
    const st = imeStep(raw);
    if (st.pending !== '' || st.text.length === 0) return;
    if (equivalentJa(st.text, k.glyph)) {
      advance(true);
      return;
    }
    const given = toHiragana(st.text);
    const target = toHiragana(k.glyph);
    if (!target.startsWith(given) && moraSplit(given).length >= moraSplit(target).length) advance(false);
  };

  const onInput = (e: JSX.TargetedEvent<HTMLInputElement, Event>): void => {
    const v = e.currentTarget.value;
    setValue(v);
    judge(v);
  };

  const submit = (): void => {
    if (phaseRef.current === 'ready') {
      start();
      return;
    }
    if (phaseRef.current !== 'play') return;
    const k = round[idxRef.current];
    if (!k) return;
    if (isDisplayRomaji(value, k.romaji, k.glyph)) {
      advance(true);
      return;
    }
    const final = finalizeIme(value.trim());
    if (final.length === 0) return;
    advance(equivalentJa(final, k.glyph));
  };

  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    submit();
  };

  useExerciseKeys({ onSubmit: submit });

  const gradedCount = round.filter((k) => k.graded).length;
  const current = round[idx];
  const lanternDim = Math.min(10, misses);
  const hitMs = result ? result.reactions.filter((r) => r.hit).map((r) => r.ms) : [];
  const fastest = hitMs.length > 0 ? Math.min(...hitMs) : 0;

  return (
    <div class="gojuon crt" data-exercise="gojuon-fighter" data-phase={phase} data-feel={p.feel}>
      <div class="gojuon__head">
        <span class="gojuon__opponent">
          <span>{S.opponent}</span>
          {current ? (
            <span lang="ja" data-row={current.row}>
              {ROW_JA[current.row] ?? current.row}
            </span>
          ) : null}
        </span>
        <span class="gojuon__lantern" style={{ '--dim': String(lanternDim) }} role="img" aria-label={fill(S.lanternLabel, { n: misses })} data-dim={lanternDim}>
          <Ticker value={misses} roll />
        </span>
        <span class="gojuon__status" aria-live="polite">
          {phase === 'play' ? fill(S.gojuonProgress, { i: idx + 1, n }) : phase === 'over' ? X.roundOver : ''}
        </span>
      </div>

      {phase === 'ready' ? (
        <div class="drill sheet">
          <h3 class="poster-title">{S.gojuonTitle}</h3>
          <p class="drill__prompt">{fill(S.gojuonIntro, { n })}</p>
          <p class="drill__hint">{gradedCount > 0 ? fill(S.gojuonGraded, { n: gradedCount }) : S.gojuonEmpty}</p>
          {n - gradedCount > 0 ? <p class="drill__hint">{fill(S.gojuonPractice, { n: n - gradedCount })}</p> : null}
          <p class="drill__hint">{S.gojuonReduced}</p>
          <div class="drill__row">
            <button type="button" class="hanko" onClick={start} disabled={n === 0} aria-keyshortcuts="Enter">
              {S.startRound}
            </button>
            <span class="drill__hint">{S.startHint}</span>
          </div>
        </div>
      ) : null}

      {phase === 'play' && current ? (
        <>
          <div class="gojuon__stage" role="img" aria-label={S.gojuonStage}>
            <div class="gojuon__land" aria-hidden="true" />
            <p class="gojuon__kana" lang="ja" style={{ '--remain': remain.toFixed(3) }} data-state={last ?? undefined} data-index={idx}>
              {current.glyph}
            </p>
          </div>
          <span class="meter gojuon__track" style={{ '--value': remain.toFixed(3) }} aria-hidden="true">
            <span class="meter__fill" />
          </span>
          <input
            ref={inputRef}
            class="drill__field gojuon__field"
            type="text"
            inputMode="latin"
            lang="en"
            value={value}
            aria-label={S.gojuonField}
            autoComplete="off"
            autoCapitalize="off"
            spellcheck={false}
            enterKeyHint="go"
            onInput={onInput}
            onKeyDown={onKeyDown}
          />
          <p class="gojuon__status drill__sr" role="status">
            {last === 'hit' ? S.hit : last === 'miss' ? S.landed : ''}
          </p>
        </>
      ) : null}

      {phase === 'over' && result ? (
        <div class="drill sheet gojuon__over">
          <h3 class="poster-title poster-title--m">{X.roundOver}</h3>
          <p class="eyebrow">{GS.resultEyebrow}</p>
          {result.hits > bestBefore.current && bestBefore.current > 0 ? <p class="eyebrow gojuon__best">{fill(GS.bestEyebrow, { n: bestBefore.current })}</p> : null}
          <dl class="gojuon__stats hiscore">
            <div>
              <dt class="eyebrow">{S.hits}</dt>
              <dd>
                <Ticker value={result.hits} roll /> / {result.total}
              </dd>
            </div>
            <div>
              <dt class="eyebrow">{S.misses}</dt>
              <dd>
                <Ticker value={result.misses} roll />
              </dd>
            </div>
            <div>
              <dt class="eyebrow">{S.fastest}</dt>
              <dd>{fill(S.seconds, { s: fmt(fastest) })}</dd>
            </div>
            <div>
              <dt class="eyebrow">{S.median}</dt>
              <dd>{fill(S.seconds, { s: fmt(median(hitMs)) })}</dd>
            </div>
          </dl>
          <p class="drill__hint">
            {S.roundTime} {fill(S.seconds, { s: fmt(result.ms) })}
          </p>
          <p class="drill__prompt">{result.recheck.length > 0 ? fill(S.recheckCount, { n: result.recheck.length }) : S.cleanRound}</p>
          <p class="drill__hint">{X.recheckNote}</p>
          <p class="eyebrow">{S.reactionList}</p>
          <ul class="gojuon__reactions">
            {result.reactions.map((r, i) => (
              <li key={`${r.id}:${i}`} class="gojuon__reaction" data-hit={r.hit ? 'true' : 'false'} data-graded={r.graded ? 'true' : 'false'} data-ms={Math.round(r.ms)}>
                <span lang="ja">{r.glyph}</span>
                <span>{r.hit ? fill(S.seconds, { s: fmt(r.ms) }) : S.missTag}</span>
                {!r.graded ? <span>· {S.practiceTag}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
