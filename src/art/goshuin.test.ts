import { BELTS, STATIONS, type StationDef } from '../content/types';
import { fnv1a32 } from '../shared/hash';
import { civilToDay, formatEraDate } from '../shared/time';
import { PALETTE, WASHI } from './color';
import {
  BELT_MOTIF,
  BOOK_PAGES,
  GOSHUIN_VIEW,
  PAGE,
  PHONE_SET,
  bookStrip,
  bookStripImages,
  clampGoshuinSize,
  eraDateKanji,
  goshuinDataUrl,
  goshuinImage,
  goshuinLabel,
  goshuinParts,
  goshuinSvg,
  kanjiNumber,
  motifPattern,
  nameColumns,
  stationByNumber,
  stationOrdinal,
  type BookStamp,
} from './goshuin';
import { safeRect } from './svg';

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
}
function selfContained(svg: string): void {
  expect(svg).not.toMatch(/<image\b|<script\b|<foreignObject\b/i);
  expect(svg).not.toMatch(/href="(?!#)/i);
  expect(svg).not.toMatch(/url\((?!#)/i);
}

const DAY = civilToDay({ year: 2026, month: 10, day: 17 });
const ST7 = STATIONS[6]!;
const base = (station: StationDef, extra: Partial<Parameters<typeof goshuinSvg>[0]> = {}) =>
  goshuinSvg({ station, at: DAY, perfect: false, assisted: false, seed: 1, size: 320, ...extra });

describe('kanji numerals and dates', () => {
  it('kanjiNumber', () => {
    expect(kanjiNumber(0)).toBe('〇');
    expect(kanjiNumber(1)).toBe('一');
    expect(kanjiNumber(7)).toBe('七');
    expect(kanjiNumber(10)).toBe('十');
    expect(kanjiNumber(13)).toBe('十三');
    expect(kanjiNumber(20)).toBe('二十');
    expect(kanjiNumber(27)).toBe('二十七');
    expect(kanjiNumber(53)).toBe('五十三');
    expect(kanjiNumber(100)).toBe('百');
    expect(kanjiNumber(365)).toBe('三百六十五');
    expect(kanjiNumber(2026)).toBe('二千二十六');
    expect(kanjiNumber(1920)).toBe('千九百二十');
    expect(kanjiNumber(7.9)).toBe('七');
    expect(kanjiNumber(Number.NaN)).toBe('〇');
  });

  it('eraDateKanji follows formatEraDate with kanji numerals; 元年 kept', () => {
    expect(eraDateKanji(DAY)).toBe('令和八年十月十七日');
    expect(formatEraDate(DAY)).toBe('令和8年10月17日');
    expect(eraDateKanji(civilToDay({ year: 2019, month: 5, day: 1 }))).toBe('令和元年五月一日');
    expect(eraDateKanji(civilToDay({ year: 2020, month: 1, day: 10 }))).toBe('令和二年一月十日');
    expect(eraDateKanji(civilToDay({ year: 2024, month: 11, day: 20 }))).toBe('令和六年十一月二十日');
    expect(eraDateKanji(civilToDay({ year: 1995, month: 3, day: 3 }))).toBe('平成七年三月三日');
  });

  it('stationOrdinal and nameColumns', () => {
    expect(stationOrdinal(7)).toBe('第七宿');
    expect(stationOrdinal(53)).toBe('第五十三宿');
    expect(nameColumns('原')).toBe(1);
    expect(nameColumns('平塚')).toBe(1);
    expect(nameColumns('神奈川')).toBe(1);
    expect(nameColumns('保土ヶ谷')).toBe(2);
    expect(nameColumns('池鯉鮒')).toBe(1);
    expect(nameColumns('一二三四五六')).toBe(3);
    expect(stationByNumber(7)).toBe(ST7);
    expect(stationByNumber(0)).toBeUndefined();
    expect(stationByNumber(54)).toBeUndefined();
  });
});

describe('motifPattern', () => {
  it('returns a userSpaceOnUse <pattern> in the colour for each kind', () => {
    for (const kind of ['seigaiha', 'asanoha', 'kikko'] as const) {
      const p = motifPattern('m', kind, '#c9302c');
      expect(p.startsWith('<pattern id="m"')).toBe(true);
      expect(p).toContain('patternUnits="userSpaceOnUse"');
      expect(p).toContain(`goshuin-motif--${kind}`);
      expect(p).toContain('#c9302c');
      parse(`<svg xmlns="http://www.w3.org/2000/svg"><defs>${p}</defs></svg>`);
    }
  });

  it('seigaiha tile: 2R × R, four fans drawn top to bottom with the paper fill', () => {
    const doc = parse(`<svg xmlns="http://www.w3.org/2000/svg"><defs>${motifPattern('m', 'seigaiha', '#c9302c', { cell: 20, paper: '#f4ede0' })}</defs></svg>`);
    const pat = doc.querySelector('pattern')!;
    expect(pat.getAttribute('width')).toBe('40');
    expect(pat.getAttribute('height')).toBe('20');
    const fans = Array.from(pat.querySelectorAll('path.goshuin-motif__fan'));
    expect(fans.length).toBe(4);
    for (const f of fans) expect(f.getAttribute('fill')).toBe('#f4ede0');
    const ys = fans.map((f) => Number(/M-?[\d.]+ ([\d.]+)/.exec(f.getAttribute('d') ?? '')?.[1]));
    expect(ys).toEqual([10, 20, 20, 30]);
  });

  it('lattices are hexagonal tiles (√3 r × 3 r)', () => {
    const doc = parse(`<svg xmlns="http://www.w3.org/2000/svg"><defs>${motifPattern('m', 'kikko', '#000', { cell: 20 })}</defs></svg>`);
    const pat = doc.querySelector('pattern')!;
    expect(Number(pat.getAttribute('width'))).toBeCloseTo(Math.sqrt(3) * 10, 1);
    expect(pat.getAttribute('height')).toBe('30');
    expect(pat.querySelector('path')?.getAttribute('fill')).toBe('none');
  });
});

describe('goshuinSvg', () => {
  it('snapshot for station 7 seed 1', () => {
    const svg = base(ST7);
    parse(svg);
    expect(svg).toMatchSnapshot();
  });

  it('renders every one of the 53 stations: well-formed, self-contained, carrying name, ordinal, 奉拝 and the date', () => {
    const seen = new Map<number, number>();
    for (const st of STATIONS) {
      const svg = base(st, { seed: 100 + st.number });
      const doc = parse(svg);
      selfContained(svg);
      expect(doc.documentElement.getAttribute('viewBox')).toBe(`0 0 ${GOSHUIN_VIEW} ${GOSHUIN_VIEW}`);
      const glyphs = Array.from(doc.querySelectorAll('.goshuin__text text')).map((t) => t.textContent ?? '');
      for (const ch of Array.from(st.nameJa)) expect(glyphs, st.nameJa).toContain(ch);
      expect(glyphs).toContain(stationOrdinal(st.number));
      const sumi = Array.from(doc.querySelectorAll('.goshuin__sumi-text text')).map((t) => t.textContent ?? '').join('');
      expect(sumi).toContain('奉拝');
      expect(sumi).toContain('令和八年十月十七日');
      expect(doc.querySelector('.goshuin__band')?.classList.contains(`goshuin__band--${BELT_MOTIF[st.belt]}`)).toBe(true);
      expect(doc.querySelector(`pattern.goshuin-motif--${BELT_MOTIF[st.belt]}`)).not.toBeNull();
      const h = fnv1a32(svg);
      expect(seen.has(h), `station ${st.number} collides with ${seen.get(h)}`).toBe(false);
      seen.set(h, st.number);
    }
  });

  it('is deterministic for the same input and changes with the seed', () => {
    expect(base(ST7)).toBe(base(ST7));
    expect(base(ST7)).not.toBe(base(ST7, { seed: 2 }));
    expect(base(ST7)).not.toBe(base(ST7, { at: DAY + 1 }));
  });

  it('perfect adds a gold frame; plain stamps have none', () => {
    const gold = base(ST7, { perfect: true });
    expect(gold.toLowerCase()).toContain(PALETTE.light.kin.toLowerCase());
    const doc = parse(gold);
    expect(doc.querySelector('.goshuin__gold')).not.toBeNull();
    expect(doc.documentElement.classList.contains('goshuin-svg--perfect')).toBe(true);
    const plain = parse(base(ST7));
    expect(plain.querySelector('.goshuin__gold')).toBeNull();
    expect(base(ST7).toLowerCase()).not.toContain(PALETTE.light.kin.toLowerCase());
  });

  it('assisted adds a grey corner; plain stamps have none', () => {
    const svg = base(ST7, { assisted: true });
    const doc = parse(svg);
    expect(doc.querySelector('.goshuin__corner')).not.toBeNull();
    expect(svg.toLowerCase()).toContain(PALETTE.light.hai.toLowerCase());
    expect(doc.documentElement.classList.contains('goshuin-svg--assisted')).toBe(true);
    expect(parse(base(ST7)).querySelector('.goshuin__corner')).toBeNull();
  });

  it('motif by belt table', () => {
    expect(BELT_MOTIF).toEqual({
      white: 'seigaiha',
      yellow: 'seigaiha',
      orange: 'seigaiha',
      green: 'asanoha',
      blue: 'asanoha',
      purple: 'asanoha',
      brown: 'kikko',
      black: 'kikko',
    });
    for (const b of BELTS) {
      const st = STATIONS.find((s) => s.belt === b.id)!;
      expect(goshuinParts({ station: st, at: DAY, perfect: false, assisted: false, seed: 1, size: 320 }).motif).toBe(BELT_MOTIF[b.id]);
    }
  });

  it('the seal is pressed: tilted, masked by seeded noise, ink-bled; square or round by seed', () => {
    const doc = parse(base(ST7));
    const seal = doc.querySelector('.goshuin__seal')!;
    expect(seal.getAttribute('transform')).toMatch(/rotate\(-?[\d.]+ 160 160\)/);
    expect(seal.getAttribute('mask')).toMatch(/^url\(#.*pressmask\)$/);
    expect(seal.getAttribute('filter')).toMatch(/^url\(#.*bleed\)$/);
    expect(doc.querySelector('feTurbulence')).not.toBeNull();
    const shapes = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) shapes.add(goshuinParts({ station: ST7, at: DAY, perfect: false, assisted: false, seed, size: 320 }).round ? 'round' : 'square');
    expect(shapes.size).toBe(2);
  });

  it('station names set in 1–3 tategaki columns, right to left', () => {
    const one = goshuinParts({ station: ST7, at: DAY, perfect: false, assisted: false, seed: 1, size: 320 });
    expect(one.columns).toBe(1);
    const hodogaya = STATIONS[3]!;
    const two = goshuinParts({ station: hodogaya, at: DAY, perfect: false, assisted: false, seed: 1, size: 320 });
    expect(two.columns).toBe(2);
    const cols = two.texts.filter((t) => t.vertical && t.font === one.texts[1]!.font && t.size === two.texts[1]!.size);
    expect(cols.map((c) => c.text)).toEqual(['保土', 'ヶ谷']);
    expect(cols[0]!.x).toBeGreaterThan(cols[1]!.x);
  });

  it('text layers mirror the SVG text (ordinal, name, 奉拝, date) with hex fills for the canvas pass', () => {
    const p = goshuinParts({ station: ST7, at: DAY, perfect: false, assisted: false, seed: 1, size: 320 });
    const texts = p.texts.map((t) => t.text);
    expect(texts).toEqual(['第七宿', '平塚', '奉拝', '令和八年十月十七日']);
    for (const t of p.texts) {
      expect(t.fill).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.lang).toBe('ja');
    }
    expect(p.texts[0]!.rotate).toBeDefined();
    expect(p.texts[2]!.rotate).toBeUndefined();
    const noText = goshuinSvg({ station: ST7, at: DAY, perfect: false, assisted: false, seed: 1, size: 320, textInSvg: false });
    expect(noText).not.toContain('平塚');
    expect(noText).not.toContain('奉拝');
    parse(noText);
  });

  it('size, paper and label options', () => {
    expect(parse(base(ST7, { size: 96 })).documentElement.getAttribute('width')).toBe('96');
    expect(clampGoshuinSize(1)).toBe(24);
    expect(clampGoshuinSize(99999)).toBe(2048);
    expect(clampGoshuinSize(Number.NaN)).toBe(160);
    expect(base(ST7)).not.toContain('goshuin__paper');
    const paper = parse(base(ST7, { paper: true }));
    expect(paper.querySelector('.goshuin__paper')?.getAttribute('fill')).toBe(WASHI);
    const labelled = parse(base(ST7, { label: 'Hiratsuka' }));
    expect(labelled.documentElement.getAttribute('role')).toBe('img');
    expect(labelled.querySelector('title')?.textContent).toBe('Hiratsuka');
    expect(parse(base(ST7)).documentElement.getAttribute('aria-hidden')).toBe('true');
  });

  it('cssVars writes tokens as var() with fallbacks (shu, kin, hai, fg) and never in fill attributes', () => {
    const svg = base(ST7, { perfect: true, assisted: true, cssVars: true });
    expect(svg).toContain(`var(--shu, ${PALETTE.light.shu.toLowerCase()})`);
    expect(svg).toContain(`var(--kin, ${PALETTE.light.kin.toLowerCase()})`);
    expect(svg).toContain(`var(--hai, ${PALETTE.light.hai.toLowerCase()})`);
    expect(svg).toContain('var(--fg,');
    expect(svg).not.toMatch(/fill="var\(/);
    expect(svg).not.toMatch(/stroke="var\(/);
    parse(svg);
    // dark theme without vars resolves to Arcade Night hexes
    const dark = base(ST7, { theme: 'dark' }).toLowerCase();
    expect(dark).toContain(PALETTE.dark.shu.toLowerCase());
    expect(dark).not.toContain(PALETTE.light.shu.toLowerCase());
  });

  it('goshuinDataUrl is the stamp with cssVars off as a data URL (design 09 §5.3: hex paints, the turbulence rasterised once)', () => {
    const url = goshuinDataUrl({ station: ST7, at: DAY, perfect: true, assisted: false, seed: 1, size: 200, theme: 'dark', cssVars: true });
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    const svg = decodeURIComponent(url.slice(url.indexOf(',') + 1));
    expect(svg).toBe(goshuinSvg({ station: ST7, at: DAY, perfect: true, assisted: false, seed: 1, size: 200, theme: 'dark', cssVars: false }));
    expect(svg).not.toContain('var(');
    expect(svg.toLowerCase()).toContain(PALETTE.dark.shu.toLowerCase());
    parse(svg);
  });

  it('goshuinImage leaves every <text> out of the data URL and hands the layers back for an inline overlay in the page fonts (07 §8)', () => {
    const img = goshuinImage({ station: ST7, at: DAY, perfect: true, assisted: false, seed: 1, size: 200, theme: 'dark', cssVars: true });
    expect(img.url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    const svg = decodeURIComponent(img.url.slice(img.url.indexOf(',') + 1));
    expect(svg).toBe(goshuinSvg({ station: ST7, at: DAY, perfect: true, assisted: false, seed: 1, size: 200, theme: 'dark', cssVars: false, textInSvg: false }));
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('var(');
    expect(svg).toContain('goshuin__gold');
    parse(svg);
    expect(img.view).toBe(GOSHUIN_VIEW);
    const texts = img.texts.map((t) => t.text);
    expect(texts).toContain('平塚');
    expect(texts).toContain('奉拝');
    expect(texts).toContain(stationOrdinal(7));
    expect(texts).toContain(eraDateKanji(DAY));
    for (const t of img.texts) expect(t.fill).toMatch(/^#[0-9a-f]{6}$/i);
    // the dark theme's sumi is the washi hex, as in the image itself
    expect(img.texts.find((t) => t.text === '奉拝')?.fill.toLowerCase()).toBe(WASHI.toLowerCase());
  });

  it('goshuinLabel reads the stamp aloud', () => {
    expect(goshuinLabel(ST7, DAY, false, false)).toBe('Goshuin of Station 7, 平塚 (Hiratsuka), cleared 令和8年10月17日.');
    expect(goshuinLabel(ST7, DAY, true, false)).toContain('gold frame');
    expect(goshuinLabel(ST7, DAY, false, true)).toContain('Revenge Match');
  });
});

describe('bookStrip', () => {
  const stamps: BookStamp[] = [1, 2, 3, 4, 7, 10].map((n) => ({ station: STATIONS[n - 1]!, at: DAY, perfect: n % 2 === 0, assisted: n === 7 }));

  it('desktop: one strip of 54 pages (53 + colophon) in two rows', () => {
    const out = bookStrip(stamps, 1, 'desktop');
    expect(out.length).toBe(1);
    const doc = parse(out[0]!);
    selfContained(out[0]!);
    expect(doc.documentElement.getAttribute('width')).toBe(String(27 * PAGE.w));
    expect(doc.documentElement.getAttribute('height')).toBe(String(2 * PAGE.h));
    expect(doc.querySelectorAll('.goshuin-page').length).toBe(BOOK_PAGES);
    expect(doc.querySelectorAll('.goshuin-page--cleared').length).toBe(stamps.length);
    expect(doc.querySelectorAll('.goshuin-page--locked').length).toBe(STATIONS.length - stamps.length);
    expect(doc.querySelectorAll('.goshuin-page--colophon').length).toBe(1);
    expect(doc.querySelectorAll('.goshuin__frame').length).toBe(stamps.length);
    expect(doc.querySelectorAll('.goshuin__gold').length).toBe(stamps.filter((s) => s.perfect).length);
    expect(doc.querySelectorAll('.goshuin__corner').length).toBe(1);
    // locked pages still show the name (tategaki: one <text> per glyph)
    const odawara = doc.querySelector('.goshuin-page[data-page="9"]')!;
    expect(odawara.classList.contains('goshuin-page--locked')).toBe(true);
    const glyphs = Array.from(odawara.querySelectorAll('text')).map((t) => t.textContent ?? '');
    for (const ch of Array.from('小田原')) expect(glyphs).toContain(ch);
    expect(glyphs).toContain('九');
    expect(glyphs).toContain('9 · Odawara');
    expect(out[0]).toContain('6 of 53 gates');
    const colophon = doc.querySelector('.goshuin-page--colophon')!;
    const title = Array.from(colophon.querySelectorAll('text')).map((t) => t.textContent ?? '');
    for (const ch of Array.from('東海道五十三次御朱印帳')) expect(title).toContain(ch);
    expect(title).toContain('つづく');
  });

  it('phone: six 1080×2340 images whose pages sit inside the safe zone', () => {
    const out = bookStrip(stamps, 1, 'phone');
    expect(out.length).toBe(PHONE_SET);
    const safe = safeRect('phone');
    let pages = 0;
    for (const svg of out) {
      const doc = parse(svg);
      selfContained(svg);
      expect(doc.documentElement.getAttribute('width')).toBe('1080');
      expect(doc.documentElement.getAttribute('height')).toBe('2340');
      for (const p of Array.from(doc.querySelectorAll('.goshuin-page'))) {
        pages++;
        const y = Number(p.getAttribute('data-y'));
        const h = Number(p.getAttribute('data-h'));
        const x = Number(p.getAttribute('data-x'));
        const w = Number(p.getAttribute('data-w'));
        expect(y).toBeGreaterThanOrEqual(safe.y);
        expect(y + h).toBeLessThanOrEqual(safe.y + safe.h + 0.01);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(1080.01);
      }
    }
    expect(pages).toBe(BOOK_PAGES);
  });

  it('is deterministic, ignores stamps for unknown stations, and offers text layers for the canvas pass', () => {
    expect(bookStrip(stamps, 1, 'desktop')).toEqual(bookStrip(stamps, 1, 'desktop'));
    expect(bookStrip(stamps, 1, 'desktop')).not.toEqual(bookStrip(stamps, 2, 'desktop'));
    const bogus: BookStamp = { station: { ...ST7, number: 99 }, at: DAY, perfect: false, assisted: false };
    const doc = parse(bookStrip([bogus], 1, 'desktop')[0]!);
    expect(doc.querySelectorAll('.goshuin-page--cleared').length).toBe(0);
    const imgs = bookStripImages(stamps, 1, 'desktop', { textInSvg: false });
    expect(imgs.length).toBe(1);
    expect(imgs[0]!.w).toBe(27 * PAGE.w);
    expect(parse(imgs[0]!.svg).querySelector('text')).toBeNull();
    expect(imgs[0]!.texts.some((t) => t.text === '小田原')).toBe(true);
    expect(imgs[0]!.texts.some((t) => t.text === '平塚')).toBe(true);
    for (const t of imgs[0]!.texts) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(imgs[0]!.w);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThanOrEqual(imgs[0]!.h);
    }
  });
});
