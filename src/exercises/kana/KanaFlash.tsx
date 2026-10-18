/**
 * TSUZUKU — 仮名閃 Kana Flash (design 04 §1): one kana or digraph (TTS once)
 * → type the romaji; the answer submits itself the moment the romaji resolves
 * to the kana. Hepburn and Kunrei both count (`shi`/`si`, `tsu`/`tu`,
 * `ji`/`di` for ぢ, `zu`/`du` for づ) because the typed romaji is converted
 * with the Kana Forge IME and compared with `equivalentJa`. A resolved answer
 * that cannot still become the kana (か for き) submits as a miss, so the
 * drill never waits on Enter; Enter still submits whatever is there.
 *
 * First two exposures (and a step that carries `params.choices`): four romaji
 * choices instead of typing. Mature cards show the 1.5 s target
 * (`step.timerMs` when the planner set one) and the reaction time afterwards;
 * the speed ring itself is drawn by `<ExerciseFrame>`.
 *
 * The corpus romaji is display Hepburn (CONTENT_GUIDE §3: を = o, ティ = ti …)
 * and nine kana do not round-trip through the IME (o → お, ti → チ). The
 * item's own romaji therefore always counts — as a choice and as typed text,
 * before the IME step — and the after-card adds the IME spelling
 * (`imeRomaji`: wo, thi …) when it differs, so Kana Forge and Gojūon Fighter
 * can be typed.
 *
 * This file also hosts the helpers every D drill shares (kana/ and vocab/):
 * `useLatency`, `useDrillKeys`, `MissingItem`, `missingResult`, `isKanaItem`,
 * `kanaFromId`, `imeRomaji`, `romajiLabel`, `romajiDistractors`, and the kana
 * drills' first-contact cards (design 08 §11): `<KanaTeach>` with
 * `kanaTeachId` / `hasHeldBeat` — `morae-beats` at Station 1 in Kana Ear,
 * `held-beat` from Station 2 on the first long-vowel / っ item. Every kana
 * drill speaks with `clip: item.id` (design 08 §10.5): the pack resolves it
 * to the kana clip and falls back to the device voice when it misses.
 */
import type { JSX, RefObject } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ContentItem, KanaItem } from '@/content/types';
import { speak } from '@/shared/audio';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { rngFor, shuffle, type Rng } from '@/shared/hash';
import { equivalentJa, moraSplit, normalizeAnswer, toHiragana } from '@/shared/jp';
import { finalizeIme, imeStep, romajiToKana } from '@/shared/kana-ime';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { TeachOnce, markTeachSeen } from '@/shared/ui/TeachOnce';
import { isMature } from '@/learn';
import { store } from '@/store';
import { ChoiceGrid } from '../ChoiceGrid';
import { attempt, checkJa, gradeChoice, whyFor } from '../check';
import { S as X } from '../strings';
import { HELD_EXAMPLES, MORAE_EXAMPLES, S, fill } from './strings';
import './kana.css';

export const meta: ExerciseMeta = {
  id: 'kana-flash',
  facet: 'rec',
  needsTts: false,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'text',
};

/** Target reaction time on a mature kana (design 04 §1). */
export const KANA_FLASH_TARGET_MS = 1500;

/* ────────────────────────────────────────────────────────────────────────── */
/* Shared helpers (kana/ and vocab/ drills)                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export function isKanaItem(item: ContentItem | null | undefined): item is KanaItem {
  return !!item && 'kana' in item && 'romaji' in item && 'script' in item;
}

const KANA_ID_RE = /^k-([hk])-([a-z]{1,4})$/;

/** Glyph, romaji and script derived from a kana id (`k-h-shi` → し) when the item is not loaded. */
export function kanaFromId(id: string): { glyph: string; romaji: string; script: KanaItem['script'] } | null {
  const m = KANA_ID_RE.exec(id);
  if (!m) return null;
  const script: KanaItem['script'] = m[1] === 'k' ? 'katakana' : 'hiragana';
  const romaji = m[2] as string;
  const glyph = romajiToKana(romaji, { katakana: script === 'katakana' });
  if (/[a-z]/.test(glyph)) return null;
  return { glyph, romaji, script };
}

/**
 * The romaji spelling the IME turns into exactly this kana: the display romaji
 * when it round-trips (ka → か), else the id's spelling (を → wo, ティ → thi),
 * else the display romaji unchanged.
 */
