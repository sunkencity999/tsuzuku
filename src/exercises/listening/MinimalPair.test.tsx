import { signal } from '@preact/signals';
import { render, type ComponentChildren, type JSX } from 'preact';
import { act } from 'preact/test-utils';

// The partner pool comes from the content singleton; serve test items from it.
const H = vi.hoisted(() => ({ items: new Map<string, unknown>() }));
vi.mock('@/content/loader', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/content/loader')>();
  return { ...orig, content: { ...orig.content, get: (id: string) => H.items.get(id) } };
});

import { FIXTURE, V } from '@/content/fixtures';
import type { ContentItem, VocabItem } from '@/content/types';
import { installServices, nullAudio, resetServices, type AudioService, type ClipCue, type SpeakOptions } from '@/shared/audio';
import { mulberry32 } from '@/shared/hash';
import type { AttemptResult, Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { makeTestStore } from '@/store/testing';
import { MinimalPair, meta, pairClipKey, pairFor, pairTag, pairUsesClips } from './MinimalPair';

const inu = FIXTURE.items[V.犬] as VocabItem; // いぬ
const lookup = (id: string): ContentItem | undefined => FIXTURE.items[id];

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
  H.items.clear();
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
    id: 'mp-1',
    block: 'weak',
    exercise: 'minimal-pair',
    itemId: V.犬,
    cardKey: null,
    params: { choices: ['おばさん', 'おばあさん'], answer: 'おばあさん' },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 0,
    estMs: 5000,
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

async function mount(s: Step, item: ContentItem | null = inu, framed = false) {
  const onResult = vi.fn<(r: AttemptResult) => void>();
  const onReplay = vi.fn();
  const el = <MinimalPair step={s} item={item} feel="dojo" furigana="always" jj={false} speedTier={3} exposures={0} onResult={onResult} onHint={() => undefined} onReplay={onReplay} requestJudge={() => Promise.resolve(true)} />;
  await act(async () => {
    render(framed ? frame(s, el) : el, root);
    await Promise.resolve();
  });
  return { onResult, onReplay };
}

const choices = (): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('.choice'));
const choiceText = (b: HTMLButtonElement): string => b.querySelector('.choice__text')?.textContent ?? '';
async function clickAsync(b: HTMLButtonElement | null | undefined): Promise<void> {
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

describe('minimal pair helpers', () => {
  it('meta follows the D export convention', () => {
    expect(meta).toMatchObject({ id: 'minimal-pair', facet: null, needsTts: true, keys: 'choices' });
  });

  it('pairTag names the contrast', () => {
    expect(pairTag('おばさん', 'おばあさん')).toBe('vowel-length');
    expect(pairTag('きて', 'きって')).toBe('small-kana');
    expect(pairTag('かき', 'かぎ')).toBe('voicing');
    expect(pairTag('いぬ', 'ねこ')).toBe('listening');
  });

  it('pairFor uses params.choices + params.answer when given, and is deterministic for a seed', () => {
    const a = pairFor(inu, { choices: ['おばさん', 'おばあさん'], answer: 'おばあさん' }, lookup, mulberry32(4));
    const b = pairFor(inu, { choices: ['おばさん', 'おばあさん'], answer: 'おばあさん' }, lookup, mulberry32(4));
    expect(a).toEqual(b);
    expect(a?.choices.slice().sort()).toEqual(['おばあさん', 'おばさん']);
    expect(a?.choices[a.target]).toBe('おばあさん');
    expect(a?.tag).toBe('vowel-length');
  });

  it('pairFor finds a partner from the distractor pool, or synthesizes one; the spoken side varies with the seed', () => {
    const fromPool = pairFor(inu, { distractorIds: [V.日, V.人] }, lookup, mulberry32(1)); // ひと is two morae from いぬ? no — synthesized or pool, but always a pair
    expect(fromPool).not.toBeNull();
    expect(fromPool?.choices).toContain('いぬ');
    expect(fromPool?.choices[0]).not.toBe(fromPool?.choices[1]);
    const seen = new Set<string>();
    for (let s = 0; s < 30; s++) {
      const p = pairFor(inu, {}, lookup, mulberry32(s));
      if (p) seen.add(p.choices[p.target]);
    }
    expect(seen.size).toBe(2); // the item and its partner are both heard across seeds
    expect(pairFor(null, {}, lookup, mulberry32(1))).toBeNull();
    expect(pairFor(inu, { choices: ['いぬ', 'イヌ'] }, lookup, mulberry32(1))).toBeNull();
  });

  it('pairClipKey: the item by its id, a real pool partner by its id, the synthesized partner by #pair, anything else null', () => {
    const hito = FIXTURE.items[V.人] as VocabItem; // ひと
    expect(pairClipKey(inu, 'いぬ', [hito])).toBe(V.犬);
    expect(pairClipKey(inu, 'イヌ', [])).toBe(V.犬);
    expect(pairClipKey(inu, 'ひと', [hito])).toBe(V.人);
    expect(pairClipKey(inu, 'いっぬ', [])).toBe(`${V.犬}#pair`); // synthesizeMinimalPair('いぬ')
    expect(pairClipKey(inu, 'おばあさん', [hito])).toBeNull();
    // pairFor carries the keys parallel to the display order
    const synth = pairFor(inu, {}, lookup, mulberry32(2)) as NonNullable<ReturnType<typeof pairFor>>;
    expect(synth.keys[synth.choices.indexOf('いぬ')]).toBe(V.犬);
    expect(synth.keys[1 - synth.choices.indexOf('いぬ')]).toBe(`${V.犬}#pair`);
    const given = pairFor(inu, { choices: ['おばさん', 'おばあさん'], answer: 'おばあさん' }, lookup, mulberry32(4)) as NonNullable<ReturnType<typeof pairFor>>;
    expect(given.keys).toEqual([null, null]);
    expect(pairFor(null, { choices: ['おばさん', 'おばあさん'] }, lookup, mulberry32(1))?.keys).toEqual([null, null]);
  });

  it('pairUsesClips needs both keys present and playable', () => {
    const can = (ok: string[]) => (k: string) => ok.includes(k);
    expect(pairUsesClips({ keys: ['a', 'b'] }, can(['a', 'b']))).toBe(true);
    expect(pairUsesClips({ keys: ['a', 'b'] }, can(['a']))).toBe(false);
    expect(pairUsesClips({ keys: ['a', null] }, can(['a']))).toBe(false);
    expect(pairUsesClips({ keys: [null, null] }, () => true)).toBe(false);
    expect(pairUsesClips({ keys: ['a', 'b'] })).toBe(false); // nullAudio: no clipFor
  });
});

describe('<MinimalPair>', () => {
  it('speaks the target kana on mount and shows two large kana choices', async () => {
    await mount(step());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toBe('おばあさん');
    expect(calls[0]?.o).toEqual({ kana: 'おばあさん' });
    const grid = root.querySelector('.choice-grid');
    expect(grid?.getAttribute('data-size')).toBe('lg');
    expect(choices().map(choiceText).sort()).toEqual(['おばあさん', 'おばさん']);
    expect(choices()[0]?.querySelector('[lang="ja"]')).not.toBeNull();
  });

  it('a miss yields a rating-less AttemptResult tagged with the contrast; the why line names it', async () => {
    const { onResult } = await mount(step());
    const wrong = choices().find((b) => choiceText(b) === 'おばさん') as HTMLButtonElement;
    await clickAsync(wrong);
    expect(onResult).toHaveBeenCalledTimes(1);
    const r = onResult.mock.calls[0]?.[0] as AttemptResult;
    expect(r).toMatchObject({ correct: false, nearMiss: false, errorTags: ['vowel-length'], answer: 'おばあさん', replays: 0 });
    expect('rating' in r).toBe(false);
    expect(root.querySelector('.pair__result')?.getAttribute('data-kind')).toBe('wrong');
    expect(root.querySelector('.pair__why')?.textContent).toContain('Long vowel');
    expect(wrong.getAttribute('data-state')).toBe('wrong');
  });

  it('a correct pick is tag-free; the compare buttons play either word afterwards', async () => {
    const { onResult } = await mount(step());
    const right = choices().find((b) => choiceText(b) === 'おばあさん') as HTMLButtonElement;
    await clickAsync(right);
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, errorTags: [] });
    const compare = Array.from(root.querySelectorAll<HTMLButtonElement>('.pair__compare button'));
    expect(compare.length).toBe(2);
    await clickAsync(compare[0]);
    expect(calls).toHaveLength(2);
    expect(['おばさん', 'おばあさん']).toContain(calls[1]?.text);
  });

  it('replays are unlimited, counted and forwarded; digits and Space work through the frame', async () => {
    const { onResult, onReplay } = await mount(step(), inu, true);
    const play = root.querySelector('.pair__play') as HTMLButtonElement;
    await clickAsync(play);
    await clickAsync(play);
    press(' ');
    await act(() => Promise.resolve());
    expect(calls).toHaveLength(4);
    expect(onReplay).toHaveBeenCalledTimes(3);
    const targetIdx = choices().findIndex((b) => choiceText(b) === 'おばあさん');
    press(String(targetIdx + 1));
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, replays: 3 });
    press(String(2 - targetIdx));
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('builds the pair from the item when params carry no choices (voicing / length / small kana partner)', async () => {
    const { onResult } = await mount(step({ params: {} }));
    expect(choices().length).toBe(2);
    expect(choices().map(choiceText)).toContain('いぬ');
    await clickAsync(choices()[0]);
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  describe('voice pack: never mixes sources within one step (design 08 §10.4)', () => {
    const cue = (key: string): ClipCue => ({ key, file: 'audio/sprites/s01/words-01-abcdef12.webm', start: 0, end: 0.7, voice: 'VOICEVOX:ずんだもん', rate: 1 });
    function withPack(keys: string[]): void {
      const cues = new Map(keys.map((k) => [k, cue(k)]));
      installServices({ audio: { ...fakeAudio(), source: signal('clips'), clipFor: (key: string) => cues.get(key) } });
    }
    const options = (): (SpeakOptions | undefined)[] => calls.map((c) => c.o);
    const synthOnly = (): boolean => options().every((o) => o !== undefined && !('clip' in o));
    const clipsOnly = (): boolean => options().every((o) => typeof o?.clip === 'string');

    it('with clips for the item and its #pair partner both words play as clips, keyed by surface, in every play and compare', async () => {
      withPack([V.犬, `${V.犬}#pair`]);
      const { onResult } = await mount(step({ params: {} }), inu, true);
      expect(root.querySelector('.pair')?.getAttribute('data-source')).toBe('clips');
      expect(calls).toHaveLength(1);
      const spoken = calls[0] as { text: string; o?: SpeakOptions };
      expect(spoken.o?.clip).toBe(spoken.text === 'いぬ' ? V.犬 : `${V.犬}#pair`);
      press(' ');
      await act(() => Promise.resolve());
      await clickAsync(choices()[0]);
      expect(onResult).toHaveBeenCalledTimes(1);
      const compare = Array.from(root.querySelectorAll<HTMLButtonElement>('.pair__compare button'));
      await clickAsync(compare[0]);
      await clickAsync(compare[1]);
      expect(calls).toHaveLength(4);
      expect(clipsOnly()).toBe(true);
      for (const c of calls) expect(c.o?.clip).toBe(c.text === 'いぬ' ? V.犬 : `${V.犬}#pair`);
    });

    it('with a clip for only one side (the item, not #pair) both words go through the device voice', async () => {
      withPack([V.犬]);
      const { onResult } = await mount(step({ params: {} }), inu);
      expect(root.querySelector('.pair')?.getAttribute('data-source')).toBe('synth');
      await clickAsync(root.querySelector('.pair__play') as HTMLButtonElement);
      await clickAsync(choices()[1]);
      expect(onResult).toHaveBeenCalledTimes(1);
      const compare = Array.from(root.querySelectorAll<HTMLButtonElement>('.pair__compare button'));
      await clickAsync(compare[0]);
      await clickAsync(compare[1]);
      expect(calls).toHaveLength(4);
      expect(synthOnly()).toBe(true);
      expect(new Set(calls.map((c) => c.text))).toEqual(new Set(['いぬ', 'いっぬ']));
    });

    it('planner surfaces that are not the item’s word cannot be keyed: device voice for both even when the pack has the item', async () => {
      withPack([V.犬, `${V.犬}#pair`]);
      await mount(step());
      expect(calls[0]?.o).toEqual({ kana: 'おばあさん' });
      await clickAsync(root.querySelector('.pair__play') as HTMLButtonElement);
      expect(synthOnly()).toBe(true);
    });

    it("the planner's own step shape — choices + answer + rate, with distractorIds naming the real partner — plays both words as clips keyed by item id; without the id the partner cannot be keyed", async () => {
      const hito = FIXTURE.items[V.人] as VocabItem; // ひと
      H.items.set(V.人, hito);
      withPack([V.犬, V.人]);
      // what session/params.ts builds for 'minimal-pair' once it carries the partner id (see the integrator notes)
      const planned = { choices: [hito.kana, inu.kana], answer: hito.kana, rate: 1, distractorIds: [V.人] };
      const { onResult } = await mount(step({ params: planned }), inu, true);
      expect(root.querySelector('.pair')?.getAttribute('data-source')).toBe('clips');
      expect(calls[0]).toEqual({ text: hito.kana, o: { kana: hito.kana, clip: V.人 } });
      press(' ');
      await act(() => Promise.resolve());
      await clickAsync(choices()[0]);
      expect(onResult).toHaveBeenCalledTimes(1);
      const compare = Array.from(root.querySelectorAll<HTMLButtonElement>('.pair__compare button'));
      await clickAsync(compare[0]);
      await clickAsync(compare[1]);
      expect(calls).toHaveLength(4);
      expect(clipsOnly()).toBe(true);
      for (const c of calls) expect(c.o?.clip).toBe(c.text === inu.kana ? V.犬 : V.人);
      // the same step without distractorIds (today's planner): the partner surface cannot be keyed → device voice for both
      calls = [];
      await mount(step({ id: 'mp-4', params: { choices: planned.choices, answer: planned.answer, rate: 1 } }), inu);
      expect(root.querySelector('.pair')?.getAttribute('data-source')).toBe('synth');
      expect(calls[0]).toEqual({ text: hito.kana, o: { kana: hito.kana } });
      await clickAsync(root.querySelector('.pair__play') as HTMLButtonElement);
      expect(synthOnly()).toBe(true);
    });

    it('a real pool partner is keyed by its own item id', async () => {
      const hito = FIXTURE.items[V.人] as VocabItem; // ひと: two morae from いぬ
      H.items.set(V.人, hito);
      withPack([V.犬, V.人]);
      await mount(step({ params: { distractorIds: [V.人] } }), inu);
      expect(choices().map(choiceText).sort()).toEqual(['いぬ', hito.kana].sort());
      expect(root.querySelector('.pair')?.getAttribute('data-source')).toBe('clips');
      expect(calls[0]?.o?.clip).toBe(calls[0]?.text === 'いぬ' ? V.犬 : V.人);
      // the same pool without the partner's clip: device voice for both
      withPack([V.犬]);
      calls = [];
      await mount(step({ id: 'mp-3', params: { distractorIds: [V.人] } }), inu);
      expect(root.querySelector('.pair')?.getAttribute('data-source')).toBe('synth');
      expect(calls[0]?.o).toEqual({ kana: calls[0]?.text });
    });
  });

  it('a voice that cannot be heard (canSpeak false) shows the spoken word too', async () => {
    installServices({ audio: { ...fakeAudio(), canSpeak: signal(false) } });
    await mount(step());
    expect(root.querySelector('.pair__novoice .pair__shown')?.textContent).toBe('おばあさん');
  });

  it('without a Japanese voice the spoken word is shown; without a pair the step offers Continue', async () => {
    installServices({ audio: nullAudio });
    await mount(step());
    expect(root.querySelector('.pair__novoice .pair__shown')?.textContent).toBe('おばあさん');
    const { onResult } = await mount(step({ id: 'mp-2', params: {} }), null);
    expect(root.querySelector('.choice-grid')).toBeNull();
    await clickAsync(root.querySelector('.hanko') as HTMLButtonElement);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]?.correct).toBe(true);
  });
});
