import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadableStream } from 'node:stream/web';
import type { FetchLike } from '../audio/fetch-audio-pack.ts';
import { type CurationEntry, type CurationFile, ENCODE, encoderString, KO_COUNT, manifestProblems, MONTH_COUNT, printFile, sha256Hex, STATION_COUNT } from './schema.ts';
import { type AicRecord, type CurationInput, type SourceOptions, cwebpArgs, ensureRaw, imageUrl, IMAGE_USER_AGENT, mergeCuration, pool, rawName, recordProblems, recordUrl, sourcePrints, tableGaps, USER_AGENT } from './source-prints.ts';
import { fakeWebp, fixtureId } from './__fixtures__/pack.ts';

/* ── curation fixtures (ASCII placeholders; the real titles live in scripts/art/curation) ── */

const tri = (s: string) => ({ ja: `${s}-ja`, reading: `${s} reading`, en: `${s} (en)` });
const SERIES = { fix: { ...tri('series'), artist: tri('artist'), date: 'c. 1833' } };
const entry = (n: number, over: Partial<CurationEntry> = {}): CurationEntry => ({ id: fixtureId(n), aicId: 1000 + n, title: tri(`station ${n}`), series: 'fix', focus: [0.5, 0.4], roles: { station: n }, why: `fixture ${n}`, ...over });
const file = (name: string, json: Partial<CurationFile>): CurationInput => ({ name, json: { schema: 'tsuzuku.art-curation/1', series: SERIES, entries: [], ...json } });
const nulls = (n: number): (string | null)[] => Array.from({ length: n }, () => null);
const range = (n: number, from = 0): number[] => Array.from({ length: n }, (_, i) => i + from);
/** The canned museum's image_id for an object: eight digits of the id, then a tail that names the scan. */
const scan = (aicId: number, tail = '0000-0000-0000-000000000000'): string => `${String(aicId).padStart(8, '0')}-${tail}`;
const RESCAN = '1111-1111-1111-111111111111';

/** A whole curation: 55 stations in two files, print 0 serving every kō and every month. */
function wholeCuration(): CurationInput[] {
  return [file('a.json', { entries: [entry(0, { roles: { station: 0, kos: range(KO_COUNT), nightMonths: range(MONTH_COUNT, 1) } }), ...range(49, 1).map((n) => entry(n))] }), file('b.json', { entries: range(5, 50).map((n) => entry(n)) })];
}

