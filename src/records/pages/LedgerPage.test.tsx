import { render } from 'preact';
import { act } from 'preact/test-utils';
import { findBanned } from '../../i18n/banned-phrases';
import { MISSIONS } from '../../shared/catalog';
import { bus } from '../../shared/events';
import { epochDay } from '../../shared/time';
import { resetStoreForTests, store } from '../../store/store';
import { DEFAULT_TEST_NOW, captureEvents, makeTestStore } from '../../store/testing';
import { S } from '../strings';
import LedgerPage, { QUICK_MINUTES, availableMissions, dojoWeekMinutes, editableMinutes, rowMinutes } from './LedgerPage';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const ROUTE = { name: 'ledger' } as const;

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  bus.reset();
});

function mount(): void {
  act(() => render(<LedgerPage route={ROUTE} />, root));
}

function form(): HTMLFormElement {
  return root.querySelector('form.ledger__form') as HTMLFormElement;
}

function submit(f: HTMLFormElement): void {
  act(() => {
    f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function setValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string, event: 'input' | 'change'): void {
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event(event, { bubbles: true }));
  });
}

describe('<LedgerPage> add entry', () => {
  it('a quick tap plus submit calls addLedgerEntry: row in the slice, ledger:entry on the bus, status line', async () => {
    await makeTestStore();
    const cap = captureEvents();
    mount();
    const taps = Array.from(root.querySelectorAll('.ledger__quick-btn')) as HTMLButtonElement[];
    expect(taps.map((b) => b.textContent)).toEqual(QUICK_MINUTES.map(String));
    act(() => taps[2]!.click()); // 30
    expect(taps[2]!.getAttribute('aria-pressed')).toBe('true');
    const select = form().querySelector('select') as HTMLSelectElement;
    setValue(select, 'watch', 'change');
    submit(form());
    expect(store.ledger.value.entries).toEqual([[TODAY, 30, 2, 1]]);
    expect(cap.events).toContainEqual(['ledger:entry', { minutes: 30, kind: 2, source: 1 }]);
    expect(root.querySelector('.ledger__form .ledger__status')?.textContent).toBe('Logged. 30 minutes of watching on the ledger.');
    cap.stop();
    // The new row appears under Today with an edit button; app rows have none.
    expect(root.querySelector('.ledger__today-text')?.textContent).toBe('30 min watching · Outside');
    expect(root.querySelector('.ledger__today .btn')).not.toBeNull();
  });

  it('a typed minute count and a note land in the ledger and the bookmarks', async () => {
    await makeTestStore();
    mount();
    const minutes = form().querySelector('input[type="number"]') as HTMLInputElement;
    setValue(minutes, '45', 'input');
    const note = form().querySelector('textarea') as HTMLTextAreaElement;
    setValue(note, 'いただきます', 'input');
    submit(form());
    expect(store.ledger.value.entries).toEqual([[TODAY, 45, 0, 1, 'いただきます']]);
    expect(store.bookmarks.value).toEqual([`${TODAY}: いただきます`]);
    expect(root.textContent).toContain('いただきます');
  });

  it('zero minutes adds nothing and says so', async () => {
    await makeTestStore();
    const cap = captureEvents();
    mount();
    const minutes = form().querySelector('input[type="number"]') as HTMLInputElement;
    setValue(minutes, '0', 'input');
    submit(form());
    expect(store.ledger.value.entries).toEqual([]);
    expect(cap.events.filter((e) => e[0] === 'ledger:entry')).toHaveLength(0);
    expect(root.querySelector('.ledger__form .ledger__status')?.textContent).toBe('Minutes must be above zero.');
    cap.stop();
  });

  it('today rows can have their minutes edited in place', async () => {
    await makeTestStore({ save: { ledger: { entries: [[TODAY - 1, 10, 0, 1], [TODAY, 20, 1, 1], [TODAY, 8, 0, 0]] } } });
    mount();
    const rows = Array.from(root.querySelectorAll('.ledger__today-row'));
    expect(rows).toHaveLength(2);
    const edit = rows[0]?.querySelector('button') as HTMLButtonElement;
    act(() => edit.click());
    const input = root.querySelector('.ledger__edit input') as HTMLInputElement;
    setValue(input, '25', 'input');
    submit(root.querySelector('form.ledger__edit') as HTMLFormElement);
    expect(store.ledger.value.entries[1]).toEqual([TODAY, 25, 1, 1]);
    expect(store.ledger.value.entries[0]).toEqual([TODAY - 1, 10, 0, 1]);
    expect(rows[1]?.querySelector('button')).toBeNull(); // app rows are not editable
  });

  it('editing the minutes of a row that carries a note keeps the note (the optional fifth column)', async () => {
    await makeTestStore({ save: { ledger: { entries: [[TODAY, 20, 2, 1, 'anime, episode 3'], [TODAY, 15, 1, 1]] } } });
    mount();
    const edit = root.querySelector('.ledger__today-row button') as HTMLButtonElement;
    act(() => edit.click());
    setValue(root.querySelector('.ledger__edit input') as HTMLInputElement, '45', 'input');
    submit(root.querySelector('form.ledger__edit') as HTMLFormElement);
    expect(store.ledger.value.entries[0]).toEqual([TODAY, 45, 2, 1, 'anime, episode 3']);
    expect(store.ledger.value.entries[1]).toEqual([TODAY, 15, 1, 1]);
    expect(store.ledger.value.entries[1]).toHaveLength(4); // a note-less row stays a 4-tuple
  });

  it('a fractional app row (Radio / Read-along seconds, to a tenth of a minute — design 08 §12) reads with one decimal; whole rows stay whole', async () => {
    await makeTestStore({ save: { ledger: { entries: [[TODAY, 0.7, 0, 0], [TODAY, 12, 0, 0], [TODAY, 2.25, 0, 0], [TODAY, 20, 1, 1]] } } });
    mount();
    const texts = Array.from(root.querySelectorAll('.ledger__today-text')).map((el) => el.textContent);
    expect(texts).toEqual(['0.7 min listening · In the app', '12 min listening · In the app', '2.3 min listening · In the app', '20 min reading · Outside']);
    expect(rowMinutes(0.7)).toBe('0.7');
    expect(rowMinutes(12)).toBe('12');
    expect(rowMinutes(1234.56)).toBe('1,234.6');
    expect(rowMinutes(Number.NaN)).toBe('0');
  });

  it('the editor opens a fractional row rounded to a whole minute (at least 1), its label says minutes, and it saves whole minutes only', async () => {
    await makeTestStore({ save: { ledger: { entries: [[TODAY, 0.4, 0, 1], [TODAY, 7.6, 0, 1]] } } });
    mount();
    const editButton = (i: number): HTMLButtonElement => Array.from(root.querySelectorAll('.ledger__today-row'))[i]?.querySelector('button') as HTMLButtonElement;
    const editInput = (): HTMLInputElement => root.querySelector('.ledger__edit input') as HTMLInputElement;
    act(() => editButton(1).click());
    expect(editInput().value).toBe('8');
    expect(root.querySelector('.ledger__edit .field__label')?.textContent).toBe(S.editMinutes);
    expect(S.editMinutes).toMatch(/minutes/);
    submit(root.querySelector('form.ledger__edit') as HTMLFormElement);
    expect(store.ledger.value.entries[1]).toEqual([TODAY, 8, 0, 1]);
    act(() => editButton(0).click());
    expect(editInput().value).toBe('1');
    setValue(editInput(), '2.6', 'input');
    submit(root.querySelector('form.ledger__edit') as HTMLFormElement);
    expect(store.ledger.value.entries[0]).toEqual([TODAY, 3, 0, 1]);
    expect(editableMinutes(0.4)).toBe(1);
    expect(editableMinutes(7.6)).toBe(8);
    expect(editableMinutes(25)).toBe(25);
    expect(editableMinutes(Number.NaN)).toBe(1);
  });
});

