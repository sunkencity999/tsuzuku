import { SHINSA_SECTIONS } from '../shared/catalog';
import { findBanned } from '../i18n/banned-phrases';
import { S, fill } from './arcade-strings';

describe('arcade-strings (design 09 §10 D1)', () => {
  it('names every Shinsa section sheet, says "ahead" and never "locked", and fills the Kage BEST eyebrow with the learner’s own number', () => {
    for (const sec of SHINSA_SECTIONS) expect(S.shinsaHead[sec].length).toBeGreaterThan(0);
    const all = JSON.stringify(S);
    expect(all).not.toMatch(/locked/i);
    expect(all).not.toMatch(/!/);
    expect(S.ahead).toBe('Ahead');
    expect(fill(S.kageBest, { n: 950 })).toBe('Best · past your own 950');
  });

  it('passes the banned-phrase lint', () => {
    const values: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') values.push(v);
      else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
    };
    walk(S);
    expect(values.length).toBeGreaterThan(10);
    for (const v of values) expect(findBanned(v), v).toEqual([]);
  });
});
