/**
 * EndCard.tsx — the beats of design 09 §7 B (fake timers): --i on the tiles, Dela tickers to the tally, the lantern,
 * sfx tsuzuku once / promotion under the flips and nothing else, reduced motion (no mask, final numbers at once),
 * EndCard.css + TrainPage.css without colour literals or a belt-flip of their own, the tsuzuku-mark hero element,
 * 次回予告 as exactly three lines with the vista inside line 3; plus the ledger, Another Kata and the banned list.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardKey } from '../content/types';
import { G, V, createFakeLoader, FIXTURE_STORY_ID } from '../content/fixtures';
import { findBanned } from '../i18n/banned-phrases';
import { installServices, nullAudio, resetServices } from '../shared/audio';
import { bus } from '../shared/events';
import type { JikaiYokoku, SessionResult, StepResult } from '../shared/session-types';
import { epochDay } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { resetFrameSchedulerForTests } from '../shared/ui/Ticker';
import { resetStoreForTests, store } from '../store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore } from '../store/testing';
import type { CeremonyEvent } from './end-card';
import { ES } from './end-card-strings';
import { BEAT, END_CARD_BEATS, EndCard, LEDGER_MINUTES, STAGGER_MS, TSUZUKU_BRUSH, ceremonyLines, itemGloss, spinePath, tsuzukuBrush } from './EndCard';
import { S } from './strings';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const ROOT = process.cwd();
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const END_CARD_CSS = readFileSync(resolve(ROOT, 'src/session/EndCard.css'), 'utf8');
const TRAIN_PAGE_CSS = readFileSync(resolve(ROOT, 'src/session/pages/TrainPage.css'), 'utf8');

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetFrameSchedulerForTests();
  resetStoreForTests();
  resetServices();
  bus.reset();
  vi.useRealTimers();
});

function res(o: Partial<StepResult> = {}): StepResult {
  return { stepId: 's', cardKey: `${V.犬}#rec`, rating: 3, ki: 8, combo: 1, ippon: false, kiai: false, xpDelta: 2, correct: true, nearMiss: false, hintUsed: false, guard: false, timedOut: false, ms: 3000, errorTags: [], ...o };
}

function result(o: Partial<SessionResult> = {}, tally: Partial<SessionResult['tally']> = {}): SessionResult {
  const steps = [res(), res({ combo: 2, ippon: true }), res({ correct: false, rating: 1, combo: 0 })];
  return {
    planId: 'kata-test',
    mode: 'kata',
    startedAt: DEFAULT_TEST_NOW - 180_000,
    endedAt: DEFAULT_TEST_NOW,
    steps,
    tally: { reps: 3, correct: 2, accuracy: 0.667, bestCombo: 2, ippon: 1, xp: 17, minutes: 3, promotions: [{ itemId: V.水, to: 'green' }], questsDone: ['clear-due'], backlogWaiting: 0, ...tally },
    zen: false,
    resumed: false,
    ...o,
  };
}

const yokoku: JikaiYokoku = {
  sentence: { storyId: 's-04-1', ja: '{私|わたし}は???です。', kana: 'わたしはがくせいです。', maskedToken: 2 },
  words: [
    { itemId: V.犬, kana: 'いぬ' },
    { itemId: V.水, kana: 'みず' },
    { itemId: V.人, kana: 'ひと' },
  ],
  milestone: 'The 坂の関守 Hill Keeper awaits in about 4 days.',
};

function dueCards(n: number): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  const ids = [V.犬, V.水, V.人, V.日, V.私];
  for (let i = 0; i < n && i < ids.length; i++) out[`${ids[i]}#rec`] = card({ due: TODAY, s: 5, reps: 4, state: 2, last: TODAY - 1 });
  return out;
}

type Props = Parameters<typeof EndCard>[0];
function mount(over: Partial<Props> = {}): { onAnother: ReturnType<typeof vi.fn>; onRest: ReturnType<typeof vi.fn> } {
  const onAnother = vi.fn();
  const onRest = vi.fn();
  act(() => render(<EndCard result={result()} yokoku={yokoku} notes={[]} onAnother={onAnother} onRest={onRest} {...over} />, root));
  return { onAnother, onRest };
}

const click = (el: Element | null): void => {
  act(() => {
    (el as HTMLButtonElement).click();
  });
};

/** Advances the fake clock to `ms` since mount (inside act so the beat state commits). */
const at = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const toTheEnd = (): void => at(END_CARD_BEATS[END_CARD_BEATS.length - 1]! + 1000);

const beat = (): string | null => root.querySelector('.end-card')?.getAttribute('data-beat') ?? null;
const tickerText = (sel: string): string | undefined => root.querySelector(`${sel} .ticker__value`)?.textContent ?? undefined;
/** The stagger index an element carries (`style="--i:n"`). */
const iOf = (el: Element): string => (el as HTMLElement).style.getPropertyValue('--i').trim();
/** A save whose first day is counted, so the flame reads lit (a fresh save's hearth is `unlit`). */
const LIT = { save: { streak: { totalDays: 1, current: 1, lastDay: TODAY } } };

