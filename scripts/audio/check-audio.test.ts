import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAudio, checkBelts, checkDist, checkIndexes, checkReuse, contentKanaLookup, NONE_MESSAGE, readKanaKeys } from './check-audio.ts';
import { type AudioManifest, type CueIndex, KANA_SIDECAR, kanaHash } from './indexes.ts';
import { renderAudio } from './render-audio.ts';
import { synthesizeMinimalPair } from './verify.ts';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, '__fixtures__');
const CONTENT = join(FIXTURES, 'content');
const CAST = join(here, 'cast.json');

const manifestOf = (over: Partial<AudioManifest> = {}): AudioManifest => ({
  schema: 'tsuzuku.audio/1',
  audioVersion: 'a-aaaaaaaaaa',
  contentVersion: 'c-f1x7ure0001',
  engine: 'VOICEVOX 0.25.2',
  dictVersion: 'd-0000000000',
  castSha: 'x',
  tiers: ['core'],
  generatedAt: '2026-10-17T00:00:00.000Z',
  dryRun: true,
  partial: null,
  voices: {},
  belts: { yellow: { bytes: 300, seconds: 3, files: 2 } },
  files: [
    { path: 'sprites/s04/a-11111111.webm', bytes: 100, seconds: 1, clips: 1, belt: 'yellow', tier: 'core' },
    { path: 'sprites/s04/b-22222222.webm', bytes: 200, seconds: 2, clips: 1, belt: 'yellow', tier: 'core' },
  ],
  indexes: [],
  totals: { bytes: 300, seconds: 3, files: 2, clips: 2 },
  render: { rendered: 2, cached: 0, skipped: 0, reused: 0 },
  changedClipShare: 1,
  contentDiffShare: null,
  skipped: 0,
  credits: [],
  reusedBytesShare: null,
  ...over,
});

describe('check-audio — index kana against the content', () => {
  const lookup = contentKanaLookup(CONTENT);

  it('resolves every key shape of docs/AUDIO_PACK.md §2', () => {
    expect(lookup('v-n5-0002')).toBe('あめ');
    expect(lookup('v-n5-0002#ex0')).toBe('きょうはあめです。');
    expect(lookup('v-n5-0001#ga')).toBe('はいが');
    expect(lookup('g-n5-001#ex1')).toBe('きょうはあめです。');
    expect(lookup('j-日#ex1')).toBe('まいにち');
    expect(lookup('k-h-a')).toBe('あ');
    expect(lookup('k-h-a#ex0')).toBe('あさ');
    expect(lookup('s-04-1#L1')).toBe('きょうはあめです。');
    expect(lookup('s-04-1')).toBeNull(); // whole track: nothing to compare
    expect(lookup('m-04-1')).toBe('ごんたざか');
    expect(lookup('track:row-h-a')).toBeNull();
    expect(lookup('v-n5-9999')).toBeUndefined();
    expect(lookup('s-04-1#L9')).toBeUndefined();
    expect(lookup('v-n5-0001#col0')).toBeUndefined(); // no collocations on the fixture item
    // #pair resolves to the partner the runtime synthesizes (a pure function of the kana), so its clip is checked like any word.
    expect(lookup('v-n5-0001#pair')).toBe(synthesizeMinimalPair('はい'));
    expect(lookup('v-n5-0001#pair')).toBe('はっい');
  });

  it('pack kana ≠ content kana fails; a key the sidecar lacks fails; a dangling key fails; matching cues pass', () => {
    const good: CueIndex = { schema: 'tsuzuku.audio-index/1', audioVersion: 'a-x', scope: 'n5', kind: 'words', files: [], voices: [], cues: { 'v-n5-0002': [{ f: 0, s: 0, e: 1, v: 0, r: 1 }] } };
    expect(checkIndexes([{ path: 'n5/words.json', json: good }], lookup, { 'v-n5-0002': kanaHash('あめ') }).filter((f) => f.level === 'fail')).toEqual([]);
    expect(checkIndexes([{ path: 'n5/words.json', json: good }], lookup, { 'v-n5-0002': kanaHash('あめー') }).map((f) => f.level)).toEqual(['fail', 'info']);
    expect(checkIndexes([{ path: 'n5/words.json', json: good }], lookup, {})[0]?.message).toMatch(/no record in kana\.json/);
    const dangling: CueIndex = { ...good, cues: { 'v-n5-9999': [{ f: 0, s: 0, e: 1, v: 0, r: 1 }] } };
    expect(checkIndexes([{ path: 'n5/words.json', json: dangling }], lookup, { 'v-n5-9999': 'deadbeef' })[0]?.message).toMatch(/no content behind it/);
  });
});

