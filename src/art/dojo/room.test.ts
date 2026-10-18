import { BELT_IDS, type Belt } from '../../content/types';
import { fnv1a32 } from '../../shared/hash';
import { SKY_STOPS as KOYOMI_SKY, moonPhase, seasonOf as koyomiSeasonOf, skyPhase as koyomiSkyPhase } from '../../shared/koyomi';
import { svgDoc } from '../svg';
import {
  ID,
  LANTERN_MAX,
  MON_SLOTS,
  OVERLAY_OPACITY,
  PART_ID,
  PHASES,
  SCENE_PARTS,
  SKY_STOPS,
  TATAMI_BY_BELT,
  lanternCount,
  lanternsLit,
  moonShadowPath,
  ornamentFor,
  partBox,
  roomLayout,
  roomSvg,
  seasonOf,
  skyId,
  skyPhase,
  tatamiCount,
  tok,
  type CrestSpec,
  type RoomOptions,
} from './room';

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}

/** 2026-01-15 as an EpochDay. */
const TODAY = 20_468;

const CRESTS: CrestSpec[] = [
  { ring: 'bronze', field: 'circle', glyph: 'あ' },
  { ring: 'silver', field: 'hexagon', glyph: '火', accent: '#C9302C' },
  { ring: 'gold', field: 'petal', glyph: '道' },
  { ring: 'bronze', field: 'square', glyph: '帯' },
];

const BASE: RoomOptions = {
  belt: 'green',
  level: 23,
  chosenKanji: '続',
  badgeCategories: 4,
  crests: CRESTS,
  latestStamp: '戸塚',
  kageBeaten: true,
  month: 4,
  today: TODAY,
  seed: 1234,
  w: 960,
  h: 540,
};

function doc(o: Partial<RoomOptions> = {}): Document {
  const r = roomSvg({ ...BASE, ...o });
  return parse(svgDoc({ w: r.layout.w, h: r.layout.h, defs: r.defs, body: r.layers }));
}

function count(d: Document, selector: string): number {
  return d.querySelectorAll(selector).length;
}

