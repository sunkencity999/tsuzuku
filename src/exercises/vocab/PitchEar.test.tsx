import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';

// The contrast pool comes from the content singleton; serve test items from it.
const H = vi.hoisted(() => ({ items: new Map<string, unknown>() }));
vi.mock('@/content/loader', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/content/loader')>();
  return { ...orig, content: { ...orig.content, get: (id: string) => H.items.get(id) } };
});

import { FIXTURE, V } from '@/content/fixtures';
import type { VocabItem } from '@/content/types';
import { installServices, nullAudio, resetServices, type ClipCue } from '@/shared/audio';
import type { AttemptResult, ExerciseProps } from '@/shared/exercise-types';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { makeTestStore } from '@/store/testing';
import { PITCH_TYPES, pitchType } from '../PitchLine';
import { PitchEar, gaClipKey, gaNoteFor, gaTakePlayable, meta, minimalPairOf, pitchChoiceTypes, pitchClipsVerified, pitchPairPool, pitchTypeOfLabel } from './PitchEar';

let root: HTMLDivElement;
let clock = 1_000_000;
const speak = vi.fn<(text: string, o?: unknown) => Promise<void>>(() => Promise.resolve());

beforeEach(async () => {
  clock = 1_000_000;
  H.items.clear();
  speak.mockClear();
  await makeTestStore({ now: () => clock });
  installServices({ audio: { ...nullAudio, speak } });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

const NOMU = FIXTURE.items[V.飲む] as VocabItem; // のむ pitch 1 → 頭高 (high confidence)
const MIZU = FIXTURE.items[V.水] as VocabItem; // みず pitch 0 → 平板
const INU = FIXTURE.items[V.犬] as VocabItem; // いぬ pitch 2 → 尾高
const COFFEE = FIXTURE.items[V.コーヒー] as VocabItem; // コーヒー pitch 3 of 4 → 中高
const PATTERNS = ['平板', '頭高', '中高', '尾高'];

function step(item: VocabItem, over: Partial<Step> = {}): Step {
  return {
    id: 's1',
    block: 'reviews',
    exercise: 'pitch-ear',
    itemId: item.id,
    cardKey: `${item.id}#pitch`,
    params: { answer: PATTERNS[PITCH_TYPES.indexOf(pitchType(item.kana, item.pitch ?? 0))], choices: PATTERNS },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 3,
    estMs: 6000,
    ...over,
  };
}

type P = ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onReplay: ReturnType<typeof vi.fn> };

function props(item: VocabItem | null = NOMU, over: Partial<ExerciseProps> = {}): P {
  return {
    step: step(item ?? NOMU),
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

function mount(p: ExerciseProps, framed = false): void {
  act(() => render(null, root));
  act(() => render(framed ? inFrame(<PitchEar {...p} />, p.step) : <PitchEar {...p} />, root));
}

function key(k: string): void {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

const q = (sel: string): HTMLElement | null => root.querySelector(sel);
const glyphs = (): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('.pitch-choice'));
const result = (p: P): AttemptResult => p.onResult.mock.calls[0]?.[0] as AttemptResult;

describe('meta', () => {
  it('registers pitch-ear on the pitch facet with choice keys, TTS, no speed pressure', () => {
    expect(meta).toMatchObject({ id: 'pitch-ear', facet: 'pitch', keys: 'choices', needsTts: true, timeable: false });
  });
});

describe('<PitchEar>', () => {
  it('draws four contour glyphs and the correct index follows pitchType', () => {
    mount(props(NOMU));
    expect(glyphs().length).toBe(4);
    expect(glyphs().map((b) => b.getAttribute('data-type'))).toEqual(['heiban', 'atamadaka', 'nakadaka', 'odaka']);
    expect(glyphs().every((b) => b.querySelector('.pitch-glyph') !== null)).toBe(true);
    expect(q('.pitch-ear')?.getAttribute('data-correct-index')).toBe('1');
    mount(props(MIZU, { step: step(MIZU) }));
    expect(q('.pitch-ear')?.getAttribute('data-correct-index')).toBe('0');
    mount(props(INU, { step: step(INU) }));
    expect(q('.pitch-ear')?.getAttribute('data-correct-index')).toBe('3');
    mount(props(COFFEE, { step: step(COFFEE) }));
    expect(q('.pitch-ear')?.getAttribute('data-correct-index')).toBe('2');
  });

  it('the right glyph is Good and reveals the word’s own pitch line; the answer is the pattern name', () => {
    const p = props(NOMU);
    mount(p);
    expect(q('.pitch-line')).toBeNull();
    clock += 1700;
    act(() => glyphs()[1]?.click());
    expect(p.onResult).toHaveBeenCalledTimes(1);
    expect(result(p)).toMatchObject({ correct: true, nearMiss: false, errorTags: [], answer: '頭高', ms: 1700, replays: 0 });
    expect(glyphs()[1]?.getAttribute('data-state')).toBe('correct');
    expect(q('.pitch-contrast .pitch-line')?.getAttribute('data-type')).toBe('atamadaka');
    expect(q('.pitch-choices')?.getAttribute('data-locked')).toBe('true');
    expect(root.textContent).toContain('device voice');
    expect(root.textContent).not.toContain('dictionary pitch pattern');
    expect(q('.vocab__collocation')).not.toBeNull();
  });

  it('a wrong glyph is Again tagged pitch, with the missed glyph shown', () => {
    const p = props(NOMU);
    mount(p);
    act(() => glyphs()[0]?.click());
    expect(result(p)).toMatchObject({ correct: false, errorTags: ['pitch'], answer: '平板' });
    expect(glyphs()[0]?.getAttribute('data-state')).toBe('wrong');
    expect(glyphs()[1]?.getAttribute('data-state')).toBe('missed');
    act(() => glyphs()[1]?.click());
    expect(p.onResult).toHaveBeenCalledTimes(1);
  });

  it('digits pick through the frame and Space replays; replays are counted', () => {
    const p = props(NOMU);
    mount(p, true);
    expect(speak).toHaveBeenCalledWith('飲む', { kana: 'のむ' });
    key(' ');
    expect(speak).toHaveBeenCalledTimes(2);
    expect(p.onReplay).toHaveBeenCalledTimes(1);
    key('2');
    expect(result(p)).toMatchObject({ correct: true, replays: 1 });
    key(' ');
    expect(speak).toHaveBeenCalledTimes(2);
  });

  it('honours the planner’s choice order', () => {
    const p = props(NOMU, { step: step(NOMU, { params: { answer: '頭高', choices: ['尾高', '中高', '頭高', '平板'] } }) });
    mount(p);
    expect(glyphs().map((b) => b.getAttribute('data-type'))).toEqual(['odaka', 'nakadaka', 'atamadaka', 'heiban']);
    expect(q('.pitch-ear')?.getAttribute('data-correct-index')).toBe('2');
    act(() => glyphs()[2]?.click());
    expect(result(p)).toMatchObject({ correct: true, answer: '頭高' });
  });

  it('the contrast pair is drawn from params.distractorIds when the planner sets them, else from the item’s confusables', () => {
    const ten: VocabItem = { ...MIZU, id: 'v-n5-0103', word: '天', kana: 'あめ', meanings: ['heaven'], pitch: 1 };
    const ame0: VocabItem = { ...MIZU, id: 'v-n5-0102', word: '飴', kana: 'あめ', meanings: ['candy'], pitch: 0 };
    const ame1: VocabItem = { ...MIZU, id: 'v-n5-0101', word: '雨', kana: 'あめ', meanings: ['rain'], pitch: 1, confusables: [ten.id] };
    H.items.set(ten.id, ten);
    H.items.set(ame0.id, ame0);
    H.items.set(NOMU.id, NOMU);
    const base = step(ame1).params;

    // planner homophones: 飴 (pitch 0) is the contrast; the pool lists it first, before the confusables
    expect(pitchPairPool(ame1, { ...base, distractorIds: [ame0.id, 'v-n5-9999'] }).map((v) => v.id)).toEqual([ame0.id, ten.id]);
    const p = props(ame1, { step: step(ame1, { params: { ...base, distractorIds: [ame0.id, 'v-n5-9999'] } }) });
    mount(p);
    expect(q('[data-pair]')).toBeNull();
    act(() => glyphs()[1]?.click());
    expect(q('[data-pair]')?.getAttribute('data-pair')).toBe(ame0.id);
    expect(q('[data-pair] .pitch-line')?.getAttribute('data-type')).toBe('heiban');
    expect(root.textContent).toContain('candy');

    // without distractorIds the confusables decide: 天 shares the pitch → no contrast
    const p2 = props(ame1, { step: step(ame1) });
    mount(p2);
    act(() => glyphs()[1]?.click());
    expect(q('[data-pair]')).toBeNull();

    // distractorIds that hold no pitch homophone (飲む) fall back to confusables that do
    const ame1b: VocabItem = { ...ame1, confusables: [ame0.id] };
    const p3 = props(ame1b, { step: step(ame1b, { params: { ...base, distractorIds: [NOMU.id] } }) });
    mount(p3);
    act(() => glyphs()[1]?.click());
    expect(q('[data-pair]')?.getAttribute('data-pair')).toBe(ame0.id);
  });

  it('a word without pitch data, or no item, shows the notice and continues as a soft timeout', () => {
    const noPitch: VocabItem = { ...NOMU, pitch: undefined, pitchConfidence: undefined };
    const p = props(noPitch, { step: step(NOMU) });
    mount(p);
    expect(q('.missing-item')).not.toBeNull();
    act(() => (q('.missing-item .btn') as HTMLButtonElement).click());
    expect(result(p)).toMatchObject({ correct: false, timedOut: true });
    const n = props(null, { step: step(NOMU) });
    mount(n);
    expect(q('.missing-item')).not.toBeNull();
  });
});

describe('voice pack (design 08 §8): one source per step, verified clips only', () => {
  const ame0: VocabItem = { ...MIZU, id: 'v-n5-0102', word: '飴', kana: 'あめ', meanings: ['candy'], pitch: 0, pitchConfidence: 'high' };
  const ame1: VocabItem = { ...MIZU, id: 'v-n5-0101', word: '雨', kana: 'あめ', meanings: ['rain'], pitch: 1, pitchConfidence: 'high', confusables: [ame0.id] };
  const cue = (key: string, pitchVerified = true): ClipCue => ({ key, file: 'audio/sprites/s07/words-01-abcdef12.webm', start: 0, end: 0.6, voice: 'VOICEVOX:ずんだもん', rate: 1, pitchVerified });

  function withPack(cues: Record<string, ClipCue>): void {
    installServices({ audio: { ...nullAudio, speak, hasJaVoice: signal(true), source: signal('clips'), clipFor: (key: string) => cues[key] } });
  }
  const speakOptions = (): (unknown | undefined)[] => speak.mock.calls.map((c) => c[1]);
  const hearButtons = (): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('.pitch-contrast__hear'));

  beforeEach(() => {
    H.items.set(ame0.id, ame0);
  });

  it('with a verified cue for 雨 and none for 飴 both play through the device voice (no clip key anywhere, no #ga)', () => {
    withPack({ [ame1.id]: cue(ame1.id), [gaClipKey(ame1)]: cue(gaClipKey(ame1)) });
    const p = props(ame1, { step: step(ame1) });
    mount(p);
    expect(q('.pitch-ear')?.getAttribute('data-source')).toBe('synth');
    expect(speak).toHaveBeenCalledWith('雨', { kana: 'あめ' });
    act(() => glyphs()[1]?.click());
    expect(result(p)).toMatchObject({ correct: true, answer: '頭高' });
    expect(q('[data-pair]')?.getAttribute('data-pair')).toBe(ame0.id);
    // the contrast is heard through the same source
    act(() => hearButtons()[1]?.click());
    expect(speak).toHaveBeenLastCalledWith('飴', { kana: 'あめ' });
    act(() => hearButtons()[0]?.click());
    expect(speak).toHaveBeenLastCalledWith('雨', { kana: 'あめ' });
    expect(speakOptions().every((o) => o !== undefined && !('clip' in (o as object)))).toBe(true);
    expect(speak).not.toHaveBeenCalledWith('雨が', expect.anything());
    expect(q('.pitch-contrast__ga')).toBeNull();
    expect(root.textContent).toContain('device voice');
  });

  it('with both verified both play clips, the reveal plays #ga, and the copy says the clip follows the dictionary pattern', () => {
    withPack({ [ame1.id]: cue(ame1.id), [ame0.id]: cue(ame0.id), [gaClipKey(ame1)]: cue(gaClipKey(ame1)) });
    const p = props(ame1, { step: step(ame1) });
    mount(p, true);
    expect(q('.pitch-ear')?.getAttribute('data-source')).toBe('clips');
    expect(speak).toHaveBeenCalledWith('雨', { kana: 'あめ', clip: ame1.id });
    key(' ');
    expect(speak).toHaveBeenCalledTimes(2);
    expect(p.onReplay).toHaveBeenCalledTimes(1);
    key('2');
    expect(result(p)).toMatchObject({ correct: true, replays: 1, answer: '頭高' });
    expect(speak).toHaveBeenLastCalledWith('雨が', { kana: 'あめが', clip: gaClipKey(ame1) });
    expect(q('.pitch-contrast__ga')?.textContent).toContain('が (ga)');
    act(() => hearButtons()[1]?.click());
    expect(speak).toHaveBeenLastCalledWith('飴', { kana: 'あめ', clip: ame0.id });
    expect(speakOptions().every((o) => typeof (o as { clip?: string }).clip === 'string')).toBe(true);
    expect(root.textContent).toContain('dictionary pitch pattern');
    expect(root.textContent).toContain('VOICEVOX');
    expect(root.textContent).not.toContain('device voice');
  });

  it('a present but unverified contrast clip sends both halves to the device voice; without #ga the reveal plays nothing extra', () => {
    withPack({ [ame1.id]: cue(ame1.id), [ame0.id]: cue(ame0.id, false) });
    const p = props(ame1, { step: step(ame1) });
    mount(p);
    expect(speak).toHaveBeenCalledWith('雨', { kana: 'あめ' });
    act(() => glyphs()[0]?.click());
    expect(result(p)).toMatchObject({ correct: false, errorTags: ['pitch'] });
    expect(speak).toHaveBeenCalledTimes(1);
    expect(q('.pitch-contrast__ga')).toBeNull();

    // both verified, no #ga take in the pack: clips for the words, no extra play on reveal
    withPack({ [ame1.id]: cue(ame1.id), [ame0.id]: cue(ame0.id) });
    speak.mockClear();
    const p2 = props(ame1, { step: step(ame1) });
    mount(p2);
    act(() => glyphs()[1]?.click());
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith('雨', { kana: 'あめ', clip: ame1.id });
    expect(q('.pitch-contrast__ga')).toBeNull();
  });

  it('a #ga take the verifier rejected (pitchVerified false) is never played on reveal; an unflagged one still is', () => {
    withPack({ [ame1.id]: cue(ame1.id), [ame0.id]: cue(ame0.id), [gaClipKey(ame1)]: cue(gaClipKey(ame1), false) });
    expect(gaTakePlayable(ame1)).toBe(false);
    const p = props(ame1, { step: step(ame1) });
    mount(p);
    expect(q('.pitch-ear')?.getAttribute('data-source')).toBe('clips');
    act(() => glyphs()[1]?.click());
    expect(result(p)).toMatchObject({ correct: true });
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).not.toHaveBeenCalledWith('雨が', expect.anything());
    expect(q('.pitch-contrast__ga')).toBeNull();
    // present and not flagged either way: the plan's "when present"
    withPack({ [ame1.id]: cue(ame1.id), [ame0.id]: cue(ame0.id), [gaClipKey(ame1)]: { ...cue(gaClipKey(ame1)), pitchVerified: undefined } });
    expect(gaTakePlayable(ame1)).toBe(true);
    speak.mockClear();
    const p2 = props(ame1, { step: step(ame1) });
    mount(p2);
    act(() => glyphs()[1]?.click());
    expect(speak).toHaveBeenLastCalledWith('雨が', { kana: 'あめが', clip: gaClipKey(ame1) });
    expect(q('.pitch-contrast__ga')).not.toBeNull();
  });

  it('the が note is written for the revealed pattern: head-high 雨 dropped inside the word, flat 飴 stays high on が', () => {
    withPack({ [ame1.id]: cue(ame1.id), [ame0.id]: cue(ame0.id), [gaClipKey(ame1)]: cue(gaClipKey(ame1)), [gaClipKey(ame0)]: cue(gaClipKey(ame0)) });
    const p = props(ame1, { step: step(ame1) });
    mount(p);
    act(() => glyphs()[1]?.click());
    expect(q('.pitch-contrast__ga')?.textContent).toContain('inside the word');
    expect(q('.pitch-contrast__ga')?.textContent).toContain('が (ga)');
    // 飴 as the item (平板): the planner's distractorIds name 雨 as the contrast; its #ga take says the word stays high
    H.items.set(ame1.id, ame1);
    speak.mockClear();
    const base = step(ame0).params;
    const p2 = props(ame0, { step: step(ame0, { params: { ...base, distractorIds: [ame1.id] } }) });
    mount(p2);
    expect(q('.pitch-ear')?.getAttribute('data-source')).toBe('clips');
    act(() => glyphs()[0]?.click());
    expect(result(p2)).toMatchObject({ correct: true, answer: '平板' });
    expect(speak).toHaveBeenLastCalledWith('飴が', { kana: 'あめが', clip: gaClipKey(ame0) });
    expect(q('.pitch-contrast__ga')?.textContent).toContain('stays high');
    expect(gaNoteFor('odaka')).toContain('onto が');
    expect(gaNoteFor('atamadaka')).toBe(gaNoteFor('nakadaka'));
    for (const t of ['heiban', 'odaka', 'nakadaka', null] as const) expect(gaNoteFor(t)).toContain('が (ga)');
  });

  it('a word without a contrast gates on its own cue alone; with nullAudio the drill behaves exactly as before', () => {
    withPack({ [NOMU.id]: cue(NOMU.id) });
    const p = props(NOMU);
    mount(p);
    expect(speak).toHaveBeenCalledWith('飲む', { kana: 'のむ', clip: NOMU.id });
    act(() => glyphs()[1]?.click());
    expect(result(p)).toMatchObject({ correct: true });
    expect(root.textContent).toContain('dictionary pitch pattern');

    installServices({ audio: { ...nullAudio, speak } });
    speak.mockClear();
    const p2 = props(NOMU);
    mount(p2);
    expect(speak).toHaveBeenCalledWith('飲む', { kana: 'のむ' });
    expect(q('.pitch-ear')?.getAttribute('data-source')).toBe('synth');
  });

  it('pitchClipsVerified: both halves, or none', () => {
    const v = (ok: string[]) => (key: string) => ok.includes(key);
    expect(pitchClipsVerified(ame1, ame0, v([ame1.id, ame0.id]))).toBe(true);
    expect(pitchClipsVerified(ame1, ame0, v([ame1.id]))).toBe(false);
    expect(pitchClipsVerified(ame1, ame0, v([ame0.id]))).toBe(false);
    expect(pitchClipsVerified(ame1, null, v([ame1.id]))).toBe(true);
    expect(pitchClipsVerified(ame1, null, v([]))).toBe(false);
    expect(gaClipKey(ame1)).toBe('v-n5-0101#ga');
  });
});

describe('helpers', () => {
  it('pitchTypeOfLabel reads kanji, English and type names', () => {
    expect(pitchTypeOfLabel('平板')).toBe('heiban');
    expect(pitchTypeOfLabel('Head-high')).toBe('atamadaka');
    expect(pitchTypeOfLabel(' nakadaka ')).toBe('nakadaka');
    expect(pitchTypeOfLabel('尾高')).toBe('odaka');
    expect(pitchTypeOfLabel('flat?')).toBeNull();
  });

  it('pitchChoiceTypes keeps a complete planner order and falls back otherwise', () => {
    expect(pitchChoiceTypes({ choices: ['尾高', '中高', '頭高', '平板'] })).toEqual(['odaka', 'nakadaka', 'atamadaka', 'heiban']);
    expect(pitchChoiceTypes({ choices: ['尾高', '中高'] })).toEqual([...PITCH_TYPES]);
    expect(pitchChoiceTypes({ choices: ['尾高', '尾高', '頭高', '平板'] })).toEqual([...PITCH_TYPES]);
    expect(pitchChoiceTypes({})).toEqual([...PITCH_TYPES]);
  });

  it('minimalPairOf finds a homophone with a different pitch (雨 / 飴) and ignores the rest', () => {
    const ame1: VocabItem = { ...MIZU, id: 'v-n5-0101', word: '雨', kana: 'あめ', meanings: ['rain'], pitch: 1 };
    const ame0: VocabItem = { ...MIZU, id: 'v-n5-0102', word: '飴', kana: 'あめ', meanings: ['candy'], pitch: 0 };
    const same: VocabItem = { ...MIZU, id: 'v-n5-0103', word: '天', kana: 'あめ', meanings: ['heaven'], pitch: 1 };
    const noPitch: VocabItem = { ...MIZU, id: 'v-n5-0104', word: 'アメ', kana: 'あめ', meanings: ['x'], pitch: undefined };
    expect(minimalPairOf(ame1, [same, noPitch, NOMU, ame0])?.id).toBe('v-n5-0102');
    expect(minimalPairOf(ame1, [same, NOMU])).toBeNull();
    expect(minimalPairOf(ame1, [])).toBeNull();
  });
});
