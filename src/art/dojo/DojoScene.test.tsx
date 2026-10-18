import { render } from 'preact';
import { act } from 'preact/test-utils';
import { vi } from 'vitest';
import { bus } from '@/shared/events';
import { href } from '@/shared/routes';
import type { SceneSeen } from '@/shared/store-types';
import { weekOf } from '@/shared/time';
import { resetStoreForTests, store } from '@/store';
import { DEFAULT_TEST_NOW, card, makeTestStore, type TestStoreOptions } from '@/store/testing';
import {
  DojoScene,
  HEARTH_RANK,
  KOTODAMA_MAX,
  PRUNED_AWAY_DAYS,
  PULSE_MS,
  PULSE_STAGGER_MS,
  SCENE_NODE_BUDGET,
  SCENE_SIZE,
  badgeCategoryCount,
  blackCounts,
  buildScene,
  crestsFor,
  durableFieldsOf,
  hotspotsFor,
  latestStampName,
  schedulePulses,
  sceneInputs,
  sceneKey,
  sinceCaption,
  sinceYesterday,
  syncLive,
} from './DojoScene';
import { PART_ID, skyId } from './room';
import { S, fill } from './strings';

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
  vi.useRealTimers();
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

/** Two Black-belt vocab items and one Black kanji (every facet S ≥ 120 d). */
const BLACK_CARDS: NonNullable<TestStoreOptions['cards']> = {
  'v-n5-0001#rec': card({ s: 200, state: 2, due: 20_600 }),
  'v-n5-0001#prod': card({ s: 150, state: 2, due: 20_600 }),
  'v-n5-0002#rec': card({ s: 300, state: 2, due: 20_600 }),
  'v-n5-0002#prod': card({ s: 130, state: 2, due: 20_600 }),
  'j-食#comp': card({ s: 400, state: 2, due: 20_600 }),
  'j-食#read': card({ s: 125, state: 2, due: 20_600 }),
  // Brown, not Black: production too young
  'v-n5-0003#rec': card({ s: 200, state: 2, due: 20_600 }),
  'v-n5-0003#prod': card({ s: 10, state: 2, due: 20_600 }),
};

async function mount(o: TestStoreOptions = {}, p: { compact?: boolean; arrival?: boolean } = {}): Promise<void> {
  await makeTestStore(o);
  act(() => render(<DojoScene compact={p.compact} arrival={p.arrival} />, root));
}

const art = (): HTMLElement => root.querySelector<HTMLElement>('.dojo-scene__art')!;
const settle = async (): Promise<void> => {
  await act(async () => {
    await tick();
  });
};

/** A `sceneSeen` equal to today's picture (so a diff pulses only what the test changes). */
function seenNow(): SceneSeen {
  return durableFieldsOf(sceneInputs());
}

