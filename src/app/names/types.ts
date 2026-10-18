/**
 * TSUZUKU — onboarding name dictionary: English given names → their
 * established katakana rendering, with the romaji a learner types into the
 * app's IME (katakana mode, `-` for the long mark ー) to reproduce it.
 *
 * Rows are `[latin, kana, romaji]`: `latin` is the lower-case ASCII spelling
 * (accents stripped: jose), `kana` is pure katakana (ァ-ヺ, ー, ・), `romaji`
 * round-trips through `src/shared/kana-ime` to exactly `kana`.
 */
export type NameRow = readonly [latin: string, kana: string, romaji: string];
export type NameTable = readonly NameRow[];

export interface NameEntry {
  latin: string;
  kana: string;
  romaji: string;
}