describe('source-prints — merging the curation', () => {
  it('merges files: entries sorted by id, stations and calendar from the roles, an explicit calendar laid over the gaps, the hash independent of authoring order and of `why`', () => {
    const day = nulls(KO_COUNT);
    day[2] = fixtureId(3);
    const night = nulls(MONTH_COUNT);
    night[1] = fixtureId(4);
    const a = file('a.json', { entries: [entry(2), entry(0, { roles: { station: 0, kos: [0, 1], nightMonths: [1] } }), entry(1)] });
    const b = file('b.json', { entries: [entry(3), entry(4)], calendar: { day, night } });
    const m = mergeCuration([a, b]);
    expect(m.entries.map((e) => e.id)).toEqual(range(5).map(fixtureId));
    expect(m.stations).toEqual(Object.fromEntries(range(5).map((n) => [String(n), fixtureId(n)])));
    expect(m.calendar.day.slice(0, 4)).toEqual([fixtureId(0), fixtureId(0), fixtureId(3), null]);
    expect(m.calendar.night.slice(0, 3)).toEqual([fixtureId(0), fixtureId(4), null]);
    const gaps = tableGaps(m);
    expect(gaps).toHaveLength(50 + 69 + 10);
    expect(gaps[0]).toBe('station 5');
    expect(gaps).toContain('kō 3');
    expect(gaps).toContain('month 3');
    // the same curation written in another order hashes the same; so does one whose `why` (shipped nowhere) was edited — a focus or a title moves it
    const a2 = file('a.json', { entries: [entry(0, { roles: { station: 0, nightMonths: [1], kos: [0, 1] } }), entry(1), entry(2)] });
    expect(mergeCuration([a2, b]).json).toBe(m.json);
    const bWith = (over: Partial<CurationEntry>): CurationInput => file('b.json', { entries: [entry(3), entry(4, over)], calendar: { day, night } });
    expect(mergeCuration([a, bWith({ why: 'another reason' })]).json).toBe(m.json);
    expect(mergeCuration([a, bWith({ focus: [0.5, 0.5] })]).json).not.toBe(m.json);
    expect(mergeCuration([a, bWith({ title: tri('renamed') })]).json).not.toBe(m.json);
    expect(m.json).not.toContain('"why"');
    expect(tableGaps(mergeCuration(wholeCuration()))).toEqual([]);
  });

  it('refuses a duplicate id, a series that differs between files, an unknown series, two prints on one station / kō, a bad table and a malformed entry — every problem listed', () => {
    const throwsWith = (files: CurationInput[], re: RegExp): void => expect(() => mergeCuration(files)).toThrow(re);
    throwsWith([file('a.json', { entries: [entry(1)] }), file('b.json', { entries: [entry(1, { aicId: 5 })] })], /b\.json entry "fix-01-station": duplicate id \(also in a\.json\)/);
    throwsWith([file('a.json', { entries: [entry(1)] }), file('b.json', { series: { fix: { ...SERIES.fix, date: 'c. 1834' } }, entries: [entry(2)] })], /b\.json: series fix differs from a\.json/);
    throwsWith([file('a.json', { entries: [entry(1, { series: 'nope' })] })], /entry fix-01-station: unknown series "nope"/);
    throwsWith([file('a.json', { entries: [entry(3), entry(4, { roles: { station: 3 } })] })], /station 3: claimed by fix-03-station \(a\.json entry "fix-03-station"\) and fix-04-station/);
    throwsWith([file('a.json', { entries: [entry(3, { roles: { kos: [5] } }), entry(4, { roles: { kos: [5] } })] })], /kō 5: claimed by fix-03-station .* and fix-04-station/);
    throwsWith([file('a.json', { entries: [entry(3, { roles: { nightMonths: [2] } }), entry(4, { roles: { nightMonths: [2] } })] })], /month − 1 1: claimed by/);
    const day = nulls(KO_COUNT);
    day[0] = fixtureId(4);
    throwsWith([file('a.json', { entries: [entry(3, { roles: { kos: [0] } }), entry(4)], calendar: { day } })], /kō 0: claimed by fix-03-station \(a\.json entry "fix-03-station" roles\.kos\) and fix-04-station \(a\.json calendar\.day\)/);
    throwsWith([file('a.json', { entries: [entry(3)], calendar: { day: nulls(3) } })], /a\.json: calendar\.day has 3 entries, needs 72/);
    const ghost = nulls(MONTH_COUNT);
    ghost[0] = 'ghost';
    throwsWith([file('a.json', { entries: [entry(3)], calendar: { night: ghost } })], /calendar\.night\[0\] \(a\.json calendar\.night\) names unknown print "ghost"/);
    throwsWith([{ name: 'x.json', json: { schema: 'tsuzuku.art/1' } as unknown as CurationFile }], /x\.json: schema is not tsuzuku\.art-curation\/1/);
    let caught = '';
    try {
      mergeCuration([file('a.json', { entries: [entry(3, { focus: [2, 0], roles: { station: 55 }, why: '' })] })]);
    } catch (e) {
      caught = (e as Error).message;
    }
    expect(caught).toMatch(/focus is not \[x, y\] in 0\.\.1/);
    expect(caught).toMatch(/roles\.station 55 is not 0\.\.54/);
    expect(caught).toMatch(/why missing/);
  });
});