describe('check-audio — manifest, dist and reuse', () => {
  it('belts sums must equal files sums', () => {
    expect(checkBelts(manifestOf())).toEqual([]);
    expect(checkBelts(manifestOf({ belts: { yellow: { bytes: 299, seconds: 3, files: 2 } } }))[0]?.message).toMatch(/belts sums/);
    expect(checkBelts(manifestOf({ totals: { bytes: 1, seconds: 3, files: 2, clips: 2 } }))[0]?.message).toMatch(/totals/);
  });

  it('dist over 900 MB fails; an absent dist is informational', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'tsuzuku-dist-'));
    try {
      writeFileSync(join(tmp, 'a.bin'), Buffer.alloc(1024));
      expect(checkDist(tmp)[0]?.level).toBe('info');
      expect(checkDist(tmp, 1000)[0]?.level).toBe('fail');
      expect(checkDist(tmp, 1000)[0]?.message).toMatch(/over the/);
      expect(checkDist(join(tmp, 'nope'))[0]?.level).toBe('info');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('reusedBytesShare is computed from two manifests and warns below 0.9 unless a LARGE content diff explains it; changedClipShare never counts as the diff', () => {
    const previous = manifestOf({ files: [{ path: 'sprites/s04/a-11111111.webm', bytes: 100, seconds: 1, clips: 1, belt: 'yellow', tier: 'core' }] });
    const current = manifestOf({ contentDiffShare: 0.01 });
    const f = checkReuse(current, previous);
    expect(f[0]?.level).toBe('warn');
    expect(f[0]?.message).toContain('reusedBytesShare 0.3333');
    expect(f[0]?.message).toContain('1.0 % of clip keys');
    expect(checkReuse(current, previous, 0.5)[0]?.level).toBe('info'); // a big content change explains the churn
    expect(checkReuse(manifestOf({ contentDiffShare: 0.5 }), previous)[0]?.level).toBe('info'); // measured by the render against the previous pack
    // A cold cache renders every clip (changedClipShare 1) — that is NOT a content diff, so the warning still fires.
    expect(checkReuse(manifestOf({ changedClipShare: 1, contentDiffShare: 0.01 }), previous)[0]?.level).toBe('warn');
    // No diff information at all: a low share still warns, saying the diff is unknown.
    const unknown = checkReuse(manifestOf({ changedClipShare: 1, contentDiffShare: null }), previous);
    expect(unknown[0]?.level).toBe('warn');
    expect(unknown[0]?.message).toContain('content diff unknown');
    expect(checkReuse(manifestOf({ reusedBytesShare: 0.95, contentDiffShare: 0.01 }), null)[0]?.level).toBe('info');
    expect(checkReuse(manifestOf({ reusedBytesShare: null }), null)[0]?.message).toMatch(/n\/a/);
    expect(checkReuse(manifestOf({ reusedBytesShare: 0.2, contentDiffShare: 0.01 }), null)[0]?.level).toBe('warn');
  });
});

