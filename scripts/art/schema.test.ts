import { type ArtManifest, ART_VERSION_RE, artVersionOf, assetName, buildPointer, emptyPointer, ENCODE, encoderString, ENCODER, manifestProblems, MAX_LQIP_CHARS, PACK_REPO, parsePrintId, printFile, printId, releaseTag, slugify, stableStringify, webpDimensions } from './schema.ts';
import { fakeWebp, fixturePack } from './__fixtures__/pack.ts';

/** The 24 px preview cwebp wrote for AIC 10926 (Mishima) in the first end-to-end run: a lossy VP8 header, 24 × 16, 150 bytes. */
const MISHIMA_LQIP =
  'UklGRo4AAABXRUJQVlA4IIIAAAAwBACdASoYABAAPu1iqU2ppaQiMAgBMB2JYwCdACHRvn7vS2qYFHw4pgAA/rQoqq31lNlAo+xQUlLLeXvnrrp+1GgBxueaOYaWHlmWzFFdLRmlv6xR3M0YhGh6gFNeY5JbJckZm+7onMlQphuU+XvAxfZt2b9YwKU40J7iU8i4BAAA';

describe('schema — artVersion', () => {
  it('is p- + 10 hex, the same whatever the key order, different when the curation or any byte-deciding encoder setting changes', () => {
    const a = stableStringify({ entries: [{ id: 'x', aicId: 1 }], series: { s: { en: 'S' } } });
    const b = stableStringify({ series: { s: { en: 'S' } }, entries: [{ aicId: 1, id: 'x' }] });
    expect(a).toBe(b);
    const v = artVersionOf(a, encoderString(ENCODER));
    expect(v).toMatch(ART_VERSION_RE);
    expect(artVersionOf(b, encoderString())).toBe(v);
    expect(artVersionOf(stableStringify({ entries: [{ id: 'y', aicId: 1 }], series: { s: { en: 'S' } } }), encoderString())).not.toBe(v);
    expect(artVersionOf(a, encoderString({ ...ENCODER, quality: 80 }))).not.toBe(v);
    // every setting that decides a byte is in the string: the shipped encoder object AND the unshipped method, source width and preview quality
    expect(encoderString()).toBe('cwebp q82 w1400 lqip24 m6 src1600 lq40 long');
    expect(encoderString(ENCODER, ENCODE)).toBe(encoderString());
    expect(ENCODER).toEqual({ tool: 'cwebp', quality: 82, width: 1400, lqip: 24 }); // the manifest's encoder object keeps the contract's four fields
    for (const s of [{ ...ENCODE, method: 4 }, { ...ENCODE, sourceWidth: 2000 }, { ...ENCODE, lqipQuality: 50 }]) expect(artVersionOf(a, encoderString(ENCODER, s))).not.toBe(v);
    // arrays keep their order; undefined fields drop out as JSON.stringify drops them
    expect(stableStringify([2, 1])).toBe('[2,1]');
    expect(stableStringify({ b: undefined, a: null, c: 'x' })).toBe('{"a":null,"c":"x"}');
  });
});

describe('schema — WebP header', () => {
  it('reads VP8 (scale bits masked), VP8L (minus one, alpha bit ignored), VP8X (24-bit canvas) and a real cwebp preview', () => {
    expect(webpDimensions(fakeWebp('VP8 ', 1400, 897))).toEqual({ width: 1400, height: 897 });
    expect(webpDimensions(fakeWebp('VP8 ', 1400, 897, 16, 15))).toEqual({ width: 1400, height: 897 }); // seed 15 sets both scale fields
    expect(webpDimensions(fakeWebp('VP8L', 1400, 2100))).toEqual({ width: 1400, height: 2100 });
    expect(webpDimensions(fakeWebp('VP8L', 1, 1))).toEqual({ width: 1, height: 1 });
    expect(webpDimensions(fakeWebp('VP8X', 1400, 897))).toEqual({ width: 1400, height: 897 });
    expect(webpDimensions(fakeWebp('VP8X', 70000, 3))).toEqual({ width: 70000, height: 3 }); // beyond 16 bits
    expect(webpDimensions(Buffer.from(MISHIMA_LQIP, 'base64'))).toEqual({ width: 24, height: 16 });
  });

  it('rejects a JPEG, a short buffer, a broken start code or signature and an unknown first chunk', () => {
    expect(() => webpDimensions(Buffer.from('\xff\xd8\xff' + 'x'.repeat(40), 'latin1'))).toThrow(/not a WebP/);
    expect(() => webpDimensions(fakeWebp('VP8 ', 10, 10).subarray(0, 20))).toThrow(/not a WebP/);
    const broken = fakeWebp('VP8 ', 10, 10);
    broken[24] = 0;
    expect(() => webpDimensions(broken)).toThrow(/start code/);
    const lossless = fakeWebp('VP8L', 10, 10);
    lossless[20] = 0;
    expect(() => webpDimensions(lossless)).toThrow(/signature/);
    const odd = fakeWebp('VP8X', 10, 10);
    odd.write('ALPH', 12, 'latin1');
    expect(() => webpDimensions(odd)).toThrow(/unknown WebP chunk "ALPH"/);
  });
});

