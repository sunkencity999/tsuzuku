import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkArt, NONE_MESSAGE } from './check-art.ts';
import type { ArtManifest } from './schema.ts';
import { fixturePack, writeFixturePack } from './__fixtures__/pack.ts';

const fails = (r: ReturnType<typeof checkArt>): string[] => r.findings.filter((f) => f.level === 'fail').map((f) => f.message);

describe('check-art', () => {
  let tmp = '';
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tsuzuku-art-check-'));
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('no manifest: the none message, exit 0 with --optional and 1 without', () => {
    const log: string[] = [];
    expect(checkArt({ artDir: join(tmp, 'none'), optional: true, log: (l) => log.push(l) }).code).toBe(0);
    expect(log).toEqual([NONE_MESSAGE]);
    expect(NONE_MESSAGE).toBe('art pack: none — the drawn room stands');
    expect(checkArt({ artDir: join(tmp, 'none'), optional: false, log: () => {} }).code).toBe(1);
  });

  it('a whole fixture pack passes (55 prints of the three header kinds, every file hashed and measured)', () => {
    const pack = fixturePack();
    const dir = join(tmp, 'ok');
    writeFixturePack(dir, pack);
    const log: string[] = [];
    const r = checkArt({ artDir: dir, optional: false, log: (l) => log.push(l) });
    expect(fails(r)).toEqual([]);
    expect(r.code).toBe(0);
    expect(log[0]).toMatch(/^info: pack p-0123456789 \(2026-10-28T00:00:00\.000Z\), 55 prints$/);
    expect(log.some((l) => /55 prints on disk/.test(l))).toBe(true);
    expect(log.at(-1)).toBe('art:check — ok (0 warnings)');
  });

  it('a missing file, a wrong sha256, a wrong byte count, a header that disagrees, a missing station and a long lqip each fail on their own line', () => {
    const pack = fixturePack();
    const clone = (): ArtManifest => JSON.parse(JSON.stringify(pack.manifest)) as ArtManifest;
    const check = (dir: string): ReturnType<typeof checkArt> => checkArt({ artDir: dir, optional: true, log: () => {} });
    const p4 = pack.manifest.prints[4]!;
    const p5 = pack.manifest.prints[5]!;

    let dir = join(tmp, 'missing');
    writeFixturePack(dir, pack);
    rmSync(join(dir, p4.file));
    let r = check(dir);
    expect(r.code).toBe(1);
    expect(fails(r)).toEqual([`${p4.file} named by the manifest is missing`]);

    dir = join(tmp, 'sha');
    writeFixturePack(dir, pack);
    const flipped = Buffer.from(pack.files.get(p5.file) as Buffer);
    flipped[flipped.length - 1] ^= 0xff; // same length, same header, other bytes
    writeFileSync(join(dir, p5.file), flipped);
    expect(fails(check(dir))).toEqual([`${p5.file}: sha256 differs from the manifest`]);

    dir = join(tmp, 'bytes');
    writeFixturePack(dir, pack);
    writeFileSync(join(dir, p5.file), Buffer.concat([pack.files.get(p5.file) as Buffer, Buffer.from([1])]));
    expect(fails(check(dir))).toEqual([`${p5.file}: ${p5.bytes + 1} bytes, manifest says ${p5.bytes}`]);

    dir = join(tmp, 'dims');
    let m = clone();
    m.prints[6]!.width = 41; // the file's header still says 40 × 25
    writeFixturePack(dir, pack, m);
    expect(fails(check(dir))).toEqual([`${m.prints[6]!.file}: header says 40×25, manifest says 41×25`]);

    dir = join(tmp, 'station');
    m = clone();
    delete m.stations['12'];
    writeFixturePack(dir, pack, m);
    expect(fails(check(dir))).toEqual(['stations: station 12 missing']);

    dir = join(tmp, 'lqip');
    m = clone();
    m.prints[7]!.lqip = `data:image/webp;base64,${'A'.repeat(1000)}`;
    writeFixturePack(dir, pack, m);
    expect(fails(check(dir))).toEqual([expect.stringMatching(/lqip is 1023 chars, over 1000/)]);

    dir = join(tmp, 'calendar');
    m = clone();
    m.calendar.night = m.calendar.night.slice(0, 11);
    writeFixturePack(dir, pack, m);
    expect(fails(check(dir))).toEqual(['calendar.night has 11 entries, needs 12']);

    dir = join(tmp, 'json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), '{');
    const broken = check(dir);
    expect(broken.code).toBe(1);
    expect(fails(broken)[0]).toMatch(/not valid JSON/);
  });
});
