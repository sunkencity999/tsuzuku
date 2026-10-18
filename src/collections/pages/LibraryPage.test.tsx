import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { createFakeLoader, G, V } from '../../content/fixtures';
import type { CardKey } from '../../content/types';
import { installServices, nullAudio, resetServices, type AudioSource } from '../../shared/audio';
import { CardFlag, hasFlag, type CardTuple } from '../../shared/store-types';
import { epochDay } from '../../shared/time';
import { store } from '../../store';
import { resetStoreForTests } from '../../store/store';
import { DEFAULT_TEST_NOW, card, makeTestStore } from '../../store/testing';
import { markOpened, resetOpenedForTests } from '../reveal';
import LibraryPage, { voiceMissing } from './LibraryPage';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const ROUTE = { name: 'library' } as const;

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  resetServices();
  resetOpenedForTests();
});

const CARDS: Record<CardKey, CardTuple> = {
  'k-h-a#rec': card({ s: 10, reps: 5, state: 2, due: TODAY + 3 }),
  [`${V.私}#rec`]: card({ s: 40, reps: 9, state: 2, due: TODAY + 20 }),
  [`${V.私}#prod`]: card({ s: 10, reps: 4, state: 2, due: TODAY + 5 }),
  [`${V.犬}#rec`]: card({ s: 0, reps: 0, state: 0, due: TODAY }),
  [`${V.食べる}#rec`]: card({ s: 1.5, reps: 1, state: 2, due: TODAY + 1 }),
  'j-食#comp': card({ s: 2, reps: 1, state: 2, due: TODAY + 1 }),
  [`${G.です}#cloze`]: card({ s: 8, reps: 3, state: 2, due: TODAY + 4 }),
};

