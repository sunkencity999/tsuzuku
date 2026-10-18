/**
 * motifs.ts — the road motif kit: deterministic, every documented node count exact, re-palettised without
 * a stray wallpaper def, the ink wash one-coloured (design 09 §10 C2).
 */
import { describe, expect, it } from 'vitest';
import { INK_PALETTE, MOTIFS, MOTIF_IDS, TOKEN_PALETTE, countNodes, inkWash, motif, motifNodes } from './motifs';

function parse(markup: string): Element[] {
  const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml');
  expect(doc.querySelector('parsererror'), markup.slice(0, 120)).toBeNull();
  return Array.from(doc.documentElement.querySelectorAll('*'));
}

describe('motif kit', () => {
  it('ships the brief’s set: pine ×3, torii ×4, chōchin ×4, pagoda ×2, Fuji, wave, bridge, gate, teahouse, inn', () => {
    const count = (prefix: string): number => MOTIF_IDS.filter((id) => id.startsWith(prefix)).length;
    expect(count('pine-')).toBe(3);
    expect(count('torii-')).toBe(4);
    expect(count('chochin-')).toBe(4);
    expect(count('pagoda-')).toBe(2);
    for (const id of ['fuji', 'wave', 'bridge', 'gate', 'teahouse', 'inn']) expect(MOTIF_IDS).toContain(id);
    expect(MOTIF_IDS).toHaveLength(19);
  });

  for (const id of MOTIF_IDS) {
    it(`${id}: deterministic, well-formed, exactly ${MOTIFS[id].nodes} nodes, no wallpaper def reference, finite numbers`, () => {
      const a = motif(id, 40, 60, 48, 7, INK_PALETTE);
      const b = motif(id, 40, 60, 48, 7, INK_PALETTE);
      expect(a).toBe(b);
      expect(a).not.toMatch(/NaN|Infinity|undefined/);
      const els = parse(a);
      expect(els.length, `${id} nodes`).toBe(motifNodes(id));
      expect(countNodes(a), `${id} quick count`).toBe(motifNodes(id));
      // the lifted generators' private defs (cl-glow, cl-paper, fs-lglow, glow, paper) never leak into a page
      expect(a).not.toMatch(/url\(#/);
      // re-palettised: with tokens, every colour is a token or `none`
      const t = motif(id, 40, 60, 48, 7, TOKEN_PALETTE);
      for (const m of t.matchAll(/\b(?:fill|stroke)="([^"]*)"/g)) expect(m[1], `${id} colour ${m[1]}`).toMatch(/^(var\(--[a-z-]+\)|none)$/);
      // a different seed or place never changes the node count
      expect(parse(motif(id, 12.5, 30, 20, 99, INK_PALETTE)).length).toBe(motifNodes(id));
    });
  }

  it('the lifted pictures come from the generators, not copies: the same call to the source gives the same geometry', async () => {
    const { pine } = await import('./wallpapers/fifty-three');
    const { torii } = await import('./wallpapers/lantern-river');
    expect(motif('pine-a', 10, 20, 1.03 * 30, 1, INK_PALETTE)).toBe(pine(10, 20, 30, INK_PALETTE.ink));
    expect(motif('torii-a', 10, 20, 1.2 * 30, 1, INK_PALETTE)).toBe(torii(10, 20, 30, INK_PALETTE.accent));
  });

  it('inkWash paints one colour and keeps `none`', () => {
    const washed = inkWash(motif('chochin-a', 20, 40, 30, 3, INK_PALETTE), '#8A8578');
    const colours = new Set(Array.from(washed.matchAll(/\b(?:fill|stroke)="([^"]*)"/g), (m) => m[1]));
    expect([...colours].sort()).toEqual(['#8A8578', 'none']);
    expect(parse(washed).length).toBe(motifNodes('chochin-a'));
  });

  it('the foot is at (x, y): nothing is drawn below the ground line by more than a hair', () => {
    for (const id of MOTIF_IDS) {
      const m = motif(id, 100, 100, 50, 1, INK_PALETTE);
      const ys = Array.from(m.matchAll(/\b(?:y|cy|y1|y2)="(-?[\d.]+)"/g), (x) => Number(x[1]));
      for (const y of ys) expect(y, `${id} y ${y}`).toBeLessThanOrEqual(100.6);
    }
  });
});
