import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentFile, StoryItem } from '../../src/content/types.ts';
import { hashString } from '../../src/shared/hash.ts';
import { textToSpeak } from '../../src/shared/speak-text.ts';
import {
  type AudioManifest,
  type CueIndex,
  type ManifestFileEntry,
  type RenderedClip,
  type StoriesIndex,
  type TracksIndex,
  audioVersionOf,
  beltOfStation,
  beltTotals,
  buildIndexes,
  clauseBoundaries,
  DICTATION_MAX_MORAE,
  fnv1a32,
  indexBudgetFindings,
  KANA_SIDECAR,
  kanaDiffShare,
  kanaHash,
  kanaSidecarOf,
  MAX_LEVEL_INDEX_BYTES,
  MAX_STATION_INDEX_BYTES,
  moraBoundaries,
  moraTotal,
  reusedBytesShare,
  serializeIndex,
  textKey,
} from './indexes.ts';
import { renderAudio } from './render-audio.ts';
import { GUARD_SECONDS, sha256Hex } from './sprites.ts';
import { type AudioQuery, lenientMorae, queryDuration, verifyMorae } from './verify.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): { text: string; kana: string; query: AudioQuery } => JSON.parse(readFileSync(join(here, '__fixtures__', 'queries', `${name}.json`), 'utf8'));
const CONTENT_ROOT = join(here, '..', '..', 'public', 'content');

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.json')) out.push(p);
  }
  return out;
}

const clip = (over: Partial<RenderedClip> & Pick<RenderedClip, 'key' | 'kind'>): RenderedClip => ({
  level: 'n5',
  station: 4,
  rate: 1,
  voice: 'VOICEVOX:九州そら',
  file: 'sprites/s04/words-01-aaaaaaaa.webm',
  start: 0.28,
  end: 1.02,
  kana: 'かな',
  ...over,
});

