import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { ContentLoader } from '@/content/loader';

/** The live `content` singleton delegates to whatever loader a test installs (fixture loader by default). */
const H = vi.hoisted(() => ({ loader: null as unknown }));
vi.mock('@/content/loader', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/content/loader')>();
  const content = new Proxy(orig.content, {
    get(target, key) {
      const l = (H.loader as Record<PropertyKey, unknown> | null) ?? (target as unknown as Record<PropertyKey, unknown>);
      const v = l[key as string];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(l) : v;
    },
  });
  return { ...orig, content };
});

import { FIXTURE, FIXTURE_DIALOGUE_ID, FIXTURE_STORY_ID, G, V, createFakeLoader } from '@/content/fixtures';
import type { StoryItem } from '@/content/types';
import { SPEED_TIER_RATES, installServices, nullAudio, resetServices, type AudioService, type AudioSource, type ClipCue, type ClipPlayOptions, type ClipPlayer, type ClipReady } from '@/shared/audio';
import { bus } from '@/shared/events';
import type { ExerciseProps } from '@/shared/exercise-types';
import type { Step } from '@/shared/session-types';
import { CardFlag } from '@/shared/store-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { store } from '@/store';
import { captureEvents, card, makeTestStore } from '@/store/testing';
import {
  NATURAL_SLOW_RATE,
  StoryReader,
  StoryReaderView,
  activeTokenAt,
  captureStateFor,
  formatHeard,
  gistQuestionIndex,
  isDictionaryFree,
  isStoryRead,
  kaidenEvidence,
  lineClipKey,
  listenSource,
  markListened,
  meta,
  naturalSlowServed,
  rateChipsFor,
  readAlongRates,
  speakerSlots,
  storyStation,
  toAttemptResult,
  tokenMoraSpans,
  type StoryListenProps,
  type StoryListenResult,
  type StoryReadProps,
  type StoryReadResult,
} from './StoryReader';
import { S } from './strings';

const STORY = FIXTURE.items[FIXTURE_STORY_ID] as StoryItem;
const DIALOGUE = FIXTURE.items[FIXTURE_DIALOGUE_ID] as StoryItem;
const ANSWERS = STORY.comprehension.map((qq) => qq.choices[qq.answer]);

let root: HTMLDivElement;
let clock = 1_000_000;
let loader: ContentLoader;
let spoken: [string, unknown][];

beforeEach(async () => {
  clock = 1_000_000;
  loader = createFakeLoader();
  H.loader = loader;
  spoken = [];
  const audio: AudioService = { ...nullAudio, speak: (t, o) => ((spoken.push([t, o]), Promise.resolve())) };
  installServices({ audio });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
  bus.reset();
});

const q = (sel: string): HTMLElement | null => root.querySelector(sel);
const qa = (sel: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(sel));
const click = (el: Element | null | undefined): void => {
  act(() => (el as HTMLElement | null)?.click());
};

async function makeStore(o: Parameters<typeof makeTestStore>[0] = {}): Promise<void> {
  await makeTestStore({ now: () => clock, save: { progress: { station: 4 } }, ...o });
}

function mount(over: Partial<StoryReadProps> = {}): ReturnType<typeof vi.fn<(r: StoryReadResult) => void>> {
  const onDone = vi.fn<(r: StoryReadResult) => void>();
  act(() => render(<StoryReaderView storyId={FIXTURE_STORY_ID} loader={loader} furigana="always" onDone={onDone} {...over} />, root));
  return onDone;
}

/** Token span for `token` inside line `li` (the line must be revealed). */
function tokenEl(li: number, token: string, story: StoryItem = STORY): HTMLElement | undefined {
  const line = story.lines[li] as StoryItem['lines'][number];
  const ti = line.tokens.indexOf(token);
  return q(`li[data-line="${li}"] .ruby__token[data-token="${ti}"]`) ?? undefined;
}

