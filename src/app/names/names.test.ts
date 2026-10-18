/**
 * TSUZUKU — data integrity of the onboarding name dictionary (the REAL
 * tables, not a fixture; `index.test.ts` covers the lookup with a fixture).
 *
 * Every row is `[latin, kana, romaji]` (see types.ts). The rules checked here
 * are the ones the onboarding name field leans on: the key is what
 * `normalizeLatin` produces (so a lookup can hit it), the kana is pure
 * katakana, and the romaji is exactly what a learner types into the app's IME
 * in katakana mode to get that kana — `finalizeIme(romaji) === kana`, and the
 * sound guide cut from it (`soundGuide`) types back to the same romaji.
 *
 * When a row fails, fix the romaji (or the key's file), never the kana: the
 * kana is the rendering Japanese media use and the IME has to be typed
 * toward it. Each failing check lists its offending rows.
 */
import { finalizeIme } from '@/shared/kana-ime';
import { ALL_NAMES, normalizeLatin, soundGuide, suggestName, type NameTable } from './index';
import { NAMES_A_D } from './data-a-d';
import { NAMES_E_J } from './data-e-j';
import { NAMES_K_M } from './data-k-m';
import { NAMES_N_Z } from './data-n-z';

interface TableSpec {
  file: string;
  table: NameTable;
  /** The first letters a key in this file may start with. */
  range: RegExp;
}

const TABLES: readonly TableSpec[] = [
  { file: 'data-a-d.ts', table: NAMES_A_D, range: /^[a-d]/ },
  { file: 'data-e-j.ts', table: NAMES_E_J, range: /^[e-j]/ },
  { file: 'data-k-m.ts', table: NAMES_K_M, range: /^[k-m]/ },
  { file: 'data-n-z.ts', table: NAMES_N_Z, range: /^[n-z]/ },
];

