import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { civilToDay } from '../shared/time';
import {
  advanceEm,
  columnHeight,
  columnsFor,
  eraDate,
  fitSize,
  FONTS,
  fontFamily,
  glyphCount,
  initials,
  inSafeZone,
  isWide,
  katakanaName,
  layerBounds,
  layoutInBox,
  needsRotation,
  safeTextBox,
  splitColumns,
  tategaki,
  tategakiLayers,
  textEl,
  textLayersSvg,
  textWidth,
  VERTICAL_PITCH,
  webfontOf,
  type TextLayer,
} from './jtext';
import { safeRect, svgDoc } from './svg';

function parse(markup: string): Document {
  const svg = svgDoc({ w: 100, h: 100, body: [markup] });
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
}

describe('fonts', () => {
  it('FONTS equal the --font-* tokens in tokens.css', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
    for (const [k, v] of Object.entries(FONTS)) {
      const m = new RegExp(`--font-${k}:\\s*([^;]+);`).exec(css);
      expect(m, k).not.toBeNull();
      expect(v).toBe(m![1]!.trim());
    }
    expect(fontFamily('brush')).toBe(FONTS.brush);
  });
  it('webfontOf names only the four self-hosted families', () => {
    expect(webfontOf(FONTS.brush)).toBe('Yuji Syuku');
    expect(webfontOf(FONTS.pixel)).toBe('DotGothic16');
    expect(webfontOf(FONTS.mincho)).toBe('Shippori Mincho B1');
    expect(webfontOf(FONTS.neon)).toBe('Dela Gothic One');
    expect(webfontOf(FONTS.ja)).toBeNull();
    expect(webfontOf(FONTS.ui)).toBeNull();
  });
});

describe('measurement', () => {
  it('wide glyphs advance 1 em, Latin less, spaces least', () => {
    expect(isWide('あ')).toBe(true);
    expect(isWide('漢')).toBe(true);
    expect(isWide('ー')).toBe(true);
    expect(isWide('Ａ')).toBe(true);
    expect(isWide('a')).toBe(false);
    expect(advanceEm('あ')).toBe(1);
    expect(advanceEm(' ')).toBe(0.3);
    expect(textWidth('つづく', 10)).toBe(30);
    expect(textWidth('ab', 10, { letterSpacing: 2 })).toBeCloseTo(11.2 + 2);
    expect(columnHeight('つづく', 10)).toBeCloseTo(10 * (1 + 2 * VERTICAL_PITCH));
    expect(columnHeight('', 10)).toBe(0);
    expect(glyphCount('𠮷野家')).toBe(3);
  });
  it('fitSize fits horizontally and vertically within bounds', () => {
    const s = fitSize('朝の鳥居', 200, 100);
    expect(s).toBeLessThanOrEqual(50);
    expect(textWidth('朝の鳥居', s)).toBeLessThanOrEqual(200);
    expect(fitSize('朝', 200, 100)).toBe(100);
    const v = fitSize('継続は力なり', 60, 400, { vertical: true });
    expect(v).toBeLessThanOrEqual(60);
    expect(columnHeight('継続は力なり', v)).toBeLessThanOrEqual(400);
    expect(fitSize('x', 1, 1, { min: 8 })).toBe(8);
    expect(fitSize('', 100, 40)).toBe(40);
    expect(fitSize('長い長い長い長い', 100, 100, { max: 10 })).toBe(10);
  });
});

describe('splitting', () => {
  it('splits into near-equal columns, avoiding bad starts', () => {
    expect(splitColumns('あいうえおかきくけこ', 2)).toEqual(['あいうえお', 'かきくけこ']);
    const cols = splitColumns('今日はいい天気です。明日も晴れでしょう。', 2);
    expect(cols.length).toBe(2);
    expect(cols[0]).toBe('今日はいい天気です。');
    expect(cols[1]).toBe('明日も晴れでしょう。');
    expect(splitColumns('きょうは。', 1)).toEqual(['きょうは。']);
    expect(splitColumns('', 3)).toEqual([]);
    expect(splitColumns('一', 3)).toEqual(['一']);
    const three = splitColumns('あいうえおかきくけこさしすせそ', 3);
    expect(three.join('')).toBe('あいうえおかきくけこさしすせそ');
    expect(three.length).toBe(3);
    for (const c of three) expect(['っ', 'ゃ', '。', '、'].includes(Array.from(c)[0]!)).toBe(false);
  });
  it('never starts a column with a small kana or punctuation', () => {
    const cols = splitColumns('きょうはちょっとさむいですね。', 3);
    for (const c of cols) expect(['ょ', 'っ', '。'].includes(Array.from(c)[0]!)).toBe(false);
    expect(cols.join('')).toBe('きょうはちょっとさむいですね。');
  });
  it('explicit newlines become columns', () => {
    expect(splitColumns('春\n夏', 2)).toEqual(['春', '夏']);
    expect(columnsFor('あいうえおかき', 3)).toBe(3);
  });
});

