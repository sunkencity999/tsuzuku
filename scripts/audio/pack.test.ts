import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AudioManifest, assetName, PACK_REPO, releaseTag } from './indexes.ts';
import { buildPointer, emptyPointer, pack, tarPaths, tiersOf } from './pack.ts';

const here = dirname(fileURLToPath(import.meta.url));

const manifestOf = (over: Partial<AudioManifest> = {}): AudioManifest => ({
  schema: 'tsuzuku.audio/1',
  audioVersion: 'a-0123456789',
  contentVersion: 'c-f1x7ure0001',
  engine: 'VOICEVOX 0.25.2',
  dictVersion: 'd-0000000000',
  castSha: 'x',
  tiers: ['core', 'pool'],
  generatedAt: '2026-10-17T00:00:00.000Z',
  dryRun: false,
  partial: null,
  voices: {},
  belts: {},
  files: [
    { path: 'sprites/s04/words-01-11111111.webm', bytes: 100, seconds: 1, clips: 1, belt: 'yellow', tier: 'core' },
    { path: 'sprites/s04/examples-01-22222222.webm', bytes: 200, seconds: 2, clips: 1, belt: 'yellow', tier: 'pool' },
  ],
  indexes: [
    { path: 'a-0123456789/n5/words.json', bytes: 10, sha256: 'a' },
    { path: 'a-0123456789/files.json', bytes: 10, sha256: 'b' },
    { path: 'a-0123456789/kana.json', bytes: 10, sha256: 'c' },
  ],
  totals: { bytes: 300, seconds: 3, files: 2, clips: 2 },
  render: { rendered: 2, cached: 0, skipped: 0, reused: 0 },
  changedClipShare: 1,
  contentDiffShare: null,
  skipped: 0,
  credits: ['VOICEVOX:九州そら'],
  reusedBytesShare: null,
  ...over,
});

describe('pack — tar contents and the pointer', () => {
  it('the core tar carries the manifest and every index (sidecars included) beside its sprites; other tiers carry their sprites only', () => {
    const m = manifestOf();
    expect(tarPaths(m, 'core')).toEqual(['a-0123456789/files.json', 'a-0123456789/kana.json', 'a-0123456789/n5/words.json', 'manifest.json', 'sprites/s04/words-01-11111111.webm']);
    expect(tarPaths(m, 'pool')).toEqual(['sprites/s04/examples-01-22222222.webm']);
    expect(tiersOf(m)).toEqual(['core', 'pool']);
    expect(tiersOf(manifestOf({ files: [] }))).toEqual(['core']);
  });

  it('buildPointer names the tag and the sorted assets with the credits; emptyPointer is the committed placeholder shape', () => {
    const p = buildPointer(manifestOf(), [
      { tier: 'pool', name: assetName('a-0123456789', 'pool'), sha256: 'p', bytes: 2 },
      { tier: 'core', name: assetName('a-0123456789', 'core'), sha256: 'c', bytes: 1 },
    ]);
    expect(p).toEqual({ schema: 'tsuzuku.audio-pack/1', repo: PACK_REPO, audioVersion: 'a-0123456789', tag: releaseTag('a-0123456789'), assets: [{ tier: 'core', name: 'tsuzuku-audio-a-0123456789-core.tar', sha256: 'c', bytes: 1 }, { tier: 'pool', name: 'tsuzuku-audio-a-0123456789-pool.tar', sha256: 'p', bytes: 2 }], credits: ['VOICEVOX:九州そら'] });
    expect(emptyPointer()).toEqual({ schema: 'tsuzuku.audio-pack/1', repo: PACK_REPO, audioVersion: null, tag: null, assets: [], credits: [] });
    expect(JSON.parse(readFileSync(join(here, '..', '..', 'public', 'audio-pack.json'), 'utf8'))).toEqual(emptyPointer());
  });
});

describe('pack — refuses what must never ship', () => {
  let tmp = '';
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tsuzuku-pack-'));
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  const withManifest = (name: string, m: AudioManifest): string => {
    const dir = join(tmp, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));
    return dir;
  };

  it('a dry-run manifest and a partial manifest (--stations / --limit) are refused before any tar runs; a missing manifest too', () => {
    const tarLog = join(tmp, 'tar.log');
    const tar = join(tmp, 'tar.sh');
    writeFileSync(tar, `#!/bin/sh\necho called >> ${tarLog}\n`, { mode: 0o755 });
    const o = (audioDir: string) => ({ audioDir, outDir: join(tmp, 'out'), pointerPath: join(tmp, 'pointer.json'), tar, log: () => {} });
    expect(() => pack(o(withManifest('dry', manifestOf({ dryRun: true }))))).toThrow(/dry run/);
    expect(() => pack(o(withManifest('stations', manifestOf({ partial: { stations: [1, 17] } }))))).toThrow(/partial render.*stations/);
    expect(() => pack(o(withManifest('limit', manifestOf({ partial: { limit: 50 } }))))).toThrow(/partial render.*limit/);
    expect(() => pack(o(join(tmp, 'nowhere')))).toThrow(/run audio:render first/);
    // A complete real manifest whose files are missing on disk is refused too (nothing half-packed).
    expect(() => pack(o(withManifest('missing', manifestOf())))).toThrow(/missing on disk/);
    expect(existsSync(tarLog)).toBe(false);
  });
});
