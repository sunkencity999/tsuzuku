import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, FIXTURE_DIALOGUE_ID, FIXTURE_STORY_ID, V, createFakeLoader } from '@/content/fixtures';
import { toPlain } from '@/content/ruby';
import type { StoryItem, StoryLine } from '@/content/types';
import { STT_STATE_LABEL } from '@/audio';
import { installServices, nullAudio, nullStt, resetServices, type AudioService, type SpeakOptions, type SttService } from '@/shared/audio';
import { bus } from '@/shared/events';
import type { ExerciseProps } from '@/shared/exercise-types';
import { rngFor } from '@/shared/hash';
import { cardKey } from '@/shared/ids';
import type { AttemptResult, Step } from '@/shared/session-types';
import { store } from '@/store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore } from '@/store/testing';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { windowMs } from './aizuchi';
import { chooseOptions } from './options';
import { Debrief } from './Debrief';
import type { LineOutcome } from './role-play-logic';
import { AIZUCHI_PAUSE_MS, RolePlay, meta, type RolePlayResult } from './RolePlay';
import { S } from './strings';

const DIALOGUE = FIXTURE.items[FIXTURE_DIALOGUE_ID] as StoryItem;
const loader = createFakeLoader();
const L = (i: number): StoryLine => DIALOGUE.lines[i] as StoryLine;

interface SpeakCall {
  text: string;
  o?: SpeakOptions;
}
function fakeAudio(): { audio: AudioService; calls: SpeakCall[] } {
  const calls: SpeakCall[] = [];
  const audio: AudioService = {
    ...nullAudio,
    muted: signal(false),
    hasJaVoice: signal(true),
    speak: (text, o) => {
      calls.push({ text, o });
      return Promise.resolve();
    },
    cancel: vi.fn(),
  };
  return { audio, calls };
}
function fakeStt(alternatives: string[] | null): SttService & { calls: number } {
  const s = {
    available: true,
    calls: 0,
    recognize: () => {
      s.calls++;
      return Promise.resolve(alternatives ? { alternatives } : null);
    },
    abort: () => undefined,
  };
  return s;
}

let clock = DEFAULT_TEST_NOW;
let root: HTMLDivElement;

async function setup(save: Parameters<typeof makeTestStore>[0] = {}): Promise<void> {
  clock = DEFAULT_TEST_NOW;
  await makeTestStore({ now: () => clock, ...save, save: { settings: { furigana: 'off' }, ...(save.save ?? {}) } });
  bus.reset();
}

beforeEach(async () => {
  await setup();
  vi.useFakeTimers();
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
  vi.useRealTimers();
});

