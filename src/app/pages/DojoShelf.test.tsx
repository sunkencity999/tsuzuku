import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { badgeCategoryCount, durableFieldsOf, sceneInputs } from '@/art/dojo/DojoScene';
import { MON_SLOTS } from '@/art/dojo/room';
import { href } from '@/shared/routes';
import type { SceneSeen } from '@/shared/store-types';
import { resetStoreForTests, store } from '@/store';
import { card, makeTestStore, type TestStoreOptions } from '@/store/testing';
import { DojoShelf, SEAL_IDS, lanternLabel, sealsOf, shelfSince, spiritTotal, stampCount, type DojoShelfProps } from './DojoShelf';
import { BELT_NAME, S, fmt } from './strings';

const PAGES_CSS = readFileSync(resolve(process.cwd(), 'src/app/pages/pages.css'), 'utf8');
const SHELF_CSS = PAGES_CSS.slice(PAGES_CSS.indexOf('/* ── the shelf of seals'), PAGES_CSS.indexOf('/* ── Onboarding'));
const ruleOf = (sel: string): string => {
  const at = SHELF_CSS.indexOf(sel);
  if (at < 0) return '';
  const open = SHELF_CSS.indexOf('{', at);
  return SHELF_CSS.slice(open + 1, SHELF_CSS.indexOf('}', open));
};

/** Two Black-belt vocab items and one Black kanji (every facet S ≥ 120 d), one Brown item that must not count. */
const BLACK_CARDS: NonNullable<TestStoreOptions['cards']> = {
  'v-n5-0001#rec': card({ s: 200, state: 2, due: 20_600 }),
  'v-n5-0001#prod': card({ s: 150, state: 2, due: 20_600 }),
  'v-n5-0002#rec': card({ s: 300, state: 2, due: 20_600 }),
  'v-n5-0002#prod': card({ s: 130, state: 2, due: 20_600 }),
  'j-食#comp': card({ s: 400, state: 2, due: 20_600 }),
  'j-食#read': card({ s: 125, state: 2, due: 20_600 }),
  'v-n5-0003#rec': card({ s: 200, state: 2, due: 20_600 }),
  'v-n5-0003#prod': card({ s: 30, state: 2, due: 20_600 }),
};
const BADGES = { 'first-step': 20_400, tsuzuku: 20_401 } as const;
const STAMPS = { 1: { at: 20_400, perfect: true, assisted: false }, 4: { at: 20_410, perfect: false, assisted: false }, 7: { at: 20_420, perfect: false, assisted: true } };

const NOW: SceneSeen = {
  belt: 'green',
  level: 23,
  dan: 0,
  badgeCategories: 2,
  latestStamp: 'Odawara',
  kageBeaten: false,
  totalDays: 12,
  streak: 3,
  blooming: false,
  pruned: false,
  counts: { kana: 0, vocab: 2, kanji: 1, grammar: 0, component: 0, chunk: 0 },
  station: 7,
  flame: 'lit',
};

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 1));
async function mountShelf(props: DojoShelfProps): Promise<void> {
  await act(async () => {
    render(<DojoShelf {...props} />, root);
    await tick();
  });
}
const seals = (): HTMLAnchorElement[] => Array.from(root.querySelectorAll<HTMLAnchorElement>('.seal-tile'));
const grown = (): string[] => seals().filter((a) => a.hasAttribute('data-since')).map((a) => a.getAttribute('data-tile')!);

