import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, FIXTURE_DIALOGUE_ID, FIXTURE_STORY_ID, V, createFakeLoader } from '@/content/fixtures';
import { toPlain } from '@/content/ruby';
import type { CardKey as CardKeyT, ListeningPool, PoolRef, StoryItem, StoryLine } from '@/content/types';
import { knownSet } from '@/learn';
import { SPEED_TIER_RATES, installServices, nullAudio, resetServices, type AudioService, type ClipCue, type SpeakOptions } from '@/shared/audio';
import { bus } from '@/shared/events';
import type { ExerciseProps } from '@/shared/exercise-types';
import { rngFor } from '@/shared/hash';
import { cardKey } from '@/shared/ids';
import { normalizeJa } from '@/shared/jp';
import type { AttemptResult, Step } from '@/shared/session-types';
import { EXIT_FALLBACK_MS } from '@/shared/ui/TeachOnce';
import { store } from '@/store';
import { captureEvents, card, makeTestStore } from '@/store/testing';
import {
  ListeningArena,
  REPLAY_BUDGET,
  SET_MAX,
  TEACH_ARENA_BRIDGE,
  TEACH_ARENA_FIRST,
  WALK_SEED_TAG,
  activeToken,
  buildListeningSet,
  buildWalkSet,
  clauseKana,
  gradeDictation,
  implicitListenGrades,
  meta,
  orderQuestions,
  relistenRate,
  speechMoraCount,
  tokenMoraSpans,
  voiceSlots,
  wordSurfacesIn,
  type ListenItem,
} from './ListeningArena';
import { S } from './strings';

const DIALOGUE = FIXTURE.items[FIXTURE_DIALOGUE_ID] as StoryItem;
const loader = createFakeLoader();

interface SpeakCall {
  text: string;
  o?: SpeakOptions;
}

function fakeAudio(hasVoice = true): { audio: AudioService; calls: SpeakCall[] } {
  const calls: SpeakCall[] = [];
  const audio: AudioService = {
    ...nullAudio,
    muted: signal(false),
    hasJaVoice: signal(hasVoice),
    speak: (text, o) => {
      calls.push({ text, o });
      return Promise.resolve();
    },
    cancel: vi.fn(),
  };
  return { audio, calls };
}

