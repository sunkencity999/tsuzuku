import { BADGE_IDS, type BadgeId } from '../../shared/catalog';
import { fnv1a32 } from '../../shared/hash';
import { BADGE_DEFS } from '../../store';
import { normalizeData, sampleData } from './data';
import type { Box } from '../geom';
import { layerBounds } from '../jtext';
import { gardenBoxes, layoutSeals, sealLook, spec } from './hanko-garden';
import { hasCanvasSize, isComposition, isSelfContained, safeZoneViolations, usesReservedIds, WALLPAPER_SIZES } from './spec';
import { S } from './strings-2';

const DATA = sampleData(1);
const fp = (svg: string): string => `${svg.length}:${fnv1a32(svg).toString(16)}`;

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}

const sealCount = (svg: string): number => parse(svg).querySelectorAll('g.seal').length;

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const sealBox = (p: { x: number; y: number; size: number }): Box => ({ x: p.x - p.size / 2, y: p.y - p.size / 2, w: p.size, h: p.size });
/** Bounding boxes of every stone part (body, highlight, ripple rings): the only ellipses in the piece. */
function stoneBoxes(svg: string): Box[] {
  const out: Box[] = [];
  for (const m of svg.matchAll(/<ellipse\b([^>]*)>/g)) {
    const n = (a: string): number => Number(new RegExp(`\\b${a}="([^"]+)"`).exec(m[1]!)?.[1]);
    out.push({ x: n('cx') - n('rx'), y: n('cy') - n('ry'), w: 2 * n('rx'), h: 2 * n('ry') });
  }
  return out;
}

