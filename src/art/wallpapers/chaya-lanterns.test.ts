import { fnv1a32 } from '../../shared/hash';
import { HOURS_PER_LANTERN, MAX_LANTERNS, eavesSlots, lanternCount, listenHoursOf, placeLanterns, roadGeometry, spec, vergeAt } from './chaya-lanterns';
import { normalizeData, sampleData } from './data';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES, type WallpaperData } from './spec';

/** The fixture plus the design 08 §11 hours field (optional on `WallpaperData` until spec.ts carries it). */
const withHours = (hours: number, seed = 1): WallpaperData => normalizeData({ ...sampleData(seed), listenHours: hours });
const DATA = withHours(47);
const fp = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}

const lanternsIn = (svg: string): number => parse(svg).querySelectorAll('g.chochin').length;

describe('chaya-lanterns (design 08 §11)', () => {
  it('exports the spec under its catalog id as a living piece', () => {
    expect(spec.id).toBe('chaya-lanterns');
    expect(spec.living).toBe(true);
    expect(HOURS_PER_LANTERN).toBe(10);
  });

  for (const size of WALLPAPER_SIZES) {
    it(`${size}: deterministic, well-formed, self-contained, reasonable node count (snapshot)`, () => {
      const a = spec.compose(1, DATA, size);
      const b = spec.compose(1, DATA, size);
      expect(isComposition(a)).toBe(true);
      expect(a.svg).toBe(b.svg);
      expect(a.texts).toEqual(b.texts);
      expect(a.post).toBe('grain');
      expect(hasCanvasSize(a, size)).toBe(true);
      expect(isSelfContained(a.svg)).toBe(true);
      expect(usesReservedIds(a.svg)).toBe(false);
      expect(a.svg).not.toMatch(/NaN|Infinity|undefined/);
      const doc = parse(a.svg);
      expect(doc.querySelectorAll('*').length).toBeLessThan(4000);
      expect(doc.querySelector('svg > title')?.textContent).toBe('Teahouse Lanterns');
      expect(doc.querySelector('g.teahouse')).not.toBeNull();
      expect(fp(a.svg)).toMatchSnapshot();
      expect(a.texts).toMatchSnapshot();
    });
  }

  it('phone: every TextLayer stays inside the safe zones for several seeds and hour counts', () => {
    for (let seed = 1; seed <= 6; seed++) {
      for (const hours of [0, 47, 600]) {
        const c = spec.compose(seed, withHours(hours, seed), 'phone');
        expect(safeZoneViolations(c, 'phone').map((t) => `${t.text}@${t.x},${t.y}`), `seed ${seed} / ${hours} h`).toEqual([]);
      }
    }
    expect(spec.compose(1, DATA, 'phone').texts.length).toBeGreaterThanOrEqual(4);
  });

  it('personal text is carried by TextLayers only, never inside the SVG; the hours heard appear as a caption', () => {
    const c = spec.compose(1, DATA, 'desktop');
    expect(c.svg).not.toContain(DATA.nameKana);
    expect(c.texts.some((t) => t.text === DATA.nameKana)).toBe(true);
    expect(c.texts.some((t) => t.text.includes('47') && t.text.includes('時間'))).toBe(true);
    expect(c.texts.some((t) => t.text === '茶屋の灯' && t.vertical)).toBe(true);
    expect(c.texts.some((t) => t.text === '茶' && t.anchor === 'middle')).toBe(true);
  });

  it('different seeds give different pictures with the same lantern count', () => {
    const a = spec.compose(1, DATA, 'desktop');
    const b = spec.compose(2, DATA, 'desktop');
    expect(a.svg).not.toBe(b.svg);
    expect(lanternsIn(a.svg)).toBe(lanternsIn(b.svg));
  });

  it('hangs one chōchin per ten hours of listening: floor(hours / 10), none at zero, capped', () => {
    expect(lanternsIn(spec.compose(3, withHours(47), 'desktop').svg)).toBe(4);
    expect(lanternsIn(spec.compose(3, withHours(47), 'phone').svg)).toBe(4);
    expect(lanternsIn(spec.compose(3, withHours(9.99), 'desktop').svg)).toBe(0);
    expect(lanternsIn(spec.compose(3, withHours(0), 'desktop').svg)).toBe(0);
    expect(lanternsIn(spec.compose(3, withHours(250), 'desktop').svg)).toBe(25);
    expect(lanternsIn(spec.compose(3, withHours(100_000), 'desktop').svg)).toBe(MAX_LANTERNS);
    // the fixture carries no hours field yet: a lit room, no lantern
    expect(lanternsIn(spec.compose(3, sampleData(1), 'desktop').svg)).toBe(0);
    expect(lanternCount(0)).toBe(0);
    expect(lanternCount(10)).toBe(1);
    expect(lanternCount(599)).toBe(59);
    expect(lanternCount(600)).toBe(MAX_LANTERNS);
    expect(lanternCount(9_999)).toBe(MAX_LANTERNS);
    expect(lanternCount(-5)).toBe(0);
  });

  it('listenHoursOf reads the field defensively, and normalizeData carries it (the real data path: wallpaperData → normalizeData → compose)', () => {
    expect(sampleData(1).listenHours).toBe(0);
    expect(listenHoursOf(sampleData(1))).toBe(0);
    expect(listenHoursOf(withHours(12.5))).toBe(12.5);
    expect(normalizeData({ ...sampleData(1), listenHours: 47 }).listenHours).toBe(47);
    expect(normalizeData({}).listenHours).toBe(0);
    expect(normalizeData({ listenHours: -2 }).listenHours).toBe(0);
    expect(lanternsIn(spec.compose(3, normalizeData({ ...sampleData(1), listenHours: 47 }), 'desktop').svg)).toBe(4);
    expect(listenHoursOf({ ...sampleData(1), listenHours: Number.NaN } as WallpaperData)).toBe(0);
    expect(listenHoursOf({ ...sampleData(1), listenHours: -3 } as WallpaperData)).toBe(0);
    expect(listenHoursOf({ ...sampleData(1), listenHours: '40' } as unknown as WallpaperData)).toBe(0);
  });

  it('the roadside string grows into the distance: more hours, more rope lanterns, each smaller than the last', () => {
    const road = roadGeometry(7, 1920, 1080, 620, false);
    const xs = eavesSlots(1000, 1600, 1180, 1420, 4);
    // four either side of the doorway, nearest the door first, none inside it
    expect(xs).toHaveLength(8);
    expect(xs.slice(0, 2).map((x) => Math.round(x))).toEqual([1158, 1443]);
    for (const x of xs) expect(x < 1180 || x > 1420).toBe(true);
    for (let i = 1; i < xs.length; i++) expect(Math.abs(xs[i]! - 1300)).toBeGreaterThanOrEqual(Math.abs(xs[i - 1]! - 1300));
    const layout = { eaves: { xs, y: 500, s: 24 }, road, phone: false };
    const few = placeLanterns(7, 10, layout);
    expect(few.filter((l) => l.where === 'eaves')).toHaveLength(8);
    expect(few.filter((l) => l.where === 'road')).toHaveLength(2);
    const many = placeLanterns(7, MAX_LANTERNS, layout);
    const rope = many.filter((l) => l.where === 'road');
    expect(rope).toHaveLength(MAX_LANTERNS - 8);
    for (let i = 1; i < rope.length; i++) {
      expect(rope[i]!.t).toBeGreaterThan(rope[i - 1]!.t);
      expect(rope[i]!.s).toBeLessThan(rope[i - 1]!.s);
      expect(rope[i]!.y).toBeGreaterThan(500);
    }
    // the first eaves slots sit nearest the doorway (the middle of the hang line)
    const three = placeLanterns(7, 3, layout).map((l) => l.x);
    for (const x of three) expect(Math.abs(x - 1300)).toBeLessThan(200);
    expect(placeLanterns(7, 0, layout)).toEqual([]);
  });

  it('roadGeometry keeps the left verge left of the right one, narrows toward the horizon and stays on the canvas', () => {
    for (const [w, h, phone] of [
      [1920, 1080, false],
      [1080, 2340, true],
    ] as const) {
      const horizon = Math.round(h * 0.55);
      const road = roadGeometry(3, w, h, horizon, phone);
      expect(road.center).toHaveLength(29);
      for (let i = 0; i < road.center.length; i++) {
        expect(road.left[i]![0]).toBeLessThan(road.right[i]![0]);
        if (i > 0) expect(road.width[i]!).toBeLessThan(road.width[i - 1]!);
        expect(road.center[i]![1]).toBeGreaterThanOrEqual(horizon);
      }
      expect(road.width[road.width.length - 1]!).toBeLessThan(10);
      const [vx, vy] = vergeAt(road, 0.5, 20);
      expect(vx).toBeLessThan(road.left[14]![0]);
      expect(vy).toBeGreaterThan(horizon);
    }
  });

  it('degrades gracefully on empty data: both sizes compose without NaN and inside the safe zones', () => {
    const empty = normalizeData({});
    for (const size of WALLPAPER_SIZES) {
      const c = spec.compose(5, empty, size);
      expect(c.svg).not.toMatch(/NaN|Infinity|undefined/);
      parse(c.svg);
      expect(safeZoneViolations(c, size)).toEqual([]);
      expect(lanternsIn(c.svg)).toBe(0);
      expect(c.texts.some((t) => t.text === '無名')).toBe(true);
    }
  });

  it('the noren takes the belt colour', () => {
    expect(spec.compose(1, { ...DATA, belt: 'green' }, 'desktop').svg).toContain('fill="#3E9B4F"');
    expect(spec.compose(1, { ...DATA, belt: 'purple' }, 'desktop').svg).toContain('fill="#7A3FB5"');
  });
});
