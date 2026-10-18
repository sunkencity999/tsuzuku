/**
 * GenkanStrip.tsx — three towns (previous · current · next), readings by the belt rule, the state words, ≤ 60 nodes, no filter.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NIHONBASHI, SANJO_OHASHI } from '../../content/types';
import { href } from '../../shared/routes';
import { GENKAN_MAX_NODES, GenkanStrip, townNumbers, townOf, type GenkanStripProps } from './GenkanStrip';
import { S } from './strings';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

function mount(p: Partial<GenkanStripProps> = {}): void {
  act(() => render(<GenkanStrip station={p.station ?? 4} belt={p.belt ?? 'yellow'} furigana={p.furigana ?? 'always'} lit={p.lit} />, root));
}
const towns = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('.dojo__town'));

describe('<GenkanStrip>', () => {
  it('three towns, the current in the middle, each with number, ordinal, name, reading and the English state word; ahead is never locked', () => {
    mount({ station: 4, belt: 'yellow' });
    expect(root.querySelector('.dojo__genkan')?.getAttribute('aria-label')).toBe(S.genkanLabel);
    expect(towns().map((t) => t.getAttribute('data-town'))).toEqual(['3', '4', '5']);
    expect(towns().map((t) => t.getAttribute('data-state'))).toEqual(['passed', 'here', 'ahead']);
    expect(towns()[1]?.getAttribute('aria-current')).toBe('step');
    expect(towns()[0]?.hasAttribute('aria-current')).toBe(false);
    const here = towns()[1]!;
    expect(here.querySelector('.sign__number')?.textContent).toBe('4');
    expect(here.querySelector('.sign__ordinal')?.textContent).toBe('第四宿');
    expect(here.querySelector('.sign__ja')?.textContent).toBe('保土ヶ谷');
    expect(here.querySelector('.sign__reading')?.textContent).toBe('Hodogaya');
    expect(here.querySelector('.sign__en')?.textContent).toBe(S.townHere);
    expect(towns()[0]?.querySelector('.sign__en')?.textContent).toBe(S.townPassed);
    expect(towns()[2]?.querySelector('.sign__en')?.textContent).toBe(S.townAhead);
    expect(towns()[2]?.querySelector('a')?.getAttribute('href')).toBe(href({ name: 'station', n: 5 }));
    expect(root.textContent?.toLowerCase()).not.toContain('locked');
    // every town carries a vignette on the road band, and nothing is filtered
    expect(root.querySelectorAll('.dojo__town-art').length).toBe(3);
    for (const art of Array.from(root.querySelectorAll('.dojo__town-art'))) expect(art.children.length).toBeGreaterThan(0);
    expect(root.querySelectorAll('filter, [filter]').length).toBe(0);
  });

  it('stays within 60 nodes before and after Green', () => {
    mount({ station: 20, belt: 'yellow' });
    expect(root.querySelectorAll('*').length).toBeLessThanOrEqual(GENKAN_MAX_NODES);
    mount({ station: 20, belt: 'green' });
    expect(root.querySelectorAll('*').length).toBeLessThanOrEqual(GENKAN_MAX_NODES);
  });

  it('the reading follows the kana rule: romaji below Green, kana ruby from Green on — removed, not dimmed', () => {
    mount({ station: 16, belt: 'green', furigana: 'always' });
    const here = towns()[1]!;
    expect(here.querySelector('.sign__reading')).toBeNull();
    expect(here.querySelector('.sign__ja ruby')).not.toBeNull();
    expect(here.querySelector('.sign__ja rt')?.textContent).toBe('ゆい');
    expect(here.querySelector('.sign__ja')?.textContent).toContain('由比');
    mount({ station: 16, belt: 'orange', furigana: 'always' });
    expect(towns()[1]?.querySelector('.sign__reading')?.textContent).toBe('Yui');
    expect(towns()[1]?.querySelector('.sign__ja ruby')).toBeNull();
    // `tap` furigana: the reading is shown, never a tap-to-reveal ruby inside the link (no nested interactive content)
    mount({ station: 16, belt: 'green', furigana: 'tap' });
    expect(towns()[1]?.querySelector('.sign__ja rt')?.textContent).toBe('ゆい');
    expect(root.querySelectorAll('a.dojo__town-link [role="button"], a.dojo__town-link [tabindex]').length).toBe(0);
    expect(root.querySelectorAll('.ruby__seg--fog').length).toBe(0);
  });

  it('the ends: Nihonbashi before Station 1 and Sanjō Ōhashi after 53, from the content constants, without an ordinal, linking to the road', () => {
    mount({ station: 0 });
    expect(towns().map((t) => t.getAttribute('data-town'))).toEqual(['0', '1']);
    expect(towns()[0]?.querySelector('.sign__ja')?.textContent).toBe(NIHONBASHI.nameJa);
    expect(towns()[0]?.querySelector('.sign__reading')?.textContent).toBe(NIHONBASHI.nameRomaji);
    expect(towns()[0]?.querySelector('.sign__ordinal')).toBeNull();
    expect(towns()[0]?.querySelector('.sign__number')).toBeNull(); // 0 is not a station number a learner meets anywhere
    expect(towns()[0]?.getAttribute('data-belt')).toBe('white');
    expect(towns()[1]?.getAttribute('data-belt')).toBe('white');
    expect(towns()[0]?.querySelector('a')?.getAttribute('href')).toBe(href({ name: 'road' }));
    mount({ station: 53, belt: 'black', furigana: 'off' });
    expect(towns().map((t) => t.getAttribute('data-town'))).toEqual(['52', '53', '54']);
    expect(towns()[2]?.querySelector('.sign__ja')?.textContent).toBe(SANJO_OHASHI.nameJa);
    expect(towns()[2]?.querySelector('.sign__reading')).toBeNull();
    expect(towns()[2]?.querySelector('.sign__number')).toBeNull();
    expect(towns()[2]?.getAttribute('data-belt')).toBe('black');
    expect(towns()[1]?.querySelector('.sign__number')?.textContent).toBe('53');
    expect(townNumbers(4)).toEqual([3, 4, 5]);
    expect(townNumbers(0)).toEqual([0, 1]);
    expect(townNumbers(53)).toEqual([52, 53, 54]);
    expect(townOf(54).onRoad).toBe(false);
    expect(townOf(13).onRoad).toBe(true);
  });
});