describe('hanko-garden', () => {
  it('exports the spec under its catalog id and is a living piece', () => {
    expect(spec.id).toBe('hanko-garden');
    expect(spec.living).toBe(true);
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
      expect(doc.querySelector('filter#bleed')).not.toBeNull();
      expect(doc.querySelector('g.name-seal')).not.toBeNull();
      expect(fp(a.svg)).toMatchSnapshot();
    });
  }

  it('phone: every TextLayer stays inside the safe zones, even with all 68 badges', () => {
    expect(safeZoneViolations(spec.compose(1, DATA, 'phone'), 'phone')).toEqual([]);
    const all = spec.compose(2, sampleData(1, { badgesInOrder: [...BADGE_IDS] }), 'phone');
    expect(safeZoneViolations(all, 'phone')).toEqual([]);
    expect(sealCount(all.svg)).toBe(68);
    parse(all.svg);
    expect(all.svg.length).toBeLessThan(400_000);
  });

  it('karesansui stones and their ripple rings never sit on a seal, the name seal or any text, even with all 68 badges', () => {
    const all = sampleData(3, { badgesInOrder: [...BADGE_IDS] });
    for (const size of WALLPAPER_SIZES) {
      const { box, name } = gardenBoxes(size);
      for (let seed = 1; seed <= (size === 'desktop' ? 50 : 16); seed++) {
        const c = spec.compose(seed, all, size);
        const stones = stoneBoxes(c.svg);
        expect(stones.length).toBeGreaterThanOrEqual(10);
        const seals = layoutSeals(seed, all.badgesInOrder, box).map(sealBox);
        const texts = c.texts.map(layerBounds);
        for (const st of stones) {
          expect(overlaps(st, name), `${size} seed ${seed}: stone on the name seal`).toBe(false);
          expect(seals.some((b) => overlaps(st, b)), `${size} seed ${seed}: stone on a crest`).toBe(false);
          expect(texts.some((b) => overlaps(st, b)), `${size} seed ${seed}: stone on text`).toBe(false);
        }
      }
    }
  }, 20_000);

  it('the 判子の庭 title column stays on the rail right of the seal grid on both sizes', () => {
    const all = sampleData(3, { badgesInOrder: [...BADGE_IDS] });
    for (const size of WALLPAPER_SIZES) {
      const { box } = gardenBoxes(size);
      for (let seed = 1; seed <= 12; seed++) {
        const c = spec.compose(seed, all, size);
        const title = layerBounds(c.texts.find((t) => t.text === S.gardenTitle)!);
        expect(title.x).toBeGreaterThan(box.x + box.w);
        for (const p of layoutSeals(seed, all.badgesInOrder, box)) expect(overlaps(title, sealBox(p)), `${size} seed ${seed}`).toBe(false);
        expect(title.x + title.w).toBeLessThanOrEqual(size === 'phone' ? 1080 : 1920);
      }
    }
  });

  it('one seal per badge in unlock order, each with its crest glyph as a rotated brush TextLayer', () => {
    const c = spec.compose(1, DATA, 'desktop');
    expect(sealCount(c.svg)).toBe(DATA.badgesInOrder.length);
    const glyphs = DATA.badgesInOrder.map((id) => sealLook(id).glyph);
    const layers = c.texts.slice(0, glyphs.length);
    expect(layers.map((t) => t.text)).toEqual(glyphs);
    for (const t of layers) {
      expect(t.font.includes('Yuji Syuku')).toBe(true);
      expect(Math.abs(t.rotate!)).toBeLessThanOrEqual(8);
      expect(t.fill).toBe('#C9302C');
    }
    // reading order = unlock order: later seals are never above-left of earlier ones by a full row
    for (let i = 1; i < layers.length; i++) expect(layers[i]!.y).toBeGreaterThan(layers[i - 1]!.y - layers[i]!.size * 2.5);
    expect(c.svg).not.toContain(DATA.nameKana);
  });

  it('seal looks follow BADGE_DEFS: round for circle/petal fields, double frame above bronze, rays for gold', () => {
    const gold = BADGE_DEFS.find((d) => d.tier === 'gold')!;
    const bronze = BADGE_DEFS.find((d) => d.tier === 'bronze' && d.field === 'square')!;
    const petal = BADGE_DEFS.find((d) => d.field === 'petal')!;
    expect(sealLook(gold.id)).toEqual({ glyph: gold.glyph, round: gold.field === 'circle' || gold.field === 'petal', tier: 'gold' });
    expect(sealLook(bronze.id).round).toBe(false);
    expect(sealLook(petal.id).round).toBe(true);
    expect(sealLook('not-a-badge' as BadgeId)).toEqual({ glyph: '紋', round: true, tier: 'bronze' });
    const onlyGold = spec.compose(1, sampleData(1, { badgesInOrder: [gold.id] }), 'desktop');
    const seal = parse(onlyGold.svg).querySelector('g.seal')!;
    expect(seal.querySelectorAll('path').length).toBe(3);
    expect(seal.querySelector('path[fill="#B8860B"]')).not.toBeNull();
    const onlyBronze = spec.compose(1, sampleData(1, { badgesInOrder: [bronze.id] }), 'desktop');
    expect(parse(onlyBronze.svg).querySelector('g.seal')!.querySelectorAll('path').length).toBe(1);
  });

  it('layoutSeals fills the box in reading order with ±8° tilt and some partial impressions', () => {
    const ids = BADGE_IDS.slice(0, 30);
    const box = { x: 100, y: 100, w: 1600, h: 700 };
    const seals = layoutSeals(7, ids, box);
    expect(seals.length).toBe(30);
    for (const s of seals) {
      expect(s.x).toBeGreaterThan(box.x);
      expect(s.x).toBeLessThan(box.x + box.w);
      expect(s.y).toBeGreaterThan(box.y);
      expect(s.y).toBeLessThan(box.y + box.h);
      expect(Math.abs(s.rot)).toBeLessThanOrEqual(8);
      expect(s.size).toBeGreaterThan(60);
    }
    expect(seals.some((s) => s.partial)).toBe(true);
    expect(seals.some((s) => !s.partial)).toBe(true);
    expect(layoutSeals(7, [], box)).toEqual([]);
    expect(layoutSeals(7, ids, box)).not.toEqual(layoutSeals(8, ids, box));
  });

  it('name seal, crest count caption, date, title and belt sash; empty data degrades gracefully', () => {
    const c = spec.compose(1, sampleData(1, { belt: 'blue' }), 'desktop');
    const plain = c.texts.map((t) => t.text);
    expect(plain).toContain(DATA.nameKana);
    expect(plain).toContain(`${DATA.badgesInOrder.length}${S.crestsUnit}`);
    expect(plain).toContain(S.gardenTitle);
    expect(c.svg).toContain('#2F6FD6');
    const longName = spec.compose(1, sampleData(1, { nameKana: 'クリストファー・ブラッドフォード' }), 'phone');
    expect(longName.texts.filter((t) => t.vertical && t.fill === '#C9302C').length).toBeGreaterThanOrEqual(2);
    expect(safeZoneViolations(longName, 'phone')).toEqual([]);
    const empty = normalizeData({});
    for (const size of WALLPAPER_SIZES) {
      const e = spec.compose(5, empty, size);
      expect(e.svg).not.toMatch(/NaN|Infinity|undefined/);
      parse(e.svg);
      expect(safeZoneViolations(e, size)).toEqual([]);
      expect(sealCount(e.svg)).toBe(0);
      expect(e.texts.map((t) => t.text)).toContain(`0${S.crestsUnit}`);
    }
    expect(spec.compose(1, DATA, 'desktop').svg).not.toBe(spec.compose(2, DATA, 'desktop').svg);
  });
});