describe('<LedgerPage> missions', () => {
  it('filters missions by belt: White sees one open mission, the rest locked with their belt', async () => {
    await makeTestStore({ save: { profile: { belt: 'white' } } });
    mount();
    expect(root.querySelectorAll('.mission--available')).toHaveLength(1);
    expect(root.querySelectorAll('.mission--locked')).toHaveLength(4);
    expect(root.querySelector('.mission--available .mission__title')?.textContent).toContain('Read a sign aloud');
    const locked = Array.from(root.querySelectorAll('.mission--locked .chip')).map((c) => c.textContent);
    expect(locked).toContain('From Yellow belt');
    expect(locked).toContain('From Blue belt');
    expect(root.querySelectorAll('.mission--locked form')).toHaveLength(0);
    expect(availableMissions('green', 0).map((m) => m.tier)).toEqual([1, 2, 3, 4]);
    expect(availableMissions('white', 1)).toHaveLength(MISSIONS.length);
  });

  it('logging the conversation mission sets conversation: true and emits field-mission:done', async () => {
    await makeTestStore({ save: { profile: { belt: 'blue' }, progress: { station: 25 } } });
    const cap = captureEvents();
    mount();
    expect(root.querySelectorAll('.mission--available')).toHaveLength(5);
    const conv = root.querySelector('.mission[data-tier="5"]') as HTMLElement;
    const input = conv.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('15');
    setValue(input, '18', 'input');
    submit(conv.querySelector('form') as HTMLFormElement);
    expect(store.ledger.value.missions).toEqual([{ day: TODAY, tier: 5, conversation: true }]);
    expect(store.ledger.value.entries).toEqual([[TODAY, 18, 3, 1]]);
    expect(cap.events).toContainEqual(['field-mission:done', { tier: 5, minutes: 18, conversation: true }]);
    cap.stop();
    expect(root.textContent).toContain('Reported. 18 minutes on the ledger.');
    expect(root.textContent).toContain('1 mission reported · 1 conversation');
    expect(root.querySelector('.ledger__log')?.textContent).toContain('tier 5, a conversation');
  });
});

