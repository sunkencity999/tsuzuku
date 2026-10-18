import { signal } from '@preact/signals';
import { render, type ComponentChildren, type JSX } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, V } from '@/content/fixtures';
import type { ContentItem } from '@/content/types';
import { installServices, nullAudio, resetServices, type AudioService, type ClipCue, type SpeakOptions } from '@/shared/audio';
import { bus } from '@/shared/events';
import { speechMorae } from '@/shared/jp';
import type { AttemptResult, Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { store } from '@/store';
import { captureEvents, makeTestStore } from '@/store/testing';
import { DICTATED_MIN_RATE, MAX_REPLAYS, SentenceListen, canCutClause, choiceAnswerIndex, clauseKana, diffTags, implicitGrades, meta, moraDiff, slipTag } from './SentenceListen';

const SENTENCE = '{犬|いぬ}は{水|みず}を{飲|の}みます。'; // いぬはみずをのみます (10 morae)

let root: HTMLDivElement;
let calls: { text: string; o?: SpeakOptions }[];

function fakeAudio(): AudioService {
  return {
    ...nullAudio,
    hasJaVoice: signal(true),
    speak: (text, o) => {
      calls.push({ text, o });
      return Promise.resolve();
    },
  };
}

beforeEach(async () => {
  await makeTestStore();
  bus.reset();
  calls = [];
  installServices({ audio: fakeAudio() });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

function step(over: Partial<Step> = {}): Step {
  return {
    id: 'sl-1',
    block: 'input',
    exercise: 'sentence-listen',
    itemId: null,
    cardKey: null,
    params: { sentence: SENTENCE, rate: 0.9 },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 0,
    estMs: 12000,
    ...over,
  };
}

function frame(s: Step, children: ComponentChildren): JSX.Element {
  return (
    <ExerciseFrame step={s} index={0} total={5} ki={10} combo={0} comboTier={0} timer={null} feel="dojo" feedback={null} now={() => 0} onGuard={() => undefined} onHint={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
      {children}
    </ExerciseFrame>
  );
}

async function mount(s: Step, framed = false) {
  const onResult = vi.fn<(r: AttemptResult) => void>();
  const onReplay = vi.fn();
  const onHint = vi.fn();
  const el = (
    <SentenceListen step={s as Step & { params: { sentence: string; rate: number } }} item={null} feel="dojo" furigana="always" jj={false} speedTier={3} exposures={0} onResult={onResult} onHint={onHint} onReplay={onReplay} requestJudge={() => Promise.resolve(true)} />
  );
  await act(async () => {
    render(framed ? frame(s, el) : el, root);
    await Promise.resolve();
  });
  const input = root.querySelector('input') as HTMLInputElement | null;
  return { onResult, onReplay, onHint, input };
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
async function clickAsync(b: HTMLButtonElement | null): Promise<void> {
  await act(async () => {
    b?.click();
    await Promise.resolve();
  });
}
function press(key: string): void {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}
const playBtn = (): HTMLButtonElement => root.querySelector('.listen__play') as HTMLButtonElement;
const lookup = (id: string): ContentItem | undefined => FIXTURE.items[id];

describe('dictation helpers', () => {
  it('meta follows the D export convention', () => {
    expect(meta).toMatchObject({ id: 'sentence-listen', facet: null, needsTts: true, keys: 'kana' });
    expect(MAX_REPLAYS).toBe(2);
  });

  it('slipTag names the slip of a cluster', () => {
    expect(slipTag('', 'あ')).toBe('vowel-length');
    expect(slipTag('ー', '')).toBe('vowel-length');
    expect(slipTag('', 'っ')).toBe('small-kana');
    expect(slipTag('が', 'は')).toBe('particle');
    expect(slipTag('か', 'が')).toBe('voicing');
    expect(slipTag('きゃ', 'きや')).toBe('small-kana');
    expect(slipTag('む', 'こ')).toBe('transcription');
    expect(slipTag('', 'ね')).toBe('transcription');
  });

  it('moraDiff aligns morae and tags each cluster; equivalent spellings never show as slips', () => {
    const d1 = moraDiff('おばさん', 'おばあさん');
    expect(d1.map((o) => o.kind)).toEqual([0, 0, 2, 0, 0]);
    expect(diffTags(d1)).toEqual(['vowel-length']);
    expect(diffTags(moraDiff('いぬがみずをのみます', 'いぬはみずをのみます'))).toEqual(['particle']);
    expect(diffTags(moraDiff('きて', 'きって'))).toEqual(['small-kana']);
    expect(diffTags(moraDiff('かき', 'かぎ'))).toEqual(['voicing']);
    const same = moraDiff('トーキョーにいきます', 'とうきょうにいきます');
    expect(same.every((o) => o.kind === 0)).toBe(true);
    expect(diffTags(same)).toEqual([]);
    expect(moraDiff('みず', 'みず').map((o) => o.mora)).toEqual(['み', 'ず']);
  });

  it('implicitGrades: content word found → Good when transcribed, Again when not; unlocated words follow the clean-dictation rule', () => {
    const pool = [`${V.水}#listen`, `${V.犬}#listen`, `${V.飲む}#listen`, 'not-a-key'] as `${string}#listen`[];
    const expected = 'いぬはみずをのみます';
    const miss = implicitGrades(pool, expected, 'いぬはみすをのみます', 0.9, lookup);
    expect(miss).toEqual([
      { cardKey: `${V.水}#listen`, rating: 1 },
      { cardKey: `${V.犬}#listen`, rating: 3 },
    ]);
    const clean = implicitGrades(pool, expected, 'いぬはみずをのみます', 1, lookup);
    expect(clean).toEqual([
      { cardKey: `${V.水}#listen`, rating: 3 },
      { cardKey: `${V.犬}#listen`, rating: 3 },
      { cardKey: `${V.飲む}#listen`, rating: 3 },
    ]);
    // an unloaded item: Good only on a clean dictation
    expect(implicitGrades(['v-n5-9999#listen'], expected, 'いぬは', 0.3, lookup)).toEqual([]);
    expect(implicitGrades(['v-n5-9999#listen'], expected, expected, 1, lookup)).toEqual([{ cardKey: 'v-n5-9999#listen', rating: 3 }]);
    // fragment mode (a clause step, design 08 §9): a word the clause does not hold was never heard → no grade, clean or not
    expect(implicitGrades(pool, 'いぬは', 'いぬは', 1, lookup, false)).toEqual([{ cardKey: `${V.犬}#listen`, rating: 3 }]);
    expect(implicitGrades(pool, 'いぬは', 'いのは', 0.66, lookup, false)).toEqual([{ cardKey: `${V.犬}#listen`, rating: 1 }]);
    expect(implicitGrades(['v-n5-9999#listen'], 'いぬは', 'いぬは', 1, lookup, false)).toEqual([]);
  });

  it('canCutClause: the cue must resolve and carry mora boundaries up to the clause end; a bare example cue or a short one does not cut', () => {
    const base: ClipCue = { key: 'k', file: 'audio/sprites/s04/x-abcdef12.webm', start: 0, end: 2, voice: 'VOICEVOX:ずんだもん', rate: 1 };
    const cues: Record<string, ClipCue> = {
      full: { ...base, morae: [120, 260, 400, 560, 700, 830, 980, 1110, 1260, 1400], clauses: [3] },
      bare: { ...base },
      short: { ...base, morae: [120, 260] },
    };
    const get = (k: string): ClipCue | undefined => cues[k];
    expect(canCutClause('full', [0, 3], 1, get)).toBe(true);
    expect(canCutClause('full', [3, 10], 1, get)).toBe(true);
    expect(canCutClause('full', [3, 11], 1, get)).toBe(false);
    expect(canCutClause('bare', [0, 3], 1, get)).toBe(false);
    expect(canCutClause('short', [0, 3], 1, get)).toBe(false);
    expect(canCutClause('short', [0, 2], 1, get)).toBe(true);
    expect(canCutClause('missing', [0, 3], 1, get)).toBe(false);
    expect(canCutClause(undefined, [0, 3], 1, get)).toBe(false);
    // the default reads the live slot: nullAudio has no pack
    expect(canCutClause('full', [0, 3], 1)).toBe(false);
  });

  it('speechMorae (shared/jp, the one body) drops punctuation and spaces; clauseKana cuts [from, to) over them, null when absent or out of range', () => {
    expect(speechMorae('いぬは、みずを のみます。')).toEqual(['い', 'ぬ', 'は', 'み', 'ず', 'を', 'の', 'み', 'ま', 'す']);
    expect(speechMorae('きょう、「はい」！')).toEqual(['きょ', 'う', 'は', 'い']);
    expect(clauseKana('いぬは、みずをのみます。', [0, 3])).toBe('いぬは');
    expect(clauseKana('いぬは、みずをのみます。', [3, 10])).toBe('みずをのみます');
    expect(clauseKana('いぬは、みずをのみます。', undefined)).toBeNull();
    expect(clauseKana('いぬは', [0, 0])).toBeNull();
    expect(clauseKana('いぬは', [2, 1])).toBeNull();
    expect(clauseKana('いぬは', [0, 4])).toBeNull();
    expect(clauseKana('いぬは', [-1, 2])).toBeNull();
    expect(clauseKana('いぬは', [0.5, 2])).toBeNull();
  });

  it('choiceAnswerIndex: exact, then fuzzy English, else -1', () => {
    expect(choiceAnswerIndex({ choices: ['The dog drinks water.', 'The cat sleeps.'], answer: 'The dog drinks water.' })).toBe(0);
    expect(choiceAnswerIndex({ choices: ['The dog drinks water.', 'The cat sleeps.'], answer: 'cat sleeps' })).toBe(1);
    expect(choiceAnswerIndex({ choices: ['a', 'b'] })).toBe(-1);
  });
});

describe('<SentenceListen> dictation', () => {
  it('plays the plain surface with its kana at params.rate on mount, and shows the speed', async () => {
    await mount(step());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ text: '犬は水を飲みます。', o: { kana: 'いぬはみずをのみます。', rate: 0.9 } });
    expect(root.querySelector('.listen__rate')?.textContent).toBe('Speed 0.9×');
    expect(root.querySelector('.listen__replays')?.textContent).toBe('2 replays left');
    expect(root.querySelector('.listen__novoice')).toBeNull();
  });

  it('score bands: clean → Good (score 1); one mora off in ten → Hard (0.9); several → Again', async () => {
    const a = await mount(step());
    type(a.input as HTMLInputElement, 'inuhamizuwonomimasu');
    enter(a.input as HTMLInputElement);
    expect(a.onResult).toHaveBeenCalledTimes(1);
    const good = a.onResult.mock.calls[0]?.[0] as AttemptResult;
    expect(good).toMatchObject({ correct: true, nearMiss: false, score: 1, errorTags: [], replays: 0 });
    expect(root.querySelector('.listen__line')?.textContent).toBe('Clean. Good.');
    expect(root.querySelector('.listen__score')?.textContent).toContain('100%');

    const b = await mount(step({ id: 'sl-2' }));
    type(b.input as HTMLInputElement, 'inuhamisuwonomimasu');
    enter(b.input as HTMLInputElement);
    const hard = b.onResult.mock.calls[0]?.[0] as AttemptResult;
    expect(hard.correct).toBe(false);
    expect(hard.nearMiss).toBe(true);
    expect(hard.score).toBeCloseTo(0.9, 5);
    expect(hard.errorTags).toEqual(['voicing']);
    expect(root.querySelector('.listen__diff .diff--extra')?.textContent).toBe('す');
    expect(root.querySelector('.listen__diff .diff--missing')?.getAttribute('data-tag')).toBe('voicing');

    const c = await mount(step({ id: 'sl-3' }));
    type(c.input as HTMLInputElement, 'inu');
    enter(c.input as HTMLInputElement);
    const again = c.onResult.mock.calls[0]?.[0] as AttemptResult;
    expect(again.correct).toBe(false);
    expect(again.nearMiss).toBe(false);
    expect(root.querySelector('.listen__line')?.textContent).toBe('Not yet. Again.');
  });

  it('replays are counted (≤ 2), forwarded to onReplay, the second shows the Hard ceiling and the third is refused', async () => {
    const { onResult, onReplay, input } = await mount(step());
    await clickAsync(playBtn());
    expect(root.querySelector('.listen__replays')?.textContent).toBe('1 replays left');
    expect(root.querySelector('.listen__ceiling')).toBeNull();
    await clickAsync(playBtn());
    expect(root.querySelector('.listen__ceiling')?.textContent).toContain('Hard');
    expect(playBtn().disabled).toBe(true);
    await clickAsync(playBtn());
    expect(calls).toHaveLength(3);
    expect(onReplay).toHaveBeenCalledTimes(2);
    type(input as HTMLInputElement, 'inuhamizuwonomimasu');
    enter(input as HTMLInputElement);
    expect(onResult.mock.calls[0]?.[0]?.replays).toBe(2);
  });

  it('Space replays through the frame', async () => {
    await mount(step(), true);
    press(' ');
    await act(() => Promise.resolve());
    expect(calls).toHaveLength(2);
  });

  it('implicit Good for every pool card on a clean dictation (≥ 0.95); a dropped content word gets Again', async () => {
    const pool = [`${V.水}#listen`, `${V.犬}#listen`] as `${string}#listen`[];
    const a = await mount(step({ params: { sentence: SENTENCE, rate: 1, pool } }));
    type(a.input as HTMLInputElement, 'inuhamizuwonomimasu');
    enter(a.input as HTMLInputElement);
    // content is not loaded in tests → the clean-dictation rule applies
    expect(a.onResult.mock.calls[0]?.[0]?.implicit).toEqual([
      { cardKey: `${V.水}#listen`, rating: 3 },
      { cardKey: `${V.犬}#listen`, rating: 3 },
    ]);
    const b = await mount(step({ id: 'sl-5', params: { sentence: SENTENCE, rate: 1, pool } }));
    type(b.input as HTMLInputElement, 'inu');
    enter(b.input as HTMLInputElement);
    expect(b.onResult.mock.calls[0]?.[0]?.implicit).toBeUndefined();
  });

  it('emits line:scored {kind:dictation} with the score, tier and replays', async () => {
    const cap = captureEvents();
    const { input } = await mount(step());
    await clickAsync(playBtn());
    type(input as HTMLInputElement, 'inuhamizuwonomimasu');
    enter(input as HTMLInputElement);
    cap.stop();
    const ev = cap.events.find(([n]) => n === 'line:scored');
    expect(ev?.[1]).toEqual({ kind: 'dictation', score: 1, pass: true, tier: 3, replays: 1 });
  });

  it('a perfect dictation at ≥ 1× becomes profile.dictatedSentence (plain surface, newest wins); Hard, slowed, hinted or replay-capped ones do not', async () => {
    expect(DICTATED_MIN_RATE).toBe(1);
    expect(store.profile.value.dictatedSentence).toBeUndefined();
    const CAT = '{猫|ねこ}が{来|き}ます。';
    const a = await mount(step({ id: 'sl-d1', params: { sentence: CAT, rate: 1 } }));
    type(a.input as HTMLInputElement, 'nekogakimasu');
    enter(a.input as HTMLInputElement);
    expect(a.onResult.mock.calls[0]?.[0]?.correct).toBe(true);
    expect(store.profile.value.dictatedSentence).toBe('猫が来ます。');

    // Hard (one mora off) at 1×: not written
    const b = await mount(step({ id: 'sl-d2', params: { sentence: SENTENCE, rate: 1 } }));
    type(b.input as HTMLInputElement, 'inuhamisuwonomimasu');
    enter(b.input as HTMLInputElement);
    expect(b.onResult.mock.calls[0]?.[0]?.nearMiss).toBe(true);
    expect(store.profile.value.dictatedSentence).toBe('猫が来ます。');

    // perfect but slowed (0.9×): not written
    const c = await mount(step({ id: 'sl-d3', params: { sentence: SENTENCE, rate: 0.9 } }));
    type(c.input as HTMLInputElement, 'inuhamizuwonomimasu');
    enter(c.input as HTMLInputElement);
    expect(c.onResult.mock.calls[0]?.[0]?.correct).toBe(true);
    expect(store.profile.value.dictatedSentence).toBe('猫が来ます。');

    // perfect at 1× after the hint: not written (the hint caps the rating at Hard)
    const d = await mount(step({ id: 'sl-d4', params: { sentence: SENTENCE, rate: 1, promptEn: 'The dog drinks water.' } }));
    await clickAsync(Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((x) => x.textContent === 'Hint') ?? null);
    type(d.input as HTMLInputElement, 'inuhamizuwonomimasu');
    enter(d.input as HTMLInputElement);
    expect(d.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
    expect(store.profile.value.dictatedSentence).toBe('猫が来ます。');

    // perfect at 1.25× under the second-replay ceiling: not written
    const e = await mount(step({ id: 'sl-d5', params: { sentence: SENTENCE, rate: 1.25 } }));
    await clickAsync(playBtn());
    await clickAsync(playBtn());
    type(e.input as HTMLInputElement, 'inuhamizuwonomimasu');
    enter(e.input as HTMLInputElement);
    expect(e.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, replays: 2 });
    expect(store.profile.value.dictatedSentence).toBe('猫が来ます。');

    // perfect at 1.25× with one replay: the newest wins
    const f = await mount(step({ id: 'sl-d6', params: { sentence: SENTENCE, rate: 1.25 } }));
    await clickAsync(playBtn());
    type(f.input as HTMLInputElement, 'inuhamizuwonomimasu');
    enter(f.input as HTMLInputElement);
    expect(store.profile.value.dictatedSentence).toBe('犬は水を飲みます。');
  });

  it('hint reveals the English (promptEn) and marks hintUsed; empty submits are nudged', async () => {
    const { onResult, onHint, input } = await mount(step({ params: { sentence: SENTENCE, rate: 1, promptEn: 'The dog drinks water.' } }));
    enter(input as HTMLInputElement);
    expect(onResult).not.toHaveBeenCalled();
    expect(root.querySelector('.listen__nudge')?.textContent).toBe('Type something first.');
    await clickAsync(root.querySelector('.listen__tools button'));
    expect(onHint).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.listen__hint')?.textContent).toContain('The dog drinks water.');
    type(input as HTMLInputElement, 'inuhamizuwonomimasu');
    enter(input as HTMLInputElement);
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
  });

  it('without a Japanese voice the sentence is shown instead (honest degrade)', async () => {
    installServices({ audio: nullAudio });
    await mount(step());
    expect(root.querySelector('.listen__novoice')?.textContent).toContain('No Japanese voice');
    expect(root.querySelector('.listen__shown rt')?.textContent).toBe('いぬ');
  });

  it('a voice that cannot be heard (canSpeak false: master volume 0) degrades the same way; a plain hasJaVoice double stays audible', async () => {
    installServices({ audio: { ...fakeAudio(), canSpeak: signal(false) } });
    await mount(step());
    expect(root.querySelector('.listen__novoice')).not.toBeNull();
    installServices({ audio: fakeAudio() });
    await mount(step({ id: 'sl-2' }));
    expect(root.querySelector('.listen__novoice')).toBeNull();
  });

  it("the frame's Enter (focus outside the field) finalizes a pending romaji tail before grading", async () => {
    const { onResult, input } = await mount(step({ params: { sentence: 'にほん', rate: 1 } }), true);
    type(input as HTMLInputElement, 'nihon');
    expect((input as HTMLInputElement).value).toBe('にほn');
    press('Enter');
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, answer: 'にほん' });
    expect((input as HTMLInputElement).value).toBe('にほん');
  });

  it('uses the speed-tier preset when params.rate is absent', async () => {
    await mount(step({ params: { sentence: SENTENCE } }));
    expect(calls[0]?.o?.rate).toBe(1);
    expect(root.querySelector('.listen__rate')?.textContent).toBe('Speed 1×');
  });
});

describe('<SentenceListen> voice pack (design 08 §8–§9)', () => {
  const CLIP = 'v-n5-0003#ex0';
  const cue: ClipCue = { key: CLIP, file: 'audio/sprites/s04/examples-01-abcdef12.webm', start: 3, end: 5.4, voice: 'VOICEVOX:ずんだもん', rate: 1, morae: [120, 260, 400, 560, 700, 830, 980, 1110, 1260, 1400], clauses: [3] };
  function withPack(keys: string[] = [CLIP]): void {
    installServices({ audio: { ...fakeAudio(), source: signal('clips'), clipFor: (key: string) => (keys.includes(key) ? { ...cue, key } : undefined) } });
  }

  it('passes params.clip through on the first play and on every replay; without it the options are unchanged', async () => {
    await mount(step({ params: { sentence: SENTENCE, rate: 1, clip: CLIP } }));
    expect(calls[0]).toEqual({ text: '犬は水を飲みます。', o: { kana: 'いぬはみずをのみます。', rate: 1, clip: CLIP } });
    await clickAsync(playBtn());
    expect(calls[1]?.o).toEqual({ kana: 'いぬはみずをのみます。', rate: 1, clip: CLIP });
    expect(calls.every((c) => !('clause' in (c.o as object)))).toBe(true);
    expect(root.querySelector('.listen')?.getAttribute('data-clause')).toBeNull();
    // the key rides along whether or not the pack can play it (the pack decides, the drill only names it)
    withPack();
    calls = [];
    await mount(step({ id: 'sl-c0', params: { sentence: SENTENCE, rate: 1, clip: CLIP } }));
    expect(calls[0]?.o).toEqual({ kana: 'いぬはみずをのみます。', rate: 1, clip: CLIP });
  });

  it('a clause step plays the sub-range of the clip and grades against the clause kana; the replay ceiling is unchanged', async () => {
    withPack();
    const { onResult, onReplay, input } = await mount(step({ params: { sentence: SENTENCE, rate: 1, clip: CLIP, clause: [0, 3] } }));
    expect(root.querySelector('.listen')?.getAttribute('data-clause')).toBe('true');
    expect(root.querySelector('.listen__clause-note')?.textContent).toContain('longer line');
    expect(calls[0]).toEqual({ text: '犬は水を飲みます。', o: { kana: 'いぬはみずをのみます。', rate: 1, clip: CLIP, clause: [0, 3] } });
    await clickAsync(playBtn());
    expect(root.querySelector('.listen__replays')?.textContent).toBe('1 replays left');
    await clickAsync(playBtn());
    expect(root.querySelector('.listen__ceiling')?.textContent).toContain('Hard');
    expect(playBtn().disabled).toBe(true);
    await clickAsync(playBtn());
    expect(calls).toHaveLength(3);
    expect(onReplay).toHaveBeenCalledTimes(2);
    expect(calls.every((c) => c.o?.clip === CLIP && JSON.stringify(c.o?.clause) === '[0,3]')).toBe(true);
    // graded against いぬは, not the whole line
    type(input as HTMLInputElement, 'inuha');
    enter(input as HTMLInputElement);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, score: 1, replays: 2, errorTags: [] });
    expect(root.querySelector('.listen__clause')?.textContent).toContain('いぬは');
    expect(root.querySelector('.listen__sentence rt')?.textContent).toBe('いぬ');
    // a clause is never the kakejiku sentence
    expect(store.profile.value.dictatedSentence).toBeUndefined();

    // the whole line typed against a clause is a miss (extra morae), with the clause-based hint
    const b = await mount(step({ id: 'sl-c2', params: { sentence: SENTENCE, rate: 1, clip: CLIP, clause: [3, 10], promptEn: 'The dog drinks water.' } }));
    await clickAsync(Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((x) => x.textContent === 'Hint') ?? null);
    expect(root.querySelector('.listen__hint')?.textContent).toContain('みず');
    expect(root.querySelector('.listen__hint')?.textContent).not.toContain('The dog');
    type(b.input as HTMLInputElement, 'inuhamizuwonomimasu');
    enter(b.input as HTMLInputElement);
    expect(b.onResult.mock.calls[0]?.[0]?.correct).toBe(false);
    const c = await mount(step({ id: 'sl-c3', params: { sentence: SENTENCE, rate: 1, clip: CLIP, clause: [3, 10] } }));
    type(c.input as HTMLInputElement, 'mizuwonomimasu');
    enter(c.input as HTMLInputElement);
    expect(c.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, score: 1 });
  });

  it('a clause step without a playable clip reads the clause kana through the device voice, so what plays is what is graded', async () => {
    const { onResult, input } = await mount(step({ params: { sentence: SENTENCE, rate: 0.9, clip: CLIP, clause: [0, 3] } }));
    expect(calls[0]).toEqual({ text: 'いぬは', o: { kana: 'いぬは', rate: 0.9 } });
    await clickAsync(playBtn());
    expect(calls[1]).toEqual({ text: 'いぬは', o: { kana: 'いぬは', rate: 0.9 } });
    type(input as HTMLInputElement, 'inuha');
    enter(input as HTMLInputElement);
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, score: 1 });
    // a clause out of range falls back to the whole line, clip key kept
    calls = [];
    await mount(step({ id: 'sl-c5', params: { sentence: SENTENCE, rate: 1, clip: CLIP, clause: [0, 99] } }));
    expect(calls[0]?.o).toEqual({ kana: 'いぬはみずをのみます。', rate: 1, clip: CLIP });
    expect(root.querySelector('.listen')?.getAttribute('data-clause')).toBeNull();
  });

  it('a clause step whose cue has no mora boundaries (an example cue) reads the clause through the device voice — the pack would play the whole line', async () => {
    const bare = (morae?: number[]): void => {
      installServices({ audio: { ...fakeAudio(), source: signal('clips'), clipFor: (key: string) => (key === CLIP ? { ...cue, key, morae, clauses: undefined } : undefined) } });
    };
    bare(undefined);
    const { onResult, input } = await mount(step({ params: { sentence: SENTENCE, rate: 1, clip: CLIP, clause: [0, 3] } }));
    expect(root.querySelector('.listen')?.getAttribute('data-clause')).toBe('true');
    expect(calls[0]).toEqual({ text: 'いぬは', o: { kana: 'いぬは', rate: 1 } });
    await clickAsync(playBtn());
    expect(calls[1]).toEqual({ text: 'いぬは', o: { kana: 'いぬは', rate: 1 } });
    type(input as HTMLInputElement, 'inuha');
    enter(input as HTMLInputElement);
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, score: 1 });
    // boundaries that stop short of the clause end count as none
    bare([120, 260]);
    calls = [];
    await mount(step({ id: 'sl-c7', params: { sentence: SENTENCE, rate: 1, clip: CLIP, clause: [0, 3] } }));
    expect(calls[0]).toEqual({ text: 'いぬは', o: { kana: 'いぬは', rate: 1 } });
    // a whole-line step still passes the same key through: the pack plays the whole cue, which is what is graded
    calls = [];
    await mount(step({ id: 'sl-c8', params: { sentence: SENTENCE, rate: 1, clip: CLIP } }));
    expect(calls[0]?.o).toEqual({ kana: 'いぬはみずをのみます。', rate: 1, clip: CLIP });
  });

  it('a clause step grades pool words in fragment mode: nothing for a word the clause does not hold, even on a clean dictation', async () => {
    withPack();
    const pool = [`${V.水}#listen`, `${V.犬}#listen`] as `${string}#listen`[];
    const a = await mount(step({ params: { sentence: SENTENCE, rate: 1, clip: CLIP, clause: [0, 3], pool } }));
    type(a.input as HTMLInputElement, 'inuha');
    enter(a.input as HTMLInputElement);
    expect(a.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, score: 1 });
    // content is not loaded in tests, so neither word can be located in いぬは; the whole-line rule would have graded both Good
    expect(a.onResult.mock.calls[0]?.[0]?.implicit).toBeUndefined();
  });

  it('without a voice the shown text is the clause for a clause step', async () => {
    installServices({ audio: nullAudio });
    await mount(step({ params: { sentence: SENTENCE, rate: 1, clip: CLIP, clause: [0, 3] } }));
    expect(root.querySelector('.listen__novoice')?.textContent).toContain('No Japanese voice');
    expect(root.querySelector('.listen__shown')?.textContent).toBe('いぬは');
  });
});