describe('shelfSince — only growth is marked (design 09 §7 A, §8)', () => {
  it('a first visit (no sceneSeen) marks nothing; an unchanged picture marks nothing', () => {
    expect(shelfSince(undefined, NOW)).toEqual([]);
    expect(shelfSince(NOW, NOW)).toEqual([]);
    expect(shelfSince({ ...NOW }, { ...NOW, counts: { ...NOW.counts } })).toEqual([]);
  });

  it('each seal grows on its own value, in shelf order', () => {
    expect(shelfSince({ ...NOW, belt: 'orange' }, NOW)).toEqual(['belt']);
    expect(shelfSince({ ...NOW, dan: 0 }, { ...NOW, dan: 1 })).toEqual(['belt']);
    expect(shelfSince({ ...NOW, level: 22 }, NOW)).toEqual(['lanterns']);
    expect(shelfSince({ ...NOW, totalDays: 11 }, NOW)).toEqual(['days']);
    expect(shelfSince({ ...NOW, latestStamp: 'Hakone' }, NOW)).toEqual(['goshuin']);
    expect(shelfSince({ ...NOW, latestStamp: undefined }, NOW)).toEqual(['goshuin']);
    expect(shelfSince({ ...NOW, badgeCategories: 1 }, NOW)).toEqual(['mon']);
    expect(shelfSince({ ...NOW, counts: { vocab: 1, kanji: 1 } }, NOW)).toEqual(['spirits']);
    expect(shelfSince({ ...NOW, belt: 'orange', level: 10, totalDays: 1, latestStamp: undefined, badgeCategories: 0, counts: {} }, NOW)).toEqual([...SEAL_IDS]);
  });

  it('a loss is never marked: fewer days, a level or a belt behind, fewer spirits, a goshuin gone, a cooled hearth', () => {
    expect(shelfSince({ ...NOW, totalDays: 13 }, NOW)).toEqual([]);
    expect(shelfSince({ ...NOW, level: 24 }, NOW)).toEqual([]);
    expect(shelfSince({ ...NOW, dan: 2 }, NOW)).toEqual([]);
    expect(shelfSince({ ...NOW, counts: { vocab: 5 } }, NOW)).toEqual([]);
    expect(shelfSince({ ...NOW, badgeCategories: 3 }, NOW)).toEqual([]);
    expect(shelfSince(NOW, { ...NOW, latestStamp: undefined })).toEqual([]);
    expect(shelfSince({ ...NOW, flame: 'gold' }, { ...NOW, flame: 'broken' })).toEqual([]);
  });

  it('spiritTotal sums the partial counts and ignores junk; stampCount counts the entries under a station number', () => {
    expect(spiritTotal(undefined)).toBe(0);
    expect(spiritTotal({})).toBe(0);
    expect(spiritTotal(NOW.counts)).toBe(3);
    expect(spiritTotal({ vocab: 2.9, kanji: -1, chunk: Number.NaN })).toBe(2);
    expect(stampCount({})).toBe(0);
    expect(stampCount(STAMPS)).toBe(3);
    expect(stampCount({ 3: undefined, 5: STAMPS[1] })).toBe(1);
  });
});

