/**
 * TSUZUKU — 宿敵 Nemesis (design 04 §9, 05 §8): the dossier and the duel.
 *
 *  · Dossier (no `step.cardKey`, or the card is still in its dossier /
 *    context window): the item's parts, mnemonic, readings, three sentences
 *    in context, the confusable side by side, the lapse history of every
 *    facet card and the duel progress. Continue → `correct: true` (facet
 *    null, nothing graded).
 *  · Duel (a `cardKey` whose Nemesis phase is `duel`, or a card that is not
 *    flagged): one typed rep on that facet — prod → the word from its gloss
 *    in a blanked sentence, listen → TTS then type, cloze → the missing
 *    piece, read → the reading, rec/comp → the meaning. The runner records
 *    the result under exercise `nemesis-duel`; `learn.duelProgress` counts
 *    Good rows on distinct days and E's `afterDuel` calls the defeat flow.
 * Confusables, look-alikes and related points come from `content.get`.
 * Facet `null`; keys `none` (the typed widget owns Enter inside its field);
 * the frame's `?` / Hint button opens the duel hint. The dossier's Continue
 * button takes focus through `useAutoFocus` (it is rendered after load).
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { content } from '@/content/loader';
import { toPlain } from '@/content/ruby';
import { FACETS, type CardKey, type ComponentDef, type ContentItem, type ErrorTag, type Facet, type GrammarItem, type KanaItem, type KanjiItem, type VocabItem } from '@/content/types';
import { duelProgress, isNemesis, nemesisPhase } from '@/learn';
import { services, speak } from '@/shared/audio';
import type { ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { pick, rngFor, type Rng } from '@/shared/hash';
import { parseCardKey } from '@/shared/ids';
import type { StepParams } from '@/shared/session-types';
import type { CardTuple, EpochDay, LogEntry } from '@/shared/store-types';
import { dayOf } from '@/shared/time';
import { useExerciseKeys } from '@/shared/ui/ExerciseFrame';
import { Ruby } from '@/shared/ui/Ruby';
import { useAutoFocus } from '@/shared/ui/use-auto-focus';
import { store } from '@/store';
import { acceptForms, attempt } from '../check';
import { voiceAudible } from '../voice';
import { TextAnswer, type TextAnswerResult } from '../TextAnswer';
import { FACET_LABEL, S, fill } from './strings';
import './NemesisDossier.css';

export const meta: ExerciseMeta = {
  id: 'nemesis-duel',
  facet: null,
  needsTts: true,
  needsStt: false,
  selfGraded: false,
  timeable: false,
  keys: 'none',
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Item shapes                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

const isVocab = (i: ContentItem | null | undefined): i is VocabItem => !!i && 'word' in i && 'kana' in i && 'meanings' in i;
const isKana = (i: ContentItem | null | undefined): i is KanaItem => !!i && 'kana' in i && 'romaji' in i && 'script' in i;
const isKanji = (i: ContentItem | null | undefined): i is KanjiItem => !!i && 'char' in i && 'strokes' in i;
const isGrammar = (i: ContentItem | null | undefined): i is GrammarItem => !!i && 'pattern' in i && 'clozeHints' in i;
const isComponent = (i: ContentItem | null | undefined): i is ComponentDef => !!i && 'char' in i && 'name' in i && !('strokes' in i);

/** The big surface of an item (plain). */
export function surfaceOf(item: ContentItem | null): string {
  if (isVocab(item)) return item.word;
  if (isKanji(item) || isComponent(item)) return item.char;
  if (isGrammar(item)) return item.pattern;
  if (isKana(item)) return item.kana;
  return '';
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Dossier data                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

export interface HistoryRow {
  facet: Facet;
  lapses: number;
  reps: number;
  /** Day of the last Again on this card, or `null`. */
  lastMiss: EpochDay | null;
  nemesis: boolean;
}

export interface Confusable {
  id: string;
  surface: string;
  sub?: string;
  gloss: string;
}

export interface Sentence {
  ja: string;
  en: string;
}

export interface Dossier {
  rows: HistoryRow[];
  sentences: Sentence[];
  confusables: Confusable[];
  wins: number;
  next: Facet | null;
}

function confusableOf(id: string, lookup: (id: string) => ContentItem | undefined): Confusable | null {
  const it = lookup(id);
  if (isVocab(it)) return { id, surface: it.word, sub: it.kana !== it.word ? it.kana : undefined, gloss: it.meanings.join(', ') };
  if (isKanji(it)) return { id, surface: it.char, sub: [...it.on, ...it.kun].slice(0, 2).join('・') || undefined, gloss: it.meanings.join(', ') };
  if (isGrammar(it)) return { id, surface: it.pattern, gloss: it.meaning };
  if (isKana(it)) return { id, surface: it.kana, gloss: it.romaji };
  if (isComponent(it)) return { id, surface: it.char, gloss: it.name };
  return null;
}

/** Everything the dossier shows for an item. Pure given the store reads passed in. */
export function dossierFor(
  item: ContentItem | null,
  itemId: string,
  cards: Partial<Record<Facet, CardTuple>>,
  log: readonly LogEntry[],
  tz: string,
  lookup: (id: string) => ContentItem | undefined,
): Dossier {
  const facets = Object.keys(cards) as Facet[];
  const rows: HistoryRow[] = facets.map((f) => {
    const t = cards[f] as CardTuple;
    const key = `${itemId}#${f}` as CardKey;
    let lastMiss: EpochDay | null = null;
    for (const e of log) if (e[1] === key && e[2] === 1) lastMiss = Math.max(lastMiss ?? 0, dayOf(e[0], tz));
    return { facet: f, lapses: t[4], reps: t[3], lastMiss, nemesis: isNemesis(t) };
  });
  // Nemesis-flagged cards first, then facet order — never the store's insertion order.
  rows.sort((a, b) => Number(b.nemesis) - Number(a.nemesis) || FACETS.indexOf(a.facet) - FACETS.indexOf(b.facet));
  let sentences: Sentence[] = [];
  let ids: string[] = [];
  if (isVocab(item) || isGrammar(item)) {
    sentences = item.examples.slice(0, 3).map((e) => ({ ja: e.ja, en: e.en }));
    ids = isVocab(item) ? (item.confusables ?? []) : item.related;
  } else if (isKanji(item)) {
    sentences = item.examples.slice(0, 3).map((e) => ({ ja: e.word, en: `${e.kana} — ${e.en}` }));
    ids = item.lookalikes ?? [];
  } else if (isKana(item)) {
    sentences = [{ ja: item.exampleWord.word, en: `${item.exampleWord.kana} — ${item.exampleWord.en}` }];
    ids = item.lookalikes ?? [];
  }
  const confusables = ids.map((id) => confusableOf(id, lookup)).filter((c): c is Confusable => c !== null).slice(0, 3);
  const prog = duelProgress(log, itemId, { available: facets, dayOfMs: (ms) => dayOf(ms, tz) });
  return { rows, sentences, confusables, wins: prog.wins, next: prog.next };
}

/** Days until the duel opens for a context-phase card (1–14), or 0. */
export function daysUntilDuel(card: CardTuple, log: readonly LogEntry[], today: EpochDay, key: CardKey, tz: string): number {
  for (let d = 0; d <= 14; d++) if (nemesisPhase(card, log, today + d, key, { dayOfMs: (ms) => dayOf(ms, tz) }) === 'duel') return d;
  return 0;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Duel prompts                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

export interface DuelPrompt {
  facet: Facet;
  mode: 'en' | 'ja';
  instruction: string;
  /** Japanese shown (plain or ruby). */
  promptJa?: string;
  /** English shown (gloss, context). */
  promptEn?: string;
  /** Spoken before the answer (listen). */
  speak?: { text: string; kana: string };
  accept: string[];
  missTags?: ErrorTag[];
  particleSlip?: boolean;
  allowKatakanaFold?: boolean;
  /** The hint line (mnemonic, meaning, sentence …). */
  hint: string;
}

/** Blanks the word in its sentence: the full surface, else its stem (食べる → 食べ in 食べます), else the kana forms. */
export function blank(sentence: string, word: string, kana: string): string {
  const plain = toPlain(sentence);
  const stem = (s: string): string | null => (Array.from(s).length >= 2 ? Array.from(s).slice(0, -1).join('') : null);
  for (const w of [word, kana, stem(word), stem(kana)]) {
    if (w && w.length > 0 && plain.includes(w)) return plain.replace(w, '＿＿');
  }
  return plain;
}

/** The one duel rep for an item × facet, or `null` when that facet has no typed shape. */
export function duelPrompt(item: ContentItem | null, facet: Facet, params: StepParams, rng: Rng): DuelPrompt | null {
  if (isVocab(item)) {
    const ex = item.examples.length > 0 ? pick(rng, item.examples) : undefined;
    const gloss = item.meanings.join(' · ');
    if (facet === 'prod') {
      return {
        facet,
        mode: 'ja',
        instruction: S.duelTypeWord,
        promptEn: gloss,
        promptJa: ex ? blank(ex.ja, item.word, item.kana) : undefined,
        accept: acceptForms(item, params),
        missTags: ['word-choice'],
        hint: ex ? ex.en : (item.notes ?? gloss),
      };
    }
    if (facet === 'listen') {
      return {
        facet,
        mode: 'ja',
        instruction: S.duelTypeHeard,
        speak: { text: item.word, kana: item.kana },
        accept: [item.word, item.kana, ...(item.altForms ?? [])],
        missTags: ['listening'],
        particleSlip: false,
        hint: gloss,
      };
    }
    return {
      facet,
      mode: 'en',
      instruction: S.duelTypeMeaning,
      promptJa: item.word,
      promptEn: item.kana !== item.word ? item.kana : undefined,
      accept: [...item.meanings, ...(params.accept ?? [])],
      missTags: ['word-choice'],
      hint: ex ? ex.en : (item.notes ?? ''),
    };
  }
  if (isGrammar(item)) {
    if (item.examples.length === 0) return null;
    const ex = pick(rng, item.examples);
    const plain = toPlain(ex.ja);
    if (facet === 'cloze') {
      const hint = item.clozeHints.find((h) => plain.includes(h)) ?? item.clozeHints[0];
      if (!hint) return null;
      return {
        facet,
        mode: 'ja',
        instruction: S.duelTypeCloze,
        promptJa: plain.includes(hint) ? plain.replace(hint, '＿＿') : plain,
        promptEn: ex.en,
        accept: [hint, ...(params.accept ?? [])],
        missTags: ['conjugation'],
        particleSlip: false,
        hint: `${item.pattern} — ${item.meaning}`,
      };
    }
    return {
      facet,
      mode: 'ja',
      instruction: S.duelTypeSentence,
      promptEn: `${ex.en}  (${item.pattern})`,
      accept: [plain, ex.kana, ...(params.accept ?? [])],
      missTags: ['conjugation'],
      hint: item.formation[0] ?? item.explanation,
    };
  }
  if (isKanji(item)) {
    if (facet === 'read') {
      const ex = item.examples.length > 0 ? pick(rng, item.examples) : undefined;
      const accept = ex ? [ex.kana] : [...item.kun.map((k) => k.replace('.', '')), ...item.on];
      if (accept.length === 0) return null;
      return { facet, mode: 'ja', instruction: S.duelTypeReading, promptJa: ex?.word ?? item.char, promptEn: ex?.en, accept, missTags: ['kanji-reading'], particleSlip: false, hint: item.mnemonic };
    }
    return { facet, mode: 'en', instruction: S.duelTypeMeaning, promptJa: item.char, accept: item.meanings, missTags: ['kanji-meaning'], hint: item.mnemonic };
  }
  if (isKana(item)) {
    if (facet === 'prod') return { facet, mode: 'ja', instruction: S.duelTypeWord, promptEn: item.romaji, accept: [item.kana], allowKatakanaFold: false, particleSlip: false, hint: item.mnemonic };
    return { facet, mode: 'en', instruction: S.duelTypeMeaning, promptJa: item.kana, accept: [item.romaji], hint: item.mnemonic };
  }
  if (isComponent(item)) {
    return { facet, mode: 'en', instruction: S.duelTypeKeyword, promptJa: item.char, accept: [item.name], missTags: ['kanji-meaning'], hint: item.hint ?? item.name };
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export function NemesisDossier(p: ExerciseProps): JSX.Element {
  const { step, item } = p;
  const itemId = step.itemId ?? (step.cardKey ? parseCardKey(step.cardKey).itemId : null);
  const tz = store.profile.value.tz;
  const today = store.today();
  const log = useMemo(() => store.log.recent(5000), [step.id]);
  const cards = useMemo(() => (itemId ? store.cards.byItem(itemId) : {}), [itemId, step.id]);
  const card = step.cardKey ? store.cards.get(step.cardKey) : undefined;
  const facet = step.cardKey ? parseCardKey(step.cardKey).facet : null;
  const phase = card && step.cardKey ? nemesisPhase(card, log, today, step.cardKey, { dayOfMs: (ms) => dayOf(ms, tz) }) : 'none';
  const duelRep = Boolean(step.cardKey && facet && (phase === 'duel' || phase === 'none'));
  const dossier = useMemo(() => dossierFor(item, itemId ?? '', cards, log, tz, (id) => content.get(id)), [item, itemId, cards, log, tz]);
  const prompt = useMemo(() => (duelRep && facet ? duelPrompt(item, facet, step.params, rngFor(store.seed(), today, step.id, 'duel')) : null), [duelRep, facet, item, step.id, step.params, today]);

  const startedAt = useRef(store.now());
  const [done, setDone] = useState<TextAnswerResult | null>(null);
  const [hint, setHint] = useState(false);
  const [playing, setPlaying] = useState(false);
  const fired = useRef(false);
  const live = useRef({ done, playing, hint });
  live.current = { done, playing, hint };

  const say = async (): Promise<void> => {
    if (!prompt?.speak) return;
    setPlaying(true);
    try {
      await speak(prompt.speak.text, { kana: prompt.speak.kana });
    } finally {
      setPlaying(false);
    }
  };

  useEffect(() => {
    startedAt.current = store.now();
    fired.current = false;
    setDone(null);
    setHint(false);
    if (prompt?.speak) void say();
    return () => {
      if (prompt?.speak) services.audio.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id]);

  const replay = (): void => {
    if (live.current.done || live.current.playing || !prompt?.speak) return;
    p.onReplay();
    void say();
  };
  const useHint = (): void => {
    if (live.current.hint || live.current.done) return;
    setHint(true);
    p.onHint();
  };
  const finish = (r: TextAnswerResult): void => {
    if (fired.current) return;
    fired.current = true;
    setDone(r);
    p.onResult(attempt({ ms: Math.max(0, store.now() - startedAt.current), correct: r.correct, nearMiss: r.nearMiss, hintUsed: live.current.hint, errorTags: r.tags, answer: r.given }));
  };
  const continueDossier = (): void => {
    if (fired.current) return;
    fired.current = true;
    setDone({ correct: true, given: '', override: false, nearMiss: false, kanaOnly: false, tags: [], expected: '' });
    p.onResult(attempt({ ms: Math.max(0, store.now() - startedAt.current), correct: true }));
  };

  // Space replays a spoken prompt; `?` / the frame's Hint button open the duel hint while one is on offer.
  const hintOffer = duelRep && prompt !== null && !hint && !done ? useHint : undefined;
  useExerciseKeys(prompt?.speak ? { onReplay: replay, onHint: hintOffer } : { onHint: hintOffer });
  // The dossier's Continue button is rendered after load: focus it imperatively (a dynamic `autofocus` is ignored).
  const continueRef = useRef<HTMLButtonElement>(null);
  useAutoFocus(continueRef, [step.id, duelRep]);

  const surface = surfaceOf(item);
  const hasVoice = voiceAudible(services.audio);

  /* ── duel rep ─────────────────────────────────────────────────────────── */
  if (duelRep && prompt && facet) {
    const nth = Math.min(3, dossier.wins + 1);
    const line = done ? (done.correct && !done.nearMiss ? S.duelWin : done.nearMiss ? S.duelBlock : S.duelLost) : null;
    return (
      <div class="nemesis nemesis--duel" data-feel={p.feel} data-done={done ? 'true' : undefined}>
        <header class="nemesis__head">
          <span class="nemesis__kanji" lang="ja" aria-hidden="true">
            宿敵
          </span>
          <h2 class="nemesis__title">{S.nemesisTitle}</h2>
          <span class="chip chip--accent">{fill(S.duelProgress, { n: nth })}</span>
        </header>
        <p class="nemesis__intro">{phase === 'none' ? S.nemesisNotFlagged : fill(S.nemesisDuelIntro, { n: nth })}</p>
        <p class="nemesis__instruction">{prompt.instruction}</p>
        <div class="nemesis__prompt status-window">
          <span class="chip">{fill(S.facetLabel, { facet: FACET_LABEL[facet] })}</span>
          {prompt.speak ? (
            <div class="nemesis__player">
              <button type="button" class="nemesis__play" onClick={replay} disabled={playing || done !== null} aria-keyshortcuts="Space">
                {playing ? '…' : '▶'} {S.duelReplay}
              </button>
              {!hasVoice ? (
                <span class="nemesis__novoice" role="status">
                  {S.noVoice} <span lang="ja">{prompt.speak.kana}</span>
                </span>
              ) : null}
            </div>
          ) : null}
          {prompt.promptJa ? (
            <p class="nemesis__ja">
              <Ruby ja={prompt.promptJa} mode={p.furigana} />
            </p>
          ) : null}
          {prompt.promptEn ? <p class="nemesis__en">{prompt.promptEn}</p> : null}
        </div>
        <TextAnswer
          key={step.id}
          mode={prompt.mode}
          accept={prompt.accept}
          missTags={prompt.missTags}
          particleSlip={prompt.particleSlip}
          allowKatakanaFold={prompt.allowKatakanaFold}
          kanaOnlyPolicy={step.params.kanaOnlyPolicy ?? 'good'}
          candidates={step.params.candidates}
          allowOverride={false}
          autoFocus
          onSubmit={finish}
        />
        {!done ? (
          <div class="nemesis__tools">
            <button type="button" class="btn btn--ghost btn--sm" onClick={useHint} disabled={hint} aria-pressed={hint}>
              {S.duelHint}
            </button>
            {hint ? (
              <p class="nemesis__hint reveal ink-nijimi" data-kind="teach" role="status">
                <span>{prompt.hint}</span>
                <small>{S.duelHintCeiling}</small>
              </p>
            ) : null}
          </div>
        ) : (
          <p class="nemesis__line reveal ink-nijimi" data-kind={done.nearMiss ? 'partial' : done.correct ? 'correct' : 'wrong'} role="status">
            {line}
          </p>
        )}
      </div>
    );
  }

  /* ── dossier ──────────────────────────────────────────────────────────── */
  const intro =
    phase === 'context' && card && step.cardKey
      ? fill(S.nemesisContext, { n: daysUntilDuel(card, log, today, step.cardKey, tz) })
      : S.nemesisIntro;

  return (
    <div class="nemesis nemesis--dossier" data-feel={p.feel} data-done={done ? 'true' : undefined}>
      <header class="nemesis__head">
        <span class="nemesis__kanji" lang="ja" aria-hidden="true">
          宿敵
        </span>
        <h2 class="nemesis__title">{S.nemesisTitle}</h2>
        <span class="chip chip--accent">{fill(S.duelProgress, { n: Math.min(3, dossier.wins + 1) })}</span>
      </header>
      <p class="nemesis__intro">{intro}</p>

      {item ? (
        <section class="nemesis__card status-window" aria-label={S.dossier}>
          <p class="nemesis__surface" lang="ja">
            {surface}
          </p>
          {isVocab(item) ? (
            <dl class="nemesis__facts">
              {item.kana !== item.word ? (
                <div>
                  <dt>{S.reading}</dt>
                  <dd lang="ja">{item.kana}</dd>
                </div>
              ) : null}
              <div>
                <dt>{S.meaning}</dt>
                <dd>{item.meanings.join(' · ')}</dd>
              </div>
              {item.collocations && item.collocations.length > 0 ? (
                <div>
                  <dt>{S.collocations}</dt>
                  <dd lang="ja">{item.collocations.join('　')}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {isKanji(item) ? (
            <dl class="nemesis__facts">
              <div>
                <dt>{S.meaning}</dt>
                <dd>{item.meanings.join(' · ')}</dd>
              </div>
              <div>
                <dt>{S.readings}</dt>
                <dd lang="ja">{[...item.on, ...item.kun].join('・')}</dd>
              </div>
              <div>
                <dt>{S.parts}</dt>
                <dd>{item.components.join(' + ')}</dd>
              </div>
              <div>
                <dt>{S.mnemonic}</dt>
                <dd>{item.mnemonic}</dd>
              </div>
            </dl>
          ) : null}
          {isGrammar(item) ? (
            <dl class="nemesis__facts">
              <div>
                <dt>{S.meaning}</dt>
                <dd>{item.meaning}</dd>
              </div>
              <div>
                <dt>{S.formation}</dt>
                <dd lang="ja">{item.formation.join('　')}</dd>
              </div>
              {item.mistakes.length > 0 ? (
                <div>
                  <dt>{S.mistakes}</dt>
                  <dd lang="ja">{item.mistakes.join('　')}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {isKana(item) ? (
            <dl class="nemesis__facts">
              <div>
                <dt>{S.reading}</dt>
                <dd>{item.romaji}</dd>
              </div>
              <div>
                <dt>{S.mnemonic}</dt>
                <dd>{item.mnemonic}</dd>
              </div>
            </dl>
          ) : null}
          {isComponent(item) ? (
            <dl class="nemesis__facts">
              <div>
                <dt>{S.meaning}</dt>
                <dd>{item.name}</dd>
              </div>
              {item.hint ? (
                <div>
                  <dt>{S.mnemonic}</dt>
                  <dd>{item.hint}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </section>
      ) : (
        <p class="nemesis__missing" role="status">
          {S.itemMissingDossier}
        </p>
      )}

      {dossier.sentences.length > 0 ? (
        <section class="nemesis__section" aria-label={S.inContext}>
          <h3 class="eyebrow nemesis__label">{S.inContext}</h3>
          <ul class="nemesis__sentences">
            {dossier.sentences.map((s, i) => (
              <li key={i}>
                <Ruby ja={s.ja} mode="always" />
                <small>{s.en}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section class="nemesis__section" aria-label={S.confusable}>
        <h3 class="eyebrow nemesis__label">{S.confusable}</h3>
        {dossier.confusables.length > 0 ? (
          <table class="nemesis__compare">
            <caption class="sr-only">{S.sideBySide}</caption>
            <thead>
              <tr>
                <th scope="col" lang="ja">
                  {surface}
                </th>
                {dossier.confusables.map((c) => (
                  <th key={c.id} scope="col" lang="ja">
                    {c.surface}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td lang="ja">{isVocab(item) && item.kana !== item.word ? item.kana : isKanji(item) ? [...item.on, ...item.kun].slice(0, 2).join('・') : ''}</td>
                {dossier.confusables.map((c) => (
                  <td key={c.id} lang="ja">
                    {c.sub ?? ''}
                  </td>
                ))}
              </tr>
              <tr>
                <td>{isVocab(item) || isKanji(item) ? item.meanings.join(', ') : isGrammar(item) ? item.meaning : isKana(item) ? item.romaji : isComponent(item) ? item.name : ''}</td>
                {dossier.confusables.map((c) => (
                  <td key={c.id}>{c.gloss}</td>
                ))}
              </tr>
            </tbody>
          </table>
        ) : (
          <p class="nemesis__none">{S.noConfusable}</p>
        )}
      </section>

      {dossier.rows.length > 0 ? (
        <section class="nemesis__section" aria-label={S.history}>
          <h3 class="eyebrow nemesis__label">{S.history}</h3>
          <ul class="nemesis__history">
            {dossier.rows.map((r) => (
              <li key={r.facet} data-nemesis={r.nemesis ? 'true' : undefined}>
                <span class="nemesis__facet">{fill(S.facetLabel, { facet: FACET_LABEL[r.facet] })}</span>
                <span>{fill(S.lapses, { n: r.lapses })}</span>
                <span>{fill(S.reviews, { n: r.reps })}</span>
                <span>{r.lastMiss === null ? S.neverMissed : r.lastMiss >= today ? S.lastMissedToday : fill(S.lastMissedDays, { n: today - r.lastMiss })}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!done ? (
        <button type="button" class="hanko nemesis__continue" onClick={continueDossier} ref={continueRef}>
          {S.continueDossier}
        </button>
      ) : null}
    </div>
  );
}