describe('schema — ids, files and the pointer', () => {
  it('slugs drop diacritics, printId pads the number, parsePrintId inverts it, printFile is content-addressed', () => {
    expect(slugify('Sanjō Ōhashi')).toBe('sanjo-ohashi');
    expect(slugify('  Kyōto (Sanjō) ')).toBe('kyoto-sanjo');
    expect(printId('hoeido', 11, 'Mishima')).toBe('hoeido-11-mishima');
    expect(printId('Hōeidō', 0, 'Nihonbashi')).toBe('hoeido-00-nihonbashi');
    expect(() => printId('hoeido', 100, 'x')).toThrow(/bad parts/);
    expect(() => printId('hoeido', 1, '—')).toThrow(/bad parts/);
    expect(parsePrintId('hoeido-11-mishima')).toEqual({ series: 'hoeido', nn: 11, name: 'mishima' });
    expect(parsePrintId('hoeido-54-sanjo-ohashi')).toEqual({ series: 'hoeido', nn: 54, name: 'sanjo-ohashi' });
    expect(parsePrintId('Hoeido-11-Mishima')).toBeNull();
    expect(parsePrintId('hoeido-1-mishima')).toBeNull();
    expect(printFile('hoeido-11-mishima', 'da22e61d3cea' + 'f'.repeat(52))).toBe('prints/hoeido-11-mishima-da22e61d.webp');
  });

  it('buildPointer names the tag and the one prints asset with the credit; emptyPointer is the placeholder', () => {
    expect(buildPointer('p-0123456789', { sha256: 'c', bytes: 1 })).toEqual({ schema: 'tsuzuku.art-pack/1', repo: PACK_REPO, artVersion: 'p-0123456789', tag: 'art-p-0123456789', assets: [{ tier: 'prints', name: 'tsuzuku-art-p-0123456789.tar', sha256: 'c', bytes: 1 }], credits: ['Art Institute of Chicago · CC0'] });
    expect(releaseTag('p-x')).toBe('art-p-x');
    expect(assetName('p-x')).toBe('tsuzuku-art-p-x.tar');
    expect(emptyPointer()).toEqual({ schema: 'tsuzuku.art-pack/1', repo: PACK_REPO, artVersion: null, tag: null, assets: [], credits: [] });
  });
});

describe('schema — manifestProblems', () => {
  const { manifest } = fixturePack();
  const clone = (): ArtManifest => JSON.parse(JSON.stringify(manifest)) as ArtManifest;
  const only = (m: ArtManifest, re: RegExp): void => {
    const problems = manifestProblems(m);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(re);
  };

  it('the fixture pack is sound', () => {
    expect(manifestProblems(manifest)).toEqual([]);
  });

  it('a gap, a stray key, a short table, an unknown id, each broken print field and a roles / table disagreement are named one line each', () => {
    let m = clone();
    delete m.stations['7'];
    only(m, /^stations: station 7 missing$/);
    m = clone();
    m.stations['55'] = m.prints[0]!.id;
    only(m, /key "55" is not a station 0\.\.54/);
    m = clone();
    m.calendar.day.pop();
    only(m, /^calendar\.day has 71 entries, needs 72$/);
    m = clone();
    m.calendar.night[3] = 'nope';
    only(m, /^calendar\.night\[3\] names unknown print "nope"$/);
    m = clone();
    m.prints[1]!.lqip = `data:image/webp;base64,${'A'.repeat(MAX_LQIP_CHARS)}`;
    only(m, /lqip is 1023 chars, over 1000/);
    m = clone();
    m.prints[1]!.lqip = 'data:image/png;base64,AAAA';
    only(m, /lqip is not a WebP data URI/);
    m = clone();
    m.prints[1]!.bytes = 400_001;
    only(m, /bytes 400001 is not 1\.\.400000/);
    m = clone();
    m.prints[2]!.title.reading = '';
    only(m, /title needs ja, reading and en/);
    m = clone();
    m.prints[2]!.artist = { ja: 'x', reading: 'x', en: '' };
    only(m, /artist needs ja, reading and en/);
    m = clone();
    m.prints[2]!.source.accession = '';
    only(m, /source\.accession missing/);
    m = clone();
    m.prints[2]!.source.creditLine = '';
    only(m, /source\.creditLine missing/);
    m = clone();
    m.prints[3]!.orientation = 'landscape'; // print 3 is 25 × 40
    only(m, /orientation "landscape" does not match 25×40/);
    m = clone();
    m.prints[3]!.file = 'prints/other.webp';
    only(m, /file "prints\/other\.webp" is not prints\/fix-03-station-[0-9a-f]{8}\.webp/);
    m = clone();
    m.prints[3]!.focus = [1.5, 0];
    only(m, /focus is not \[x, y\] in 0\.\.1/);
    m = clone();
    m.prints[0]!.roles = { station: 1 };
    only(m, /roles\.station 1 but stations\[1\] is "fix-01-station"/);
    m = clone();
    m.prints[0]!.roles = { station: 0, kos: [1] };
    only(m, /roles\.kos has 1 but calendar\.day\[1\] is "fix-01-station"/);
    m = clone();
    m.prints[0]!.roles = { station: 0, nightMonths: [2] };
    only(m, /roles\.nightMonths has 2 but calendar\.night\[1\] is "fix-01-station"/);
    m = clone();
    m.prints[0]!.roles = { station: 0, kos: [72] };
    only(m, /roles\.kos must be indexes 0\.\.71/);
    m = clone();
    m.artVersion = 'a-1234567890';
    only(m, /artVersion "a-1234567890" is not p-<10 hex>/);
    m = clone();
    m.prints.push(clone().prints[0]!);
    only(m, /duplicate id/);
  });

  it('the prints together may not pass 30 MB', () => {
    const m = clone();
    const p0 = m.prints[0]!;
    for (let i = 0; i < 25; i++) {
      const id = `extra-${String(i).padStart(2, '0')}-x`;
      m.prints.push({ ...p0, id, file: printFile(id, p0.sha256), bytes: 400_000, roles: undefined });
    }
    for (const p of m.prints) p.bytes = 400_000;
    only(m, /prints total 32000000 bytes, over 30000000/);
  });
});
