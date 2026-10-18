import { render } from 'preact';
import { useRef } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { FIXTURE } from '@/content/fixtures';
import type { KanaItem } from '@/content/types';
import { installServices, nullAudio, resetServices } from '@/shared/audio';
import type { AttemptResult, ExerciseProps } from '@/shared/exercise-types';
import { rngFor } from '@/shared/hash';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { card, makeTestStore } from '@/store/testing';
import { KANA_FLASH_TARGET_MS, KanaFlash, imeRomaji, kanaFromId, meta, romajiDistractors, romajiLabel, romajiMatches, useDrillKeys } from './KanaFlash';

let root: HTMLDivElement;
let clock = 1_000_000;
const speak = vi.fn<(text: string, o?: unknown) => Promise<void>>(() => Promise.resolve());

beforeEach(async () => {
  clock = 1_000_000;
  speak.mockClear();
  await makeTestStore({ now: () => clock, cards: { 'k-h-ka#rec': card({ s: 20, reps: 10, state: 2 }) } });
  installServices({ audio: { ...nullAudio, speak } });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

const SHI: KanaItem = {
  id: 'k-h-shi',
  kana: 'し',
  romaji: 'shi',
  script: 'hiragana',
  type: 'basic',
  row: 's',
  mnemonic: 'し: a fishing hook.',
  exampleWord: { word: 'しお', kana: 'しお', en: 'salt' },
};
const N: KanaItem = { ...SHI, id: 'k-h-n', kana: 'ん', romaji: 'n', row: 'nn', exampleWord: { word: 'ほん', kana: 'ほん', en: 'book' } };
const KA = FIXTURE.items['k-h-ka'] as KanaItem;
const KI = FIXTURE.items['k-h-ki'] as KanaItem;

function step(over: Partial<Step> = {}): Step {
  return {
    id: 's1',
    block: 'reviews',
    exercise: 'kana-flash',
    itemId: KA.id,
    cardKey: 'k-h-ka#rec',
    params: {},
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 3,
    estMs: 3000,
    ...over,
  };
}

function props(over: Partial<ExerciseProps> = {}): ExerciseProps & { onResult: ReturnType<typeof vi.fn> } {
  const onResult = vi.fn();
  return {
    step: step(),
    item: KA,
    feel: 'dojo',
    furigana: 'always',
    jj: false,
    speedTier: 3,
    exposures: 3,
    onResult,
    onHint: vi.fn(),
    onReplay: vi.fn(),
    requestJudge: vi.fn(() => Promise.resolve(true)),
    ...over,
  } as ExerciseProps & { onResult: ReturnType<typeof vi.fn> };
}

function inFrame(children: preact.ComponentChildren, s: Step = step()): preact.JSX.Element {
  return (
    <ExerciseFrame step={s} index={0} total={5} ki={10} combo={0} comboTier={0} timer={null} feel="dojo" feedback={null} now={() => 0} onGuard={() => undefined} onHint={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
      {children}
    </ExerciseFrame>
  );
}

function mount(p: ExerciseProps, framed = false): HTMLInputElement | null {
  act(() => render(null, root)); // a fresh instance each time (same step key would be reused)
  act(() => render(framed ? inFrame(<KanaFlash {...p} />, p.step) : <KanaFlash {...p} />, root));
  return root.querySelector('input');
}

function type(input: HTMLInputElement, text: string): void {
  for (const ch of text) {
    act(() => {
      input.value = input.value + ch;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

function key(target: EventTarget, k: string, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  });
}

const result = (p: { onResult: ReturnType<typeof vi.fn> }): AttemptResult => p.onResult.mock.calls[0]?.[0] as AttemptResult;

describe('meta', () => {
  it('registers kana-flash on the rec facet with text keys', () => {
    expect(meta).toMatchObject({ id: 'kana-flash', facet: 'rec', keys: 'text', selfGraded: false, timeable: true });
  });
});

describe('<KanaFlash> typed path', () => {
  it("'shi' and 'si' both accept し and auto-submit without Enter", () => {
    for (const romaji of ['shi', 'si']) {
      const p = props({ item: SHI, step: step({ itemId: SHI.id, cardKey: 'k-h-shi#rec' }) });
      const input = mount(p) as HTMLInputElement;
      expect(root.querySelector('.drill__glyph')?.textContent).toBe('し');
      clock += 900;
      type(input, romaji);
      expect(p.onResult).toHaveBeenCalledTimes(1);
      expect(result(p)).toMatchObject({ correct: true, nearMiss: false, errorTags: [], answer: 'し', ms: 900, hintUsed: false, guard: false, timedOut: false });
      expect(input.disabled).toBe(true);
      expect(root.querySelector('.kana-flash__romaji')?.textContent).toBe('shi');
    }
  });

  it('waits while the romaji can still become the kana, then misses on a resolved wrong kana (voicing tagged)', () => {
    const p = props({ item: KI, step: step({ itemId: KI.id, cardKey: 'k-h-ki#rec' }) });
    const input = mount(p) as HTMLInputElement;
    type(input, 'k');
    expect(p.onResult).not.toHaveBeenCalled();
    type(input, 'a');
    expect(p.onResult).toHaveBeenCalledTimes(1);
    expect(result(p)).toMatchObject({ correct: false, nearMiss: false, answer: 'か' });
    expect(root.querySelector('.drill__after')?.getAttribute('data-correct')).toBe('false');
    expect(root.querySelector('.drill__after')?.textContent).toContain(KI.exampleWord.word);

    const q = props();
    const input2 = mount(q) as HTMLInputElement;
    type(input2, 'ga');
    expect(result(q)).toMatchObject({ correct: false, errorTags: ['voicing'], answer: 'が' });
  });

  it('a small-kana slip is a Block: きや for きゃ', () => {
    const KYA: KanaItem = { ...SHI, id: 'k-h-kya', kana: 'きゃ', romaji: 'kya', row: 'k', type: 'yoon' };
    const p = props({ item: KYA, step: step({ itemId: KYA.id, cardKey: 'k-h-kya#rec' }) });
    const input = mount(p) as HTMLInputElement;
    type(input, 'ki');
    expect(p.onResult).not.toHaveBeenCalled(); // き is still a prefix of きゃ
    type(input, 'ya');
    expect(result(p)).toMatchObject({ correct: false, nearMiss: true, errorTags: ['small-kana'], answer: 'きや' });
    expect(root.querySelector('.drill__after')?.getAttribute('data-correct')).toBe('near');
  });

  it('Enter finalizes a lone n to ん; an empty Enter only nudges', () => {
    const p = props({ item: N, step: step({ itemId: N.id, cardKey: 'k-h-n#rec' }) });
    const input = mount(p) as HTMLInputElement;
    key(input, 'Enter');
    expect(p.onResult).not.toHaveBeenCalled();
    expect(root.querySelector('[role="status"]')?.textContent).toBe('Type something first.');
    type(input, 'n');
    expect(p.onResult).not.toHaveBeenCalled();
    key(input, 'Enter');
    expect(result(p)).toMatchObject({ correct: true, answer: 'ん' });
  });

  it('onResult fires once: later input, Enter and the submit button do nothing', () => {
    const p = props();
    const input = mount(p) as HTMLInputElement;
    type(input, 'ka');
    expect(p.onResult).toHaveBeenCalledTimes(1);
    key(input, 'Enter');
    act(() => (root.querySelector('.btn') as HTMLButtonElement).click());
    expect(p.onResult).toHaveBeenCalledTimes(1);
  });

  it('plays the kana once on mount through the audio slot and never again', () => {
    const p = props();
    const input = mount(p) as HTMLInputElement;
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith('か', { kana: 'か', clip: 'k-h-ka' });
    type(input, 'ka');
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it('shows the 1.5 s target on a mature card outside Zen and the reaction verdict afterwards', () => {
    const p = props();
    const input = mount(p) as HTMLInputElement;
    expect(root.querySelector('.kana-flash__target')?.textContent).toBe('Target 1.5 s');
    clock += KANA_FLASH_TARGET_MS + 400;
    type(input, 'ka');
    const chip = root.querySelector('.kana-flash__reaction');
    expect(chip?.getAttribute('data-in-time')).toBe('false');
    expect(chip?.textContent).toContain('1.9 s');

    const zen = props({ feel: 'zen' });
    mount(zen);
    expect(root.querySelector('.kana-flash__target')).toBeNull();

    const young = props({ item: KI, step: step({ itemId: KI.id, cardKey: 'k-h-ki#rec' }) });
    mount(young);
    expect(root.querySelector('.kana-flash__target')).toBeNull();
  });
});

describe('<KanaFlash> multiple-choice path', () => {
  it('shows four romaji choices on exposures < 2 and grades the pick by index', () => {
    const p = props({ exposures: 1, step: step({ exposures: 1 }) });
    mount(p);
    expect(root.querySelector('input')).toBeNull();
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.choice'));
    expect(buttons.length).toBe(4);
    const texts = buttons.map((b) => b.querySelector('.choice__text')?.textContent);
    expect(texts).toContain('ka');
    expect(new Set(texts).size).toBe(4);
    const wrong = buttons.findIndex((b) => b.querySelector('.choice__text')?.textContent !== 'ka');
    act(() => buttons[wrong]?.click());
    expect(result(p)).toMatchObject({ correct: false, answer: texts[wrong] });
    expect(buttons[wrong]?.getAttribute('data-state')).toBe('wrong');
  });

  it('uses params.choices when the planner supplies them and accepts digits through the frame', () => {
    const s = step({ exposures: 0, params: { choices: ['ne', 'ka', 'su', 'mo'] } });
    const p = props({ exposures: 0, step: s });
    mount(p, true);
    key(document.body, '2');
    expect(result(p)).toMatchObject({ correct: true, answer: 'ka' });
  });

  it('display romaji that does not round-trip through the IME still counts: を "o" in choices and typed, ティ "ti" typed', () => {
    const WO: KanaItem = { ...SHI, id: 'k-h-wo', kana: 'を', romaji: 'o', row: 'w', exampleWord: { word: 'を', kana: 'を', en: 'object marker' } };
    // choices mode: the builder puts item.romaji ('o') in the grid
    const mc = props({ item: WO, exposures: 0, step: step({ itemId: WO.id, cardKey: 'k-h-wo#rec', exposures: 0, params: { choices: ['ka', 'o', 'wa', 'n'] } }) });
    mount(mc);
    const cells = Array.from(root.querySelectorAll<HTMLButtonElement>('.choice'));
    expect(cells.map((c) => c.querySelector('.choice__text')?.textContent)).toEqual(['ka', 'o', 'wa', 'n']);
    act(() => cells[1]?.click());
    expect(result(mc)).toMatchObject({ correct: true, answer: 'o' });
    expect(root.querySelector('.kana-flash__romaji')?.textContent).toBe('o · wo');

    // typed mode: 'o' is right before the IME turns it into お; so is the IME spelling 'wo'
    for (const [romaji, answer] of [
      ['o', 'o'],
      ['wo', 'を'],
    ] as const) {
      const p = props({ item: WO, step: step({ itemId: WO.id, cardKey: 'k-h-wo#rec' }) });
      const input = mount(p) as HTMLInputElement;
      type(input, romaji);
      expect(p.onResult).toHaveBeenCalledTimes(1);
      expect(result(p)).toMatchObject({ correct: true, nearMiss: false, answer });
    }

    const THI: KanaItem = { ...SHI, id: 'k-k-thi', kana: 'ティ', romaji: 'ti', script: 'katakana', row: 'ext', type: 'extended', exampleWord: { word: 'パーティー', kana: 'パーティー', en: 'party' } };
    const t = props({ item: THI, step: step({ itemId: THI.id, cardKey: 'k-k-thi#rec' }) });
    const i2 = mount(t) as HTMLInputElement;
    type(i2, 'ti');
    expect(result(t)).toMatchObject({ correct: true, answer: 'ti' });
    expect(root.querySelector('.kana-flash__romaji')?.textContent).toBe('ti · thi');

    // the self-built grid for を never offers 'wo' as a distractor beside 'o'
    const auto = props({ item: WO, exposures: 0, step: step({ itemId: WO.id, cardKey: 'k-h-wo#rec', exposures: 0 }) });
    mount(auto);
    const texts = Array.from(root.querySelectorAll('.choice__text')).map((c) => c.textContent);
    expect(texts).toContain('o');
    expect(texts).not.toContain('wo');
  });

  it('imeRomaji / romajiLabel: display romaji when it round-trips, else the id spelling', () => {
    expect(imeRomaji(SHI)).toBe('shi');
    expect(romajiLabel(SHI)).toBe('shi');
    expect(imeRomaji({ id: 'k-h-wo', kana: 'を', romaji: 'o' })).toBe('wo');
    expect(romajiLabel({ id: 'k-h-wo', kana: 'を', romaji: 'o' })).toBe('o · wo');
    expect(imeRomaji({ id: 'k-k-thi', kana: 'ティ', romaji: 'ti' })).toBe('thi');
    expect(imeRomaji({ id: 'k-k-dhu', kana: 'デュ', romaji: 'dyu' })).toBe('dhu');
    expect(imeRomaji({ id: 'k-k-who', kana: 'ウォ', romaji: 'wo' })).toBe('who');
    expect(imeRomaji({ id: 'k-k-wo', kana: 'ヲ', romaji: 'o' })).toBe('wo');
    expect(romajiDistractors('o', rngFor('seed', 3), 3, 'を')).not.toContain('wo');
  });

  it('a Kunrei option counts as the answer (si for し)', () => {
    const s = step({ itemId: SHI.id, cardKey: 'k-h-shi#rec', exposures: 0, params: { choices: ['si', 'ki', 'ti', 'hi'] } });
    const p = props({ item: SHI, exposures: 0, step: s });
    mount(p);
    act(() => (root.querySelectorAll<HTMLButtonElement>('.choice')[0] as HTMLButtonElement).click());
    expect(result(p)).toMatchObject({ correct: true });
  });
});

describe('<KanaFlash> degraded states', () => {
  it('a missing item shows the notice and continues as a soft timeout', () => {
    const p = props({ item: null });
    mount(p);
    expect(root.querySelector('.missing-item')).not.toBeNull();
    act(() => (root.querySelector('.missing-item .btn') as HTMLButtonElement).click());
    expect(result(p)).toMatchObject({ correct: false, timedOut: true, guard: false });
  });
});

describe('helpers', () => {
  it('romajiMatches collapses Hepburn / Kunrei and IME variants', () => {
    expect(romajiMatches('shi', 'し')).toBe(true);
    expect(romajiMatches('si', 'し')).toBe(true);
    expect(romajiMatches('tu', 'つ')).toBe(true);
    expect(romajiMatches('ji', 'ぢ')).toBe(true);
    expect(romajiMatches('du', 'づ')).toBe(true);
    expect(romajiMatches('ka', 'き')).toBe(false);
    expect(romajiMatches('shi', 'シ')).toBe(true);
    expect(romajiMatches('', 'し')).toBe(false);
  });

  it('kanaFromId derives glyph, romaji and script from the id grammar', () => {
    expect(kanaFromId('k-h-shi')).toEqual({ glyph: 'し', romaji: 'shi', script: 'hiragana' });
    expect(kanaFromId('k-k-fa')).toEqual({ glyph: 'ファ', romaji: 'fa', script: 'katakana' });
    expect(kanaFromId('k-h-n')).toEqual({ glyph: 'ん', romaji: 'n', script: 'hiragana' });
    expect(kanaFromId('v-n5-0001')).toBeNull();
  });

  it('romajiDistractors: three distinct, never the answer, same consonant preferred, seeded', () => {
    const a = romajiDistractors('ka', rngFor('seed', 1));
    const b = romajiDistractors('ka', rngFor('seed', 1));
    expect(a).toEqual(b);
    expect(a.length).toBe(3);
    expect(new Set(a).size).toBe(3);
    expect(a).not.toContain('ka');
    expect(a.every((r) => r.startsWith('k'))).toBe(true);
    const n = romajiDistractors('n', rngFor('seed', 2));
    expect(n.length).toBe(3);
    expect(n).not.toContain('n');
  });

  it('useDrillKeys forwards digits and Enter to aria-keyshortcuts buttons and keeps Space for the drill', () => {
    const picked = vi.fn();
    const submitted = vi.fn();
    const declined = vi.fn();
    const replayed = vi.fn();
    function Probe(p: { submitDisabled: boolean }): preact.JSX.Element {
      const ref = useRef<HTMLDivElement>(null);
      useDrillKeys(ref, { onReplay: replayed });
      return (
        <div ref={ref}>
          <button type="button" aria-keyshortcuts="1" onClick={() => picked(0)} />
          <button type="button" aria-keyshortcuts="2" onClick={() => picked(1)} disabled />
          <button type="button" aria-keyshortcuts="Enter" onClick={submitted} disabled={p.submitDisabled} />
          <button type="button" class="text-answer__decline" onClick={declined} />
        </div>
      );
    }
    act(() => render(inFrame(<Probe submitDisabled={false} />), root));
    key(document.body, '1');
    key(document.body, '2');
    key(document.body, 'Enter');
    key(document.body, ' ');
    expect(picked).toHaveBeenCalledTimes(1);
    expect(picked).toHaveBeenCalledWith(0);
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(declined).not.toHaveBeenCalled();
    expect(replayed).toHaveBeenCalledTimes(1);
    // confirm step: the submit button is disabled, Enter falls back to the honest decline
    act(() => render(inFrame(<Probe submitDisabled />), root));
    key(document.body, 'Enter');
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(declined).toHaveBeenCalledTimes(1);
  });
});