describe('sealsOf — the six seals and their words', () => {
  it('belt · tatami, Lv · lanterns, days, goshuin, mon of nine, word-spirits; every seal kanji is one the UI already holds', () => {
    const list = sealsOf({ belt: 'green', level: 23, totalDays: 12, badgeCategories: 2, counts: NOW.counts, stamps: 3 });
    expect(list.map((s) => s.id)).toEqual([...SEAL_IDS]);
    expect(list.map((s) => s.ja)).toEqual([S.sealBeltJa, S.sealLanternJa, S.sealDaysJa, S.sealStampJa, S.sealMonJa, S.sealSpiritJa]);
    expect(list.map((s) => s.value)).toEqual(['Green', 'Lv 23', '12', '3', '2 / 9', '3']);
    expect(list.map((s) => s.label)).toEqual(['5 tatami', '2 lanterns', 'days trained', 'goshuin', 'mon', 'word-spirits']);
    expect(list.map((s) => href(s.route))).toEqual([
      href({ name: 'collections', tab: 'kakejiku' }),
      href({ name: 'records' }),
      href({ name: 'records' }),
      href({ name: 'collections', tab: 'goshuin' }),
      href({ name: 'collections', tab: 'mon' }),
      href({ name: 'records' }),
    ]);
    // every name is the reading and the English meaning, the house gloss shape ("obi · belt"); no label repeats its meaning
    expect(list.map((s) => s.name)).toEqual(['obi · belt', 'tomoshibi · lantern', 'hi · day', 'in · seal', 'mon · crest', 'tama · spirit']);
    for (const s of list) expect(s.name).toMatch(/^[a-z]+ · [a-z]+$/);
  });

  it('singulars and caps: one day, one word-spirit, the first lantern at level 10, the Mon count never above the shelf’s slots, Black is the full ten tatami', () => {
    const one = sealsOf({ belt: 'black', level: 7, totalDays: 1, badgeCategories: 20, counts: { kana: 1 }, stamps: 0 });
    expect(one[0]?.value).toBe(BELT_NAME.black);
    expect(one[0]?.label).toBe(fmt(S.sealBeltLabel, { n: 10 }));
    expect(one[1]?.label).toBe(S.sealLanternLabelNone);
    expect(one[2]?.label).toBe(S.sealDaysLabelOne);
    expect(one[4]?.value).toBe(`${MON_SLOTS} / ${MON_SLOTS}`);
    expect(one[5]?.value).toBe('1');
    expect(one[5]?.label).toBe(S.sealSpiritLabelOne);
    expect(lanternLabel(9)).toBe(S.sealLanternLabelNone);
    expect(lanternLabel(10)).toBe(S.sealLanternLabelOne);
    expect(lanternLabel(19)).toBe(S.sealLanternLabelOne);
    expect(lanternLabel(20)).toBe('2 lanterns');
    expect(lanternLabel(150)).toBe('10 lanterns');
    expect(lanternLabel(Number.NaN)).toBe(S.sealLanternLabelNone);
  });
});

