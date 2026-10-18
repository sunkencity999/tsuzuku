import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { TextAnswer, offeredCandidates, type TextAnswerProps, type TextAnswerResult } from './TextAnswer';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const step: Step = {
  id: 's1',
  block: 'reviews',
  exercise: 'meaning-recall',
  itemId: 'v-n5-0006',
  cardKey: 'v-n5-0006#rec',
  params: {},
  timed: false,
  isNew: false,
  stepTag: null,
  exposures: 3,
  estMs: 6000,
};

function inFrame(children: preact.ComponentChildren): preact.JSX.Element {
  return (
    <ExerciseFrame
      step={step}
      index={0}
      total={5}
      ki={10}
      combo={0}
      comboTier={0}
      timer={null}
      feel="dojo"
      feedback={null}
      now={() => 0}
      onGuard={() => undefined}
      onHint={() => undefined}
      onPause={() => undefined}
      onContinue={() => undefined}
    >
      {children}
    </ExerciseFrame>
  );
}

function mount(p: Partial<TextAnswerProps> & { accept: string[] }, framed = false) {
  const onSubmit = vi.fn<(r: TextAnswerResult) => void>();
  const el = <TextAnswer onSubmit={onSubmit} {...p} />;
  act(() => render(null, root)); // a fresh widget each time (state would otherwise persist)
  act(() => render(framed ? inFrame(el) : el, root));
  const input = root.querySelector('input') as HTMLInputElement;
  return { onSubmit, input };
}

