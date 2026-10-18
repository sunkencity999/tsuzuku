import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { V, createFakeLoader } from '@/content/fixtures';
import { MISSIONS } from '@/shared/catalog';
import { bus } from '@/shared/events';
import type { AttemptResult, Step } from '@/shared/session-types';
import { epochDay } from '@/shared/time';
import { store } from '@/store';
import { DEFAULT_TEST_NOW, captureEvents, makeTestStore, type TestStoreOptions } from '@/store/testing';
import { S } from '../strings';
import { FieldMission, GAP_TAGS, gapSlots, meta, missionFor, resolveGap, sanitizeMinutes } from './FieldMission';

const loader = createFakeLoader();
const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
let root: HTMLDivElement;
let clock: number;

async function setup(o: TestStoreOptions = {}): Promise<void> {
  clock = DEFAULT_TEST_NOW;
  await makeTestStore({ now: () => clock, ...o, save: { progress: { station: 4 }, profile: { belt: 'blue' }, ...(o.save ?? {}) } });
  bus.reset();
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

function step(over: Partial<Step> = {}): Step {
  return {
    id: 'fm-1',
    block: 'output',
    exercise: 'field-mission',
    itemId: null,
    cardKey: null,
    params: { missionId: 'real-conversation' },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 0,
    estMs: 60000,
    ...over,
  };
}

async function mount(s: Step) {
  const onResult = vi.fn<(r: AttemptResult) => void>();
  await act(async () => {
    render(<FieldMission step={s} item={null} feel="dojo" furigana="always" jj={false} speedTier={3} exposures={0} onResult={onResult} onHint={() => undefined} onReplay={() => undefined} requestJudge={() => Promise.resolve(true)} loader={loader} />, root);
    await Promise.resolve();
  });
  return { onResult };
}

const q = <T extends Element = HTMLElement>(sel: string): T | null => root.querySelector<T>(sel);
async function click(sel: string): Promise<void> {
  const el = q<HTMLButtonElement>(sel);
  expect(el, sel).not.toBeNull();
  await act(async () => {
    el!.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}
function input(sel: string, value: string): void {
  const el = q<HTMLInputElement>(sel);
  expect(el, sel).not.toBeNull();
  act(() => {
    el!.value = value;
    el!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function select(sel: string, value: string): void {
  const el = q<HTMLSelectElement>(sel);
  expect(el, sel).not.toBeNull();
  act(() => {
    el!.value = value;
    el!.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('field-mission helpers', () => {
  it('meta: field-mission, null facet, no keys, self-reported', () => {
    expect(meta).toEqual({ id: 'field-mission', facet: null, needsTts: false, needsStt: false, selfGraded: true, timeable: false, keys: 'none' });
    expect(GAP_TAGS).toContain('word-choice');
  });

  it('missionFor: by id, else the highest tier the station and belt have opened, else null', () => {
    expect(missionFor({ missionId: 'order-in-japanese' }, 3, 'white')?.tier).toBe(2);
    expect(missionFor({ missionId: 'no-such' }, 3, 'white')?.id).toBe('read-aloud-sign');
    expect(missionFor({}, 3, 'white')?.id).toBe('read-aloud-sign');
    expect(missionFor({}, 10, 'yellow')?.id).toBe('order-in-japanese'); // tier 3 needs Orange
    expect(missionFor({}, 10, 'orange')?.id).toBe('subtitled-twenty');
    expect(missionFor({}, 30, 'blue')?.id).toBe('real-conversation');
    expect(missionFor({}, 1, 'white')).toBeNull();
    expect(MISSIONS.map((m) => m.tier)).toEqual([1, 2, 3, 4, 5]);
  });

  it('gapSlots: three words on the subtitles mission, two gaps after a conversation, one otherwise', () => {
    expect(gapSlots(MISSIONS[2]!)).toEqual({ count: 3, title: S.missionWordsTitle });
    expect(gapSlots(MISSIONS[4]!)).toEqual({ count: 2, title: S.missionGapsTitle });
    expect(gapSlots(MISSIONS[0]!)).toEqual({ count: 1, title: S.missionGapsTitle });
  });

  it('resolveGap captures through the surfaces map, bookmarks the rest, ignores blanks', () => {
    const surfaces = { コーヒー: V.コーヒー, のむ: V.飲む, 'st-04': 'st-04' };
    expect(resolveGap(' コーヒー ', surfaces)).toEqual({ kind: 'captured', itemId: V.コーヒー, text: 'コーヒー' });
    expect(resolveGap('のむ', surfaces)).toEqual({ kind: 'captured', itemId: V.飲む, text: 'のむ' });
    expect(resolveGap('st-04', surfaces)).toEqual({ kind: 'bookmarked', text: 'st-04' });
    expect(resolveGap('the word for umbrella', surfaces)).toEqual({ kind: 'bookmarked', text: 'the word for umbrella' });
    expect(resolveGap('umbrella', null)).toEqual({ kind: 'bookmarked', text: 'umbrella' });
    expect(resolveGap('   ', surfaces)).toEqual({ kind: 'empty' });
  });

  it('sanitizeMinutes clamps and falls back', () => {
    expect(sanitizeMinutes('12', 15)).toBe(12);
    expect(sanitizeMinutes('', 15)).toBe(15);
    expect(sanitizeMinutes('-3', 15)).toBe(15);
    expect(sanitizeMinutes('99999', 15)).toBe(1440);
    expect(sanitizeMinutes(7.6, 15)).toBe(8);
  });
});

describe('<FieldMission>', () => {
  it('reporting logs the mission with the minutes and files the gaps as captured items, bookmarks and weak-point tags', async () => {
    await setup();
    const cap = captureEvents();
    const { onResult } = await mount(step());
    expect(q('.mission')?.getAttribute('data-mission')).toBe('real-conversation');
    expect(q('.mission__prompt')?.textContent).toBe(MISSIONS[4]!.promptEn);
    expect(root.textContent).toContain(S.missionConversation);
    await click('[data-action="did-it"]');
    expect(q('.mission')?.getAttribute('data-phase')).toBe('report');
    expect(root.querySelectorAll('[data-field^="gap-"]').length).toBe(2);
    expect(q<HTMLInputElement>('[data-field="minutes"]')?.value).toBe('15');
    input('[data-field="minutes"]', '12');
    input('[data-field="gap-0"]', 'コーヒー');
    select('[data-field="kind-0"]', 'word-choice');
    input('[data-field="gap-1"]', 'the word for umbrella');
    clock += 5000;
    await click('[data-action="report"]');
    expect(q('.mission')?.getAttribute('data-phase')).toBe('done');

    // ledger (B's logMission): the mission row, the external minutes, the event
    expect(store.ledger.value.missions).toEqual([{ day: TODAY, tier: 5, conversation: true }]);
    expect(store.ledger.value.entries).toEqual([[TODAY, 12, 3, 1]]);
    const done = cap.events.filter(([n]) => n === 'field-mission:done');
    expect(done).toEqual([['field-mission:done', { tier: 5, minutes: 12, conversation: true }]]);
    // gaps
    expect(store.captured.value).toEqual([V.コーヒー]);
    expect(store.bookmarks.value).toEqual(['the word for umbrella']);
    expect(onResult).toHaveBeenCalledTimes(1);
    const r = onResult.mock.calls[0]![0];
    expect(r.correct).toBe(true);
    expect(r.guard).toBe(false);
    expect(r.errorTags).toEqual(['word-choice']);
    expect(r.answer).toBe('コーヒー / the word for umbrella');
    expect(r.ms).toBe(5000);
    expect(q('.mission__verdict')?.textContent).toBe('12 minutes to your ledger (reported).');
    expect(q('[data-outcome="captured"]')?.textContent).toBe('Captured: コーヒー');
    expect(q('[data-outcome="bookmarked"]')?.textContent).toBe('Bookmarked: the word for umbrella');
    expect(q('[data-tag="word-choice"]')?.textContent).toBe('Noted as a word choice weak point.');
    cap.stop();
  });

  it('a blank minutes field falls back to the mission default; a repeated capture is not duplicated', async () => {
    await setup({ save: { captured: [V.コーヒー] } });
    const { onResult } = await mount(step({ params: { missionId: 'read-aloud-sign' } }));
    await click('[data-action="did-it"]');
    expect(root.querySelectorAll('[data-field^="gap-"]').length).toBe(1);
    input('[data-field="minutes"]', '');
    input('[data-field="gap-0"]', 'コーヒー');
    await click('[data-action="report"]');
    expect(store.ledger.value.entries).toEqual([[TODAY, 5, 1, 1]]);
    expect(store.captured.value).toEqual([V.コーヒー]);
    expect(onResult.mock.calls[0]![0].errorTags).toEqual([]);
    expect(onResult.mock.calls[0]![0].answer).toBe('コーヒー');
  });

  it('"Not yet" is an honest skip: guard, nothing logged, a calm note', async () => {
    await setup();
    const cap = captureEvents();
    const { onResult } = await mount(step());
    await click('[data-action="not-yet"]');
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]![0]).toMatchObject({ guard: true, correct: false, answer: 'not-yet' });
    expect(store.ledger.value.missions).toEqual([]);
    expect(cap.events.filter(([n]) => n === 'field-mission:done')).toEqual([]);
    expect(q('.mission__result')?.getAttribute('data-reported')).toBe('false');
    expect(q('.mission__verdict')?.textContent).toBe(S.missionNotYetNote);
    cap.stop();
  });

  it('without a matching mission the step shows the calm note and never reports', async () => {
    await setup({ save: { progress: { station: 1 }, profile: { belt: 'white' } } });
    const { onResult } = await mount(step({ params: {} }));
    expect(q('.mission__note')?.textContent).toBe(S.missionMissing);
    expect(q('[data-action="did-it"]')).toBeNull();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('Enter through the frame moves brief → report → done', async () => {
    await setup();
    const { onResult } = await mount(step({ params: { missionId: 'order-in-japanese' } }));
    const enter = (): Promise<void> =>
      act(async () => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
    // Outside an ExerciseFrame the key context is inert; the buttons carry the same path.
    await enter();
    await click('[data-action="did-it"]');
    expect(q('.mission')?.getAttribute('data-phase')).toBe('report');
    await click('[data-action="report"]');
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(store.ledger.value.entries).toEqual([[TODAY, 10, 3, 1]]);
  });
});

/* ── design 09 (C4): the report form and result are .sheet, field labels are .eyebrow ── */
describe('design 09 (C4): mission sheets and eyebrows', () => {
  it('the gaps fieldset and the result are .sheet; every field label is an .eyebrow; no __label class remains', async () => {
    await setup();
    await mount(step());
    await click('[data-action="did-it"]');
    expect(q('.mission__gaps')?.classList.contains('sheet')).toBe(true);
    const labels = Array.from(root.querySelectorAll('.mission__field > .eyebrow'));
    expect(labels.length).toBeGreaterThanOrEqual(3);
    expect(labels[0]?.textContent).toBe(S.missionMinutes);
    expect(q('[class*="__label"]')).toBeNull();
    await click('[data-action="report"]');
    const result = q('.mission__result');
    expect(result?.classList.contains('sheet')).toBe(true);
    expect(result?.getAttribute('data-reported')).toBe('true');
  });

  it('missions.css: no label rule, no local card paper on the sheets, no Mincho outside the reading fence (§3.1), nothing tweens', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/input/missions/missions.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/__label|__eyebrow/);
    expect(css).not.toMatch(/\.mission__(gaps|result)\s*\{[^}]*\b(background|padding(-left)?|border-radius)\s*:/);
    expect(css).not.toMatch(/^\.sheet\b/m);
    expect(css).not.toMatch(/--font-mincho/);
    expect(css).not.toMatch(/transition|@keyframes|prefers-reduced-motion|\.reduced-motion/);
  });
});
