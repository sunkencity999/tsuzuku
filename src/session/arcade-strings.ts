/**
 * TSUZUKU — the arcade print's copy for the session surfaces (design 09 §2.5,
 * §5.6, §10 D1): poster titles, the Gate's stone wall and its shatter, the
 * towns and gates that lie AHEAD (never "locked"), the Shinsa section-sheet
 * heads and the BEST eyebrow Kage shows against the learner's OWN best only
 * (footnote 5: never another learner, never a global, never on a miss).
 * Sensei voice: calm, specific, no hype, no countdown. Linted by
 * `src/i18n/banned.test.ts` (the `*-strings.ts` glob). `pages/strings.ts`
 * keeps the copy the views already carried; only new lines live here.
 */
import type { ShinsaSection } from '../shared/catalog';

export { fill } from './engine-strings';

export const S = {
  // Gate — the wall is stone; each clean rep chips a piece away
  wallStone: 'Stone wall. Each clean rep chips a piece away.',
  wallDown: 'The wall is down. The doors part.',
  // the gate that lies ahead (design 09 §3.3: towns ahead are labelled ahead, never locked)
  ahead: 'Ahead',
  gateAheadLine: 'This gate lies ahead. The training between here and there opens it.',
  doorsAlt: 'The gate doors, parting',

  // Shinsa — the five section sheets (heads in Mincho beside their kanji from SHINSA_LABEL)
  shinsaHead: {
    ear: 'Ear · listening',
    read: 'Reading',
    form: 'Form · grammar',
    mouth: 'Mouth · speaking',
    write: 'Writing',
  } as Record<ShinsaSection, string>,
  shinsaSheetAria: 'Section sheet: {head}',

  // Kage — the poster
  kagePoster: 'Kage VS',
  kageResultPoster: 'Kage · result',
  kageLaneYou: 'you',
  kageLaneShadow: 'shadow',
  /** Romaji for the hi-score table's factory initials (kage.ts FACTORY_TABLE), shown only below Green kana (design 09 §3.3). */
  kageInitials: { カゲ: 'Kage', ツヅ: 'Tsuzu', ミチ: 'Michi', ハナ: 'Hana', ケン: 'Ken', ムメ: 'Mume' } as Record<string, string>,
  /** The BEST eyebrow: the run passed the learner's own best of four weeks ({n}); never shown otherwise. */
  kageBest: 'Best · past your own {n}',
} as const;