describe('source-prints — the museum record, the URLs, the encoder command', () => {
  it('recordProblems: public domain with an image, an accession and a credit line, or it cannot ship', () => {
    const good = { id: 10926, title: 'Mishima', artist_title: 'Utagawa Hiroshige', date_display: 'c. 1833/34', credit_line: 'Gift of H. R. Warner', main_reference_number: '1932.170', image_id: 'c047003a-949c-a581-7c5a-2c415e8cac75', is_public_domain: true, dimensions: '24.3 × 37.5 cm' };
    expect(recordProblems(good, 10926)).toEqual([]);
    expect(recordProblems({ ...good, is_public_domain: false }, 10926)).toEqual(['AIC 10926: is_public_domain is false — not CC0, cannot ship']);
    expect(recordProblems({ ...good, image_id: null }, 10926)).toEqual(['AIC 10926: no image_id']);
    expect(recordProblems({ ...good, main_reference_number: null, credit_line: '' }, 10926)).toEqual(['AIC 10926: no main_reference_number (accession)', 'AIC 10926: no credit_line']);
    expect(recordProblems({ ...good, id: 1 }, 10926)[0]).toMatch(/the record says id 1/);
    expect(recordProblems(null, 1)).toEqual(['AIC 1: no record']);
  });

  it('the API URL names the fields, the IIIF URL asks for full/1600, the raw is named by object, scan and width, and cwebp gets exactly the documented arguments; two user agents', () => {
    expect(recordUrl(10926)).toBe('https://api.artic.edu/api/v1/artworks/10926?fields=id,title,artist_title,date_display,credit_line,main_reference_number,image_id,is_public_domain,dimensions');
    expect(imageUrl('c047003a-949c-a581-7c5a-2c415e8cac75')).toBe('https://www.artic.edu/iiif/2/c047003a-949c-a581-7c5a-2c415e8cac75/full/1600,/0/default.jpg');
    expect(rawName(10926, 'c047003a-949c-a581-7c5a-2c415e8cac75')).toBe('10926-c047003a-949c-a581-7c5a-2c415e8cac75-1600.jpg');
    expect(rawName(10926, 'c047003a-949c-a581-7c5a-2c415e8cac75', 2000)).toBe('10926-c047003a-949c-a581-7c5a-2c415e8cac75-2000.jpg');
    expect(cwebpArgs('in.jpg', 'out.webp', 82, 1400)).toEqual(['-quiet', '-q', '82', '-m', '6', '-resize', '1400', '0', 'in.jpg', '-o', 'out.webp']);
    expect(ENCODE).toEqual({ method: 6, sourceWidth: 1600, lqipQuality: 40, longSide: true }); // the -m above, the full/1600 above and the preview's -q 40, all in the artVersion
    expect(USER_AGENT).toBe('tsuzuku-art/1 (+https://github.com/sunkencity999/tsuzuku)');
    expect(IMAGE_USER_AGENT).toBe('tsuzuku-art/1');
  });

  it('pool keeps the order, bounds what is in flight and fails on the first rejection', async () => {
    let inFlight = 0;
    let max = 0;
    const out = await pool(range(10), 4, async (n) => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return n * 2;
    });
    expect(out).toEqual(range(10).map((n) => n * 2));
    expect(max).toBeLessThanOrEqual(4);
    expect(max).toBeGreaterThan(1);
    const taken: number[] = [];
    await expect(pool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      taken.push(n);
      await new Promise((r) => setTimeout(r, 2));
      if (n === 2) throw new Error('boom');
      return n;
    })).rejects.toThrow('boom');
    await new Promise((r) => setTimeout(r, 20));
    expect(taken).toEqual([1, 2, 3]); // 3 was in flight beside 2; nothing after the failure
    expect(await pool([], 4, async (n: number) => n)).toEqual([]);
  });
});

/* ── the whole pipeline with a stub cwebp and a canned museum ─────────── */

function streamResponse(bytes: Buffer, status = 200) {
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(bytes.length, at + 64);
      controller.enqueue(new Uint8Array(bytes.subarray(at, end)));
      at = end;
    },
  });
  return { ok: status >= 200 && status < 300, status, body, json: async () => JSON.parse(bytes.toString('utf8')) as unknown, text: async () => bytes.toString('utf8') };
}