describe('indexes — timing from the verified query', () => {
  it('m boundaries end within 40 ms of the query duration (guard + pre + morae + pauses, post excluded)', () => {
    for (const name of ['line-pause', 'line-long', 'gakusei', 'line-ken']) {
      const f = fixture(name);
      const m = moraBoundaries(f.query);
      expect(m.length).toBe(f.query.accent_phrases.reduce((n, p) => n + p.moras.length, 0));
      const expectedEnd = (GUARD_SECONDS + queryDuration(f.query) - f.query.postPhonemeLength / f.query.speedScale) * 1000;
      expect(Math.abs((m[m.length - 1] as number) - expectedEnd), name).toBeLessThanOrEqual(40);
      for (let i = 1; i < m.length; i++) expect(m[i]).toBeGreaterThanOrEqual(m[i - 1] as number);
    }
  });

  it('a pause_mora is folded into the preceding boundary and the slow take stretches every boundary by 1 / 0.85', () => {
    const f = fixture('line-pause'); // ハイ、ワカリマシタ
    const m = moraBoundaries(f.query);
    const pause = f.query.accent_phrases[0]?.pause_mora?.vowel_length ?? 0;
    expect(pause).toBeGreaterThan(0);
    // boundary 2 (after イ) includes the pause: the gap to it is far larger than a mora
    expect((m[1] as number) - (m[0] as number)).toBeGreaterThan(pause * 1000);
    const slow = moraBoundaries({ ...f.query, speedScale: 0.85 });
    expect(slow[slow.length - 1]).toBeGreaterThan(m[m.length - 1] as number);
    expect(((slow[slow.length - 1] as number) - GUARD_SECONDS * 1000) / ((m[m.length - 1] as number) - GUARD_SECONDS * 1000)).toBeCloseTo(1 / 0.85, 2);
  });

  it('c boundaries land on pause_mora and on 。、 of the kana; the last entry is the mora count', () => {
    const f = fixture('line-pause');
    expect(clauseBoundaries(f.query, f.kana)).toEqual([2, 8]); // はい | わかりました
    const g = fixture('line-long');
    expect(clauseBoundaries(g.query, g.kana)).toEqual([5, 21]); // すみません | このでんしゃはとうきょうにいきますか
    expect(clauseBoundaries(undefined, 'きょうはあめです。')).toEqual([7]);
    expect(clauseBoundaries(undefined, 'ちょっと、まって！いま、いく。')).toEqual([3, 6, 8, 10]);
    expect(clauseBoundaries(undefined, '')).toEqual([]);
  });

  it('an ellipsis (… ‥ —) is a clause mark and never a mora, like every other normalizeJa punctuation, so c always indexes m', () => {
    expect(clauseBoundaries(undefined, 'まあ…いいです。')).toEqual([2, 6]); // まあ | いいです — 6 morae, not 7
    expect(lenientMorae('まあ…いいです。').length).toBe(6);
    expect(clauseBoundaries(undefined, 'よし。……きのうよりかるい。')).toEqual([2, 10]);
    expect(clauseBoundaries(undefined, '「けんは？」「……。」')).toEqual([3]);
    expect(clauseBoundaries(undefined, 'いらっしゃい。ふたり？おく、すわれるよ。……リョウ、ちょっとつめて。')).toEqual([5, 8, 10, 15, 17, 23]); // っ and しゃ are one mora each
    expect(moraTotal('いらっしゃい。ふたり？おく、すわれるよ。……リョウ、ちょっとつめて。')).toBe(23);
    expect(clauseBoundaries(undefined, 'ええと—そうですね〜。')).toEqual([3, 8]);
    expect(clauseBoundaries(undefined, 'え・え・と・、ね')).toEqual([3, 4]); // ・ is dropped, not a clause
    for (const k of ['まあ…いいです。', 'よし。……きのうよりかるい。', '「けんは？」「……。」', 'ええと—そうですね〜。', 'きゃーっ、ねえ。']) {
      const c = clauseBoundaries(undefined, k);
      expect(c[c.length - 1], k).toBe(lenientMorae(k).length);
    }
  });

  it('moraTotal and clauseBoundaries count ONE body (spokenKana): a clause mark outside RE_NOT_MORA — ASCII , . ! ? and ～ (U+FF5E, which NFKC folds to ~) — is a cut and never a mora, even on kana V10 would reject, so c[last] === moraTotal and both equal lenientMorae', () => {
    for (const k of ['はい, わかりました.', 'ええと～そうですね!', 'そう?いや…ちがう', 'え—と、ね', 'まって！　いま，いく．']) {
      const c = clauseBoundaries(undefined, k);
      expect(c[c.length - 1], k).toBe(moraTotal(k));
      expect(moraTotal(k), k).toBe(lenientMorae(k).length);
    }
    expect(moraTotal('はい, わかりました.')).toBe(8);
    expect(clauseBoundaries(undefined, 'はい, わかりました.')).toEqual([2, 8]);
    expect(moraTotal('ええと～そうですね!')).toBe(8);
    expect(clauseBoundaries(undefined, 'ええと～そうですね!')).toEqual([3, 8]);
  });

  it('on a verified query the last c entry equals m.length (every fixture); over the shipped corpus every story line satisfies c[last] === lenientMorae(kana).length', () => {
    for (const name of ['line-pause', 'line-long', 'line-ken', 'gakusei', 'gontazaka', 'hai', 'nichiyobi', 'mainichi']) {
      const f = fixture(name);
      expect(verifyMorae(f.query, f.kana).ok, name).toBe(true);
      const c = clauseBoundaries(f.query, f.kana);
      expect(c[c.length - 1], name).toBe(moraBoundaries(f.query).length);
    }
    if (!existsSync(join(CONTENT_ROOT, 'manifest.json'))) return;
    let lines = 0;
    let withEllipsis = 0;
    for (const p of walk(join(CONTENT_ROOT, 'stories'))) {
      for (const s of (JSON.parse(readFileSync(p, 'utf8')) as ContentFile<StoryItem>).items) {
        for (const l of s.lines) {
          lines++;
          if (/[…‥]/.test(l.kana)) withEllipsis++;
          const c = clauseBoundaries(undefined, l.kana);
          const want = lenientMorae(l.kana).length;
          expect(c[c.length - 1], `${s.id}: ${l.kana}`).toBe(want);
          for (let i = 1; i < c.length; i++) expect(c[i], l.kana).toBeGreaterThan(c[i - 1] as number);
        }
      }
    }
    expect(lines).toBeGreaterThan(4000);
    expect(withEllipsis).toBeGreaterThan(30); // the lines the old counter got wrong
  });
});