export function imeRomaji(item: Pick<KanaItem, 'id' | 'kana' | 'romaji'>): string {
  if (romajiMatches(item.romaji, item.kana)) return item.romaji;
  const d = kanaFromId(item.id);
  return d && equivalentJa(d.glyph, item.kana) ? d.romaji : item.romaji;
}

/** Display romaji, with the IME spelling after it when the two differ (`o · wo`). */
export function romajiLabel(item: Pick<KanaItem, 'id' | 'kana' | 'romaji'>): string {
  const ime = imeRomaji(item);
  return ime === item.romaji ? item.romaji : `${item.romaji} · ${ime}`;
}

/** A step's latency clock: `ms()` since the origin; `restart()` moves the origin to now. */
export type LatencyClock = (() => number) & { restart(): void };

/**
 * Latency clock for a step: `ms()` is `store.now()` minus the origin — the
 * mount, re-based per step id. `restart()` re-bases it to now: the kana
 * drills call it when a first-contact card is dismissed (design 08 §11), so
 * the time spent reading the card is never charged to the rep (a mature kana
 * card shows its 1.5 s target).
 */
export function useLatency(stepId: string): LatencyClock {
  const origin = useRef<{ stepId: string; t0: number } | null>(null);
  if (origin.current === null || origin.current.stepId !== stepId) origin.current = { stepId, t0: store.now() };
  const clock = (() => Math.max(0, store.now() - (origin.current?.t0 ?? store.now()))) as LatencyClock;
  clock.restart = () => {
    origin.current = { stepId, t0: store.now() };
  };
  return clock;
}

/** Clicks the control inside `root` that declares `aria-keyshortcuts="<key>"`. */
function clickShortcut(root: RefObject<HTMLElement>, key: string): boolean {
  const el = root.current?.querySelector<HTMLElement>(`[aria-keyshortcuts="${key}"]`);
  if (!el || (el as HTMLButtonElement).disabled) return false;
  el.click();
  return true;
}

/**
 * The frame forwards keys only to the LAST registered handler set, and a
 * parent's `useExerciseKeys` registers after its children's (`ChoiceGrid`,
 * `TextAnswer`, `PitchLine`). A drill that needs its own Space / Enter
 * therefore registers one set here and forwards digits and Enter to the
 * widget buttons through their `aria-keyshortcuts` attributes. `onHint` is
 * the drill's own reveal for the frame's `?` key / Hint button: pass it only
 * while there is something to reveal (the button follows it).
 */
export function useDrillKeys(root: RefObject<HTMLElement>, h: { onReplay?: () => void; onSubmit?: () => void; onChoice?: (i: number) => void; onHint?: () => void }): void {
  useExerciseKeys({
    onHint: h.onHint,
    onChoice: (i) => {
      if (h.onChoice) h.onChoice(i);
      else clickShortcut(root, String(i + 1));
    },
    onReplay: () => h.onReplay?.(),
    onSubmit: () => {
      if (h.onSubmit) h.onSubmit();
      else if (!clickShortcut(root, 'Enter')) {
        // TextAnswer's confirm step: Enter is the honest default, 「No. Mark it.」
        const decline = root.current?.querySelector<HTMLButtonElement>('.text-answer__decline');
        if (decline && !decline.disabled) decline.click();
      }
    },
  });
}

/** A missing item is graded as a soft timeout (Hard, never Again) so the session can move on. */
export function missingResult(ms: number): AttemptResult {
  return attempt({ ms, timedOut: true, answer: '' });
}

export function MissingItem(p: { onContinue(): void }): JSX.Element {
  return (
    <div class="missing-item notice" role="status">
      <p>{X.itemMissing}</p>
      <button type="button" class="btn" onClick={() => p.onContinue()}>
        {S.skipMissing}
      </button>
    </div>
  );
}

const ROMAJI_TABLE: readonly string[] = [
  'a', 'i', 'u', 'e', 'o', 'ka', 'ki', 'ku', 'ke', 'ko', 'sa', 'shi', 'su', 'se', 'so', 'ta', 'chi', 'tsu', 'te', 'to',
  'na', 'ni', 'nu', 'ne', 'no', 'ha', 'hi', 'fu', 'he', 'ho', 'ma', 'mi', 'mu', 'me', 'mo', 'ya', 'yu', 'yo',
  'ra', 'ri', 'ru', 're', 'ro', 'wa', 'wo', 'n', 'ga', 'gi', 'gu', 'ge', 'go', 'za', 'ji', 'zu', 'ze', 'zo',
  'da', 'de', 'do', 'ba', 'bi', 'bu', 'be', 'bo', 'pa', 'pi', 'pu', 'pe', 'po',
  'kya', 'kyu', 'kyo', 'sha', 'shu', 'sho', 'cha', 'chu', 'cho', 'nya', 'nyu', 'nyo', 'hya', 'hyu', 'hyo',
  'mya', 'myu', 'myo', 'rya', 'ryu', 'ryo', 'gya', 'gyu', 'gyo', 'ja', 'ju', 'jo', 'bya', 'byu', 'byo', 'pya', 'pyu', 'pyo',
];