/** Advances fake timers and the store clock together, flushing resolved speech. */
async function tick(ms = 0): Promise<void> {
  clock += ms;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(text));
  if (!btn) throw new Error(`no button "${text}"`);
  return btn;
}
function clickText(text: string): void {
  const b = buttonByText(text);
  act(() => b.click());
}
/** A frame key pressed outside any input (the frame listens on window, capture phase). */
function press(key: string): void {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}
function phase(): string | null {
  return root.querySelector('.taiwa')?.getAttribute('data-phase') ?? null;
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
function optionOfKind(lineIndex: number, kind: 'best' | 'ok' | 'register-wrong' | 'grammar-wrong'): string {
  const opts = chooseOptions(L(lineIndex), { register: 'polite', get: (id) => loader.get(id), rng: rngFor(store.seed(), store.today(), FIXTURE_DIALOGUE_ID, lineIndex) });
  const o = opts.find((x) => x.kind === kind);
  if (!o) throw new Error(`line ${lineIndex} has no ${kind} option`);
  return o.text;
}

function mount(mode: 'choose' | 'build' | 'type' | 'speak', extra: { storyId?: string; loader?: typeof loader } = {}) {
  const onDone = vi.fn<(r: RolePlayResult) => void>();
  act(() => render(<RolePlay storyId={extra.storyId ?? FIXTURE_DIALOGUE_ID} mode={mode} onDone={onDone} loader={extra.loader ?? loader} />, root));
  return { onDone };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Component                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

describe('<RolePlay>', () => {
  it('meta follows the export convention: role-play, null facet, needsTts', () => {
    expect(meta).toMatchObject({ id: 'role-play', facet: null, keys: 'choices', needsTts: true, needsStt: false, selfGraded: false });
  });

  it('calm states: unknown id, and a narration with no second speaker', async () => {
    installServices({ audio: fakeAudio().audio });
    mount('choose', { storyId: 's-99-9' });
    expect(root.querySelector('.taiwa__state')?.textContent).toBe(S.loading);
    await tick();
    expect(root.querySelector('.taiwa__state--missing')?.textContent).toBe(S.notFound);
    render(null, root);
    mount('choose', { storyId: FIXTURE_STORY_ID });
    expect(root.querySelector('.taiwa__state--missing')?.textContent).toBe(S.notDialogue);
  });

  it('plays the fixture dialogue: NPC lines through slot b, learner prompts, choose grading best / ok / wrong, aizuchi hit and miss, roleplay:done with counts', async () => {
    const today = store.today();
    await setup({ cards: Object.fromEntries(DIALOGUE.vocabIds.map((id) => [cardKey(id, 'prod'), card({ due: today, s: 2, state: 2 })])) });
    const { audio, calls } = fakeAudio();
    installServices({ audio });
    const cap = captureEvents();
    const { onDone } = mount('choose');

    expect(phase()).toBe('intro');
    expect(root.textContent).toContain('You play');
    expect(root.querySelector('.taiwa__role strong')?.textContent).toBe('ハナ');
    clickText(S.begin);
    await tick();
    // line 0 (Ken) spoken on slot b, then Hana's first prompt
    expect(calls[0]).toMatchObject({ text: toPlain(L(0).ja), o: { voice: 'b' } });
    expect(phase()).toBe('learner');
    expect(root.querySelector('.taiwa__cue')?.textContent).toBe(`Say: ${L(1).en}`);
    expect(root.querySelectorAll('.taiwa__option')).toHaveLength(3);
    expect(root.querySelector('.taiwa__npc-ja')?.textContent).toBe(toPlain(L(0).ja));

    clickText(optionOfKind(1, 'best'));
    expect(phase()).toBe('feedback');
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.best);
    expect(root.querySelector('.taiwa__recast')).toBeNull();
    clickText(S.continue);
    await tick();
    expect(phase()).toBe('learner');
    expect(root.querySelector('.taiwa__npc-ja')?.textContent).toBe(toPlain(L(2).ja));

    clickText(optionOfKind(3, 'ok'));
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.ok);
    expect(root.querySelector('.taiwa__recast .taiwa__model')?.textContent).toBe(toPlain(L(3).ja));
    clickText(S.continue);
    await tick();
    // line 4 carries an aizuchi slot: the NPC waits, chips are up
    expect(phase()).toBe('slot');
    expect(root.querySelectorAll('.taiwa__chip')).toHaveLength(4);
    await tick(600);
    clickText('はい');
    expect(root.querySelector('.taiwa__slot-note')?.textContent).toBe(S.aizuchiHit);
    expect(phase()).toBe('learner');

    clickText(optionOfKind(5, 'register-wrong'));
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.wrong);
    expect(root.querySelector('.taiwa__tags .chip')?.getAttribute('data-tag')).toBe('register');
    clickText(S.continue);
    await tick();
    clickText(optionOfKind(7, 'best'));
    clickText(S.continue);
    await tick();
    clickText(optionOfKind(9, 'grammar-wrong'));
    expect(root.querySelector('.taiwa__tags .chip')?.getAttribute('data-tag')).toBe('word-order');
    clickText(S.continue);
    await tick();
    // line 10: let the window close — the NPC pauses visibly, then continues
    expect(phase()).toBe('slot');
    await tick(windowMs(store.profile.value.belt) + AIZUCHI_PAUSE_MS + 1);
    expect(phase()).toBe('learner');
    expect(root.querySelector('.taiwa__slot-note')?.textContent).toBe(`ケン waited for a nod. Fill the pause next time.`);
    clickText(optionOfKind(11, 'best'));
    clickText(S.continue);
    await tick();

    expect(phase()).toBe('debrief');
    const expected: RolePlayResult = { best: 3, total: 6, aizuchiHit: 1, aizuchiTotal: 2, registerOk: false };
    expect(onDone).toHaveBeenCalledWith(expected);
    const ev = cap.events.filter(([n]) => n === 'roleplay:done');
    cap.stop();
    expect(ev).toHaveLength(1);
    expect(ev[0]?.[1]).toEqual({ storyId: FIXTURE_DIALOGUE_ID, ...expected });
    expect(root.textContent).toContain('3 of 6 lines at their best');
    expect(root.textContent).toContain('1 of 2 backchannels on time');
    expect(root.textContent).toContain(S.registerSlipOne);
    expect(root.querySelectorAll('.taiwa__correction')).toHaveLength(3);
    // standalone: implicit prod grades were written (Good on おはよう, Again on 食べる)
    expect(store.cards.get(cardKey(V.おはよう, 'prod'))?.[3]).toBe(1);
    expect(store.cards.get(cardKey(V.食べる, 'prod'))?.[4]).toBe(1);
    // the white belt never tags a missed slot
    expect(root.querySelector('.taiwa__slots .chip[data-hit="false"]')?.textContent).toContain(S.slotMissed);
  });

  it('type mode: typed lines are matched against ja ∪ accept; a casual, incomplete answer is recast with word-choice + register', async () => {
    installServices({ audio: fakeAudio().audio });
    mount('type');
    clickText(S.begin);
    await tick();
    const input = () => root.querySelector('input') as HTMLInputElement;
    type(input(), 'ohayoukenn');
    expect(input().value).toBe('おはようけん');
    enter(input());
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.best);
    clickText(S.continue);
    await tick();
    type(input(), 'unnnomu');
    clickText(S.submit);
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.wrong);
    expect(root.querySelector('.taiwa__recast .taiwa__model')?.textContent).toBe(toPlain(L(3).ja));
    expect(Array.from(root.querySelectorAll('.taiwa__tags .chip')).map((c) => c.getAttribute('data-tag'))).toEqual(['word-choice', 'register']);
    clickText(S.continue);
    await tick();
    await tick(200);
    clickText('はい');
    // the accept[] surface is best too; a hint before it caps the line at ok
    clickText(S.hint);
    expect(root.querySelector('.taiwa__hint-box')?.textContent).toContain('パン、食べます');
    type(input(), 'watashimotabemasu');
    enter(input());
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.ok);
  });

  it('build mode: tiles never show the gold order; the gold order is best, another order is word-order', async () => {
    installServices({ audio: fakeAudio().audio });
    mount('build');
    clickText(S.begin);
    await tick();
    const tiles = () => Array.from(root.querySelectorAll('.taiwa__tiles .taiwa__tile')).map((b) => b.textContent?.replace(/^\d/, ''));
    expect(tiles()).toEqual(['ケン', 'おはよう']);
    clickText(S.submit);
    expect(root.querySelector('.taiwa__note')?.textContent).toBe(S.nothingBuilt);
    clickText('おはよう');
    clickText('ケン');
    expect(root.querySelector('.taiwa__built')?.textContent).toBe('おはようケン');
    clickText(S.submit);
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.best);
    clickText(S.continue);
    await tick();
    expect(tiles()).toEqual(['飲みます', 'はい']);
    clickText('飲みます');
    clickText('はい');
    clickText(S.submit);
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.wrong);
    expect(root.querySelector('.taiwa__tags .chip')?.getAttribute('data-tag')).toBe('word-order');
  });

  it('speak mode names a typed recognizer failure (microphone blocked) in place of "nothing heard"', async () => {
    const stt = { ...fakeStt(null), state: signal<'denied'>('denied') };
    installServices({ audio: fakeAudio().audio, stt });
    mount('speak');
    clickText(S.begin);
    await tick();
    clickText(S.speak);
    await tick();
    expect(root.querySelector('.taiwa__note')?.textContent).toBe(STT_STATE_LABEL.denied);
    expect(root.textContent).not.toContain(S.nothingHeard);
    expect(buttonByText(S.typeInstead)).toBeDefined();
  });

  it('speak mode: recognition is scored best-of-alternatives; nothing heard offers a retry or typing; no recognizer → Type mode with a notice', async () => {
    installServices({ audio: fakeAudio().audio, stt: fakeStt(['おはよう、けん。', 'おはよう']) });
    mount('speak');
    expect(root.textContent).toContain('Mode: Speak');
    clickText(S.begin);
    await tick();
    clickText(S.speak);
    await tick();
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.best);
    expect(root.textContent).toContain('Heard: おはよう、けん。');
    render(null, root);

    installServices({ stt: fakeStt(null) });
    mount('speak');
    clickText(S.begin);
    await tick();
    clickText(S.speak);
    await tick();
    expect(root.querySelector('.taiwa__note')?.textContent).toBe(S.nothingHeard);
    expect(buttonByText(S.tryAgain)).toBeDefined();
    clickText(S.typeInstead);
    expect(root.querySelector('input')).not.toBeNull();
    render(null, root);

    installServices({ stt: nullStt });
    mount('speak');
    expect(root.textContent).toContain('Mode: Type');
    expect(root.querySelector('.taiwa__notice')?.textContent).toBe(S.speakUnavailable);
  });

  it('register switching: a registerTarget on an NPC line re-targets the next learner lines and shows the shift', async () => {
    const switched: StoryItem = { ...DIALOGUE, lines: DIALOGUE.lines.map((l, i) => (i === 2 ? { ...l, registerTarget: 'casual' } : l)) };
    const custom = createFakeLoader({ ...FIXTURE, items: { ...FIXTURE.items, [FIXTURE_DIALOGUE_ID]: switched } });
    installServices({ audio: fakeAudio().audio });
    mount('type', { loader: custom });
    clickText(S.begin);
    await tick();
    const input = () => root.querySelector('input') as HTMLInputElement;
    type(input(), 'ohayouken');
    enter(input());
    clickText(S.continue);
    await tick();
    expect(root.textContent).toContain('Register shift: casual');
    expect(root.textContent).toContain('Register: casual');
    type(input(), 'hainomimasu');
    enter(input());
    // the gold line itself is still best (verbatim wins)
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.best);
    clickText(S.continue);
    await tick();
    await tick(100);
    // a casual target offers the casual backchannel set
    expect(Array.from(root.querySelectorAll('.taiwa__chip')).map((c) => c.textContent?.replace(/^\d/, ''))).toEqual(['うん', 'へー', 'へえ', 'そっか']);
    clickText('うん');
    // a polite non-verbatim line is the gold line's own register, never a slip (round 2, #1); a mixed line still slips
    type(input(), 'hai,panwotabemasu');
    enter(input());
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.ok);
    expect(root.querySelectorAll('.taiwa__tags .chip')).toHaveLength(0);
  });

  it('round 2 #1: without an explicit target the register chip follows the gold line, not the dialogue', async () => {
    const casual: StoryItem = { ...DIALOGUE, register: 'casual' };
    const custom = createFakeLoader({ ...FIXTURE, items: { ...FIXTURE.items, [FIXTURE_DIALOGUE_ID]: casual } });
    installServices({ audio: fakeAudio().audio });
    mount('type', { loader: custom });
    clickText(S.begin);
    await tick();
    // line 1 (おはよう、ケン。) is casual like the dialogue; line 3 (はい、飲みます。) is polite, and the chip says so
    expect(root.querySelector('.taiwa__meta [data-register]')?.getAttribute('data-register')).toBe('casual');
    const input = () => root.querySelector('input') as HTMLInputElement;
    type(input(), 'ohayouken');
    enter(input());
    clickText(S.continue);
    await tick();
    expect(root.textContent).toContain('Register: polite');
    expect(root.querySelector('.taiwa__meta [data-register]')?.getAttribute('data-register')).toBe('polite');
    // the backchannel set still follows the dialogue's register (casual): no target is in force
    type(input(), 'hainomimasu');
    enter(input());
    clickText(S.continue);
    await tick();
    expect(phase()).toBe('slot');
    expect(Array.from(root.querySelectorAll('.taiwa__chip')).map((c) => c.textContent?.replace(/^\d/, ''))).toEqual(['うん', 'へー', 'へえ', 'そっか']);
  });

  it('round 2 #3: the aizuchi set follows the register in force at the slot, not the dialogue register', async () => {
    // casual dialogue; the NPC slot line carries registerTarget 'polite' (田中さん in s-47-2)
    const casual: StoryItem = { ...DIALOGUE, register: 'casual', lines: DIALOGUE.lines.map((l, i) => (i === 4 ? { ...l, registerTarget: 'polite' } : l)) };
    const custom = createFakeLoader({ ...FIXTURE, items: { ...FIXTURE.items, [FIXTURE_DIALOGUE_ID]: casual } });
    installServices({ audio: fakeAudio().audio });
    mount('choose', { loader: custom });
    clickText(S.begin);
    await tick();
    clickText(optionOfKind(1, 'best'));
    clickText(S.continue);
    await tick();
    clickText(optionOfKind(3, 'best'));
    clickText(S.continue);
    await tick();
    expect(phase()).toBe('slot');
    expect(root.textContent).toContain('Register shift: polite');
    expect(Array.from(root.querySelectorAll('.taiwa__chip')).map((c) => c.textContent?.replace(/^\d/, ''))).toEqual(['はい', 'ええ', 'そうですね', 'へえ']);
    await tick(300);
    clickText('はい');
    expect(root.querySelector('.taiwa__slot-note')?.textContent).toBe(S.aizuchiHit);
    render(null, root);

    // the mirror: a casual slot under a polite dialogue offers うん, and はい is off-register there
    const mirror: StoryItem = { ...DIALOGUE, lines: DIALOGUE.lines.map((l, i) => (i === 4 ? { ...l, registerTarget: 'casual' } : l)) };
    const custom2 = createFakeLoader({ ...FIXTURE, items: { ...FIXTURE.items, [FIXTURE_DIALOGUE_ID]: mirror } });
    mount('choose', { loader: custom2 });
    clickText(S.begin);
    await tick();
    clickText(optionOfKind(1, 'best'));
    clickText(S.continue);
    await tick();
    clickText(optionOfKind(3, 'best'));
    clickText(S.continue);
    await tick();
    expect(phase()).toBe('slot');
    expect(Array.from(root.querySelectorAll('.taiwa__chip')).map((c) => c.textContent?.replace(/^\d/, ''))).toEqual(['うん', 'へー', 'へえ', 'そっか']);
    await tick(300);
    clickText('うん');
    expect(root.querySelector('.taiwa__slot-note')?.textContent).toBe(S.aizuchiHit);
  });

  it('round 2 #4: without an audible voice, partner lines wait for Continue, a run stays readable and the slot opens only after it', async () => {
    // lines 0–2 become one three-line partner run (ハナ keeps her later lines)
    const run: StoryItem = { ...DIALOGUE, lines: DIALOGUE.lines.map((l, i) => (i === 1 ? { ...l, speaker: 'ケン' } : l)) };
    const custom = createFakeLoader({ ...FIXTURE, items: { ...FIXTURE.items, [FIXTURE_DIALOGUE_ID]: run } });
    const audio = { ...nullAudio, hasJaVoice: signal(false), speak: vi.fn(() => Promise.resolve()) };
    installServices({ audio });
    mount('choose', { loader: custom });
    expect(root.querySelector('.taiwa__notice--voice')?.textContent).toBe(S.noVoice);
    clickText(S.begin);
    await tick();
    await tick(5000);
    // nothing advanced on its own; the first line is up with a Continue button and no replay control
    expect(phase()).toBe('npc');
    expect(root.querySelector('.taiwa__progress')?.textContent).toContain('1 / 12');
    expect(root.querySelector('.taiwa__npc-ja')?.textContent).toBe(toPlain(L(0).ja));
    expect(root.querySelector('[data-action="npc-continue"]')).not.toBeNull();
    expect(Array.from(root.querySelectorAll('button')).some((b) => b.textContent === S.replayLine)).toBe(false);
    expect(audio.speak).not.toHaveBeenCalled();
    clickText(S.continue);
    await tick();
    expect(phase()).toBe('npc');
    expect(root.querySelector('.taiwa__progress')?.textContent).toContain('2 / 12');
    clickText(S.continue);
    await tick();
    expect(root.querySelector('.taiwa__progress')?.textContent).toContain('3 / 12');
    // the two earlier lines of the run are listed under the current one
    expect(Array.from(root.querySelectorAll('.taiwa__run li')).map((li) => li.textContent)).toEqual([`ケン${toPlain(L(0).ja)}`, `ケン${toPlain(L(1).ja)}`]);
    clickText(S.continue);
    await tick();
    expect(phase()).toBe('learner');
    // the run stays readable while the learner answers
    expect(root.querySelectorAll('.taiwa__run li')).toHaveLength(2);
    clickText(optionOfKind(3, 'best'));
    clickText(S.continue);
    await tick();
    // line 4 carries a slot: it is shown as text first; the window opens only on Continue
    expect(phase()).toBe('npc');
    await tick(windowMs(store.profile.value.belt) + AIZUCHI_PAUSE_MS + 1);
    expect(phase()).toBe('npc');
    expect(root.querySelector('.taiwa__slot-note')).toBeNull();
    clickText(S.continue);
    expect(phase()).toBe('slot');
    await tick(200);
    clickText('はい');
    expect(root.querySelector('.taiwa__slot-note')?.textContent).toBe(S.aizuchiHit);
    expect(phase()).toBe('learner');
  });

  it('round 2 #5: Choose options and Build tiles carry the line\'s furigana under the furigana setting', async () => {
    await setup({ save: { settings: { furigana: 'always' } } });
    installServices({ audio: fakeAudio().audio });
    mount('choose');
    clickText(S.begin);
    await tick();
    clickText(optionOfKind(1, 'best'));
    clickText(S.continue);
    await tick();
    // line 3: はい、{飲|の}みます。 — every option that carries 飲 reads の
    const rts = Array.from(root.querySelectorAll('.taiwa__option ruby rt')).map((rt) => rt.textContent);
    expect(rts.length).toBeGreaterThan(0);
    expect(rts.every((t) => t === 'の')).toBe(true);
    const withKanji = Array.from(root.querySelectorAll('.taiwa__option')).filter((b) => /飲/.test(b.textContent ?? ''));
    expect(withKanji.every((b) => b.querySelector('ruby rt') !== null)).toBe(true);
    // the option is still announced by its plain text
    expect(withKanji[0]?.getAttribute('aria-label')).toMatch(/^Option \d: .*飲/);
    expect(withKanji[0]?.getAttribute('aria-label')).not.toMatch(/[{|}]/);
    render(null, root);

    mount('build');
    clickText(S.begin);
    await tick();
    clickText('おはよう');
    clickText('ケン');
    clickText(S.submit);
    clickText(S.continue);
    await tick();
    expect(Array.from(root.querySelectorAll('.taiwa__tiles .taiwa__tile ruby rt')).map((rt) => rt.textContent)).toEqual(['の']);
    render(null, root);

    // furigana off: plain text, no ruby
    await setup({ save: { settings: { furigana: 'off' } } });
    mount('choose');
    clickText(S.begin);
    await tick();
    clickText(optionOfKind(1, 'best'));
    clickText(S.continue);
    await tick();
    expect(root.querySelector('.taiwa__option ruby')).toBeNull();
  });

  it('as an exercise it reads params, tags a missed slot from Green, reports once through onResult and never writes cards itself', async () => {
    await setup({ save: { profile: { belt: 'green' }, progress: { station: 16 } } });
    const { audio, calls } = fakeAudio();
    installServices({ audio });
    const cap = captureEvents();
    const onResult = vi.fn<(r: AttemptResult) => void>();
    const onReplay = vi.fn();
    const step: Step = {
      id: 'rp-1',
      block: 'output',
      exercise: 'role-play',
      itemId: FIXTURE_DIALOGUE_ID,
      cardKey: null,
      params: { storyId: FIXTURE_DIALOGUE_ID, mode: 'choose', rate: 1 },
      timed: false,
      isNew: false,
      stepTag: null,
      exposures: 0,
      estMs: 180000,
    };
    const props: ExerciseProps = {
      step,
      item: DIALOGUE,
      feel: 'dojo',
      furigana: 'off',
      jj: false,
      speedTier: 3,
      exposures: 0,
      onResult,
      onHint: () => undefined,
      onReplay,
      requestJudge: () => Promise.resolve(true),
    };
    act(() => render(<RolePlay {...props} />, root));
    clickText(S.begin);
    await tick();
    expect(calls[0]?.o?.rate).toBe(1);
    clickText(S.replayLine);
    await tick();
    expect(onReplay).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    for (const i of [1, 3]) {
      clickText(optionOfKind(i, 'best'));
      clickText(S.continue);
      await tick();
    }
    expect(phase()).toBe('slot');
    await tick(windowMs('green') + AIZUCHI_PAUSE_MS + 1);
    for (const i of [5, 7, 9]) {
      clickText(optionOfKind(i, 'best'));
      clickText(S.continue);
      await tick();
    }
    expect(phase()).toBe('slot');
    clickText('はい');
    clickText(optionOfKind(11, 'best'));
    clickText(S.continue);
    await tick();
    cap.stop();
    expect(onResult).toHaveBeenCalledTimes(1);
    const r = onResult.mock.calls[0]?.[0] as AttemptResult;
    expect(r).toMatchObject({ correct: true, nearMiss: false, hintUsed: false, guard: false, score: 1, errorTags: ['aizuchi'] });
    expect(Array.isArray(r.implicit)).toBe(true);
    expect(cap.events.filter(([n]) => n === 'roleplay:done')).toHaveLength(1);
    expect(cap.events[cap.events.length - 1]?.[1]).toMatchObject({ best: 6, total: 6, aizuchiHit: 1, aizuchiTotal: 2, registerOk: true });
    expect(cap.events.some(([n]) => n === 'attempt:graded')).toBe(false);
    expect(store.cards.count()).toBe(0);
  });
});

