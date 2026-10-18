import { WALL_MAX_PIECES, wallPieces, wallStoneUrl } from './gate-wall';

describe('gate-wall (design 09 §10 D1)', () => {
  it('the stone tile is one static data URL per theme, carrying a dither pattern and no filter', () => {
    const light = wallStoneUrl('light');
    const dark = wallStoneUrl('dark');
    expect(light.startsWith('data:image/svg+xml')).toBe(true);
    expect(light).toContain('pattern');
    expect(light).not.toContain('filter');
    expect(light).not.toBe(dark);
    expect(wallStoneUrl()).toBe(light);
  });

  it('shatters the wall into at most WALL_MAX_PIECES seeded pieces, rightmost first', () => {
    const a = wallPieces(7, 8);
    expect(a).toHaveLength(WALL_MAX_PIECES);
    expect(wallPieces(7, 20)).toHaveLength(WALL_MAX_PIECES);
    expect(wallPieces(7, 3)).toHaveLength(3);
    expect(a).toEqual(wallPieces(7, 8));
    expect(a).not.toEqual(wallPieces(8, 8));
    const xs = a.map((p) => {
      const pts = p.split(' ').map((pair) => Number(pair.split(',')[0]));
      return pts.reduce((s, x) => s + x, 0) / pts.length;
    });
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeLessThanOrEqual(xs[i - 1]! + 1e-6);
  });
});
