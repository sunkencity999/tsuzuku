import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE } from '@/content/fixtures';
import type { KanaItem } from '@/content/types';
import { installServices, nullAudio, resetServices } from '@/shared/audio';
import type { AttemptResult, ExerciseProps } from '@/shared/exercise-types';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { makeTestStore } from '@/store/testing';
import { KanaForge, meta } from './KanaForge';

let root: HTMLDivElement;
let clock = 1_000_000;
const speak = vi.fn<(text: string, o?: unknown) => Promise<void>>(() => Promise.resolve());

beforeEach(async () => {
  clock = 1_000_000;
  speak.mockClear();
  await makeTestStore({ now: () => clock });
  installServices({ audio: { ...nullAudio, speak, hasJaVoice: signal(false) } });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

const NE = FIXTURE.items['k-h-ne'] as KanaItem;
const SHI_K: KanaItem = {
  id: 'k-k-shi',
  kana: 'シ',
  romaji: 'shi',
  script: 'katakana',
  type: 'basic',
  row: 's',
  mnemonic: 'シ: a smiling face, two eyes and a stroke sweeping up.',
  exampleWord: { word: 'シャツ', kana: 'シャツ', en: 'shirt' },
  lookalikes: ['k-k-tsu'],
};
const KYA: KanaItem = { ...NE, id: 'k-h-kya', kana: 'きゃ', romaji: 'kya', row: 'k', type: 'yoon', lookalikes: undefined, exampleWord: { word: 'きゃく', kana: 'きゃく', en: 'guest' } };

function step(item: KanaItem, over: Partial<Step> = {}): Step {
  return {
    id: 's1',
    block: 'reviews',
    exercise: 'kana-forge',
    itemId: item.id,
    cardKey: `${item.id}#prod`,
    params: { answer: item.kana, accept: [item.kana], promptEn: item.romaji },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 3,
    estMs: 5000,
    ...over,
  };
}

type P = ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onHint: ReturnType<typeof vi.fn>; onReplay: ReturnType<typeof vi.fn> };

function props(item: KanaItem | null = NE, over: Partial<ExerciseProps> = {}): P {
  return {
    step: step(item ?? NE),
    item,
    feel: 'dojo',
    furigana: 'always',
    jj: false,
    speedTier: 3,
    exposures: 3,
    onResult: vi.fn(),
    onHint: vi.fn(),
    onReplay: vi.fn(),
    requestJudge: vi.fn(() => Promise.resolve(true)),
    ...over,
  } as P;
}

function inFrame(children: preact.ComponentChildren, s: Step): preact.JSX.Element {
  return (
    <ExerciseFrame step={s} index={0} total={5} ki={10} combo={0} comboTier={0} timer={null} feel="dojo" feedback={null} now={() => 0} onGuard={() => undefined} onHint={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
      {children}
    </ExerciseFrame>
  );
}

function mount(p: ExerciseProps, framed = false): HTMLInputElement {
  act(() => render(null, root));
  act(() => render(framed ? inFrame(<KanaForge {...p} />, p.step) : <KanaForge {...p} />, root));
  return root.querySelector('input') as HTMLInputElement;
}

function type(input: HTMLInputElement, text: string): void {
  for (const ch of text) {
    act(() => {
      input.value = input.value + ch;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

function key(target: EventTarget, k: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

const result = (p: P): AttemptResult => p.onResult.mock.calls[0]?.[0] as AttemptResult;
const q = (sel: string): HTMLElement | null => root.querySelector(sel);

describe('meta', () => {
  it('registers kana-forge on the prod facet with kana keys and TTS', () => {
    expect(meta).toMatchObject({ id: 'kana-forge', facet: 'prod', keys: 'kana', needsTts: true });
  });
});

describe('<KanaForge>', () => {
  it('a katakana item switches the IME to katakana mode; a hiragana item does not', () => {
    mount(props(SHI_K, { step: step(SHI_K) }));
    expect(q('.kana-input')?.getAttribute('data-katakana')).toBe('true');
    expect(q('.kana-forge')?.getAttribute('data-script')).toBe('katakana');
    expect(q('.chip')?.textContent).toBe('Katakana');
    mount(props(NE));
    expect(q('.kana-input')?.getAttribute('data-katakana')).toBe('false');
  });

  it('exact kana required: ね is Good, the right sound in the other script is a miss', () => {
    const p = props(NE);
    const input = mount(p);
    clock += 1500;
    type(input, 'ne');
    key(input, 'Enter');
    expect(p.onResult).toHaveBeenCalledTimes(1);
    expect(result(p)).toMatchObject({ correct: true, nearMiss: false, errorTags: [], answer: 'ね', ms: 1500, hintUsed: false, replays: 0 });
    expect(q('.drill__after')?.getAttribute('data-correct')).toBe('true');

    const k = props(SHI_K, { step: step(SHI_K) });
    const input2 = mount(k);
    act(() => (q('.kana-input__kata') as HTMLButtonElement).click()); // learner turns katakana off
    type(input2, 'shi');
    expect(input2.value).toBe('し');
    key(input2, 'Enter');
    expect(result(k)).toMatchObject({ correct: false, nearMiss: false, answer: 'し' });
    expect(q('.text-answer__why')?.textContent).toBe('Katakana here.');
  });

  it('a small-kana slip is a Block tagged small-kana', () => {
    const p = props(KYA, { step: step(KYA) });
    const input = mount(p);
    type(input, 'kiya');
    key(input, 'Enter');
    expect(result(p)).toMatchObject({ correct: false, nearMiss: true, errorTags: ['small-kana'], answer: 'きや' });
    expect(q('.drill__after')?.getAttribute('data-correct')).toBe('near');
  });

  it('without a Japanese voice the romaji is the prompt and costs nothing; the Listen button is not shown and Space counts no replay', () => {
    const p = props(NE);
    const input = mount(p, true);
    expect(q('.kana-forge__romaji')?.textContent).toBe('ne');
    expect(q('.drill__prompt')?.textContent).toBe('Type this in kana.');
    expect(root.textContent).not.toContain('Show romaji');
    expect(q('.kana-ear__speaker')).toBeNull();
    expect(root.textContent).not.toContain('Listen');
    key(document.body, ' ');
    expect(p.onReplay).not.toHaveBeenCalled();
    expect(p.onHint).not.toHaveBeenCalled();
    type(input, 'ne');
    key(input, 'Enter');
    expect(result(p)).toMatchObject({ correct: true, replays: 0, hintUsed: false });
  });

  it('the romaji prompt is the IME spelling where display Hepburn does not round-trip (を → wo, ティ → thi), and typing it is right', () => {
    const WO: KanaItem = { ...NE, id: 'k-h-wo', kana: 'を', romaji: 'o', row: 'w', exampleWord: { word: 'を', kana: 'を', en: 'object marker' } };
    const p = props(WO);
    const input = mount(p);
    expect(q('.kana-forge__romaji')?.textContent).toBe('wo');
    type(input, 'wo');
    key(input, 'Enter');
    expect(result(p)).toMatchObject({ correct: true, answer: 'を' });
    expect(q('.drill__after')?.textContent).toContain('o · wo');

    const THI: KanaItem = { ...NE, id: 'k-k-thi', kana: 'ティ', romaji: 'ti', script: 'katakana', row: 'ext', type: 'extended', exampleWord: { word: 'パーティー', kana: 'パーティー', en: 'party' } };
    const t = props(THI);
    const i2 = mount(t);
    expect(q('.kana-forge__romaji')?.textContent).toBe('thi');
    type(i2, 'thi');
    key(i2, 'Enter');
    expect(result(t)).toMatchObject({ correct: true, answer: 'ティ' });
  });

  it('a voice that cannot be heard (canSpeak false) is treated as no voice: the romaji is the prompt', () => {
    installServices({ audio: { ...nullAudio, speak, hasJaVoice: signal(true), canSpeak: signal(false) } });
    const p = props(NE);
    mount(p, true);
    expect(q('.kana-forge__romaji')?.textContent).toBe('ne');
    expect(root.textContent).not.toContain('Show romaji');
  });

  it('with a voice the romaji hides behind a hint button that counts as a hint', () => {
    installServices({ audio: { ...nullAudio, speak, hasJaVoice: signal(true) } });
    const p = props(NE);
    const input = mount(p);
    expect(q('.kana-forge__romaji')).toBeNull();
    expect(q('.drill__prompt')?.textContent).toBe('Type the kana you heard.');
    const btn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Show romaji') as HTMLButtonElement;
    act(() => btn.click());
    expect(p.onHint).toHaveBeenCalledTimes(1);
    expect(q('.kana-forge__romaji')?.textContent).toBe('ne');
    expect(q('[role="status"]')?.textContent).toContain('Hard');
    type(input, 'ne');
    key(input, 'Enter');
    expect(result(p)).toMatchObject({ correct: true, hintUsed: true });
  });

  it('を with a voice: the romaji (wo) is shown up front at no hint cost because TTS says it like お; audio still plays; o is wrong', () => {
    installServices({ audio: { ...nullAudio, speak, hasJaVoice: signal(true) } });
    const WO: KanaItem = { ...NE, id: 'k-h-wo', kana: 'を', romaji: 'o', row: 'w', exampleWord: { word: 'を', kana: 'を', en: 'object marker' } };
    const p = props(WO);
    const input = mount(p);
    expect(q('.kana-forge__romaji')?.textContent).toBe('wo');
    expect(root.textContent).not.toContain('Show romaji');
    expect(q('.kana-ear__speaker')).not.toBeNull();
    expect(speak).toHaveBeenCalledWith('を', { kana: 'を', clip: 'k-h-wo' });
    expect(p.onHint).not.toHaveBeenCalled();
    type(input, 'o');
    key(input, 'Enter');
    expect(result(p)).toMatchObject({ correct: false, hintUsed: false });

    act(() => render(null, root));
    const p2 = props(WO);
    const input2 = mount(p2);
    type(input2, 'wo');
    key(input2, 'Enter');
    expect(result(p2)).toMatchObject({ correct: true, hintUsed: false, answer: 'を' });
    expect(p2.onHint).not.toHaveBeenCalled();

    // ordinary kana keep the hint button
    act(() => render(null, root));
    mount(props(NE));
    expect(q('.kana-forge__romaji')).toBeNull();
    expect(root.textContent).toContain('Show romaji');
  });

  it('speaks the kana on mount; Space replays through the frame and is counted; Enter outside the field submits', () => {
    installServices({ audio: { ...nullAudio, speak, hasJaVoice: signal(true) } });
    const p = props(NE);
    const input = mount(p, true);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith('ね', { kana: 'ね', clip: 'k-h-ne' });
    key(document.body, ' ');
    expect(speak).toHaveBeenCalledTimes(2);
    expect(p.onReplay).toHaveBeenCalledTimes(1);
    type(input, 'ne');
    input.blur();
    key(document.body, 'Enter');
    expect(result(p)).toMatchObject({ correct: true, replays: 1 });
  });

  it('onResult fires once and the field locks', () => {
    const p = props(NE);
    const input = mount(p);
    type(input, 'ne');
    key(input, 'Enter');
    key(input, 'Enter');
    expect(p.onResult).toHaveBeenCalledTimes(1);
    expect(input.disabled).toBe(true);
  });

  it('a missing item shows the notice and continues as a soft timeout', () => {
    const p = props(null, { step: step(NE) });
    mount(p);
    expect(q('.missing-item')).not.toBeNull();
    act(() => (q('.missing-item .btn') as HTMLButtonElement).click());
    expect(result(p)).toMatchObject({ correct: false, timedOut: true });
  });
});