interface Museum {
  fetchImpl: FetchLike;
  calls: { url: string; ua: string }[];
  maxInFlight: () => number;
}

function museum(o: { publicDomain?: (aicId: number) => boolean; imageStatus?: number; html?: (aicId: number) => boolean; imageId?: (aicId: number) => string } = {}): Museum {
  const calls: { url: string; ua: string }[] = [];
  let inFlight = 0;
  let max = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, ua: init?.headers?.['user-agent'] ?? '' });
    const rec = /\/artworks\/(\d+)\?/.exec(url);
    if (rec) {
      const id = Number(rec[1]);
      return streamResponse(Buffer.from(JSON.stringify({ data: { id, title: `Fixture ${id}`, artist_title: 'Fixture', date_display: 'c. 1833', credit_line: 'Fixture gift', main_reference_number: `1900.${id}`, image_id: o.imageId ? o.imageId(id) : scan(id), is_public_domain: o.publicDomain ? o.publicDomain(id) : true, dimensions: '24 × 37 cm' } })));
    }
    const img = /\/iiif\/2\/(\d{8})-/.exec(url);
    if (img) {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 3));
      inFlight--;
      const html = o.html?.(Number(img[1])) ?? false;
      return streamResponse(html ? Buffer.from('<!DOCTYPE html><title>challenge</title>') : Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(url)]), o.imageStatus ?? 200);
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { fetchImpl, calls, maxInFlight: () => max };
}