let root: HTMLDivElement;
beforeEach(async () => {
  await makeTestStore({ save: { settings: { furigana: 'off' } } });
  bus.reset();
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

/** Lets every awaited `speak()` in a playback chain settle. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function click(sel: string): void {
  const el = root.querySelector(sel) as HTMLButtonElement | null;
  if (!el) throw new Error(`no element ${sel}`);
  act(() => el.click());
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(text));
  if (!btn) throw new Error(`no button "${text}"`);
  return btn;
}

function type(input: HTMLInputElement, text: string): void {
  for (const ch of text) {
    act(() => {
      input.value = input.value + ch;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}
function enter(input: HTMLInputElement): void {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
}

function expectedItems(): ListenItem[] {
  return buildListeningSet(DIALOGUE, { rng: rngFor(store.seed(), store.today(), DIALOGUE.id), station: store.progress.value.station });
}

function mountStandalone(rate = 0.9) {
  const onDone = vi.fn();
  act(() => render(<ListeningArena storyId={FIXTURE_DIALOGUE_ID} rate={rate} onDone={onDone} loader={loader} />, root));
  return { onDone };
}

/** Answers every item correctly (gist / choice by index, dictation by typing the kana). */
async function answerAll(items: ListenItem[], o: { wrongAt?: number } = {}): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    await flush();
    const item = items[i] as ListenItem;
    expect(root.querySelector('.arena__progress')?.textContent).toBe(`Question ${i + 1} of ${items.length}`);
    if (item.kind === 'dictation') {
      const line = DIALOGUE.lines[item.lineIndex] as StoryLine;
      const input = root.querySelector('input') as HTMLInputElement;
      type(input, o.wrongAt === i ? 'あいうえおかきくけこ' : normalizeJa(line.kana));
      enter(input);
    } else {
      const answer = item.kind === 'gist' ? item.q.answer : item.answer;
      const pick = o.wrongAt === i ? (answer + 1) % 4 : answer;
      click(`.arena__choice[aria-keyshortcuts="${pick + 1}"]`);
    }
    expect(root.querySelector('.feedback')).not.toBeNull();
    click('.arena__feedback .hanko');
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure helpers                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

describe('listening set helpers', () => {
  it('meta follows the export convention: listening-set, null facet, choices, needsTts', () => {
    expect(meta).toMatchObject({ id: 'listening-set', facet: null, keys: 'choices', needsTts: true, needsStt: false, selfGraded: false });
  });

  it('voice slots alternate by first appearance; unlabelled lines use a', () => {
    const slots = voiceSlots(DIALOGUE.lines);
    expect(slots.get('ケン')).toBe('a');
    expect(slots.get('ハナ')).toBe('b');
    expect(voiceSlots([{ ja: 'a', kana: 'a', en: '', tokens: ['a'] }]).get('')).toBe('a');
  });

  it('relistenRate adds 0.1 without float noise', () => {
    expect(relistenRate(0.9)).toBe(1);
    expect(relistenRate(1.1)).toBe(1.2);
    expect(relistenRate(1.25)).toBe(1.35);
  });

  it('buildListeningSet: gist first, 5–8 items, choices of 4 with a right index, deterministic', () => {
    const a = expectedItems();
    const b = expectedItems();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(5);
    expect(a.length).toBeLessThanOrEqual(SET_MAX);
    expect(a.slice(0, 3).every((i) => i.kind === 'gist')).toBe(true);
    expect(a.slice(3).every((i) => i.kind !== 'gist')).toBe(true);
    for (const item of a) {
      if (item.kind !== 'choice') continue;
      expect(item.choices).toHaveLength(4);
      expect(new Set(item.choices).size).toBe(4);
      expect(item.ja).toBe(false);
      expect(item.choices[item.answer]).toBe((DIALOGUE.lines[item.lineIndex] as StoryLine).en);
    }
    const other = buildListeningSet(DIALOGUE, { rng: rngFor('other-seed'), station: 4 });
    expect(other.length).toBeGreaterThanOrEqual(5);
  });

  it('from Green the choice items carry the Japanese line itself', () => {
    const items = buildListeningSet(DIALOGUE, { rng: rngFor('x'), station: 16 });
    const choice = items.find((i) => i.kind === 'choice');
    expect(choice).toBeDefined();
    if (choice && choice.kind === 'choice') {
      expect(choice.ja).toBe(true);
      expect(choice.choices[choice.answer]).toBe((DIALOGUE.lines[choice.lineIndex] as StoryLine).ja);
    }
  });

  it('gradeDictation: exact → Good, a small-kana slip → Hard (Block), noise → Again with the listening tag', () => {
    const line = DIALOGUE.lines[3] as StoryLine; // はい、のみます。
    expect(gradeDictation('はいのみます', line)).toMatchObject({ rating: 3, correct: true, tags: [] });
    expect(gradeDictation('はい、飲みます。', line).score).toBeLessThan(1); // kanji is not the kana surface
    const slip = gradeDictation('はいのみまっす', line);
    expect(slip.rating).toBe(2);
    expect(slip.tags).toEqual(['small-kana']);
    const miss = gradeDictation('あいうえおかきくけこ', line);
    expect(miss.rating).toBe(1);
    expect(miss.correct).toBe(false);
    expect(miss.tags).toEqual(['listening']);
    expect(miss.diff.length).toBeGreaterThan(0);
  });

  it('implicitListenGrades: due listen cards get Good when the word was heard, Again when not; others skipped', async () => {
    const today = store.today();
    await makeTestStore({
      cards: {
        [cardKey(V.飲む, 'listen')]: card({ due: today, s: 3, state: 2 }),
        [cardKey(V.はい, 'listen')]: card({ due: today + 1, s: 3, state: 2 }),
        [cardKey(V.水, 'listen')]: card({ due: today + 10, s: 30, state: 2 }),
      },
    });
    const line = DIALOGUE.lines[11] as StoryLine; // 私も水を飲みます。 (私 has no listen card here)
    const got = implicitListenGrades(line, 'わたしものみます', (id) => loader.get(id), store.cards, store.today());
    expect(got).toEqual([{ cardKey: cardKey(V.飲む, 'listen'), rating: 3 }]);
    const missed = implicitListenGrades(line, 'わたしもみずを', (id) => loader.get(id), store.cards, store.today());
    expect(missed).toEqual([{ cardKey: cardKey(V.飲む, 'listen'), rating: 1 }]);
    const aizuchiLine = DIALOGUE.lines[3] as StoryLine; // はい、のみます。
    const two = implicitListenGrades(aizuchiLine, 'はいのみます', (id) => loader.get(id), store.cards, store.today());
    expect(two.map((g) => g.cardKey).sort()).toEqual([cardKey(V.はい, 'listen'), cardKey(V.飲む, 'listen')].sort());
    expect(implicitListenGrades({ ...line, tokenIds: undefined }, 'x', (id) => loader.get(id), store.cards, store.today())).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

describe('<ListeningArena>', () => {
  it('shows a loading line, then a calm state for an unknown set', async () => {
    installServices({ audio: fakeAudio().audio });
    act(() => render(<ListeningArena storyId="s-99-9" rate={1} onDone={vi.fn()} loader={loader} />, root));
    expect(root.querySelector('.arena__state')?.textContent).toBe(S.loading);
    await flush();
    expect(root.querySelector('.arena__state--missing')?.textContent).toBe(S.notFound);
  });

  it('keeps the text hidden until every question is answered, then reveals the transcript', async () => {
    const { audio } = fakeAudio();
    installServices({ audio });
    mountStandalone();
    const plains = DIALOGUE.lines.map((l) => toPlain(l.ja));
    const hidden = (): boolean => plains.every((t) => !(root.textContent ?? '').includes(t));
    expect(root.getAttribute('data-phase')).toBeNull();
    expect(root.querySelector('.arena')?.getAttribute('data-phase')).toBe('listen');
    expect(hidden()).toBe(true);
    expect(root.querySelector('.arena__transcript')).toBeNull();
    // the Questions button waits for the first full listen
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent?.includes(S.toQuestions))).toBe(false);
    click('.hanko');
    await flush();
    expect(hidden()).toBe(true);
    act(() => buttonByText(S.toQuestions).click());
    expect(root.querySelector('.arena')?.getAttribute('data-phase')).toBe('questions');
    await flush();
    // the first items are gist questions: still no line text anywhere
    expect(hidden()).toBe(true);
    const items = expectedItems();
    await answerAll(items);
    expect(root.querySelector('.arena')?.getAttribute('data-phase')).toBe('transcript');
    expect(root.querySelector('.arena__transcript')).not.toBeNull();
    for (const t of plains) expect(root.textContent).toContain(t);
    expect(root.querySelectorAll('.arena__transcript .arena__line')).toHaveLength(DIALOGUE.lines.length);
  });

  it('speakers alternate voice slots a / b through the whole listen, at the given rate', async () => {
    const { audio, calls } = fakeAudio();
    installServices({ audio });
    mountStandalone(0.9);
    click('.hanko');
    await flush();
    expect(calls).toHaveLength(DIALOGUE.lines.length);
    calls.forEach((c, i) => {
      expect(c.text).toBe(toPlain((DIALOGUE.lines[i] as StoryLine).ja));
      expect(c.o?.voice).toBe(i % 2 === 0 ? 'a' : 'b');
      expect(c.o?.rate).toBe(0.9);
    });
    expect(calls[0]?.o?.interrupt).toBe(true);
    expect(calls[1]?.o?.interrupt).toBe(false);
  });

  it('full-listen replays are budgeted at 2; the button then locks honestly', async () => {
    const { audio, calls } = fakeAudio();
    installServices({ audio });
    mountStandalone();
    click('.hanko');
    await flush();
    const n = DIALOGUE.lines.length;
    for (let k = 1; k <= REPLAY_BUDGET; k++) {
      const btn = buttonByText(S.replay);
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toContain(`${REPLAY_BUDGET - k + 1} replays left`);
      act(() => btn.click());
      await flush();
      expect(calls).toHaveLength(n * (k + 1));
    }
    const btn = buttonByText(S.replay);
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain(S.noReplaysLeft);
  });

  it('re-listens at +0.1× with karaoke highlight before Finish unlocks, then emits listening:set and calls onDone', async () => {
    const { audio, calls } = fakeAudio();
    installServices({ audio });
    const cap = captureEvents();
    const { onDone } = mountStandalone(0.9);
    click('.hanko');
    await flush();
    act(() => buttonByText(S.toQuestions).click());
    const items = expectedItems();
    await answerAll(items, { wrongAt: 0 });
    const finish = buttonByText(S.finish);
    expect(finish.disabled).toBe(true);
    const before = calls.length;
    act(() => buttonByText('Listen again at 1×').click());
    // the chain is running: the first line is highlighted before the fake speak resolves it
    const relistenCalls = (): SpeakCall[] => calls.slice(before);
    await flush();
    expect(relistenCalls()).toHaveLength(DIALOGUE.lines.length);
    for (const c of relistenCalls()) expect(c.o?.rate).toBe(1);
    expect(root.querySelector('.arena__hint')?.textContent).toBe(S.relistenDone);
    expect(root.querySelector('[data-speaking="true"]')).toBeNull();
    const finish2 = buttonByText(S.finish);
    expect(finish2.disabled).toBe(false);
    act(() => finish2.click());
    const ev = cap.events.find(([n]) => n === 'listening:set');
    cap.stop();
    expect(ev).toBeDefined();
    expect(ev?.[1]).toMatchObject({ storyId: FIXTURE_DIALOGUE_ID, correct: items.length - 1, total: items.length, rate: 0.9 });
    expect((ev?.[1] as { minutes: number }).minutes).toBeGreaterThanOrEqual(0);
    expect(onDone).toHaveBeenCalledWith({ correct: items.length - 1, total: items.length });
    expect(root.querySelector('.arena__result-line')?.textContent).toBe(`${items.length - 1} of ${items.length} right at 0.9×`);
    // one miss: no tier offer
    expect(root.querySelector('.arena__tier')).toBeNull();
  });

  it('a clean set at the tier rate offers the next tier; accepting patches settings.speedTier', async () => {
    const { audio } = fakeAudio();
    installServices({ audio });
    const tier = store.settings.value.speedTier;
    mountStandalone(SPEED_TIER_RATES[tier]);
    click('.hanko');
    await flush();
    act(() => buttonByText(S.toQuestions).click());
    await answerAll(expectedItems());
    act(() => buttonByText('Listen again at').click());
    await flush();
    act(() => buttonByText(S.finish).click());
    expect(root.querySelector('.arena__tier')).not.toBeNull();
    // the tier is OFFERED, never switched silently (design 08 §11): the copy says so
    expect(root.querySelector('.arena__tier')?.textContent).toContain('you decide');
    act(() => buttonByText(`Tier ${tier + 1} from now`).click());
    expect(store.settings.value.speedTier).toBe(tier + 1);
    expect(root.querySelector('.arena__tier')).toBeNull();
    expect(root.textContent).toContain(`Tier ${tier + 1}.`);
  });

  it('without a Japanese voice it says so, shows the lines as text and lets Finish through without a re-listen', async () => {
    installServices({ audio: fakeAudio(false).audio });
    mountStandalone();
    expect(root.querySelector('.arena__notice')?.textContent).toBe(S.noVoice);
    expect(root.querySelectorAll('.arena__lines .arena__line')).toHaveLength(DIALOGUE.lines.length);
    act(() => buttonByText(S.toQuestions).click());
    await answerAll(expectedItems());
    const finish = buttonByText(S.finish);
    expect(finish.disabled).toBe(false);
    act(() => finish.click());
    expect(root.querySelector('.arena__result')).not.toBeNull();
    // paper, not the cartouche (design 09 §2.5, §12.1 d53)
    expect(root.querySelector('.arena__result')?.classList.contains('sheet')).toBe(true);
    expect(root.querySelector('.arena__result')?.classList.contains('status-window')).toBe(false);
  });

  it('with a voice but the master volume at 0 (canSpeak false) it shows the lines as text with the volume notice instead of a silent Play', async () => {
    const { audio, calls } = fakeAudio(true);
    installServices({ audio: { ...audio, canSpeak: signal(false) } as AudioService });
    mountStandalone();
    expect(root.querySelector('.arena__notice')?.textContent).toBe(S.volumeOff);
    expect(root.querySelectorAll('.arena__lines .arena__line')).toHaveLength(DIALOGUE.lines.length);
    expect(Array.from(root.querySelectorAll('button')).find((b) => b.textContent === S.play)).toBeUndefined();
    act(() => buttonByText(S.toQuestions).click());
    expect(calls).toEqual([]);
    await answerAll(expectedItems());
    expect(buttonByText(S.finish).disabled).toBe(false);
  });

  it('as an exercise it reads params.storyId / rate, reports once through onResult with implicit listen grades, and never writes cards itself', async () => {
    const today = store.today();
    await makeTestStore({
      save: { settings: { furigana: 'off' } },
      cards: Object.fromEntries(DIALOGUE.vocabIds.map((id) => [cardKey(id, 'listen'), card({ due: today, s: 2, state: 2 })])),
    });
    const { audio } = fakeAudio();
    installServices({ audio });
    const cap = captureEvents();
    const onResult = vi.fn<(r: AttemptResult) => void>();
    const onReplay = vi.fn();
    const step: Step = {
      id: 'ls-1',
      block: 'input',
      exercise: 'listening-set',
      itemId: FIXTURE_DIALOGUE_ID,
      cardKey: null,
      params: { storyId: FIXTURE_DIALOGUE_ID, rate: 1.1 },
      timed: false,
      isNew: false,
      stepTag: null,
      exposures: 0,
      estMs: 300000,
    };
    const props: ExerciseProps = {
      step,
      item: DIALOGUE,
      feel: 'dojo',
      furigana: 'off',
      jj: false,
      speedTier: 2,
      exposures: 0,
      onResult,
      onHint: () => undefined,
      onReplay,
      requestJudge: () => Promise.resolve(true),
    };
    act(() => render(<ListeningArena {...props} />, root));
    expect(root.textContent).toContain('Speed 1.1×');
    click('.hanko');
    await flush();
    act(() => buttonByText(S.replay).click());
    await flush();
    expect(onReplay).toHaveBeenCalledTimes(1);
    act(() => buttonByText(S.toQuestions).click());
    const items = expectedItems();
    await answerAll(items);
    act(() => buttonByText('Listen again at 1.2×').click());
    await flush();
    act(() => buttonByText(S.finish).click());
    cap.stop();
    expect(onResult).toHaveBeenCalledTimes(1);
    const r = onResult.mock.calls[0]?.[0] as AttemptResult;
    expect(r).toMatchObject({ correct: true, nearMiss: false, guard: false, hintUsed: false, timedOut: false, score: 1, replays: 1, errorTags: [] });
    const dictations = items.filter((i) => i.kind === 'dictation');
    if (dictations.length > 0) {
      expect(r.implicit?.length ?? 0).toBeGreaterThan(0);
      expect(r.implicit?.every((g) => g.rating === 3 && g.cardKey.endsWith('#listen'))).toBe(true);
    }
    // the card itself is untouched: the runner applies `implicit`
    const first = r.implicit?.[0];
    if (first) expect(store.cards.get(first.cardKey)?.[3]).toBe(0);
    expect(cap.events.filter(([n]) => n === 'listening:set')).toHaveLength(1);
    expect(cap.events.some(([n]) => n === 'attempt:graded')).toBe(false);
  });

  it('standalone, a correct dictation writes Good on a due listen card through recordImplicit', async () => {
    const today = store.today();
    await makeTestStore({
      save: { settings: { furigana: 'off' } },
      cards: Object.fromEntries(DIALOGUE.vocabIds.map((id) => [cardKey(id, 'listen'), card({ due: today, s: 2, state: 2 })])),
    });
    const items = expectedItems();
    const dictation = items.find((i): i is Extract<ListenItem, { kind: 'dictation' }> => i.kind === 'dictation');
    if (!dictation) return; // the seeded set has no dictation line: nothing to assert
    const line = DIALOGUE.lines[dictation.lineIndex] as StoryLine;
    const ids = (line.tokenIds ?? []).filter((id): id is string => !!id && id.startsWith('v-'));
    expect(ids.length).toBeGreaterThan(0);
    const { audio } = fakeAudio();
    installServices({ audio });
    mountStandalone();
    click('.hanko');
    await flush();
    act(() => buttonByText(S.toQuestions).click());
    await answerAll(items);
    act(() => buttonByText('Listen again at').click());
    await flush();
    act(() => buttonByText(S.finish).click());
    const graded = ids.map((id) => store.cards.get(cardKey(id, 'listen'))).filter((c): c is NonNullable<typeof c> => !!c);
    expect(graded.some((c) => c[3] >= 1)).toBe(true);
  });
});

describe('profile.dictatedSentence (the Waveform kakejiku text)', () => {
  function dictationAt(items: ListenItem[]): { index: number; line: StoryLine } {
    const index = items.findIndex((i) => i.kind === 'dictation');
    expect(index).toBeGreaterThanOrEqual(0); // the seeded fixture set carries one
    const item = items[index] as Extract<ListenItem, { kind: 'dictation' }>;
    return { index, line: DIALOGUE.lines[item.lineIndex] as StoryLine };
  }
  async function runSet(rate: number, o: { wrongAt?: number } = {}): Promise<void> {
    const { audio } = fakeAudio();
    installServices({ audio });
    mountStandalone(rate);
    click('.hanko');
    await flush();
    act(() => buttonByText(S.toQuestions).click());
    await answerAll(expectedItems(), o);
  }

  it('a perfect dictation at 1× writes the plain surface (no ruby markup); the newest replaces the previous one', async () => {
    act(() => store.patch('profile', (p) => ({ ...p, dictatedSentence: '前の文。' })));
    const { line } = dictationAt(expectedItems());
    expect(line.ja).toMatch(/\{/); // the fixture line carries ruby, so plain ≠ ja
    await runSet(1);
    const s = store.profile.value.dictatedSentence;
    expect(typeof s).toBe('string');
    expect(s).toBe(toPlain(line.ja));
    expect(s).not.toMatch(/[{}|]/);
  });

  it('a partial dictation leaves it untouched', async () => {
    const { index } = dictationAt(expectedItems());
    await runSet(1, { wrongAt: index });
    expect(store.profile.value.dictatedSentence).toBeUndefined();
  });

  it('a perfect dictation at a slowed rate (< 1×) does not count', async () => {
    await runSet(0.9);
    expect(store.profile.value.dictatedSentence).toBeUndefined();
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Design 08: question kinds, lineRef, header, payload, walk, karaoke, teach  */
/* ────────────────────────────────────────────────────────────────────────── */

const STORY = FIXTURE.items[FIXTURE_STORY_ID] as StoryItem;
const PIECE_ID = 's-04-4';
/** An audio-first piece over the fixture dialogue's lines: typed questions, two of them naming their line. */
const PIECE: StoryItem = {
  ...DIALOGUE,
  id: PIECE_ID,
  titleEn: 'At the counter',
  genre: 'exchange',
  audioFirst: true,
  comprehension: [
    { q: 'Where does this happen?', choices: ['Over breakfast', 'At a station', 'In a park', 'At school'], answer: 0, kind: 'detail', lineRef: 2 },
    { q: 'What is this about?', choices: ['A morning meal', 'A trip', 'Work', 'The weather'], answer: 0, kind: 'gist' },
    { q: 'How many dogs?', choices: ['One', 'Two', 'Three', 'None'], answer: 0, kind: 'number', lineRef: 8 },
    { q: 'Who offers coffee?', choices: ['Ken', 'Hana', 'The dog', 'Nobody'], answer: 0, kind: 'speaker', lineRef: 2 },
  ],
};
const BRIDGE_ID = 's-27-1';
/** A Native Bridge dialogue (casual, bridge): authentic-style listening (design 08 §12). */
const BRIDGE: StoryItem = { ...DIALOGUE, id: BRIDGE_ID, stationId: 'st-27', titleEn: 'At the teahouse', bridge: true, register: 'casual' };
const pieceLoader = createFakeLoader({ ...FIXTURE, items: { ...FIXTURE.items, [PIECE_ID]: PIECE, [BRIDGE_ID]: BRIDGE } });

interface ClipFakeOptions {
  hasVoice?: boolean;
  /** The pack's `clipFor`; absent = no pack (device voice). */
  cue?: (key: string, o?: { rate?: number; speaker?: string }) => ClipCue | undefined;
  source?: 'clips' | 'synth' | 'none';
  /** `speak()` stays pending until `resolveNext()` / `resolveAll()`. */
  deferred?: boolean;
}
function clipAudio(o: ClipFakeOptions = {}): { audio: AudioService; calls: SpeakCall[]; resolveNext(): void; resolveAll(): Promise<void> } {
  const calls: SpeakCall[] = [];
  const pending: (() => void)[] = [];
  const audio: AudioService = {
    ...nullAudio,
    muted: signal(false),
    hasJaVoice: signal(o.hasVoice ?? true),
    speak: (text, so) => {
      calls.push({ text, o: so });
      if (!o.deferred) return Promise.resolve();
      return new Promise<void>((r) => pending.push(r));
    },
    cancel: vi.fn(),
    ...(o.source ? { source: signal(o.source) } : {}),
    ...(o.cue ? { clipFor: o.cue } : {}),
  };
  return {
    audio,
    calls,
    resolveNext: () => pending.shift()?.(),
    // a sequential chain queues the next speak() only after the previous resolves, so drain one at a time
    resolveAll: async () => {
      while (pending.length) {
        pending.shift()?.();
        await flush();
      }
    },
  };
}
const cueOf =
  (voice: string, rate: number, clauses?: (key: string) => number[] | undefined) =>
  (key: string): ClipCue => ({ key, file: 'audio/sprites/s04/x.webm', start: 0, end: 2, voice, rate, ...(clauses?.(key) ? { clauses: clauses(key) as number[] } : {}) });

function itemsFor(story: StoryItem, clauses?: (i: number) => number[] | undefined): ListenItem[] {
  return buildListeningSet(story, { rng: rngFor(store.seed(), store.today(), story.id), station: store.progress.value.station, ...(clauses ? { clauses } : {}) });
}

/** Answers every item (right, or wrong at the given indexes); dictations type the line or clause kana. */
async function answerSet(items: ListenItem[], lines: readonly StoryLine[], o: { wrongAt?: number[] } = {}): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    await flush();
    const item = items[i] as ListenItem;
    expect(root.querySelector('.arena__progress')?.textContent).toBe(`Question ${i + 1} of ${items.length}`);
    const wrong = o.wrongAt?.includes(i) ?? false;
    if (item.kind === 'dictation') {
      const line = lines[item.lineIndex] as StoryLine;
      const target = item.clause ? clauseKana(line.kana, item.clause) : normalizeJa(line.kana);
      const input = root.querySelector('input') as HTMLInputElement;
      type(input, wrong ? 'あいうえおかきくけこ' : target);
      enter(input);
    } else {
      const choices = item.kind === 'gist' ? item.q.choices : item.choices;
      const answer = item.kind === 'gist' ? item.q.answer : item.answer;
      const pick = wrong ? (answer + 1) % choices.length : answer;
      click(`.arena__choice[aria-keyshortcuts="${pick + 1}"]`);
    }
    expect(root.querySelector('.feedback')).not.toBeNull();
    click('.arena__feedback .hanko');
  }
}

async function toTranscript(story: StoryItem, o: { wrongAt?: number[]; clauses?: (i: number) => number[] | undefined } = {}): Promise<ListenItem[]> {
  click('.hanko');
  await flush();
  act(() => buttonByText(S.toQuestions).click());
  const items = itemsFor(story, o.clauses);
  await answerSet(items, story.lines, { ...(o.wrongAt ? { wrongAt: o.wrongAt } : {}) });
  expect(root.querySelector('.arena')?.getAttribute('data-phase')).toBe('transcript');
  return items;
}

async function relistenAndFinish(): Promise<void> {
  act(() => buttonByText('Listen again at').click());
  await flush();
  act(() => buttonByText(S.finish).click());
}

describe('question kinds and lineRef (design 08 §9–§10)', () => {
  it('asks gist first, then detail / number / speaker / inference; untagged questions keep the writer’s order', () => {
    expect(orderQuestions(PIECE.comprehension).map((q) => q.kind)).toEqual(['gist', 'detail', 'number', 'speaker']);
    const items = itemsFor(PIECE);
    expect(items.slice(0, 4).map((i) => (i.kind === 'gist' ? (i.q.kind ?? 'gist') : i.kind))).toEqual(['gist', 'detail', 'number', 'speaker']);
    expect(items.slice(4).every((i) => i.kind !== 'gist')).toBe(true);
    const mixed = orderQuestions([{ kind: 'inference' }, { kind: 'speaker' }, {}, { kind: 'detail' }, { kind: 'gist' }, { kind: 'number' }]);
    expect(mixed.map((q) => q.kind ?? 'gist')).toEqual(['gist', 'gist', 'detail', 'number', 'speaker', 'inference']);
    // existing texts: no kinds, so the order is untouched
    expect(itemsFor(DIALOGUE).slice(0, 3).map((i) => (i.kind === 'gist' ? i.q.q : ''))).toEqual(DIALOGUE.comprehension.map((q) => q.q));
  });

  it('every line speaks with its clip key and speaker; a wrong answer on a question with lineRef replays that line', async () => {
    const { audio, calls } = clipAudio({ cue: cueOf('ずんだもん', 1), source: 'clips' });
    installServices({ audio });
    act(() => render(<ListeningArena storyId={PIECE_ID} rate={1} onDone={vi.fn()} loader={pieceLoader} />, root));
    click('.hanko');
    await flush();
    expect(calls).toHaveLength(PIECE.lines.length);
    calls.forEach((c, i) => {
      expect(c.o?.clip).toBe(`${PIECE_ID}#L${i}`);
      expect(c.o?.speaker).toBe((PIECE.lines[i] as StoryLine).speaker);
    });
    act(() => buttonByText(S.toQuestions).click());
    const items = itemsFor(PIECE);
    // Q1 is the gist question (no lineRef): right. Q2 is the detail question with lineRef 2: wrong → line 3 plays.
    await flush();
    const q1 = items[0] as Extract<ListenItem, { kind: 'gist' }>;
    expect(q1.q.kind).toBe('gist');
    click(`.arena__choice[aria-keyshortcuts="${q1.q.answer + 1}"]`);
    const before = calls.length;
    click('.arena__feedback .hanko');
    await flush();
    expect(calls).toHaveLength(before);
    const q2 = items[1] as Extract<ListenItem, { kind: 'gist' }>;
    expect(q2.q.lineRef).toBe(2);
    click(`.arena__choice[aria-keyshortcuts="${((q2.q.answer + 1) % 4) + 1}"]`);
    await flush();
    expect(calls).toHaveLength(before + 1);
    const replay = calls[before] as SpeakCall;
    expect(replay.o?.clip).toBe(`${PIECE_ID}#L2`);
    expect(replay.text).toBe(toPlain((PIECE.lines[2] as StoryLine).ja));
    expect(replay.o?.speaker).toBe((PIECE.lines[2] as StoryLine).speaker);
    expect(root.querySelector('.feedback')?.textContent).toContain('Line 3');
    // a right answer on a lineRef question replays nothing
    click('.arena__feedback .hanko');
    await flush();
    const q3 = items[2] as Extract<ListenItem, { kind: 'gist' }>;
    expect(q3.q.lineRef).toBe(8);
    click(`.arena__choice[aria-keyshortcuts="${q3.q.answer + 1}"]`);
    await flush();
    expect(calls).toHaveLength(before + 1);
  });
});

describe('header: speakers and source (design 08 §10.4)', () => {
  const noRecorded = (): void => expect((root.textContent ?? '').toLowerCase()).not.toContain('recorded');

  it('names the speakers and says "device" without a pack, "synthetic" with one, "text only" without a voice; "recorded" appears nowhere', async () => {
    installServices({ audio: clipAudio().audio });
    act(() => render(<ListeningArena storyId={PIECE_ID} rate={1} onDone={vi.fn()} loader={pieceLoader} />, root));
    const names = Array.from(root.querySelectorAll('.arena__speaker-name')).map((n) => n.textContent);
    expect(names).toEqual(['ケン', 'ハナ']);
    expect(root.querySelector('.arena__speaker-name')?.getAttribute('lang')).toBe('ja');
    expect(root.querySelector('.arena__source')?.textContent).toBe('2 voices · device');
    expect(root.querySelector('.arena__genre')?.textContent).toBe('Genre: a short exchange · listen first');
    noRecorded();
    render(null, root);

    installServices({ audio: clipAudio({ cue: cueOf('ずんだもん', 1), source: 'clips' }).audio });
    act(() => render(<ListeningArena storyId={PIECE_ID} rate={1} onDone={vi.fn()} loader={pieceLoader} />, root));
    expect(root.querySelector('.arena__source')?.textContent).toBe('2 voices · synthetic');
    expect(root.querySelector('.arena__source')?.getAttribute('data-source')).toBe('clips');
    noRecorded();
    render(null, root);

    installServices({ audio: clipAudio({ hasVoice: false }).audio });
    act(() => render(<ListeningArena storyId={FIXTURE_STORY_ID} rate={1} onDone={vi.fn()} loader={loader} />, root));
    expect(root.querySelector('.arena__source')?.textContent).toBe('text only');
    // a speaker-less diary: one voice, named "narration" in English
    expect(Array.from(root.querySelectorAll('.arena__speaker-name')).map((n) => n.textContent)).toEqual([S.narrationName]);
    noRecorded();
  });

  it('a ready pack reads as synthetic before the first speak() through the service’s idle `source` default (contract), with no guess of its own', () => {
    // `source` holds the source the next speak() would use before anything is spoken; the Arena reads it as is.
    const { audio } = clipAudio({ cue: cueOf('ずんだもん', 1), source: 'clips' });
    installServices({ audio: { ...audio, packReady: signal(true) } as AudioService });
    mountStandalone(1);
    expect(root.querySelector('.arena__source')?.textContent).toBe('2 voices · synthetic');
    expect(root.querySelector('.arena__source')?.getAttribute('data-source')).toBe('clips');
  });

  it('the transcript credits VOICEVOX:<character> per speaker on the clip path, and nothing on the device path', async () => {
    const { audio } = clipAudio({ cue: cueOf('ずんだもん', 1), source: 'clips' });
    installServices({ audio });
    mountStandalone(0.9);
    await toTranscript(DIALOGUE);
    const credits = Array.from(root.querySelectorAll('.arena__credit')).map((li) => li.textContent);
    expect(credits).toEqual(['ケン · VOICEVOX:ずんだもん', 'ハナ · VOICEVOX:ずんだもん']);
    expect(root.querySelector('.arena__credits')?.textContent).toContain(S.creditsTitle);
    noRecorded();
    render(null, root);

    installServices({ audio: clipAudio().audio });
    mountStandalone(0.9);
    await toTranscript(DIALOGUE);
    expect(root.querySelector('.arena__credits')).toBeNull();
    noRecorded();
  });
});

describe('listening:set payload (design 08 §10.4, §12)', () => {
  it('text mode carries genre, bridge, authentic, cold and mode; a pass appends the id to progress.listened', async () => {
    installServices({ audio: clipAudio().audio });
    const cap = captureEvents();
    act(() => render(<ListeningArena storyId={PIECE_ID} rate={1} onDone={vi.fn()} loader={pieceLoader} />, root));
    await toTranscript(PIECE);
    await relistenAndFinish();
    const ev = cap.events.find(([n]) => n === 'listening:set');
    cap.stop();
    expect(ev?.[1]).toMatchObject({ storyId: PIECE_ID, mode: 'text', genre: 'exchange', bridge: false, authentic: false, cold: true, rate: 1 });
    expect(store.progress.value.listened).toEqual([PIECE_ID]);
    // design 08 §10.2: a passed set stamps the text with today for Radio's 14-day "worked on recently" rule
    expect(store.progress.value.arenaAt).toEqual({ [PIECE_ID]: store.today() });
  });

  it('a pass on a text already heard keeps progress.listened as is and still re-stamps arenaAt with today', async () => {
    const earlier = 123;
    await makeTestStore({ save: { settings: { furigana: 'off' }, progress: { listened: [PIECE_ID, BRIDGE_ID], arenaAt: { [PIECE_ID]: earlier, [BRIDGE_ID]: earlier } } } });
    installServices({ audio: clipAudio().audio });
    act(() => render(<ListeningArena storyId={PIECE_ID} rate={1} onDone={vi.fn()} loader={pieceLoader} />, root));
    await toTranscript(PIECE);
    await relistenAndFinish();
    expect(store.progress.value.listened).toEqual([PIECE_ID, BRIDGE_ID]);
    expect(store.progress.value.arenaAt).toEqual({ [PIECE_ID]: store.today(), [BRIDGE_ID]: earlier });
    expect(store.today()).not.toBe(earlier);
  });

  it('a bridge dialogue is authentic; cold is false when a Radio hearing already put the id in progress.listened; a failed set appends nothing', async () => {
    await makeTestStore({ save: { settings: { furigana: 'off' }, progress: { listened: [BRIDGE_ID] } } });
    installServices({ audio: clipAudio().audio });
    const cap = captureEvents();
    act(() => render(<ListeningArena storyId={BRIDGE_ID} rate={1} onDone={vi.fn()} loader={pieceLoader} />, root));
    const items = await toTranscript(BRIDGE, { wrongAt: [0, 1, 2, 3, 4, 5, 6, 7] });
    await relistenAndFinish();
    const ev = cap.events.find(([n]) => n === 'listening:set');
    cap.stop();
    expect(ev?.[1]).toMatchObject({ storyId: BRIDGE_ID, mode: 'text', bridge: true, authentic: true, cold: false, correct: 0, total: items.length });
    expect((ev?.[1] as { genre?: unknown }).genre).toBeUndefined();
    expect(store.progress.value.listened).toEqual([BRIDGE_ID]); // unchanged: already heard, and this set failed anyway
    expect(store.progress.value.arenaAt ?? {}).toEqual({}); // a failed set stamps nothing
    render(null, root);

    // a plain dialogue, not yet heard, failed: cold but not appended
    const cap2 = captureEvents();
    mountStandalone(1);
    await toTranscript(DIALOGUE, { wrongAt: [0, 1, 2, 3, 4, 5, 6, 7] });
    await relistenAndFinish();
    const ev2 = cap2.events.find(([n]) => n === 'listening:set');
    cap2.stop();
    expect(ev2?.[1]).toMatchObject({ storyId: FIXTURE_DIALOGUE_ID, cold: true, authentic: false, bridge: false, mode: 'text' });
    expect(store.progress.value.listened).toEqual([BRIDGE_ID]);
    expect(store.progress.value.arenaAt ?? {}).toEqual({});
  });
});

describe('the Ear Walk: pool mode (design 08 §10.4)', () => {
  const WALK_REFS = ['v-n5-0002#ex0', 's-04-1#L3', 'v-n5-0003#ex0', 'v-n5-0006#ex0', 'v-n5-0007#ex0', 'v-n5-0008#ex0', 'v-n5-0011#ex0', 's-04-1#L8'];
  const ex = (id: string, k: number, ids: string[]): PoolRef => {
    const item = loader.get(id) as { examples: { kana: string }[] };
    const kana = (item.examples[k] as { kana: string }).kana;
    return { ref: `${id}#ex${k}`, ids, kana, morae: speechMoraCount(kana) };
  };
  const ln = (i: number, ids: string[]): PoolRef => {
    const kana = (STORY.lines[i] as StoryLine).kana;
    return { ref: `${FIXTURE_STORY_ID}#L${i}`, ids, kana, morae: speechMoraCount(kana) };
  };
  const POOL: ListeningPool = {
    schema: 'tsuzuku.pool/1',
    station: 4,
    refs: [
      ex(V.犬, 0, [V.犬, V.水, V.飲む]),
      ln(3, [V.私, V.コーヒー, V.飲む]),
      ex(V.水, 0, [V.水]),
      ex(V.食べる, 0, [V.パン, V.食べる]),
      ex(V.飲む, 0, [V.コーヒー, V.飲む]),
      ex(V.人, 0, [V.人]),
      ex(V.コーヒー, 0, [V.コーヒー, V.おいしい]),
      ln(8, [V.犬, V.水, V.飲む]),
    ],
  };
  const walkLoader = createFakeLoader({ ...FIXTURE, pools: { 4: POOL } });
  const VOCAB_IDS = Array.from(new Set(POOL.refs.flatMap((r) => r.ids)));

  function walkItems(): { items: ListenItem[]; lines: StoryLine[] } {
    const get = (id: string) => walkLoader.get(id);
    const items = buildWalkSet(POOL.refs, get, {
      rng: rngFor(store.seed(), store.today(), WALK_SEED_TAG, ...WALK_REFS),
      station: store.progress.value.station,
      known: knownSet(store.cards, store.today()),
    });
    const lines = POOL.refs.map((r) => {
      const l = resolveRefLine(r);
      return l;
    });
    return { items, lines };
  }
  function resolveRefLine(r: PoolRef): StoryLine {
    const parsed = /^(.+)#(ex|L)(\d+)$/.exec(r.ref) as RegExpExecArray;
    const item = walkLoader.get(parsed[1] as string) as StoryItem | { examples: { ja: string; kana: string; en: string }[] };
    if (parsed[2] === 'L') return (item as StoryItem).lines[Number(parsed[3])] as StoryLine;
    const e = (item as { examples: { ja: string; kana: string; en: string }[] }).examples[Number(parsed[3])] as { ja: string; kana: string; en: string };
    return { ja: e.ja, kana: e.kana, en: e.en, tokens: [] };
  }

  it('as an exercise with params.refs it hears the pool sentences, emits storyId null + refs + mode walk, and reports implicit listen grades like a text', async () => {
    const today = store.today();
    await makeTestStore({
      save: { settings: { furigana: 'off' }, progress: { station: 4 } },
      cards: Object.fromEntries(VOCAB_IDS.map((id) => [cardKey(id, 'listen'), card({ due: today, s: 2, state: 2 })])),
    });
    const { audio, calls } = clipAudio({ cue: cueOf('ずんだもん', 1), source: 'clips' });
    installServices({ audio });
    const cap = captureEvents();
    const onResult = vi.fn<(r: AttemptResult) => void>();
    const step: Step = {
      id: 'walk-1',
      block: 'input',
      exercise: 'listening-set',
      itemId: null,
      cardKey: null,
      params: { refs: WALK_REFS, rate: 1 },
      timed: false,
      isNew: false,
      stepTag: null,
      exposures: 0,
      estMs: 300000,
    };
    const props: ExerciseProps = {
      step,
      item: null,
      feel: 'dojo',
      furigana: 'off',
      jj: false,
      speedTier: 3,
      exposures: 0,
      onResult,
      onHint: () => undefined,
      onReplay: () => undefined,
      requestJudge: () => Promise.resolve(true),
    };
    act(() => render(<ListeningArena {...props} loader={walkLoader} />, root));
    await flush();
    expect(root.querySelector('.arena')?.getAttribute('data-mode')).toBe('walk');
    expect(root.querySelector('.arena__title')?.textContent).toBe(`${S.walkTitleJa}${S.walkTitle}`);
    expect(root.querySelector('.arena__title-ja')?.getAttribute('lang')).toBe('ja');
    expect(root.querySelector('.arena__hint')?.textContent).toBe(S.walkIntro);
    expect((root.textContent ?? '').toLowerCase()).not.toContain('recorded');
    const { items, lines } = walkItems();
    expect(items.length).toBe(8);
    expect(items.some((i) => i.kind === 'gist')).toBe(false);
    const heard = Array.from(new Set(items.map((i) => (i.kind === 'gist' ? -1 : i.lineIndex)))).sort((a, b) => a - b);
    expect(root.querySelector('.arena__story-title')?.textContent).toBe(`${heard.length} sentences you can follow`);
    click('.hanko');
    await flush();
    expect(calls).toHaveLength(heard.length);
    calls.forEach((c, k) => {
      const ref = (POOL.refs[heard[k] as number] as PoolRef).ref;
      expect(c.o?.clip).toBe(ref);
      expect(c.text).toBe(toPlain((lines[heard[k] as number] as StoryLine).ja));
    });
    act(() => buttonByText(S.toQuestions).click());
    await answerSet(items, lines);
    await relistenAndFinish();
    cap.stop();
    const ev = cap.events.find(([n]) => n === 'listening:set');
    expect(ev?.[1]).toMatchObject({ storyId: null, mode: 'walk', cold: false, correct: items.length, total: items.length, rate: 1 });
    expect((ev?.[1] as { refs: string[] }).refs).toEqual(heard.map((i) => (POOL.refs[i] as PoolRef).ref));
    expect((ev?.[1] as { genre?: unknown }).genre).toBeUndefined();
    expect(store.progress.value.listened ?? []).toEqual([]);
    expect(store.progress.value.arenaAt ?? {}).toEqual({}); // a walk (storyId null) writes no arenaAt
    expect(onResult).toHaveBeenCalledTimes(1);
    const r = onResult.mock.calls[0]?.[0] as AttemptResult;
    expect(r).toMatchObject({ correct: true, score: 1 });
    // dictated pool sentences grade the words heard — through the pool's ids for examples, the tokenIds for lines
    const dictated = items.filter((i): i is Extract<ListenItem, { kind: 'dictation' }> => i.kind === 'dictation');
    expect(dictated.length).toBeGreaterThan(0);
    const expectedIds = new Set(dictated.flatMap((d) => (POOL.refs[d.lineIndex] as PoolRef).ids.filter((id) => id.startsWith('v-'))));
    expect(r.implicit?.length ?? 0).toBeGreaterThan(0);
    expect(r.implicit?.every((g) => g.rating === 3 && g.cardKey.endsWith('#listen'))).toBe(true);
    for (const g of r.implicit ?? []) expect(expectedIds.has(g.cardKey.split('#')[0] as string)).toBe(true);
    // the runner applies `implicit`; the Arena never wrote the cards
    expect(store.cards.get((r.implicit?.[0] as { cardKey: CardKeyT }).cardKey)?.[3]).toBe(0);
  });

  it('standalone, without a pool file, the walk still plays from the content (an example grades its own word) and records the evidence itself', async () => {
    const today = store.today();
    await makeTestStore({
      save: { settings: { furigana: 'off' }, progress: { station: 4 } },
      cards: Object.fromEntries(VOCAB_IDS.map((id) => [cardKey(id, 'listen'), card({ due: today, s: 2, state: 2 })])),
    });
    installServices({ audio: clipAudio().audio });
    const cap = captureEvents();
    const onDone = vi.fn();
    act(() => render(<ListeningArena refs={WALK_REFS} rate={1} onDone={onDone} loader={loader} />, root));
    await flush();
    expect(root.querySelector('.arena')?.getAttribute('data-mode')).toBe('walk');
    const get = (id: string) => loader.get(id);
    const refs = WALK_REFS.map((ref) => poolRefForTest(ref));
    const items = buildWalkSet(refs, get, { rng: rngFor(store.seed(), store.today(), WALK_SEED_TAG, ...WALK_REFS), station: 4, known: knownSet(store.cards, today) });
    const lines = refs.map((r) => resolveRefLine(r));
    click('.hanko');
    await flush();
    act(() => buttonByText(S.toQuestions).click());
    await answerSet(items, lines);
    await relistenAndFinish();
    cap.stop();
    expect(onDone).toHaveBeenCalledWith({ correct: items.length, total: items.length });
    expect(cap.events.find(([n]) => n === 'listening:set')?.[1]).toMatchObject({ storyId: null, mode: 'walk' });
    const graded = VOCAB_IDS.map((id) => store.cards.get(cardKey(id, 'listen'))).filter((c): c is NonNullable<typeof c> => !!c);
    expect(graded.some((c) => c[3] >= 1)).toBe(true);
  });

  it('a pool-held ref the content cannot resolve is dropped without shifting the others: every clip is its own sentence, every resolvable ref is heard, the answer keys match', async () => {
    await makeTestStore({ save: { settings: { furigana: 'off' }, progress: { station: 4 } } });
    // a stale pool: its first ref names an item that is not in the content
    const GHOST: PoolRef = { ref: 'v-n5-0999#ex0', ids: ['v-n5-0999'], kana: 'なにか', morae: 3 };
    const KEPT: PoolRef[] = [ex(V.犬, 0, [V.犬, V.水, V.飲む]), ex(V.水, 0, [V.水]), ex(V.食べる, 0, [V.パン, V.食べる]), ex(V.人, 0, [V.人])];
    const ghostPool: ListeningPool = { schema: 'tsuzuku.pool/1', station: 4, refs: [GHOST, ...KEPT] };
    const ghostLoader = createFakeLoader({ ...FIXTURE, pools: { 4: ghostPool } });
    const { audio, calls } = clipAudio({ cue: cueOf('ずんだもん', 1), source: 'clips' });
    installServices({ audio });
    const cap = captureEvents();
    act(() => render(<ListeningArena refs={ghostPool.refs.map((r) => r.ref)} rate={1} onDone={vi.fn()} loader={ghostLoader} />, root));
    await flush();
    const get = (id: string) => ghostLoader.get(id);
    const items = buildWalkSet(KEPT, get, { rng: rngFor(store.seed(), store.today(), WALK_SEED_TAG, ...KEPT.map((r) => r.ref)), station: 4, known: knownSet(store.cards, store.today()) });
    const lines = KEPT.map((r) => resolveRefLine(r));
    expect(items).toHaveLength(KEPT.length);
    expect(root.querySelector('.arena__story-title')?.textContent).toBe(`${KEPT.length} sentences you can follow`);
    click('.hanko');
    await flush();
    // the ghost is gone and nothing after it moved: clip k is sentence k
    expect(calls.map((c) => c.o?.clip)).toEqual(KEPT.map((r) => r.ref));
    calls.forEach((c, k) => expect(c.text).toBe(toPlain((lines[k] as StoryLine).ja)));
    act(() => buttonByText(S.toQuestions).click());
    await answerSet(items, lines);
    await relistenAndFinish();
    cap.stop();
    const ev = cap.events.find(([n]) => n === 'listening:set')?.[1] as { refs: string[]; correct: number; total: number };
    expect(ev.refs).toEqual(KEPT.map((r) => r.ref));
    // every answer keyed on the sentences that were actually played
    expect(ev.total).toBe(items.length);
    expect(ev.correct).toBe(items.length);
  });

  it('the clause lookup of a walk ref carries the line’s speaker, like playback does (the pack narrows a key’s variants by speaker)', async () => {
    await makeTestStore({ save: { settings: { furigana: 'off' }, progress: { station: 4 } } });
    const TALK_ID = 's-04-5';
    const tokens = ['わたし', 'は', 'まいあさ', 'コーヒー', 'を', 'のんで', '、', 'パン', 'を', 'たべて', '、', 'いぬ', 'と', 'さんぽします', '。'];
    const ja = tokens.join('');
    const TALK: StoryItem = {
      ...DIALOGUE,
      id: TALK_ID,
      titleEn: 'A long morning',
      lines: [{ ja, kana: ja, en: 'Every morning I drink coffee, eat bread and walk the dog.', tokens, tokenIds: tokens.map(() => null), speaker: 'ケン' }],
    };
    // the one i+1 ref (a single unknown id) takes the dictation slot; over 22 morae it dictates a clause when the cue has cuts
    const LONG_REF: PoolRef = { ref: `${TALK_ID}#L0`, ids: [V.コーヒー], kana: ja, morae: speechMoraCount(ja) };
    const others: PoolRef[] = [ex(V.犬, 0, [V.犬, V.水]), ex(V.水, 0, [V.水, V.飲む]), ex(V.食べる, 0, [V.パン, V.食べる])];
    const pool: ListeningPool = { schema: 'tsuzuku.pool/1', station: 4, refs: [others[0] as PoolRef, LONG_REF, others[1] as PoolRef, others[2] as PoolRef] };
    const talkLoader = createFakeLoader({ ...FIXTURE, items: { ...FIXTURE.items, [TALK_ID]: TALK }, pools: { 4: pool } });
    const cueCalls: { key: string; o?: { rate?: number; speaker?: string } }[] = [];
    const cue = cueOf('ずんだもん', 1, (key) => (key === LONG_REF.ref ? [16, 22] : undefined));
    const { audio } = clipAudio({
      cue: (key, o) => {
        cueCalls.push({ key, o });
        return cue(key);
      },
      source: 'clips',
    });
    installServices({ audio });
    act(() => render(<ListeningArena refs={pool.refs.map((r) => r.ref)} rate={1} onDone={vi.fn()} loader={talkLoader} />, root));
    await flush();
    const get = (id: string) => talkLoader.get(id);
    const items = buildWalkSet(pool.refs, get, {
      rng: rngFor(store.seed(), store.today(), WALK_SEED_TAG, ...pool.refs.map((r) => r.ref)),
      station: 4,
      known: knownSet(store.cards, store.today()),
      clauses: (ref) => cue(ref).clauses,
    });
    const dict = items.find((i): i is Extract<ListenItem, { kind: 'dictation' }> => i.kind === 'dictation' && i.lineIndex === 1);
    expect(dict?.clause).toBeDefined();
    const forLong = cueCalls.filter((c) => c.key === LONG_REF.ref);
    expect(forLong.length).toBeGreaterThan(0); // the clause lookup ran at build time, before any speak()
    for (const c of forLong) expect(c.o).toEqual({ rate: 1, speaker: 'ケン' });
    // example sentences have no speaker, so their lookups carry none
    for (const c of cueCalls.filter((c) => c.key !== LONG_REF.ref)) expect(c.o?.speaker).toBeUndefined();
    expect(root.querySelector('.arena__speakers')?.textContent).toBe(`${S.speakersLabel}${S.narrationName}ケン`);
    expect(root.querySelector('.arena__source')?.textContent).toBe('2 voices · synthetic');
  });

  function poolRefForTest(ref: string): PoolRef {
    const parsed = /^(.+)#(ex|L)(\d+)$/.exec(ref) as RegExpExecArray;
    const line = resolveRefLine({ ref, ids: [], kana: '', morae: 0 });
    const ids = line.tokenIds ? Array.from(new Set(line.tokenIds.filter((x): x is string => !!x && (x.startsWith('v-') || x.startsWith('g-'))))) : [parsed[1] as string];
    return { ref, ids, kana: line.kana, morae: speechMoraCount(line.kana) };
  }
});

describe('karaoke on the re-listen (design 08 §9)', () => {
  it('at ≥ 1.0× onProgress sweeps the token spans (data-sung) of the line being sung', async () => {
    const { audio, calls } = clipAudio({ cue: cueOf('ずんだもん', 1), source: 'clips' });
    installServices({ audio });
    mountStandalone(0.9); // re-listen at 1.0×
    await toTranscript(DIALOGUE);
    expect(root.querySelectorAll('.arena__transcript li[data-karaoke="tokens"]')).toHaveLength(DIALOGUE.lines.length);
    expect(root.querySelector('.arena__mora-dot')).toBeNull();
    const before = calls.length;
    act(() => buttonByText('Listen again at 1×').click());
    await flush();
    const relistenCalls = calls.slice(before);
    expect(relistenCalls).toHaveLength(DIALOGUE.lines.length);
    for (const c of relistenCalls) expect(typeof c.o?.onProgress).toBe('function');
    const i = 9; // {犬|いぬ}は{水|みず}を{飲|の}みますか。
    const line = DIALOGUE.lines[i] as StoryLine;
    const spans = tokenMoraSpans(line);
    const li = root.querySelector(`li[data-line="${i}"]`) as HTMLElement;
    expect(li.querySelectorAll('.ruby__token[data-token]')).toHaveLength(line.tokens.length);
    act(() => (relistenCalls[i] as SpeakCall).o?.onProgress?.(0.4, 4, 0));
    const active = activeToken(spans, 4);
    expect(active).toBe(2); // 水
    const sung = Array.from(li.querySelectorAll<HTMLElement>('.ruby__token[data-token]')).map((s) => s.getAttribute('data-sung'));
    expect(sung).toEqual(['true', 'true', 'now', null, null, null, null]);
    act(() => (relistenCalls[i] as SpeakCall).o?.onProgress?.(0.9, 8, 0));
    const sung2 = Array.from(li.querySelectorAll<HTMLElement>('.ruby__token[data-token]')).map((s) => s.getAttribute('data-sung'));
    expect(sung2).toEqual(['true', 'true', 'true', 'true', 'now', null, null]);
    // other lines are untouched
    expect(root.querySelectorAll('li[data-line="0"] [data-sung]')).toHaveLength(0);
  });

  it('a natural-slow cue (rate 0.85) shows one dot per beat and lights them from onProgress instead of sweeping tokens', async () => {
    const { audio, calls } = clipAudio({ cue: cueOf('ずんだもん', 0.85), source: 'clips' });
    installServices({ audio });
    mountStandalone(0.75); // re-listen at 0.85×: the slow take is served
    await toTranscript(DIALOGUE);
    expect(root.querySelectorAll('.arena__transcript li[data-karaoke="morae"]')).toHaveLength(DIALOGUE.lines.length);
    const i = 3; // はい、のみます。 → 6 beats
    const li = root.querySelector(`li[data-line="${i}"]`) as HTMLElement;
    const line = DIALOGUE.lines[i] as StoryLine;
    expect(li.querySelectorAll('.arena__mora-dot')).toHaveLength(speechMoraCount(line.kana));
    expect(li.querySelector('.arena__mora-dots')?.getAttribute('aria-label')).toBe(`${speechMoraCount(line.kana)} beats`);
    const before = calls.length;
    act(() => buttonByText('Listen again at 0.85×').click());
    await flush();
    act(() => (calls[before + i] as SpeakCall).o?.onProgress?.(0.3, 2, 0));
    const dots = Array.from(li.querySelectorAll<HTMLElement>('.arena__mora-dot')).map((d) => d.getAttribute('data-on'));
    expect(dots).toEqual(['done', 'done', 'true', null, null, null]);
    expect(li.querySelector('[data-sung]')).toBeNull();
  });

  it('between the two (a device-rate cue below 1.0×) and on the synth path the highlight stays line-level: data-speaking per line, no onProgress', async () => {
    const { audio, calls, resolveNext, resolveAll } = clipAudio({ deferred: true });
    installServices({ audio });
    mountStandalone(0.9);
    // listen phase: drain the deferred chain
    click('.hanko');
    await flush();
    for (let k = 0; k < DIALOGUE.lines.length; k++) {
      resolveNext();
      await flush();
    }
    act(() => buttonByText(S.toQuestions).click());
    const items = expectedItems();
    for (let i = 0; i < items.length; i++) {
      await flush();
      const item = items[i] as ListenItem;
      if (item.kind !== 'gist') {
        resolveNext(); // the item line that auto-plays
        await flush();
      }
      if (item.kind === 'dictation') {
        const input = root.querySelector('input') as HTMLInputElement;
        type(input, normalizeJa((DIALOGUE.lines[item.lineIndex] as StoryLine).kana));
        enter(input);
      } else {
        const answer = item.kind === 'gist' ? item.q.answer : item.answer;
        click(`.arena__choice[aria-keyshortcuts="${answer + 1}"]`);
      }
      click('.arena__feedback .hanko');
    }
    expect(root.querySelector('.arena')?.getAttribute('data-phase')).toBe('transcript');
    expect(root.querySelectorAll('.arena__transcript li[data-karaoke="line"]')).toHaveLength(DIALOGUE.lines.length);
    const before = calls.length;
    act(() => buttonByText('Listen again at 1×').click());
    await flush();
    expect(root.querySelector('li[data-line="0"]')?.getAttribute('data-speaking')).toBe('true');
    expect(root.querySelector('li[data-line="0"]')?.getAttribute('aria-current')).toBe('true');
    expect((calls[before] as SpeakCall).o?.onProgress).toBeUndefined();
    resolveNext();
    await flush();
    expect(root.querySelector('li[data-line="0"]')?.getAttribute('data-speaking')).toBeNull();
    expect(root.querySelector('li[data-line="1"]')?.getAttribute('data-speaking')).toBe('true');
    await resolveAll();
    expect(root.querySelector('[data-speaking="true"]')).toBeNull();
    expect(root.querySelector('.arena__hint')?.textContent).toBe(S.relistenDone);
  });
});

describe('clause dictation (design 08 §9)', () => {
  const SUBJECTS = ['わたし', 'ケン', 'ハナ', 'みんな', 'せんせい', 'ともだち', 'おとうさん', 'おかあさん', 'あに', 'あね', 'おとうと', 'いもうと'];
  const longLine = (subject: string, en: string): StoryLine => {
    const tokens = [subject, 'は', 'まいあさ', 'コーヒー', 'を', 'のんで', '、', 'パン', 'を', 'たべて', '、', 'いぬ', 'と', 'さんぽします', '。'];
    const ja = tokens.join('');
    return { ja, kana: ja, en, tokens, tokenIds: tokens.map(() => null) };
  };
  const LONG: StoryItem = {
    ...STORY,
    id: 's-04-3',
    titleEn: 'Long mornings',
    lines: SUBJECTS.map((s, i) => longLine(s, `Every morning ${s} (${i}) drinks coffee, eats bread and walks the dog.`)),
  };
  const cutsFor = (i: number): number[] => {
    const m = speechMoraCount(SUBJECTS[i] as string);
    return [m + 13, m + 19];
  };
  const longLoader = createFakeLoader({ ...FIXTURE, items: { ...FIXTURE.items, [LONG.id]: LONG } });

  it('a line over 22 morae with cue clauses is dictated one clause: spoken with the clause option, graded against the clause kana', async () => {
    for (const l of LONG.lines) expect(speechMoraCount(l.kana)).toBeGreaterThan(22);
    const { audio, calls } = clipAudio({ cue: cueOf('ずんだもん', 1, (key) => cutsFor(Number(key.split('#L')[1]))), source: 'clips' });
    installServices({ audio });
    const cap = captureEvents();
    act(() => render(<ListeningArena storyId={LONG.id} rate={1} onDone={vi.fn()} loader={longLoader} />, root));
    const items = itemsFor(LONG, cutsFor);
    const dictations = items.filter((i): i is Extract<ListenItem, { kind: 'dictation' }> => i.kind === 'dictation');
    expect(dictations.length).toBeGreaterThan(0);
    for (const d of dictations) expect(d.clause).toBeDefined();
    // without clause boundaries the same lines are choice items
    expect(itemsFor(LONG).every((i) => i.kind !== 'dictation')).toBe(true);
    click('.hanko');
    await flush();
    act(() => buttonByText(S.toQuestions).click());
    for (let i = 0; i < items.length; i++) {
      await flush();
      const item = items[i] as ListenItem;
      if (item.kind === 'dictation') {
        const line = LONG.lines[item.lineIndex] as StoryLine;
        const clause = item.clause as [number, number];
        const kana = clauseKana(line.kana, clause);
        const last = calls[calls.length - 1] as SpeakCall;
        expect(last.o?.clause).toEqual(clause);
        expect(last.o?.kana).toBe(kana);
        expect(last.text).toBe(kana); // kana-only line: the clause text is its kana
        expect(last.o?.clip).toBe(`${LONG.id}#L${item.lineIndex}`);
        expect(root.querySelector('.arena__prompt')?.textContent).toBe(S.clausePrompt);
        expect(root.querySelector('.arena__clause-note')?.textContent).toBe(`One clause of a longer line: ${clause[1] - clause[0]} beats.`);
        const input = root.querySelector('input') as HTMLInputElement;
        type(input, kana);
        enter(input);
        expect(root.querySelector('.feedback')?.textContent).toContain(S.correct);
      } else {
        const answer = item.kind === 'gist' ? item.q.answer : item.answer;
        click(`.arena__choice[aria-keyshortcuts="${answer + 1}"]`);
      }
      click('.arena__feedback .hanko');
    }
    await relistenAndFinish();
    cap.stop();
    expect(cap.events.find(([n]) => n === 'listening:set')?.[1]).toMatchObject({ storyId: LONG.id, correct: items.length, total: items.length });
    // a clause is never the Waveform sentence
    expect(store.profile.value.dictatedSentence).toBeUndefined();
  });
});

describe('first-contact cards (design 08 §11, TeachOnce)', () => {
  it('the first-Arena card shows in the listen phase until dismissed, which writes progress.teachSeen', async () => {
    installServices({ audio: clipAudio().audio });
    mountStandalone();
    const card = root.querySelector(`[data-teach-id="${TEACH_ARENA_FIRST}"]`) as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain(S.teachArenaFirstTitle);
    expect(root.querySelector(`[data-teach-id="${TEACH_ARENA_BRIDGE}"]`)).toBeNull();
    act(() => (card.querySelector('.teach-once__dismiss') as HTMLButtonElement).click());
    // design 09 §6.3: the card leaves (kasure) before onDismiss fires — on animationend, or TeachOnce's EXIT_FALLBACK_MS fallback where jsdom sends none
    await act(async () => {
      await new Promise((r) => setTimeout(r, EXIT_FALLBACK_MS + 60));
    });
    expect(store.progress.value.teachSeen).toContain(TEACH_ARENA_FIRST);
    expect(root.querySelector(`[data-teach-id="${TEACH_ARENA_FIRST}"]`)).toBeNull();
    render(null, root);
    mountStandalone();
    expect(root.querySelector(`[data-teach-id="${TEACH_ARENA_FIRST}"]`)).toBeNull();
  });

  it('the Station 27 card appears for a bridge text from Station 27 and not for a plain dialogue', async () => {
    await makeTestStore({ save: { settings: { furigana: 'off' }, progress: { station: 27 } } });
    installServices({ audio: clipAudio().audio });
    act(() => render(<ListeningArena storyId={BRIDGE_ID} rate={1} onDone={vi.fn()} loader={pieceLoader} />, root));
    expect(root.querySelector(`[data-teach-id="${TEACH_ARENA_BRIDGE}"]`)?.textContent).toContain(S.teachArenaBridgeBody);
    render(null, root);
    act(() => render(<ListeningArena storyId={FIXTURE_DIALOGUE_ID} rate={1} onDone={vi.fn()} loader={pieceLoader} />, root));
    expect(root.querySelector(`[data-teach-id="${TEACH_ARENA_BRIDGE}"]`)).toBeNull();
  });
});

describe('listen evidence for a sentence without tokens (pool examples)', () => {
  it('wordSurfacesIn finds the reading a word has in the sentence, inflected verbs included', () => {
    const nomu = loader.get(V.飲む) as Parameters<typeof wordSurfacesIn>[0];
    expect(wordSurfacesIn(nomu, '{毎朝|まいあさ}コーヒーを{飲|の}みます。')).toContain('のみ');
    const taberu = loader.get(V.食べる) as Parameters<typeof wordSurfacesIn>[0];
    expect(wordSurfacesIn(taberu, 'パンを{食|た}べます。')).toContain('たべま');
    const oishii = loader.get(V.おいしい) as Parameters<typeof wordSurfacesIn>[0];
    expect(wordSurfacesIn(oishii, 'この{水|みず}はおいしいです。')).toContain('おいし');
    const coffee = loader.get(V.コーヒー) as Parameters<typeof wordSurfacesIn>[0];
    expect(wordSurfacesIn(coffee, 'コーヒーはおいしいです。')).toContain('コーヒー');
  });

  it('implicitListenGrades over ids: the heard word is Good, the dropped word Again, function words and far-off cards skipped', async () => {
    const today = store.today();
    await makeTestStore({
      cards: {
        [cardKey(V.飲む, 'listen')]: card({ due: today, s: 3, state: 2 }),
        [cardKey(V.コーヒー, 'listen')]: card({ due: today + 1, s: 3, state: 2 }),
        [cardKey(V.水, 'listen')]: card({ due: today + 10, s: 30, state: 2 }),
      },
    });
    const line: StoryLine = { ja: '{毎朝|まいあさ}コーヒーを{飲|の}みます。', kana: 'まいあさコーヒーをのみます。', en: '', tokens: [] };
    const get = (id: string) => loader.get(id);
    const ids = [V.コーヒー, V.飲む, V.水];
    expect(implicitListenGrades(line, 'まいあさこーひーをのみます', get, store.cards, today, { ids })).toEqual([
      { cardKey: cardKey(V.コーヒー, 'listen'), rating: 3 },
      { cardKey: cardKey(V.飲む, 'listen'), rating: 3 },
    ]);
    expect(implicitListenGrades(line, 'まいあさをのみます', get, store.cards, today, { ids })).toEqual([
      { cardKey: cardKey(V.コーヒー, 'listen'), rating: 1 },
      { cardKey: cardKey(V.飲む, 'listen'), rating: 3 },
    ]);
    // a clause restricts the evidence to the words inside it
    expect(implicitListenGrades(line, 'のみます', get, store.cards, today, { ids, clause: [9, 13] })).toEqual([{ cardKey: cardKey(V.飲む, 'listen'), rating: 3 }]);
    expect(implicitListenGrades(line, 'x', get, store.cards, today)).toEqual([]);
  });
});

/* ── design 09 (C4): the --ai-dye band, .eyebrow labels, bands on scaleY ─────── */
describe('design 09 (C4): the indigo band and ListeningArena.css', () => {
  it('the header carries one static --ai-dye band whose title says who speaks, matching the source chip; the band is aria-hidden so the source is announced once', () => {
    installServices({ audio: clipAudio().audio });
    act(() => render(<ListeningArena storyId={PIECE_ID} rate={1} onDone={vi.fn()} loader={pieceLoader} />, root));
    const bands = root.querySelectorAll('.arena__band');
    expect(bands).toHaveLength(1);
    const band = bands[0]!;
    expect(band.parentElement?.classList.contains('arena__head')).toBe(true);
    const chip = root.querySelector('.arena__source')?.textContent ?? '';
    expect(chip).toContain('voices');
    expect(band.getAttribute('title')).toBe(chip);
    expect(band.getAttribute('aria-hidden')).toBe('true');
    expect(band.hasAttribute('aria-label')).toBe(false);
    expect(band.hasAttribute('role')).toBe(false);
    // the "synthetic" word stays where it was: in the chip, not duplicated as text
    expect(root.querySelector('.arena__speakers .eyebrow')?.textContent).toBe(S.speakersLabel);
    expect(root.querySelector('[class*="__label"]')).toBeNull();
    // the listen stage is a .sheet (design 09 §12.1 d53): no cartouche on an input surface
    expect(root.querySelector('.arena__stage')?.classList.contains('sheet')).toBe(true);
    expect(root.querySelector('.arena__stage.status-window, .arena__result.status-window')).toBeNull();
  });

  it('ListeningArena.css: the band is --ai-dye and static; no width/height tween, bands ride scaleY, no glow, no local reduced-motion block', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/input/listening/ListeningArena.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const band = /\.arena__band\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(band).toMatch(/background:\s*var\(--ai-dye\)/);
    expect(band).not.toMatch(/transition|animation/);
    expect(css).not.toMatch(/transition:[^;]*\b(width|height)\b/);
    expect(css).not.toMatch(/@keyframes/);
    const wave = /\.arena__wave\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(wave).toMatch(/transform:\s*scaleY\(/);
    expect(wave).toMatch(/transform-origin:\s*bottom/);
    expect(/\.arena__wave\[data-on='true'\]\s*\{[^}]*transform:\s*scaleY\(1\)/.test(css)).toBe(true);
    expect(css).not.toMatch(/box-shadow:\s*0 0 8px/);
    expect(css).not.toMatch(/__label|__eyebrow/);
    expect(css).not.toMatch(/status-window/);
    for (const cls of ['arena__stage', 'arena__result']) expect(new RegExp(`\\.${cls}\\s*\\{[^}]*\\b(padding|background|border|box-shadow)\\s*:`).test(css), cls).toBe(false);
    expect(css).not.toMatch(/prefers-reduced-motion|\.reduced-motion/);
  });
});