describe('<DojoScene>', () => {
  it('renders the room SVG from a test store with themed tokens and the belt tatami; the live attributes sit on the art wrapper', async () => {
    await mount({ save: { profile: { belt: 'green', level: 23, chosenKanji: '続' }, streak: { totalDays: 42 } } });
    const a = art();
    expect(a.getAttribute('role')).toBe('img');
    expect(a.getAttribute('aria-label')).toContain('green belt');
    expect(a.getAttribute('aria-label')).toContain('42 training days');
    const svg = a.querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${SCENE_SIZE.full.w} ${SCENE_SIZE.full.h}`);
    expect(svg.querySelectorAll('.room__tatami').length).toBe(5);
    expect(svg.querySelector('.room__kanji text')?.textContent).toBe('続');
    expect(svg.querySelector('.bonsai')).not.toBeNull();
    expect(svg.querySelector('.dj-hf')).not.toBeNull();
    expect(a.innerHTML).toContain('var(--surface, #FFFBF3)');
    // 12:00 UTC test clock → daylight; the wrapper carries the live state
    expect(a.getAttribute('data-phase')).toBe('day');
    expect(a.getAttribute('data-lanterns')).toBe('unlit');
    expect(a.getAttribute('data-hearth')).toBe('unlit');
    expect(a.hasAttribute('data-since')).toBe(false);
    expect(root.querySelector('.dojo-scene')?.getAttribute('data-season')).toBe('winter'); // January
    // the sky rect took the day gradient
    expect(svg.querySelector('.room__sky--a')?.getAttribute('fill')).toBe(`url(#${skyId('day')})`);
  });

  it('black-item counts feed the kotodama flames after the idle slot', async () => {
    await mount({ cards: BLACK_CARDS });
    expect(root.querySelector('.dojo-scene')?.getAttribute('data-flames')).toBe('pending');
    expect(root.querySelectorAll('.dj-kf').length).toBe(0);
    await settle();
    expect(root.querySelector('.dojo-scene')?.getAttribute('data-flames')).toBe('ready');
    expect(root.querySelectorAll('use.dj-kf').length).toBe(3);
    expect(root.querySelectorAll('use[data-kind="vocab"]').length).toBe(2);
    expect(root.querySelectorAll('use[data-kind="kanji"]').length).toBe(1);
    const caption = root.querySelector('.dojo-scene__caption')!;
    expect(caption.getAttribute('data-total')).toBe('3');
    expect(caption.textContent).toContain(fill(S.kotodamaCount, { total: 3 }));
    expect(caption.querySelector('[lang="ja"]')?.textContent).toBe(S.kotodamaJa);
  });

  it('shows the honest empty line when nothing is Black yet', async () => {
    await mount();
    await settle();
    expect(root.querySelectorAll('.dj-kf').length).toBe(0);
    expect(root.querySelector('.dojo-scene__caption')?.textContent).toContain(S.kotodamaNone);
  });

  it('same store → identical markup (and a pure, keyed build)', async () => {
    await mount({ cards: BLACK_CARDS, save: { profile: { belt: 'blue', level: 41 }, streak: { totalDays: 150, current: 12 } } });
    await settle();
    const first = art().innerHTML;
    const other = document.createElement('div');
    document.body.appendChild(other);
    act(() => render(<DojoScene />, other));
    await settle();
    expect(other.querySelector('.dojo-scene__art')!.innerHTML).toBe(first);
    render(null, other);
    other.remove();

    const i = sceneInputs();
    expect(sceneKey(i)).toBe(sceneKey(sceneInputs()));
    expect(buildScene(i, true).svg).toBe(buildScene(i, true).svg);
    expect(buildScene(i, true).svg).toContain('class="dj-kotodama"');
    expect(buildScene(i, false).svg).not.toContain('class="dj-kotodama"');
  });

  it('the hour lights the room LIVE: a 23:00 clock gives night, lit lanterns (by class, with the lit paper) — and the scene key is unchanged across the hour (design 09 §10 B1)', async () => {
    let clock = DEFAULT_TEST_NOW; // 12:00 UTC, profile tz UTC
    await mount({ now: () => clock, save: { profile: { level: 30 } } });
    await settle(); // flames landed: the string is final for the visit
    const a = art();
    const keyNoon = sceneKey(sceneInputs());
    const svgNoon = a.querySelector('svg');
    expect(a.getAttribute('data-phase')).toBe('day');
    expect(root.querySelectorAll('.room__lantern--lit').length).toBe(0);

    clock = Date.UTC(2026, 0, 15, 23, 0, 0); // 23:00 the same learner day
    await act(async () => {
      store.patch('settings', (s) => ({ ...s })); // any signal: the scene re-reads the clock
      await tick();
    });
    expect(a.getAttribute('data-phase')).toBe('night');
    expect(a.getAttribute('data-lanterns')).toBe('lit');
    expect(root.querySelectorAll('.room__lantern--lit').length).toBe(3);
    expect(root.querySelector('.room__lanterns--lit')).not.toBeNull();
    expect(root.querySelector('.room__lantern-body')?.getAttribute('fill')).toBe('#FFD166');
    // the sky: --a took the night gradient, --b holds the day it fades from
    expect(a.querySelector('.room__sky--a')?.getAttribute('fill')).toBe(`url(#${skyId('night')})`);
    expect(a.querySelector('.room__sky--b')?.getAttribute('fill')).toBe(`url(#${skyId('day')})`);
    expect(a.querySelector('.room__sky--b')?.classList.contains('room__sky--fade')).toBe(true);
    // the string itself never changed (the same <svg> element, no innerHTML swap): the stars, moon and overlay were always there, shown by CSS on data-phase
    expect(sceneKey(sceneInputs())).toBe(keyNoon);
    expect(a.querySelector('svg')).toBe(svgNoon);
    expect(a.querySelector('.room__stars')).not.toBeNull();
    expect(a.querySelector('.room__moon')).not.toBeNull();
    expect(a.querySelector('.room__light')).not.toBeNull();
    expect(a.querySelector('.room__light')?.getAttribute('opacity')).toBe('0'); // CSS, not the string, sets 0.2 at night
  });

  it('reduced-motion path: no keyframes or animation anywhere in the scene', async () => {
    await mount({ cards: BLACK_CARDS, save: { settings: { reducedMotion: true }, streak: { lastDay: 20_468, current: 3 } } });
    await settle();
    const html = art().innerHTML;
    expect(root.querySelectorAll('.dj-kf').length).toBe(3);
    expect(html).not.toContain('@keyframes');
    expect(html).not.toContain('animation');
    // and the default path does animate (kotodama drift + hearth flicker)
    render(null, root);
    resetStoreForTests();
    await mount({ cards: BLACK_CARDS, save: { streak: { lastDay: 20_468, current: 3 } } });
    await settle();
    const live = art().innerHTML;
    expect(live).toContain('@keyframes dj-kf-drift-0');
    expect(live).toContain('@keyframes dj-hf-flicker');
    expect(live).toContain('prefers-reduced-motion');
  });

  it('hearth follows the streak flame BY CLASS and relights BY GROWING (§7 C): a lit save mounts unlit and takes dj-hf--steady once the picture is final; a full day → dj-hf--roaring; nothing → unlit; the string holds every state', async () => {
    await makeTestStore();
    const t = store.today();
    expect(t).toBeGreaterThan(20_000);
    resetStoreForTests();
    await mount({ save: { streak: { lastDay: t, current: 4 } } });
    // mounted: the wrapper already says steady, the class is HELD at unlit so the tongues have a scale 0 to grow from
    expect(art().getAttribute('data-hearth')).toBe('steady');
    expect(art().hasAttribute('data-hearth-held')).toBe(true);
    expect(root.querySelector('.dj-hf--unlit')).not.toBeNull();
    expect(root.querySelector('.dj-hf--steady')).toBeNull();
    await settle(); // the flames' idle slot: the string is final, the class flips (after a style flush) and the transition runs
    expect(art().hasAttribute('data-hearth-held')).toBe(false);
    expect(root.querySelector('.dj-hf--steady')).not.toBeNull();
    expect(root.querySelector('.dj-hf--unlit')).toBeNull();
    expect(root.querySelectorAll('.dj-hf-tongue').length).toBe(8);
    render(null, root);
    resetStoreForTests();
    await mount({ save: { streak: { lastDay: t, current: 4 }, quests: { day: t, ids: ['clear-due', 'learn-scroll', 'combo-twenty'], done: ['clear-due', 'learn-scroll', 'combo-twenty'] } } });
    expect(art().getAttribute('data-hearth')).toBe('roaring');
    expect(root.querySelector('.dj-hf--unlit')).not.toBeNull();
    await settle();
    expect(root.querySelector('.dj-hf--roaring')).not.toBeNull();
    expect(root.querySelectorAll('.dj-hf-tongue').length).toBe(8);
    render(null, root);
    resetStoreForTests();
    // reduced motion: the state is written at once (the swap rides --dur-fade), nothing is held
    await mount({ save: { streak: { lastDay: t, current: 4 }, settings: { reducedMotion: true } } });
    expect(art().hasAttribute('data-hearth-held')).toBe(false);
    expect(root.querySelector('.dj-hf--steady')).not.toBeNull();
    render(null, root);
    resetStoreForTests();
    await mount();
    expect(art().getAttribute('data-hearth')).toBe('unlit');
    expect(art().hasAttribute('data-hearth-held')).toBe(false);
    expect(root.querySelector('.dj-hf--unlit')).not.toBeNull();
    const hearthLink = root.querySelector('[data-hotspot="hearth"]')!;
    // day one: the never-lit hearth says "Unlit", never "out" (design 09 §7 A)
    expect(hearthLink.getAttribute('aria-label')).toContain(S.hearthNeverLit);
    expect(hearthLink.getAttribute('aria-label')).not.toContain(S.hearthUnlit);
  });

  it('a relight flips the class without a scene-key change or an innerHTML swap (design 09 §7 C)', async () => {
    await makeTestStore();
    const t = store.today();
    resetStoreForTests();
    await mount({ save: { streak: { lastDay: t, current: 4, totalDays: 12 }, quests: { day: t, ids: ['clear-due', 'learn-scroll', 'combo-twenty'], done: [] } } });
    await settle();
    const a = art();
    const key0 = sceneKey(sceneInputs());
    const svg0 = a.querySelector('svg')!;
    expect(a.getAttribute('data-hearth')).toBe('steady');
    expect(a.querySelector('.dj-hf')?.classList.contains('dj-hf--steady')).toBe(true);
    // the Three Kata done: a full day — gold, the hearth roars; the quests are not a scene input
    await act(async () => {
      store.patch('quests', (q) => ({ ...q, done: [...q.ids] }));
      await tick();
    });
    expect(a.getAttribute('data-hearth')).toBe('roaring');
    expect(a.querySelector('.dj-hf')?.classList.contains('dj-hf--roaring')).toBe(true);
    expect(a.querySelector('.dj-hf')?.classList.contains('dj-hf--steady')).toBe(false);
    expect(sceneKey(sceneInputs())).toBe(key0);
    expect(a.querySelector('svg')).toBe(svg0); // the same element: no innerHTML swap
    // the pure writer: a frozen flame shows the crystal by class
    syncLive(a, { phase: 'day', lit: false, hearth: 'steady', crystal: true }, 'day');
    expect(a.querySelector('.dj-hf')?.classList.contains('dj-hf--crystal')).toBe(true);
    expect(a.querySelector('svg')).toBe(svg0);
  });

  it('hotspots are links built with href(): scroll → station, bonsai/hearth → records, racks → collections; empty states speak in the labels', async () => {
    await mount({ save: { progress: { station: 7 }, profile: { belt: 'yellow' }, collections: { badges: { 'first-step': 20_400, seven: 20_401, 'three-day': 20_402 } } } });
    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('.dojo-scene__hotspot'));
    expect(links.length).toBe(6);
    const by = (id: string): HTMLAnchorElement => root.querySelector(`[data-hotspot="${id}"]`)!;
    expect(by('scroll').getAttribute('href')).toBe(href({ name: 'station', n: 7 }));
    expect(by('scroll').getAttribute('aria-label')).toBe(`${fill(S.hotspotScroll, { n: 7, name: '平塚' })} ${S.scrollEmpty}`);
    expect(by('bonsai').getAttribute('href')).toBe(href({ name: 'records' }));
    expect(by('hearth').getAttribute('href')).toBe(href({ name: 'records' }));
    expect(by('rack').getAttribute('href')).toBe(href({ name: 'collections', tab: 'kakejiku' }));
    expect(by('rack').getAttribute('aria-label')).toContain('yellow belt');
    expect(by('shelf').getAttribute('href')).toBe(href({ name: 'collections', tab: 'mon' }));
    expect(by('shelf').getAttribute('aria-label')).toBe(fill(S.hotspotShelf, { n: 2, total: 9 }));
    expect(by('stamps').getAttribute('href')).toBe(href({ name: 'collections', tab: 'goshuin' }));
    expect(by('stamps').getAttribute('aria-label')).toBe(`${S.hotspotStamps} ${S.stampsEmpty}`);
    for (const a of links) {
      expect(a.getAttribute('aria-label')).toBeTruthy();
      expect(a.style.left.endsWith('%')).toBe(true);
      expect(a.style.width.endsWith('%')).toBe(true);
    }
    // training + streak: two real crests on the shelf
    expect(root.querySelectorAll('.room__mon--earned').length).toBe(2);
    expect(root.querySelectorAll('use.room__mon--earned').length).toBe(2);
    expect(root.querySelectorAll('symbol[id^="dj-mon-"]').length).toBe(2);
  });

  it('station 0 sends the scroll to the road', async () => {
    await mount({ save: { progress: { station: 0 } } });
    expect(root.querySelector('[data-hotspot="scroll"]')?.getAttribute('href')).toBe(href({ name: 'road' }));
    expect(root.querySelector('[data-hotspot="scroll"]')?.getAttribute('aria-label')).toContain(S.hotspotScrollRoad);
  });

  it('collections and kage feed the picture: latest stamp open on the shared seal symbol, Kage sits the week it was beaten', async () => {
    await makeTestStore();
    const t = store.today();
    resetStoreForTests();
    await mount({
      save: {
        collections: { stamps: { 4: { at: 20_300, perfect: false, assisted: false }, 7: { at: 20_400, perfect: true, assisted: false }, 5: { at: 20_400, perfect: false, assisted: false } } },
        kage: { beatenWeek: weekOf(t) },
      },
    });
    expect(root.querySelector('.room__goshuin')).not.toBeNull();
    expect(root.querySelector('.room__goshuin use')?.getAttribute('href')).toBe('#dj-goshuin');
    expect(Array.from(root.querySelectorAll('.room__goshuin text')).map((e) => e.textContent).join('')).toBe('平塚');
    expect(root.querySelector('.room__kage')).not.toBeNull();
    render(null, root);
    resetStoreForTests();
    await mount({ save: { kage: { beatenWeek: weekOf(t) - 1 } } });
    expect(root.querySelector('.room__kage')).toBeNull();
    expect(root.querySelector('.room__book--closed')).not.toBeNull();
  });

  it('bonsai: blooms at 100 days, pruned after a long gap (the hotspot finally says so), compact stage', async () => {
    await mount({ save: { streak: { totalDays: 120 }, progress: { awayDays: PRUNED_AWAY_DAYS } } }, { compact: true });
    const b = root.querySelector('.bonsai')!;
    expect(b.classList.contains('bonsai--blooming')).toBe(true);
    expect(b.classList.contains('bonsai--pruned')).toBe(true);
    expect(b.getAttribute('data-healing')).toBe('0'); // no rows: returning today
    expect(root.querySelectorAll('.bonsai__bloom').length).toBeGreaterThan(0);
    expect(root.querySelector('[data-hotspot="bonsai"]')?.getAttribute('aria-label')).toContain(S.bonsaiPruned);
    expect(root.querySelector('.dojo-scene')?.classList.contains('dojo-scene--compact')).toBe(true);
    expect(root.querySelector('svg')?.getAttribute('viewBox')).toBe(`0 0 ${SCENE_SIZE.compact.w} ${SCENE_SIZE.compact.h}`);
    render(null, root);
    resetStoreForTests();
    await mount({ save: { streak: { totalDays: 30 }, progress: { awayDays: 0 } } });
    const b2 = root.querySelector('.bonsai')!;
    expect(b2.classList.contains('bonsai--blooming')).toBe(false);
    expect(b2.classList.contains('bonsai--pruned')).toBe(false);
    expect(root.querySelector('[data-hotspot="bonsai"]')?.getAttribute('aria-label')).not.toContain(S.bonsaiPruned);
  });

  it('bonsai healing: back from the mountain, the pads return over returnedDaysAgo / 7 (design 09 §8)', async () => {
    await makeTestStore();
    const t = store.today();
    resetStoreForTests();
    const daily: Record<number, { reps: number; ok: number; minutes: number; xp: number; input: number }> = {};
    const row = { reps: 10, ok: 8, minutes: 5, xp: 20, input: 0 };
    for (let d = t - 3; d <= t - 1; d++) daily[d] = row; // three days back
    daily[t - 20] = row; // trained before the absence (16 missed days)
    await mount({ save: { streak: { totalDays: 60 }, progress: { awayDays: 16 }, daily } });
    const b = root.querySelector('.bonsai')!;
    expect(b.classList.contains('bonsai--pruned')).toBe(true);
    expect(b.getAttribute('data-healing')).toBe('0.43'); // 3 / 7
  });

  it('stays under the node budget (≤ 420) with a full hall of flames, at day 1, day 30 and pruned, in both themes', async () => {
    const many: NonNullable<TestStoreOptions['cards']> = {};
    for (let i = 1; i <= 350; i++) {
      const id = `v-n5-${String(i).padStart(4, '0')}`;
      many[`${id}#rec`] = card({ s: 300, state: 2, due: 20_600 });
      many[`${id}#prod`] = card({ s: 200, state: 2, due: 20_600 });
    }
    const badges = { 'first-step': 20_400, seven: 20_401, gojuon: 20_402, 'belt-yellow': 20_403, tsuzuku: 20_404 };
    const count = (): number => root.querySelectorAll('.dojo-scene__art *').length;
    for (const save of [
      { profile: { belt: 'white' as const, level: 1 }, streak: { totalDays: 1 } },
      { profile: { belt: 'yellow' as const, level: 13 }, streak: { totalDays: 30, current: 30 }, collections: { badges } },
      { profile: { belt: 'black' as const, level: 99, dan: 3, chosenKanji: '道' }, streak: { totalDays: 400 }, collections: { badges, stamps: { 53: { at: 20_500, perfect: true, assisted: false } } }, kage: { beatenWeek: weekOf(20_468) } },
      { profile: { belt: 'brown' as const, level: 77 }, streak: { totalDays: 200 }, progress: { awayDays: PRUNED_AWAY_DAYS }, collections: { badges } },
    ]) {
      for (const scheme of ['light', 'dark']) {
        document.documentElement.setAttribute('data-color-scheme', scheme);
        await mount({ cards: many, now: Date.UTC(2026, 6, 15, 23, 0, 0), save });
        await settle();
        expect(root.querySelectorAll('.dj-kf').length).toBe(KOTODAMA_MAX.full);
        expect(count(), `${save.profile.belt} ${scheme}`).toBeLessThanOrEqual(SCENE_NODE_BUDGET);
        expect(root.querySelectorAll('.room__moon *').length + 1).toBeLessThanOrEqual(4);
        render(null, root);
        resetStoreForTests();
      }
    }
    document.documentElement.removeAttribute('data-color-scheme');
    expect(SCENE_NODE_BUDGET).toBe(420);
    const caption = root.querySelector('.dojo-scene__caption');
    expect(caption).toBeNull(); // unmounted
  });

  it('the July eaves carry the tanabata ornament with its reading and English in the caption', async () => {
    await mount({ now: Date.UTC(2026, 6, 15, 12, 0, 0) });
    expect(root.querySelector('.room__ornament--tanabata')).not.toBeNull();
    const label = root.querySelector('.dojo-scene__ornament')!;
    expect(label.getAttribute('data-ornament')).toBe('tanabata');
    expect(label.querySelector('[lang="ja"]')?.textContent).toBe(S.ornamentTanabataJa);
    expect(label.textContent).toContain(S.ornamentTanabataReading);
    expect(label.textContent).toContain(S.ornamentTanabataEn);
    render(null, root);
    resetStoreForTests();
    await mount({ now: Date.UTC(2026, 9, 15, 12, 0, 0) });
    expect(root.querySelector('.room__ornament')).toBeNull();
    expect(root.querySelector('.dojo-scene__ornament')).toBeNull();
  });
});

