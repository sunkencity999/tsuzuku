import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE } from '@/content/fixtures';
import type { KanaItem } from '@/content/types';
import { installServices, nullAudio, resetServices } from '@/shared/audio';
import type { AttemptResult, ExerciseProps } from '@/shared/exercise-types';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { store } from '@/store';
import { makeTestStore } from '@/store/testing';
import { KanaEar, meta } from './KanaEar';
import { HELD_BEAT_STATIONS, TEACH_HELD_ID, TEACH_MORAE_ID, hasHeldBeat, kanaTeachId } from './KanaFlash';
import { KanaFlash } from './KanaFlash';
import { KanaForge } from './KanaForge';

let root: HTMLDivElement;
let clock = 1_000_000;
const speak = vi.fn<(text: string, o?: unknown) => Promise<void>>(() => Promise.resolve());

beforeEach(async () => {
  clock = 1_000_000;
  speak.mockClear();
  await makeTestStore({ now: () => clock });
  installServices({ audio: { ...nullAudio, speak, hasJaVoice: signal(true) } });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

const NE = FIXTURE.items['k-h-ne'] as KanaItem;
const KA = FIXTURE.items['k-h-ka'] as KanaItem;
const GRID = ['れ', 'わ', 'ね', 'め', 'ぬ', 'る', 'ろ', 'そ', 'ん'];

function step(over: Partial<Step> = {}): Step {
  return {
    id: 's1',
    block: 'reviews',
    exercise: 'kana-ear',
    itemId: NE.id,
    cardKey: 'k-h-ne#prod',
    params: { answer: NE.kana, choices: GRID },
    timed: false,
    isNew: true,
    stepTag: 'intro',
    exposures: 0,
    estMs: 4000,
    ...over,
  };
}

function props(over: Partial<ExerciseProps> = {}): ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onReplay: ReturnType<typeof vi.fn> } {
  return {
    step: step(),
    item: NE,
    feel: 'dojo',
    furigana: 'always',
    jj: false,
    speedTier: 3,
    exposures: 0,
    onResult: vi.fn(),
    onHint: vi.fn(),
    onReplay: vi.fn(),
    requestJudge: vi.fn(() => Promise.resolve(true)),
    ...over,
  } as ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onReplay: ReturnType<typeof vi.fn> };
}