describe('indexes — keys and hashes', () => {
  it('fnv1a32 is the shared hash and byText keys are hex8 of the spoken text', () => {
    for (const s of ['', 'はい、分かりました。', 'すみません、この電車は東京に行きますか。', 'abc']) expect(fnv1a32(s)).toBe(hashString(s));
    expect(textKey('今日は雨です。')).toBe(hashString('今日は雨です。').toString(16).padStart(8, '0'));
    expect(textKey('今日は雨です。')).toMatch(/^[0-9a-f]{8}$/);
    expect(kanaHash('あめ')).toBe(textKey('あめ'));
  });

  it('beltOfStation follows BELTS', () => {
    expect(beltOfStation(1)).toBe('white');
    expect(beltOfStation(4)).toBe('yellow');
    expect(beltOfStation(17)).toBe('green');
    expect(beltOfStation(53)).toBe('black');
  });
});

describe('indexes — buildIndexes shapes (docs/AUDIO_PACK.md §3)', () => {
  const line = fixture('line-pause');
  const ken = fixture('line-ken');
  const clips: RenderedClip[] = [
    clip({ key: 'v-n5-0001', kind: 'word', kana: 'はい', pitchVerified: true }),
    clip({ key: 'j-日#ex0', kind: 'word', kana: 'にちようび', start: 2, end: 3 }),
    clip({ key: 'k-h-a', kind: 'word', level: 'kana', station: 1, kana: 'あ', file: 'sprites/s01/words-01-bbbbbbbb.webm' }),
    clip({ key: 'g-n5-001#ex0', kind: 'sentence', kana: 'わたしはがくせいです。', text: '私は学生です。', file: 'sprites/s04/grammar-01-cccccccc.webm', query: fixture('gakusei').query }),
    clip({ key: 'g-n5-001#ex0', kind: 'sentence', kana: 'わたしはがくせいです。', text: '私は学生です。', file: 'sprites/s04/grammar-01-cccccccc.webm', rate: 0.85, start: 10, end: 12, query: { ...fixture('gakusei').query, speedScale: 0.85 } }),
    clip({ key: 'v-n5-0001#def', kind: 'ear', kana: 'そうだというへんじ', text: 'そうだという返事', file: 'sprites/s04/ear-01-dddddddd.webm' }),
    clip({ key: 's-04-1#L0', kind: 'line', level: null, kana: line.kana, text: line.text, file: 'sprites/s04/s-04-1-eeeeeeee.webm', start: 0.28, end: 3.1, query: line.query, textId: 's-04-1', lineIndex: 0, lineCount: 2 }),
    clip({ key: 's-04-1#L1', kind: 'line', level: null, kana: ken.kana, text: ken.text, voice: 'VOICEVOX:玄野武宏', file: 'sprites/s04/s-04-1-eeeeeeee.webm', start: 3.4, end: 4.5, query: ken.query, textId: 's-04-1', lineIndex: 1, lineCount: 2 }),
    clip({ key: 's-04-1#L0', kind: 'line', level: null, kana: line.kana, text: line.text, file: 'sprites/s04/s-04-1-eeeeeeee.webm', start: 4.8, end: 8.1, rate: 0.85, query: { ...line.query, speedScale: 0.85 }, textId: 's-04-1', lineIndex: 0, lineCount: 2 }),
    clip({ key: 'm-04-1', kind: 'misc', level: null, kana: 'ごんたざか', file: 'sprites/s04/misc-01-ffffffff.webm' }),
    // A long two-clause sentence (over DICTATION_MAX_MORAE) and a short two-clause one: only the long one carries c.
    clip({ key: 'g-n5-002#ex0', kind: 'sentence', kana: 'きのうはともだちとえいがをみて、そのあとレストランでばんごはんをたべました。', text: '昨日は友達と映画を見て、その後レストランで晩ご飯を食べました。', file: 'sprites/s04/grammar-01-cccccccc.webm', start: 20, end: 26 }),
    clip({ key: 'g-n5-003#ex0', kind: 'sentence', kana: 'はい、そうです。', text: 'はい、そうです。', file: 'sprites/s04/grammar-01-cccccccc.webm', start: 30, end: 31 }),
  ];
  const files = buildIndexes(clips, [{ key: 'track:row-h-a', title: 'あ行', titleEn: 'the vowel row', file: 'sprites/kana/row-h-a-12345678.webm', start: 0.28, end: 4, voice: 'VOICEVOX:九州そら', rate: 1, station: 1, segments: [{ s: 0.28, e: 1, text: 'あ', en: 'a' }] }], 'a-test000001');
  const by = (p: string) => files.find((f) => f.path === p)?.json;

  it('writes one file per level kind, one stories file per station, the tracks file and the check-only kana sidecar', () => {
    expect(files.map((f) => f.path).sort()).toEqual(['kana.json', 'kana/tracks.json', 'kana/words.json', 'n5/ear.json', 'n5/sentences.json', 'n5/words.json', 's04/stories.json']);
  });

  it('words.json: cues keyed by item id (never kana), file / voice tables, pv only when true, no byText, and NO kana hash on the cue', () => {
    const w = by('n5/words.json') as CueIndex;
    expect(w.kind).toBe('words');
    expect(Object.keys(w.cues).sort()).toEqual(['j-日#ex0', 'v-n5-0001']);
    expect(w.cues['v-n5-0001']).toEqual([{ f: 0, s: 0.28, e: 1.02, v: 0, r: 1, pv: true }]);
    expect(w.cues['j-日#ex0']?.[0]?.pv).toBeUndefined();
    expect(w.files).toEqual(['sprites/s04/words-01-aaaaaaaa.webm']);
    expect(w.voices).toEqual(['VOICEVOX:九州そら']);
    expect(w.byText).toBeUndefined();
    expect((by('kana/words.json') as CueIndex).cues['k-h-a']?.[0]?.f).toBe(0);
    expect(JSON.stringify(w)).not.toContain('"k":');
  });

  it('kana.json: every clip key → hex8 of the kana it was verified against (the runtime never fetches it; audio:check and the content diff read it)', () => {
    const k = kanaSidecarOf(files);
    expect(k?.kind).toBe('kana');
    expect(k?.keys['v-n5-0001']).toBe(kanaHash('はい'));
    expect(k?.keys['j-日#ex0']).toBe(kanaHash('にちようび'));
    expect(k?.keys['s-04-1#L1']).toBe(kanaHash(ken.kana));
    expect(k?.keys['m-04-1']).toBe(kanaHash('ごんたざか'));
    expect(Object.keys(k?.keys ?? {}).length).toBe(new Set(clips.map((c) => c.key)).size);
    expect(Object.keys(k?.keys ?? {})).toEqual([...Object.keys(k?.keys ?? {})].sort());
    expect(indexBudgetFindings(files).find((f) => f.path === KANA_SIDECAR)).toBeUndefined(); // never budgeted
    // The content diff between two sidecars: new or re-kana'd keys over the current keys.
    const cur = k?.keys ?? {};
    expect(kanaDiffShare(cur, cur)).toBe(0);
    expect(kanaDiffShare(cur, null)).toBeNull();
    expect(kanaDiffShare({}, cur)).toBeNull();
    const n = Object.keys(cur).length;
    expect(kanaDiffShare({ ...cur, 'v-n5-0001': 'ffffffff' }, cur)).toBeCloseTo(1 / n, 4);
    expect(kanaDiffShare({ ...cur, 'v-n5-9999': 'ffffffff' }, cur)).toBeCloseTo(1 / (n + 1), 4);
  });

  it('sentences.json: two cues per key (r 1 first, 0.85 second), byText from the spoken text, c only on a sentence over DICTATION_MAX_MORAE with clauses', () => {
    const s = by('n5/sentences.json') as CueIndex;
    expect(s.cues['g-n5-001#ex0']?.map((c) => c.r)).toEqual([1, 0.85]);
    expect(s.byText).toEqual({ [textKey(textToSpeak('私は学生です。'))]: 'g-n5-001#ex0', [textKey('昨日は友達と映画を見て、その後レストランで晩ご飯を食べました。')]: 'g-n5-002#ex0', [textKey('はい、そうです。')]: 'g-n5-003#ex0' });
    expect(s.cues['g-n5-001#ex0']?.[0]?.c).toBeUndefined(); // one clause → no c
    expect(s.cues['g-n5-001#ex0']?.[0]?.m).toBeUndefined(); // m is for story lines only
    expect(moraTotal('きのうはともだちとえいがをみて、そのあとレストランでばんごはんをたべました。')).toBeGreaterThan(DICTATION_MAX_MORAE);
    expect(s.cues['g-n5-002#ex0']?.[0]?.c).toEqual([15, 36]); // dictable by clause
    expect(s.cues['g-n5-003#ex0']?.[0]?.c).toBeUndefined(); // two clauses but 7 morae: dictated whole, no c
  });

  it('#col / #def cues land in ear.json only', () => {
    const e = by('n5/ear.json') as CueIndex;
    expect(Object.keys(e.cues)).toEqual(['v-n5-0001#def']);
    expect(Object.keys((by('n5/words.json') as CueIndex).cues)).not.toContain('v-n5-0001#def');
    expect(Object.keys((by('n5/sentences.json') as CueIndex).cues)).not.toContain('v-n5-0001#def');
  });

  it('stories.json: one file per text, whole over the r-1 lines, line cues with m and c, misc, byText for lines only', () => {
    const st = by('s04/stories.json') as StoriesIndex;
    expect(st.scope).toBe('s04');
    const t = st.texts['s-04-1'];
    expect(t?.f).toBe(st.files.indexOf('sprites/s04/s-04-1-eeeeeeee.webm'));
    expect(t?.whole).toEqual({ s: 0.28, e: 4.5 }); // the slow take at 4.8–8.1 is outside the whole track
    expect(t?.lines.length).toBe(2);
    expect(t?.lines[0]?.map((c) => c.r)).toEqual([1, 0.85]);
    expect(t?.lines[0]?.[0]?.m).toEqual(moraBoundaries(line.query));
    expect(t?.lines[0]?.[0]?.c).toEqual([2, 8]);
    expect(t?.lines[0]?.[0]?.f).toBeUndefined(); // the text's f applies to every line
    expect(t?.lines[1]?.[0]?.v).toBe(st.voices.indexOf('VOICEVOX:玄野武宏'));
    expect(st.misc['m-04-1']?.[0]?.f).toBe(st.files.indexOf('sprites/s04/misc-01-ffffffff.webm'));
    expect(st.byText).toEqual({ [textKey(line.text)]: 's-04-1#L0', [textKey(ken.text)]: 's-04-1#L1' });
    expect(JSON.stringify(st)).not.toContain('"k":');
  });

  it('a text with a skipped line keeps lines.length = the story line count, an empty entry for the hole, and NO whole track (null): Radio never jumps a line', () => {
    const three = (over: Partial<RenderedClip>) => clip({ key: 's-05-1#L0', kind: 'line', level: null, station: 5, kana: line.kana, text: line.text, file: 'sprites/s05/s-05-1-aaaaaaaa.webm', query: line.query, textId: 's-05-1', lineCount: 3, ...over });
    const holed = buildIndexes([three({ key: 's-05-1#L0', lineIndex: 0, start: 0.28, end: 2 }), three({ key: 's-05-1#L2', lineIndex: 2, start: 2.3, end: 4 }), three({ key: 's-05-1#L0', lineIndex: 0, rate: 0.85, start: 4.3, end: 6 })], [], 'a-x');
    const t = (holed.find((f) => f.path === 's05/stories.json')?.json as StoriesIndex).texts['s-05-1'];
    expect(t?.lines.length).toBe(3);
    expect(t?.lines[1]).toEqual([]);
    expect(t?.whole).toBeNull();
    expect(t?.lines[2]?.[0]?.s).toBe(2.3);
    // The same text with every line present has its whole track.
    const full = buildIndexes([three({ key: 's-05-1#L0', lineIndex: 0, start: 0.28, end: 2 }), three({ key: 's-05-1#L1', lineIndex: 1, start: 2.3, end: 4 }), three({ key: 's-05-1#L2', lineIndex: 2, start: 4.3, end: 6 })], [], 'a-x');
    expect((full.find((f) => f.path === 's05/stories.json')?.json as StoriesIndex).texts['s-05-1']?.whole).toEqual({ s: 0.28, e: 6 });
    // The last line skipped: lines still has 3 entries (not 2) and whole is null.
    const tail = buildIndexes([three({ key: 's-05-1#L0', lineIndex: 0, start: 0.28, end: 2 }), three({ key: 's-05-1#L1', lineIndex: 1, start: 2.3, end: 4 })], [], 'a-x');
    const tt = (tail.find((f) => f.path === 's05/stories.json')?.json as StoriesIndex).texts['s-05-1'];
    expect(tt?.lines.length).toBe(3);
    expect(tt?.whole).toBeNull();
  });

  it('byText carries both spoken forms when the kana changes what a caller hashes (a punctuation-less short text)', () => {
    const files2 = buildIndexes([clip({ key: 's-08-3#L13', kind: 'line', level: null, station: 8, kana: 'おおいそ、かとう', text: 'おおいそ、かとう', textAlt: '大磯、加藤', file: 'sprites/s08/s-08-3-aaaaaaaa.webm', query: fixture('line-pause').query, textId: 's-08-3', lineIndex: 13, lineCount: 14 })], [], 'a-x');
    const st = files2.find((f) => f.path === 's08/stories.json')?.json as StoriesIndex;
    expect(st.byText).toEqual({ [textKey(textToSpeak('大磯、加藤', 'おおいそ、かとう'))]: 's-08-3#L13', [textKey(textToSpeak('大磯、加藤'))]: 's-08-3#L13' });
    expect(Object.keys(st.byText).length).toBe(2);
  });

  it('tracks.json rows are full TrackCues with segments', () => {
    const tr = by('kana/tracks.json') as TracksIndex;
    expect(tr.tracks[0]).toEqual({ key: 'track:row-h-a', title: 'あ行', titleEn: 'the vowel row', file: 'sprites/kana/row-h-a-12345678.webm', start: 0.28, end: 4, voice: 'VOICEVOX:九州そら', rate: 1, segments: [{ s: 0.28, e: 1, text: 'あ', en: 'a' }] });
  });

  it('is deterministic whatever the input order', () => {
    const again = buildIndexes([...clips].reverse(), [], 'a-test000001');
    for (const f of again) expect(serializeIndex(f.json)).toBe(serializeIndex(by(f.path) as object));
  });

  it('budget findings: a level file over 350 KB is an error, a station file over 64 KB a warning', () => {
    const big: RenderedClip[] = [];
    for (let i = 0; i < 9000; i++) big.push(clip({ key: `v-n5-${String(i).padStart(4, '0')}#ex0`, kind: 'sentence', text: `文${i}`, kana: `ぶん${i}` }));
    const f = indexBudgetFindings(buildIndexes(big, [], 'a-x'));
    expect(f.map((x) => x.level)).toEqual(['error']);
    expect(f[0]?.limit).toBe(MAX_LEVEL_INDEX_BYTES);
    const lines: RenderedClip[] = [];
    for (let i = 0; i < 900; i++) lines.push(clip({ key: `s-04-1#L${i}`, kind: 'line', level: null, kana: line.kana, text: `${line.text}${i}`, query: line.query, textId: 's-04-1', lineIndex: i, lineCount: 900 }));
    const g = indexBudgetFindings(buildIndexes(lines, [], 'a-x'));
    expect(g.map((x) => [x.level, x.limit])).toEqual([['warn', MAX_STATION_INDEX_BYTES]]);
  });
});