describe('check-audio — the whole check over a dry-run pack', () => {
  let tmp = '';
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tsuzuku-check-'));
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('no manifest: the none message, exit 0 with --optional and 1 without', () => {
    const log: string[] = [];
    expect(checkAudio({ audioDir: join(tmp, 'none'), contentDir: CONTENT, dist: join(tmp, 'dist'), optional: true, log: (l) => log.push(l) }).code).toBe(0);
    expect(log).toEqual([NONE_MESSAGE]);
    expect(checkAudio({ audioDir: join(tmp, 'none'), contentDir: CONTENT, dist: join(tmp, 'dist'), optional: false, log: () => {} }).code).toBe(1);
  });

  it('a fresh dry-run pack passes; a stale contentVersion warns; an edited content kana fails', async () => {
    const audio = join(tmp, 'audio');
    await renderAudio({ root: CONTENT, out: audio, cache: join(tmp, 'cache'), castPath: CAST, tiers: ['core'], engines: [], dryRun: true, fixtures: FIXTURES, ffmpeg: 'ffmpeg', dict: 'high', prune: true, log: () => {} });
    const ok = checkAudio({ audioDir: audio, contentDir: CONTENT, dist: join(tmp, 'dist'), optional: true, log: () => {} });
    expect(ok.code).toBe(0);
    expect(ok.findings.filter((f) => f.level === 'fail')).toEqual([]);
    expect(ok.findings.some((f) => /cues checked/.test(f.message))).toBe(true);
    // The kana sidecar is what the cues are checked against; every cue key has a record there.
    const manifest = JSON.parse(readFileSync(join(audio, 'manifest.json'), 'utf8')) as AudioManifest;
    const keys = readKanaKeys(audio, manifest);
    expect(keys).not.toBeNull();
    expect(keys?.['v-n5-0002']).toBe(kanaHash('あめ'));
    expect(keys?.['s-04-1#L0']).toBe(kanaHash('はい、わかりました。'));
    // --previous pointed at the same pack: the diff is measured on the two sidecars (0 %) and reuse is 1.
    const same = checkAudio({ audioDir: audio, contentDir: CONTENT, dist: join(tmp, 'dist'), optional: true, previous: join(audio, 'manifest.json'), log: () => {} });
    expect(same.findings.find((f) => /reusedBytesShare/.test(f.message))?.message).toContain('reusedBytesShare 1 (content diff 0.0 % of clip keys');
    // Without the sidecar the pack cannot be checked: FAIL.
    const noSidecar = join(tmp, 'audio-nosidecar');
    copyDir(audio, noSidecar);
    rmSync(join(noSidecar, manifest.audioVersion, KANA_SIDECAR));
    const failedSidecar = checkAudio({ audioDir: noSidecar, contentDir: CONTENT, dist: join(tmp, 'dist'), optional: true, log: () => {} });
    expect(failedSidecar.code).toBe(1);
    expect(failedSidecar.findings.filter((f) => f.level === 'fail').map((f) => f.message).join('\n')).toMatch(/kana\.json is missing|named by the manifest is missing/);

    // Stale: a content root whose manifest carries another contentVersion.
    const stale = join(tmp, 'content-stale');
    mkdirSync(stale, { recursive: true });
    for (const sub of ['kana', 'vocab', 'kanji', 'grammar', 'stories', 'michikusa']) copyDir(join(CONTENT, sub), join(stale, sub));
    writeFileSync(join(stale, 'manifest.json'), JSON.stringify({ schema: 'tsuzuku.manifest/1', contentVersion: 'c-0000000000', files: [] }));
    const warned = checkAudio({ audioDir: audio, contentDir: stale, dist: join(tmp, 'dist'), optional: true, log: () => {} });
    expect(warned.code).toBe(0);
    expect(warned.findings.find((f) => f.level === 'warn')?.message).toMatch(/stale pack/);

    // Kana drift: the content's 雨 reading changes under the pack.
    const drift = join(tmp, 'content-drift');
    mkdirSync(drift, { recursive: true });
    for (const sub of ['kana', 'vocab', 'kanji', 'grammar', 'stories', 'michikusa']) copyDir(join(CONTENT, sub), join(drift, sub));
    writeFileSync(join(drift, 'manifest.json'), readFileSync(join(CONTENT, 'manifest.json')));
    const vocabPath = join(drift, 'vocab', 'n5', 'vocab-n5-001.json');
    writeFileSync(vocabPath, readFileSync(vocabPath, 'utf8').replace('"kana": "あめ",\n   "meanings": [\n    "rain"', '"kana": "あめえ",\n   "meanings": [\n    "rain"'));
    const failed = checkAudio({ audioDir: audio, contentDir: drift, dist: join(tmp, 'dist'), optional: true, log: () => {} });
    expect(failed.code).toBe(1);
    expect(failed.findings.filter((f) => f.level === 'fail').map((f) => f.message).join('\n')).toMatch(/v-n5-0002 was rendered from different kana/);
  }, 60_000);
});

function copyDir(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const dst = join(to, name);
    if (statSync(src).isDirectory()) copyDir(src, dst);
    else writeFileSync(dst, readFileSync(src));
  }
}
