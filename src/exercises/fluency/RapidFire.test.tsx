import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, G, V, createFakeLoader } from '@/content/fixtures';
import type { ContentLoader } from '@/content/loader';
import type { CardKey } from '@/content/types';
import { bus } from '@/shared/events';
import type { AttemptResult, Step } from '@/shared/session-types';
import { CardFlag, hasFlag, type CardTuple } from '@/shared/store-types';
import { dayOf } from '@/shared/time';
import { store } from '@/store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore } from '@/store/testing';
import { RapidFire, ROUND_MS, meta, promptFor } from './RapidFire';
import { S as RS, fill as rfill } from './rapid-strings';

// `content` is a singleton; route its reads to the fixture loader (the actual
// module keeps ContentError / isChunk for the fixtures' own imports).
const fake = vi.hoisted(() => ({ loader: null as ContentLoader | null }));
vi.mock('@/content/loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/content/loader')>();
  const content = new Proxy(actual.content, { get: (t, k) => Reflect.get(fake.loader ?? t, k) });
  return { ...actual, content };
});

const K_INU = `${V.犬}#rec` as CardKey;
const K_MIZU = `${V.水}#rec` as CardKey; // Kaiden lane
const K_SHOKU = 'j-食#read' as CardKey;
const K_DESU = `${G.です}#cloze` as CardKey;
const POOL = [K_INU, K_MIZU, K_SHOKU, K_DESU];

/** What the current prompt wants, by its shown Japanese. */
const ANSWERS: Record<string, { right: string; wrong: string }> = {
  犬: { right: 'dog', wrong: 'cat' },
  水: { right: 'water', wrong: 'milk' },
  食べる: { right: 'taberu', wrong: 'nomu' },
  '私はハナ＿＿。': { right: 'desu', wrong: 'masu' },
};

const today = dayOf(DEFAULT_TEST_NOW, 'UTC');
const mature = (over: Partial<Parameters<typeof card>[0]> = {}): CardTuple => card({ due: today + 5, s: 30, d: 5, reps: 20, lapses: 1, state: 2, last: today - 10, ...over });

let root: HTMLDivElement;
const clock = { t: DEFAULT_TEST_NOW };

beforeEach(async () => {
  clock.t = DEFAULT_TEST_NOW;
  fake.loader = createFakeLoader(FIXTURE);
  await makeTestStore({
    now: () => clock.t,
    cards: {
      [K_INU]: mature(),
      [K_MIZU]: mature({ s: 200, flags: CardFlag.kaiden }),
      [K_SHOKU]: mature({ s: 20 }),
      [K_DESU]: mature({ s: 25 }),
    },
  });
  bus.reset();
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  vi.useRealTimers();
});

function step(over: Partial<Step> = {}): Step {
  return {
    id: 'rf-1',
    block: 'reviews',
    exercise: 'rapid-fire',
    itemId: null,
    cardKey: null,
    params: { pool: POOL },
    timed: true,
    timerMs: ROUND_MS,
    isNew: false,
    stepTag: null,
    exposures: 0,
    estMs: ROUND_MS,
    ...over,
  };
}

function mount(s: Step, feel: 'zen' | 'dojo' | 'arcade' = 'arcade') {
  const onResult = vi.fn<(r: AttemptResult) => void>();
  act(() => render(<RapidFire step={s} item={null} feel={feel} furigana="always" jj={false} speedTier={3} exposures={0} onResult={onResult} onHint={() => undefined} onReplay={() => undefined} requestJudge={() => Promise.resolve(true)} />, root));
  return { onResult };
}