describe('<SentenceListen> choice mode', () => {
  it('renders the meaning choices, grades the pick with the listening tag on a miss, and no line:scored', async () => {
    const cap = captureEvents();
    const s = step({ params: { sentence: SENTENCE, rate: 1, choices: ['The dog drinks water.', 'The cat sleeps.', 'Ken eats bread.', 'Good morning.'], answer: 'The dog drinks water.' } });
    const { onResult } = await mount(s, true);
    expect(root.querySelectorAll('.choice').length).toBe(4);
    press('2');
    cap.stop();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, errorTags: ['listening'], answer: 'The dog drinks water.' });
    expect(root.querySelectorAll('.choice')[0]?.getAttribute('data-state')).toBe('missed');
    expect(cap.events.find(([n]) => n === 'line:scored')).toBeUndefined();
    expect(root.querySelector('.listen__line')?.textContent).toBe("Again. That's the training.");
  });

  it('a correct pick is Good and fires once', async () => {
    const s = step({ params: { sentence: SENTENCE, rate: 1, choices: ['The dog drinks water.', 'The cat sleeps.'], answer: 'The dog drinks water.' } });
    const { onResult } = await mount(s);
    const first = root.querySelectorAll<HTMLButtonElement>('.choice')[0] as HTMLButtonElement;
    await clickAsync(first);
    await clickAsync(root.querySelectorAll<HTMLButtonElement>('.choice')[1] as HTMLButtonElement);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, errorTags: [] });
  });
});
