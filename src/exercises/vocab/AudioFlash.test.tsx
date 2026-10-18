import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, V } from '@/content/fixtures';
import type { VocabItem } from '@/content/types';
import { installServices, nullAudio, resetServices } from '@/shared/audio';
import type { AttemptResult, ExerciseProps } from '@/shared/exercise-types';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { store } from '@/store';
import { makeTestStore } from '@/store/testing';
import { AudioFlash, meta, spokenText } from './AudioFlash';

let root: HTMLDivElement;
let clock = 1_000_000;
const speak = vi.fn<(text: string, o?: unknown) => Promise<void>>(() => Promise.resolve());

beforeEach(async () => {
  clock = 1_000_000;
  speak.mockClear();
  await makeTestStore({ now: () => clock, save: { progress: { station: 5 } } });
  installServices({ audio: { ...nullAudio, speak, hasJaVoice: signal(true) } });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

const NOMU = FIXTURE.items[V.飲む] as VocabItem; // 'to drink', collocations お茶を飲む · 薬を飲む, confusable 食べる
const CHOICES = ['to eat', 'to drink', 'dog', 'bread'];

function step(over: Partial<Step> = {}): Step {
  return {
    id: 's1',
    block: 'reviews',
    exercise: 'audio-flash',
    itemId: NOMU.id,
    cardKey: `${NOMU.id}#listen`,
    params: { answer: 'to drink', accept: ['to drink'], choices: CHOICES },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 0,
    estMs: 6000,
    ...over,
  };
}

type P = ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onReplay: ReturnType<typeof vi.fn> };

function props(over: Partial<ExerciseProps> = {}): P {
  return {
    step: step(),
    item: NOMU,
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
  } as P;
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
  act(() => render(framed ? inFrame(<AudioFlash {...p} />, p.step) : <AudioFlash {...p} />, root));
}

function key(target: EventTarget, k: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

function type(input: HTMLInputElement, text: string): void {
  for (const ch of text) {
    act(() => {
      input.value = input.value + ch;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

const q = (sel: string): HTMLElement | null => root.querySelector(sel);
const cells = (): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('.choice'));
const result = (p: P): AttemptResult => p.onResult.mock.calls[0]?.[0] as AttemptResult;

describe('meta', () => {
  it('registers audio-flash on the listen facet, TTS required, text keys (no slow rule on typed English)', () => {
    expect(meta).toMatchObject({ id: 'audio-flash', facet: 'listen', needsTts: true, keys: 'text', selfGraded: false });
  });
});

describe('<AudioFlash>', () => {
  it('hides the text until answered, then reveals word, kana, pitch, collocations and gloss', () => {
    const p = props();
    mount(p);
    expect(q('.audio-flash')?.getAttribute('data-revealed')).toBe('false');
    expect(q('.drill__word')).toBeNull();
    expect(root.textContent).not.toContain('飲む');
    expect(root.textContent).not.toContain('のむ');
    expect(root.textContent).toContain('Listen. The word appears after you answer.');
    clock += 1400;
    act(() => cells()[1]?.click());
    expect(result(p)).toMatchObject({ correct: true, errorTags: [], answer: 'to drink', ms: 1400, replays: 0 });
    expect(q('.audio-flash')?.getAttribute('data-revealed')).toBe('true');
    expect(q('.drill__word')?.textContent).toContain('飲');
    expect(q('.vocab__kana')?.textContent).toBe('のむ');
    expect(q('.pitch-line')?.getAttribute('data-type')).toBe('atamadaka');
    expect(q('.vocab__collocation')).not.toBeNull();
    expect(q('.vocab__meaning-en')?.textContent).toContain('to drink');
  });

  it('a voice that cannot be heard (canSpeak false) takes the no-voice path too', () => {
    installServices({ audio: { ...nullAudio, speak, hasJaVoice: signal(true), canSpeak: signal(false) } });
    const p = props();
    mount(p, true);
    expect(q('.audio-flash')?.getAttribute('data-voice')).toBe('false');
    expect(q('.audio-flash__novoice')).not.toBeNull();
  });

  it('without a Japanese voice the word and kana are shown up front with a note, no Speaker, and a miss is tagged word-choice', () => {
    installServices({ audio: { ...nullAudio, speak, hasJaVoice: signal(false) } });
    store.patch('progress', (pr) => ({ ...pr, station: 16 })); // Green: a collocation would otherwise be "heard"
    const p = props();
    mount(p, true);
    expect(q('.audio-flash')?.getAttribute('data-voice')).toBe('false');
    expect(q('.drill__word')?.textContent).toContain('飲');
    expect(q('.vocab__kana')?.textContent).toBe('のむ');
    expect(q('.audio-flash__novoice')?.textContent).toContain('No Japanese voice');
    expect(q('.vocab__speaker')).toBeNull();
    expect(root.textContent).not.toContain('Listen. The word appears after you answer.');
    key(document.body, ' ');
    expect(p.onReplay).not.toHaveBeenCalled();
    act(() => cells()[0]?.click());
    expect(result(p)).toMatchObject({ correct: false, errorTags: ['word-choice'], answer: 'to eat', replays: 0 });
    expect(root.textContent).not.toContain('Heard in');

    const t = props({ exposures: 3, step: step({ exposures: 3, params: { answer: 'to drink', accept: ['to drink'] } }) });
    mount(t);
    const input = q('input') as HTMLInputElement;
    type(input, 'to swim');
    key(input, 'Enter');
    act(() => (q('.text-answer__decline') as HTMLButtonElement).click());
    expect(result(t)).toMatchObject({ correct: false, errorTags: ['word-choice'] });
  });

  it('Space replays through the frame; replays are counted and reported upward', () => {
    const p = props();
    mount(p, true);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith('飲む', { kana: 'のむ', clip: NOMU.id });
    key(document.body, ' ');
    key(document.body, ' ');
    expect(speak).toHaveBeenCalledTimes(3);
    expect(p.onReplay).toHaveBeenCalledTimes(2);
    expect(q('.vocab__speaker')?.textContent).toContain('Replay');
    key(document.body, '1');
    expect(result(p)).toMatchObject({ correct: false, errorTags: ['listening'], answer: 'to eat', replays: 2 });
    expect(cells()[0]?.getAttribute('data-state')).toBe('wrong');
    expect(cells()[1]?.getAttribute('data-state')).toBe('missed');
    key(document.body, ' ');
    expect(speak).toHaveBeenCalledTimes(3); // locked after the answer
  });

  it('from Green the word is spoken inside its collocation and the panel says what was heard', () => {
    store.patch('progress', (pr) => ({ ...pr, station: 16 }));
    const p = props();
    mount(p);
    // the collocation is spoken as written with its #col<k> clip key: no kana override, which would make TTS say the bare word (のむ)
    expect(speak).toHaveBeenCalledWith('お茶を飲む', { clip: `${NOMU.id}#col0` });
    expect(speak).not.toHaveBeenCalledWith('お茶を飲む', expect.objectContaining({ kana: expect.anything() }));
    act(() => cells()[1]?.click());
    expect(root.textContent).toContain('Heard in');
    expect(root.textContent).toContain('お茶を飲む');
  });

  it('without choices (after two exposures) the meaning is typed: fuzzy accept, override → selfRating 3, miss tagged listening', () => {
    const p = props({ exposures: 3, step: step({ exposures: 3, params: { answer: 'to drink', accept: ['to drink'] } }) });
    mount(p);
    expect(q('.audio-flash')?.getAttribute('data-mode')).toBe('text');
    expect(q('.text-answer')).not.toBeNull();
    const input = q('input') as HTMLInputElement;
    type(input, 'drink');
    key(input, 'Enter');
    expect(result(p)).toMatchObject({ correct: true, answer: 'drink' });

    const o = props({ exposures: 3, step: step({ exposures: 3, params: { answer: 'to drink', accept: ['to drink'] } }) });
    mount(o);
    type(q('input') as HTMLInputElement, 'to sip');
    key(q('input') as HTMLInputElement, 'Enter');
    act(() => (q('.text-answer__override') as HTMLButtonElement).click());
    expect(result(o)).toMatchObject({ correct: true, selfRating: 3, answer: 'to sip' });

    const m = props({ exposures: 3, step: step({ exposures: 3, params: { answer: 'to drink', accept: ['to drink'] } }) });
    mount(m);
    type(q('input') as HTMLInputElement, 'to eat');
    key(q('input') as HTMLInputElement, 'Enter');
    act(() => (q('.text-answer__decline') as HTMLButtonElement).click());
    expect(result(m)).toMatchObject({ correct: false, errorTags: ['listening'] });
    expect(q('.drill__word')).not.toBeNull();
  });

  it('a choice set without the meaning falls back to typing instead of an unwinnable grid', () => {
    const p = props({ step: step({ params: { answer: 'to drink', choices: ['dog', 'cat', 'bird', 'fish'] } }) });
    mount(p);
    expect(q('.audio-flash')?.getAttribute('data-mode')).toBe('text');
  });

  it('a missing item shows the notice and continues as a soft timeout', () => {
    const p = props({ item: null });
    mount(p);
    act(() => (q('.missing-item .btn') as HTMLButtonElement).click());
    expect(result(p)).toMatchObject({ correct: false, timedOut: true });
  });
});

describe('spokenText', () => {
  it('speaks the bare word through Orange and the collocation from Green', () => {
    expect(spokenText(NOMU, 'yellow')).toBe('飲む');
    expect(spokenText(NOMU, 'orange')).toBe('飲む');
    expect(spokenText(NOMU, 'green')).toBe('お茶を飲む');
    expect(spokenText(NOMU, 'black')).toBe('お茶を飲む');
    expect(spokenText({ word: '犬' }, 'green')).toBe('犬');
    expect(spokenText({ word: '犬', collocations: ['猫と鳥'] }, 'green')).toBe('犬');
  });
});
