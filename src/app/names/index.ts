/**
 * TSUZUKU — `suggestName`: the katakana a Japanese speaker would write for an
 * English given name typed in Latin letters (design 02, Station 0).
 *
 * The four data files (filled by the names fleet) hold `[latin, kana, romaji]`
 * rows; this module owns the lookup and the two helpers the onboarding name
 * field shows the learner:
 *
 *  · `normalizeLatin(input)`  — the dictionary key for what was typed: the
 *    FIRST word of a full name ("Christopher Bradford" → christopher), accents
 *    stripped (José → jose, Zoë → zoe), lower-cased, trailing spaces and
 *    punctuation ignored; only `a-z` and `-` survive (the row rule).
 *  · `lookupName(table, input)` — the row for that key, as a `NameEntry`
 *    (a per-table index is built on first use); `suggestName` is the lookup
 *    over `ALL_NAMES`.
 *  · `soundGuide(romaji)` — the row's romaji cut into the syllables the IME
 *    resolves (ku・ri・su・to・fa・ー): the romaji is fed to `imeStep` one
 *    character at a time and cut wherever the resolved katakana grows; `-`
 *    is shown as ー. Pure, so the field can render it on every keystroke.
 */
import { imeStep } from '@/shared/kana-ime';
import type { NameEntry, NameTable } from './types';
import { NAMES_A_D } from './data-a-d';
import { NAMES_E_J } from './data-e-j';
import { NAMES_K_M } from './data-k-m';
import { NAMES_N_Z } from './data-n-z';

export type { NameEntry, NameRow, NameTable } from './types';

export const ALL_NAMES: NameTable = [...NAMES_A_D, ...NAMES_E_J, ...NAMES_K_M, ...NAMES_N_Z];

/** Letters NFD leaves whole; folded to the ASCII the row rule spells them with. */
const FOLD: Record<string, string> = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd', þ: 'th', ð: 'd', ı: 'i' };
const RE_FOLD = /[øæœßłđþðı]/g;
const RE_MARKS = /\p{M}+/gu;
const RE_NOT_KEY = /[^a-z-]/g;
const RE_EDGE_HYPHENS = /^-+|-+$/g;

/** The dictionary key for `input`: first word, accents stripped, lower-case `a-z` and `-` only ('' when nothing is left). */
export function normalizeLatin(input: string): string {
  const first = input.trim().split(/\s+/)[0] ?? '';
  return first.normalize('NFD').replace(RE_MARKS, '').toLowerCase().replace(RE_FOLD, (c) => FOLD[c] ?? c).replace(RE_NOT_KEY, '').replace(RE_EDGE_HYPHENS, '');
}

const INDEX = new WeakMap<NameTable, Map<string, NameEntry>>();

function indexOf(table: NameTable): Map<string, NameEntry> {
  let idx = INDEX.get(table);
  if (!idx) {
    idx = new Map();
    // First row wins when a table repeats a spelling.
    for (const [latin, kana, romaji] of table) if (!idx.has(latin)) idx.set(latin, { latin, kana, romaji });
    INDEX.set(table, idx);
  }
  return idx;
}

/** The row of `table` whose `latin` is `normalizeLatin(input)`, or null. */
export function lookupName(table: NameTable, input: string): NameEntry | null {
  const key = normalizeLatin(input);
  if (key.length === 0) return null;
  return indexOf(table).get(key) ?? null;
}

/** The established katakana for the given name typed in `input` (first word, case- and accent-insensitive), or null. */
export function suggestName(input: string): NameEntry | null {
  return lookupName(ALL_NAMES, input);
}

/**
 * The syllables a learner types to reach the row's kana: `romaji` cut
 * wherever one more character makes the IME's resolved text grow
 * (kurisutofa- → [ku, ri, su, to, fa, ー]); romaji still pending at the
 * end (a lone `n`) is the last syllable. `-` is shown as ー.
 */
export function soundGuide(romaji: string): string[] {
  const out: string[] = [];
  let glyphs = 0;
  let cut = 0;
  for (let i = 0; i < romaji.length; i++) {
    const n = Array.from(imeStep(romaji.slice(0, i + 1), { katakana: true }).text).length;
    if (n > glyphs) {
      out.push(romaji.slice(cut, i + 1));
      cut = i + 1;
      glyphs = n;
    }
  }
  if (cut < romaji.length) out.push(romaji.slice(cut));
  return out.map((s) => s.replace(/-/g, 'ー'));
}

/** `soundGuide` joined with the middle dot the field shows. */
export function soundGuideText(romaji: string): string {
  return soundGuide(romaji).join('・');
}