describe('since yesterday (design 09 §7 A, §8)', () => {
  it('on the arrival, a sceneSeen one lantern behind pulses the lantern: data-since, the caption, the twins two at a time, then sceneSeen is persisted', async () => {
    vi.useFakeTimers();
    await makeTestStore({ save: { profile: { level: 20 } } });
    const seen: SceneSeen = { ...seenNow(), level: 10 };
    store.patch('progress', (p) => ({ ...p, sceneSeen: seen }));
    const now = seenNow();
    expect(sinceYesterday(seen, now)).toEqual(['lantern']);
    act(() => render(<DojoScene arrival />, root));
    const a = art();
    expect(a.getAttribute('data-since')).toBe('lantern');
    const cap = root.querySelector('.dojo-scene__since')!;
    expect(cap.textContent).toBe(`${S.sinceYesterday} ${S.sinceLantern}`);
    expect(cap.getAttribute('data-since')).toBe('lantern');
    expect(cap.textContent).not.toMatch(/\d/); // no count on the arrival surface
    // the picture as seen is persisted (the page writes arrivedDay)
    expect(store.progress.value.sceneSeen).toEqual(now);
    expect(store.progress.value.arrivedDay).toBeUndefined();
    // flames land, then the pulse schedule
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(root.querySelector('.room__pulse')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900); // §7 A beat 1,700 against the mount at 900
    });
    const twin = a.querySelector<SVGUseElement>('.room__pulse');
    expect(twin).not.toBeNull();
    expect(twin?.getAttribute('href')).toBe(`#${PART_ID.lantern}`);
    expect(twin?.getAttribute('filter')).toBe('url(#dj-pulse)');
    expect(a.hasAttribute('data-pulsing')).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PULSE_MS + 20);
    });
    expect(a.querySelector('.room__pulse')).toBeNull();
    expect(a.hasAttribute('data-pulsing')).toBe(false);
    expect(a.querySelector('.room__ring')).toBeNull();
  });

  it('no arrival → no diff, no caption, nothing persisted; a first visit (no sceneSeen) pulses nothing', async () => {
    await makeTestStore({ save: { profile: { level: 20 } } });
    store.patch('progress', (p) => ({ ...p, sceneSeen: { ...seenNow(), level: 10 } }));
    const before = store.progress.value;
    act(() => render(<DojoScene />, root));
    expect(art().hasAttribute('data-since')).toBe(false);
    expect(root.querySelector('.dojo-scene__since')).toBeNull();
    expect(store.progress.value).toBe(before);
    render(null, root);
    resetStoreForTests();
    await makeTestStore({ save: { profile: { level: 20 } } });
    act(() => render(<DojoScene arrival />, root));
    expect(art().hasAttribute('data-since')).toBe(false);
    expect(sinceYesterday(undefined, seenNow())).toEqual([]);
    expect(store.progress.value.sceneSeen).toEqual(seenNow());
  });

  it('under reduced motion the changed parts carry the static 1 px gold ring (data-ring) for the visit, and no twin is ever scheduled', async () => {
    vi.useFakeTimers();
    await makeTestStore({ save: { profile: { level: 20 }, settings: { reducedMotion: true }, collections: { badges: { 'first-step': 20_400, tsuzuku: 20_401 } } } });
    store.patch('progress', (p) => ({ ...p, sceneSeen: { ...seenNow(), level: 10, badgeCategories: 0 } }));
    act(() => render(<DojoScene arrival />, root));
    const a = art();
    expect(a.getAttribute('data-since')).toBe('lantern mon');
    const rings = Array.from(a.querySelectorAll('.room__ring'));
    expect(rings.map((r) => r.getAttribute('data-ring'))).toEqual(['lantern', 'mon']);
    expect(rings[0]?.getAttribute('stroke-width')).toBe('1');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(a.querySelector('.room__pulse')).toBeNull();
    expect(a.querySelectorAll('.room__ring').length).toBe(2); // still there after the flames landed
    expect(a.innerHTML).not.toContain('ink-');
  });

  it('Monday: the Kage left the corner — drawn once more with the leaving class and named in the caption', async () => {
    await makeTestStore();
    store.patch('progress', (p) => ({ ...p, sceneSeen: { ...seenNow(), kageBeaten: true } }));
    act(() => render(<DojoScene arrival />, root));
    expect(art().getAttribute('data-since')).toBe('kage');
    expect(root.querySelector('.room__kage--leaving')).not.toBeNull();
    // reduced motion swaps the silhouette under --dur-fade: the .rm-fade opt-in keeps that one duration (base.css zeroes the rest)
    expect(root.querySelector('.room__kage--leaving')?.classList.contains('rm-fade')).toBe(true);
    expect(root.querySelector('.dojo-scene__since')?.textContent).toBe(`${S.sinceYesterday} ${S.kageLeft}`);
  });

  it('the arrival never names a gap (§7 A, §8): a hearth that cooled, a bonsai that was pruned, a stamp or kanji gone are never pulsed or captioned; only growth is', async () => {
    await makeTestStore({ save: { profile: { belt: 'green', level: 23 }, streak: { totalDays: 60, current: 0, lastDay: 0 }, progress: { station: 9 } } });
    const now = seenNow();
    // yesterday lit, today embers (one missed day) or cold (a longer break): nothing
    expect(sinceYesterday({ ...now, flame: 'lit' }, { ...now, flame: 'ember' })).toEqual([]);
    expect(sinceYesterday({ ...now, flame: 'lit' }, { ...now, flame: 'broken' })).toEqual([]);
    expect(sinceYesterday({ ...now, flame: 'gold' }, { ...now, flame: 'lit' })).toEqual([]);
    // the ladder: unlit < ember < steady < roaring — climbing pulses, with the calm sentence
    expect(HEARTH_RANK.unlit).toBeLessThan(HEARTH_RANK.ember);
    expect(HEARTH_RANK.ember).toBeLessThan(HEARTH_RANK.steady);
    expect(HEARTH_RANK.steady).toBeLessThan(HEARTH_RANK.roaring);
    expect(sinceYesterday({ ...now, flame: 'broken' }, { ...now, flame: 'lit' })).toEqual(['hearth']);
    expect(sinceYesterday({ ...now, flame: 'ember' }, { ...now, flame: 'gold' })).toEqual(['hearth']);
    expect(sinceCaption(['hearth'], { ...now, flame: 'ember' }, { ...now, flame: 'gold' })).toBe(`${S.sinceYesterday} ${S.hearthRoaring}`);
    // pruned while away: not a part of the arrival (the hotspot tip says it); healed → "the bonsai grew"
    expect(sinceYesterday({ ...now, pruned: false }, { ...now, pruned: true })).toEqual([]);
    expect(sinceYesterday({ ...now, pruned: true }, { ...now, pruned: false })).toEqual(['bonsai']);
    expect(sinceCaption(['bonsai'], { ...now, pruned: true }, { ...now, pruned: false })).toBe(`${S.sinceYesterday} ${S.sinceBonsai}`);
    expect(sinceCaption(['bonsai'], { ...now, totalDays: 10 }, { ...now, pruned: true })).not.toContain(S.bonsaiPruned);
    // a stamp or a kanji that is no longer there, a smaller shelf, a lower level: nothing
    expect(sinceYesterday({ ...now, latestStamp: '戸塚' }, { ...now, latestStamp: undefined })).toEqual([]);
    expect(sinceYesterday({ ...now, chosenKanji: '続' }, { ...now, chosenKanji: undefined })).toEqual([]);
    expect(sinceYesterday({ ...now, badgeCategories: 3 }, { ...now, badgeCategories: 1 })).toEqual([]);
    expect(sinceYesterday({ ...now, level: 40 }, { ...now, level: 20 })).toEqual([]);
    // rendered: yesterday lit, today cold → no caption, no data-since, no pulse twin ever
    vi.useFakeTimers();
    store.patch('progress', (p) => ({ ...p, sceneSeen: { ...now, flame: 'lit' } }));
    expect(now.flame).toBe('broken'); // current 0, lastDay 0
    act(() => render(<DojoScene arrival />, root));
    expect(art().hasAttribute('data-since')).toBe(false);
    expect(root.querySelector('.dojo-scene__since')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(root.querySelector('.room__pulse')).toBeNull();
    expect(root.querySelector('[data-hotspot="hearth"]')?.getAttribute('aria-label')).toContain(S.hearthUnlit); // the same calm sentence, on the tip
  });

  it('the node budget holds with every reduced-motion ring drawn on the richest save (arrival, every part grown)', async () => {
    const many: NonNullable<TestStoreOptions['cards']> = {};
    for (let i = 1; i <= 350; i++) {
      const id = `v-n5-${String(i).padStart(4, '0')}`;
      many[`${id}#rec`] = card({ s: 300, state: 2, due: 20_600 });
      many[`${id}#prod`] = card({ s: 200, state: 2, due: 20_600 });
    }
    const badges = { 'first-step': 20_400, seven: 20_401, gojuon: 20_402, 'belt-yellow': 20_403, tsuzuku: 20_404 };
    await makeTestStore({
      cards: many,
      now: Date.UTC(2026, 6, 15, 23, 0, 0),
      save: {
        profile: { belt: 'black', level: 99, dan: 3, chosenKanji: '道' },
        streak: { totalDays: 400, current: 400, lastDay: 20_468 },
        collections: { badges, stamps: { 53: { at: 20_500, perfect: true, assisted: false } } },
        settings: { reducedMotion: true },
        progress: { station: 53 },
      },
    });
    const now = seenNow();
    expect(now.kageBeaten).toBe(false); // the Kage sat last week: today it leaves (drawn once more, ringed)
    const seen: SceneSeen = { ...now, level: 1, totalDays: 1, blooming: false, pruned: true, latestStamp: undefined, badgeCategories: 0, flame: 'broken', belt: 'brown', dan: 0, chosenKanji: undefined, kageBeaten: true, station: 50 };
    expect(sinceYesterday(seen, now)).toEqual(['lantern', 'bonsai', 'stamp', 'mon', 'hearth', 'belt', 'scroll', 'kage', 'station']);
    store.patch('progress', (p) => ({ ...p, sceneSeen: seen }));
    act(() => render(<DojoScene arrival />, root));
    await settle();
    expect(root.querySelectorAll('.dj-kf').length).toBe(KOTODAMA_MAX.full);
    expect(root.querySelectorAll('.room__ring').length).toBe(8); // scroll and station share one box
    expect(root.querySelectorAll('.dojo-scene__art *').length).toBeLessThanOrEqual(SCENE_NODE_BUDGET);
  });

  it('the diff names every durable part in a fixed order and never counts days; the caption reads each from strings.ts', async () => {
    await makeTestStore({ save: { profile: { belt: 'green', level: 23, dan: 0 }, streak: { totalDays: 100, current: 5 }, progress: { station: 9 } } });
    const now = seenNow();
    const seen: SceneSeen = { ...now, level: 9, totalDays: 30, blooming: false, latestStamp: undefined, badgeCategories: 0, flame: 'broken', belt: 'yellow', chosenKanji: undefined, kageBeaten: true, station: 8 };
    const parts = sinceYesterday(seen, { ...now, latestStamp: '戸塚', badgeCategories: 2, flame: 'lit', chosenKanji: '続', kageBeaten: false });
    expect(parts).toEqual(['lantern', 'bonsai', 'stamp', 'mon', 'hearth', 'belt', 'scroll', 'kage', 'station']);
    const text = sinceCaption(parts, seen, { ...now, latestStamp: '戸塚', badgeCategories: 2, flame: 'lit', chosenKanji: '続', kageBeaten: false });
    expect(text.startsWith(S.sinceYesterday)).toBe(true);
    for (const s of [S.sinceLantern, S.bonsaiBlooming, S.sinceStamp, S.sinceMon, S.hearthSteady, S.sinceBelt, S.sinceScroll, S.kageLeft, S.sinceStation]) expect(text).toContain(s);
    expect(text).not.toMatch(/\d/);
    // same picture → nothing
    expect(sinceYesterday(now, now)).toEqual([]);
    // a level change inside the same ten does not move a lantern
    expect(sinceYesterday({ ...now, level: 21 }, now)).toEqual([]);
    // the persisted shape is exactly SceneSeen: no hour, no size, no crests
    expect(Object.keys(now).sort()).toEqual(['badgeCategories', 'belt', 'blooming', 'counts', 'dan', 'flame', 'kageBeaten', 'level', 'pruned', 'station', 'streak', 'totalDays']);
  });

  it('schedulePulses: one <use> twin per part through the shared def, staggered so at most two are live; cancel removes them', () => {
    vi.useFakeTimers();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const id of [PART_ID.lantern, PART_ID.bonsai, PART_ID.stamp]) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('id', id);
      svg.appendChild(g);
    }
    document.body.appendChild(svg);
    let done = 0;
    const cancel = schedulePulses(svg, ['lantern', 'bonsai', 'stamp', 'scroll', 'station'], { onDone: () => done++ });
    const live = (): number => svg.querySelectorAll('.room__pulse').length;
    vi.advanceTimersByTime(0);
    expect(live()).toBe(1);
    vi.advanceTimersByTime(PULSE_STAGGER_MS);
    expect(live()).toBe(2);
    vi.advanceTimersByTime(PULSE_STAGGER_MS);
    expect(live()).toBe(2); // the first ended as the third began
    vi.advanceTimersByTime(PULSE_STAGGER_MS);
    expect(live()).toBe(1); // scroll / station have no group in this svg: skipped
    expect(PULSE_STAGGER_MS * 2).toBe(PULSE_MS);
    vi.advanceTimersByTime(PULSE_MS * 3);
    expect(live()).toBe(0);
    expect(done).toBe(1);
    // cancel mid-flight
    const cancel2 = schedulePulses(svg, ['lantern', 'bonsai'], {});
    vi.advanceTimersByTime(PULSE_STAGGER_MS);
    expect(live()).toBe(2);
    cancel2();
    expect(live()).toBe(0);
    cancel();
    svg.remove();
    // nothing to pulse: done at once
    let d2 = 0;
    schedulePulses(null, ['lantern'], { onDone: () => d2++ });
    expect(d2).toBe(1);
  });

  it('syncLive writes the live state into an injected SVG and is harmless without one', () => {
    const host = document.createElement('div');
    host.innerHTML = buildScene({ ...sceneInputsFor(), level: 20 }, false).svg;
    syncLive(host, { phase: 'dusk', lit: true, hearth: 'roaring', crystal: true }, null);
    expect(host.querySelector('.room__sky--a')?.getAttribute('fill')).toBe(`url(#${skyId('dusk')})`);
    expect(host.querySelector('.room__sky--b')?.classList.contains('room__sky--fade')).toBe(false); // no previous phase
    expect(host.querySelector('.dj-hf')?.getAttribute('class')).toBe('dj-hf dj-hf--unlit dj-hf--roaring dj-hf--crystal'.replace(' dj-hf--unlit', ''));
    expect(host.querySelectorAll('.room__lantern--lit').length).toBe(2);
    syncLive(host, { phase: 'night', lit: true, hearth: 'ember', crystal: false }, 'dusk');
    expect(host.querySelector('.room__sky--b')?.getAttribute('fill')).toBe(`url(#${skyId('dusk')})`);
    expect(host.querySelector('.room__sky--b')?.classList.contains('room__sky--fade')).toBe(true);
    expect(host.querySelector('.dj-hf')?.getAttribute('class')).toBe('dj-hf dj-hf--ember');
    syncLive(null, { phase: 'day', lit: false, hearth: 'unlit', crystal: false }, null);
  });
});