describe('<LedgerPage> summaries', () => {
  it('shows hours by kind and source with the (reported) label, the week ring and twelve stacked weeks', async () => {
    await makeTestStore({
      save: {
        profile: { belt: 'green' },
        ledger: {
          entries: [
            [TODAY, 60, 0, 1],
            [TODAY - 1, 30, 1, 0],
            [TODAY - 20, 120, 2, 1],
          ],
        },
      },
    });
    mount();
    const text = root.textContent ?? '';
    expect(text).toContain('(reported)');
    expect(text).toContain('3 h at Green');
    expect(root.querySelectorAll('.ledger__bars .bar')).toHaveLength(4);
    expect(root.querySelector('.ring__fill')).not.toBeNull();
    expect(root.querySelectorAll('.chart--stack rect.chart__seg').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('.chart--stack .chart__legend li')).toHaveLength(4);
    const tiles = Array.from(root.querySelectorAll('.ledger__tiles .tile__value')).map((t) => t.textContent);
    expect(tiles[0]).toBe('3.5 h');
    expect(tiles[1]).toBe('3 h');
    expect(tiles[2]).toBe('0.5 h');
    expect(root.querySelector('a[href="#/records"]')).not.toBeNull();
    expect(findBanned(text)).toEqual([]);
    expect(text).not.toContain('!');
  });
});

describe('<LedgerPage> the dojo’s share (design 08 §12)', () => {
  it('"In the dojo this week: {h} h heard" comes from app listen rows of this week; the ring still counts outside hours only', async () => {
    await makeTestStore({
      save: {
        profile: { belt: 'green' },
        ledger: {
          entries: [
            [TODAY - 20, 120, 0, 0], // dojo listening, an earlier week
            [TODAY, 30, 0, 0], // dojo listening this week → 0.5 h heard
            [TODAY, 15, 1, 0], // dojo reading: not "heard"
            [TODAY, 60, 0, 1], // outside listening: the ring's, not the dojo line's
          ],
        },
      },
    });
    mount();
    expect(dojoWeekMinutes(store.meta(), TODAY)).toBe(30);
    const line = root.querySelector('[data-dojo-week]');
    expect(line?.textContent).toContain('In the dojo this week: 0.5 h heard');
    expect(line?.textContent).toContain(S.weekDojoNote);
    // External target semantics unchanged: 60 outside minutes against Green's 3 h.
    expect(root.querySelector('.ring__center')?.textContent).toBe('1 h');
    expect(root.textContent).toContain('1 h of 3 h outside the app this week');
    expect(root.querySelector('.ring__fill')?.getAttribute('stroke-dasharray')?.startsWith('71.2')).toBe(true);
  });

  it('"(reported)" marks outside rows only; the honest-share paragraph is stated; the new copy passes the banned lint', async () => {
    await makeTestStore({ save: { ledger: { entries: [[TODAY, 20, 0, 1], [TODAY, 10, 0, 0]] } } });
    mount();
    expect(root.querySelector('.ledger .title-lockup')?.textContent).not.toContain('(reported)');
    expect(root.querySelector('#ledger-life-title')?.textContent).not.toContain('(reported)');
    expect(root.querySelector('[data-tile-external] .tag')?.textContent).toBe('(reported)');
    expect(root.querySelector('.ledger__week-text .tag')?.textContent).toBe('(reported)');
    expect(root.querySelectorAll('.tag').length).toBeGreaterThan(0);
    for (const tag of Array.from(root.querySelectorAll('.ledger__tiles .tag'))) expect(tag.closest('[data-tile-external]')).not.toBeNull();

    const share = root.querySelector('[data-honest-share]');
    expect(share?.textContent).toContain(S.honestShare);
    expect(share?.querySelector('[lang="ja"]')?.textContent).toBe('声');
    expect(share?.textContent).toContain(S.dojoVoicesTitle);
    expect(S.honestShare).toMatch(/39 hours/);
    expect(S.honestShare).toMatch(/7 hours/);
    expect(S.honestShare).toMatch(/75–95 hours/);
    expect(S.peraperaFlagSynthetic).toBe("Synthetic: every voice in the dojo is a VOICEVOX character voice. The ledger's outside hours are real people.");

    const text = root.textContent ?? '';
    expect(findBanned(text)).toEqual([]);
    expect(text).not.toContain('!');
    expect(text).not.toMatch(/recorded voice|every voice in the app is text-to-speech|real listening is the hours you log/i);
  });
});