const RE_KEY = /^[a-z][a-z-]*$/;
const RE_KANA = /^[ァ-ヺー・]+$/;
/** IME romaji: lower-case letters, `-` for ー and `'` (n' before a vowel). */
const RE_ROMAJI = /^[a-z'-]+$/;

const KATAKANA = { katakana: true } as const;

/** Rows of all tables tagged with their file, for messages that name the file. */
const ROWS = TABLES.flatMap(({ file, table }) => table.map((row) => ({ file, row })));

describe('names dictionary — shape', () => {
  it('ALL_NAMES is the four tables concatenated in A–D, E–J, K–M, N–Z order', () => {
    expect(ALL_NAMES).toEqual([...NAMES_A_D, ...NAMES_E_J, ...NAMES_K_M, ...NAMES_N_Z]);
  });

  it('holds at least 500 names', () => {
    expect(ALL_NAMES.length).toBeGreaterThanOrEqual(500);
  });

  it('every row is a [latin, kana, romaji] triple of non-empty strings', () => {
    const bad = ROWS.filter(({ row }) => row.length !== 3 || row.some((s) => typeof s !== 'string' || s.length === 0));
    expect(bad).toEqual([]);
  });
});

describe('names dictionary — (1) latin keys', () => {
  it('every key matches /^[a-z][a-z-]*$/', () => {
    const bad = ROWS.filter(({ row: [latin] }) => !RE_KEY.test(latin)).map(({ file, row: [latin] }) => `${file}: ${latin}`);
    expect(bad).toEqual([]);
  });

  it('every key is its own normalization (so typing it finds the row)', () => {
    const bad = ROWS.filter(({ row: [latin] }) => normalizeLatin(latin) !== latin).map(({ file, row: [latin] }) => `${file}: ${latin} → ${normalizeLatin(latin)}`);
    expect(bad).toEqual([]);
  });

  it('every key is unique across ALL_NAMES (no cross-file or in-file duplicates)', () => {
    const seen = new Map<string, string>();
    const dups: string[] = [];
    for (const { file, row: [latin] } of ROWS) {
      const first = seen.get(latin);
      if (first) dups.push(`${latin} (${first} and ${file})`);
      else seen.set(latin, file);
    }
    expect(dups).toEqual([]);
    expect(seen.size).toBe(ALL_NAMES.length);
  });

  it('every key sits in the file whose letter range it belongs to', () => {
    const bad = TABLES.flatMap(({ file, table, range }) => table.filter(([latin]) => !range.test(latin)).map(([latin]) => `${file}: ${latin}`));
    expect(bad).toEqual([]);
  });
});

describe('names dictionary — (2) kana', () => {
  it('every kana is pure katakana (ァ-ヺ, ー, ・)', () => {
    const bad = ROWS.filter(({ row: [, kana] }) => !RE_KANA.test(kana)).map(({ file, row: [latin, kana] }) => `${file}: ${latin} ${kana}`);
    expect(bad).toEqual([]);
  });
});

describe('names dictionary — (3) romaji round-trips through the IME', () => {
  it('every romaji is IME romaji (lower-case letters, - and \')', () => {
    const bad = ROWS.filter(({ row: [, , romaji] }) => !RE_ROMAJI.test(romaji)).map(({ file, row: [latin, , romaji] }) => `${file}: ${latin} ${romaji}`);
    expect(bad).toEqual([]);
  });

  it('finalizeIme(romaji, { katakana: true }) === kana for every row', () => {
    const bad = ROWS.filter(({ row: [, kana, romaji] }) => finalizeIme(romaji, KATAKANA) !== kana).map(
      ({ file, row: [latin, kana, romaji] }) => `${file}: ${latin} kana=${kana} romaji=${romaji} ime=${finalizeIme(romaji, KATAKANA)}`,
    );
    expect(bad).toEqual([]);
  });

  it('the sound guide shown to the learner types back to the romaji and reaches the kana', () => {
    const bad: string[] = [];
    for (const { file, row: [latin, kana, romaji] } of ROWS) {
      const typed = soundGuide(romaji).join('').replace(/ー/g, '-');
      if (typed !== romaji || finalizeIme(typed, KATAKANA) !== kana) bad.push(`${file}: ${latin} ${romaji} → ${soundGuide(romaji).join('・')}`);
    }
    expect(bad).toEqual([]);
  });

  it('a final ン is spelled with one n (finalizeIme resolves it) and ン before a vowel with nn, so the guide reads the same in every file', () => {
    const bad = ROWS.filter(({ row: [, , romaji] }) => /nn$/.test(romaji) || /nnn/.test(romaji)).map(({ file, row: [latin, , romaji] }) => `${file}: ${latin} ${romaji}`);
    expect(bad).toEqual([]);
  });
});

describe('names dictionary — (4) each table is sorted by key', () => {
  it.each(TABLES.map((t) => [t.file, t.table] as const))('%s is in ascending key order', (_file, table) => {
    const unsorted: string[] = [];
    for (let i = 1; i < table.length; i++) {
      const prev = table[i - 1][0];
      const cur = table[i][0];
      if (!(prev < cur)) unsorted.push(`${prev} ≥ ${cur}`);
    }
    expect(unsorted).toEqual([]);
  });
});

describe('names dictionary — (6) suggestName over the real data', () => {
  it.each([
    ['Christopher', 'クリストファー'],
    ['christopher bradford', 'クリストファー'],
    ['José', 'ホセ'],
    ['Zoë', 'ゾーイ'],
    ['Michael', 'マイケル'],
    ['sean', 'ショーン'],
    ['STEPHEN', 'スティーブン'],
    ['Graham', 'グレアム'],
    ['Hugh', 'ヒュー'],
    ['Chloé', 'クロエ'],
    ['Isla', 'アイラ'],
    ['Xavier', 'ザビエル'],
  ])('%s → %s', (input, kana) => {
    expect(suggestName(input)?.kana).toBe(kana);
  });

  it('is null for a name the dictionary does not hold', () => {
    expect(suggestName('xyzzy')).toBeNull();
  });

  it('is null for kana input: the key is Latin letters only, so クリス never matches a row (even though chris → クリス exists)', () => {
    expect(suggestName('クリス')).toBeNull();
    expect(suggestName('chris')?.kana).toBe('クリス');
  });

  it('every row is reachable through suggestName by its own key and by its capitalised full-name form', () => {
    const unreachable: string[] = [];
    for (const [latin, kana] of ALL_NAMES) {
      const cap = latin[0].toUpperCase() + latin.slice(1);
      if (suggestName(latin)?.kana !== kana || suggestName(`${cap} Smith`)?.kana !== kana) unreachable.push(latin);
    }
    expect(unreachable).toEqual([]);
  });
});