describe('<DojoShelf>', () => {
  it('renders six seals from the store — aria-hidden kanji, the reading and meaning as a visible first line, the value in the pixel face, the label muted — each a link to the room the hotspot opened', async () => {
    await makeTestStore({
      save: { profile: { belt: 'green', level: 23, xp: 2000 }, streak: { totalDays: 12, current: 3 }, stats: { sessions: 12 }, collections: { badges: BADGES, stamps: STAMPS } },
      cards: BLACK_CARDS,
    });
    await mountShelf({ reduced: false });
    const shelf = root.querySelector('[data-shelf]')!;
    // a real list with no ARIA role anywhere: `role="listitem"` on an `a[href]` replaces its link role (the seals would
    // leave the links rotor and "next link"), so the shelf is a ul of li, each holding one plain link
    expect(shelf.tagName).toBe('UL');
    expect(shelf.hasAttribute('role')).toBe(false);
    expect(shelf.getAttribute('aria-label')).toBe(S.dojoShelfLabel);
    expect(shelf.hasAttribute('data-since')).toBe(false);
    const list = seals();
    expect(list.map((a) => a.getAttribute('data-tile'))).toEqual([...SEAL_IDS]);
    expect(list.map((a) => a.tagName)).toEqual(Array(6).fill('A'));
    expect(list.map((a) => a.parentElement?.tagName)).toEqual(Array(6).fill('LI'));
    expect(list.every((a) => a.parentElement?.parentElement === shelf)).toBe(true);
    expect(shelf.children).toHaveLength(6);
    expect(shelf.querySelectorAll('[role]')).toHaveLength(0);
    expect(list.map((a) => a.querySelector('.seal-tile__v')?.textContent)).toEqual(['Green', 'Lv 23', '12', '3', `${badgeCategoryCount(BADGES)} / ${MON_SLOTS}`, '3']);
    expect(list.map((a) => a.querySelector('.seal-tile__n')?.textContent)).toEqual(['5 tatami', '2 lanterns', 'days trained', 'goshuin', 'mon', 'word-spirits']);
    expect(list.map((a) => a.getAttribute('href'))).toEqual([
      href({ name: 'collections', tab: 'kakejiku' }),
      href({ name: 'records' }),
      href({ name: 'records' }),
      href({ name: 'collections', tab: 'goshuin' }),
      href({ name: 'collections', tab: 'mon' }),
      href({ name: 'records' }),
    ]);
    const k = list[0]!.querySelector('.seal-tile__k')!;
    expect(k.textContent).toBe(S.sealBeltJa);
    expect(k.getAttribute('lang')).toBe('ja');
    expect(k.getAttribute('aria-hidden')).toBe('true');
    // the reading and meaning are a visible line, never .visually-hidden: a sighted learner meets the belt kanji with "obi · belt" beside it
    expect(list[0]!.querySelector('.seal-tile__r')?.textContent).toBe(S.sealBeltName);
    expect(list[5]!.querySelector('.seal-tile__r')?.textContent).toBe(S.sealSpiritName);
    expect(root.querySelector('.visually-hidden, .sr-only')).toBeNull();
    for (const a of list) expect(a.querySelector('.seal-tile__r')?.textContent).toMatch(/^[a-z]+ · [a-z]+$/);
    // the reading precedes the value in reading order
    expect(list[0]!.textContent).toBe(`${S.sealBeltJa}${S.sealBeltName}Green${fmt(S.sealBeltLabel, { n: 5 })}`);
    // no marks without the arrival; nothing written
    expect(grown()).toEqual([]);
    expect(root.querySelector('.ink-nijimi')).toBeNull();
    expect(store.progress.value.sceneSeen).toBeUndefined();
  });

  it('on the arrival it marks the grown seals with data-since and one .ink-nijimi (--i staggered) and persists sceneSeen — the scene’s own durable fields — once', async () => {
    await makeTestStore({ save: { profile: { level: 20, xp: 1500 }, streak: { totalDays: 12, current: 3 }, stats: { sessions: 12 }, collections: { stamps: STAMPS } } });
    const seen: SceneSeen = { ...durableFieldsOf(sceneInputs()), level: 10, totalDays: 5 };
    store.patch('progress', (p) => ({ ...p, sceneSeen: seen }));
    let writes = 0;
    let prev = store.progress.peek().sceneSeen;
    const stop = store.progress.subscribe((p) => {
      if (p.sceneSeen !== prev) {
        prev = p.sceneSeen;
        writes++;
      }
    });
    await mountShelf({ arrival: true, reduced: false });
    stop();
    expect(root.querySelector('[data-shelf]')?.getAttribute('data-since')).toBe('lanterns days');
    expect(grown()).toEqual(['lanterns', 'days']);
    const inked = seals().filter((a) => a.classList.contains('ink-nijimi'));
    expect(inked.map((a) => a.getAttribute('data-tile'))).toEqual(['lanterns', 'days']);
    expect(inked.map((a) => a.style.getPropertyValue('--i'))).toEqual(['0', '1']);
    expect(root.querySelector('[data-ring]')).toBeNull();
    expect(writes).toBe(1);
    expect(store.progress.value.sceneSeen).toEqual(durableFieldsOf(sceneInputs()));
    expect(store.progress.value.sceneSeen?.level).toBe(20);
    // a re-render of the same mount diffs nothing new and writes nothing
    const before = store.progress.value;
    await act(async () => {
      store.patch('settings', (s) => ({ ...s }));
      await tick();
    });
    expect(grown()).toEqual(['lanterns', 'days']);
    expect(store.progress.value).toBe(before);
  });

  it('reduced motion: the grown seal carries data-ring (a static 1 px --kin ring) and no .ink-* class; a first visit marks nothing but still records the picture', async () => {
    await makeTestStore({ save: { profile: { level: 20, xp: 1500 }, streak: { totalDays: 12, current: 3 }, stats: { sessions: 12 }, settings: { reducedMotion: true } } });
    store.patch('progress', (p) => ({ ...p, sceneSeen: { ...durableFieldsOf(sceneInputs()), level: 10 } }));
    await mountShelf({ arrival: true, reduced: true });
    expect(grown()).toEqual(['lanterns']);
    expect(root.querySelector('[data-tile="lanterns"]')?.hasAttribute('data-ring')).toBe(true);
    expect(root.querySelector('[data-tile="days"]')?.hasAttribute('data-ring')).toBe(false);
    expect(root.innerHTML).not.toMatch(/class="[^"]*\bink-/);
    expect(ruleOf('.seal-tile[data-ring] .seal-tile__k {')).toMatch(/outline:\s*1px solid var\(--kin\)/);

    render(null, root);
    resetStoreForTests();
    await makeTestStore({ save: { profile: { level: 20, xp: 1500 }, streak: { totalDays: 12, current: 3 }, stats: { sessions: 12 } } });
    expect(store.progress.value.sceneSeen).toBeUndefined();
    await mountShelf({ arrival: true, reduced: false });
    expect(grown()).toEqual([]);
    expect(root.querySelector('.ink-nijimi')).toBeNull();
    expect(store.progress.value.sceneSeen).toEqual(durableFieldsOf(sceneInputs()));

    // without the arrival nothing is written even when the picture is behind
    render(null, root);
    store.patch('progress', (p) => ({ ...p, sceneSeen: { ...durableFieldsOf(sceneInputs()), level: 10 } }));
    await mountShelf({ arrival: false, reduced: false });
    expect(grown()).toEqual([]);
    expect(store.progress.value.sceneSeen?.level).toBe(10);
  });

  it('the shelf CSS: ≤ 1,300 bytes (the list reset, the li grid and the reading line on top of the 1,200 the seals took), tokens only, the seal ≥ 44 px tall, six across from 640 px, the kanji off Mincho (09 §3.1: outside the Shippori shell), the value in the pixel face, the reading muted and small, the bleed delayed past the column, no transition', () => {
    expect(SHELF_CSS.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(SHELF_CSS)).toBeLessThanOrEqual(1300);
    expect(SHELF_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(SHELF_CSS).not.toMatch(/\brgba?\(/);
    expect(SHELF_CSS).not.toMatch(/transition/);
    expect(SHELF_CSS).not.toMatch(/[㐀-鿿]/);
    expect(ruleOf('.dojo__shelf {')).toMatch(/grid-template-columns:\s*repeat\(3, 1fr\)/);
    // the li is a grid so its link stretches to the row (the links were the grid items before the list was real)
    expect(ruleOf('.dojo__shelf > li {')).toMatch(/display:\s*grid/);
    expect(SHELF_CSS).toMatch(/@media \(min-width: 640px\) \{ \.dojo__shelf \{ grid-template-columns: repeat\(6, 1fr\)/);
    expect(ruleOf('.seal-tile {')).toMatch(/min-height:\s*var\(--touch\)/);
    expect(ruleOf('.seal-tile {')).toMatch(/text-decoration:\s*none/);
    expect(ruleOf('.seal-tile__k {')).toMatch(/font-family:\s*var\(--font-ja\)/);
    expect(ruleOf('.seal-tile__k {')).not.toMatch(/mincho|brush/);
    expect(ruleOf('.seal-tile__v {')).toMatch(/font-family:\s*var\(--font-pixel\)/);
    expect(ruleOf('.seal-tile__n {')).toMatch(/color:\s*var\(--fg-muted\)/);
    expect(ruleOf('.seal-tile__r, .seal-tile__n {')).toMatch(/font-size:\s*var\(--fs-1\)/);
    expect(ruleOf('.seal-tile.ink-nijimi {')).toMatch(/animation-delay:\s*calc\(var\(--dur-4\) \+ min\(var\(--i, 0\), 7\) \* var\(--stagger\)\)/);
  });
});