describe('tategaki', () => {
  it('layers flow right-to-left with one vertical layer per column', () => {
    const layers = tategakiLayers({ text: 'あいうえおかきくけこ', x: 500, y: 100, size: 40, columns: 2, font: FONTS.mincho, fill: '#000' });
    expect(layers.length).toBe(2);
    expect(layers[0]!.text).toBe('あいうえお');
    expect(layers[0]!.x).toBe(500);
    expect(layers[1]!.x).toBe(500 - 64);
    expect(layers.every((l) => l.vertical && l.lang === 'ja')).toBe(true);
  });
  it('markup stacks glyphs, rotates ー and carries lang="ja"', () => {
    const doc = parse(tategaki({ text: 'コーヒー', x: 50, y: 10, size: 10, font: FONTS.brush, fill: '#111' }));
    const g = doc.querySelector('g');
    expect(g?.getAttribute('lang')).toBe('ja');
    const texts = Array.from(doc.querySelectorAll('text'));
    expect(texts.length).toBe(4);
    expect(texts[0]?.getAttribute('y')).toBe('15');
    expect(texts[1]?.getAttribute('y')).toBe('26.2');
    expect(texts[1]?.getAttribute('transform')).toContain('rotate(90');
    expect(texts[0]?.getAttribute('transform')).toBeNull();
    expect(needsRotation('ー')).toBe(true);
    expect(needsRotation('あ')).toBe(false);
  });
});

describe('text layers', () => {
  it('horizontal textEl escapes and sets anchor/font', () => {
    const l: TextLayer = { text: 'A & B', x: 10, y: 20, size: 12, font: FONTS.pixel, fill: '#fff', anchor: 'middle', opacity: 0.5, weight: 700 };
    const svg = textEl(l);
    expect(svg).toContain('A &amp; B');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('opacity="0.5"');
    expect(svg).toContain('font-weight="700"');
    expect(svg).toContain('lang="ja"');
    parse(svg);
    expect(textLayersSvg([l, { ...l, rotate: -6 }])).toContain('rotate(-6 10 20)');
  });
  it('layerBounds and safe-zone checks', () => {
    const h: TextLayer = { text: 'つづく', x: 100, y: 100, size: 20, font: FONTS.ja, fill: '#000', anchor: 'middle' };
    const b = layerBounds(h);
    expect(b.w).toBe(60);
    expect(b.x).toBe(70);
    expect(b.y).toBeLessThan(100);
    const v: TextLayer = { text: 'つづく', x: 100, y: 100, size: 20, font: FONTS.ja, fill: '#000', vertical: true };
    expect(layerBounds(v)).toEqual({ x: 90, y: 100, w: 20, h: columnHeight('つづく', 20) });
    expect(inSafeZone(h, 'desktop')).toBe(true);
    const safe = safeRect('phone');
    expect(inSafeZone({ ...h, y: 100 }, 'phone')).toBe(false);
    expect(inSafeZone({ ...h, y: safe.y + 40 }, 'phone')).toBe(true);
    expect(inSafeZone({ ...v, y: safe.y + safe.h - 10 }, 'phone')).toBe(false);
    expect(safeTextBox('phone', 48).y).toBe(safe.y + 48);
  });
  it('layoutInBox fits inside the box for both directions', () => {
    const box = { x: 100, y: 200, w: 400, h: 120 };
    const l = layoutInBox('継続は力なり', box, { font: FONTS.brush, fill: '#000' });
    const b = layerBounds(l);
    expect(b.x).toBeGreaterThanOrEqual(box.x - 0.01);
    expect(b.x + b.w).toBeLessThanOrEqual(box.x + box.w + 0.01);
    expect(l.anchor).toBe('middle');
    const v = layoutInBox('継続は力なり', { x: 0, y: 0, w: 80, h: 600 }, { font: FONTS.mincho, fill: '#000', vertical: true });
    expect(v.vertical).toBe(true);
    expect(v.size).toBeLessThanOrEqual(80);
    expect(layerBounds(v).y + layerBounds(v).h).toBeLessThanOrEqual(600.01);
    const top = layoutInBox('x', box, { font: FONTS.ui, fill: '#000', valign: 'top', align: 'start', max: 20 });
    expect(top.x).toBe(100);
    expect(top.y).toBeCloseTo(200 + 20 * 0.88);
  });
});

describe('Japanese helpers', () => {
  it('eraDate formats Reiwa and 元年', () => {
    expect(eraDate(civilToDay({ year: 2026, month: 1, day: 15 }))).toBe('令和8年1月15日');
    expect(eraDate(civilToDay({ year: 2019, month: 5, day: 1 }))).toBe('令和元年5月1日');
  });
  it('katakanaName converts romaji, keeps katakana/kanji, initials take the first glyphs', () => {
    expect(katakanaName('hana')).toBe('ハナ');
    expect(katakanaName('ハナ')).toBe('ハナ');
    expect(katakanaName('  ')).toBe('');
    expect(initials('takeshi')).toBe('タケシ');
    expect(initials('ハナ・ミヤ', 3)).toBe('ハナミ');
    expect(initials('a', 0)).toBe('ア');
    // an English spelling that is not romaji stays as written (the onboarding keeps Latin names; no chリsトpヘr on a kakejiku)
    expect(katakanaName('Christopher')).toBe('Christopher');
    expect(katakanaName(' Mary Ann ')).toBe('Mary Ann');
    expect(initials('Christopher')).toBe('Chr');
  });
});