function inFrame(children: preact.ComponentChildren, s: Step): preact.JSX.Element {
  return (
    <ExerciseFrame step={s} index={0} total={5} ki={10} combo={0} comboTier={0} timer={null} feel="dojo" feedback={null} now={() => 0} onGuard={() => undefined} onHint={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
      {children}
    </ExerciseFrame>
  );
}

function mount(p: ExerciseProps, framed = false): void {
  act(() => render(null, root));
  act(() => render(framed ? inFrame(<KanaEar {...p} />, p.step) : <KanaEar {...p} />, root));
}

function key(k: string): void {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

const cells = (): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('.choice'));
const cellText = (b: HTMLButtonElement): string => b.querySelector('.choice__text')?.textContent ?? '';
const result = (p: { onResult: ReturnType<typeof vi.fn> }): AttemptResult => p.onResult.mock.calls[0]?.[0] as AttemptResult;

describe('meta', () => {
  it('registers kana-ear on the prod facet with choice keys and TTS', () => {
    expect(meta).toMatchObject({ id: 'kana-ear', facet: 'prod', keys: 'choices', needsTts: true });
  });
});

describe('<KanaEar>', () => {
  it('speaks the mora on mount and again on Space; replays are counted and reported upward', () => {
    const p = props();
    mount(p, true);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith('ね', { kana: 'ね', clip: 'k-h-ne' });
    key(' ');
    key(' ');
    expect(speak).toHaveBeenCalledTimes(3);
    expect(speak).toHaveBeenLastCalledWith('ね', { kana: 'ね', clip: 'k-h-ne' });
    expect(p.onReplay).toHaveBeenCalledTimes(2);
    expect(root.querySelector('.kana-ear__speaker')?.textContent).toContain('Replay');
    act(() => cells()[2]?.click());
    expect(result(p)).toMatchObject({ correct: true, replays: 2, answer: 'ね' });
  });

  it('without a Japanese voice the prompt names the romaji, the Listen button is gone and Space does not count a replay', () => {
    installServices({ audio: { ...nullAudio, speak, hasJaVoice: signal(false) } });
    const p = props();
    mount(p, true);
    expect(root.querySelector('.kana-ear')?.getAttribute('data-voice')).toBe('false');
    expect(root.querySelector('.drill__prompt')?.textContent).toBe('Tap the kana for ne.');
    expect(root.querySelector('.kana-ear__novoice')?.textContent).toContain('No Japanese voice');
    expect(root.querySelector('.kana-ear__speaker')).toBeNull();
    expect(root.textContent).not.toContain('Listen');
    key(' ');
    expect(p.onReplay).not.toHaveBeenCalled();
    expect(cells().length).toBe(9);
    act(() => cells()[2]?.click());
    expect(result(p)).toMatchObject({ correct: true, replays: 0, answer: 'ね' });
    expect(root.querySelector('.drill__after')?.textContent).toContain('The kana');
  });

  it('a voice that cannot be heard (canSpeak false) takes the no-voice path too', () => {
    installServices({ audio: { ...nullAudio, speak, hasJaVoice: signal(true), canSpeak: signal(false) } });
    mount(props(), true);
    expect(root.querySelector('.kana-ear')?.getAttribute('data-voice')).toBe('false');
    expect(root.querySelector('.kana-ear__novoice')).not.toBeNull();
  });

  it('without a voice the romaji prompt for を carries the IME spelling too (o · wo)', () => {
    installServices({ audio: { ...nullAudio, speak, hasJaVoice: signal(false) } });
    const WO: KanaItem = { ...NE, id: 'k-h-wo', kana: 'を', romaji: 'o', row: 'w', lookalikes: [], exampleWord: { word: 'を', kana: 'を', en: 'object marker' } };
    const grid = ['を', 'お', 'わ', 'ね', 'れ', 'め', 'ぬ', 'る', 'ろ'];
    const p = props({ item: WO, step: step({ itemId: WO.id, cardKey: 'k-h-wo#prod', params: { answer: 'を', choices: grid } }) });
    mount(p);
    expect(root.querySelector('.drill__prompt')?.textContent).toBe('Tap the kana for o · wo.');
    act(() => cells()[0]?.click());
    expect(result(p)).toMatchObject({ correct: true, answer: 'を' });
  });

  it('renders the 3×3 grid from params.choices and grades the correct index', () => {
    const p = props();
    mount(p, true);
    const grid = root.querySelector('.choice-grid');
    expect(grid?.getAttribute('data-columns')).toBe('3');
    expect(grid?.getAttribute('data-size')).toBe('lg');
    expect(cells().length).toBe(9);
    expect(cells().map(cellText)).toEqual(GRID);
    expect(cells()[0]?.querySelector('[lang="ja"]')).not.toBeNull();
    clock += 1200;
    key('3');
    expect(p.onResult).toHaveBeenCalledTimes(1);
    expect(result(p)).toMatchObject({ correct: true, nearMiss: false, errorTags: [], answer: 'ね', ms: 1200, replays: 0 });
    expect(cells()[2]?.getAttribute('data-state')).toBe('correct');
    expect(root.querySelector('.drill__after')?.textContent).toContain('ne');
  });

  it('a wrong tap grades Again, shows the missed cell, and locks the grid', () => {
    const p = props();
    mount(p);
    act(() => cells()[0]?.click());
    expect(result(p)).toMatchObject({ correct: false, nearMiss: false, answer: 'れ', errorTags: [] });
    expect(cells()[0]?.getAttribute('data-state')).toBe('wrong');
    expect(cells()[2]?.getAttribute('data-state')).toBe('missed');
    act(() => cells()[2]?.click());
    expect(p.onResult).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.kana-ear__speaker')?.hasAttribute('disabled')).toBe(true);
  });

  it('tags voicing when the picked kana differs only by a dakuten', () => {
    const grid = ['が', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら'];
    const p = props({ item: KA, step: step({ itemId: KA.id, cardKey: 'k-h-ka#prod', params: { answer: KA.kana, choices: grid } }) });
    mount(p);
    act(() => cells()[0]?.click());
    expect(result(p)).toMatchObject({ correct: false, errorTags: ['voicing'], answer: 'が' });
  });

  it('builds a nine-cell grid containing the kana when the planner gave no choices', () => {
    const p = props({ step: step({ params: {} }) });
    mount(p);
    const texts = cells().map(cellText);
    expect(texts.length).toBe(9);
    expect(new Set(texts).size).toBe(9);
    expect(texts).toContain('ね');
    // deterministic for the same seed / day / step
    mount(props({ step: step({ params: {} }) }));
    expect(cells().map(cellText)).toEqual(texts);
  });

  it('a grid that lacks the answer is rebuilt rather than graded unwinnable', () => {
    const p = props({ step: step({ params: { choices: ['あ', 'い', 'う', 'え', 'お', 'か', 'き', 'く', 'け'] } }) });
    mount(p);
    expect(cells().map(cellText)).toContain('ね');
  });

  it('a missing item shows the notice and continues as a soft timeout', () => {
    const p = props({ item: null });
    mount(p);
    expect(root.querySelector('.missing-item')).not.toBeNull();
    act(() => (root.querySelector('.missing-item .btn') as HTMLButtonElement).click());
    expect(result(p)).toMatchObject({ correct: false, timedOut: true });
  });

  it('the clip key is the kana id for any item', () => {
    const p = props({ item: KA, step: step({ itemId: KA.id, cardKey: 'k-h-ka#prod', params: { answer: KA.kana, choices: ['が', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら'] } }) });
    mount(p);
    expect(speak).toHaveBeenCalledWith('か', { kana: 'か', clip: 'k-h-ka' });
  });
});

describe('first-contact cards (TeachOnce, design 08 §11)', () => {
  const card = (id: string): HTMLElement | null => root.querySelector(`.teach-once[data-teach-id="${id}"]`);
  const KYO: KanaItem = { ...NE, id: 'k-h-kyo', kana: 'きょ', romaji: 'kyo', row: 'k', type: 'yoon', lookalikes: undefined, exampleWord: { word: 'きょう', kana: 'きょう', en: 'today' } };

  it('the morae-beats card renders once at Station 1 (and 0), and not after dismissal', async () => {
    await makeTestStore({ now: () => clock, save: { progress: { station: 1 } } });
    const p = props();
    mount(p);
    const c = card(TEACH_MORAE_ID);
    expect(c).not.toBeNull();
    expect(c?.querySelector('.teach-once__title')?.textContent).toBe('Japanese is made of beats.');
    expect(c?.textContent).toContain('mora');
    // every Japanese example carries lang="ja" and an English gloss beside it
    const examples = Array.from(c?.querySelectorAll('.kana-teach__example') ?? []);
    expect(examples.length).toBe(4);
    for (const li of examples) {
      expect(li.querySelector('[lang="ja"]')).not.toBeNull();
      expect(li.textContent).toMatch(/beat/);
    }
    expect(root.querySelectorAll('.teach-once').length).toBe(1);
    // the drill still works beneath the card
    act(() => cells()[2]?.click());
    expect(result(p)).toMatchObject({ correct: true });

    // dismiss writes progress.teachSeen and removes the card
    act(() => (c?.querySelector('.teach-once__dismiss') as HTMLButtonElement).click());
    expect(store.progress.value.teachSeen).toContain(TEACH_MORAE_ID);
    expect(card(TEACH_MORAE_ID)).toBeNull();

    // a later Kana Ear at Station 1 does not show it again
    mount(props({ step: step({ id: 's2' }) }));
    expect(card(TEACH_MORAE_ID)).toBeNull();
    expect(cells().length).toBe(9);
  });

  it('a fresh save (station 0) shows it; Station 5 does not; Kana Flash / Forge never show the morae card', async () => {
    mount(props());
    expect(card(TEACH_MORAE_ID)).not.toBeNull();
    await makeTestStore({ now: () => clock, save: { progress: { station: 5 } } });
    mount(props());
    expect(root.querySelector('.teach-once')).toBeNull();
    await makeTestStore({ now: () => clock, save: { progress: { station: 1 } } });
    act(() => render(null, root));
    act(() => render(<KanaFlash {...props({ step: step({ exercise: 'kana-flash', params: {} }) })} />, root));
    expect(root.querySelector('.teach-once')).toBeNull();
    act(() => render(null, root));
    act(() => render(<KanaForge {...props({ step: step({ exercise: 'kana-forge', params: { answer: NE.kana, accept: [NE.kana], promptEn: NE.romaji } }) })} />, root));
    expect(root.querySelector('.teach-once')).toBeNull();
  });

  it('the held-beat card renders at Station 2 on the first long-vowel / っ item in any kana drill, and dismisses for good', async () => {
    await makeTestStore({ now: () => clock, save: { progress: { station: 2 } } });
    const p = props({ item: KYO, step: step({ itemId: KYO.id, cardKey: 'k-h-kyo#prod', params: { answer: KYO.kana, choices: ['きょ', 'きゅ', 'きゃ', 'ね', 'れ', 'わ', 'め', 'ぬ', 'る'] } }) });
    mount(p);
    expect(card(TEACH_MORAE_ID)).toBeNull();
    const c = card(TEACH_HELD_ID);
    expect(c).not.toBeNull();
    expect(c?.querySelector('.teach-once__title')?.textContent).toBe('A held sound is a beat too.');
    expect(c?.textContent).toContain('おばあさん');
    expect(c?.textContent).toContain('grandmother');
    expect(c?.textContent).toContain('5 beats');
    // a plain item at Station 2 shows nothing
    mount(props({ step: step({ id: 's3' }) }));
    expect(root.querySelector('.teach-once')).toBeNull();
    // Kana Forge shows the same card for the same item
    act(() => render(null, root));
    act(() => render(<KanaForge {...props({ item: KYO, step: step({ itemId: KYO.id, exercise: 'kana-forge', params: { answer: KYO.kana, accept: [KYO.kana], promptEn: 'kyo' } }) })} />, root));
    expect(card(TEACH_HELD_ID)).not.toBeNull();
    act(() => (root.querySelector('.teach-once__dismiss') as HTMLButtonElement).click());
    expect(store.progress.value.teachSeen).toEqual([TEACH_HELD_ID]);
    expect(card(TEACH_HELD_ID)).toBeNull();
    // Kana Flash afterwards: seen
    act(() => render(null, root));
    act(() => render(<KanaFlash {...props({ item: KYO, step: step({ itemId: KYO.id, exercise: 'kana-flash', params: {} }) })} />, root));
    expect(root.querySelector('.teach-once')).toBeNull();
  });

  it('reading a card is not charged to the rep: dismissal re-bases the latency clock and, in Kana Ear, plays the mora again without counting a replay', async () => {
    await makeTestStore({ now: () => clock, save: { progress: { station: 1 } } });
    const p = props();
    mount(p);
    expect(card(TEACH_MORAE_ID)).not.toBeNull();
    expect(speak).toHaveBeenCalledTimes(1);
    clock += 8000; // reading the card
    act(() => (card(TEACH_MORAE_ID)?.querySelector('.teach-once__dismiss') as HTMLButtonElement).click());
    expect(card(TEACH_MORAE_ID)).toBeNull();
    expect(speak).toHaveBeenCalledTimes(2);
    expect(speak).toHaveBeenLastCalledWith('ね', { kana: 'ね', clip: 'k-h-ne' });
    expect(p.onReplay).not.toHaveBeenCalled();
    clock += 1200;
    act(() => cells()[2]?.click());
    expect(result(p)).toMatchObject({ correct: true, ms: 1200, replays: 0 });

    // Kana Flash re-bases its clock too; its glyph is the prompt, so the kana is not spoken a second time
    await makeTestStore({ now: () => clock, save: { progress: { station: 2 } } });
    speak.mockClear();
    const f = props({ item: KYO, step: step({ itemId: KYO.id, cardKey: 'k-h-kyo#rec', exercise: 'kana-flash', params: { choices: ['kyo', 'kyu', 'kya', 'ne'] } }) });
    act(() => render(null, root));
    act(() => render(<KanaFlash {...f} />, root));
    expect(card(TEACH_HELD_ID)).not.toBeNull();
    expect(speak).toHaveBeenCalledTimes(1);
    clock += 5000;
    act(() => (root.querySelector('.teach-once__dismiss') as HTMLButtonElement).click());
    expect(card(TEACH_HELD_ID)).toBeNull();
    expect(speak).toHaveBeenCalledTimes(1);
    clock += 700;
    act(() => (cells().find((b) => cellText(b) === 'kyo') as HTMLButtonElement).click());
    expect(result(f)).toMatchObject({ correct: true, ms: 700 });
  });

  it('hasHeldBeat / kanaTeachId: っ, ー and lengthened vowels count; stations gate the two cards', () => {
    expect(hasHeldBeat('きって')).toBe(true);
    expect(hasHeldBeat('キッチン')).toBe(true);
    expect(hasHeldBeat('ケーキ')).toBe(true);
    expect(hasHeldBeat('おばあさん')).toBe(true);
    expect(hasHeldBeat('がっこう')).toBe(true);
    expect(hasHeldBeat('きょう')).toBe(true);
    expect(hasHeldBeat('えいが')).toBe(true);
    expect(hasHeldBeat('いい')).toBe(true);
    expect(hasHeldBeat('おばさん')).toBe(false);
    expect(hasHeldBeat('きて')).toBe(false);
    expect(hasHeldBeat('きゃ')).toBe(false);
    expect(hasHeldBeat('ねこ')).toBe(false);
    expect(hasHeldBeat('あい')).toBe(false);
    expect(HELD_BEAT_STATIONS).toEqual([2, 3]);
    expect(kanaTeachId(NE, 'ear', 0)).toBe(TEACH_MORAE_ID);
    expect(kanaTeachId(NE, 'ear', 1)).toBe(TEACH_MORAE_ID);
    expect(kanaTeachId(NE, 'flash', 1)).toBeNull();
    expect(kanaTeachId(NE, 'forge', 1)).toBeNull();
    expect(kanaTeachId(KYO, 'ear', 1)).toBe(TEACH_MORAE_ID); // Station 1: the beats card first
    expect(kanaTeachId(KYO, 'ear', 2)).toBe(TEACH_HELD_ID);
    expect(kanaTeachId(KYO, 'flash', 3)).toBe(TEACH_HELD_ID);
    expect(kanaTeachId(KYO, 'forge', 4)).toBeNull();
    expect(kanaTeachId(NE, 'ear', 2)).toBeNull();
    expect(kanaTeachId({ kana: 'っ', exampleWord: NE.exampleWord }, 'flash', 2)).toBe(TEACH_HELD_ID);
    expect(TEACH_MORAE_ID).toMatch(/^[a-z0-9][a-z0-9#:._-]{0,63}$/);
    expect(TEACH_HELD_ID).toMatch(/^[a-z0-9][a-z0-9#:._-]{0,63}$/);
  });
});
