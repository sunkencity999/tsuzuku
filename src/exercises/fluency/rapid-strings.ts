/**
 * TSUZUKU — Rapid Fire's poster copy (design 09 §2.5, §5.6, §10 D1): the
 * arcade as a woodblock print. The BEST eyebrow compares the round with the
 * learner's OWN `stats.rapidBest` only — never another learner, never a
 * global, never on a miss (footnote 5) — and only in the arcade result.
 * `./strings.ts` keeps the drill's existing copy; only new lines live here.
 */
export { fill } from './strings';

export const S = {
  tallyEyebrow: 'Round tally',
  /** The BEST eyebrow: the round passed the learner's own best ({n}). */
  bestEyebrow: 'Best · past your own {n}',
} as const;
