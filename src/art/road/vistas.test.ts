/**
 * vistas.ts — 53 rows keyed to the stations, every motif a kit id, every name and note English, the lookup null off the road.
 */
import { describe, expect, it } from 'vitest';
import { STATIONS } from '../../content/types';
import { MOTIF_IDS } from '../motifs';
import { VISTA_COPY } from './strings';
import { VISTAS, onRoad, vistaName, vistaOf } from './vistas';

describe('vistas', () => {
  it('one row per station 1–53, in order, with one to three kit motifs each', () => {
    expect(VISTAS).toHaveLength(53);
    expect(VISTAS.map((v) => v.station)).toEqual(STATIONS.map((s) => s.number));
    for (const v of VISTAS) {
      expect(v.motifs.length).toBeGreaterThanOrEqual(1);
      expect(v.motifs.length).toBeLessThanOrEqual(3);
      for (const id of v.motifs) expect(MOTIF_IDS).toContain(id);
      expect(v.name.length).toBeGreaterThan(0);
      expect(v.note.length).toBeGreaterThan(0);
      // English only: no kana or kanji in a vista line (the Japanese is STATIONS' alone)
      expect(v.name).not.toMatch(/[぀-ヿ㐀-鿿]/);
      expect(v.note).not.toMatch(/[぀-ヿ㐀-鿿]/);
      expect(`${v.name} ${v.note}`.toLowerCase()).not.toContain('locked');
    }
    expect(VISTA_COPY).toHaveLength(54);
  });

  it('the themes read from the keepers: Hara is Fuji, Hakone the gate, Goyu the inn, Fukuroi the teahouse, Shimada the river', () => {
    expect(vistaOf(13)?.motifs[0]).toBe('fuji');
    expect(vistaOf(13)?.name).toBe('Fuji view');
    expect(vistaOf(10)?.motifs[0]).toBe('gate');
    expect(vistaOf(35)?.motifs[0]).toBe('inn');
    expect(vistaOf(27)?.motifs[0]).toBe('teahouse');
    expect(vistaOf(23)?.motifs).toContain('wave');
    expect(new Set(VISTAS.map((v) => v.name)).size).toBe(53);
  });

  it('the kit is used broadly: at least ten distinct motifs lead a row (eleven today)', () => {
    expect(new Set(VISTAS.map((v) => v.motifs[0])).size).toBeGreaterThanOrEqual(10);
  });

  it('vistaName is the 次回予告 lookup: a name on the road, null off it', () => {
    expect(vistaName(4)).toBe('Shinmachi bridge');
    expect(vistaName(0)).toBeNull();
    expect(vistaName(54)).toBeNull();
    expect(vistaName(-1)).toBeNull();
    expect(onRoad(53)).toBe(true);
    expect(onRoad(54)).toBe(false);
  });
});