/** Inputs for a pure build without a store render (the store is initialised by the surrounding test). */
function sceneInputsFor(): ReturnType<typeof sceneInputs> {
  return sceneInputs();
}

describe('helpers', () => {
  it('blackCounts counts items whose every facet is Black', async () => {
    await makeTestStore({ cards: BLACK_CARDS });
    expect(blackCounts(store.cards)).toEqual({ kana: 0, vocab: 2, kanji: 1, grammar: 0, component: 0, chunk: 0 });
  });

  it('badgeCategoryCount counts distinct categories of earned badges; crestsFor gives the earliest crest per category in shelf order', () => {
    expect(badgeCategoryCount({})).toBe(0);
    expect(badgeCategoryCount({ 'first-step': 1 })).toBe(1);
    expect(badgeCategoryCount({ 'first-step': 1, 'thousand-cuts': 2 })).toBe(1); // both training
    expect(badgeCategoryCount({ 'first-step': 1, tsuzuku: 2 })).toBe(2); // training + spirit
    expect(badgeCategoryCount({ 'first-step': 1, seven: 2, gojuon: 3, 'belt-yellow': 4 })).toBe(4);
    expect(crestsFor({})).toEqual([]);
    const crests = crestsFor({ 'thousand-cuts': 5, 'first-step': 9, seven: 2 });
    expect(crests.length).toBe(2);
    expect(crests.map((c) => c.glyph).join('').length).toBe(2);
    // streak comes before training in MON_CATEGORIES; the earliest of the two training badges is chosen
    expect(crests[0]).toMatchObject({ ring: expect.any(String), field: expect.any(String) });
    expect(crests.every((c) => ['bronze', 'silver', 'gold'].includes(c.ring))).toBe(true);
  });

  it('latestStampName picks the newest day, farther station on a tie', () => {
    expect(latestStampName({})).toBeUndefined();
    expect(latestStampName({ 1: { at: 10, perfect: false, assisted: false } })).toBe('品川');
    expect(latestStampName({ 1: { at: 10, perfect: false, assisted: false }, 2: { at: 9, perfect: false, assisted: false } })).toBe('品川');
    expect(latestStampName({ 3: { at: 10, perfect: false, assisted: false }, 2: { at: 10, perfect: false, assisted: false } })).toBe('神奈川');
  });

  it('hotspotsFor returns percent boxes inside the stage', async () => {
    await makeTestStore();
    const i = sceneInputs();
    const built = buildScene(i, false);
    for (const h of hotspotsFor(i, built)) {
      expect(h.left).toBeGreaterThanOrEqual(0);
      expect(h.top).toBeGreaterThanOrEqual(0);
      expect(h.left + h.width).toBeLessThanOrEqual(100.01);
      expect(h.top + h.height).toBeLessThanOrEqual(100.01);
    }
    expect(DEFAULT_TEST_NOW).toBe(Date.UTC(2026, 0, 15, 12, 0, 0));
  });
});