describe('<EndCard>', () => {
  it('renders つづく, the tally, promotions, quests, the preview, the proverb and the closing lines (at the end of the beats)', async () => {
    await makeTestStore({ cards: dueCards(2) });
    vi.useFakeTimers();
    mount();
    toTheEnd();
    expect(root.querySelector('.end-card__tsuzuku')?.textContent).toBe('つづく');
    const text = root.textContent ?? '';
    expect(text).toContain('Reps');
    expect(text).toContain('67%');
    expect(text).toContain('Best combo');
    expect(text).toContain('+17');
    expect(root.querySelector('.end-card__promotion .end-card__belt')?.getAttribute('data-belt')).toBe('green');
    expect(root.querySelector('.end-card__quest')?.textContent).toContain('Clear all due reviews');
    expect(root.querySelector('.end-card__yokoku-ja')?.textContent).toContain('???');
    expect(root.querySelectorAll('.end-card__word')).toHaveLength(3);
    expect(root.querySelector('.end-card__milestone')?.textContent).toBe(yokoku.milestone);
    expect(root.querySelector('.end-card__omikuji-text ruby'), 'the proverb reads itself (d36)').not.toBeNull();
    expect(root.querySelector('.end-card__omikuji-en')?.textContent).toMatch(/\.$/);
    expect(root.querySelector('.end-card__closing')?.textContent).toBe('Good training. Rest.');
    expect(root.querySelector('.end-card__keeps')?.textContent).toBe(ES.dojoKeepsPlace);
    expect(root.querySelector('.end-card__flame')).not.toBeNull();
    expect(root.querySelector('.end-card .is-pending')).toBeNull();
  });

  it('names promoted items by their surface, not their id, with the reading and English beside (every glyph carries a label)', async () => {
    await makeTestStore({ cards: dueCards(2) });
    mount({ loader: createFakeLoader() });
    const item = root.querySelector('.end-card__item');
    expect(item?.textContent).toBe('水');
    expect(item?.getAttribute('lang')).toBe('ja');
    expect(root.textContent).not.toContain(V.水);
    expect(root.querySelector('.end-card__item-kana')?.textContent).toBe('みず');
    expect(root.querySelector('.end-card__item-kana')?.getAttribute('lang')).toBe('ja');
    expect(root.querySelector('.end-card__item-en')?.textContent).toBe('water');
    expect(root.querySelector('.end-card__promotion')?.textContent).toContain('Green belt');
    // the kana is omitted when it IS the head; nothing for an item not in memory
    const l = createFakeLoader();
    expect(itemGloss(l.get(V.水))).toEqual({ kana: 'みず', en: 'water' });
    expect(itemGloss(l.get(V.おいしい))).toEqual({ kana: undefined, en: 'delicious' });
    expect(itemGloss(l.get(G.です))).toEqual({ en: 'is …' });
    expect(itemGloss(l.get('c-person'))).toEqual({ en: 'person' });
    expect(itemGloss(undefined)).toEqual({});
  });

  it('ledger tap adds an external entry of the chosen kind and emits ledger:entry', async () => {
    await makeTestStore();
    const cap = captureEvents();
    mount();
    expect(root.querySelector('.end-card__ledger-prompt')?.textContent).toBe('Outside input today? +20 min anime / podcast / reading / conversation.');
    const select = root.querySelector('.end-card__ledger-kind select') as HTMLSelectElement;
    act(() => {
      select.value = 'read';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(root.querySelectorAll('.end-card__ledger-btn')).toHaveLength(LEDGER_MINUTES.length);
    click(root.querySelector('.end-card__ledger-btn[data-minutes="20"]'));
    expect(store.ledger.value.entries).toEqual([[TODAY, 20, 1, 1]]);
    expect(cap.events.filter((e) => e[0] === 'ledger:entry')).toEqual([['ledger:entry', { minutes: 20, kind: 1, source: 1 }]]);
    expect(root.querySelector('.end-card__ledger-done')?.textContent).toBe('Logged. The ledger remembers.');
    expect(root.querySelector('.end-card__ledger-btn')).toBeNull();
    cap.stop();
  });

  it('the ledger prompt is absent once today has an external entry, and can be dismissed', async () => {
    await makeTestStore({ save: { ledger: { entries: [[TODAY, 15, 0, 1]], monthly: {}, missions: [] } } });
    mount();
    expect(root.querySelector('.end-card__ledger')).toBeNull();
    render(null, root);
    resetStoreForTests();
    await makeTestStore();
    mount();
    expect(root.querySelector('.end-card__ledger')).not.toBeNull();
    click(root.querySelector('.end-card__ledger-dismiss'));
    expect(root.querySelector('.end-card__ledger')).toBeNull();
  });

  it('Another Kata shows only while reviews remain due; Rest is always there and intercepts nothing', async () => {
    await makeTestStore({ cards: dueCards(3) });
    const a = mount();
    expect(root.querySelector('.end-card__another')?.textContent).toBe('Another Kata?');
    expect(root.querySelector('.end-card__due')?.textContent).toBe('3 reviews remain.');
    click(root.querySelector('.end-card__another'));
    expect(a.onAnother).toHaveBeenCalledTimes(1);
    click(root.querySelector('.end-card__rest'));
    expect(a.onRest).toHaveBeenCalledTimes(1);
    // no exit interception of any kind (09 §7 C): no dialog, no confirm, no beforeunload
    expect(root.querySelector('[role="dialog"], [role="alertdialog"]')).toBeNull();

    resetStoreForTests();
    await makeTestStore();
    const b = mount();
    expect(root.querySelector('.end-card__another')).toBeNull();
    expect(root.querySelector('.end-card__due')).toBeNull();
    const rest = root.querySelector('.end-card__rest')!;
    expect(rest.textContent).toBe('Rest.');
    expect(rest.classList.contains('hanko')).toBe(true);
    click(rest);
    expect(b.onRest).toHaveBeenCalledTimes(1);
  });

  it('cards created at introduction but never served (state 0) are not reviews still due', async () => {
    await makeTestStore({ cards: { [`${V.犬}#prod`]: card({ due: TODAY, s: 0, d: 0, reps: 0, lapses: 0, state: 0, last: TODAY }), [`${V.水}#rec`]: card({ due: TODAY, s: 5, reps: 4, state: 2, last: TODAY - 1, flags: 1 }) } });
    mount();
    expect(root.querySelector('.end-card__another')).toBeNull();
    expect(root.querySelector('.end-card__due')).toBeNull();
    expect(root.querySelector('.end-card__rest')?.textContent).toBe('Rest.');
  });

  it('a Welcome Back day shows the preview only, no tally', async () => {
    await makeTestStore();
    mount({ result: result({ mode: 'welcome' }) });
    expect(root.querySelector('.end-card__tally')).toBeNull();
    expect(root.querySelector('.end-card__welcome')?.textContent).toBe(S.welcomePreviewOnly);
    expect(root.querySelector('.end-card__yokoku')).not.toBeNull();
  });

  it('shows a loading line while the preview is null, and the notes list', async () => {
    await makeTestStore();
    mount({ yokoku: null, notes: ['Spaced beats massed. Tomorrow counts more than more today.', '7 waited today without penalty.'] });
    expect(root.querySelector('.end-card__loading')?.textContent).toBe('Reading tomorrow’s page.');
    const notes = Array.from(root.querySelectorAll('.end-card__note')).map((n) => n.textContent);
    expect(notes).toEqual(['Spaced beats massed. Tomorrow counts more than more today.', '7 waited today without penalty.']);
  });

  it('lists what B granted during the session (badges, stamps, belts, levels), quests excluded', async () => {
    await makeTestStore();
    const ceremonies: CeremonyEvent[] = [
      { name: 'badge:earned', payload: { id: 'first-step' } },
      { name: 'quest:completed', payload: { id: 'clear-due', allDone: false } },
      { name: 'stamp:earned', payload: { station: 4, perfect: true, assisted: false } },
      { name: 'belt:promoted', payload: { belt: 'yellow' } },
      { name: 'level:up', payload: { level: 3 } },
      { name: 'wallpaper:revealed', payload: { id: 'great-wave', quadrant: 2 } },
    ];
    const lines = ceremonyLines(ceremonies);
    expect(lines).toHaveLength(5);
    expect(lines[0]!.text).toContain('First Step');
    expect(lines[1]!.text).toBe('Goshuin · station 4');
    expect(lines[2]!.text).toBe('Yellow belt');
    expect(lines[3]!.text).toBe('Level 3');
    expect(lines[4]!.text).toContain('quadrant 2');
    mount({ ceremonies });
    expect(root.querySelectorAll('.end-card__earned-row')).toHaveLength(5);
    // the row's mark (紋 印 帯 Lv 軸) is an aria-hidden span labelled by the row's own English — never CSS generated content
    expect(lines.map((l) => l.mark)).toEqual(['紋', '印', '帯', 'Lv', '軸']);
    const marks = Array.from(root.querySelectorAll('.end-card__earned-mark'));
    expect(marks.map((m) => m.textContent)).toEqual(['紋', '印', '帯', 'Lv', '軸']);
    expect(marks.every((m) => m.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(marks.map((m) => m.getAttribute('lang'))).toEqual(['ja', 'ja', 'ja', null, 'ja']);
    expect(root.querySelectorAll('.end-card__earned-row')[3]!.textContent).toBe('LvLevel 3');
    expect(stripComments(END_CARD_CSS)).not.toMatch(/content: '[^']*[^\x00-\x7f]/);
    expect(stripComments(END_CARD_CSS)).not.toMatch(/\.end-card__earned-row[^{]*::before/);
    render(null, root);
    mount({ ceremonies: [] });
    expect(root.querySelector('.end-card__earned')).toBeNull();
  });

  it('copy passes the banned list (session strings and the end-card strings)', () => {
    const values: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') values.push(v);
      else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
    };
    walk(S);
    walk(ES);
    expect(values.length).toBeGreaterThan(50);
    const hits = values.flatMap((v) => findBanned(v).map((h) => `${v} (${h.rule.source})`));
    expect(hits).toEqual([]);
    // the lantern asks for nothing: no time words, no "come back" (09 §7 B ethical line)
    for (const v of [ES.lanternForToday, ES.dojoKeepsPlace, ...Object.values(ES.lanternWord)]) expect(v).not.toMatch(/\b(hours?|minutes?|days? left|come back|soon|hurry|last chance|streak)\b/i);
    // one drawn flame, one story: the card's word for each state is the shell's (S.flameWord*, src/i18n/strings.ts)
    expect(ES.lanternWord).toEqual({ lit: 'Lit', gold: 'Gold', ember: 'Embers', frozen: 'Frozen', rest: 'Rest', broken: 'Out', unlit: 'Unlit' });
  });
});

describe('<EndCard> — moment B Shūhitsu (design 09 §7 B, fake timers)', () => {
  it('walks the beats: stage · brush · tally · belts · lantern · yokoku, each section hidden until its beat', async () => {
    await makeTestStore();
    vi.useFakeTimers();
    mount();
    expect(END_CARD_BEATS).toEqual([0, 300, 1500, 2100, 2400, 2700]);
    expect(beat()).toBe('0');
    expect(root.querySelector('.end-card__tally')?.classList.contains('is-pending')).toBe(true);
    expect(root.querySelector('.end-card__flame')?.classList.contains('is-pending')).toBe(true);
    expect(root.querySelector('.end-card__yokoku')?.classList.contains('is-pending')).toBe(true);
    expect(root.querySelector('.end-card__foot')?.classList.contains('is-pending')).toBe(true);
    expect(root.querySelector('.end-card__brush')?.classList.contains('ink-nijimi')).toBe(false);
    at(300);
    expect(beat()).toBe(String(BEAT.brush));
    expect(root.querySelector('.end-card__brush')?.classList.contains('ink-nijimi')).toBe(true);
    at(1200);
    expect(beat()).toBe(String(BEAT.tally));
    expect(root.querySelector('.end-card__tally')?.classList.contains('is-pending')).toBe(false);
    at(600);
    expect(beat()).toBe(String(BEAT.belts));
    at(300);
    expect(beat()).toBe(String(BEAT.lantern));
    expect(root.querySelector('.end-card__flame')?.classList.contains('is-pending')).toBe(false);
    at(300);
    expect(beat()).toBe(String(BEAT.yokoku));
    expect(root.querySelector('.end-card .is-pending')).toBeNull();
  });

  it('beat 300: つづく is written through a brush-stroke mask (stroke-dasharray / dashoffset over pathLength 1, the hiku verb) and .end-card__brush is the tsuzuku-mark hero', async () => {
    await makeTestStore();
    vi.useFakeTimers();
    mount();
    const brush = root.querySelector('.end-card__brush')!;
    expect(brush).not.toBeNull();
    expect(brush.textContent).toBe('つづく');
    expect(brush.getAttribute('aria-label')).toBe('つづく');
    const mask = root.querySelector('.end-card__brush mask')!;
    expect(mask).not.toBeNull();
    const text = root.querySelector('.end-card__brush-text')!;
    expect(text.getAttribute('mask')).toBe(`url(#${mask.id})`);
    const stroke = root.querySelector('.end-card__brush-stroke')!;
    expect(stroke.getAttribute('pathLength')).toBe('1');
    expect(stroke.getAttribute('stroke-dasharray')).toBe('1');
    expect(stroke.getAttribute('stroke-dashoffset')).toBe('1');
    expect(stroke.getAttribute('data-axis')).toBe('stroke');
    // the stroke waits for its beat, then draws
    expect(stroke.classList.contains('ink-hiku')).toBe(false);
    at(300);
    expect(stroke.classList.contains('ink-hiku')).toBe(true);
    // three boustrophedon passes across the glyph box
    const b = tsuzukuBrush();
    expect(b.points).toHaveLength(6);
    expect(b.w / b.h).toBeCloseTo(17 / 6, 5);
    expect(spinePath(b.points)).toMatch(/^M-?[\d.]+ [\d.]+( L-?[\d.]+ [\d.]+){5}$/);
    expect(stroke.getAttribute('d')).toBe(spinePath(TSUZUKU_BRUSH.points));
    // the mask duration is 4/3 of --dur-4 (1,200 ms), a token calc
    expect(END_CARD_CSS).toMatch(/\.end-card__brush-stroke\.ink-hiku\[data-axis="stroke"\] \{[^}]*animation-duration: calc\(var\(--dur-4\) \* 4 \/ 3\)/);
    // the h1 hugs the glyphs (it is the hero snapshot) and the svg is sized from the type scale: 1.2em tall for a 1.2 × em viewBox → glyphs at --fs-7 (§3.4), --fs-6 at ≤ 420 px
    expect(END_CARD_CSS).toMatch(/\.end-card__brush \{[^}]*width: fit-content[^}]*font-size: var\(--fs-7\)[^}]*line-height: 1\.1/);
    expect(END_CARD_CSS).toMatch(/\.end-card__brush-svg \{[^}]*height: 1\.2em[^}]*width: auto[^}]*aspect-ratio: 17 \/ 6/);
    expect(END_CARD_CSS).toMatch(/@media \(max-width: 420px\) \{[^}]*\.end-card__brush \{ font-size: var\(--fs-6\)/);
    // what carries the hero into the hearth: the element transitions.ts names
    const { heroFor } = await import('../app/transitions');
    expect(heroFor({ name: 'train', mode: 'kata' }, { name: 'dojo' })).toEqual([{ name: 'tsuzuku-mark', from: '.end-card__brush', to: '.dojo-scene__hotspot--hearth' }]);
  });

  it('beat 1,500: the tiles carry --i indices and every value is a <Ticker> whose final text equals the tally; the XP delta is the gold Dela number', async () => {
    await makeTestStore();
    vi.useFakeTimers();
    mount();
    const tiles = Array.from(root.querySelectorAll<HTMLElement>('.end-card__stat'));
    expect(tiles).toHaveLength(6);
    expect(tiles.map(iOf)).toEqual(['0', '1', '2', '3', '4', '5']);
    for (const t of tiles) {
      expect(t.classList.contains('sheet')).toBe(true);
      expect(t.querySelector('dt')?.classList.contains('eyebrow')).toBe(true);
    }
    // before the beat nothing has arrived (the tally is hidden) but the DOM already carries the final numbers
    expect(tiles.every((t) => !t.classList.contains('ink-nijimi'))).toBe(true);
    expect(tickerText('.end-card__stat--xp')).toBe('+17');
    expect(root.querySelector('.ticker__roll')).toBeNull();
    at(1500);
    expect(tiles.every((t) => t.classList.contains('ink-nijimi'))).toBe(true);
    const fresh = Array.from(root.querySelectorAll<HTMLElement>('.end-card__stat'));
    const values = fresh.map((t) => t.querySelector('.ticker__value')?.textContent);
    expect(values).toEqual(['3', '67%', '2', '1', '+17', '3']);
    expect(tickerText('.end-card__stat--xp')).toBe('+17');
    // and each value is rolling up from 0 behind its final digits (the Ticker's aria-hidden twin)
    expect(root.querySelectorAll('.end-card__stat .ticker[data-ticking]')).toHaveLength(6);
    expect(root.querySelectorAll('.end-card__stat .ticker__roll')).toHaveLength(6);
    expect(END_CARD_CSS).toMatch(/\.end-card__stat dd \{[^}]*font-family: var\(--font-neon\)/);
    expect(END_CARD_CSS).toMatch(/\.end-card__stat--xp dd \{[^}]*color: var\(--kin-text\)/);
    expect(END_CARD_CSS).toMatch(/\.end-card__stat dd \{[^}]*tabular-nums/);
  });

  it('a tally with minutes in tenths and no reps shows — for accuracy', async () => {
    await makeTestStore();
    vi.useFakeTimers();
    mount({ result: result({}, { reps: 0, accuracy: 0, minutes: 2.5 }) });
    toTheEnd();
    const values = Array.from(root.querySelectorAll('.end-card__stat')).map((t) => t.querySelector('dd')?.textContent);
    expect(values[1]).toBe('—');
    expect(values[5]).toBe('2.5');
  });

  it('beat 2,100: the belts flip through A1\'s belt-flip with --i and EndCard.css declares none of its own', async () => {
    await makeTestStore();
    vi.useFakeTimers();
    mount({ result: result({}, { promotions: [{ itemId: V.水, to: 'green' }, { itemId: V.犬, to: 'yellow' }] }) });
    const belts = Array.from(root.querySelectorAll('.end-card__belt'));
    expect(belts).toHaveLength(2);
    expect(belts.map(iOf)).toEqual(['0', '1']);
    expect(belts.every((b) => !b.hasAttribute('data-flip'))).toBe(true);
    at(2100);
    expect(belts.every((b) => b.hasAttribute('data-flip'))).toBe(true);
    expect(stripComments(END_CARD_CSS)).not.toMatch(/@keyframes\s+belt-flip/);
    expect(END_CARD_CSS).toMatch(/\.end-card__belt\[data-flip\] \{[^}]*animation: belt-flip calc\(var\(--dur-3\) \* 1\.5\)/);
    expect(END_CARD_CSS).toMatch(/\.end-card__belt\[data-flip\] \{[^}]*animation-delay: calc\(min\(var\(--i, 0\), 7\) \* var\(--stagger\)\)/);
    // the canonical definition lives in components.css
    expect(readFileSync(resolve(ROOT, 'src/styles/components.css'), 'utf8')).toMatch(/@keyframes belt-flip/);
  });

  it('beat 2,400: a lantern for today — <Lantern> with the flame state, its English word and the copy; tomosu lights it then lets go', async () => {
    await makeTestStore(LIT);
    vi.useFakeTimers();
    mount();
    const lantern = root.querySelector('.end-card__flame .lantern')!;
    expect(lantern).not.toBeNull();
    expect(lantern.getAttribute('data-state')).toBe('lit');
    expect(lantern.querySelector('.lantern__word')?.textContent).toBe(ES.lanternWord.lit);
    expect(lantern.querySelector('.lantern__tongue')?.getAttribute('width')).toBe('20');
    expect(root.querySelector('.end-card__flame-line')?.textContent).toBe('A lantern for today.');
    // the longer sentence is the lantern's visually hidden detail (§5.10); visibly the line is the word and the copy, the word never repeated
    expect(root.querySelector('.end-card__flame-detail')).toBeNull();
    expect(Array.from(lantern.querySelectorAll('.visually-hidden')).map((n) => n.textContent)).toEqual(['Tsuzuku Flame: ', ` ${S.flameLit}`]);
    expect(lantern.classList.contains('ink-tomosu')).toBe(false);
    at(2400);
    expect(lantern.classList.contains('ink-tomosu')).toBe(true);
    act(() => {
      lantern.dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(lantern.classList.contains('ink-tomosu')).toBe(false);
    // it catches once: a later beat never relights it
    at(300);
    expect(beat()).toBe(String(BEAT.yokoku));
    expect(lantern.classList.contains('ink-tomosu')).toBe(false);
    // no kanji glyph table any more: the tongue is drawn, the word is English
    expect(root.querySelector('.end-card__flame-glyph')).toBeNull();
  });

  it('a never-lit hearth (totalDays 0) reads Unlit, never "out"', async () => {
    await makeTestStore({ save: { streak: { totalDays: 0 } } });
    vi.useFakeTimers();
    mount();
    toTheEnd();
    const lantern = root.querySelector('.end-card__flame .lantern')!;
    expect(lantern.getAttribute('data-state')).toBe('unlit');
    expect(lantern.querySelector('.lantern__word')?.textContent).toBe('Unlit');
    expect(root.querySelector('.end-card__flame')?.textContent).not.toMatch(/\bout\b/i);
  });

  it('sound: tsuzuku exactly once at beat 300, one promotion per belt flip --stagger apart under beat 2,100, nothing else — never a BEST recipe', async () => {
    await makeTestStore();
    const sfx = vi.fn();
    installServices({ audio: { ...nullAudio, sfx } });
    vi.useFakeTimers();
    mount({ result: result({}, { promotions: [{ itemId: V.水, to: 'green' }, { itemId: V.犬, to: 'yellow' }, { itemId: V.人, to: 'brown' }] }) });
    expect(sfx).not.toHaveBeenCalled();
    at(299);
    expect(sfx).not.toHaveBeenCalled();
    at(1);
    expect(sfx).toHaveBeenCalledTimes(1);
    expect(sfx).toHaveBeenCalledWith('tsuzuku');
    mount({ result: result({}, { promotions: [{ itemId: V.水, to: 'green' }, { itemId: V.犬, to: 'yellow' }, { itemId: V.人, to: 'brown' }] }) }); // a re-render never replays
    at(1800); // 2,100: the first koto pair lands with the first flip
    expect(sfx.mock.calls.filter((c) => c[0] === 'promotion')).toHaveLength(1);
    at(STAGGER_MS * 2);
    expect(sfx.mock.calls.filter((c) => c[0] === 'promotion')).toHaveLength(3);
    toTheEnd();
    expect(sfx.mock.calls.filter((c) => c[0] === 'tsuzuku')).toHaveLength(1);
    expect(sfx.mock.calls.filter((c) => c[0] === 'promotion')).toHaveLength(3);
    expect(sfx.mock.calls.map((c) => c[0]).filter((n) => n !== 'tsuzuku' && n !== 'promotion')).toEqual([]);
    // no BEST eyebrow (the tally's "Best combo" is 03 §10's own row, not a chase against history)
    expect(root.textContent).not.toMatch(/\bBEST\b/);
    expect(root.textContent).not.toMatch(/new best|personal best|high score/i);
    expect(root.querySelector('[data-best], .best, .hiscore')).toBeNull();
  });

  it('Zen: the gliss and the koto pairs stay silent; combo and Ippon rows are hidden', async () => {
    await makeTestStore();
    const sfx = vi.fn();
    installServices({ audio: { ...nullAudio, sfx } });
    vi.useFakeTimers();
    mount({ result: result({ zen: true }) });
    toTheEnd();
    expect(sfx).not.toHaveBeenCalled();
    expect(root.textContent).not.toContain('Best combo');
    expect(root.textContent).not.toContain('一本');
    expect(root.textContent).toContain('Reps');
    expect(root.querySelectorAll('.end-card__stat')).toHaveLength(4);
  });

  it('reduced motion (the setting): the stage is cut at 0, the dashWrite mask is absent, the final numbers and every section render at once, the lantern state is set without tomosu', async () => {
    await makeTestStore({ save: { settings: { reducedMotion: true }, streak: LIT.save.streak } });
    const sfx = vi.fn();
    installServices({ audio: { ...nullAudio, sfx } });
    vi.useFakeTimers();
    mount();
    expect(beat()).toBe(String(BEAT.yokoku));
    // no per-component `reduced-motion` class (§6.6): base.css's class-path nuke would outrank motion.css's --dur-fade fades inside the card
    expect(root.querySelector('.end-card')?.classList.contains('reduced-motion')).toBe(false);
    expect(root.querySelector('.end-card .is-pending')).toBeNull();
    expect(root.querySelector('.end-card__brush mask')).toBeNull();
    expect(root.querySelector('.end-card__brush-stroke')).toBeNull();
    expect(root.querySelector('.end-card__brush-text')?.hasAttribute('mask')).toBe(false);
    expect(root.querySelector('.end-card__brush')?.textContent).toBe('つづく');
    expect(root.querySelector('.end-card__brush')?.classList.contains('ink-nijimi')).toBe(true);
    expect(Array.from(root.querySelectorAll('.end-card__stat .ticker__value')).map((v) => v.textContent)).toEqual(['3', '67%', '2', '1', '+17', '3']);
    expect(root.querySelector('.ticker__roll')).toBeNull();
    expect(root.querySelector('.end-card__flame .lantern')?.getAttribute('data-state')).toBe('lit');
    expect(root.querySelector('.end-card__flame .lantern')?.classList.contains('ink-tomosu')).toBe(false);
    expect(root.querySelector('.end-card__belt')?.hasAttribute('data-flip')).toBe(true);
    // the gliss still plays: sound is effort, not motion
    expect(sfx).toHaveBeenCalledWith('tsuzuku');
    toTheEnd();
    expect(root.querySelector('.end-card__flame .lantern')?.classList.contains('ink-tomosu')).toBe(false);
  });

  it('reduced motion (the OS query) is honoured the same way', async () => {
    await makeTestStore();
    const original = window.matchMedia;
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('prefers-reduced-motion'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
    try {
      mount();
      expect(beat()).toBe(String(BEAT.yokoku));
      expect(root.querySelector('.end-card__brush mask')).toBeNull();
      expect(root.querySelector('.end-card .is-pending')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      if (original) window.matchMedia = original;
    }
  });

  it('any tap or key skips the beats to the end state (01 §4.5 "always skippable", 09 §6.1); the sounds still fire once', async () => {
    await makeTestStore({ cards: dueCards(1) });
    const sfx = vi.fn();
    installServices({ audio: { ...nullAudio, sfx } });
    vi.useFakeTimers();
    mount();
    at(100);
    expect(beat()).toBe('0');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    });
    expect(beat()).toBe(String(BEAT.yokoku));
    expect(root.querySelector('.end-card .is-pending')).toBeNull();
    expect(root.querySelector('.end-card__rest')).not.toBeNull();
    expect(root.querySelector('.end-card__another')).not.toBeNull();
    expect(sfx.mock.calls.filter((c) => c[0] === 'tsuzuku')).toHaveLength(1);
    toTheEnd(); // the timers that follow move nothing and replay nothing
    expect(beat()).toBe(String(BEAT.yokoku));
    expect(sfx.mock.calls.filter((c) => c[0] === 'tsuzuku')).toHaveLength(1);
    expect(sfx.mock.calls.filter((c) => c[0] === 'promotion')).toHaveLength(1);

    render(null, root);
    mount();
    at(50);
    click(root.querySelector('.end-card'));
    expect(beat()).toBe(String(BEAT.yokoku));
    expect(root.querySelector('.end-card .is-pending')).toBeNull();
  });

  it('次回予告 renders exactly three lines (03 §10) — the sentence with its masked ??? in gold, three words, the Gatekeeper line with the vista inside it when one exists — never a fourth', async () => {
    await makeTestStore();
    vi.useFakeTimers();
    const withVista = { ...yokoku, milestone: 'The 原の関守 Gatekeeper of Hara · Fuji view awaits in about 4 days.' };
    mount({ yokoku: withVista });
    toTheEnd();
    const lines = Array.from(root.querySelectorAll('.end-card__yokoku-line'));
    expect(lines).toHaveLength(3);
    expect(lines.map(iOf)).toEqual(['0', '1', '2']);
    expect(lines.every((l) => l.classList.contains('ink-nijimi'))).toBe(true);
    expect(lines[0]!.querySelector('.end-card__mask')?.textContent).toBe('???');
    expect(lines[0]!.querySelector('.end-card__yokoku-ja')?.textContent).toContain('私');
    expect(lines[0]!.querySelectorAll('.end-card__mask')).toHaveLength(1);
    expect(lines[1]!.querySelectorAll('.end-card__word')).toHaveLength(3);
    expect(lines[2]!.textContent).toBe(withVista.milestone);
    expect(lines[2]!.textContent).toContain('Fuji view');
    expect(lines[2]!.classList.contains('end-card__milestone')).toBe(true);
    expect(root.querySelectorAll('.end-card__yokoku-h')).toHaveLength(1);
    expect(END_CARD_CSS).toMatch(/\.end-card__mask \{[^}]*color: var\(--kin-text\)/);
    expect(END_CARD_CSS).toMatch(/\.end-card__yokoku-line\.ink-nijimi \.end-card__mask \{[^}]*animation: end-card-mask var\(--dur-4\)/);
    expect(END_CARD_CSS).toMatch(/@media \(min-width: 720px\) \{[\s\S]*\.end-card__yokoku-h \{[^}]*writing-mode: vertical-rl/);
  });

  it('次回予告 glosses the three words and the preview sentence in English when the loader holds them (09 §12.1 d33); nothing invented when it does not', async () => {
    await makeTestStore({ save: { settings: { reducedMotion: true } } });
    const loader = createFakeLoader();
    const story = loader.get(FIXTURE_STORY_ID) as { lines: { ja: string; kana: string; en: string }[] };
    const line = story.lines[0]!;
    mount({ loader, yokoku: { ...yokoku, sentence: { storyId: FIXTURE_STORY_ID, ja: line.ja, kana: line.kana, maskedToken: 0 } } });
    const words = Array.from(root.querySelectorAll('.end-card__word'));
    expect(words).toHaveLength(3);
    expect(words[0]!.textContent).toContain('いぬ');
    expect(words[0]!.querySelector('.end-card__word-en')?.textContent).toContain('dog');
    expect(words[1]!.querySelector('.end-card__word-en')?.textContent).toContain('water');
    expect(words[2]!.querySelector('.end-card__word-en')?.textContent).toContain('person');
    expect(root.querySelector('.end-card__yokoku-en')?.textContent).toBe(line.en);
    // the three-line rule holds: the glosses ride inside their lines
    expect(root.querySelectorAll('.end-card__yokoku-line')).toHaveLength(3);
    mount({ yokoku });
    expect(root.querySelector('.end-card__word-en')).toBeNull();
    expect(root.querySelector('.end-card__yokoku-en')).toBeNull();
  });

  it('次回予告 keeps three lines when the composer found no sentence or words', async () => {
    await makeTestStore();
    vi.useFakeTimers();
    mount({ yokoku: { words: [], milestone: '' } });
    toTheEnd();
    const lines = Array.from(root.querySelectorAll('.end-card__yokoku-line'));
    expect(lines).toHaveLength(3);
    expect(lines[0]!.textContent).toContain(ES.yokokuNoSentence);
    expect(lines[1]!.textContent).toContain(ES.yokokuNoWords);
    expect(lines[2]!.textContent).toBe(S.yokokuQuiet);
  });

  it('the omikuji is set in --font-ja (Mincho is fenced, §3.1) and nothing on the card is Mincho', () => {
    const css = stripComments(END_CARD_CSS);
    expect(css).toMatch(/\.end-card__omikuji-text \{[^}]*font-family: var\(--font-ja\)/);
    expect(css).not.toMatch(/--font-mincho/);
  });
});

describe('EndCard.css + TrainPage.css — the house CSS rules (design 09 §4.1, §6.6, §6.7)', () => {
  const files: [string, string][] = [
    ['EndCard.css', stripComments(END_CARD_CSS)],
    ['TrainPage.css', stripComments(TRAIN_PAGE_CSS)],
  ];

  it.each(files)('%s uses no colour literals (tokens only)', (_name, css) => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/\bhsla?\(/);
    expect(css).not.toMatch(/\b(white|black|red|gold|grey|gray)\b\s*[;}]/);
  });

  it.each(files)('%s puts every duration through a --dur-* token and declares no belt-flip of its own', (_name, css) => {
    expect(css).not.toMatch(/\b\d+(\.\d+)?m?s\b/);
    expect(css).not.toMatch(/@keyframes\s+belt-flip/);
  });

  it('the stage is --stage-* (the card, its fixed dim layer, the status windows, the muted text) and --kin / --shu are fills only', () => {
    const css = stripComments(END_CARD_CSS);
    expect(css).toMatch(/\.end-card \{[^}]*color: var\(--stage-fg\)/);
    // the card itself is transparent: the ONE fixed layer is the whole stage (highlight + sumi + the beat-0 mat), so a phone-width card dims with the margins instead of cutting
    expect(css).not.toMatch(/\.end-card \{[^}]*background/);
    expect(css).toMatch(/\.end-card::before \{[^}]*position: fixed[^}]*background: radial-gradient\([^;]*\), var\(--stage-bg\); animation: mat calc\(var\(--dur-3\) \* 0\.75\) var\(--ease-in\) both/);
    expect(stripComments(TRAIN_PAGE_CSS)).toMatch(/\.train__title \{[^}]*font-family: var\(--font-brush\)[^}]*line-height: 1\.1/);
    expect(css).toMatch(/\.end-card \.status-window \{[^}]*background: var\(--stage-raised\)[^}]*border-color: var\(--stage-line\)/);
    expect(css).toMatch(/\.end-card \.muted,\s*\.end-card \.eyebrow \{[^}]*color: var\(--stage-muted\)/);
    expect(css).not.toMatch(/--card-(bg|fg|muted|line|raised)/);
    for (const m of css.matchAll(/color:\s*var\((--kin|--shu)\)/g)) expect.fail(`text in a fill token: ${m[0]}`);
    expect(stripComments(TRAIN_PAGE_CSS)).toMatch(/\.train__rank \{[^}]*color: var\(--kin-text\)/);
  });

  it('every @keyframes animates composited properties only, and the reduced forms exist under both selector paths', () => {
    const css = stripComments(END_CARD_CSS);
    const ALLOWED = new Set(['opacity', 'transform', 'translate', 'scale', 'rotate', 'clip-path', 'stroke-dashoffset']);
    const keyframes = Array.from(css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\})\s*\}/g));
    expect(keyframes.map((k) => k[1])).toEqual(['end-card-mask']);
    for (const k of keyframes) for (const d of k[2]!.matchAll(/([a-z-]+)\s*:/g)) expect(ALLOWED.has(d[1]!), `${k[1]} animates ${d[1]}`).toBe(true);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.end-card::before,[\s\S]*animation: none;[\s\S]*\}/);
    expect(css).toMatch(/:root\[data-reduced-motion\] \.end-card::before,[\s\S]*animation: none;/);
    // nothing loops, nothing glows, no filter / box-shadow / text-shadow in motion
    expect(css).not.toMatch(/\binfinite\b/);
    expect(css).not.toMatch(/text-shadow/);
    expect(css).not.toMatch(/filter:/);
    // the result-panel clones and the local reduced-motion blocks are gone
    expect(css).not.toMatch(/@keyframes\s+end-card-rise/);
    expect(css).not.toMatch(/\.end-card__flame-glyph/);
    expect(css).not.toMatch(/\.reduced-motion \.end-card__brush/);
  });
});