describe('indexes — the level budgets over the shipped corpus (dry run, core + pool: the T1 + T2 indexes)', () => {
  it('every level file stays ≤ 350 KB with the pools on disk — n3/sentences.json included — and no budget finding is an error', async () => {
    const root = CONTENT_ROOT;
    if (!existsSync(join(root, 'manifest.json'))) return;
    const tmp = mkdtempSync(join(tmpdir(), 'tsuzuku-idx-'));
    try {
      const r = await renderAudio({ root, out: join(tmp, 'audio'), cache: join(tmp, 'cache'), castPath: join(here, 'cast.json'), tiers: ['core', 'pool'], engines: [], dryRun: true, fixtures: join(here, '__fixtures__'), ffmpeg: 'ffmpeg', dict: 'high', prune: false, log: () => {} });
      expect(r.manifest.partial).toBeNull();
      const levels = r.indexes.filter((f) => /^n[1-5]\//.test(f.path));
      expect(levels.map((f) => f.path)).toContain('n3/sentences.json');
      expect(levels.map((f) => f.path)).toContain('n5/sentences.json');
      for (const f of levels) expect(Buffer.byteLength(serializeIndex(f.json)), f.path).toBeLessThanOrEqual(MAX_LEVEL_INDEX_BYTES);
      expect(indexBudgetFindings(r.indexes).filter((f) => f.level === 'error')).toEqual([]);
      const pools = walk(join(root, 'listening')).filter((p) => /pool-\d\d\.json$/.test(p)).length;
      if (pools > 0) {
        // The pool tier really landed: n3 holds thousands of example-sentence cues, and the shipped pool sentences carry no c (none is dictated by clause).
        const n3 = r.indexes.find((f) => f.path === 'n3/sentences.json')?.json as CueIndex;
        expect(Object.keys(n3.cues).length).toBeGreaterThan(2000);
        const all = Object.values(n3.cues).flat();
        const withC = all.filter((c) => c.c);
        expect(withC.length).toBeGreaterThan(0);
        expect(withC.length).toBeLessThan(all.length);
        for (const c of withC) {
          expect(c.c!.length).toBeGreaterThan(1);
          expect(c.c![c.c!.length - 1]).toBeGreaterThan(DICTATION_MAX_MORAE);
        }
      }
      const words = r.indexes.find((f) => f.path === 'n5/words.json')?.json as CueIndex;
      expect(Object.keys(words.cues).length).toBeGreaterThan(500);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 180_000);
});

describe('indexes — manifest helpers', () => {
  const files: ManifestFileEntry[] = [
    { path: 'sprites/s01/words-01-a.webm', bytes: 1000, seconds: 10, clips: 5, belt: 'white', tier: 'core' },
    { path: 'sprites/s04/s-04-1-b.webm', bytes: 3000, seconds: 30.5, clips: 12, belt: 'yellow', tier: 'core' },
    { path: 'sprites/s04/words-01-c.webm', bytes: 2000, seconds: 20, clips: 7, belt: 'yellow', tier: 'core' },
  ];

  it('belt sums equal the files sums', () => {
    const { belts, totals } = beltTotals(files, 24);
    expect(belts).toEqual({ white: { bytes: 1000, seconds: 10, files: 1 }, yellow: { bytes: 5000, seconds: 50.5, files: 2 } });
    expect(totals).toEqual({ bytes: 6000, seconds: 60.5, files: 3, clips: 24 });
  });

  it('reusedBytesShare is the share of bytes whose path already existed; null without a previous manifest', () => {
    expect(reusedBytesShare(files, null)).toBeNull();
    const previous = { files: [files[0] as ManifestFileEntry, { ...(files[1] as ManifestFileEntry), path: 'sprites/s04/s-04-1-OLD.webm' }] } as Pick<AudioManifest, 'files'>;
    expect(reusedBytesShare(files, previous)).toBeCloseTo(1000 / 6000, 4);
    expect(reusedBytesShare(files, { files })).toBe(1);
    expect(reusedBytesShare([], { files })).toBeNull();
  });

  it('audioVersion embeds contentVersion, cast, engine, dictionary and tiers', () => {
    const base = { contentVersion: 'c-1', castSha: 'cast', engine: 'VOICEVOX 0.25.2', dictVersion: 'd-1', tiers: ['core'] };
    const v = audioVersionOf(base, sha256Hex);
    expect(v).toMatch(/^a-[0-9a-f]{10}$/);
    expect(audioVersionOf({ ...base, tiers: ['core'] }, sha256Hex)).toBe(v);
    expect(audioVersionOf({ ...base, contentVersion: 'c-2' }, sha256Hex)).not.toBe(v);
    expect(audioVersionOf({ ...base, dictVersion: 'd-2' }, sha256Hex)).not.toBe(v);
    expect(audioVersionOf({ ...base, tiers: ['pool', 'core'] }, sha256Hex)).not.toBe(v);
  });
});
