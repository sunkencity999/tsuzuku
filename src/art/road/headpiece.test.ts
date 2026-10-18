/**
 * headpiece.ts — the Hara headpiece (Station 13, Fuji centre) at 280 and 720 px, Morning and Night, with and without
 * reduced motion: eight snapshots, the go/no-go for a later emaki (design 09 §12.1 decision 6); ≤ 120 nodes for every
 * station; ONE filter def used by ONE group; no text, no kanji; tokens only.
 */
import { describe, expect, it } from 'vitest';
import { STATIONS } from '../../content/types';
import { HEADPIECE_HEIGHT, HEADPIECE_MAX_NODES, SUMI_FILTER_ID, headpiece, headpieceLabel, headpieceWidth } from './headpiece';

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
}
const HARA = 13;

describe('headpiece', () => {
  for (const width of [280, 720] as const) {
    for (const theme of ['light', 'dark'] as const) {
      for (const reduced of [false, true]) {
        it(`Hara at ${width} px, ${theme === 'light' ? 'Morning' : 'Night'}, ${reduced ? 'reduced motion' : 'full motion'} (snapshot)`, () => {
          const svg = headpiece({ station: HARA, width, theme, reduced });
          expect(svg).toBe(headpiece({ station: HARA, width, theme, reduced }));
          expect(svg).not.toMatch(/NaN|Infinity|undefined/);
          const doc = parse(svg);
          const root = doc.documentElement;
          expect(root.getAttribute('viewBox')).toBe(`0 0 ${width} ${HEADPIECE_HEIGHT}`);
          expect(root.getAttribute('aria-hidden')).toBe('true');
          expect(doc.querySelectorAll('*').length).toBeLessThanOrEqual(HEADPIECE_MAX_NODES);
          // Fuji is the centre: the first vista motif's polygon spans the middle of the picture
          expect(svg).toContain('var(--road)');
          // the keeper: the ink wash stays, the toned layer carries the lift only in full motion
          expect(doc.querySelector('.headpiece__wash')).not.toBeNull();
          expect(doc.querySelector('.headpiece__keeper')).not.toBeNull();
          expect(doc.querySelector('.headpiece__tone') !== null).toBe(!reduced);
          expect(root.hasAttribute('data-reduced')).toBe(reduced);
          expect(root.getAttribute('data-theme')).toBe(theme);
          expect(svg).toMatchSnapshot();
        });
      }
    }
  }

  it('one sumi filter def per page, applied to ONE group (one live filter), titled "ahead"; the two towns ahead are Yoshiwara and Kanbara at 720, one at 280', () => {
    const wide = parse(headpiece({ station: HARA, width: 720, theme: 'light', reduced: false }));
    expect(wide.querySelectorAll('filter').length).toBe(1);
    expect(wide.querySelector('filter')?.getAttribute('id')).toBe(SUMI_FILTER_ID);
    const filtered = Array.from(wide.querySelectorAll('[filter]'));
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.getAttribute('filter')).toBe(`url(#${SUMI_FILTER_ID})`);
    expect(filtered[0]?.getAttribute('data-state')).toBe('ahead');
    expect(filtered[0]?.querySelector('title')?.textContent).toBe('ahead');
    // two towns ahead at 720 (motif groups under the title), one at 280
    const aheadWide = filtered[0]!.children.length - 1;
    expect(aheadWide).toBe(2);
    const narrow = parse(headpiece({ station: HARA, width: 280, theme: 'light', reduced: false }));
    expect(narrow.querySelector('[filter]')!.children.length - 1).toBe(1);
    // the last station has nothing ahead and no filtered group at all
    const last = parse(headpiece({ station: 53, width: 720, theme: 'dark', reduced: false }));
    expect(last.querySelectorAll('[filter]').length).toBe(0);
    expect(last.querySelectorAll('filter').length).toBe(1); // the def is still the page's one shared def
  });

  it('every station stays within the node budget at the widest composition, in both themes; no text, no kanji, tokens only', () => {
    for (const st of STATIONS) {
      for (const theme of ['light', 'dark'] as const) {
        const svg = headpiece({ station: st.number, width: 720, theme, reduced: false });
        const doc = parse(svg);
        expect(doc.querySelectorAll('*').length, `station ${st.number} ${theme}`).toBeLessThanOrEqual(HEADPIECE_MAX_NODES);
        expect(doc.querySelectorAll('text').length).toBe(0);
        expect(svg).not.toMatch(/[㐀-鿿]/);
        for (const m of svg.matchAll(/\b(?:fill|stroke)="([^"]*)"/g)) expect(m[1], `station ${st.number}: ${m[1]}`).toMatch(/^(var\(--[a-z-]+\)|none)$/);
      }
    }
  });

  it('theme changes the bands and the lamps, width changes the composition, reduced motion only the class', () => {
    const base = headpiece({ station: HARA, width: 720, theme: 'light', reduced: false });
    expect(headpiece({ station: HARA, width: 720, theme: 'dark', reduced: false })).not.toBe(base);
    expect(headpiece({ station: HARA, width: 280, theme: 'light', reduced: false })).not.toBe(base);
    const reduced = headpiece({ station: HARA, width: 720, theme: 'light', reduced: true });
    expect(reduced.replace(' data-reduced=""', '').replace('class="headpiece__keeper"', 'class="headpiece__keeper headpiece__tone"')).toBe(base);
    // a lantern vista: the lamps are gold at Night, paper by day (Akasaka, the Lantern Inn; its sky is kin in both)
    const gold = (svg: string): number => (svg.match(/fill="var\(--kin\)"/g) ?? []).length;
    const night = headpiece({ station: 36, width: 720, theme: 'dark', reduced: false });
    const day = headpiece({ station: 36, width: 720, theme: 'light', reduced: false });
    expect(gold(night)).toBeGreaterThan(gold(day));
    expect(day).toContain('fill="var(--surface)"');
  });

  it('headpieceWidth snaps a measured box to 40 px within 280–720 and falls back to 720 when unmeasured; the label names the vista', () => {
    expect(headpieceWidth(0)).toBe(720);
    expect(headpieceWidth(NaN)).toBe(720);
    expect(headpieceWidth(100)).toBe(280);
    expect(headpieceWidth(333)).toBe(320);
    expect(headpieceWidth(9000)).toBe(720);
    expect(headpieceLabel(HARA)).toBe('Fuji view. Fuji at its tallest over the Hara marshes.');
    expect(headpieceLabel(0)).toBe('');
  });
});