async function mount(o: { cards?: Record<CardKey, CardTuple>; michikusa?: string[]; station?: number; belt?: 'white' | 'yellow' | 'orange' | 'green' | 'blue' | 'purple' | 'brown' | 'black' } = {}): Promise<void> {
  await makeTestStore({
    cards: o.cards ?? CARDS,
    save: { progress: { station: o.station ?? 4 }, collections: { michikusa: o.michikusa ?? ['m-04-2'] }, ...(o.belt ? { profile: { belt: o.belt } } : {}) },
  });
  await act(async () => {
    render(<LibraryPage route={ROUTE} loader={createFakeLoader()} />, root);
  });
  for (let i = 0; i < 40 && !root.querySelector('.library__station, .empty'); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const q = <T extends Element>(sel: string): T => root.querySelector<T>(sel)!;
const qa = (sel: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(sel));
const rows = (): HTMLElement[] => qa('.library__item');
const type = (sel: string, value: string): void => {
  act(() => {
    const el = q<HTMLInputElement>(sel);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const choose = (sel: string, value: string): void => {
  act(() => {
    const el = q<HTMLSelectElement>(sel);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

describe('<LibraryPage> items', () => {
  it('groups introduced items by station with belts and kinds; the current station opens, the others expand on tap', async () => {
    await mount();
    expect(q<HTMLElement>('.library').dataset.items).toBe('6');
    expect(q<HTMLElement>('.library__lede').textContent).toContain('6 items introduced');
    const stations = qa('.library__station');
    expect(stations.map((s) => s.dataset.station)).toEqual(['1', '4']);
    expect(stations[0]?.textContent).toContain('品川');
    expect(stations[0]?.textContent).toContain('3 items');
    expect(stations[1]?.textContent).toContain('保土ヶ谷');
    // station 4 (current) is open, station 1 closed
    expect(stations[1]?.querySelector('.library__station-head')?.getAttribute('aria-expanded')).toBe('true');
    expect(stations[0]?.querySelector('.library__station-head')?.getAttribute('aria-expanded')).toBe('false');
    expect(rows().map((r) => r.dataset.id)).toEqual(['v-n5-0006', 'j-食', 'g-n5-001']);
    const eat = q<HTMLElement>('.library__item[data-id="j-食"]');
    expect(eat.dataset.kind).toBe('kanji');
    expect(eat.dataset.belt).toBe('yellow');
    expect(eat.textContent).toContain('食');
    expect(eat.textContent).toContain('eat');
    expect(eat.querySelector('.library__belt')?.textContent).toBe('Yellow');

    act(() => stations[0]!.querySelector<HTMLButtonElement>('.library__station-head')!.click());
    expect(q<HTMLElement>('.library__station[data-station="1"] .library__station-head').getAttribute('aria-expanded')).toBe('true');
    const me = q<HTMLElement>('.library__item[data-id="v-n5-0001"]');
    expect(me.dataset.belt).toBe('brown');
    expect(me.textContent).toContain('わたし');
    expect(q<HTMLElement>('.library__item[data-id="k-h-a"]').dataset.kind).toBe('kana');
  });

  it('search by romaji, kana or meaning flattens the shelves; kind and belt filters narrow them', async () => {
    await mount();
    type('#library-search', 'inu');
    expect(rows().map((r) => r.dataset.id)).toEqual(['v-n5-0002']);
    type('#library-search', 'たべ');
    expect(rows().map((r) => r.dataset.id)).toEqual(['v-n5-0006', 'j-食']);
    type('#library-search', 'eat');
    expect(rows().map((r) => r.dataset.id)).toEqual(['v-n5-0006', 'j-食']);
    choose('#library-kind', 'kanji');
    expect(rows().map((r) => r.dataset.id)).toEqual(['j-食']);
    type('#library-search', '');
    choose('#library-kind', '');
    choose('#library-belt', 'brown');
    expect(rows().map((r) => r.dataset.id)).toEqual(['v-n5-0001']);
    choose('#library-belt', 'black');
    expect(q<HTMLElement>('.empty').textContent).toBe('Nothing matches.');
    choose('#library-belt', '');
    expect(qa('.library__station')).toHaveLength(2);
  });

  it('the detail sheet speaks, marks known and retires / restores through the writer', async () => {
    const speakSpy = vi.fn(() => Promise.resolve());
    installServices({ audio: { ...nullAudio, speak: speakSpy } });
    await mount();
    act(() => q<HTMLButtonElement>('.library__station[data-station="1"] .library__station-head').click());
    const trigger = q<HTMLButtonElement>('.library__item[data-id="v-n5-0001"]');
    act(() => trigger.click());
    const dialog = q<HTMLElement>('[role="dialog"]');
    expect(dialog.textContent).toContain('私');
    expect(dialog.textContent).toContain('わたし');
    expect(dialog.textContent).toContain('Brown belt');
    expect(dialog.querySelector('ruby')).not.toBeNull();
    expect(dialog.textContent).toContain('S 40 d');
    // facets read as learner words, never the internal keys
    const facetText = dialog.querySelector('.library-detail__facets')!.textContent!;
    expect(facetText).toContain('meaning');
    expect(facetText).toContain('production');
    expect(facetText).not.toMatch(/\b(rec|prod)\b/);
    expect(document.activeElement).toBe(dialog.querySelector('[data-action="close"]'));

    act(() => dialog.querySelector<HTMLButtonElement>('[data-action="listen"]')!.click());
    expect(speakSpy).toHaveBeenCalledWith('私', { kana: 'わたし' });
    expect(dialog.querySelector('.library-detail__status')?.textContent).toContain('No Japanese voice');

    act(() => dialog.querySelector<HTMLButtonElement>('[data-action="retire"]')!.click());
    expect(hasFlag(store.cards.get('v-n5-0001#rec')![7], CardFlag.archived)).toBe(true);
    expect(hasFlag(store.cards.get('v-n5-0001#prod')![7], CardFlag.archived)).toBe(true);
    expect(q<HTMLElement>('[role="dialog"]').textContent).toContain('nothing is deleted');
    expect(q<HTMLElement>('[role="dialog"] [data-action="retire"]').textContent).toBe('Restore');
    act(() => q<HTMLButtonElement>('[role="dialog"] [data-action="retire"]').click());
    expect(hasFlag(store.cards.get('v-n5-0001#rec')![7], CardFlag.archived)).toBe(false);

    act(() => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(q('.library__item[data-id="v-n5-0001"]'));

    // 犬 is a fresh card: "Already know this" warm-starts it
    act(() => q<HTMLButtonElement>('.library__item[data-id="v-n5-0002"]').click());
    act(() => q<HTMLButtonElement>('[role="dialog"] [data-action="known"]').click());
    const rec = store.cards.get('v-n5-0002#rec')!;
    expect(rec[1]).toBeGreaterThan(0);
    expect(rec[5]).toBe(2);
    expect(q<HTMLElement>('[role="dialog"]').textContent).toContain('Marked as known');
  });

  it('the detail sheet traps Tab: past Close wraps to the first action, Shift+Tab from it wraps back', async () => {
    await mount();
    act(() => q<HTMLButtonElement>('.library__station[data-station="1"] .library__station-head').click());
    act(() => q<HTMLButtonElement>('.library__item[data-id="v-n5-0001"]').click());
    const dialog = q<HTMLElement>('[role="dialog"]');
    const close = dialog.querySelector<HTMLButtonElement>('[data-action="close"]')!;
    const first = dialog.querySelector<HTMLButtonElement>('[data-action="listen"]')!;
    expect(document.activeElement).toBe(close);
    act(() => {
      close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(first);
    act(() => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    });
    expect(document.activeElement).toBe(close);
    // the backdrop still closes on click and hands focus back to the row
    act(() => q<HTMLElement>('.library-detail').click());
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(q('.library__item[data-id="v-n5-0001"]'));
  });

  it('shows the empty state when nothing has been introduced', async () => {
    await mount({ cards: {} });
    expect(q<HTMLElement>('.empty').textContent).toContain('No items yet');
    expect(rows()).toHaveLength(0);
  });
});

describe('<LibraryPage> voice status (design 08 §8)', () => {
  const openListen = (): HTMLElement => {
    act(() => q<HTMLButtonElement>('.library__station[data-station="1"] .library__station-head').click());
    act(() => q<HTMLButtonElement>('.library__item[data-id="v-n5-0001"]').click());
    act(() => q<HTMLButtonElement>('[role="dialog"] [data-action="listen"]').click());
    return q<HTMLElement>('[role="dialog"] .library-detail__status');
  };

  it('shows no "no voice" notice when the pack speaks (source clips) even with no device voice', async () => {
    const speakSpy = vi.fn(() => Promise.resolve());
    installServices({ audio: { ...nullAudio, speak: speakSpy, hasJaVoice: signal(false), source: signal<AudioSource>('clips') } });
    await mount();
    expect(openListen().textContent).toBe('');
    expect(speakSpy).toHaveBeenCalledWith('私', { kana: 'わたし' });
  });

  it('a ready pack the learner has not chosen is the device voice (no notice while one exists); a ready pack under "device" with no device voice shows the notice; the same pack chosen but muted (idle source none) does not — the remedy is the volume, not an OS voice', async () => {
    installServices({ audio: { ...nullAudio, hasJaVoice: signal(true), packReady: signal(true), source: signal<AudioSource>('synth') } });
    await mount();
    expect(openListen().textContent).toBe('');

    render(null, root);
    resetStoreForTests();
    installServices({ audio: { ...nullAudio, hasJaVoice: signal(false), canSpeak: signal(false), packReady: signal(true), source: signal<AudioSource>('none') } });
    await mount();
    store.patch('settings', (s) => ({ ...s, audioSource: 'device' }));
    expect(openListen().textContent).toContain('No Japanese voice');

    render(null, root);
    resetStoreForTests();
    installServices({ audio: { ...nullAudio, hasJaVoice: signal(false), canSpeak: signal(false), packReady: signal(true), source: signal<AudioSource>('none') } });
    await mount();
    expect(store.settings.value.audioSource).toBe('pack');
    expect(openListen().textContent).toBe('');
  });

  it('voiceMissing reads voiceAudible + source, never hasJaVoice alone; packReady only together with the setting', () => {
    expect(voiceMissing(nullAudio)).toBe(true);
    expect(voiceMissing({ ...nullAudio, hasJaVoice: signal(true) })).toBe(false);
    expect(voiceMissing({ ...nullAudio, source: signal<AudioSource>('clips') })).toBe(false);
    // A ready pack the learner chose is a voice even while `source` idles at 'none' (volume 0); under 'device' it is not (design 08 §8 / §13).
    expect(voiceMissing({ ...nullAudio, packReady: signal(true) }, true)).toBe(false);
    expect(voiceMissing({ ...nullAudio, packReady: signal(true) }, false)).toBe(true);
    const mutedPack = { ...nullAudio, hasJaVoice: signal(false), canSpeak: signal(false), packReady: signal(true), source: signal<AudioSource>('none') };
    expect(voiceMissing(mutedPack, true)).toBe(false);
    expect(voiceMissing(mutedPack, false)).toBe(true);
    expect(voiceMissing({ ...nullAudio, hasJaVoice: signal(true), packReady: signal(true), source: signal<AudioSource>('synth') }, false)).toBe(false);
    // A muted device voice is still a voice: no install nag.
    expect(voiceMissing({ ...nullAudio, hasJaVoice: signal(true), canSpeak: signal(false) })).toBe(false);
    expect(voiceMissing({ ...nullAudio, hasJaVoice: signal(false), canSpeak: signal(false), source: signal<AudioSource>('synth') })).toBe(true);
  });
});

describe('<LibraryPage> michikusa', () => {
  it('renders collected fragments with ruby and the un-collected count per station, plus the reserved shelf', async () => {
    await mount();
    act(() => q<HTMLButtonElement>('#library-view-michikusa').click());
    expect(q<HTMLElement>('.library').dataset.view).toBe('michikusa');
    expect(q<HTMLElement>('.library__lede').textContent).toContain('1 of 10 fragments collected.');
    const st4 = q<HTMLElement>('.library__station[data-station="4"]');
    expect(st4.dataset.collected).toBe('1');
    expect(st4.dataset.missing).toBe('1');
    expect(st4.textContent).toContain('1 more at Hodogaya');
    const frag = st4.querySelector<HTMLElement>('.library__fragment[data-id="m-04-2"]')!;
    expect(frag.textContent).toContain('Dumplings over flowers');
    expect(frag.textContent).toContain('Proverb');
    expect(frag.querySelector('ruby rb')?.textContent).toBe('花');
    expect(frag.querySelector('[lang="ja"]')).not.toBeNull();
    const st2 = q<HTMLElement>('.library__station[data-station="2"]');
    expect(st2.textContent).toContain('Nothing collected here yet.');
    expect(st2.textContent).toContain('4 more at Kawasaki');
    const st1 = q<HTMLElement>('.library__station[data-station="1"]');
    expect(st1.querySelector('[data-more]')).toBeNull();
    const shelf = q<HTMLElement>('.library__shelf--empty');
    expect(shelf.textContent).toContain('四字熟語');
    expect(shelf.textContent).toContain('One hundred four-character idioms');
    expect(shelf.textContent).not.toContain('content pack');
    act(() => q<HTMLButtonElement>('#library-view-items').click());
    expect(q<HTMLElement>('.library').dataset.view).toBe('items');
  });

  it('shelves are .sheet cards whose open drawer expands through grid-template-rows; items introduced since the last open carry the gold dot (design 09 §9 C3)', async () => {
    await mount();
    // first open: nothing is new, the shelf is recorded
    expect(root.querySelector('.library__new')).toBeNull();
    for (const st of qa('.library__station')) expect(st.classList.contains('sheet')).toBe(true);
    expect(q<HTMLElement>('.library__station[data-station="4"] .library__drawer .library__items')).not.toBeNull();
    expect(root.querySelector('.library__station[data-station="1"] .library__drawer')).toBeNull();
    expect(root.querySelector('.library-detail__label')).toBeNull();

    render(null, root);
    resetStoreForTests();
    resetServices();
    resetOpenedForTests();
    markOpened('library', ['v-n5-0006']);
    await mount();
    expect(q<HTMLElement>('.library__item[data-id="j-食"]').hasAttribute('data-new')).toBe(true);
    expect(q<HTMLElement>('.library__item[data-id="j-食"] .library__new')).not.toBeNull();
    expect(q<HTMLElement>('.library__item[data-id="v-n5-0006"]').hasAttribute('data-new')).toBe(false);
    expect(q<HTMLElement>('.library__station[data-station="4"] .library__h3 .library__new')).not.toBeNull();
    expect(q<HTMLElement>('.library__new').getAttribute('aria-label')).toBeTruthy();
    // the dot says what it means on hover, and the row's own name carries it (an aria-label hides its descendants)
    expect(q<HTMLElement>('.library__new').getAttribute('title')).toBe(q<HTMLElement>('.library__new').getAttribute('aria-label'));
    expect(q<HTMLElement>('.library__item[data-id="j-食"]').getAttribute('aria-label')).toContain('New since you last opened this shelf');
    expect(q<HTMLElement>('.library__item[data-id="v-n5-0006"]').getAttribute('aria-label')).not.toContain('New since');
    // the drawer transition arms only once the shelves have painted (the shelf open on arrival never animates)
    expect(q<HTMLElement>('.library').hasAttribute('data-ready')).toBe(true);
    const css = readFileSync(resolve(process.cwd(), 'src/collections/pages/LibraryPage.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(/\.library__drawer\s*\{([^}]*)\}/.exec(css)?.[1]).not.toMatch(/transition/);
    expect(/\.library\[data-ready\] \.library__drawer\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/transition:\s*grid-template-rows var\(--dur-3\)/);
    expect(css).toMatch(/@starting-style\s*\{\s*\.library__drawer\s*\{\s*grid-template-rows:\s*0fr/);
  });

  it('shelf heads follow the reading rule (design 09 §3.3): romaji while kana are below Green, kana ruby from Green on — removed, not dimmed', async () => {
    await mount({ belt: 'yellow' });
    const head = q<HTMLElement>('.library__station[data-station="4"] .library__h3');
    expect(head.querySelector('[lang="ja"]')?.textContent).toBe('保土ヶ谷');
    expect(head.querySelector('ruby')).toBeNull();
    expect(head.querySelector('.library__romaji')?.textContent).toBe('4 · Hodogaya');

    render(null, root);
    resetStoreForTests();
    resetServices();
    resetOpenedForTests();
    await mount({ belt: 'green' });
    const green = q<HTMLElement>('.library__station[data-station="4"] .library__h3');
    expect(green.textContent).not.toContain('Hodogaya');
    const ruby = green.querySelector('.library__ruby');
    expect(ruby).not.toBeNull();
    expect(ruby?.getAttribute('lang')).toBe('ja');
    // kanaReading spells the name in katakana; <Ruby> sets furigana in its own kana convention — either reads
    expect(ruby?.querySelector('rt')?.textContent).toMatch(/^(ほどがや|ホドガヤ)$/);
    expect(ruby?.textContent?.replace(/ほどがや|ホドガヤ/g, '')).toBe('保土ヶ谷');
    expect(green.querySelector('.library__romaji')?.textContent).toBe('Station 4');
    // the detail sheet's due date is glossed too
    act(() => q<HTMLButtonElement>('.library__item[data-id="j-食"]').click());
    const facets = q<HTMLElement>('.library-detail__facets');
    expect(facets.textContent).toMatch(/due 令和\d+年\d+月\d+日 · Reiwa \d+ · [A-Z][a-z]{2} \d+/);
  });
});