/** A frame key pressed outside any input (the frame listens on window, capture phase). */
function press(key: string): void {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function revealAll(): void {
  click(q('[data-action="show-rest"]'));
}

/** Answers every question correctly (choices may be shuffled). */
function answerAll(wrongAt: number[] = [], story: StoryItem = STORY): void {
  const answers = story.comprehension.map((qq) => qq.choices[qq.answer]);
  for (let i = 0; i < story.comprehension.length; i++) {
    const buttons = qa('[data-choice]');
    const want = answers[i] as string;
    const target = wrongAt.includes(i) ? buttons.find((b) => !b.textContent?.includes(want)) : buttons.find((b) => b.textContent?.includes(want));
    click(target);
    click(q('[data-action="advance"]'));
  }
}

function finishRead(wrongAt: number[] = []): void {
  revealAll();
  click(q('[data-action="next"]')); // → questions
  answerAll(wrongAt);
}

describe('StoryReader helpers', () => {
  it('meta registers story-read with no facet and no keys', () => {
    expect(meta).toEqual({ id: 'story-read', facet: null, needsTts: false, needsStt: false, selfGraded: false, timeable: false, keys: 'none' });
  });

  it('storyStation reads the id', () => {
    expect(storyStation('s-04-1')).toBe(4);
    expect(storyStation('s-27-3')).toBe(27);
    expect(storyStation('v-n5-0001')).toBeUndefined();
  });

  it('isDictionaryFree needs ≥ 300 chars, ≥ 2/3 and ≤ 2 taps', () => {
    expect(isDictionaryFree(300, 2, 3, 2)).toBe(true);
    expect(isDictionaryFree(299, 3, 3, 0)).toBe(false);
    expect(isDictionaryFree(400, 1, 3, 0)).toBe(false);
    expect(isDictionaryFree(400, 3, 3, 3)).toBe(false);
  });

  it('speakerSlots alternates a/b by first appearance', () => {
    const slots = speakerSlots([{ speaker: 'ケン' }, { speaker: 'ハナ' }, { speaker: 'ケン' }].map((s) => ({ ...s, ja: '', kana: '', en: '', tokens: [] })));
    expect(slots.get('ケン')).toBe('a');
    expect(slots.get('ハナ')).toBe('b');
    expect(speakerSlots(STORY.lines).size).toBe(0);
  });

  it('toAttemptResult: passed → correct, missing → ungraded correct, hints → hintUsed', () => {
    const base: StoryReadResult = { storyId: 's', correct: 2, total: 3, passed: true, cpm: 100, band: 'at', chars: 100, ms: 60_000, minutes: 1, glossTaps: 0, hints: 0, dictionaryFree: false, kaidenConfirmed: [], ledgerLogged: false, bridge: false, missing: false };
    expect(toAttemptResult(base)).toMatchObject({ correct: true, hintUsed: false, ms: 60_000, score: 2 / 3, errorTags: [] });
    expect(toAttemptResult({ ...base, passed: false, correct: 1, hints: 2 })).toMatchObject({ correct: false, hintUsed: true });
    expect(toAttemptResult({ ...base, missing: true, total: 0, correct: 0 })).toMatchObject({ correct: true, score: 0 });
  });

  it('kaidenEvidence lists Kaiden base cards of untapped words only', () => {
    const cards = {
      byItem: (id: string) => {
        if (id === V.パン) return { rec: card({ flags: CardFlag.kaiden, s: 200 }) };
        if (id === V.犬) return { rec: card({ flags: CardFlag.kaiden, s: 200 }) };
        if (id === V.水) return { rec: card({ s: 20 }) };
        if (id === V.おはよう) return { prod: card({ flags: CardFlag.kaiden, s: 200 }) };
        return {};
      },
    };
    expect(kaidenEvidence(STORY, new Set([V.犬]), cards)).toEqual([`${V.おはよう}#prod`, `${V.パン}#rec`]);
    expect(kaidenEvidence(STORY, new Set(), cards)).toContain(`${V.犬}#rec`);
  });

  it('read-along rates: slow is the natural 0.85 whenever it is below the tier (unstretched), never above the tier; fast is the next tier (Dan above 5)', () => {
    expect(readAlongRates(1)).toEqual({ slow: 0.75, tier: 0.75, fast: 0.9 });
    expect(readAlongRates(2)).toEqual({ slow: NATURAL_SLOW_RATE, tier: 0.9, fast: 1 });
    expect(readAlongRates(3)).toEqual({ slow: NATURAL_SLOW_RATE, tier: 1, fast: 1.1 });
    expect(readAlongRates(4)).toEqual({ slow: NATURAL_SLOW_RATE, tier: 1.1, fast: 1.25 });
    expect(readAlongRates(5)).toEqual({ slow: NATURAL_SLOW_RATE, tier: 1.25, fast: 1.5 });
    // tier 1 has nothing slower than itself: no duplicate slow chip
    expect(rateChipsFor(readAlongRates(1))).toEqual(['tier', 'fast']);
    expect(rateChipsFor(readAlongRates(2))).toEqual(['slow', 'tier', 'fast']);
    expect(lineClipKey('s-04-1', 3)).toBe('s-04-1#L3');
  });

  it('naturalSlowServed needs the 0.85 take AND an unstretched request; listenSource reads capability before history', () => {
    const take = (rate: number): ClipCue => ({ key: 'k', file: 'f', start: 0, end: 1, voice: 'v', rate });
    expect(naturalSlowServed(take(0.85), 0.85)).toBe(true);
    expect(naturalSlowServed(take(0.85), 0.75)).toBe(false); // stretched from the natural take
    expect(naturalSlowServed(take(1), 0.85)).toBe(false); // stretched from the 1.0 take
    expect(naturalSlowServed(undefined, 0.85)).toBe(false);
    const voice: AudioService = { ...nullAudio, hasJaVoice: signal(true), source: signal<AudioSource>('none') };
    expect(listenSource(voice, take(1))).toBe('clips');
    expect(listenSource(voice, undefined)).toBe('synth');
    expect(listenSource({ ...nullAudio, source: signal<AudioSource>('none') }, undefined)).toBe('none');
    expect(listenSource(voice, take(1), 'synth')).toBe('synth'); // what was heard wins
  });

  it('tokenMoraSpans follows the token readings, punctuation owns no morae; activeTokenAt finds the span', () => {
    // 私はコーヒーを飲みます。 → わたし(3) は(1) コーヒー(4) を(1) のみます(4) 。(0)
    const spans = tokenMoraSpans(STORY.lines[3] as StoryItem['lines'][number]);
    expect(spans).toEqual([
      [0, 3],
      [3, 4],
      [4, 8],
      [8, 9],
      [9, 13],
      [13, 13],
    ]);
    expect(activeTokenAt(spans, 0)).toBe(0);
    expect(activeTokenAt(spans, 5)).toBe(2);
    expect(activeTokenAt(spans, 12)).toBe(4);
    expect(activeTokenAt(spans, 13)).toBe(-1);
  });

  it('gistQuestionIndex: the first gist question, else the first question, null without questions', () => {
    expect(gistQuestionIndex([])).toBeNull();
    expect(gistQuestionIndex(STORY.comprehension)).toBe(0);
    const qs = STORY.comprehension.map((qq, i) => (i === 1 ? { ...qq, kind: 'gist' as const } : { ...qq, kind: 'detail' as const }));
    expect(gistQuestionIndex(qs)).toBe(1);
  });

  it('markListened appends once and returns the same object when the id is there; formatHeard names the time', () => {
    const p0 = { listened: undefined as string[] | undefined };
    const p1 = markListened(p0, 's-04-1');
    expect(p1.listened).toEqual(['s-04-1']);
    expect(markListened(p1, 's-04-1')).toBe(p1);
    expect(markListened(p1, 's-04-2').listened).toEqual(['s-04-1', 's-04-2']);
    expect(formatHeard(0)).toBe(S.heardNone);
    expect(formatHeard(45.4)).toBe('45 s heard');
    expect(formatHeard(125)).toBe('2 min 5 s heard');
  });
});

describe('<StoryReaderView>', () => {
  it('renders the fixture story: title, chips, one line first, every line after "Show the rest"', async () => {
    await makeStore();
    mount();
    expect(q('.reader')?.getAttribute('data-mode')).toBe('read');
    expect(q('.reader__title')?.getAttribute('lang')).toBe('ja');
    expect(q('.reader__title')?.textContent).toContain('水');
    expect(q('.reader__title-en')?.textContent).toBe(STORY.titleEn);
    expect(q('[data-field="coverage"]')).not.toBeNull();
    expect(q('[data-field="source"]')).toBeNull(); // the status chip belongs to the Read-along
    expect(qa('li[data-line]').length).toBe(1);
    expect(q('[data-field="progress"]')?.textContent).toBe('Line 1 of 12');
    click(q('[data-action="next"]'));
    expect(qa('li[data-line]').length).toBe(2);
    expect(q('li[data-line="1"]')?.getAttribute('data-current')).toBe('true');
    revealAll();
    expect(qa('li[data-line]').length).toBe(STORY.lines.length);
    expect(q('[data-action="show-rest"]')).toBeNull();
    expect(q('[data-action="next"]')?.textContent).toBe(S.finishReading);
    // every line's Japanese carries lang="ja" and ruby
    expect(qa('li[data-line] .reader__ja[lang="ja"]').length).toBe(STORY.lines.length);
    expect(qa('li[data-line] .ruby__token').length).toBeGreaterThan(20);
  });

  it('tapping a token opens the Gloss with the item and counts a gloss tap', async () => {
    await makeStore();
    const onDone = mount();
    click(q('[data-action="next"]'));
    click(tokenEl(1, '私'));
    expect(q('[role="dialog"]')).not.toBeNull();
    expect(q('[data-field="meanings"]')?.textContent).toContain('I');
    expect(q('[data-field="reading"]')?.textContent).toBe('わたし');
    // unknown word (no cards) → Capture offered
    expect(q('[data-action="capture"]')).not.toBeNull();
    click(q('[data-action="close"]'));
    expect(q('[role="dialog"]')).toBeNull();
    expect(tokenEl(1, '私')?.getAttribute('data-tapped')).toBe('true');
    finishRead();
    expect(onDone.mock.calls[0]?.[0].glossTaps).toBe(1);
  });

  it('closing the gloss (Close or Escape) returns focus to the token that opened it', async () => {
    await makeStore();
    mount();
    click(q('[data-action="next"]'));
    const first = tokenEl(1, '私') as HTMLElement;
    first.focus();
    click(first);
    expect(q('[role="dialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(q('[data-action="close"]'));
    click(q('[data-action="close"]'));
    expect(q('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(first);
    // a second token, opened after the first closed, is the new opener
    const line = STORY.lines[1] as StoryItem['lines'][number];
    const otherIdx = line.tokens.findIndex((t, i) => i !== line.tokens.indexOf('私') && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(t));
    const second = q(`li[data-line="1"] .ruby__token[data-token="${otherIdx}"]`) as HTMLElement;
    second.focus();
    click(second);
    const dialog = q('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(q('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(second);
  });

  it('punctuation tokens never open a gloss', async () => {
    await makeStore();
    mount();
    click(tokenEl(0, '。'));
    expect(q('[role="dialog"]')).toBeNull();
  });

  it('finishing emits story:read with cpm > 0, chars, correct/total and calls onDone once — and never listen:played', async () => {
    await makeStore();
    const cap = captureEvents();
    const onDone = mount();
    clock += 120_000; // two minutes of reading
    finishRead([1]);
    cap.stop();
    const ev = cap.events.find(([n]) => n === 'story:read');
    expect(ev).toBeDefined();
    const p = ev?.[1] as { storyId: string; mode: string; chars: number; cpm: number; correct: number; total: number; glossTaps: number; minutes: number; bridge: boolean };
    expect(p.storyId).toBe(FIXTURE_STORY_ID);
    expect(p.mode).toBe('read');
    expect(p.chars).toBeGreaterThan(50);
    expect(p.cpm).toBeGreaterThan(0);
    expect(p.cpm).toBe(Math.round((p.chars / 120_000) * 60_000));
    expect(p.correct).toBe(2);
    expect(p.total).toBe(3);
    expect(p.glossTaps).toBe(0);
    expect(p.minutes).toBe(2);
    expect(p.bridge).toBe(false);
    expect(cap.events.some(([n]) => n === 'listen:played')).toBe(false);
    expect(store.progress.value.listened ?? []).toEqual([]);
    expect(onDone).toHaveBeenCalledTimes(1);
    const r = onDone.mock.calls[0]?.[0] as StoryReadResult;
    expect(r.passed).toBe(true);
    expect(r.ledgerLogged).toBe(false); // no reducers in this store
    expect(r.dictionaryFree).toBe(false); // the fixture is short
    expect(r.missing).toBe(false);
  });

  it('with B reducers wired the minutes land in the ledger exactly once (ledgerLogged)', async () => {
    await makeStore({ reducers: true });
    const onDone = mount();
    clock += 180_000;
    finishRead();
    const r = onDone.mock.calls[0]?.[0] as StoryReadResult;
    expect(r.ledgerLogged).toBe(true);
    expect(store.ledger.value.entries.length).toBe(1);
    expect(store.ledger.value.entries[0]?.[1]).toBe(3);
  });

  it('under 2/3 is not passed and carries no Kaiden evidence', async () => {
    await makeStore({ cards: { [`${V.パン}#rec`]: card({ flags: CardFlag.kaiden, s: 200, state: 2, due: 10_000 }) } });
    const onDone = mount();
    finishRead([0, 1]);
    const r = onDone.mock.calls[0]?.[0] as StoryReadResult;
    expect(r.correct).toBe(1);
    expect(r.passed).toBe(false);
    expect(r.kaidenConfirmed).toEqual([]);
  });

  it('Kaiden words read without a tap log an implicit Good on pass; a tapped one does not', async () => {
    const today = store.today();
    await makeStore({
      cards: {
        [`${V.パン}#rec`]: card({ flags: CardFlag.kaiden, s: 200, state: 2, due: 50_000, last: 1 }),
        [`${V.犬}#rec`]: card({ flags: CardFlag.kaiden, s: 200, state: 2, due: 50_000, last: 1 }),
      },
    });
    const before = store.log.recent(10).length;
    const onDone = mount();
    revealAll();
    click(tokenEl(7, '犬'));
    click(q('[data-action="close"]'));
    click(q('[data-action="next"]'));
    answerAll();
    const r = onDone.mock.calls[0]?.[0] as StoryReadResult;
    expect(r.kaidenConfirmed).toEqual([`${V.パン}#rec`]);
    const rows = store.log.recent(10).slice(0, store.log.recent(10).length - before);
    expect(rows.some((e) => e[1] === `${V.パン}#rec` && e[2] === 3)).toBe(true);
    expect(rows.some((e) => e[1] === `${V.犬}#rec`)).toBe(false);
    expect(store.today()).toBeGreaterThanOrEqual(today - 1);
  });

  it('a gloss tap on an introduced word due today grades Hard only on a re-read', async () => {
    const setup = async (): Promise<void> => {
      await makeStore();
      const today = store.today();
      store.cards.set(`${V.私}#rec`, card({ s: 5, d: 5, reps: 4, state: 2, due: today, last: today - 5 }));
    };
    await setup();
    mount({ firstRead: true });
    click(q('[data-action="next"]'));
    click(tokenEl(1, '私'));
    expect(q('[data-field="in-training"]')).not.toBeNull();
    expect(q('[data-action="capture"]')).toBeNull();
    expect(store.log.forCard(`${V.私}#rec`).length).toBe(0);
    render(null, root);

    await setup();
    mount({ firstRead: false });
    click(q('[data-action="next"]'));
    click(tokenEl(1, '私'));
    const rows = store.log.forCard(`${V.私}#rec`);
    expect(rows.length).toBe(1);
    expect(rows[0]?.[2]).toBe(2);
  });

  it('without a firstRead prop the reader derives it from progress.storiesRead (store #7 part F / F #22)', async () => {
    const setup = async (read: boolean): Promise<void> => {
      await makeStore({ save: { progress: { station: 4, storiesRead: read ? [FIXTURE_STORY_ID] : [] } } });
      const today = store.today();
      store.cards.set(`${V.私}#rec`, card({ s: 5, d: 5, reps: 4, state: 2, due: today, last: today - 5 }));
    };
    // never read: lenient, the tap is not graded
    await setup(false);
    expect(isStoryRead(FIXTURE_STORY_ID)).toBe(false);
    mount();
    click(q('[data-action="next"]'));
    click(tokenEl(1, '私'));
    expect(store.log.forCard(`${V.私}#rec`).length).toBe(0);
    render(null, root);

    // recorded as read by B's story:read reducer: the same tap grades Hard
    await setup(true);
    expect(isStoryRead(FIXTURE_STORY_ID)).toBe(true);
    mount();
    click(q('[data-action="next"]'));
    click(tokenEl(1, '私'));
    const rows = store.log.forCard(`${V.私}#rec`);
    expect(rows.length).toBe(1);
    expect(rows[0]?.[2]).toBe(2);
    render(null, root);

    // the exercise-step path derives it the same way (no prop is passed)
    await setup(true);
    const onResult = vi.fn();
    const step = { id: 'st-1', block: 'input', exercise: 'story-read', itemId: FIXTURE_STORY_ID, cardKey: null, params: { storyId: FIXTURE_STORY_ID }, timed: false, isNew: false, stepTag: null, exposures: 0, estMs: 0 } as Step;
    act(() => render(<StoryReader step={step} item={null} feel="dojo" furigana="always" jj={false} speedTier={1} exposures={0} onResult={onResult} onHint={() => {}} onReplay={() => {}} requestJudge={() => Promise.resolve(true)} />, root));
    click(q('[data-action="next"]'));
    click(tokenEl(1, '私'));
    expect(store.log.forCard(`${V.私}#rec`).length).toBe(1);
  });

  it('a gloss tap on an introduced word not due today never grades', async () => {
    await makeStore();
    store.cards.set(`${V.私}#rec`, card({ s: 5, d: 5, reps: 4, state: 2, due: store.today() + 9, last: store.today() - 5 }));
    mount({ firstRead: false });
    click(q('[data-action="next"]'));
    click(tokenEl(1, '私'));
    expect(store.log.forCard(`${V.私}#rec`).length).toBe(0);
  });

  it('Capture on an unintroduced word writes store.captured once; Bookmark keeps a corpus-less token', async () => {
    await makeStore();
    mount();
    revealAll();
    click(tokenEl(8, '水'));
    click(q('[data-action="capture"]'));
    expect(store.captured.value).toEqual([V.水]);
    expect(q('[data-action="captured"]')).not.toBeNull();
    expect((q('[data-action="captured"]') as HTMLButtonElement).disabled).toBe(true);
    click(q('[data-action="close"]'));
    // the same word again shows Captured straight away
    click(tokenEl(10, '水'));
    expect(q('[data-action="captured"]')).not.toBeNull();
    click(q('[data-action="close"]'));
    // います has no item behind it
    click(tokenEl(2, 'います'));
    expect(q('[data-field="no-item"]')).not.toBeNull();
    click(q('[data-action="bookmark"]'));
    expect(store.bookmarks.value).toEqual(['います']);
    expect(q('[data-action="bookmarked"]')).not.toBeNull();
    expect(store.captured.value).toEqual([V.水]);
  });

  it('a grammar token (は → g-n5-002) before its station offers no Capture: it comes with its station Scroll, and store.captured stays empty', async () => {
    await makeStore();
    mount();
    expect(captureStateFor(G.は, 'は', false)).toBe('station');
    expect(captureStateFor('j-飲', '飲', false)).toBe('station');
    expect(captureStateFor(V.水, '水', false)).toBe('capture');
    expect(captureStateFor(G.は, 'は', true)).toBe('introduced');
    revealAll();
    click(tokenEl(1, 'は'));
    expect(q('[role="dialog"]')).not.toBeNull();
    expect(q('[data-action="capture"]')).toBeNull();
    expect(q('[data-action="bookmark"]')).toBeNull();
    expect(q('[data-field="station-scroll"]')?.textContent).toBe(S.stationScrollHint);
    expect(store.captured.value).toEqual([]);
  });

  it('unmounting cancels speech so a line never carries into the next step', async () => {
    await makeStore();
    const cancel = vi.fn();
    installServices({ audio: { ...nullAudio, speak: () => Promise.resolve(), cancel } });
    mount();
    click(q('li[data-line="0"] [data-action="listen"]'));
    expect(cancel).not.toHaveBeenCalled();
    act(() => render(null, root));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('Gloss reading for a kanji token the corpus lacks comes from the line ruby', async () => {
    await makeStore();
    mount();
    revealAll();
    click(tokenEl(9, '三人'));
    expect(q('[data-field="reading"]')?.textContent).toBe('さんにん');
  });

  it('fog reveals count as hints and report onHint', async () => {
    await makeStore({ cards: { 'j-私#read': card({ s: 10, state: 2 }) } });
    const onHint = vi.fn();
    const onDone = mount({ furigana: 'fog', onHint });
    click(q('[data-action="next"]'));
    const fogged = qa('li[data-line="1"] .ruby__seg--fog');
    expect(fogged.length).toBe(1);
    click(fogged[0]);
    expect(onHint).toHaveBeenCalledTimes(1);
    // the fog reveal did not open a gloss
    expect(q('[role="dialog"]')).toBeNull();
    finishRead();
    expect(onDone.mock.calls[0]?.[0].hints).toBe(1);
  });

  it('Listen speaks the plain line with its kana and the line clip key (design 08 §8)', async () => {
    await makeStore();
    mount();
    click(q('li[data-line="0"] [data-action="listen"]'));
    expect(spoken).toEqual([['おはよう。', { kana: 'おはよう。', clip: 's-04-1#L0' }]]);
  });

  it('dialogue speakers alternate voice slots and pass their speaker label for the cast voice', async () => {
    await makeStore();
    mount({ storyId: 's-04-2' });
    revealAll();
    click(q('li[data-line="0"] [data-action="listen"]'));
    click(q('li[data-line="1"] [data-action="listen"]'));
    expect(spoken[0]?.[1]).toMatchObject({ voice: 'a', speaker: 'ケン', clip: 's-04-2#L0' });
    expect(spoken[1]?.[1]).toMatchObject({ voice: 'b', speaker: 'ハナ', clip: 's-04-2#L1' });
    expect(q('li[data-line="0"] .reader__speaker')?.textContent).toBe('ケン');
  });

  it('English shows only for lines behind the current one, then for all once the questions open', async () => {
    await makeStore();
    mount();
    expect(q('[data-field="en"]')).toBeNull();
    click(q('[data-action="toggle-en"]'));
    expect(q('[data-action="toggle-en"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(qa('[data-field="en"]').length).toBe(0); // the current line stays Japanese
    click(q('[data-action="next"]'));
    expect(qa('[data-field="en"]').length).toBe(1);
    expect(q('li[data-line="0"] [data-field="en"]')?.textContent).toBe(STORY.lines[0]?.en);
    revealAll();
    expect(qa('[data-field="en"]').length).toBe(STORY.lines.length - 1);
    click(q('[data-action="next"]'));
    expect(qa('[data-field="en"]').length).toBe(STORY.lines.length);
    expect(q('.comp')).not.toBeNull();
  });

  it('marks i+1 lines and tokens', async () => {
    await makeStore();
    const plus: StoryItem = { ...STORY, id: 's-04-3', lines: STORY.lines.map((l, i) => (i === 3 ? { ...l, plusOne: [V.コーヒー] } : l)) };
    const fx = createFakeLoader({ ...FIXTURE, items: { ...FIXTURE.items, 's-04-3': plus } });
    mount({ storyId: 's-04-3', loader: fx });
    revealAll();
    expect(q('li[data-line="3"]')?.getAttribute('data-plus-one')).toBe('true');
    expect(q('li[data-line="3"] [data-field="plus-one"]')).not.toBeNull();
    expect(q('li[data-line="3"] .ruby__token[data-token="2"]')?.getAttribute('data-plus-one')).toBe('true');
    expect(q('li[data-line="3"] .ruby__token[data-token="0"]')?.getAttribute('data-plus-one')).toBeNull();
    expect(q('li[data-line="4"]')?.getAttribute('data-plus-one')).toBeNull();
  });

  it('vertical text toggle appears from Blue and patches settings.verticalText', async () => {
    await makeStore({ save: { progress: { station: 25 } } });
    mount({ station: 25 });
    const btn = q('[data-action="toggle-vertical"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    click(btn);
    expect(store.settings.value.verticalText).toBe(true);
    expect(q('.reader__lines')?.getAttribute('data-vertical')).toBe('true');
    expect(q('.reader__ja')?.classList.contains('ruby--vertical')).toBe(true);
    render(null, root);
    await makeStore();
    mount();
    expect(q('[data-action="toggle-vertical"]')).toBeNull();
  });

  it('bridge passages show the Native Bridge chip and emit bridge: true', async () => {
    await makeStore();
    const bridge: StoryItem = { ...STORY, id: 's-27-1', bridge: true };
    const fx = createFakeLoader({ ...FIXTURE, items: { ...FIXTURE.items, 's-27-1': bridge } });
    const cap = captureEvents();
    const onDone = mount({ storyId: 's-27-1', loader: fx });
    expect(q('[data-field="bridge"]')?.textContent).toBe(S.bridgeChip);
    finishRead();
    cap.stop();
    expect((cap.events.find(([n]) => n === 'story:read')?.[1] as { bridge: boolean }).bridge).toBe(true);
    expect(onDone.mock.calls[0]?.[0].bridge).toBe(true);
  });

  it('a missing episode shows a calm notice; Continue reports missing without emitting', async () => {
    await makeStore();
    const cap = captureEvents();
    const onDone = mount({ storyId: 's-09-9' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(q('[data-state="missing"]')).not.toBeNull();
    expect(root.textContent).toContain(S.storyMissing);
    click(q('[data-action="skip"]'));
    cap.stop();
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ missing: true, total: 0 }));
    expect(cap.events.some(([n]) => n === 'story:read')).toBe(false);
  });

  it('loads a story that is not in memory through getAsync', async () => {
    await makeStore();
    const lazy: ContentLoader = { ...loader, get: () => undefined };
    mount({ loader: lazy });
    expect(q('[data-state="loading"]')).not.toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    expect(q('.reader__title')).not.toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Read-along (design 08 §10.3)                                               */
/* ────────────────────────────────────────────────────────────────────────── */

interface FakePlay {
  cue: ClipCue;
  o: ClipPlayOptions;
  resolve(seconds: number): void;
  stop: ReturnType<typeof vi.fn>;
}

/**
 * A pack player double: every key has a cue (rate 0.85 at a slow request when
 * `naturalSlow`), `play()` resolves at once with `seconds` unless `manual`
 * (then the test resolves each play), `stop()` resolves the play with 0.5 s.
 */
function fakeClips(o: { seconds?: number; manual?: boolean; naturalSlow?: boolean; missing?: boolean; over?: Partial<AudioService> } = {}): { audio: AudioService; plays: FakePlay[]; cancel: ReturnType<typeof vi.fn> } {
  const plays: FakePlay[] = [];
  const cueFor = (key: string, w?: { rate?: number; speaker?: string }): ClipCue | undefined => ({
    key,
    file: 'sprites/s04/x.webm',
    start: 0,
    end: 2,
    voice: 'VOICEVOX:x',
    rate: o.naturalSlow && (w?.rate ?? 1) <= NATURAL_SLOW_RATE ? NATURAL_SLOW_RATE : 1,
  });
  const cue = o.missing ? (): ClipCue | undefined => undefined : cueFor;
  const clips: ClipPlayer = {
    ready: signal<ClipReady>('ready'),
    info: signal(null),
    loadLevel: () => Promise.resolve(),
    loadStation: () => Promise.resolve(),
    prefetchStation() {},
    cueFor: cue,
    cueForText: () => undefined,
    kanaTracks: () => Promise.resolve([]),
    play(cue, po) {
      let resolve!: (s: number) => void;
      const done = new Promise<{ source: 'clips' | 'none'; seconds: number }>((res) => {
        resolve = (s) => res({ source: 'clips', seconds: s });
      });
      const stop = vi.fn(() => resolve(0.5));
      plays.push({ cue, o: po, resolve, stop });
      if (!o.manual) {
        po.onProgress?.(0.4, 2, 0);
        resolve(o.seconds ?? 2.5);
      }
      return { done, stop };
    },
    unlock() {},
    dispose() {},
    cacheUsage: () => Promise.resolve({ bytes: 0, files: 0 }),
    download: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  };
  const cancel = vi.fn();
  const audio: AudioService = {
    ...nullAudio,
    hasJaVoice: signal(true),
    source: signal<AudioSource>('clips'),
    packReady: signal(true),
    clipFor: cue,
    clips,
    cancel,
    speak: (t, so) => {
      spoken.push([t, so]);
      return Promise.resolve();
    },
    ...o.over,
  };
  return { audio, plays, cancel };
}

/** A device-voice double: audible, no pack; every utterance takes two seconds of the store clock. */
function synthAudio(): AudioService {
  return {
    ...nullAudio,
    hasJaVoice: signal(true),
    speak: (t, so) => {
      spoken.push([t, so]);
      clock += 2000;
      return Promise.resolve();
    },
  };
}

/** Lets a chain of instantly-resolving plays run to the end (one macrotask drains every microtask). */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('<StoryReaderView mode="listen"> (Read-along, design 08 §10.3)', () => {
  function mountListen(over: Partial<StoryListenProps> = {}): ReturnType<typeof vi.fn<(r: StoryListenResult) => void>> {
    const onDone = vi.fn<(r: StoryListenResult) => void>();
    act(() => render(<StoryReaderView mode="listen" storyId={FIXTURE_STORY_ID} loader={loader} furigana="always" onDone={onDone} {...over} />, root));
    return onDone;
  }
  const phase = (): string | null => q('.reader')?.getAttribute('data-listen-phase') ?? null;

  it('plays line 0 then 1 (then every line) with the clip keys through the pack player, revealing as it goes', async () => {
    const { audio, plays } = fakeClips({ seconds: 2.5 });
    installServices({ audio });
    await makeStore();
    mountListen();
    expect(q('.reader')?.getAttribute('data-mode')).toBe('listen');
    expect(q('[data-field="mode"]')?.textContent).toContain(S.listenTitle);
    expect(q('[data-field="mode"] [lang="ja"]')?.textContent).toBe(S.listenTitleJa);
    expect(q('[data-field="source"]')?.textContent).toBe('synthetic voice (VOICEVOX)');
    expect(phase()).toBe('ready');
    expect(qa('li[data-line]').length).toBe(1);
    expect(q('[data-action="next"]')).toBeNull(); // no reading controls in listen mode
    click(q('[data-action="start"]'));
    await settle();
    expect(plays.slice(0, 2).map((p) => p.cue.key)).toEqual(['s-04-1#L0', 's-04-1#L1']);
    expect(plays.map((p) => p.cue.key)).toEqual(STORY.lines.map((_, i) => `s-04-1#L${i}`));
    expect(plays[0]?.o.rate).toBe(SPEED_TIER_RATES[store.settings.value.speedTier]);
    expect(plays[0]?.o.volume).toBe(store.settings.value.sound);
    expect(qa('li[data-line]').length).toBe(STORY.lines.length);
    expect(phase()).toBe('ended');
    expect(q('[data-action="to-questions"]')).not.toBeNull();
    expect(q('[data-action="finish-listen"]')).not.toBeNull();
    expect(spoken).toEqual([]); // the pack served every line; speak() was never needed
  });

  it('on the device voice every speakLine passes clip and speaker (dialogue: cast label + a/b slot)', async () => {
    installServices({ audio: synthAudio() });
    await makeStore();
    mountListen({ storyId: FIXTURE_DIALOGUE_ID });
    expect(q('[data-field="source"]')?.textContent).toBe('device voice');
    click(q('[data-action="start"]'));
    await settle();
    expect(spoken.length).toBe(DIALOGUE.lines.length);
    expect(spoken[0]?.[1]).toMatchObject({ clip: 's-04-2#L0', speaker: 'ケン', voice: 'a', interrupt: true });
    expect(spoken[1]?.[1]).toMatchObject({ clip: 's-04-2#L1', speaker: 'ハナ', voice: 'b' });
    expect(spoken.every(([, o], i) => (o as { clip: string }).clip === `s-04-2#L${i}`)).toBe(true);
    expect(phase()).toBe('ended');
  });

  it('a gloss tap mid-line does not cancel the audio; the player waits at the line boundary while the gloss is open', async () => {
    const { audio, plays, cancel } = fakeClips({ manual: true });
    installServices({ audio });
    await makeStore();
    mountListen();
    click(q('[data-action="start"]'));
    await settle();
    expect(plays.length).toBe(1);
    expect(phase()).toBe('playing');
    expect(q('li[data-line="0"]')?.getAttribute('data-speaking')).toBe('true');
    const cancels = cancel.mock.calls.length; // the player clears its queue once per line start
    click(tokenEl(0, 'おはよう'));
    expect(q('[role="dialog"]')).not.toBeNull();
    expect(cancel.mock.calls.length).toBe(cancels);
    expect(plays[0]?.stop).not.toHaveBeenCalled();
    // the line ends while the gloss is open: nothing advances
    act(() => plays[0]?.resolve(2));
    await settle();
    expect(plays.length).toBe(1);
    expect(phase()).toBe('held');
    expect(q('[data-field="held"]')?.textContent).toBe(S.listenHeld);
    expect(qa('li[data-line]').length).toBe(1);
    // closing the gloss resumes with the next line
    click(q('[data-action="close"]'));
    await settle();
    expect(plays.length).toBe(2);
    expect(plays[1]?.cue.key).toBe('s-04-1#L1');
    expect(phase()).toBe('playing');
    expect(qa('li[data-line]').length).toBe(2);
  });

  it('the karaoke sweep marks the active token from onProgress and clears at the line end', async () => {
    const { audio, plays } = fakeClips({ manual: true });
    installServices({ audio });
    await makeStore();
    mountListen();
    click(q('[data-action="start"]'));
    await settle();
    act(() => plays[0]?.o.onProgress?.(0.3, 2, 0));
    expect(q('li[data-line="0"] .ruby__token[data-token="0"]')?.getAttribute('data-sweep')).toBe('active');
    expect(q('li[data-line="0"] .ruby__token[data-token="1"]')?.getAttribute('data-sweep')).toBe('ahead');
    act(() => plays[0]?.o.onProgress?.(1.2, 4, 0));
    expect(q('li[data-line="0"] .ruby__token[data-token="0"]')?.getAttribute('data-sweep')).toBe('past');
    expect(q('li[data-line="0"] .ruby__token[data-token="1"]')?.getAttribute('data-sweep')).toBe('past');
    act(() => plays[0]?.resolve(2));
    await settle();
    expect(qa('li[data-line="0"] .ruby__token[data-sweep]').length).toBe(0);
  });

  it("chips show 'slow (natural)' only when the pack serves the 0.85 take unstretched, 'slow' otherwise; every chip names its take; tier 1 has no slow chip", async () => {
    const { audio } = fakeClips({ naturalSlow: true });
    installServices({ audio });
    await makeStore();
    mountListen();
    const chip = (c: string): HTMLElement | null => q(`[data-rate-chip="${c}"]`);
    expect(chip('slow')?.textContent).toBe(`${S.rateSlowNatural}0.85×`);
    expect(chip('slow')?.getAttribute('title')).toBe(S.rateSlowNaturalHint);
    expect(chip('slow')?.getAttribute('data-rate')).toBe('0.85'); // tier 2: the natural take, requested at its own rate — nothing stretched
    expect(chip('slow')?.getAttribute('data-cue-rate')).toBe('0.85');
    expect(chip('tier')?.textContent).toBe(`${S.rateTier}0.9×`);
    expect(chip('tier')?.getAttribute('data-cue-rate')).toBe('1'); // the 1.0 take, stretched to 0.9: the hint says so
    expect(chip('tier')?.getAttribute('title')).toBe('Played at 0.9× from the 1× take; the pitch stays where it was.');
    expect(chip('fast')?.textContent).toBe(`${S.rateFast}1×`);
    expect(chip('fast')?.getAttribute('title')).toBeNull(); // served at its own rate
    expect(chip('tier')?.getAttribute('aria-pressed')).toBe('true');
    render(null, root);

    // the pack has only the 1.0 take: slow is stretched from it, says only "slow", and names the take
    installServices({ audio: fakeClips().audio });
    mountListen();
    expect(chip('slow')?.textContent).toBe(`${S.rateSlow}0.85×`);
    expect(chip('slow')?.textContent).not.toContain('natural');
    expect(chip('slow')?.getAttribute('title')).toBe('Played at 0.85× from the 1× take; the pitch stays where it was.');
    render(null, root);

    // no pack at all (device voice): plain "slow", the voice slows down
    installServices({ audio: synthAudio() });
    mountListen();
    expect(chip('slow')?.textContent).toBe(`${S.rateSlow}0.85×`);
    expect(chip('slow')?.getAttribute('title')).toBe(S.rateSlowHint);
    expect(chip('slow')?.getAttribute('data-cue-rate')).toBeNull();
    render(null, root);

    // the device voice forced in Settings: the pack's take is not served, so the chip never claims it
    installServices({ audio: fakeClips({ naturalSlow: true }).audio });
    await makeStore({ save: { progress: { station: 4 }, settings: { audioSource: 'device' } } });
    mountListen();
    expect(chip('slow')?.textContent).toBe(`${S.rateSlow}0.85×`);
    expect(chip('slow')?.getAttribute('title')).toBe(S.rateSlowHint);
    expect(q('[data-field="source"]')?.textContent).toBe('device voice');
    render(null, root);

    // tier 1 (0.75): nothing is slower than the tier, so only my tier and fast are offered and [ has nowhere to go
    installServices({ audio: fakeClips({ naturalSlow: true }).audio });
    await makeStore({ save: { progress: { station: 4 }, settings: { speedTier: 1 } } });
    mountListen();
    expect(chip('slow')).toBeNull();
    expect(qa('[data-rate-chip]').map((b) => b.getAttribute('data-rate-chip'))).toEqual(['tier', 'fast']);
    expect(chip('tier')?.textContent).toBe(`${S.rateTier}0.75×`);
    press('[');
    expect(chip('tier')?.getAttribute('aria-pressed')).toBe('true');
    press(']');
    expect(chip('fast')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('the honesty chip names what the next line would use, not what speak() last did: a ready pack reads synthetic before Start, then follows what was heard', async () => {
    // a web-like service: the `source` signal starts at 'none' (speak() writes it, and the pack path never calls speak())
    installServices({ audio: fakeClips({ over: { hasJaVoice: signal(false), canSpeak: signal(true), source: signal<AudioSource>('none') } }).audio });
    await makeStore();
    mountListen();
    expect(q('[data-field="source"]')?.textContent).toBe('synthetic voice (VOICEVOX)');
    expect(q('[data-field="source"]')?.getAttribute('data-source')).toBe('clips');
    expect(q('[data-field="text-only"]')).toBeNull();
    render(null, root);

    // a device voice and no pack, nothing spoken yet
    installServices({ audio: { ...nullAudio, hasJaVoice: signal(true), source: signal<AudioSource>('none') } });
    mountListen();
    expect(q('[data-field="source"]')?.textContent).toBe('device voice');
    expect(q('[data-field="text-only"]')).toBeNull();
    render(null, root);

    // no voice, no pack: text only, said up front
    installServices({ audio: { ...nullAudio, source: signal<AudioSource>('none') } });
    mountListen();
    expect(q('[data-field="source"]')?.textContent).toBe('text only');
    expect(q('[data-field="text-only"]')?.textContent).toBe(S.listenTextOnly);
    render(null, root);

    // the pack is ready but has no cue for this text: the lines fall to the device voice, and the chip follows what was heard
    const src = signal<AudioSource>('none');
    const speakSynth: AudioService['speak'] = (t, so) => {
      spoken.push([t, so]);
      src.value = 'synth';
      clock += 2000;
      return Promise.resolve();
    };
    installServices({ audio: fakeClips({ missing: true, over: { source: src, speak: speakSynth } }).audio });
    mountListen();
    expect(q('[data-field="source"]')?.textContent).toBe('device voice');
    click(q('[data-action="start"]'));
    await settle();
    expect(spoken.length).toBe(STORY.lines.length);
    expect(phase()).toBe('ended');
    expect(q('[data-field="source"]')?.textContent).toBe('device voice');
  });

  it('Enter opens the self-check once the text has ended (the button advertises it); earlier it does nothing', async () => {
    installServices({ audio: fakeClips({ seconds: 1 }).audio });
    await makeStore();
    mountListen();
    press('Enter');
    expect(phase()).toBe('ready');
    expect(q('.reader')?.getAttribute('data-state')).toBe('reading');
    click(q('[data-action="start"]'));
    await settle();
    expect(phase()).toBe('ended');
    expect(q('[data-action="to-questions"]')?.getAttribute('aria-keyshortcuts')).toBe('Enter');
    press('Enter');
    expect(q('.reader')?.getAttribute('data-state')).toBe('questions');
  });

  it('choosing a chip while playing restarts the line at that rate; a learner at tier 3 gets the natural 0.85 slow', async () => {
    const { audio, plays } = fakeClips({ manual: true });
    installServices({ audio });
    await makeStore({ save: { progress: { station: 4 }, settings: { speedTier: 3 } } });
    mountListen();
    expect(q('[data-rate-chip="slow"]')?.getAttribute('data-rate')).toBe(String(NATURAL_SLOW_RATE));
    click(q('[data-action="start"]'));
    await settle();
    expect(plays[0]?.o.rate).toBe(1);
    click(q('[data-rate-chip="fast"]'));
    await settle();
    expect(plays[0]?.stop).toHaveBeenCalledTimes(1);
    expect(plays.length).toBe(2);
    expect(plays[1]?.cue.key).toBe('s-04-1#L0');
    expect(plays[1]?.o.rate).toBe(1.1);
    expect(q('[data-rate-chip="fast"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('listen:played is emitted once with source readalong and the summed seconds; story:read is never emitted and storiesRead is untouched', async () => {
    const { audio } = fakeClips({ seconds: 2.5 });
    installServices({ audio });
    await makeStore();
    const cap = captureEvents();
    const onDone = mountListen();
    click(q('[data-action="start"]'));
    await settle();
    click(q('[data-action="to-questions"]'));
    expect(root.textContent).toContain(S.listenQuestionsHint);
    answerAll();
    cap.stop();
    const played = cap.events.filter(([n]) => n === 'listen:played');
    expect(played).toHaveLength(1);
    expect(played[0]?.[1]).toEqual({ source: 'readalong', refs: [FIXTURE_STORY_ID], seconds: 30, rate: 0.9, cold: true, authentic: false, gistCorrect: true });
    expect(cap.events.some(([n]) => n === 'story:read')).toBe(false);
    expect(store.progress.value.storiesRead ?? []).toEqual([]);
    expect(store.progress.value.listened).toEqual([FIXTURE_STORY_ID]);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0]?.[0]).toMatchObject({ storyId: FIXTURE_STORY_ID, seconds: 30, rate: 0.9, cold: true, authentic: false, gistCorrect: true, correct: 3, total: 3, answered: true, heard: true, source: 'clips', missing: false });
    expect('ledgerLogged' in (onDone.mock.calls[0]?.[0] as object)).toBe(false); // the listen row is the reducer's alone; no host fallback signal
  });

  it('skipping the questions reports gistCorrect null; a text already in progress.listened is not cold', async () => {
    const { audio } = fakeClips({ seconds: 1 });
    installServices({ audio });
    await makeStore({ save: { progress: { station: 4, listened: [FIXTURE_STORY_ID] } } });
    const cap = captureEvents();
    const onDone = mountListen();
    click(q('[data-action="start"]'));
    await settle();
    click(q('[data-action="finish-listen"]'));
    cap.stop();
    const played = cap.events.filter(([n]) => n === 'listen:played');
    expect(played).toHaveLength(1);
    expect(played[0]?.[1]).toMatchObject({ source: 'readalong', seconds: 12, cold: false, gistCorrect: null, authentic: false });
    expect(onDone.mock.calls[0]?.[0]).toMatchObject({ answered: false, gistCorrect: null, cold: false });
    expect(store.progress.value.listened).toEqual([FIXTURE_STORY_ID]); // appended once, never twice
  });

  it('authentic = an authentic-style text at ≥ 1.0× with the gist question right; the slow chip loses it', async () => {
    // a casual dialogue is authentic-style (isAuthenticText); tier 2's "fast" chip is 1.0×
    const casual: StoryItem = { ...DIALOGUE, id: 's-10-2', register: 'casual' };
    const fx = createFakeLoader({ ...FIXTURE, items: { ...FIXTURE.items, 's-10-2': casual } });
    installServices({ audio: fakeClips({ seconds: 2 }).audio });
    await makeStore();
    let cap = captureEvents();
    mountListen({ storyId: 's-10-2', loader: fx });
    click(q('[data-rate-chip="fast"]'));
    click(q('[data-action="start"]'));
    await settle();
    click(q('[data-action="to-questions"]'));
    answerAll([], casual);
    cap.stop();
    expect(cap.events.find(([n]) => n === 'listen:played')?.[1]).toMatchObject({ rate: 1, authentic: true, gistCorrect: true });
    render(null, root);

    await makeStore();
    cap = captureEvents();
    mountListen({ storyId: 's-10-2', loader: fx });
    click(q('[data-rate-chip="slow"]'));
    click(q('[data-action="start"]'));
    await settle();
    click(q('[data-action="to-questions"]'));
    answerAll([], casual);
    cap.stop();
    expect(cap.events.find(([n]) => n === 'listen:played')?.[1]).toMatchObject({ rate: NATURAL_SLOW_RATE, authentic: false, gistCorrect: true });
    render(null, root);

    // the gist question wrong: understood is part of authentic
    await makeStore();
    cap = captureEvents();
    mountListen({ storyId: 's-10-2', loader: fx });
    click(q('[data-rate-chip="fast"]'));
    click(q('[data-action="start"]'));
    await settle();
    click(q('[data-action="to-questions"]'));
    answerAll([0], casual);
    cap.stop();
    expect(cap.events.find(([n]) => n === 'listen:played')?.[1]).toMatchObject({ rate: 1, authentic: false, gistCorrect: false });
  });

  it('with B reducers wired a Read-along grants no XP, no episode read, no read-episode quest tick, no reading badge and no read ledger row', async () => {
    installServices({ audio: fakeClips({ seconds: 10 }).audio }); // 12 lines → 120 s
    await makeStore({ reducers: true });
    const xp = store.profile.value.xp;
    const badgesBefore = Object.keys(store.collections.value.badges);
    const onDone = mountListen();
    click(q('[data-action="start"]'));
    await settle();
    click(q('[data-action="finish-listen"]'));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(store.profile.value.xp).toBe(xp);
    expect(store.stats.value.episodesRead).toBe(0);
    expect(store.progress.value.storiesRead ?? []).toEqual([]);
    expect(store.quests.value.done).not.toContain('read-episode');
    // whatever B's listening reducer logged is a listen row from the app, never a read
    for (const row of store.ledger.value.entries) {
      expect(row[2]).toBe(0);
      expect(row[3]).toBe(0);
    }
    expect(store.progress.value.listened).toEqual([FIXTURE_STORY_ID]);
    // no reading badge lights: whatever B's listening badges did, the story:read-keyed ones stay dark
    const badges = store.collections.value.badges;
    expect(badges.bookworm).toBeUndefined();
    expect(badges['dictionary-free']).toBeUndefined();
    expect(badges['speed-reader']).toBeUndefined();
    expect(Object.keys(badges).filter((b) => !badgesBefore.includes(b)).every((b) => b === 'first-hearing')).toBe(true);
  });

  it('the device voice counts wall-clock seconds; mode read still emits story:read as today', async () => {
    installServices({ audio: synthAudio() });
    await makeStore();
    const cap = captureEvents();
    mountListen();
    click(q('[data-action="start"]'));
    await settle();
    click(q('[data-action="finish-listen"]'));
    cap.stop();
    expect(cap.events.filter(([n]) => n === 'listen:played')).toHaveLength(1);
    expect(cap.events.find(([n]) => n === 'listen:played')?.[1]).toMatchObject({ seconds: 24, rate: 0.9 });
    expect(cap.events.some(([n]) => n === 'story:read')).toBe(false);
  });

  it('Space pauses and resumes (the stopped line still counts its played seconds), L loops the line, arrows move', async () => {
    const { audio, plays } = fakeClips({ manual: true });
    installServices({ audio });
    await makeStore();
    mountListen();
    press(' '); // Space starts
    await settle();
    expect(phase()).toBe('playing');
    expect(plays.length).toBe(1);
    press('l');
    expect(q('[data-action="loop"]')?.getAttribute('aria-pressed')).toBe('true');
    act(() => plays[0]?.resolve(2));
    await settle();
    expect(plays.length).toBe(2);
    expect(plays[1]?.cue.key).toBe('s-04-1#L0'); // looped
    press('L');
    expect(q('[data-action="loop"]')?.getAttribute('aria-pressed')).toBe('false');
    press(' ');
    await settle();
    expect(phase()).toBe('paused');
    expect(plays[1]?.stop).toHaveBeenCalledTimes(1);
    expect(q('[data-action="resume"]')?.textContent).toBe(S.listenResume);
    press(' ');
    await settle();
    expect(phase()).toBe('playing');
    expect(plays.length).toBe(3);
    expect(plays[2]?.cue.key).toBe('s-04-1#L0');
    press('ArrowRight');
    await settle();
    expect(plays[3]?.cue.key).toBe('s-04-1#L1');
    expect(q('[data-field="progress"]')?.textContent).toBe('Line 2 of 12');
    press('ArrowLeft');
    await settle();
    expect(plays[4]?.cue.key).toBe('s-04-1#L0');
    // "Play from here" on a revealed line jumps there too
    click(q('li[data-line="1"] [data-action="listen"]'));
    await settle();
    expect(plays[5]?.cue.key).toBe('s-04-1#L1');
  });

  it('text only: the chip says so, lines advance by tap, and nothing is emitted or marked as heard', async () => {
    await makeStore(); // the default double: no Japanese voice, no pack
    const cap = captureEvents();
    const onDone = mountListen();
    expect(q('[data-field="source"]')?.textContent).toBe('text only');
    expect(q('[data-field="text-only"]')?.textContent).toBe(S.listenTextOnly);
    click(q('[data-action="start"]'));
    await settle();
    expect(phase()).toBe('paused');
    expect(q('[data-action="resume"]')?.textContent).toBe(S.nextLine);
    for (let i = 1; i < STORY.lines.length; i++) {
      click(q('[data-action="resume"]'));
      await settle();
    }
    expect(qa('li[data-line]').length).toBe(STORY.lines.length);
    click(q('[data-action="resume"]'));
    await settle();
    expect(phase()).toBe('ended');
    click(q('[data-action="finish-listen"]'));
    cap.stop();
    expect(cap.events.some(([n]) => n === 'listen:played')).toBe(false);
    expect(cap.events.some(([n]) => n === 'story:read')).toBe(false);
    expect(store.progress.value.listened ?? []).toEqual([]);
    expect(onDone.mock.calls[0]?.[0]).toMatchObject({ heard: false, seconds: 0, source: 'none', gistCorrect: null });
  });

  it('a missing text reports missing through the listen result without emitting', async () => {
    await makeStore();
    const cap = captureEvents();
    const onDone = mountListen({ storyId: 's-09-9' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(q('[data-state="missing"]')?.getAttribute('data-mode')).toBe('listen');
    click(q('[data-action="skip"]'));
    cap.stop();
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ missing: true, heard: false, seconds: 0 }));
    expect(cap.events.length).toBe(0);
  });

  it('unmounting mid-line stops the pack player and cancels the voice', async () => {
    const { audio, plays, cancel } = fakeClips({ manual: true });
    installServices({ audio });
    await makeStore();
    mountListen();
    click(q('[data-action="start"]'));
    await settle();
    act(() => render(null, root));
    expect(plays[0]?.stop).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
  });
});

describe('<StoryReader> as the story-read exercise', () => {
  function step(over: Partial<Step> = {}): Step {
    return { id: 'st-1', block: 'input', exercise: 'story-read', itemId: FIXTURE_STORY_ID, cardKey: null, params: { storyId: FIXTURE_STORY_ID }, timed: false, isNew: false, stepTag: null, exposures: 0, estMs: 300_000, ...over };
  }
  function props(over: Partial<ExerciseProps> = {}): ExerciseProps {
    return { step: step(), item: STORY, feel: 'dojo', furigana: 'always', jj: false, speedTier: 3, exposures: 0, onResult: vi.fn(), onHint: vi.fn(), onReplay: vi.fn(), requestJudge: () => Promise.resolve(true), ...over };
  }

  it('reads params.storyId through the live loader and reports onResult after the questions', async () => {
    await makeStore();
    const pr = props();
    act(() => render(<StoryReader {...pr} />, root));
    expect(q('.reader__title')).not.toBeNull();
    clock += 60_000;
    finishRead();
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    expect(pr.onResult).toHaveBeenCalledWith(expect.objectContaining({ correct: true, score: 1, hintUsed: false, guard: false, timedOut: false, ms: 60_000, errorTags: [] }));
  });

  it('under 2/3 reports correct: false; fog reveals forward onHint and hintUsed', async () => {
    await makeStore({ cards: { 'j-私#read': card({ s: 10, state: 2 }) } });
    const pr = props({ furigana: 'fog' });
    act(() => render(<StoryReader {...pr} />, root));
    click(q('[data-action="next"]'));
    click(qa('li[data-line="1"] .ruby__seg--fog')[0]);
    expect(pr.onHint).toHaveBeenCalledTimes(1);
    finishRead([0, 2]);
    expect(pr.onResult).toHaveBeenCalledWith(expect.objectContaining({ correct: false, hintUsed: true }));
  });

  it('falls back to step.itemId when params carry no storyId', async () => {
    await makeStore();
    const pr = props({ step: step({ params: {} }) });
    act(() => render(<StoryReader {...pr} />, root));
    expect(q('.reader__title-en')?.textContent).toBe(STORY.titleEn);
  });

  describe('inside the frame (contract #32: the hint key)', () => {
    function inFrame(pr: ExerciseProps, child: preact.ComponentChild) {
      const s = pr.step;
      return (
        <ExerciseFrame step={s} index={0} total={5} ki={10} combo={0} comboTier={0} timer={null} feel="dojo" feedback={null} now={() => clock} onGuard={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
          {child}
        </ExerciseFrame>
      );
    }

    it("the frame's ? key turns English on once a line is behind you; the first reveal is a hint, later toggles are free", async () => {
      await makeStore();
      const pr = props();
      act(() => render(inFrame(pr, <StoryReader {...pr} />), root));
      // nothing behind you yet: no English to reveal, no Hint button
      expect(q('.exercise-frame__hint')).toBeNull();
      press('?');
      expect(pr.onHint).not.toHaveBeenCalled();
      click(q('[data-action="next"]'));
      expect(q('.exercise-frame__hint')).not.toBeNull();
      press('?');
      expect(pr.onHint).toHaveBeenCalledTimes(1);
      expect(q('[data-action="toggle-en"]')?.getAttribute('aria-pressed')).toBe('true');
      expect(q('li[data-line="0"] [data-field="en"]')?.textContent).toBe(STORY.lines[0]!.en);
      // used: the Hint button goes away and ? is inert
      expect(q('.exercise-frame__hint')).toBeNull();
      press('?');
      expect(pr.onHint).toHaveBeenCalledTimes(1);
      // off and on again through the toolbar is not a second hint
      click(q('[data-action="toggle-en"]'));
      expect(q('.exercise-frame__hint')).not.toBeNull();
      click(q('[data-action="toggle-en"]'));
      expect(pr.onHint).toHaveBeenCalledTimes(1);
      // Enter still belongs to the reading keys (the hint-only set never shadows them)
      press('Enter');
      expect(q('[data-field="progress"]')?.textContent).toContain('3');
      finishRead();
      expect(pr.onResult).toHaveBeenCalledWith(expect.objectContaining({ hintUsed: true }));
    });

    it("the frame's Hint button is the same reveal; standalone, the English toggle stays free and offers no frame hint", async () => {
      await makeStore();
      const pr = props();
      act(() => render(inFrame(pr, <StoryReader {...pr} />), root));
      click(q('[data-action="next"]'));
      click(q('.exercise-frame__hint'));
      expect(pr.onHint).toHaveBeenCalledTimes(1);
      expect(q('li[data-line="0"] [data-field="en"]')).not.toBeNull();

      render(null, root);
      const onHint = vi.fn();
      const onDone = vi.fn<(r: StoryReadResult) => void>();
      act(() => render(inFrame(pr, <StoryReaderView storyId={FIXTURE_STORY_ID} loader={loader} furigana="always" onDone={onDone} onHint={onHint} />), root));
      click(q('[data-action="next"]'));
      expect(q('.exercise-frame__hint')).toBeNull();
      click(q('[data-action="toggle-en"]'));
      expect(q('li[data-line="0"] [data-field="en"]')).not.toBeNull();
      expect(onHint).not.toHaveBeenCalled();
    });
  });
});
