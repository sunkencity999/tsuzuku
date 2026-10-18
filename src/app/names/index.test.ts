import { finalizeIme } from '@/shared/kana-ime';
import { ALL_NAMES, lookupName, normalizeLatin, soundGuide, soundGuideText, suggestName, type NameTable } from './index';

/** A fixture table (the real data files are another agent's; they may still be empty). */
const FIXTURE: NameTable = [
  ['christopher', 'クリストファー', 'kurisutofa-'],
  ['michael', 'マイケル', 'maikeru'],
  ['sean', 'ショーン', 'sho-n'],
  ['stephen', 'スティーブン', 'suthi-bun'],
  ['jose', 'ホセ', 'hose'],
  ['zoe', 'ゾーイ', 'zo-i'],
  ['chloe', 'クロエ', 'kuroe'],
  ['anna', 'アンナ', 'anna'],
  ['mary-jane', 'メアリージェーン', 'meari-je-n'],
  ['soren', 'ソーレン', 'so-ren'],
  // a repeated spelling: the first row wins
  ['michael', 'ミカエル', 'mikaeru'],
];

describe('normalizeLatin', () => {
  it.each([
    ['Christopher', 'christopher'],
    ['Christopher Bradford', 'christopher'],
    ['  christopher  ', 'christopher'],
    ['CHRISTOPHER', 'christopher'],
    ['José', 'jose'],
    ['Zoë', 'zoe'],
    ['CHLOÉ', 'chloe'],
    ['Søren', 'soren'],
    ['Mary-Jane', 'mary-jane'],
    ["O'Brien", 'obrien'],
    ['Chris.', 'chris'],
    ['-chris-', 'chris'],
    ['Jean Luc Picard', 'jean'],
  ])('%s → %s', (input, key) => {
    expect(normalizeLatin(input)).toBe(key);
  });

  it('is empty for blank, kana-only and digit-only input', () => {
    expect(normalizeLatin('')).toBe('');
    expect(normalizeLatin('   ')).toBe('');
    expect(normalizeLatin('クリス')).toBe('');
    expect(normalizeLatin('はな')).toBe('');
    expect(normalizeLatin('123')).toBe('');
  });

  it('every fixture key is already normal (the row rule /^[a-z][a-z-]*$/)', () => {
    for (const [latin] of FIXTURE) {
      expect(latin).toMatch(/^[a-z][a-z-]*$/);
      expect(normalizeLatin(latin)).toBe(latin);
    }
  });
});

describe('lookupName (fixture table)', () => {
  it('finds a row case-insensitively, accents stripped, trailing spaces ignored, first word of a full name', () => {
    expect(lookupName(FIXTURE, 'Christopher')).toEqual({ latin: 'christopher', kana: 'クリストファー', romaji: 'kurisutofa-' });
    expect(lookupName(FIXTURE, 'christopher bradford')).toEqual({ latin: 'christopher', kana: 'クリストファー', romaji: 'kurisutofa-' });
    expect(lookupName(FIXTURE, 'CHRISTOPHER  ')?.kana).toBe('クリストファー');
    expect(lookupName(FIXTURE, 'José')?.kana).toBe('ホセ');
    expect(lookupName(FIXTURE, 'Zoë')?.kana).toBe('ゾーイ');
    expect(lookupName(FIXTURE, 'Chloé')?.kana).toBe('クロエ');
    expect(lookupName(FIXTURE, 'Søren')?.kana).toBe('ソーレン');
    expect(lookupName(FIXTURE, 'Mary-Jane Watson')?.kana).toBe('メアリージェーン');
  });

  it('returns null for an unknown name, blank input and kana input', () => {
    expect(lookupName(FIXTURE, 'Xylophone')).toBeNull();
    expect(lookupName(FIXTURE, '')).toBeNull();
    expect(lookupName(FIXTURE, '   ')).toBeNull();
    expect(lookupName(FIXTURE, 'クリストファー')).toBeNull();
    expect(lookupName([], 'Christopher')).toBeNull();
  });

  it('a spelling the table repeats resolves to its first row', () => {
    expect(lookupName(FIXTURE, 'Michael')?.kana).toBe('マイケル');
  });

  it('the fixture rows obey the row rule: the romaji round-trips through the IME to exactly the kana', () => {
    for (const [, kana, romaji] of FIXTURE) {
      expect(finalizeIme(romaji, { katakana: true })).toBe(kana);
      expect(kana).toMatch(/^[ァ-ヺー・]+$/);
    }
  });
});

describe('suggestName (ALL_NAMES)', () => {
  it('is the lookup over the concatenated tables: null for blank or kana input, a consistent row otherwise', () => {
    expect(suggestName('')).toBeNull();
    expect(suggestName('   ')).toBeNull();
    expect(suggestName('クリス')).toBeNull();
    // The data tables are filled by another agent (and may be empty here); whatever they hold must agree with the lookup.
    const r = suggestName('Christopher Bradford');
    if (r) {
      expect(r.latin).toBe('christopher');
      expect(lookupName(ALL_NAMES, 'christopher')).toEqual(r);
    } else {
      expect(ALL_NAMES.some(([latin]) => latin === 'christopher')).toBe(false);
    }
  });
});

describe('soundGuide', () => {
  it.each([
    ['kurisutofa-', ['ku', 'ri', 'su', 'to', 'fa', 'ー']],
    ['maikeru', ['ma', 'i', 'ke', 'ru']],
    ['sho-n', ['sho', 'ー', 'n']],
    ['suthi-bun', ['su', 'thi', 'ー', 'bu', 'n']],
    ['kuroe', ['ku', 'ro', 'e']],
    ['hyu-', ['hyu', 'ー']],
    ['zabieru', ['za', 'bi', 'e', 'ru']],
    ['deibiddo', ['de', 'i', 'bi', 'ddo']],
  ])('%s splits where the resolved katakana grows, - shown as ー', (romaji, syllables) => {
    expect(soundGuide(romaji)).toEqual(syllables);
  });

  it('joins with the middle dot and is empty for empty romaji', () => {
    expect(soundGuideText('kurisutofa-')).toBe('ku・ri・su・to・fa・ー');
    expect(soundGuide('')).toEqual([]);
    expect(soundGuideText('')).toBe('');
  });

  it('typing the syllables back in order reaches the row kana for every fixture row', () => {
    for (const [, kana, romaji] of FIXTURE) {
      const typed = soundGuide(romaji).join('').replace(/ー/g, '-');
      expect(typed).toBe(romaji);
      expect(finalizeIme(typed, { katakana: true })).toBe(kana);
    }
  });
});