describe('source-prints — end to end (stub cwebp, canned museum)', () => {
  let tmp = '';
  let curation = '';
  let cwebp = '';
  let cwebpLog = '';
  const PRINT = fakeWebp('VP8 ', 1400, 897, 200, 1);
  const LQIP = fakeWebp('VP8 ', 24, 16, 8, 2);
  const writeCuration = (dir: string, files: CurationInput[]): string => {
    mkdirSync(dir, { recursive: true });
    for (const f of files) writeFileSync(join(dir, f.name), JSON.stringify(f.json, null, 2));
    return dir;
  };
  const opts = (over: Partial<SourceOptions> & { fetchImpl: FetchLike }, dest: string): SourceOptions => ({ curationDir: curation, dest, cache: join(tmp, 'cache'), dryRun: false, force: false, cwebp, now: () => new Date('2026-10-28T00:00:00Z'), log: () => {}, ...over });

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tsuzuku-art-source-'));
    curation = writeCuration(join(tmp, 'curation'), wholeCuration());
    writeFileSync(join(tmp, 'print.webp'), PRINT);
    writeFileSync(join(tmp, 'lqip.webp'), LQIP);
    cwebpLog = join(tmp, 'cwebp.log');
    cwebp = join(tmp, 'cwebp.sh');
    // The stub copies a fixture to the -o path (the preview for *.lqip.webp) and appends the output name so every print's bytes differ.
    writeFileSync(
      cwebp,
      `#!/bin/sh\n[ "$1" = "-quiet" ] || exit 3\nout=""; prev=""\nfor a in "$@"; do\n  if [ "$prev" = "-o" ]; then out="$a"; fi\n  prev="$a"\ndone\necho "$@" >> "${cwebpLog}"\ncase "$out" in\n  *.lqip.webp) cp "${join(tmp, 'lqip.webp')}" "$out" ;;\n  *) cp "${join(tmp, 'print.webp')}" "$out"; printf '%s' "$out" >> "$out" ;;\nesac\n`,
      { mode: 0o755 },
    );
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('ensureRaw keys the raw by object, scan and width: a cached scan costs no request, a new image_id downloads again and retires the old raw (reported), --force re-downloads', async () => {
    const dir = join(tmp, 'raw-keyed');
    const m = museum();
    const rec = (imageId: string): AicRecord => ({ id: 1000, title: 'Fixture', artist_title: 'Fixture', date_display: 'c. 1833', credit_line: 'Fixture gift', main_reference_number: '1900.1000', image_id: imageId, is_public_domain: true, dimensions: null });
    const A = scan(1000);
    const B = scan(1000, RESCAN);
    const first = await ensureRaw(m.fetchImpl, rec(A), dir);
    expect(first).toEqual({ path: join(dir, rawName(1000, A)), downloaded: true, rescanned: null });
    expect(m.calls).toHaveLength(1);
    // the same scan again: nothing requested
    expect(await ensureRaw(m.fetchImpl, rec(A), dir)).toEqual({ path: first.path, downloaded: false, rescanned: null });
    expect(m.calls).toHaveLength(1);
    // the museum replaced the image: the new IIIF URL is requested, the new bytes are what cwebp will get, the old raw is gone and the change is reported
    const second = await ensureRaw(m.fetchImpl, rec(B), dir);
    expect(second).toEqual({ path: join(dir, rawName(1000, B)), downloaded: true, rescanned: A });
    expect(m.calls).toHaveLength(2);
    expect(m.calls[1]?.url).toBe(imageUrl(B));
    expect(readFileSync(second.path).toString('latin1')).toContain(B);
    expect(readdirSync(dir)).toEqual([rawName(1000, B)]);
    // --force downloads what is cached (and reports no re-scan)
    expect(await ensureRaw(m.fetchImpl, rec(B), dir, { force: true })).toEqual({ path: second.path, downloaded: true, rescanned: null });
    expect(m.calls).toHaveLength(3);
    // the unkeyed raw of the first pipeline is retired too, without a re-scan report
    writeFileSync(join(dir, '1000.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    expect(await ensureRaw(m.fetchImpl, rec(B), dir)).toEqual({ path: second.path, downloaded: false, rescanned: null });
    expect(readdirSync(dir)).toEqual([rawName(1000, B)]);
    expect(m.calls).toHaveLength(3);
  });

  it('a dry run lists the curation, the tables and the artVersion and touches no network', async () => {
    const m = museum();
    const log: string[] = [];
    const r = await sourcePrints(opts({ dryRun: true, fetchImpl: m.fetchImpl, log: (l) => log.push(l) }, join(tmp, 'dry')));
    expect(r.manifest).toBeNull();
    expect(r.artVersion).toMatch(/^p-[0-9a-f]{10}$/);
    expect(r.gaps).toEqual([]);
    expect(m.calls).toEqual([]);
    expect(log[0]).toMatch(/^dry run — 55 curated prints in .* \(1 series\), artVersion p-[0-9a-f]{10}$/);
    expect(log).toContain(`  ${fixtureId(7)}  AIC 1007  station 7 (en)  [station 7]`);
    expect(log).toContain(`tables: stations ${STATION_COUNT}/${STATION_COUNT}, day ${KO_COUNT}/${KO_COUNT}, night ${MONTH_COUNT}/${MONTH_COUNT}`);
    expect(existsSync(join(tmp, 'dry'))).toBe(false);
  });

  it('a full run fetches every record and JPEG (≤ 4 at a time, two user agents), encodes, measures, hashes and writes a sound manifest', async () => {
    const m = museum();
    const dest = join(tmp, 'full');
    const log: string[] = [];
    rmSync(cwebpLog, { force: true });
    const r = await sourcePrints(opts({ fetchImpl: m.fetchImpl, log: (l) => log.push(l) }, dest));
    const manifest = r.manifest!;
    expect(manifestProblems(manifest)).toEqual([]);
    expect(r.partial).toBe(false);
    expect(r.downloaded).toBe(55);
    expect(r.encoded).toBe(55);
    expect(manifest.prints).toHaveLength(55);
    expect(manifest.generatedAt).toBe('2026-10-28T00:00:00.000Z');
    expect(manifest.encoder).toEqual({ tool: 'cwebp', quality: 82, width: 1400, lqip: 24 });
    expect(manifest.sources[0]?.museum).toBe('Art Institute of Chicago');
    expect(JSON.parse(readFileSync(join(dest, 'manifest.json'), 'utf8'))).toEqual(manifest);
    // the row for station 0
    const p0 = manifest.prints.find((p) => p.id === fixtureId(0))!;
    expect(p0.source).toEqual({ museum: 'Art Institute of Chicago', objectId: 1000, url: 'https://www.artic.edu/artworks/1000', accession: '1900.1000', creditLine: 'Fixture gift', license: 'CC0 1.0' });
    expect([p0.width, p0.height, p0.orientation]).toEqual([1400, 897, 'landscape']);
    expect(p0.artist).toEqual(tri('artist'));
    expect(p0.series).toEqual({ id: 'fix', ...tri('series') });
    expect(p0.date).toBe('c. 1833');
    expect(p0.roles).toEqual({ station: 0, kos: range(KO_COUNT), nightMonths: range(MONTH_COUNT, 1) });
    expect(Buffer.from(p0.lqip.slice('data:image/webp;base64,'.length), 'base64').equals(LQIP)).toBe(true);
    const onDisk = readFileSync(join(dest, p0.file));
    expect(p0.bytes).toBe(onDisk.length);
    expect(p0.sha256).toBe(sha256Hex(onDisk));
    expect(p0.file).toBe(printFile(p0.id, p0.sha256));
    expect(readdirSync(join(dest, 'prints'))).toHaveLength(55);
    expect(new Set(manifest.prints.map((p) => p.sha256)).size).toBe(55);
    // the tables
    expect(Object.keys(manifest.stations)).toHaveLength(55);
    expect(manifest.stations['54']).toBe(fixtureId(54));
    expect(manifest.calendar.day.every((id) => id === fixtureId(0))).toBe(true);
    expect(manifest.calendar.night).toHaveLength(12);
    // the network: a record and an image per print, the API with the full UA, the IIIF host with the bare one, at most four images in flight
    const records = m.calls.filter((c) => c.url.startsWith('https://api.artic.edu/'));
    const images = m.calls.filter((c) => c.url.startsWith('https://www.artic.edu/iiif/2/'));
    expect(records).toHaveLength(55);
    expect(images).toHaveLength(55);
    expect(new Set(records.map((c) => c.ua))).toEqual(new Set([USER_AGENT]));
    expect(new Set(images.map((c) => c.ua))).toEqual(new Set([IMAGE_USER_AGENT]));
    expect(images[0]?.url).toMatch(/\/full\/1600,\/0\/default\.jpg$/);
    expect(m.maxInFlight()).toBeLessThanOrEqual(4);
    expect(m.maxInFlight()).toBeGreaterThan(1);
    // the raw cache and the encoder calls
    const rawPath = join(tmp, 'cache', 'raw', rawName(1000, scan(1000)));
    const raw = readFileSync(rawPath);
    expect(raw.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    const lines = readFileSync(cwebpLog, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(110);
    expect(lines[0]).toBe(cwebpArgs(rawPath, join(tmp, 'cache', 'webp', `${fixtureId(0)}.webp`), 82, 1400).join(' '));
    expect(lines[1]).toBe(cwebpArgs(rawPath, join(tmp, 'cache', 'webp', `${fixtureId(0)}.lqip.webp`), 40, 24).join(' '));
    // the encode key names every byte-deciding setting, the method included, so a warm cache never re-uses an encode made under another one
    const key = readFileSync(join(tmp, 'cache', 'webp', `${fixtureId(0)}.key`), 'utf8');
    expect(key).toBe(`${sha256Hex(raw)}\n${encoderString()}\n`);
    expect(key).toContain(` m${ENCODE.method} src${ENCODE.sourceWidth} lq${ENCODE.lqipQuality} long\n`);
    expect(log.at(-1)).toMatch(/^55 prints, \d+\.\d\d MB, 55 downloaded, 55 encoded; artVersion p-[0-9a-f]{10} → /);
    expect(log.some((l) => /PARTIAL/.test(l))).toBe(false);

    // A second full run: nothing downloaded or encoded, a stale file pruned, the manifest byte-identical.
    const stale = join(dest, 'prints', 'stale-00-x-deadbeef.webp');
    writeFileSync(stale, PRINT);
    rmSync(cwebpLog, { force: true });
    const again = await sourcePrints(opts({ fetchImpl: museum().fetchImpl }, dest));
    expect(again.downloaded).toBe(0);
    expect(again.encoded).toBe(0);
    expect(existsSync(cwebpLog)).toBe(false);
    expect(existsSync(stale)).toBe(false);
    expect(again.manifest).toEqual(manifest);

    // A third run after the museum re-scans one object: that raw alone downloads again (the old scan retired), its encode re-runs, the line is loud, and the artVersion does not move.
    const rescan = museum({ imageId: (id) => (id === 1005 ? scan(id, RESCAN) : scan(id)) });
    const loud: string[] = [];
    const third = await sourcePrints(opts({ fetchImpl: rescan.fetchImpl, log: (l) => loud.push(l), refreshRecords: true }, dest));
    expect(third.downloaded).toBe(1);
    expect(third.encoded).toBe(1);
    expect(third.artVersion).toBe(manifest.artVersion);
    expect(rescan.calls.filter((c) => c.url.startsWith('https://www.artic.edu/iiif/2/')).map((c) => c.url)).toEqual([imageUrl(scan(1005, RESCAN))]);
    expect(readdirSync(join(tmp, 'cache', 'raw')).filter((n) => n.startsWith('1005-'))).toEqual([rawName(1005, scan(1005, RESCAN))]);
    expect(loud).toContain(`  ${fixtureId(5)}: RE-SCANNED — AIC 1005 image_id ${scan(1005)} → ${scan(1005, RESCAN)}: new pixels, and the artVersion (${manifest.artVersion}) does not move for a museum re-scan; review the sheet before packing`);
    expect(loud.at(-1)).toBe('1 raw RE-SCANNED by the museum (the lines above name them): the pixels changed, the artVersion did not — review before packing');
    expect(log.some((l) => /RE-SCANNED/.test(l))).toBe(false); // the first two runs said nothing of the kind
  }, 60_000);

  it('a --only / --limit run is partial: full tables, some prints, refused over a complete manifest without --force; an unknown id or a bad limit stops at once', async () => {
    const dest = join(tmp, 'full'); // the complete pack of the previous test
    await expect(sourcePrints(opts({ only: [fixtureId(3)], fetchImpl: museum().fetchImpl }, dest))).rejects.toThrow(/is a complete pack \(p-[0-9a-f]{10}\); a --only \/ --limit run will not overwrite it without --force/);
    await expect(sourcePrints(opts({ only: ['ghost'], fetchImpl: museum().fetchImpl }, join(tmp, 'x')))).rejects.toThrow(/--only names unknown prints: ghost/);
    await expect(sourcePrints(opts({ limit: 0, fetchImpl: museum().fetchImpl }, join(tmp, 'x')))).rejects.toThrow(/--limit needs a positive integer/);
    const log: string[] = [];
    const r = await sourcePrints(opts({ only: [fixtureId(3), fixtureId(9)], force: true, fetchImpl: museum().fetchImpl, log: (l) => log.push(l) }, dest));
    expect(r.partial).toBe(true);
    expect(r.manifest?.prints.map((p) => p.id)).toEqual([fixtureId(3), fixtureId(9)]);
    expect(Object.keys(r.manifest!.stations)).toHaveLength(55);
    expect(manifestProblems(r.manifest!).length).toBeGreaterThan(50);
    expect(log.at(-1)).toMatch(/^PARTIAL manifest \(--only \/ --limit\): \d+ table problems — art:check fails it and art:pack refuses it/);
    expect(readdirSync(join(dest, 'prints'))).toHaveLength(55); // a partial run never prunes
    const limited = await sourcePrints(opts({ limit: 2, fetchImpl: museum().fetchImpl }, join(tmp, 'limited')));
    expect(limited.manifest?.prints.map((p) => p.id)).toEqual([fixtureId(0), fixtureId(1)]);
    expect(limited.partial).toBe(true);
  }, 60_000);

  it('a full run over a curation with gaps stops before the first fetch; a record that is not CC0, a challenge page, an HTTP error or a missing cwebp stops the run with nothing written', async () => {
    const sparse = writeCuration(join(tmp, 'sparse'), [file('a.json', { entries: range(10).map((n) => entry(n)) })]);
    const m = museum();
    await expect(sourcePrints(opts({ curationDir: sparse, fetchImpl: m.fetchImpl }, join(tmp, 'sparse-out')))).rejects.toThrow(/the tables have 129 gaps \(station 10, station 11, .*…\) — fill the curation before a full run, or use --only \/ --limit/);
    expect(m.calls).toEqual([]);
    await expect(sourcePrints(opts({ curationDir: sparse, dryRun: true, fetchImpl: m.fetchImpl }, join(tmp, 'sparse-out')))).rejects.toThrow(/129 gaps — a full run stops here/);
    const dest = join(tmp, 'broken');
    await expect(sourcePrints(opts({ cache: join(tmp, 'cache-cc0'), fetchImpl: museum({ publicDomain: (id) => id !== 1007 }).fetchImpl }, dest))).rejects.toThrow(/AIC 1007: is_public_domain is false — not CC0, cannot ship/);
    await expect(sourcePrints(opts({ cache: join(tmp, 'cache-html'), fetchImpl: museum({ html: (id) => id === 1003 }).fetchImpl }, dest))).rejects.toThrow(/AIC 1003: download failed: .* not a JPEG \(3c2144…\)/);
    await expect(sourcePrints(opts({ cache: join(tmp, 'cache-403'), fetchImpl: museum({ imageStatus: 403 }).fetchImpl }, dest))).rejects.toThrow(/download failed: .* HTTP 403/);
    expect(existsSync(join(tmp, 'cache-403', 'raw'))).toBe(true);
    expect(readdirSync(join(tmp, 'cache-403', 'raw'))).toEqual([]); // no half-written .part left behind
    await expect(sourcePrints(opts({ cache: join(tmp, 'cache-nocwebp'), cwebp: join(tmp, 'no-such-cwebp'), fetchImpl: museum().fetchImpl }, dest))).rejects.toThrow(/failed to start: .* \(brew install webp\)/);
    expect(existsSync(join(dest, 'manifest.json'))).toBe(false);
  }, 60_000);
});

describe('source-prints — the record cache and the 429 backoff', () => {
  it('retries a rate-limited record, writes it to the cache, and serves the cache on the next run without a request', async () => {
    const { cachedRecord } = await import('./source-prints.ts');
    const { mkdtempSync, existsSync: has } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'art-records-'));
    const record = { id: 10926, title: 'Mishima', artist_title: 'Utagawa Hiroshige', date_display: 'c. 1833/34', credit_line: 'Gift of H. R. Warner', main_reference_number: '1932.170', image_id: '00000000-0000-0000-0000-000000000000', is_public_domain: true, dimensions: '24 × 37 cm' };
    let calls = 0;
    const waits: number[] = [];
    const fetchImpl = (async () => {
      calls++;
      return calls < 3 ? { ok: false, status: 429, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ data: record }) };
    }) as never;
    const first = await cachedRecord(fetchImpl, 10926, dir, { waitMs: async (ms) => void waits.push(ms) });
    expect(first.main_reference_number).toBe('1932.170');
    expect(calls).toBe(3);
    expect(waits).toEqual([2000, 4000]);
    expect(has(join(dir, '10926.json'))).toBe(true);
    const again = await cachedRecord(fetchImpl, 10926, dir);
    expect(again.credit_line).toBe('Gift of H. R. Warner');
    expect(calls).toBe(3);
  });
});
