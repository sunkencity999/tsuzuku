import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentFile, KanaItem } from '../../src/content/types.ts';
import { COUNTING, GREETINGS, KANA_TRACK_VOICE, kanaTracks, MINIMAL_PAIRS, trackCoverage } from './kana-tracks.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string): KanaItem[] => (JSON.parse(readFileSync(p, 'utf8')) as ContentFile<KanaItem>).items;
/** The shipped kana rows (238: 104 hiragana + 134 katakana). */
const KANA: KanaItem[] = [...read(join(here, '..', '..', 'public', 'content', 'kana', 'hiragana.json')), ...read(join(here, '..', '..', 'public', 'content', 'kana', 'katakana.json'))];

describe('kana-tracks — generated from KanaItem rows (design 08 §10.5)', () => {
  const tracks = kanaTracks(KANA);

  it('the shipped rows are the 238 kana', () => {
    expect(KANA.length).toBe(238);
  });

  it('covers every row, every dakuten pair, counting 1–10 and all 238 exampleWords', () => {
    const cov = trackCoverage(tracks, KANA);
    expect(cov.kanaMissing).toEqual([]);
    expect(cov.pairMissing).toEqual([]);
    expect(cov.wordsMissing).toEqual([]);
    expect(cov.countingMissing).toEqual([]);
    expect(COUNTING.map((s) => s.en)).toEqual(expect.arrayContaining(['one (1)', 'ten (10)']));
  });

  it('a pairs track interleaves base and voiced kana of the same row position (か が き ぎ …)', () => {
    const kg = tracks.find((t) => t.name === 'pairs-h-kg');
    expect(kg?.segments.slice(0, 4).map((s) => s.text)).toEqual(['か', 'が', 'き', 'ぎ']);
    const hp = tracks.find((t) => t.name === 'pairs-h-hp');
    expect(hp?.segments.slice(0, 2).map((s) => s.text)).toEqual(['は', 'ぱ']);
    expect(tracks.find((t) => t.name === 'pairs-h-kg-yoon')?.segments.map((s) => s.text)).toEqual(['きゃ', 'ぎゃ', 'きゅ', 'ぎゅ', 'きょ', 'ぎょ']);
    expect(tracks.find((t) => t.name === 'pairs-k-sz')?.segments.slice(0, 2).map((s) => s.text)).toEqual(['サ', 'ザ']);
  });

  it('minimal-pair tracks pair both words in one voice at one rate', () => {
    const pairs = tracks.filter((t) => t.kind === 'pair');
    expect(pairs.length).toBe(MINIMAL_PAIRS.length);
    for (const p of pairs) {
      expect(p.segments.length).toBe(2);
      expect(p.voice).toBe(KANA_TRACK_VOICE);
      expect(p.rate).toBe(1);
      expect(p.title).toBe(`${p.segments[0]?.kana}・${p.segments[1]?.kana}`);
      expect(p.titleEn.length).toBeGreaterThan(0);
    }
    expect(pairs[0]?.name).toBe('pair-01');
    expect(pairs[2]?.segments.map((s) => s.text)).toEqual(['きて', 'きって']);
  });

  it('every track is ハナ at rate 1, carries a Japanese title with an English one beside it, and has a unique name', () => {
    const names = new Set<string>();
    for (const t of tracks) {
      expect(t.voice).toBe('ハナ');
      expect(t.rate).toBe(1);
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.titleEn.length).toBeGreaterThan(0);
      expect(/^[a-z0-9-]+$/.test(t.name), t.name).toBe(true);
      expect(names.has(t.name), `duplicate ${t.name}`).toBe(false);
      names.add(t.name);
      for (const s of t.segments) {
        expect(s.text.length).toBeGreaterThan(0);
        expect(s.kana.length).toBeGreaterThan(0);
      }
    }
    expect(tracks.find((t) => t.name === 'row-h-k')?.titleEn).toBe('the k-row (hiragana): ka ki ku ke ko');
    expect(tracks.find((t) => t.name === 'row-h-k')?.title).toBe('か行');
    expect(tracks.find((t) => t.name === 'greetings')?.segments.length).toBe(GREETINGS.length);
  });

  it('example-word segments carry the item clip key so the clip renders once and is only re-encoded into the track', () => {
    const w = tracks.find((t) => t.name === 'words-h-a');
    expect(w?.segments[0]).toEqual({ text: 'あさ', kana: 'あさ', en: 'morning', clip: 'k-h-a#ex0' });
    expect(tracks.find((t) => t.name === 'row-h-a')?.segments[0]).toEqual({ text: 'あ', kana: 'あ', en: 'a', clip: 'k-h-a' });
  });

  it('is deterministic and pure', () => {
    expect(JSON.stringify(kanaTracks(KANA))).toBe(JSON.stringify(tracks));
    expect(kanaTracks([]).map((t) => t.name)).toEqual([...MINIMAL_PAIRS.map((_, i) => `pair-${String(i + 1).padStart(2, '0')}`), 'counting', 'greetings']);
  });
});