function type(input: HTMLInputElement, text: string): void {
  for (const ch of text) {
    act(() => {
      input.value = input.value + ch;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

function key(target: EventTarget, k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

const submitBtn = (): HTMLButtonElement => root.querySelector('.text-answer__submit') as HTMLButtonElement;
const q = (sel: string): HTMLElement | null => root.querySelector(sel);

describe('<TextAnswer> English mode', () => {
  it('accepts fuzzy matches: articles / "to" stripped, 1 edit on ≥ 5 chars, exact on short words', () => {
    const { onSubmit, input } = mount({ accept: ['to eat'] });
    expect(root.querySelector('.text-answer')?.getAttribute('data-mode')).toBe('en');
    expect(input.getAttribute('aria-label')).toBe('Meaning in English');
    type(input, 'eat');
    key(input, 'Enter');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ correct: true, given: 'eat', override: false, nearMiss: false, tags: [], expected: 'to eat' });

    const b = mount({ accept: ['delicious', 'tasty'] });
    type(b.input, 'delicous');
    key(b.input, 'Enter');
    expect(b.onSubmit.mock.calls[0]?.[0]?.correct).toBe(true);

    const c = mount({ accept: ['dog'], allowOverride: false });
    type(c.input, 'dgo');
    key(c.input, 'Enter');
    expect(c.onSubmit.mock.calls[0]?.[0]).toMatchObject({ correct: false, override: false, expected: 'dog' });
  });

  it('a miss opens the confirm step first; "No. Mark it." submits override:false', () => {
    const { onSubmit, input } = mount({ accept: ['to drink', 'drink'], missTags: ['word-choice'] });
    type(input, 'to eat');
    key(input, 'Enter');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(root.querySelector('.text-answer')?.getAttribute('data-phase')).toBe('confirm');
    expect(q('.text-answer__confirm .text-answer__form')?.textContent).toBe('to drink');
    expect(q('.text-answer__confirm .text-answer__also')?.textContent).toContain('drink');
    expect(input.disabled).toBe(true);
    // honest default has focus
    expect(document.activeElement).toBe(q('.text-answer__decline'));
    act(() => (q('.text-answer__decline') as HTMLButtonElement).click());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ correct: false, override: false, given: 'to eat', tags: ['word-choice'], expected: 'to drink' });
    expect(q('.text-answer__reveal')?.getAttribute('data-kind')).toBe('wrong');
    expect(q('.text-answer__reveal .text-answer__given')?.textContent).toBe('to eat');
  });

  it('"I meant that" emits override:true, correct:true, no tags — and only once', () => {
    const { onSubmit, input } = mount({ accept: ['to drink'], missTags: ['word-choice'] });
    type(input, 'to eat');
    key(input, 'Enter');
    act(() => (q('.text-answer__override') as HTMLButtonElement).click());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ correct: true, override: true, tags: [], given: 'to eat' });
    expect(q('.text-answer__reveal .text-answer__why')?.textContent).toBe('Noted. The inspector may ask about this one.');
    expect(q('.text-answer__confirm')).toBeNull();
    // nothing fires twice
    act(() => submitBtn().click());
    key(input, 'Enter');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('Enter from the frame (focus outside the field) declines the override honestly', () => {
    const { onSubmit, input } = mount({ accept: ['to drink'] }, true);
    type(input, 'to eat');
    key(input, 'Enter');
    expect(onSubmit).not.toHaveBeenCalled();
    key(document.body, 'Enter');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ correct: false, override: false });
  });

  it('allowOverride:false submits a miss immediately', () => {
    const { onSubmit, input } = mount({ accept: ['to drink'], allowOverride: false });
    type(input, 'to eat');
    key(input, 'Enter');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(q('.text-answer__confirm')).toBeNull();
  });

  it('empty submits are refused with a nudge; the submit button is disabled while empty', () => {
    const { onSubmit, input } = mount({ accept: ['to eat'] });
    expect(submitBtn().disabled).toBe(true);
    key(input, 'Enter');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(q('.text-answer__nudge')?.textContent).toBe('Type something first.');
    type(input, 'eat');
    expect(q('.text-answer__nudge')).toBeNull();
    expect(submitBtn().disabled).toBe(false);
    act(() => submitBtn().click());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]?.correct).toBe(true);
  });

  it('Shift+Enter is left to the frame; onAttempt fires at the first submit, before the confirm step', () => {
    const onAttempt = vi.fn();
    const { onSubmit, input } = mount({ accept: ['to drink'], onAttempt });
    type(input, 'to eat');
    const e = key(input, 'Enter', { shiftKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(onAttempt).not.toHaveBeenCalled();
    key(input, 'Enter');
    expect(onAttempt).toHaveBeenCalledWith('to eat');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('autoFocus focuses the field; reveal:false hides the reveal panel', () => {
    const { input } = mount({ accept: ['to eat'], autoFocus: true, reveal: false, allowOverride: false });
    expect(document.activeElement).toBe(input);
    type(input, 'xx');
    key(input, 'Enter');
    expect(q('.text-answer__reveal')).toBeNull();
    expect(root.querySelector('.text-answer')?.getAttribute('data-phase')).toBe('done');
  });
});

describe('<TextAnswer> Japanese mode', () => {
  it('converts romaji through the kana IME and grades with checkJa (IME variants accepted)', () => {
    const { onSubmit, input } = mount({ accept: ['続く', 'つづく'], mode: 'ja' });
    expect(root.querySelector('.kana-input')).not.toBeNull();
    // the ja field wears the same ink rule as the English one (TextAnswer.css hiku-draws it on focus)
    expect(root.querySelector('.text-answer__ink[data-mode="ja"] > .kana-input')).not.toBeNull();
    expect(input.getAttribute('lang')).toBe('ja');
    type(input, 'tsuzuku');
    expect(input.value).toBe('つずく');
    key(input, 'Enter');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const r = onSubmit.mock.calls[0]?.[0] as TextAnswerResult;
    expect(r).toMatchObject({ correct: true, nearMiss: false, kanaOnly: true, override: false, given: 'つずく', expected: 'つづく' });
    expect(r.check?.kind).toBe('exact');
    expect(q('.text-answer__reveal')?.getAttribute('data-kind')).toBe('correct');
    expect(q('.text-answer__reveal .text-answer__expected')).toBeNull();
  });

  it('near miss: shows the correct form, the character diff and the why line; tags small-kana', () => {
    const { onSubmit, input } = mount({ accept: ['切手', 'きって'], mode: 'ja' });
    type(input, 'kite');
    key(input, 'Enter');
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ correct: false, nearMiss: true, tags: ['small-kana'], expected: 'きって', given: 'きて' });
    const reveal = q('.text-answer__reveal');
    expect(reveal?.getAttribute('data-kind')).toBe('partial');
    expect(reveal?.querySelector('.text-answer__form')?.textContent).toBe('きって');
    expect(reveal?.querySelector('.text-answer__form')?.getAttribute('lang')).toBe('ja');
    const diff = Array.from(reveal?.querySelectorAll('.diff') ?? []).map((s) => `${s.textContent}${s.getAttribute('data-diff')}`);
    expect(diff).toEqual(['き0', 'っ2', 'て0']);
    expect(reveal?.querySelector('.text-answer__diff')?.getAttribute('lang')).toBe('ja');
    expect(reveal?.querySelector('.text-answer__why')?.textContent).toBe('Small っ or ゃ: a stop or a glide changes the word.');
    expect(input.disabled).toBe(true);
  });

  it('kana-only under the Hard policy is correct + nearMiss with its own line; a plain miss carries missTags', () => {
    const a = mount({ accept: ['食べる', 'たべる'], mode: 'ja', kanaOnlyPolicy: 'hard' });
    type(a.input, 'taberu');
    key(a.input, 'Enter');
    expect(a.onSubmit.mock.calls[0]?.[0]).toMatchObject({ correct: true, nearMiss: true, kanaOnly: true });
    expect(q('.text-answer__reveal')?.getAttribute('data-kind')).toBe('partial');
    expect(q('.text-answer__why')?.textContent).toBe('Right word. From Green, the kanji counts.');

    const b = mount({ accept: ['猫', 'ねこ'], mode: 'ja', missTags: ['kanji-reading'] });
    type(b.input, 'inu');
    key(b.input, 'Enter');
    expect(b.onSubmit.mock.calls[0]?.[0]).toMatchObject({ correct: false, nearMiss: false, tags: ['kanji-reading'], expected: '猫' });
    expect(q('.text-answer__reveal')?.getAttribute('data-kind')).toBe('wrong');
  });

  it('katakana mode is on automatically for a katakana answer and can be forced off', () => {
    mount({ accept: ['コーヒー'], mode: 'ja' });
    expect(q('.kana-input')?.getAttribute('data-katakana')).toBe('true');
    mount({ accept: ['コーヒー'], mode: 'ja', katakana: false });
    expect(q('.kana-input')?.getAttribute('data-katakana')).toBe('false');
    mount({ accept: ['食べる', 'たべる'], mode: 'ja' });
    expect(q('.kana-input')?.getAttribute('data-katakana')).toBe('false');
  });

  it('allowKatakanaFold:false makes し a script miss for シ (no override step in ja mode)', () => {
    const { onSubmit, input } = mount({ accept: ['シ'], mode: 'ja', katakana: false, allowKatakanaFold: false });
    type(input, 'shi');
    key(input, 'Enter');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ correct: false, nearMiss: false, tags: [] });
    expect(onSubmit.mock.calls[0]?.[0]?.check?.kind).toBe('script');
    expect(q('.text-answer__why')?.textContent).toBe('Katakana here.');
  });

  it('offers candidates to the kana field only once the kana reads as candidateReading, and refuses an empty kana submit', () => {
    const { onSubmit, input } = mount({ accept: ['続く', 'つづく'], mode: 'ja', candidates: ['続く', '着く'], candidateReading: 'つづく' });
    expect(q('.kana-input__hint')).toBeNull();
    key(input, 'Enter');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(q('.text-answer__nudge')).not.toBeNull();
    type(input, 'tsu');
    expect(input.value).toBe('つ');
    const early = key(input, ' ');
    expect(early.defaultPrevented).toBe(false);
    expect(input.value).toBe('つ');
    expect(q('.kana-input__hint')).toBeNull();
    type(input, 'duku');
    expect(input.value).toBe('つづく');
    expect(q('.kana-input__hint')).not.toBeNull();
    const e = key(input, ' ');
    expect(e.defaultPrevented).toBe(true);
    expect(input.value).toBe('続く');
    key(input, ' ');
    expect(input.value).toBe('着く');
    key(input, ' ');
    expect(input.value).toBe('つづく');
  });

  it('without candidateReading the candidates never cycle from kana (Space stays a plain character)', () => {
    const { input } = mount({ accept: ['続く', 'つづく'], mode: 'ja', candidates: ['続く', '着く'] });
    type(input, 'tsuduku');
    const e = key(input, ' ');
    expect(e.defaultPrevented).toBe(false);
    expect(input.value).toBe('つづく');
  });

  it('offeredCandidates: all while the field shows a candidate or its kana finalizes to the reading, else none', () => {
    expect(offeredCandidates(['飲む', '呑む'], 'のむ', 'のむ')).toEqual(['飲む', '呑む']);
    expect(offeredCandidates(['飲む', '呑む'], 'のむ', 'のm')).toBeUndefined();
    expect(offeredCandidates(['飲む', '呑む'], 'のむ', 'あ')).toBeUndefined();
    expect(offeredCandidates(['飲む', '呑む'], 'のむ', '呑む')).toEqual(['飲む', '呑む']);
    expect(offeredCandidates(['飲む', '呑む'], 'のむ', '')).toBeUndefined();
    expect(offeredCandidates(['飲む'], undefined, 'のむ')).toBeUndefined();
    expect(offeredCandidates([], 'のむ', 'のむ')).toBeUndefined();
    expect(offeredCandidates(undefined, 'のむ', 'のむ')).toBeUndefined();
  });

  it('starts over when the same instance receives a new accept list (next step without a remount)', () => {
    const onSubmit = vi.fn<(r: TextAnswerResult) => void>();
    act(() => render(null, root));
    act(() => render(<TextAnswer accept={['ねこ']} mode="ja" onSubmit={onSubmit} />, root));
    const input = root.querySelector('input') as HTMLInputElement;
    type(input, 'neko');
    key(input, 'Enter');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.text-answer')?.getAttribute('data-phase')).toBe('done');
    act(() => render(<TextAnswer accept={['いぬ']} mode="ja" onSubmit={onSubmit} />, root));
    expect(root.querySelector('.text-answer')?.getAttribute('data-phase')).toBe('input');
    const input2 = root.querySelector('input') as HTMLInputElement;
    expect(input2.disabled).toBe(false);
    expect(input2.value).toBe('');
    type(input2, 'inu');
    key(input2, 'Enter');
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1]?.[0]).toMatchObject({ correct: true, given: 'いぬ' });
  });

  it('frame Enter outside the field submits the typed value', () => {
    const { onSubmit, input } = mount({ accept: ['ねこ'], mode: 'ja' }, true);
    type(input, 'neko');
    key(document.body, 'Enter');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]?.correct).toBe(true);
  });
});
