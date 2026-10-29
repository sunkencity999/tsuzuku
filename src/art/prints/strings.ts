/**
 * TSUZUKU — print figure copy (prints B1; Sensei voice, design 01 §3). English
 * only: every Japanese string a print carries — artist, title, series — comes
 * from the pack manifest at runtime with its reading and gloss beside it,
 * never from src. Linted by `src/i18n/banned.test.ts`.
 */
export const S = {
  /** Data saver: the button over the preview that loads the full print. */
  printShow: 'Show the print',
  /** The caption's series line: "from <series ja> <series en>, <date>". */
  printFrom: 'from',
  /** A label an owner may put before the museum credit. */
  printSource: 'Source',
} as const;
