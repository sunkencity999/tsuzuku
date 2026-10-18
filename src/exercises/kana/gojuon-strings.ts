/**
 * TSUZUKU — Gojūon Fighter's poster copy (design 09 §2.5, §5.6, §10 D1): the
 * kana round as a woodblock print. The BEST eyebrow compares the round's hits
 * with the learner's OWN `stats.gojuonBest` only — never another learner,
 * never a global, never on a miss (footnote 5) — and only in the result.
 * `./strings.ts` keeps the drill's existing copy; only new lines live here.
 */
export { fill } from './strings';

export const S = {
  resultEyebrow: 'Round result',
  /** The BEST eyebrow: the round's hits passed the learner's own best ({n}). */
  bestEyebrow: 'Best · past your own {n}',
} as const;