describe('tables', () => {
  it('tatami count by belt: 2 → 10, non-decreasing along the road', () => {
    expect(TATAMI_BY_BELT).toEqual({ white: 2, yellow: 3, orange: 4, green: 5, blue: 6, purple: 7, brown: 8, black: 10 });
    let prev = 0;
    for (const b of BELT_IDS) {
      const n = tatamiCount(b);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
    expect(tatamiCount('white')).toBe(2);
    expect(tatamiCount('black')).toBe(10);
  });

  it('renders exactly that many mats for every belt', () => {
    for (const belt of BELT_IDS) {
      const d = doc({ belt });
      expect(count(d, '.room__tatami')).toBe(TATAMI_BY_BELT[belt]);
      expect(d.querySelector('.room__mats')?.getAttribute('data-count')).toBe(String(TATAMI_BY_BELT[belt]));
      expect(d.querySelector(`.room__belt--${belt}`)).not.toBeNull();
    }
  });

  it('lanterns: one per 10 levels, capped; never lit by the string (the host flips the class)', () => {
    expect(lanternCount(1)).toBe(0);
    expect(lanternCount(9)).toBe(0);
    expect(lanternCount(10)).toBe(1);
    expect(lanternCount(35)).toBe(3);
    expect(lanternCount(99)).toBe(9);
    expect(lanternCount(1000)).toBe(LANTERN_MAX);
    expect(lanternCount(-5)).toBe(0);
    expect(lanternCount(Number.NaN)).toBe(0);
    expect(count(doc({ level: 1 }), '.room__lantern')).toBe(0);
    const d = doc({ level: 47 });
    expect(count(d, '.room__lantern')).toBe(4);
    expect(count(d, '.room__lantern-body')).toBe(4);
    expect(count(d, '.room__lantern--lit')).toBe(0);
    expect(d.querySelector('.room__lanterns')?.getAttribute('filter')).toBeNull();
    expect(d.querySelector('.room__lanterns')?.getAttribute('id')).toBe(PART_ID.lantern);
  });

  it('skyPhase / seasonOf / SKY_STOPS are the shared/koyomi bodies (re-exported, byte-identical)', () => {
    expect(skyPhase).toBe(koyomiSkyPhase);
    expect(seasonOf).toBe(koyomiSeasonOf);
    expect(SKY_STOPS).toBe(KOYOMI_SKY);
    expect(skyPhase(5)).toBe('dawn');
    expect(skyPhase(12)).toBe('day');
    expect(skyPhase(18)).toBe('dusk');
    expect(skyPhase(23)).toBe('night');
    expect(seasonOf(4)).toBe('spring');
    expect(seasonOf(1)).toBe('winter');
    expect(lanternsLit('night')).toBe(true);
    expect(lanternsLit('dusk')).toBe(true);
    expect(lanternsLit('day')).toBe(false);
    expect(OVERLAY_OPACITY.day).toBe(0);
    expect(OVERLAY_OPACITY.night).toBeGreaterThan(OVERLAY_OPACITY.dusk);
    expect(PHASES).toEqual(['dawn', 'day', 'dusk', 'night']);
  });

  it('tok() yields a themed custom property with the Dojo Morning fallback', () => {
    expect(tok('shu')).toBe('var(--shu, #C9302C)');
    expect(tok('fg-muted')).toBe('var(--fg-muted, #5E5A52)');
  });

  it('ornamentFor: tanzaku in July, koinobori in May, snow in winter, nothing otherwise', () => {
    expect(ornamentFor(7)).toBe('tanabata');
    expect(ornamentFor(5)).toBe('koinobori');
    expect(ornamentFor(12)).toBe('yuki');
    expect(ornamentFor(1)).toBe('yuki');
    expect(ornamentFor(2)).toBe('yuki');
    expect(ornamentFor(4)).toBeNull();
    expect(ornamentFor(10)).toBeNull();
    expect(ornamentFor(Number.NaN)).toBeNull();
    expect(ornamentFor(13)).toBe('yuki'); // wraps to January
  });
});

describe('the sky is live, not a string (design 09 §10 B1)', () => {
  it('four phase gradients in the defs, two sky rects, every phase element present whatever the hour', () => {
    const d = doc();
    for (const p of PHASES) expect(d.querySelector(`#${skyId(p)}`), p).not.toBeNull();
    expect(count(d, 'linearGradient')).toBe(4);
    expect(d.querySelector('.room__sky--a')).not.toBeNull();
    expect(d.querySelector('.room__sky--b')?.getAttribute('opacity')).toBe('0');
    expect(d.querySelector('.room__stars')).not.toBeNull();
    expect(count(d, '.room__stars circle')).toBe(7);
    expect(d.querySelector('.room__moon')).not.toBeNull();
    expect(d.querySelector('.room__sun--dawn')).not.toBeNull();
    expect(d.querySelector('.room__sun--dusk')).not.toBeNull();
    expect(d.querySelector('.room__cloud')).not.toBeNull();
    // the overlay is always the last layer, at opacity 0 until the wrapper's data-phase sets it
    const r = roomSvg(BASE);
    expect(r.overlayIndex).toBe(r.layers.length - 1);
    expect(r.layers[r.overlayIndex]).toContain('room__light');
    expect(d.querySelector('.room__light')?.getAttribute('opacity')).toBe('0');
    // the gradients carry the real sky colours
    expect(d.querySelector(`#${skyId('dawn')}`)?.innerHTML).toContain('#F7B2C4');
    expect(d.querySelector(`#${skyId('dusk')}`)?.innerHTML).toContain('#E0B341');
  });

  it('the moon in the window comes from moonPhase(today): ≤ 4 nodes, the dark part follows the fraction', () => {
    const d = doc();
    const moon = d.querySelector('.room__moon')!;
    expect(moon.getAttribute('data-moon')).toBe(moonPhase(TODAY).name);
    expect(moon.querySelectorAll('*').length).toBeLessThanOrEqual(3);
    // the string changes with the day (the moon moved)
    expect(roomSvg({ ...BASE, today: TODAY + 7 }).layers[1]).not.toBe(roomSvg(BASE).layers[1]);
    // new moon: both arcs are the full radius (a whole dark disc); full moon: the terminator lies on the far edge
    const full = moonShadowPath(0, 0, 10, 0.5);
    const nw = moonShadowPath(0, 0, 10, 0);
    expect(nw).toMatch(/A10 10 0 0 0 0 10A10 10 0 0 0 0 -10Z$/);
    expect(full).toMatch(/A10 10 0 0 1 0 10A10 10 0 0 0 0 -10Z$/);
    // a waxing crescent bulges toward the light on the right (sweep 0), a waning one toward the left (sweep 1)
    expect(moonShadowPath(0, 0, 10, 0.125)).toMatch(/A7\.07 10 0 0 0 0 -10Z$/);
    expect(moonShadowPath(0, 0, 10, 0.875)).toMatch(/A7\.07 10 0 0 1 0 -10Z$/);
    expect(moonShadowPath(0, 0, 10, 1.125)).toBe(moonShadowPath(0, 0, 10, 0.125));
  });

  it('the eaves ornament is drawn by month in ≤ 12 nodes and labelled by its data attribute', () => {
    for (const [month, id, max] of [
      [7, 'tanabata', 6],
      [5, 'koinobori', 8],
      [1, 'yuki', 4],
    ] as const) {
      const d = doc({ month });
      const o = d.querySelector('.room__ornament')!;
      expect(o, id).not.toBeNull();
      expect(o.getAttribute('data-ornament')).toBe(id);
      expect(o.querySelectorAll('*').length + 1).toBeLessThanOrEqual(max);
      expect(roomSvg({ ...BASE, month }).ornament).toBe(id);
    }
    expect(doc({ month: 10 }).querySelector('.room__ornament')).toBeNull();
    expect(roomSvg({ ...BASE, month: 10 }).ornament).toBeNull();
  });
});

describe('state → picture', () => {
  it('chosen kanji on the scroll; an ensō while none is chosen', () => {
    const withKanji = doc({ chosenKanji: '続' });
    expect(withKanji.querySelector('.room__kanji')).not.toBeNull();
    expect(withKanji.querySelector('.room__kanji text')?.textContent).toBe('続');
    expect(withKanji.querySelector('.room__kanji [lang="ja"]')).not.toBeNull();
    expect(withKanji.querySelector('.room__enso')).toBeNull();
    const empty = doc({ chosenKanji: undefined });
    expect(empty.querySelector('.room__enso')).not.toBeNull();
    expect(empty.querySelector('.room__kanji')).toBeNull();
    expect(empty.querySelector('.room__scroll')?.getAttribute('data-empty')).toBe('true');
    expect(empty.querySelector('.room__scroll')?.getAttribute('id')).toBe(PART_ID.scroll);
    const two = doc({ chosenKanji: '継続' });
    expect(count(two, '.room__kanji text')).toBe(2);
  });

  it('Mon shelf: earned slots carry the real crest as a <symbol> + <use>, the rest are empty, clamped to the slot count', () => {
    const d = doc({ badgeCategories: 4 });
    expect(count(d, '.room__mon--earned')).toBe(4);
    expect(count(d, 'use.room__mon--earned')).toBe(4);
    expect(count(d, `symbol[id^="${ID.mon}-"]`)).toBe(4);
    expect(d.querySelector(`#${ID.mon}-1 .room__crest--silver`)).not.toBeNull();
    expect(d.querySelector(`#${ID.mon}-1 .room__crest-glyph`)?.textContent).toBe('火');
    expect(d.querySelector(`#${ID.mon}-2 .room__crest--gold`)?.getAttribute('stroke')).toBe(tok('kin'));
    expect(count(d, '.room__mon--empty')).toBe(MON_SLOTS - 4);
    // more categories than crest specs: the extra slots fall back to a plain seal
    const seven = doc({ badgeCategories: 7 });
    expect(count(seven, '.room__mon--earned')).toBe(7);
    expect(count(seven, 'use.room__mon--earned')).toBe(4);
    expect(count(seven, 'circle.room__mon--earned')).toBe(3);
    const all = doc({ badgeCategories: 99 });
    expect(count(all, '.room__mon--earned')).toBe(MON_SLOTS);
    expect(count(all, '.room__mon--empty')).toBe(0);
    const none = doc({ badgeCategories: 0 });
    expect(count(none, '.room__mon--earned')).toBe(0);
    expect(count(none, 'symbol[id^="dj-mon-"]')).toBe(0);
    expect(none.querySelector('.room__shelf')?.getAttribute('data-earned')).toBe('0');
    expect(none.querySelector('.room__shelf')?.getAttribute('id')).toBe(PART_ID.mon);
  });

  it('stamp rack: the latest goshuin open on the shared seal-frame symbol, or a closed book', () => {
    const open = doc({ latestStamp: '保土ヶ谷' });
    expect(open.querySelector('.room__goshuin')).not.toBeNull();
    expect(open.querySelector(`symbol#${ID.goshuin} .room__goshuin-frame`)).not.toBeNull();
    expect(open.querySelector(`.room__goshuin use[href="#${ID.goshuin}"]`)).not.toBeNull();
    expect(count(open, '.room__goshuin text')).toBe(4);
    expect(open.querySelector('.room__stamps')?.getAttribute('data-empty')).toBeNull();
    const closed = doc({ latestStamp: undefined });
    expect(closed.querySelector('.room__goshuin')).toBeNull();
    expect(closed.querySelector(`#${ID.goshuin}`)).toBeNull();
    expect(closed.querySelector('.room__book--closed')).not.toBeNull();
    expect(closed.querySelector('.room__stamps')?.getAttribute('data-empty')).toBe('true');
    expect(closed.querySelector('.room__stamps')?.getAttribute('id')).toBe(PART_ID.stamp);
  });

  it('Kage sits in the corner only when beaten this week; on Monday it is drawn once more, leaving', () => {
    expect(doc({ kageBeaten: true }).querySelector('.room__kage')).not.toBeNull();
    expect(doc({ kageBeaten: true }).querySelector('.room__kage--leaving')).toBeNull();
    expect(doc({ kageBeaten: false }).querySelector('.room__kage')).toBeNull();
    const leaving = doc({ kageBeaten: false, kageLeaving: true });
    expect(leaving.querySelector('.room__kage--leaving')).not.toBeNull();
    expect(leaving.querySelector('.room__kage')?.getAttribute('data-leaving')).toBe('true');
    expect(leaving.querySelector('.room__kage')?.getAttribute('id')).toBe(PART_ID.kage);
    // beaten AND "leaving" is just beaten
    expect(doc({ kageBeaten: true, kageLeaving: true }).querySelector('.room__kage--leaving')).toBeNull();
  });

  it('black belt shows dan ticks in gold', () => {
    expect(count(doc({ belt: 'black', dan: 3 }), '.room__dan line')).toBe(3);
    expect(doc({ belt: 'black', dan: 0 }).querySelector('.room__dan')).toBeNull();
    expect(doc({ belt: 'brown', dan: 3 }).querySelector('.room__dan')).toBeNull();
    expect(doc().querySelector('.room__rack')?.getAttribute('id')).toBe(PART_ID.belt);
  });

  it('seasonal tree: foliage in three seasons, bare with snow in winter', () => {
    for (const [month, season] of [
      [4, 'spring'],
      [7, 'summer'],
      [10, 'autumn'],
    ] as const) {
      const d = doc({ month });
      expect(d.querySelector(`.room__tree--${season}`)).not.toBeNull();
      expect(count(d, '.room__tree ellipse')).toBeGreaterThanOrEqual(4);
    }
    const winter = doc({ month: 1 });
    expect(winter.querySelector('.room__tree--winter')).not.toBeNull();
    const snow = Array.from(winter.querySelectorAll('.room__tree ellipse'));
    expect(snow.length).toBeGreaterThan(0);
    for (const e of snow) expect(e.getAttribute('fill')).toBe('#F4EDE0');
  });

  it('reduced motion rings: one static 1 px gold rect per changed part, de-duplicated by box, named by data-ring', () => {
    const d = doc({ rings: ['lantern', 'bonsai', 'scroll', 'station'] });
    const rings = Array.from(d.querySelectorAll('.room__ring'));
    expect(rings.length).toBe(3); // scroll and station share the scroll's box
    expect(rings.map((r) => r.getAttribute('data-ring'))).toEqual(['lantern', 'bonsai', 'scroll']);
    for (const r of rings) {
      expect(r.getAttribute('stroke')).toBe(tok('kin'));
      expect(r.getAttribute('stroke-width')).toBe('1');
      expect(r.getAttribute('fill')).toBe('none');
    }
    expect(doc().querySelector('.room__ring')).toBeNull();
    const L = roomLayout(960, 540);
    for (const part of SCENE_PARTS) {
      const b = partBox(L, part);
      expect(b.w).toBeGreaterThan(0);
      expect(b.x + b.w).toBeLessThanOrEqual(960.01);
      expect(b.y + b.h).toBeLessThanOrEqual(540.01);
    }
  });
});

describe('composition', () => {
  it('is deterministic for a fixed state (hash snapshot) and varies with the seed; the hour is not an input', () => {
    const a = roomSvg(BASE);
    const b = roomSvg(BASE);
    const joined = a.defs.join('') + a.layers.join('');
    expect(joined).toBe(b.defs.join('') + b.layers.join(''));
    expect(fnv1a32(joined).toString(16)).toMatchInlineSnapshot(`"bf3caf06"`);
    const other = roomSvg({ ...BASE, seed: 99 });
    expect(other.defs.join('') + other.layers.join('')).not.toBe(joined);
    expect('hour' in BASE).toBe(false);
  });

  it('every layer is well-formed XML; the shared defs are there once (pulse + lantern glow = the two filters)', () => {
    const d = doc();
    expect(d.documentElement.tagName).toBe('svg');
    expect(d.querySelector('#dj-tatami')).not.toBeNull();
    expect(d.querySelector('#dj-lattice')).not.toBeNull();
    expect(d.querySelector('#dj-window-clip rect')).not.toBeNull();
    expect(d.querySelector(`filter#${ID.glow}`)).not.toBeNull();
    expect(d.querySelector(`filter#${ID.pulse}`)).not.toBeNull();
    expect(count(d, 'filter')).toBe(2);
    expect(d.querySelector('.room__window [clip-path="url(#dj-window-clip)"] .room__tree')).not.toBeNull();
    // nothing in the room references a filter by itself: the host attaches them (lit lanterns, pulse twins)
    expect(count(d, '[filter]')).toBe(0);
  });

  it('never prints NaN and uses themed tokens for interior surfaces', () => {
    const r = roomSvg({ ...BASE, month: Number.NaN, level: Number.NaN });
    const s = r.defs.join('') + r.layers.join('');
    expect(s).not.toContain('NaN');
    expect(s).toContain('var(--surface, #FFFBF3)');
    expect(s).toContain('var(--shu, #C9302C)');
  });

  it('layout scales proportionally and stays inside the canvas', () => {
    const L = roomLayout(960, 540);
    expect(L.sx).toBe(1);
    expect(L.sy).toBe(1);
    const half = roomLayout(480, 270);
    expect(half.scroll.x).toBeCloseTo(L.scroll.x / 2);
    expect(half.floorTop).toBeCloseTo(L.floorTop / 2);
    for (const box of [L.window, L.scroll, L.rack, L.shelf, L.stamps, L.hearth, L.kage, L.hall, L.ornament]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(960);
      expect(box.y + box.h).toBeLessThanOrEqual(540);
    }
    expect(L.bonsai.y).toBeLessThanOrEqual(540);
    // a compact stage keeps the same structure
    const compact = roomSvg({ ...BASE, w: 960, h: 400 });
    expect(compact.layout.h).toBe(400);
    expect(count(parse(svgDoc({ w: 960, h: 400, defs: compact.defs, body: compact.layers })), '.room__tatami')).toBe(TATAMI_BY_BELT[BASE.belt as Belt]);
  });

  it('keeps the node budget modest (room alone under 220 elements at the richest state, every phase element included)', () => {
    const rich = doc({ belt: 'black', level: 99, badgeCategories: 9, crests: [...CRESTS, ...CRESTS, ...CRESTS].slice(0, 9), kageBeaten: true, month: 7 });
    expect(count(rich, '*')).toBeLessThan(220);
  });
});
