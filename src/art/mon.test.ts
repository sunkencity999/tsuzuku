import { BADGE_IDS, BADGE_RING, type BadgeId } from '../shared/catalog';
import { fnv1a32 } from '../shared/hash';
import { BADGE_DEFS } from '../store';
import { BELT_HEX, INK, PALETTE, STONE, WASHI, normalizeHex } from './color';
import {
  CATEGORY_MOTIF,
  GOLD_RAYS,
  MON_CATEGORY,
  MON_FIELDS,
  MON_RINGS,
  MON_SPECS,
  MON_SPECS_COMPLETE,
  MON_VIEW,
  accentFor,
  badgeMonSvg,
  clampMonSize,
  monParts,
  monSeed,
  monSpec,
  monStoneDataUrl,
  monStoneImage,
  monSvg,
  type MonSpec,
} from './mon';

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
}

function hexes(svg: string): string[] {
  return Array.from(svg.matchAll(/#[0-9a-fA-F]{6}\b/g), (m) => m[0].toLowerCase());
}

const ACCENT_HEXES = new Set(
  [
    ...Object.values(PALETTE.light).map(normalizeHex),
    ...Object.values(PALETTE.dark).map(normalizeHex),
    ...Object.values(BELT_HEX).map(normalizeHex),
    normalizeHex(BADGE_RING.bronze),
    normalizeHex(BADGE_RING.silver),
  ].filter((h) => h !== normalizeHex(PALETTE.light.hai) && h !== normalizeHex(PALETTE.dark.hai) && h !== normalizeHex(WASHI) && h !== normalizeHex(INK) && h !== normalizeHex(PALETTE.dark.bg)),
);

describe('MON_SPECS catalog', () => {
  it('covers BADGE_IDS exactly, one glyph each', () => {
    expect(MON_SPECS_COMPLETE).toBe(true);
    expect(Object.keys(MON_SPECS).sort()).toEqual([...BADGE_IDS].sort());
    for (const id of BADGE_IDS) {
      const s = MON_SPECS[id];
      expect(Array.from(s.glyph).length).toBe(1);
      expect(MON_RINGS).toContain(s.ring);
      expect(MON_FIELDS).toContain(s.field);
      expect(s.accent).toMatch(/^#[0-9a-f]{6}$/);
      expect(s.motif).toBe(CATEGORY_MOTIF[MON_CATEGORY[id]]);
      expect(monSpec(id)).toBe(s);
    }
  });

  it('agrees with store/badge-defs on glyph, field and tier', () => {
    for (const d of BADGE_DEFS) {
      const s = MON_SPECS[d.id];
      expect(s.glyph, d.id).toBe(d.glyph);
      expect(s.field, d.id).toBe(d.field);
      expect(s.ring, d.id).toBe(d.tier);
      expect(MON_CATEGORY[d.id], d.id).toBe(d.category);
    }
  });

  it('belt crests take their belt colour; other categories their token', () => {
    expect(MON_SPECS['belt-yellow'].accent).toBe(normalizeHex(BELT_HEX.yellow));
    expect(MON_SPECS['belt-black'].accent).toBe(normalizeHex(BELT_HEX.black));
    expect(MON_SPECS.gojuon.accent).toBe(normalizeHex(PALETTE.light.sakura));
    expect(MON_SPECS.seven.accent).toBe(normalizeHex(PALETTE.light.shu));
    expect(MON_SPECS['hundred-kanji'].accent).toBe(normalizeHex(PALETTE.light.kin));
    expect(accentFor('road')).toBe(normalizeHex(PALETTE.light.kon));
    expect(accentFor('belt', 'green')).toBe(normalizeHex(BELT_HEX.green));
  });

  it('seeds are stable hashes of the id', () => {
    expect(monSeed('kyoto')).toBe(fnv1a32('kyoto'));
    expect(monSeed('kyoto')).toBe(monSeed('kyoto'));
    expect(monSeed('kyoto')).not.toBe(monSeed('zen'));
  });

  it('design 08 §11 rows: teahouse-regular is 常 on a bronze circle, first-hearing 初 on a silver circle, both input strand', () => {
    expect(MON_SPECS['teahouse-regular']).toMatchObject({ glyph: '常', ring: 'bronze', field: 'circle', motif: CATEGORY_MOTIF.input });
    expect(MON_SPECS['first-hearing']).toMatchObject({ glyph: '初', ring: 'silver', field: 'circle', motif: CATEGORY_MOTIF.input });
    expect(MON_CATEGORY['teahouse-regular']).toBe('input');
    expect(MON_CATEGORY['first-hearing']).toBe('input');
  });
});

describe('monSvg', () => {
  const earnedAll = new Map<BadgeId, string>();
  const lockedAll = new Map<BadgeId, string>();
  beforeAll(() => {
    for (const id of BADGE_IDS) {
      earnedAll.set(id, badgeMonSvg(id, { size: 128, earned: true }));
      lockedAll.set(id, badgeMonSvg(id, { size: 128, earned: false }));
    }
  });

  it('renders all 68 crests, well-formed, earned and locked', () => {
    for (const id of BADGE_IDS) {
      const doc = parse(earnedAll.get(id)!);
      const root = doc.documentElement;
      expect(root.tagName).toBe('svg');
      expect(root.getAttribute('viewBox')).toBe(`0 0 ${MON_VIEW} ${MON_VIEW}`);
      expect(root.getAttribute('width')).toBe('128');
      expect(doc.querySelector('.mon__glyph')?.textContent).toBe(MON_SPECS[id].glyph);
      expect(doc.querySelector('.mon__glyph')?.getAttribute('lang')).toBe('ja');
      parse(lockedAll.get(id)!);
    }
  });

  it('68 crests are pairwise different (hash of the SVG), earned and locked', () => {
    const seen = new Map<number, BadgeId>();
    for (const [id, svg] of earnedAll) {
      const h = fnv1a32(svg);
      expect(seen.has(h), `${id} collides with ${seen.get(h)}`).toBe(false);
      seen.set(h, id);
    }
    const seenLocked = new Map<number, BadgeId>();
    for (const [id, svg] of lockedAll) {
      const h = fnv1a32(svg);
      expect(seenLocked.has(h), `${id} (locked) collides with ${seenLocked.get(h)}`).toBe(false);
      seenLocked.set(h, id);
    }
  });

  it('is deterministic for the same input and changes with the seed', () => {
    const a = monSvg(MON_SPECS.kyoto, { size: 96, earned: true, seed: 7 });
    const b = monSvg(MON_SPECS.kyoto, { size: 96, earned: true, seed: 7 });
    const c = monSvg(MON_SPECS.kyoto, { size: 96, earned: true, seed: 8 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('is self-contained: no external references, scripts or images', () => {
    for (const svg of [...earnedAll.values(), ...lockedAll.values()]) {
      expect(svg).not.toMatch(/<image\b|<script\b|<foreignObject\b/i);
      expect(svg).not.toMatch(/href="(?!#)/i);
      expect(svg).not.toMatch(/url\((?!#)/i);
    }
  });

  it('unearned crests carry no accent or ring colour: grey stone only', () => {
    for (const id of BADGE_IDS) {
      const svg = lockedAll.get(id)!;
      const accent = MON_SPECS[id].accent!.toLowerCase();
      expect(svg.toLowerCase()).not.toContain(accent);
      for (const h of hexes(svg)) expect(ACCENT_HEXES.has(h), `${id}: ${h}`).toBe(false);
      expect(svg.toLowerCase()).toContain(STONE.toLowerCase());
      expect(svg).toContain('mon__art--locked');
      expect(svg).toMatch(/filter="url\(#[^"]*emboss\)"/);
      expect(svg).toContain('feSpecularLighting');
    }
  });

  it('earned crests carry the accent and the ring colour of their tier', () => {
    for (const id of BADGE_IDS) {
      const svg = earnedAll.get(id)!.toLowerCase();
      const s = MON_SPECS[id];
      expect(svg).toContain(s.accent!.toLowerCase());
      const ring = s.ring === 'gold' ? PALETTE.light.kin : BADGE_RING[s.ring];
      expect(svg).toContain(ring.toLowerCase());
      expect(svg).not.toContain('feSpecularLighting'.toLowerCase());
    }
  });

  it('ring structure by tier: bronze single, silver double, gold double + 16 rays', () => {
    const bronze = parse(badgeMonSvg('first-step', { size: 96, earned: true }));
    const silver = parse(badgeMonSvg('thirty', { size: 96, earned: true }));
    const gold = parse(badgeMonSvg('kyoto', { size: 96, earned: true }));
    expect(bronze.querySelectorAll('.mon__ring').length).toBe(1);
    expect(bronze.querySelector('.mon__rays')).toBeNull();
    expect(silver.querySelectorAll('.mon__ring').length).toBe(2);
    expect(silver.querySelector('.mon__rays')).toBeNull();
    expect(gold.querySelectorAll('.mon__ring').length).toBe(2);
    const rays = gold.querySelector('.mon__rays');
    expect(rays?.getAttribute('data-rays')).toBe(String(GOLD_RAYS));
    // one closed triangle per ray
    expect((rays?.getAttribute('d') ?? '').split('Z').length - 1).toBe(GOLD_RAYS);
  });

  it('fields: tomoe gets swirls, every other field a clipped strand motif', () => {
    const tomoe = parse(badgeMonSvg('tsuzuku', { size: 96, earned: true }));
    expect(tomoe.querySelector('.mon__tomoe')).not.toBeNull();
    expect(tomoe.querySelector('.mon__motif')).toBeNull();
    for (const [id, motif] of [
      ['gojuon', 'brush'],
      ['seven', 'flame'],
      ['thousand-cuts', 'cuts'],
      ['perfect-gate', 'gate'],
      ['belt-green', 'knot'],
      ['golden-ear', 'waves'],
      ['voice', 'wind'],
      ['hundred-kanji', 'parts'],
      ['zen', 'enso'],
    ] as const) {
      const doc = parse(badgeMonSvg(id, { size: 96, earned: true }));
      const m = doc.querySelector('.mon__motif');
      expect(m?.classList.contains(`mon__motif--${motif}`), id).toBe(true);
      expect(m?.getAttribute('clip-path')).toMatch(/^url\(#.*-clip\)$/);
      expect(doc.querySelector(`.mon__field--${MON_SPECS[id].field}`)).not.toBeNull();
    }
  });

  it('size is honoured and clamped (48–256 pass through)', () => {
    expect(parse(badgeMonSvg('ippon', { size: 48, earned: true })).documentElement.getAttribute('height')).toBe('48');
    expect(parse(badgeMonSvg('ippon', { size: 256, earned: true })).documentElement.getAttribute('height')).toBe('256');
    expect(clampMonSize(4)).toBe(16);
    expect(clampMonSize(5000)).toBe(1024);
    expect(clampMonSize(Number.NaN)).toBe(96);
    expect(parse(badgeMonSvg('ippon', { size: 4, earned: true })).documentElement.getAttribute('width')).toBe('16');
  });

  it('is aria-hidden by default and labelled with <title> when asked', () => {
    const plain = parse(badgeMonSvg('ippon', { size: 64, earned: true }));
    expect(plain.documentElement.getAttribute('aria-hidden')).toBe('true');
    expect(plain.querySelector('title')).toBeNull();
    const labelled = parse(badgeMonSvg('ippon', { size: 64, earned: true, label: 'Ippon 一本' }));
    expect(labelled.documentElement.getAttribute('role')).toBe('img');
    expect(labelled.documentElement.getAttribute('aria-hidden')).toBeNull();
    expect(labelled.querySelector('title')?.textContent).toBe('Ippon 一本');
  });

  it('cssVars writes theme tokens as inline var() styles with hex fallbacks, never in fill attributes', () => {
    const svg = badgeMonSvg('kyoto', { size: 96, earned: true, cssVars: true });
    expect(svg).toContain(`style="fill:var(--kin, ${PALETTE.light.kin.toLowerCase()})"`);
    expect(svg).toContain('var(--kon,');
    expect(svg).not.toMatch(/fill="var\(/);
    expect(svg).not.toMatch(/stroke="var\(/);
    const belt = badgeMonSvg('belt-blue', { size: 96, earned: true, cssVars: true });
    expect(belt).toContain('var(--belt-blue,');
    // locked crests never depend on the theme
    const locked = badgeMonSvg('kyoto', { size: 96, earned: false, cssVars: true });
    expect(locked).not.toContain('var(');
    parse(svg);
  });

  it('theme dark resolves token hexes to the Arcade Night palette', () => {
    const dark = badgeMonSvg('kyoto', { size: 96, earned: true, theme: 'dark' }).toLowerCase();
    expect(dark).toContain(PALETTE.dark.kin.toLowerCase());
    expect(dark).toContain(PALETTE.dark.kon.toLowerCase());
    expect(dark).not.toContain(PALETTE.light.kin.toLowerCase());
  });

  it('monStoneDataUrl is the locked crest as a data URL of the very same markup (design 09 §7 E: one rasterised emboss, no live filter)', () => {
    const url = monStoneDataUrl(MON_SPECS.kyoto, { size: 72, seed: monSeed('kyoto') });
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    const svg = decodeURIComponent(url.slice(url.indexOf(',') + 1));
    expect(svg).toBe(monSvg(MON_SPECS.kyoto, { size: 72, earned: false, seed: monSeed('kyoto') }));
    expect(svg).toContain('feSpecularLighting');
    expect(svg).not.toContain('var(');
    parse(svg);
    expect(monStoneDataUrl(MON_SPECS.kyoto, { size: 72, seed: monSeed('kyoto'), idPrefix: 'grid' })).toContain('grid-emboss');
  });

  it('monStoneImage leaves the glyph out of the data URL and hands it back as a brush TextLayer for an inline overlay (webfonts never resolve inside an image)', () => {
    const img = monStoneImage(MON_SPECS.kyoto, { size: 72, seed: monSeed('kyoto') });
    expect(img.url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    const svg = decodeURIComponent(img.url.slice(img.url.indexOf(',') + 1));
    expect(svg).toBe(monSvg(MON_SPECS.kyoto, { size: 72, earned: false, seed: monSeed('kyoto'), glyphInSvg: false }));
    expect(svg).not.toContain('<text');
    expect(svg).toContain('feSpecularLighting');
    expect(svg).toContain('mon__art--locked');
    parse(svg);
    expect(img.view).toBe(MON_VIEW);
    expect(img.glyph.text).toBe(MON_SPECS.kyoto.glyph);
    expect(img.glyph.font).toContain('Yuji Syuku');
    expect(img.glyph.anchor).toBe('middle');
    expect(img.glyph.fill).toMatch(/^#[0-9a-f]{6}$/i);
    // the glyph layer is the very one monParts offers; the default output is untouched
    const parts = monParts(MON_SPECS.kyoto, { size: 72, earned: false, seed: monSeed('kyoto') });
    expect(img.glyph).toEqual(parts.glyphLayer);
    expect(monSvg(MON_SPECS.kyoto, { size: 72, earned: false, seed: monSeed('kyoto') })).toContain('<text');
  });

  it('defs ids are namespaced per seed so several crests can share a page', () => {
    const a = badgeMonSvg('kyoto', { size: 96, earned: true });
    const b = badgeMonSvg('zen', { size: 96, earned: true });
    const idsA = Array.from(a.matchAll(/ id="([^"]+)"/g), (m) => m[1]);
    const idsB = Array.from(b.matchAll(/ id="([^"]+)"/g), (m) => m[1]);
    expect(idsA.length).toBeGreaterThan(0);
    for (const id of idsA) expect(idsB).not.toContain(id);
    const custom = badgeMonSvg('kyoto', { size: 96, earned: false, idPrefix: 'shelf-3' });
    expect(custom).toContain('id="shelf-3-clip"');
    expect(custom).toContain('id="shelf-3-emboss"');
  });

  it('a spec without an accent tints the ring colour', () => {
    const spec: MonSpec = { ring: 'bronze', field: 'circle', glyph: '試' };
    const svg = monSvg(spec, { size: 96, earned: true, seed: 1 });
    parse(svg);
    expect(svg).toContain(BADGE_RING.bronze.toLowerCase());
    expect(svg).toContain('mon__motif--enso');
  });
});

describe('monParts', () => {
  it('exposes the glyph as a centred canvas layer in 0–256 space with a hex fill', () => {
    const p = monParts(MON_SPECS.kyoto, { size: 96, earned: true, seed: monSeed('kyoto') });
    expect(p.view).toBe(MON_VIEW);
    expect(p.glyphLayer.text).toBe('京');
    expect(p.glyphLayer.x).toBe(MON_VIEW / 2);
    expect(p.glyphLayer.anchor).toBe('middle');
    expect(p.glyphLayer.lang).toBe('ja');
    expect(p.glyphLayer.fill).toMatch(/^#[0-9a-f]{6}$/);
    expect(p.glyphLayer.size).toBeGreaterThan(40);
    expect(p.glyphLayer.y).toBeGreaterThan(MON_VIEW / 2);
    // tomoe fields: the glyph is at least 66 units (≈ 18.5 px in the 72 px
    // Collections grid) and its ≈ 0.9 em ink box stays inside the r = 38 void
    // between the tomoe heads
    for (const id of ['tsuzuku', 'kyoto', 'hundred', 'gojuon-perfect'] as const) {
      const g = monParts(MON_SPECS[id], { size: 72, earned: true, seed: monSeed(id) }).glyphLayer;
      expect(g.size, id).toBeGreaterThanOrEqual(66);
      expect((g.size * 0.9) / 2, id).toBeLessThan(38);
    }
    expect(p.defs.length).toBeGreaterThan(0);
    expect(p.body.join('')).toContain('mon__glyph');
    // the glyph colour is readable on the field
    const locked = monParts(MON_SPECS.kyoto, { size: 96, earned: false, seed: 1 });
    expect(locked.defs.join('')).toContain('feSpecularLighting');
  });

  it('matches what monSvg embeds', () => {
    const o = { size: 128, earned: true, seed: 42 };
    const parts = monParts(MON_SPECS.zen, o);
    const svg = monSvg(MON_SPECS.zen, o);
    for (const d of parts.defs) expect(svg).toContain(d);
    for (const b of parts.body) expect(svg).toContain(b);
  });
});

describe('snapshots per ring × field', () => {
  for (const ring of MON_RINGS) {
    for (const field of MON_FIELDS) {
      it(`${ring} ${field}`, () => {
        const spec: MonSpec = { ring, field, glyph: '紋', accent: PALETTE.light.shu, motif: 'enso' };
        const svg = monSvg(spec, { size: 96, earned: true, seed: 1 });
        parse(svg);
        expect(svg).toMatchSnapshot();
      });
    }
  }
  it('locked stone', () => {
    const svg = monSvg({ ring: 'gold', field: 'tomoe', glyph: '紋', accent: PALETTE.light.shu }, { size: 96, earned: false, seed: 1 });
    parse(svg);
    expect(svg).toMatchSnapshot();
  });
});