describe('<RolePlay> inside the frame (contract #32: the hint key)', () => {
  it("type mode: the frame's ? key opens the mustInclude hint once, reports onHint and caps the line at ok", async () => {
    installServices({ audio: fakeAudio().audio });
    const onHint = vi.fn();
    const onResult = vi.fn<(r: AttemptResult) => void>();
    const s: Step = {
      id: 'rp-2',
      block: 'output',
      exercise: 'role-play',
      itemId: FIXTURE_DIALOGUE_ID,
      cardKey: null,
      params: { storyId: FIXTURE_DIALOGUE_ID, mode: 'type', rate: 1 },
      timed: false,
      isNew: false,
      stepTag: null,
      exposures: 0,
      estMs: 180000,
    };
    act(() =>
      render(
        <ExerciseFrame step={s} index={0} total={5} ki={10} combo={0} comboTier={0} timer={null} feel="dojo" feedback={null} now={() => clock} onGuard={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
          <RolePlay step={s} item={DIALOGUE} feel="dojo" furigana="off" jj={false} speedTier={3} exposures={0} onResult={onResult} onHint={onHint} onReplay={() => undefined} requestJudge={() => Promise.resolve(true)} loader={loader} />
        </ExerciseFrame>,
        root,
      ),
    );
    // intro: nothing to reveal yet
    expect(root.querySelector('.exercise-frame__hint')).toBeNull();
    clickText(S.begin);
    await tick();
    expect(phase()).toBe('learner');
    expect(root.querySelector('.exercise-frame__hint')).not.toBeNull();
    expect(root.querySelector('.taiwa__hint-box')).toBeNull();
    press('?');
    expect(onHint).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.taiwa__hint-box')).not.toBeNull();
    expect(root.querySelector('.exercise-frame__hint')).toBeNull();
    press('?');
    expect(onHint).toHaveBeenCalledTimes(1);
    // the gold line after a hint is ok, not best
    const input = root.querySelector('input') as HTMLInputElement;
    type(input, 'ohayoukenn');
    enter(input);
    expect(root.querySelector('.taiwa__feedback-line')?.textContent).toBe(S.ok);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Cast voices (design 08 §8 / §11)                                           */
/* ────────────────────────────────────────────────────────────────────────── */

describe('<RolePlay> cast voices (design 08 §8 / §11)', () => {
  it('NPC lines carry their speaker label and clip key beside the synth slot b', async () => {
    const { audio, calls } = fakeAudio();
    installServices({ audio });
    mount('choose');
    clickText(S.begin);
    await tick();
    expect(calls[0]).toMatchObject({ text: toPlain(L(0).ja), o: { voice: 'b', speaker: 'ケン', clip: `${FIXTURE_DIALOGUE_ID}#L0`, interrupt: true } });
    clickText(S.replayLine);
    await tick();
    expect(calls[1]?.o).toMatchObject({ voice: 'b', speaker: 'ケン', clip: `${FIXTURE_DIALOGUE_ID}#L0` });
  });

  it('after the learner answers, the gold line replays once in the learnerSpeaker\'s voice under "Your line, as ハナ says it"', async () => {
    const { audio, calls } = fakeAudio();
    installServices({ audio });
    mount('choose');
    clickText(S.begin);
    await tick();
    clickText(optionOfKind(1, 'best'));
    await tick();
    expect(phase()).toBe('feedback');
    const gold = (): SpeakCall[] => calls.filter((c) => c.o?.clip === `${FIXTURE_DIALOGUE_ID}#L1`);
    expect(gold()).toHaveLength(1);
    expect(gold()[0]).toMatchObject({ text: toPlain(L(1).ja), o: { voice: 'a', speaker: 'ハナ' } });
    expect(root.querySelector('[data-field="gold-replay"]')?.textContent).toBe('Your line, as ハナ says it');
    expect(root.querySelector('[data-field="gold-replay"] [lang="ja"]')?.textContent).toBe('ハナ');
    // the manual replay is the same voice
    clickText(S.hearModel);
    await tick();
    expect(gold()).toHaveLength(2);
    expect(calls[calls.length - 1]?.o).toMatchObject({ voice: 'a', speaker: 'ハナ' });
    // continuing plays the next partner line in its own cast voice; line 1 is not replayed again
    clickText(S.continue);
    await tick();
    expect(gold()).toHaveLength(2);
    expect(calls[calls.length - 1]?.o).toMatchObject({ voice: 'b', speaker: 'ケン', clip: `${FIXTURE_DIALOGUE_ID}#L2` });
    // the second answered line gets its own single replay
    clickText(optionOfKind(3, 'ok'));
    await tick();
    expect(calls.filter((c) => c.o?.clip === `${FIXTURE_DIALOGUE_ID}#L3`)).toHaveLength(1);
    expect(calls[calls.length - 1]?.o).toMatchObject({ voice: 'a', speaker: 'ハナ' });
  });

  it('a 森さん dialogue replays the gold line as 森さん: the learner role is resolved, never assumed', async () => {
    const MORI = '森さん';
    const mori: StoryItem = { ...DIALOGUE, id: 's-07-2', learnerSpeaker: MORI, lines: DIALOGUE.lines.map((l) => (l.speaker === 'ハナ' ? { ...l, speaker: MORI } : l)) };
    const custom = createFakeLoader({ ...FIXTURE, items: { ...FIXTURE.items, 's-07-2': mori } });
    const { audio, calls } = fakeAudio();
    installServices({ audio });
    mount('choose', { storyId: 's-07-2', loader: custom });
    expect(root.querySelector('.taiwa__role strong')?.textContent).toBe(MORI);
    clickText(S.begin);
    await tick();
    expect(calls[0]?.o).toMatchObject({ voice: 'b', speaker: 'ケン', clip: 's-07-2#L0' });
    clickText(optionOfKind(1, 'best'));
    await tick();
    const gold = calls.filter((c) => c.o?.clip === 's-07-2#L1');
    expect(gold).toHaveLength(1);
    expect(gold[0]?.o).toMatchObject({ voice: 'a', speaker: MORI });
    expect(root.querySelector('[data-field="gold-replay"]')?.textContent).toBe(`Your line, as ${MORI} says it`);
    expect(root.textContent).not.toContain('as ハナ says it');
  });

  it('without an audible voice there is no gold replay and no caption', async () => {
    const audio = { ...nullAudio, hasJaVoice: signal(false), speak: vi.fn(() => Promise.resolve()) };
    installServices({ audio });
    mount('choose');
    clickText(S.begin);
    await tick();
    clickText(S.continue); // the partner line is read as text
    await tick();
    expect(phase()).toBe('learner');
    clickText(optionOfKind(1, 'best'));
    expect(phase()).toBe('feedback');
    expect(audio.speak).not.toHaveBeenCalled();
    expect(root.querySelector('[data-field="gold-replay"]')).toBeNull();
    expect(root.querySelector('[data-action="hear-model"]')).toBeNull();
  });
});

/* ── design 09 (C4): the register meter is motion.css's .meter ─────────────── */
describe('<Debrief> register meter (design 09 §5.7) and RolePlay.css', () => {
  const outcome = (lineIndex: number, registerOk: boolean): LineOutcome => ({ lineIndex, kind: 'ok', given: 'x', recast: 'y', tags: [], registerOk, hintUsed: false, ms: 0 });

  it('is a .meter whose --value is the kept-register share, labelled by an .eyebrow; no width is written inline', () => {
    act(() => render(<Debrief result={{ best: 2, total: 4, aizuchiHit: 0, aizuchiTotal: 0, registerOk: false }} outcomes={[outcome(1, true), outcome(3, false)]} slots={[]} lines={DIALOGUE.lines} furigana="always" />, root));
    const meter = root.querySelector<HTMLElement>('.meter[role="meter"]');
    expect(meter).not.toBeNull();
    expect(meter!.style.getPropertyValue('--value')).toBe('0.75');
    expect(meter!.style.getPropertyValue('--meter-tone')).toBe('var(--matcha)');
    expect(meter!.getAttribute('aria-valuenow')).toBe('75');
    expect(meter!.getAttribute('aria-label')).toBe(S.registerMeter);
    expect(meter!.querySelector('.meter__fill')).not.toBeNull();
    expect(meter!.previousElementSibling?.className).toBe('eyebrow');
    expect(meter!.previousElementSibling?.textContent).toBe(S.registerMeter);
    expect(root.querySelector('[style*="width"]')).toBeNull();
    expect(root.querySelector('.taiwa__meter, [class*="__label"]')).toBeNull();
    // the correction rows label "yours" / "model" with eyebrows
    expect(root.querySelectorAll('.taiwa__correction .eyebrow')).toHaveLength(4);
  });

  it('RolePlay.css: no width/height tween, no label or meter clone, no local keyframes or reduced-motion block (§5.7, §6.6, §6.7)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/input/taiwa/RolePlay.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/transition:[^;]*\b(width|height)\b/);
    expect(css).not.toMatch(/\.taiwa__(label|meter)/);
    expect(css).not.toMatch(/@keyframes/);
    expect(css).not.toMatch(/prefers-reduced-motion|\.reduced-motion/);
    expect(css).not.toMatch(/--font-mincho/);
  });
});
