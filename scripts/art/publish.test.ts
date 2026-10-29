import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publish, publishCommands, verifyAssets } from './publish.ts';
import { buildPointer, emptyPointer, sha256Hex } from './schema.ts';

describe('publish — the gh plan and the dry run', () => {
  let tmp = '';
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tsuzuku-art-publish-'));
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('publishCommands creates art-<artVersion> with the credit in the notes and uploads the tar with --clobber; the placeholder has no release', () => {
    const pointer = buildPointer('p-0123456789', { sha256: 'c'.repeat(64), bytes: 7 });
    const plan = publishCommands(pointer, '/assets');
    expect(plan.tag).toBe('art-p-0123456789');
    expect(plan.repo).toBe('sunkencity999/tsuzuku');
    expect(plan.create.slice(0, 8)).toEqual(['gh', 'release', 'create', 'art-p-0123456789', '--repo', 'sunkencity999/tsuzuku', '--title', 'Print pack p-0123456789']);
    expect(plan.create[9]).toContain('- Art Institute of Chicago · CC0');
    expect(plan.create[9]).toContain('tsuzuku-art-p-0123456789.tar — prints, 7 bytes, sha256 ' + 'c'.repeat(64));
    expect(plan.upload).toEqual(['gh', 'release', 'upload', 'art-p-0123456789', '/assets/tsuzuku-art-p-0123456789.tar', '--repo', 'sunkencity999/tsuzuku', '--clobber']);
    expect(publishCommands(pointer, '/assets', 'other/repo').repo).toBe('other/repo');
    expect(() => publishCommands(emptyPointer(), '/assets')).toThrow(/names no release \(run art:pack first\)/);
  });

  it('verifyAssets wants the tar present with the pointer bytes and sha256; publish is a dry run unless --yes and exits 1 on a mismatch', () => {
    const tar = Buffer.from('fake art tar');
    const pointer = buildPointer('p-0123456789', { sha256: sha256Hex(tar), bytes: tar.length });
    expect(verifyAssets(pointer, tmp)).toEqual(['tsuzuku-art-p-0123456789.tar: missing in ' + tmp]);
    writeFileSync(join(tmp, 'tsuzuku-art-p-0123456789.tar'), tar);
    expect(verifyAssets(pointer, tmp)).toEqual([]);
    expect(verifyAssets({ ...pointer, assets: [{ ...pointer.assets[0]!, bytes: 1 }] }, tmp)).toEqual(['tsuzuku-art-p-0123456789.tar: 12 bytes, pointer says 1']);
    expect(verifyAssets({ ...pointer, assets: [{ ...pointer.assets[0]!, sha256: 'f'.repeat(64) }] }, tmp)).toEqual(['tsuzuku-art-p-0123456789.tar: sha256 differs from the pointer']);
    const pointerPath = join(tmp, 'art-pack.json');
    writeFileSync(pointerPath, JSON.stringify(pointer));
    const log: string[] = [];
    expect(publish({ pointerPath, assetsDir: tmp, yes: false, log: (l) => log.push(l) })).toBe(0);
    expect(log[0]).toBe('DRY RUN — release art-p-0123456789 on sunkencity999/tsuzuku:');
    expect(log[1]).toMatch(/^ {2}gh release create art-p-0123456789 --repo sunkencity999\/tsuzuku --title 'Print pack p-0123456789' --notes '/);
    expect(log[2]).toBe(`  gh release upload art-p-0123456789 ${join(tmp, 'tsuzuku-art-p-0123456789.tar')} --repo sunkencity999/tsuzuku --clobber`);
    expect(log.at(-1)).toMatch(/nothing was published/);
    writeFileSync(pointerPath, JSON.stringify({ ...pointer, assets: [{ ...pointer.assets[0]!, sha256: 'f'.repeat(64) }] }));
    const bad: string[] = [];
    expect(publish({ pointerPath, assetsDir: tmp, yes: true, log: (l) => bad.push(l) })).toBe(1);
    expect(bad).toEqual(['publish: tsuzuku-art-p-0123456789.tar: sha256 differs from the pointer']);
  });
});
