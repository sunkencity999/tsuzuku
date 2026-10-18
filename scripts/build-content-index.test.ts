import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTENT_KINDS } from '../src/content/types.ts';
import { assign, bundlesFromCorpus } from './assign-stations.ts';
import type { PlanEntry } from './assign-stations.ts';
import { BuildIndexError, buildIndex, checkPools, deriveContentVersion, isDerivedVersion, listContentFiles, listPoolFiles, oversizePools, oversizeStations, stationEntrySizes, stringifyManifest, writeIndex, MAX_FILE_BYTES, POOL_FILE_BUDGET_BYTES, STATION_ENTRY_BUDGET_BYTES } from './build-content-index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const GOOD = join(here, '__fixtures__', 'good');
const PLAN = JSON.parse(readFileSync(join(here, '__fixtures__', 'plan-good.json'), 'utf8')) as PlanEntry[];
const AT = '2026-10-17T00:00:00.000Z';
const tmps: string[] = [];

afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

function corpus(): string {
  const root = mkdtempSync(join(tmpdir(), 'tsuzuku-index-'));
  tmps.push(root);
  cpSync(GOOD, root, { recursive: true });
  const allow = mkdtempSync(join(tmpdir(), 'tsuzuku-allow-'));
  tmps.push(allow);
  assign(root, PLAN, { write: true, allowlistsDir: allow });
  return root;
}