function consonantOf(r: string): string {
  return r.replace(/[aiueo]+$/, '');
}
function vowelOf(r: string): string {
  const m = /[aiueo]$/.exec(r);
  return m ? m[0] : '';
}

/** Three romaji distractors: same consonant first, then same vowel, then anything; never the answer (nor, given `kana`, another spelling of it). */
export function romajiDistractors(romaji: string, rng: Rng, n = 3, kana?: string): string[] {
  const r = romaji.toLowerCase();
  const others = ROMAJI_TABLE.filter((x) => x !== r && !equivalentJa(romajiToKana(x), romajiToKana(r)) && !(kana && romajiMatches(x, kana)));
  const c = consonantOf(r);
  const v = vowelOf(r);
  const tiers = [others.filter((x) => consonantOf(x) === c), others.filter((x) => vowelOf(x) === v), others];
  const out: string[] = [];
  for (const tier of tiers) {
    for (const x of shuffle(rng, tier)) {
      if (out.length >= n) break;
      if (!out.includes(x)) out.push(x);
    }
    if (out.length >= n) break;
  }
  return out.slice(0, n);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* First-contact cards (TeachOnce, design 08 §11)                             */
/* ────────────────────────────────────────────────────────────────────────── */

/** "Japanese is made of beats called morae" — Station 1, the first Kana Ear. Lowercase ASCII per `TEACH_ID_RE`. */
export const TEACH_MORAE_ID = 'morae-beats';
/** "A held sound is a beat" — Station 2, the first long-vowel / っ item in any kana drill. */
export const TEACH_HELD_ID = 'held-beat';
/** Stations where the held-beat card may appear: Station 2 (design 08 §11) and the rest of the White belt, since a learner's first held item can fall at Station 3. */
export const HELD_BEAT_STATIONS: readonly number[] = [2, 3];

const RE_HELD_MARK = /[っッー]/;
const RE_LONG_VOWEL = /[あかさたなはまやらわがざだばぱゃぁゎ]あ|[いきしちにひみりぎじぢびぴぃ]い|[うくすつぬふむゆるぐずづぶぷゅぅ]う|[えけせてねへめれげぜでべぺぇ]え|[おこそとのほもよろをごぞどぼぽょぉ]お/;

/** Whether `kana` holds a held beat: a small っ, a ー, or a lengthened vowel (おう / えい included, as `normalizeAnswer` folds them). */
export function hasHeldBeat(kana: string): boolean {
  const k = toHiragana(kana);
  return RE_HELD_MARK.test(k) || RE_LONG_VOWEL.test(normalizeAnswer(k));
}

export type KanaDrill = 'ear' | 'flash' | 'forge';

/** Which first-contact card a kana drill shows for `item` at `station`, or `null`; the seen set is `TeachOnce`'s business. */
export function kanaTeachId(item: Pick<KanaItem, 'kana' | 'exampleWord'>, drill: KanaDrill, station: number): string | null {
  if (drill === 'ear' && station <= 1) return TEACH_MORAE_ID;
  if (HELD_BEAT_STATIONS.includes(station) && (hasHeldBeat(item.kana) || hasHeldBeat(item.exampleWord.kana))) return TEACH_HELD_ID;
  return null;
}

function beatsLabel(n: number): string {
  return n === 1 ? S.oneBeat : fill(S.nBeats, { n });
}

/**
 * The kana drills' first-contact card (design 08 §11), store-aware so the
 * three drills share one read / write: renders `TeachOnce` for
 * `kanaTeachId(...)` against `progress.teachSeen` and writes the dismissal
 * with `markTeachSeen`, then calls `onDismissed` (the drill re-bases its
 * latency clock and, where the sound IS the prompt, plays it again — the
 * card was read over it). Nothing renders once the card was seen.
 */
export function KanaTeach(p: { item: KanaItem; drill: KanaDrill; onDismissed?: () => void }): JSX.Element | null {
  const progress = store.progress.value;
  const id = kanaTeachId(p.item, p.drill, progress.station);
  if (id === null) return null;
  const held = id === TEACH_HELD_ID;
  return (
    <TeachOnce
      id={id}
      title={held ? S.teachHeldTitle : S.teachMoraeTitle}
      body={held ? S.teachHeldBody : S.teachMoraeBody}
      seen={progress.teachSeen}
      onDismiss={(tid) => {
        store.patch('progress', (pr) => markTeachSeen(pr, tid));
        p.onDismissed?.();
      }}
      class="kana-teach"
    >
      <ul class="kana-teach__examples">
        {(held ? HELD_EXAMPLES : MORAE_EXAMPLES).map((e) => (
          <li key={e.kana} class="kana-teach__example">
            <span class="drill__ja" lang="ja">
              {e.kana}
            </span>{' '}
            <span>{e.romaji}</span> · <span>{e.en}</span> · <span class="kana-teach__beats">{beatsLabel(e.beats)}</span>
          </li>
        ))}
      </ul>
    </TeachOnce>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Kana Flash                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

/** True when the romaji option stands for the kana (shi / si / sî variants collapse through the IME). */
export function romajiMatches(romaji: string, kana: string): boolean {
  const converted = romajiToKana(romaji.trim().toLowerCase());
  return converted.length > 0 && !/[a-z]/.test(converted) && equivalentJa(converted, kana);
}

/**
 * True when `raw` is the corpus display romaji of a kana that the IME spells
 * differently (o for を, ti for ティ): what Kana Flash taught must count as a
 * hit in every typed kana drill, not only where it round-trips through the IME.
 */
export function isDisplayRomaji(raw: string, romaji: string, kana: string): boolean {
  return !romajiMatches(romaji, kana) && raw.trim().toLowerCase() === romaji;
}

function fmtSeconds(ms: number): string {
  return (Math.round(ms / 100) / 10).toFixed(1);
}

export function KanaFlash(p: ExerciseProps): JSX.Element {
  return <KanaFlashBody key={p.step.id} {...p} />;
}

function KanaFlashBody(p: ExerciseProps): JSX.Element {
  const item = isKanaItem(p.item) ? p.item : null;
  const kana = item?.kana ?? '';
  const ms = useLatency(p.step.id);
  const [done, setDone] = useState<AttemptResult | null>(null);
  const [why, setWhy] = useState<string | undefined>(undefined);
  const [value, setValue] = useState('');
  const [nudge, setNudge] = useState('');
  const fired = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mature = p.step.cardKey ? isMature(store.cards.get(p.step.cardKey)) : false;
  const showTarget = p.feel !== 'zen' && (p.step.timed || mature);
  const targetMs = p.step.timerMs ?? KANA_FLASH_TARGET_MS;
  const mc = (p.exposures < 2 || (p.step.params.choices?.length ?? 0) > 0) && item !== null;

  const choices = useMemo<string[]>(() => {
    if (!item) return [];
    const given = p.step.params.choices;
    if (given && given.length >= 2) return given;
    const rng = rngFor(store.seed(), store.today(), p.step.id, 'kana-flash');
    return shuffle(rng, [item.romaji, ...romajiDistractors(item.romaji, rng, 3, item.kana)]);
  }, [item, p.step.id, p.step.params.choices]);
  // The item's own (display) romaji always counts, even where the IME reads it as another kana (を 'o').
  const correctIdx = useMemo(() => (item ? choices.findIndex((c) => c.trim().toLowerCase() === item.romaji || romajiMatches(c, item.kana)) : -1), [choices, item]);

  // TTS plays once, keyed for the pack (design 08 §10.5).
  const clip = item?.id;
  useEffect(() => {
    if (kana) void speak(kana, { kana, clip });
  }, [kana, clip]);
  useEffect(() => {
    if (!mc && item) inputRef.current?.focus();
  }, [mc, item]);

  const finish = (r: AttemptResult): void => {
    if (fired.current) return;
    fired.current = true;
    setDone(r);
    p.onResult(r);
  };

  const typed = (given: string): AttemptResult => {
    const check = checkJa(given, { accept: [kana], kanaOnlyPolicy: 'good', particleSlip: false, allowKatakanaFold: true });
    setWhy(whyFor(check));
    return attempt({ ms: ms(), correct: check.correct, nearMiss: check.nearMiss, errorTags: check.tags, answer: given });
  };

  /** Where the display romaji does not round-trip through the IME (を 'o', ティ 'ti'), typing it is right before any conversion. */
  const displayRomaji = (raw: string): boolean => item !== null && isDisplayRomaji(raw, item.romaji, item.kana);

  const judge = (raw: string): void => {
    if (displayRomaji(raw)) {
      finish(attempt({ ms: ms(), correct: true, answer: raw.trim() }));
      return;
    }
    const st = imeStep(raw);
    if (st.pending !== '' || st.text.length === 0) return;
    const given = toHiragana(st.text);
    const target = toHiragana(kana);
    if (equivalentJa(given, kana)) {
      finish(typed(st.text));
      return;
    }
    if (!target.startsWith(given) && moraSplit(given).length >= moraSplit(target).length) finish(typed(st.text));
  };

  const onInput = (e: JSX.TargetedEvent<HTMLInputElement, Event>): void => {
    const v = e.currentTarget.value;
    setValue(v);
    if (nudge) setNudge('');
    judge(v);
  };

  const submit = (): void => {
    if (fired.current) return;
    if (displayRomaji(value)) {
      finish(attempt({ ms: ms(), correct: true, answer: value.trim() }));
      return;
    }
    const final = finalizeIme(value.trim());
    if (final.length === 0) {
      setNudge(X.nothingTyped);
      return;
    }
    finish(typed(final));
  };

  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    submit();
  };

  if (!item) return <MissingItem onContinue={() => finish(missingResult(ms()))} />;

  const inTime = done ? done.ms <= targetMs : null;
  const afterKind = done ? (done.nearMiss ? 'near' : done.correct ? 'true' : 'false') : undefined;

  return (
    <div class="drill kana-flash" data-exercise="kana-flash" data-mode={mc ? 'choices' : 'text'}>
      <KanaTeach item={item} drill="flash" onDismissed={ms.restart} />
      <div class="drill__row drill__row--between">
        <p class="drill__prompt">{mc ? S.chooseRomaji : X.typeRomaji}</p>
        {showTarget ? <span class="chip kana-flash__target">{fill(S.flashTarget, { s: fmtSeconds(targetMs) })}</span> : null}
      </div>
      <p class="drill__glyph" lang="ja" data-script={item.script}>
        {item.kana}
      </p>

      {mc ? (
        <ChoiceGrid
          choices={choices}
          correct={correctIdx}
          picked={done?.answer !== undefined ? choices.indexOf(done.answer) : undefined}
          onPick={(i) => finish(gradeChoice(i, correctIdx, { ms: ms(), answer: choices[i] ?? '' }))}
          label={S.romajiLabel}
          size="lg"
        />
      ) : (
        <div class="drill__row">
          <input
            ref={inputRef}
            class="drill__field kana-flash__field"
            type="text"
            inputMode="latin"
            lang="en"
            value={value}
            disabled={done !== null}
            aria-label={S.romajiField}
            autoComplete="off"
            autoCapitalize="off"
            spellcheck={false}
            enterKeyHint="done"
            onInput={onInput}
            onKeyDown={onKeyDown}
          />
          <button type="button" class="btn" disabled={done !== null || value.trim().length === 0} aria-keyshortcuts="Enter" onClick={submit}>
            {X.submit}
          </button>
        </div>
      )}
      {!mc && !done ? <p class="drill__hint">{S.flashAutoNote}</p> : null}
      {nudge ? (
        <p class="drill__hint" role="status">
          {nudge}
        </p>
      ) : null}

      {done ? (
        <div class="drill__after" data-correct={afterKind}>
          <p>
            <span class="eyebrow">{S.romajiLabel}</span> <span class="kana-flash__romaji">{romajiLabel(item)}</span>
            {showTarget && inTime !== null ? (
              <span class="chip kana-flash__reaction" data-in-time={inTime ? 'true' : 'false'}>
                {fill(S.flashReaction, { s: fmtSeconds(done.ms) })} · {inTime ? S.flashInTime : S.flashOverTime}
              </span>
            ) : null}
          </p>
          {why ? <p class="drill__hint">{why}</p> : null}
          {!done.correct || done.nearMiss ? (
            <p>
              <span class="eyebrow">{S.seenIn}</span>{' '}
              <span class="drill__ja" lang="ja">
                {item.exampleWord.word}
              </span>{' '}
              <span>{item.exampleWord.en}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
