import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPointer, emptyPointer, pack, tarPaths } from './pack.ts';
import { type ArtManifest, type ArtPackPointer, assetName, PACK_REPO, releaseTag, sha256Hex } from './schema.ts';
import { FIXTURE_VERSION, fixturePack, writeFixturePack } from './__fixtures__/pack.ts';

const here = dirname(fileURLToPath(import.meta.url));

describe('pack — tar contents and the pointer', () => {
  it('tarPaths is the manifest and every print, sorted', () => {
    const { manifest } = fixturePack();
    const paths = tarPaths(manifest);
    expect(paths).toHaveLength(56);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toContain('manifest.json');
    expect(paths.filter((p) => /^prints\/fix-\d\d-station-[0-9a-f]{8}\.webp$/.test(p))).toHaveLength(55);
  });

  it('public/art-pack.json is the placeholder or a well-formed release pointer', () => {
    const committed = JSON.parse(readFileSync(join(here, '..', '..', 'public', 'art-pack.json'), 'utf8')) as ArtPackPointer;
    expect(committed.schema).toBe('tsuzuku.art-pack/1');
    expect(committed.repo).toBe(PACK_REPO);
    if (committed.artVersion === null) {
      expect(committed).toEqual(emptyPointer());
    } else {
      expect(committed.artVersion).toMatch(/^p-[0-9a-f]{10}$/);
      expect(committed.tag).toBe(releaseTag(committed.artVersion));
      expect(committed.assets).toEqual([{ tier: 'prints', name: assetName(committed.artVersion), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown as string, bytes: expect.any(Number) as unknown as number }]);
      expect(committed.credits).toContain('Art Institute of Chicago · CC0');
    }
  });
});

describe('pack — a whole pack tars; a partial one is refused', () => {
  let tmp = '';
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tsuzuku-art-pack-'));
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('packs the fixture pack with the system tar: the tar lists exactly tarPaths, the pointer carries its sha256 and bytes', () => {
    const fx = fixturePack();
    const art = join(tmp, 'art');
    writeFixturePack(art, fx);
    const out = join(tmp, 'release');
    const pointerPath = join(tmp, 'art-pack.json');
    const log: string[] = [];
    const pointer = pack({ artDir: art, outDir: out, pointerPath, log: (l) => log.push(l) });
    const tarPath = join(out, assetName(FIXTURE_VERSION));
    expect(existsSync(tarPath)).toBe(true);
    const bytes = readFileSync(tarPath);
    expect(pointer).toEqual(buildPointer(FIXTURE_VERSION, { sha256: sha256Hex(bytes), bytes: bytes.length }));
    expect(JSON.parse(readFileSync(pointerPath, 'utf8'))).toEqual(pointer);
    const listed = spawnSync('tar', ['-tf', tarPath], { encoding: 'utf8' }).stdout.trim().split('\n').sort();
    expect(listed).toEqual(tarPaths(fx.manifest));
    expect(log[0]).toMatch(/^tsuzuku-art-p-0123456789\.tar: 56 files, /);
    expect(log[1]).toContain('tag art-p-0123456789, 1 asset, 1 credit');
  });

  it('refuses a missing manifest, a partial manifest (prints the tables name are absent; a station gap) and a file missing on disk — before any tar runs', () => {
    const tarLog = join(tmp, 'tar.log');
    const tar = join(tmp, 'tar.sh');
    writeFileSync(tar, `#!/bin/sh\necho called >> ${tarLog}\n`, { mode: 0o755 });
    const fx = fixturePack();
    const o = (artDir: string) => ({ artDir, outDir: join(tmp, 'out2'), pointerPath: join(tmp, 'pointer2.json'), tar, log: () => {} });
    expect(() => pack(o(join(tmp, 'nowhere')))).toThrow(/run art:source first/);
    const partial = join(tmp, 'partial');
    const m = JSON.parse(JSON.stringify(fx.manifest)) as ArtManifest;
    m.prints = m.prints.slice(0, 10); // what a --only / --limit run writes: full tables, some prints
    writeFixturePack(partial, fx, m);
    expect(() => pack(o(partial))).toThrow(/not a whole pack[\s\S]*stations: station 10 names unknown print/);
    const gap = join(tmp, 'gap');
    const g = JSON.parse(JSON.stringify(fx.manifest)) as ArtManifest;
    delete g.stations['3'];
    writeFixturePack(gap, fx, g);
    expect(() => pack(o(gap))).toThrow(/station 3 missing/);
    const missing = join(tmp, 'missing');
    writeFixturePack(missing, fx);
    rmSync(join(missing, fx.manifest.prints[2]!.file));
    expect(() => pack(o(missing))).toThrow(/missing on disk/);
    expect(existsSync(tarLog)).toBe(false);
  });
});