describe('build-content-index', () => {
  it('is deterministic: two builds are byte-identical and sorted', () => {
    const root = corpus();
    const a = stringifyManifest(buildIndex(root, '2026.10.1', { generatedAt: AT }));
    const b = stringifyManifest(buildIndex(root, '2026.10.1', { generatedAt: AT }));
    expect(a).toBe(b);
    const m = JSON.parse(a) as ReturnType<typeof buildIndex>;
    expect(m.schema).toBe('tsuzuku.manifest/1');
    expect(m.contentVersion).toBe('2026.10.1');
    expect(m.generatedAt).toBe(AT);
    expect(m.files.map((f) => f.path)).toEqual([...m.files.map((f) => f.path)].sort());
    expect(m.stations.map((s) => s.number)).toEqual(Array.from({ length: 53 }, (_, i) => i + 1));
    expect(Object.keys(m.totals)).toEqual([...CONTENT_KINDS]);
    expect(m.componentsPath).toBe('_meta/components.json');
    expect(m.redirects).toEqual({});
  });

  it('records bytes and sha256 of the raw file, counts, belts and stations', () => {
    const root = corpus();
    const m = buildIndex(root, '1.0.0', { generatedAt: AT });
    const vocab = m.files.find((f) => f.path === 'vocab/n5/vocab-n5-001.json')!;
    const buf = readFileSync(join(root, vocab.path));
    expect(vocab.bytes).toBe(buf.length);
    expect(vocab.bytes).toBe(statSync(join(root, vocab.path)).size);
    expect(vocab.sha256).toBe(createHash('sha256').update(buf).digest('hex'));
    expect(vocab.type).toBe('vocab');
    expect(vocab.level).toBe('n5');
    expect(vocab.count).toBe(16);
    expect(vocab.stations).toEqual([1]);
    expect(vocab.belts).toEqual(['white']);
    const kanji = m.files.find((f) => f.path === 'kanji/n5/kanji-n5-001.json')!;
    expect(kanji.stations).toEqual([4, 5]);
    expect(kanji.belts).toEqual(['yellow']);
    const comps = m.files.find((f) => f.path === '_meta/components.json')!;
    expect(comps.type).toBe('component');
    expect(comps.level).toBeNull();
    expect(comps.stations).toEqual([2, 3]);
    const kana = m.files.find((f) => f.path === 'kana/hiragana.json')!;
    expect(kana.level).toBeNull();
    expect(kana.stations).toEqual([1, 2]);
    const story = m.files.find((f) => f.path === 'stories/n5/stories-s04.json')!;
    expect(story.stations).toEqual([4]);
    expect(m.totals).toEqual({ kana: 21, vocab: 16, kanji: 9, grammar: 3, story: 1, conjugation: 3, component: 11, michikusa: 3, station: 53, pool: 53 });
    expect(m.stations[3]!.counts).toEqual({ kana: 0, vocab: 0, kanji: 8, grammar: 3, story: 1, michikusa: 3 });
    expect(m.stations[3]!.path).toBe('stations/04.json');
  });

  it('listContentFiles excludes manifest, bundles and _meta non-content files', () => {
    const root = corpus();
    writeFileSync(join(root, 'manifest.json'), '{}');
    const files = listContentFiles(root);
    expect(files).toContain('_meta/components.json');
    expect(files).not.toContain('_meta/denylist.json');
    expect(files).not.toContain('manifest.json');
    expect(files.some((f) => f.startsWith('stations/'))).toBe(false);
    expect(files.length).toBe(9);
  });

  it('writeIndex: a second run is byte-identical and keeps generatedAt; a content change refreshes it', () => {
    const root = corpus();
    const first = writeIndex(root, '1.0.0');
    expect(first.changed).toBe(true);
    const text1 = readFileSync(first.path, 'utf8');
    const second = writeIndex(root, '1.0.0');
    expect(second.changed).toBe(false);
    expect(readFileSync(second.path, 'utf8')).toBe(text1);
    expect(second.manifest.generatedAt).toBe(first.manifest.generatedAt);
    // without --version the content hash is used, so the overridden version is replaced
    const third = writeIndex(root);
    expect(third.manifest.contentVersion).toBe(deriveContentVersion(root));
    expect(third.manifest.contentVersion).toMatch(/^c-[0-9a-f]{10}$/);
    expect(third.changed).toBe(true);
    expect(writeIndex(root).changed).toBe(false);
    const p = join(root, 'michikusa/michikusa-s04.json');
    writeFileSync(p, readFileSync(p, 'utf8').replace('Hodogaya was', 'Hodogaya is'));
    const fourth = writeIndex(root, '1.0.0');
    expect(fourth.changed).toBe(true);
    expect(fourth.manifest.files.find((f) => f.path === 'michikusa/michikusa-s04.json')!.sha256).not.toBe(first.manifest.files.find((f) => f.path === 'michikusa/michikusa-s04.json')!.sha256);
  });

  it('fails when a station bundle is missing (unless check is off)', () => {
    const root = corpus();
    rmSync(join(root, 'stations/53.json'));
    expect(() => buildIndex(root, '1.0.0', { generatedAt: AT })).toThrow(/stations\/53\.json/);
    const m = buildIndex(root, '1.0.0', { generatedAt: AT, check: false });
    expect(m.stations.length).toBe(52);
    expect(m.totals.station).toBe(52);
  });

  it('fails when a content file exceeds MAX_FILE_BYTES = 300 KiB', () => {
    expect(MAX_FILE_BYTES).toBe(300 * 1024);
    const root = corpus();
    const p = join(root, 'michikusa/michikusa-s04.json');
    const doc = JSON.parse(readFileSync(p, 'utf8')) as { items: { bodyEn: string }[] };
    doc.items[0]!.bodyEn = 'x'.repeat(MAX_FILE_BYTES + 1);
    writeFileSync(p, JSON.stringify(doc, null, 2) + '\n');
    expect(() => buildIndex(root, '1.0.0', { generatedAt: AT })).toThrow(/over 307200 bytes/);
  });

  it('measures the station entry (bundle item files + components) and warns over the 1 MiB budget', () => {
    expect(STATION_ENTRY_BUDGET_BYTES).toBe(1024 * 1024);
    const root = corpus();
    const m = buildIndex(root, '1.0.0', { generatedAt: AT });
    const sizes = stationEntrySizes(root, m);
    expect(sizes.map((s) => s.number)).toEqual(Array.from({ length: 53 }, (_, i) => i + 1));
    // the fixture's 16 vocab items all fit Station 1's quota; the story sits at Station 4
    expect(sizes.find((s) => s.number === 1)!.files).toContain('vocab/n5/vocab-n5-001.json');
    const s4 = sizes.find((s) => s.number === 4)!;
    expect(s4.files).toContain('stories/n5/stories-s04.json');
    expect(s4.bytes).toBeGreaterThan(0);
    for (const s of sizes) {
      expect(s.files.some((p) => p.startsWith('conjugation/') || p.startsWith('stations/'))).toBe(false);
      expect(s.bytes).toBe(s.files.reduce((n, p) => n + m.files.find((f) => f.path === p)!.bytes, 0));
    }
    const s2 = sizes.find((s) => s.number === 2)!; // places N5 components → components.json is part of the entry
    expect(s2.files).toContain('_meta/components.json');
    expect(oversizeStations(sizes)).toEqual([]);
    const tiny = oversizeStations(sizes, 1000);
    expect(tiny.length).toBeGreaterThan(0);
    expect(tiny[0]).toMatch(/^stations\/0\d\.json: station entry \d+ KB over \d+ files > 1 KB budget/);
    expect(writeIndex(root, '1.0.0', { generatedAt: AT }).warnings).toEqual([]);
    expect(writeIndex(root, '1.0.0', { generatedAt: AT, stationEntryBudget: 1000 }).warnings).toEqual(tiny);
  });

  describe('deriveContentVersion', () => {
    it('is deterministic, has the shape c-<10 hex>, and ignores manifest.json', () => {
      const root = corpus();
      const a = deriveContentVersion(root);
      expect(a).toMatch(/^c-[0-9a-f]{10}$/);
      expect(isDerivedVersion(a)).toBe(true);
      expect(isDerivedVersion('1.0.0')).toBe(false);
      expect(isDerivedVersion('c-xyz')).toBe(false);
      expect(deriveContentVersion(root)).toBe(a);
      writeIndex(root, '1.0.0');
      expect(deriveContentVersion(root)).toBe(a);
      writeFileSync(join(root, 'manifest.json'), '{"anything": 1}');
      expect(deriveContentVersion(root)).toBe(a);
      // the same bytes in a second copy give the same version
      expect(deriveContentVersion(corpus())).toBe(a);
    });

    it('changes when any content file changes: an item file, a station bundle, the denylist', () => {
      const root = corpus();
      const a = deriveContentVersion(root);
      const p = join(root, 'michikusa/michikusa-s04.json');
      writeFileSync(p, readFileSync(p, 'utf8').replace('Hodogaya was', 'Hodogaya is'));
      const b = deriveContentVersion(root);
      expect(b).not.toBe(a);
      const bundle = join(root, 'stations/53.json');
      writeFileSync(bundle, readFileSync(bundle, 'utf8') + '\n');
      const c = deriveContentVersion(root);
      expect(c).not.toBe(b);
      const deny = join(root, '_meta/denylist.json');
      writeFileSync(deny, readFileSync(deny, 'utf8').replace('Totoro', 'Catbus'));
      const d = deriveContentVersion(root);
      expect(d).not.toBe(c);
      // a byte-identical restore returns the earlier version (the hash is over bytes, not mtimes)
      writeFileSync(deny, readFileSync(deny, 'utf8').replace('Catbus', 'Totoro'));
      expect(deriveContentVersion(root)).toBe(c);
    });

    it('writeIndex stamps the derived version unless --version overrides it, and a content change moves it', () => {
      const root = corpus();
      const first = writeIndex(root);
      expect(first.manifest.contentVersion).toBe(deriveContentVersion(root));
      expect(writeIndex(root).changed).toBe(false);
      const p = join(root, 'michikusa/michikusa-s04.json');
      writeFileSync(p, readFileSync(p, 'utf8').replace('Hodogaya was', 'Hodogaya is'));
      const second = writeIndex(root);
      expect(second.changed).toBe(true);
      expect(second.manifest.contentVersion).not.toBe(first.manifest.contentVersion);
      expect(second.manifest.contentVersion).toBe(deriveContentVersion(root));
      const forced = writeIndex(root, '2026.10.1');
      expect(forced.manifest.contentVersion).toBe('2026.10.1');
    });
  });

  it('reads redirects from _meta/redirects.json sorted by key', () => {
    const root = corpus();
    writeFileSync(join(root, '_meta/redirects.json'), JSON.stringify({ 'v-n5-9999': 'v-n5-0001', 'v-n5-0999': 'v-n5-0002' }));
    const m = buildIndex(root, '1.0.0', { generatedAt: AT });
    expect(Object.keys(m.redirects)).toEqual(['v-n5-0999', 'v-n5-9999']);
    expect(listContentFiles(root)).not.toContain('_meta/redirects.json');
    expect(existsSync(join(root, '_meta/redirects.json'))).toBe(true);
  });

  /* ── design 08 §4–§5: listening pools in the manifest, V44 in the default check ── */

  it('lists the 53 pool files as type pool with stations [NN] and count = refs; totals.pool = 53; station counts and entries exclude pools', () => {
    const root = corpus();
    const m = buildIndex(root, '1.0.0', { generatedAt: AT });
    const pools = m.files.filter((f) => f.type === 'pool');
    expect(pools.map((f) => f.path)).toEqual(Array.from({ length: 53 }, (_, i) => `listening/pool-${String(i + 1).padStart(2, '0')}.json`));
    expect(listPoolFiles(root)).toEqual(pools.map((f) => f.path));
    const p4 = pools.find((f) => f.path === 'listening/pool-04.json')!;
    expect(p4).toMatchObject({ type: 'pool', level: null, stations: [4], belts: ['yellow'] });
    const onDisk = JSON.parse(readFileSync(join(root, p4.path), 'utf8')) as { refs: unknown[] };
    expect(p4.count).toBe(onDisk.refs.length);
    expect(p4.count).toBeGreaterThan(0);
    expect(p4.bytes).toBe(statSync(join(root, p4.path)).size);
    expect(m.totals.pool).toBe(53);
    expect(Object.keys(m.stations[3]!.counts)).not.toContain('pool');
    expect(listContentFiles(root).some((p) => p.startsWith('listening/'))).toBe(false);
    for (const s of stationEntrySizes(root, m)) expect(s.files.some((p) => p.startsWith('listening/'))).toBe(false);
    expect(m.files.map((f) => f.path)).toEqual([...m.files.map((f) => f.path)].sort());
    expect(POOL_FILE_BUDGET_BYTES).toBe(256 * 1024);
    expect(oversizePools(root, m)).toEqual([]);
    expect(oversizePools(root, m, 100)).toEqual(expect.arrayContaining([expect.stringMatching(/^listening\/pool-04\.json: \d+ bytes \(\d+ (?:KiB|bytes)\) > POOL_FILE_BUDGET_BYTES 100 bytes \(\d+ refs with their kana — a pool file is ≤ 100 bytes, design 08 §4\)$/)]));
    expect(writeIndex(root, '1.0.0', { generatedAt: AT }).warnings).toEqual([]);
  });

  it('the pool budget is a HARD limit (lead decision, wave B): a pool file over it fails the default check with a BuildIndexError naming the file and its bytes; check: false only warns', () => {
    const root = corpus();
    const p4 = statSync(join(root, 'listening/pool-04.json')).size;
    expect(p4).toBeGreaterThan(100);
    let err: unknown;
    try {
      buildIndex(root, '1.0.0', { generatedAt: AT, poolFileBudget: 100 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BuildIndexError);
    expect((err as Error).message).toMatch(/^listening pool file\(s\) over the 100-byte budget \(a pool file is ≤ 100 bytes; /);
    expect((err as Error).message).toContain(`listening/pool-04.json: ${p4} bytes`);
    expect((err as BuildIndexError).findings).toEqual([]);
    expect(() => buildIndex(root, '1.0.0', { generatedAt: AT, poolFileBudget: 100, check: false })).not.toThrow();
    const w = writeIndex(root, '1.0.0', { generatedAt: AT, poolFileBudget: 100, check: false }).warnings;
    expect(w.some((line) => line.startsWith(`listening/pool-04.json: ${p4} bytes`))).toBe(true);
    // the shipped budget holds on the fixture corpus
    expect(() => buildIndex(root, '1.0.0', { generatedAt: AT })).not.toThrow();
  });

  it('V44: the default check regenerates the pools and throws rows when a pool file is edited by hand or missing; check: false does not; deriveContentVersion moves with a pool', () => {
    const root = corpus();
    const rel = 'listening/pool-04.json';
    const p = join(root, rel);
    const original = readFileSync(p, 'utf8');
    const before = deriveContentVersion(root);
    expect(() => buildIndex(root, '1.0.0', { generatedAt: AT })).not.toThrow();
    expect(checkPools(root, bundlesFromCorpus(root))).toEqual([]);
    writeFileSync(p, original.replace('"morae": ', '"morae": 9'));
    let err: unknown;
    try {
      buildIndex(root, '1.0.0', { generatedAt: AT });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BuildIndexError);
    expect((err as Error).message).toMatch(/^V44: 1 listening pool finding/);
    expect((err as BuildIndexError).findings).toEqual([{ file: rel, rule: 'V44', message: expect.stringMatching(/does not regenerate byte-identically/) }]);
    expect(checkPools(root, bundlesFromCorpus(root))).toEqual((err as BuildIndexError).findings);
    expect(buildIndex(root, '1.0.0', { generatedAt: AT, check: false }).totals.pool).toBe(53);
    expect(deriveContentVersion(root)).not.toBe(before);
    writeFileSync(p, original);
    expect(deriveContentVersion(root)).toBe(before);
    rmSync(p);
    try {
      buildIndex(root, '1.0.0', { generatedAt: AT });
    } catch (e) {
      err = e;
    }
    expect((err as BuildIndexError).findings).toEqual([{ file: rel, rule: 'V44', message: expect.stringMatching(/missing/) }]);
    expect(buildIndex(root, '1.0.0', { generatedAt: AT, check: false }).totals.pool).toBe(52);
    // a pool nothing generates is reported too
    writeFileSync(p, original);
    writeFileSync(join(root, 'listening/pool-53.json'), original.replace('"station": 4', '"station": 53'));
    rmSync(join(root, 'stations/53.json'));
    const rows = checkPools(root, bundlesFromCorpus(root).filter((b) => b.number !== 53));
    expect(rows).toEqual([{ file: 'listening/pool-53.json', rule: 'V44', message: expect.stringMatching(/unexpected pool file/) }]);
  });

  it('a listening-s07.json story file is listed with stations [7] beside stories-s07.json, exactly like it, and its linked lines feed pool-07', () => {
    const root = mkdtempSync(join(tmpdir(), 'tsuzuku-index-'));
    tmps.push(root);
    cpSync(GOOD, root, { recursive: true });
    const text = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      stationId: 'st-07',
      titleJa: '{水|みず}',
      titleEn: 'Water',
      kind: 'story',
      register: 'polite',
      lines: [{ ja: '{水|みず}です。', kana: 'みずです。', en: 'Water.', tokens: ['水', 'です', '。'] }],
      vocabIds: ['v-n5-0008'],
      grammarIds: [],
      comprehension: [],
      recapEn: 'Water.',
      ...extra,
    });
    mkdirSync(join(root, 'stories/n5'), { recursive: true });
    writeFileSync(join(root, 'stories/n5/stories-s07.json'), JSON.stringify({ schema: 'tsuzuku.content/1', type: 'story', level: 'n5', items: [text('s-07-1')] }, null, 2) + '\n');
    writeFileSync(join(root, 'stories/n5/listening-s07.json'), JSON.stringify({ schema: 'tsuzuku.content/1', type: 'story', level: 'n5', items: [text('s-07-4', { genre: 'exchange', audioFirst: true, narrator: 'ハナ' })] }, null, 2) + '\n');
    const allow = mkdtempSync(join(tmpdir(), 'tsuzuku-allow-'));
    tmps.push(allow);
    assign(root, PLAN, { write: true, allowlistsDir: allow });
    const m = buildIndex(root, '1.0.0', { generatedAt: AT });
    const a = m.files.find((f) => f.path === 'stories/n5/stories-s07.json')!;
    const b = m.files.find((f) => f.path === 'stories/n5/listening-s07.json')!;
    expect(a).toMatchObject({ type: 'story', level: 'n5', count: 1, stations: [7], belts: ['yellow'] });
    expect(b).toMatchObject({ type: 'story', level: 'n5', count: 1, stations: [7], belts: ['yellow'] });
    expect(m.totals.story).toBe(3);
    expect(m.stations[6]!.counts.story).toBe(2);
    const pool7 = JSON.parse(readFileSync(join(root, 'listening/pool-07.json'), 'utf8')) as { refs: { ref: string; ids: string[] }[] };
    expect(pool7.refs.map((r) => r.ref)).toEqual(['s-07-1#L0', 's-07-4#L0']);
    expect(pool7.refs[1]!.ids).toEqual(['v-n5-0008']);
    expect(m.files.find((f) => f.path === 'listening/pool-07.json')!.count).toBe(2);
  });
});