const q = <T extends Element>(sel: string): T | null => root.querySelector<T>(sel);
function click(sel: string): void {
  act(() => {
    (q<HTMLButtonElement>(sel) as HTMLButtonElement).click();
  });
}
function clickText(text: string): void {
  const b = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((x) => x.textContent?.trim() === text) as HTMLButtonElement;
  act(() => {
    b.click();
  });
}
function type(text: string): void {
  const input = q<HTMLInputElement>('.rapid__card input') as HTMLInputElement;
  for (const ch of text) {
    act(() => {
      input.value = input.value + ch;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
}
/** Answers the current prompt right or wrong; returns which card it was. */
function answer(right: boolean): string {
  const shown = q('.rapid__prompt')?.textContent ?? '';
  const a = ANSWERS[shown];
  if (!a) throw new Error(`unexpected prompt ${shown}`);
  clock.t += 1500;
  type(right ? a.right : a.wrong);
  return shown;
}
function tick(ms: number): void {
  clock.t += ms;
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('rapid fire prompts', () => {
  it('meta follows the D export convention', () => {
    expect(meta).toMatchObject({ id: 'rapid-fire', facet: null, keys: 'kana', timeable: true, needsTts: false });
  });

  it('promptFor builds rec / read / cloze prompts and rejects the rest', () => {
    const rec = promptFor(K_INU, FIXTURE.items[V.犬], 0);
    expect(rec).toMatchObject({ mode: 'en', promptJa: '犬', sub: 'いぬ', accept: ['dog'], missTags: ['word-choice'], facet: 'rec' });
    const read = promptFor(K_SHOKU, FIXTURE.items['j-食'], 0);
    expect(read).toMatchObject({ mode: 'ja', promptJa: '食べる', accept: ['たべる'], missTags: ['kanji-reading'], particleSlip: false });
    expect(promptFor(K_SHOKU, FIXTURE.items['j-食'], 1)?.promptJa).toBe('食べ物');
    const cloze = promptFor(K_DESU, FIXTURE.items[G.です], 0);
    expect(cloze).toMatchObject({ mode: 'ja', promptJa: '私はハナ＿＿。', accept: ['です'], sub: 'I am Hana.' });
    expect(promptFor(K_DESU, FIXTURE.items[G.です], 1)?.promptJa).toBe('これは水＿＿。');
    expect(promptFor('k-h-ne#rec', FIXTURE.items['k-h-ne'], 0)).toMatchObject({ mode: 'en', promptJa: 'ね', accept: ['ne'] });
    expect(promptFor('c-eat#rec', FIXTURE.items['c-eat'], 0)).toMatchObject({ promptJa: '食', accept: ['eat'] });
    expect(promptFor(K_INU, undefined, 0)).toBeNull();
    expect(promptFor(`${V.犬}#prod`, FIXTURE.items[V.犬], 0)).toBeNull();
    expect(promptFor('garbage' as CardKey, FIXTURE.items[V.犬], 0)).toBeNull();
  });
});

describe('<RapidFire>', () => {
  it('intro shows the pool size and the personal best under a poster title; Start opens the round with the clock and its meter running', () => {
    mount(step());
    expect(q('.rapid')?.getAttribute('data-phase')).toBe('intro');
    expect(q('.rapid__title')?.classList.contains('poster-title')).toBe(true);
    expect(q('.rapid__meta')?.textContent).toContain('4 cards in the pool');
    expect(q('.rapid__meta')?.textContent).toContain('Personal best');
    clickText('Start');
    expect(q('.rapid')?.getAttribute('data-phase')).toBe('run');
    expect(q('.rapid__clock')?.textContent).toBe('60 s');
    const meter = q<HTMLElement>('.rapid__time') as HTMLElement;
    expect(meter.classList.contains('meter')).toBe(true);
    expect(meter.style.getPropertyValue('--value')).toBe('1.000');
    expect(q('.rapid__card')?.classList.contains('sheet')).toBe(true);
    expect(q('.rapid__card .eyebrow')).not.toBeNull();
    expect(q('.rapid__prompt')).not.toBeNull();
    tick(5000);
    expect(q('.rapid__clock')?.textContent).toBe('55 s');
    expect(Number(meter.style.getPropertyValue('--value'))).toBeCloseTo(55 / 60, 2);
    expect(q('.rapid__count .ticker[data-roll]')).not.toBeNull();
    // the press lands on the count (RapidFire.css: osu on the Ticker while it ticks), never on the next prompt's card
    expect(q('.rapid__card')?.classList.contains('ink-osu')).toBe(false);
    expect(readFileSync(resolve(process.cwd(), 'src/exercises/fluency/RapidFire.css'), 'utf8')).toMatch(/\.rapid__count \.ticker\[data-ticking\] \{[^}]*animation: osu var\(--dur-2\)/);
  });

  it('a correct answer counts and writes nothing — except Good on a Kaiden card (implicit evidence)', () => {
    mount(step());
    clickText('Start');
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) seen.push(answer(true));
    expect(new Set(seen)).toEqual(new Set(['犬', '水', '私はハナ＿＿。', '食べる']));
    expect(q('.rapid__count')?.textContent).toBe('4 correct');
    expect(q('.combo')?.textContent).toContain('4');
    // plain mature card: untouched, no log row
    expect(store.cards.get(K_INU)).toEqual(mature());
    expect(store.log.forCard(K_INU)).toEqual([]);
    // Kaiden card: Good written and logged
    const mizu = store.cards.get(K_MIZU) as CardTuple;
    expect(mizu[3]).toBe(21);
    expect(store.log.forCard(K_MIZU).map((e) => e[2])).toEqual([3]);
    expect(hasFlag(mizu[7], CardFlag.recheck)).toBe(false);
  });

  it('a miss (or Pass) sets the recheck flag, never Again, and breaks the combo', () => {
    mount(step());
    clickText('Start');
    const first = answer(true);
    const second = answer(false);
    const keyOf: Record<string, CardKey> = { 犬: K_INU, 水: K_MIZU, 食べる: K_SHOKU, '私はハナ＿＿。': K_DESU };
    const missed = store.cards.get(keyOf[second] as CardKey) as CardTuple;
    expect(hasFlag(missed[7], CardFlag.recheck)).toBe(true);
    expect(missed[4]).toBe(1); // lapses unchanged
    expect(store.log.forCard(keyOf[second] as CardKey).some((e) => e[2] === 1)).toBe(false);
    expect(q('.combo')).toBeNull();
    clickText('Pass');
    expect(q('.rapid__count')?.textContent).toBe('1 correct');
    void first;
  });

  it('ends at 60 s: arcade:done carries correct / misses / recheck keys and no XP is emitted here', () => {
    const cap = captureEvents();
    mount(step());
    clickText('Start');
    const seen = [answer(true), answer(false), answer(true)];
    tick(ROUND_MS + 100);
    expect(q('.rapid')?.getAttribute('data-phase')).toBe('over');
    cap.stop();
    const done = cap.events.filter(([n]) => n === 'arcade:done');
    expect(done).toHaveLength(1);
    const payload = done[0]?.[1] as { mode: string; correct: number; misses: number; ms: number; recheck: CardKey[] };
    expect(payload.mode).toBe('rapid');
    expect(payload.correct).toBe(2);
    expect(payload.misses).toBe(1);
    expect(payload.recheck).toHaveLength(1);
    expect(payload.ms).toBeLessThanOrEqual(ROUND_MS);
    expect(cap.events.some(([n]) => n === 'xp:gained')).toBe(false);
    expect(q('.rapid__tally')?.textContent).toContain('Correct');
    expect(q('.rapid__note')?.textContent).toContain('untimed');
    // the result is the print: poster title, a .sheet tally whose tiles stagger (--i) and roll (<Ticker roll>)
    expect(q('.rapid__title')?.classList.contains('poster-title')).toBe(true);
    expect(q('.rapid__tally')?.classList.contains('sheet')).toBe(true);
    const tiles = Array.from(root.querySelectorAll<HTMLElement>('.rapid__tally > div'));
    expect(tiles.length).toBe(4);
    tiles.forEach((t, i) => {
      expect(t.classList.contains('ink-nijimi')).toBe(true);
      expect(t.style.getPropertyValue('--i')).toBe(String(i));
      expect(t.querySelector('.ticker[data-roll]')).not.toBeNull();
    });
    // a first round has no own best to pass: no BEST eyebrow (footnote 5)
    expect(q('.rapid__best-eyebrow')).toBeNull();
    void seen;
  });

  it('the BEST eyebrow names the learner’s OWN previous best only when the round passes it, never on a miss', async () => {
    await makeTestStore({ now: () => clock.t, save: { stats: { rapidBest: 1 } }, cards: { [K_INU]: mature(), [K_MIZU]: mature({ s: 200, flags: CardFlag.kaiden }), [K_SHOKU]: mature({ s: 20 }), [K_DESU]: mature({ s: 25 }) } });
    mount(step());
    clickText('Start');
    answer(true);
    answer(true);
    clickText('Finish');
    expect(q('.rapid__best-eyebrow')?.textContent).toBe(rfill(RS.bestEyebrow, { n: 1 }));
    expect(q('.rapid__best-eyebrow')?.classList.contains('eyebrow')).toBe(true);
    // a round at or under the own best: no eyebrow
    await makeTestStore({ now: () => clock.t, save: { stats: { rapidBest: 5 } }, cards: { [K_INU]: mature(), [K_MIZU]: mature({ s: 200, flags: CardFlag.kaiden }), [K_SHOKU]: mature({ s: 20 }), [K_DESU]: mature({ s: 25 }) } });
    mount(step({ id: 'rf-3' }));
    clickText('Start');
    answer(true);
    answer(false);
    clickText('Finish');
    expect(q('.rapid__best-eyebrow')).toBeNull();
    expect(q('.rapid__best')).toBeNull();
  });

  it('Continue hands the runner one clean summary result; Finish ends the round early', () => {
    const { onResult } = mount(step());
    clickText('Start');
    answer(true);
    answer(true);
    clickText('Finish');
    expect(q('.rapid')?.getAttribute('data-phase')).toBe('over');
    expect(q('.rapid__best')?.textContent).toBe('New personal best.');
    clickText('Continue');
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, guard: false, score: 1, answer: '2/2' });
  });

  it('wraps around the pool when the clock outlasts it', () => {
    mount(step({ params: { pool: [K_INU] } }));
    clickText('Start');
    answer(true);
    expect(q('.rapid__prompt')?.textContent).toBe('犬');
    answer(true);
    expect(q('.rapid__count')?.textContent).toBe('2 correct');
  });

  it('Zen hides the combo; an empty pool offers Continue without emitting arcade:done', () => {
    mount(step(), 'zen');
    clickText('Start');
    answer(true);
    answer(true);
    expect(q('.combo')).toBeNull();
    const cap = captureEvents();
    const { onResult } = mount(step({ id: 'rf-2', params: { pool: [] } }));
    expect(q('.rapid__empty')?.textContent).toContain('No mature cards yet');
    clickText('Continue');
    cap.stop();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(cap.events.some(([n]) => n === 'arcade:done')).toBe(false);
  });

  it('Start takes focus on the intro screen and Continue on the summary (useAutoFocus, no autofocus attribute)', () => {
    mount(step());
    const start = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((x) => x.textContent?.trim() === 'Start') as HTMLButtonElement;
    expect(document.activeElement).toBe(start);
    expect(start.hasAttribute('autofocus')).toBe(false);
    clickText('Start');
    clickText('Finish');
    expect(q('.rapid')?.getAttribute('data-phase')).toBe('over');
    const cont = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((x) => x.textContent?.trim() === 'Continue') as HTMLButtonElement;
    expect(document.activeElement).toBe(cont);
    expect(cont.hasAttribute('autofocus')).toBe(false);
  });

  it('a pool whose items are not loaded offers Finish instead of a dead prompt', () => {
    fake.loader = null; // actual loader: nothing loaded
    mount(step({ params: { pool: [K_INU] } }));
    clickText('Start');
    expect(q('.rapid__prompt')).toBeNull();
    expect(q('.rapid__empty')?.textContent).toContain('not loaded');
    click('.rapid__card .hanko');
    expect(q('.rapid')?.getAttribute('data-phase')).toBe('over');
  });
});
