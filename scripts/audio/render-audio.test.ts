import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StoryItem, StoryLine } from '../../src/content/types.ts';
import { synthesizeMinimalPair as learnSynthesizeMinimalPair } from '../../src/learn/distractors.ts';
import { type AudioManifest, type CueIndex, type KanaIndex, type StoriesIndex, KANA_SIDECAR, kanaHash } from './indexes.ts';
import {
  type CastFile,
  type ClipSpec,
  type Corpus,
  type DictEntry,
  type Engine,
  clipId,
  clipIdOf,
  DICT_TOUCH_ENTRY,
  dictionaryEntries,
  dictVersionOf,
  EngineError,
  estimateQuery,
  inventory,
  isTransportError,
  loadCast,
  loadCorpus,
  Mutex,
  offendingWord,
  parseArgs,
  partialOf,
  renderAudio,
  renderOne,
  resolveVoices,
  shardAcrossEngines,
  type SkipRecord,
  type SpeakerInfo,
  SLOW_RATE,
  spokenForms,
  syncDictionary,
  wordText,
} from './render-audio.ts';
import { MAX_MIXED_SECONDS, wrapWav } from './sprites.ts';
import { type AudioQuery, queryDuration, synthesizeMinimalPair, verifyMorae } from './verify.ts';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..');
const FIXTURES = join(here, '__fixtures__');
const CONTENT = join(FIXTURES, 'content');
const CAST = join(here, 'cast.json');
const speakers = JSON.parse(readFileSync(join(FIXTURES, 'speakers.json'), 'utf8')) as SpeakerInfo[];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function copyDir(from: string, to: string): void {
  for (const name of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, name.name);
    const dst = join(to, name.name);
    if (name.isDirectory()) {
      copyDir(src, dst);
      continue;
    }
    mkdirSync(to, { recursive: true });
    writeFileSync(dst, readFileSync(src));
  }
}

/** A VOICEVOX stand-in: records every call, holds a dictionary, answers queries through `query`. */
function fakeEngine(base: string, o: { events: string[]; query?: (text: string, dict: Set<string>) => AudioQuery; addDelayMs?: number; onCall?: () => void }): Engine {
  const dict = new Set<string>();
  const fake = {
    base,
    async audioQuery(text: string): Promise<AudioQuery> {
      o.onCall?.();
      o.events.push(`${base}:query`);
      return (o.query ?? ((t: string) => estimateQuery(t)))(text, dict);
    },
    async addWord(w: DictEntry): Promise<string> {
      o.onCall?.();
      o.events.push(`${base}:add:${w.surface}`);
      await sleep(o.addDelayMs ?? 5);
      dict.add(w.surface);
      return `id-${w.surface}`;
    },
    async deleteWord(id: string): Promise<void> {
      o.onCall?.();
      o.events.push(`${base}:del:${id.replace(/^id-/, '')}`);
      await sleep(1);
      dict.delete(id.replace(/^id-/, ''));
    },
    async accentPhrases(): Promise<never> {
      throw new Error('not reached');
    },
    async synthesis(): Promise<Buffer> {
      return wrapWav(Buffer.alloc(2400 * 2));
    },
    async userDict(): Promise<Record<string, { surface: string; pronunciation: string; accent_type: number; priority: number }>> {
      return {};
    },
  };
  return fake as unknown as Engine;
}

describe('render-audio — the consumed contract modules load under Node (ARCHITECTURE §0)', () => {
  it('import() of src/shared/speak-text.ts, src/shared/jp.ts, src/content/ruby.ts, src/content/types.ts, src/learn/distractors.ts and the pipeline itself succeeds in a bare node process', () => {
    const mods = ['src/shared/speak-text.ts', 'src/shared/jp.ts', 'src/content/ruby.ts', 'src/content/types.ts', 'src/learn/distractors.ts', 'scripts/audio/render-audio.ts', 'scripts/audio/verify.ts', 'scripts/audio/indexes.ts'];
    const code = `const names = ${JSON.stringify(mods)}; for (const n of names) { const m = await import(new URL(n, 'file://${REPO}/').href); if (Object.keys(m).length === 0) throw new Error(n); } console.log('ok');`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: REPO, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.stdout.trim()).toBe('ok');
    expect(r.status).toBe(0);
  }, 60_000);
});

describe('render-audio — cast', () => {
  const cast = loadCast(CAST);
  const voices = resolveVoices(cast, speakers);

  it('resolves every label to a permitted character with its style id from /speakers; the lead-fixed voices hold', () => {
    const restricted = new Set(['青山龍星', '後鬼', 'もち子さん', 'ユーレイちゃん', 'No.7', 'Voidoll', 'ぞん子']);
    for (const v of voices.values()) {
      expect(restricted.has(v.character), v.label).toBe(false);
      expect(v.styleId).toBeGreaterThanOrEqual(0);
      expect(v.credit).toBe(`VOICEVOX:${v.character}`);
    }
    expect(voices.get('ハナ')).toMatchObject({ character: '九州そら', styleId: 16 });
    expect(voices.get('ハナ')?.emotionIds).toEqual({ warm: 15, annoyed: 18, whisper: 19 });
    expect(voices.get('ケン')).toMatchObject({ character: '玄野武宏', styleId: 11 });
    expect(voices.get('田中さん')).toMatchObject({ character: 'ちび式じい', styleId: 42 });
    expect(voices.get('anchor')?.character).toBe('波音リツ');
    expect(voices.get('lecturer')?.character).toBe('麒ヶ島宗麟');
    expect(voices.get('reader')?.character).toBe('冥鳴ひまり');
  });

  it('covers every speaker and narrator of the shipped corpus and the 13 pre-announced locals; two speakers of one text never share a character', () => {
    const corpus = loadCorpus(join(REPO, 'public', 'content'));
    const labels = new Set<string>();
    for (const s of corpus.stories) {
      const seen = new Map<string, string>();
      const own = new Set(s.lines.map((l) => l.speaker).filter((x): x is string => !!x));
      if (s.narrator) own.add(s.narrator);
      for (const n of own) {
        labels.add(n);
        const v = voices.get(n);
        expect(v, `${s.id}: ${n} is not in cast.json`).toBeDefined();
        if (!v) continue;
        expect(seen.get(v.character), `${s.id}: ${n} and ${seen.get(v.character)} share ${v.character}`).toBeUndefined();
        seen.set(v.character, n);
      }
    }
    expect(labels.size).toBeGreaterThanOrEqual(46);
    for (const n of ['anchor', 'lecturer', 'reader', '佐藤さん', '山口さん', '中村さん', 'アヤ', '渡辺さん', '坂本さん', '川村さん', '松井さん', '大久保さん', '石川さん', '高木さん', '西村さん', '岡本さん']) expect(voices.has(n), n).toBe(true);
    // Planned pieces (docs/LISTENING_BRIEF.md §15) never put two locals on one character either.
    const rows = readFileSync(join(REPO, 'docs', 'LISTENING_BRIEF.md'), 'utf8')
      .split('\n')
      .filter((l) => /^\| \d+ \|/.test(l));
    expect(rows.length).toBe(100);
    for (const row of rows) {
      const cells = row.split('|').map((c) => c.trim());
      const id = (cells[3] ?? '').replace(/`/g, '');
      const names = (cells[5] ?? '')
        .split('·')
        .slice(1)
        .map((s) => s.trim().replace(/\s*\(new:[^)]*\)/, '').replace(/^narrator\s+/, '').trim())
        .filter(Boolean);
      const seen = new Map<string, string>();
      for (const n of names) {
        const v = voices.get(n);
        expect(v, `${id}: ${n}`).toBeDefined();
        if (!v) continue;
        expect(seen.get(v.character), `${id}: ${n} and ${seen.get(v.character)} share ${v.character}`).toBeUndefined();
        seen.set(v.character, n);
      }
    }
  });

  it('every cast entry has the design 08 §6 shape', () => {
    const file = JSON.parse(readFileSync(CAST, 'utf8')) as CastFile;
    expect(file.schema).toBe('tsuzuku.cast/1');
    for (const e of file.speakers) {
      expect(e).toMatchObject({ name: expect.any(String), gender: expect.stringMatching(/^[mf]$/), age: expect.any(Number), character: expect.any(String), style: expect.any(String), credit: `VOICEVOX:${e.character}` });
    }
    expect(file.speakers.filter((e) => e.age <= 12).map((e) => e.name).sort()).toEqual(['アヤ', 'ミキ', 'ユウ', 'ユウタ']);
  });
});

describe('render-audio — inventory and clip ids', () => {
  const corpus: Corpus = loadCorpus(CONTENT);
  const specs = inventory(corpus, { tiers: new Set(['core', 'pool', 'ear']) });
  const cast = loadCast(CAST);
  const voices = resolveVoices(cast, speakers);
  const dictVersion = dictVersionOf(dictionaryEntries(corpus, 'high'));

  it('a vocab word clip is keyed by item id and rendered from the word surface, never from kana', () => {
    const words = specs.filter((s) => s.kind === 'word' && /^v-/.test(s.key) && !s.key.includes('#'));
    expect(words.map((s) => s.key)).toEqual(['v-n5-0001', 'v-n5-0002', 'v-n5-0003', 'v-n5-0004', 'v-n5-0005', 'v-n5-0006', 'v-n5-0007', 'v-n5-0008']);
    const rain = words.find((s) => s.key === 'v-n5-0002');
    expect(rain?.text).toBe('雨');
    expect(rain?.kana).toBe('あめ');
    expect(rain?.pitchHigh).toBe(true);
    expect(words.some((s) => s.key === 'あめ' || s.key === s.kana)).toBe(false);
    expect(wordText('〜放題', 'ほうだい')).toBe('放題');
    expect(wordText('〜', 'なにか')).toBe('なにか');
  });

  it('kana names are flagged (the k-* items and the row / pair track segments that reuse them), their example words and the word tracks are not', () => {
    const one = (k: string) => specs.find((s) => s.key === k);
    expect(one('k-h-a')?.kanaName).toBe(true);
    expect(one('k-h-a#ex0')?.kanaName).toBeUndefined();
    const names = specs.filter((s) => s.kind === 'track' && s.kanaName === true);
    const words = specs.filter((s) => s.kind === 'track' && s.track?.startsWith('words-'));
    expect(names.length).toBeGreaterThan(0);
    expect(words.length).toBeGreaterThan(0);
    for (const s of names) expect(s.track, s.key).toMatch(/^(row|pairs|pair)-/);
    for (const s of words) expect(s.kanaName, s.key).toBeUndefined();
  });

  it('kanji example words reuse the vocab clip only when word AND kana match', () => {
    const ex = (k: string) => specs.find((s) => s.key === k);
    expect(ex('j-日#ex0')?.reuseOf).toBe('v-n5-0004'); // 日曜日 / にちようび matches
    expect(ex('j-日#ex1')?.reuseOf).toBeUndefined(); // 毎日 has no vocab clip
    expect(ex('j-日#ex2')?.reuseOf).toBeUndefined(); // 日 / にち vs vocab 日 / ひ: kana differs
    expect(ex('j-雨#ex0')?.reuseOf).toBe('v-n5-0002'); // 雨 / あめ — the rain item, not the candy
  });

  it('sentence clips of Stations 1–17 get a slow take; words and kana render once; keys follow design 08 §8', () => {
    const rates = (k: string) => specs.filter((s) => s.key === k).map((s) => s.rate);
    expect(rates('g-n5-001#ex0')).toEqual([1, SLOW_RATE]);
    expect(rates('s-04-1#L2')).toEqual([1, SLOW_RATE]);
    expect(rates('v-n5-0001')).toEqual([1]);
    expect(rates('k-h-a')).toEqual([1]);
    expect(rates('k-h-a#ex0')).toEqual([1]);
    expect(rates('m-04-1')).toEqual([1]);
    expect(rates('v-n5-0001#ex0')).toEqual([1, SLOW_RATE]); // pool tier: in pool-04
    expect(rates('v-n5-0002#ex0')).toEqual([]); // not in any pool → not rendered
    expect(rates('v-n5-0001#def')).toEqual([]);
    expect(rates('v-n5-0001#ga')).toEqual([1]);
    expect(specs.find((s) => s.key === 's-04-1#L1')).toMatchObject({ speaker: 'ケン', emotion: 'glad', textId: 's-04-1', lineIndex: 1, lineCount: 3, group: 's04/text/s-04-1' });
    expect(specs.find((s) => s.key === 's-04-2#L0')?.speaker).toBe('ハナ'); // a speaker-less diary text is ハナ
    expect(specs.filter((s) => s.kind === 'track').length).toBeGreaterThan(20);
    // The text handed to the engine is textToSpeak(toPlain(ja), kana) for a line — the plain surface for a real sentence.
    expect(specs.find((s) => s.key === 's-04-1#L0')?.text).toBe('はい、分かりました。');
    expect(specs.find((s) => s.key === 's-04-1#L0')?.textAlt).toBeUndefined();
  });

  it('every T3 vocab item gets a #pair clip: the partner the runtime synthesizes, keyed by the item, spoken from its kana in one voice at one rate', () => {
    const pairs = specs.filter((s) => s.key.endsWith('#pair'));
    expect(pairs.map((s) => s.key)).toEqual(corpus.vocab.map((v) => `${v.id}#pair`));
    const hai = pairs.find((s) => s.key === 'v-n5-0001#pair')!;
    expect(hai).toMatchObject({ kind: 'word', tier: 'ear', level: 'n5', text: 'はっい', kana: 'はっい', speaker: 'ハナ', rate: 1, group: 's04/ear' });
    for (const p of pairs) {
      const v = corpus.vocab.find((x) => `${x.id}#pair` === p.key)!;
      expect(p.text).toBe(synthesizeMinimalPair(v.kana));
      expect(p.kana).not.toBe(v.kana);
    }
    expect(inventory(corpus, { tiers: new Set(['core']) }).some((s) => s.key.endsWith('#pair'))).toBe(false); // T3 only
  });

  it('the #pair partner generator is src/learn/distractors.ts itself (verify.ts re-exports it: one body for the drill and the pack), and the っ rule holds on the edge cases', () => {
    expect(synthesizeMinimalPair).toBe(learnSynthesizeMinimalPair);
    expect(synthesizeMinimalPair('コーヒー')).toBe('こーっひー'); // never っ before ー
    expect(synthesizeMinimalPair('ほん')).toBe('ぼん'); // never っ before ん: a same-mora-count near miss
    for (const k of ['きって', 'きて', 'か', 'ん', 'っ', 'おばあさん', 'アーカイブ', 'きゃく', 'ゔ', 'ー']) expect(synthesizeMinimalPair(k), k).not.toBe(k);
  });

  it('spokenForms: the engine text is textToSpeak(plain, kana); a punctuation-less short text also records the kana-less form for byText', () => {
    expect(spokenForms('はい、{分|わ}かりました。', 'はい、わかりました。')).toEqual({ text: 'はい、分かりました。' });
    expect(spokenForms('{大磯|おおいそ}、{加藤|かとう}', 'おおいそ、かとう')).toEqual({ text: 'おおいそ、かとう', textAlt: '大磯、加藤' });
    expect(spokenForms('{掛川城公園事務所|かけがわじょうこうえんじむしょ}', 'かけがわじょうこうえんじむしょ')).toEqual({ text: 'かけがわじょうこうえんじむしょ', textAlt: '掛川城公園事務所' });
    expect(spokenForms('〜放題', 'ほうだい')).toEqual({ text: 'ほうだい', textAlt: '放題' });
  });

  it('clip ids are stable across runs and change when pitch or speedScale change', () => {
    const a = clipId({ styleId: 16, dictVersion, text: '雨', kana: 'あめ', speedScale: 1, accentOverride: 'accent=1' });
    const b = clipId({ styleId: 16, dictVersion, text: '雨', kana: 'あめ', speedScale: 1, accentOverride: 'accent=1' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(clipId({ styleId: 16, dictVersion, text: '雨', kana: 'あめ', speedScale: 1, accentOverride: 'accent=0' })).not.toBe(a);
    expect(clipId({ styleId: 16, dictVersion, text: '雨', kana: 'あめ', speedScale: 0.85, accentOverride: 'accent=1' })).not.toBe(a);
    expect(clipId({ styleId: 16, dictVersion, text: '雨', kana: 'あめ', speedScale: 1, pitchScale: 0.1, accentOverride: 'accent=1' })).not.toBe(a);
    expect(clipId({ styleId: 16, dictVersion: 'd-other', text: '雨', kana: 'あめ', speedScale: 1, accentOverride: 'accent=1' })).not.toBe(a);
    const rain = specs.find((s) => s.key === 'v-n5-0002')!;
    const candy = specs.find((s) => s.key === 'v-n5-0003')!;
    expect(clipIdOf(rain, voices, dictVersion)).not.toBe(clipIdOf(candy, voices, dictVersion)); // same surface sound, different pitch → different clips
    expect(clipIdOf(rain, voices, dictVersion)).toBe(clipIdOf({ ...rain }, voices, dictVersion));
    // A kana NAME of は / へ takes its own id (the strict-fold re-render); every other kana name keeps the id it had.
    const kana = (key: string, k: string, kanaName?: boolean): ClipSpec => ({ key, kind: 'word', tier: 'core', level: 'kana', station: 1, text: k, kana: k, speaker: 'ハナ', rate: 1, group: 's01/words', ...(kanaName ? { kanaName } : {}) });
    expect(clipIdOf(kana('k-h-ha', 'は', true), voices, dictVersion)).not.toBe(clipIdOf(kana('k-h-ha', 'は'), voices, dictVersion));
    expect(clipIdOf(kana('k-h-he', 'へ', true), voices, dictVersion)).not.toBe(clipIdOf(kana('k-h-he', 'へ'), voices, dictVersion));
    expect(clipIdOf(kana('k-h-a', 'あ', true), voices, dictVersion)).toBe(clipIdOf(kana('k-h-a', 'あ'), voices, dictVersion));
    expect(clipIdOf(kana('k-h-wo', 'を', true), voices, dictVersion)).toBe(clipIdOf(kana('k-h-wo', 'を'), voices, dictVersion));
    expect(clipId({ styleId: 16, dictVersion, text: 'は', kana: 'は', speedScale: 1, readingOverride: '' })).toBe(clipId({ styleId: 16, dictVersion, text: 'は', kana: 'は', speedScale: 1 }));
  });

  it('dictionary entries: the words the app grades (high) by default, with accent_type = pitch; the version hashes them', () => {
    const high = dictionaryEntries(corpus, 'high');
    expect(high.map((e) => e.surface)).toEqual(['日曜日', '雨', '飴']); // はい is kana-written and needs no entry
    expect(high.find((e) => e.surface === '雨')).toEqual({ surface: '雨', pronunciation: 'アメ', accent_type: 1, word_type: 'COMMON_NOUN', priority: 5 });
    expect(high.find((e) => e.surface === '飴')?.accent_type).toBe(0);
    expect(dictionaryEntries(corpus, 'all').map((e) => e.surface)).toEqual(['二分', '何でも', '学生', '日曜日', '雨', '飴']);
    expect(dictionaryEntries(corpus, 'none')).toEqual([]);
    expect(dictVersion).toMatch(/^d-[0-9a-f]{10}$/);
    expect(dictVersionOf(dictionaryEntries(corpus, 'all'))).not.toBe(dictVersion);
  });

  it('offendingWord maps the first differing mora of a line to the vocab word behind the token', () => {
    const line = specs.find((s) => s.key === 's-04-2#L0')!;
    const lookup = (token: string, id: string | null) => (id === 'v-n5-0005' || token === '何でも' ? { surface: '何でも', kana: 'なんでも', pitch: 1 } : undefined);
    expect(offendingWord(line, ['な', 'に', 'で', 'も', 'た', 'べ', 'る'], ['な', 'ん', 'で', 'も', 'た', 'べ', 'る'], lookup)).toEqual({ surface: '何でも', kana: 'なんでも', pitch: 1 });
    // No item behind the token: the token's ruby reading is used when the token holds kanji.
    const two = specs.find((s) => s.key === 's-04-2#L1')!;
    expect(offendingWord(two, ['に', 'ぶ', 'ん', 'で'], ['に', 'ふ', 'ん', 'で'], () => undefined)).toEqual({ surface: '二分', kana: 'にふん' });
  });

  it('estimateQuery gives a plausible, verifiable query for a kana string', () => {
    const q = estimateQuery('はい、わかりました。');
    expect(verifyMorae(q, 'はい、わかりました。').ok).toBe(true);
    expect(q.accent_phrases.length).toBe(2);
    expect(q.accent_phrases[0]?.pause_mora).not.toBeNull();
    expect(queryDuration(q)).toBeCloseTo(0.2 + 8 * 0.143 + 0.25, 2);
    expect(estimateQuery('きょう').accent_phrases[0]?.moras.map((m) => m.text)).toEqual(['キョ', 'ウ']);
  });

  it('parseArgs: tiers, station range, dry-run flags; a dry run lands in .audio-cache/dry-run unless --out / --cache are given; --force and --allow-skips', () => {
    const o = parseArgs(['--tier', 'core', '--tier', 'pool', '--stations', '1-17', '--dry-run', '--fixtures', '--limit', '50', '--dict', 'all', '--no-prune']);
    expect(o.tiers).toEqual(['core', 'pool']);
    expect(o.stations).toEqual([1, 17]);
    expect(o.dryRun).toBe(true);
    expect(o.fixtures).toBe(FIXTURES);
    expect(o.limit).toBe(50);
    expect(o.dict).toBe('all');
    expect(o.prune).toBe(false);
    expect(o.out).toBe(join(REPO, '.audio-cache', 'dry-run', 'audio'));
    expect(o.cache).toBe(join(REPO, '.audio-cache', 'dry-run', 'cache'));
    expect(parseArgs([]).tiers).toEqual(['core']);
    expect(parseArgs([]).out).toBe(join(REPO, 'public', 'audio'));
    expect(parseArgs([]).cache).toBe(join(REPO, '.audio-cache'));
    expect(parseArgs(['--dry-run', '--out', '/tmp/x', '--cache', '/tmp/y'])).toMatchObject({ out: '/tmp/x', cache: '/tmp/y' });
    expect(parseArgs(['--force', '--allow-skips'])).toMatchObject({ force: true, allowSkips: true });
    expect(parseArgs([]).force).toBeUndefined();
    expect(() => parseArgs(['--tier', 'gold'])).toThrow(/unknown tier/);
    // What a run leaves out on purpose.
    expect(partialOf({})).toBeNull();
    expect(partialOf({ limit: 5 })).toEqual({ limit: 5 });
    expect(partialOf({ stations: [1, 17] })).toEqual({ stations: [1, 17] });
    expect(partialOf({ stations: [4, 4], limit: 50 })).toEqual({ stations: [4, 4], limit: 50 });
  });
});

describe('render-audio — engines: the shared dictionary file and a dying engine', () => {
  const corpus: Corpus = loadCorpus(CONTENT);
  const voices = resolveVoices(loadCast(CAST), speakers);
  const nandemo = JSON.parse(readFileSync(join(FIXTURES, 'queries', 'nandemo.json'), 'utf8')) as { query: AudioQuery };
  const line = inventory(corpus, { tiers: new Set(['core']) }).find((s) => s.key === 's-04-2#L0' && s.rate === 1)!;
  const lookup = (token: string, id: string | null) => (id === 'v-n5-0005' || token === '何でも' ? { surface: '何でも', kana: 'なんでも', pitch: 1 } : undefined);
  /** Misread until the temporary word is in THIS engine's dictionary, then verified. */
  const ladderQuery = (text: string, dict: Set<string>): AudioQuery => (dict.has('何でも') ? estimateQuery(line.kana) : structuredClone(nandemo.query));

  it('isTransportError: a connection failure or a 5xx is transport; a 4xx or any other error is not', () => {
    expect(isTransportError(new EngineError('http://a', 'fetch failed'))).toBe(true);
    expect(isTransportError(new EngineError('http://a', 'boom', 502))).toBe(true);
    expect(isTransportError(new EngineError('http://a', 'bad text', 400))).toBe(false);
    expect(isTransportError(new EngineError('http://a', 'bad text', 422))).toBe(false);
    expect(isTransportError(new Error('fetch failed'))).toBe(false);
  });

  it('Mutex runs bodies one at a time in order', async () => {
    const m = new Mutex();
    const order: string[] = [];
    let maxHeld = 0;
    const job = (name: string, ms: number) =>
      m.run(async () => {
        maxHeld = Math.max(maxHeld, m.held);
        order.push(`${name}:in`);
        await sleep(ms);
        order.push(`${name}:out`);
        return name;
      });
    const results = await Promise.all([job('a', 8), job('b', 1), job('c', 1)]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(order).toEqual(['a:in', 'a:out', 'b:in', 'b:out', 'c:in', 'c:out']);
    expect(maxHeld).toBe(1);
    await expect(m.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await m.run(async () => 'after a rejection the lock still works')).toBe('after a rejection the lock still works');
  });

  it('ladder step 1 on two engines at once never interleaves dictionary writes: add → re-query → delete is atomic under the shared lock (and interleaves without it)', async () => {
    const run = async (lockA: Mutex, lockB: Mutex) => {
      const events: string[] = [];
      let maxHeld = 0;
      const onCall = (): void => {
        maxHeld = Math.max(maxHeld, lockA.held + (lockB === lockA ? 0 : lockB.held));
      };
      const A = fakeEngine('A', { events, query: ladderQuery, onCall });
      const B = fakeEngine('B', { events, query: ladderQuery, onCall });
      const skips: SkipRecord[] = [];
      const voice = voices.get('ハナ')!;
      const [ra, rb] = await Promise.all([renderOne(A, line, voice, lookup, skips, lockA), renderOne(B, line, voice, lookup, skips, lockB)]);
      return { events, ra, rb, skips, maxHeld };
    };
    const shared = new Mutex();
    const ok = await run(shared, shared);
    expect(ok.ra?.step).toBe('user-dict');
    expect(ok.rb?.step).toBe('user-dict');
    expect(ok.skips).toEqual([]);
    expect(ok.maxHeld).toBe(1);
    // Every add is followed, with only its own engine's events in between, by the matching delete.
    const windows = ok.events.map((ev, i) => [ev, i] as const).filter(([ev]) => /:add:/.test(ev));
    expect(windows.length).toBe(2);
    for (const [ev, i] of windows) {
      const base = ev.split(':')[0];
      const end = ok.events.findIndex((x, j) => j > i && x.startsWith(`${base}:del:`));
      expect(end).toBeGreaterThan(i);
      for (const x of ok.events.slice(i + 1, end)) expect(x.startsWith(`${base}:`), ok.events.join(' ')).toBe(true);
    }
    // Without a shared lock the same two engines DO interleave (the race the lock exists for).
    const racy = await run(new Mutex(), new Mutex());
    const first = racy.events.findIndex((x) => /:add:/.test(x));
    const firstBase = racy.events[first]?.split(':')[0];
    const firstDel = racy.events.findIndex((x, j) => j > first && x.startsWith(`${firstBase}:del:`));
    expect(racy.events.slice(first + 1, firstDel).some((x) => !x.startsWith(`${firstBase}:`)), racy.events.join(' ')).toBe(true);
  });

  it('syncDictionary touches an engine that wrote nothing (the shared file was already right) so it recompiles; an engine that wrote is not touched', async () => {
    const entries: DictEntry[] = [{ surface: '雨', pronunciation: 'アメ', accent_type: 1, word_type: 'COMMON_NOUN', priority: 5 }];
    const events: string[] = [];
    const already = fakeEngine('A', { events, addDelayMs: 0 });
    (already as unknown as { userDict: () => Promise<unknown> }).userDict = async () => ({ 'id-雨': { surface: '雨', pronunciation: 'アメ', accent_type: 1, priority: 5 } });
    expect(await syncDictionary(already, entries)).toEqual({ added: 0, removed: 0, touched: true });
    expect(events).toEqual([`A:add:${DICT_TOUCH_ENTRY.surface}`, `A:del:${DICT_TOUCH_ENTRY.surface}`]);
    const empty = fakeEngine('B', { events: [], addDelayMs: 0 });
    expect(await syncDictionary(empty, entries)).toEqual({ added: 1, removed: 0, touched: false });
    // The sentinel is a surface no content holds.
    expect(corpus.vocab.some((v) => v.word === DICT_TOUCH_ENTRY.surface || v.kana === DICT_TOUCH_ENTRY.surface)).toBe(false);
  });

  it('shardAcrossEngines: a transport failure requeues the clip and retires the engine after three in a row; the others finish every clip; a 4xx skips just that clip; all engines down fails the run', async () => {
    const todo: ClipSpec[] = inventory(corpus, { tiers: new Set(['core']) })
      .filter((s) => s.kind === 'word')
      .slice(0, 12);
    expect(todo.length).toBe(12);
    const produced: string[] = [];
    const skips: string[] = [];
    const log: string[] = [];
    const r = await shardAcrossEngines(
      todo,
      [{ base: 'A' }, { base: 'B' }],
      async (spec, e) => {
        if (e.base === 'B') throw new EngineError('B', 'B: fetch failed');
        await sleep(1);
        produced.push(spec.key);
      },
      { log: (l) => log.push(l), retryDelayMs: 0, reportEveryMs: 0, onSkip: (spec, reason) => skips.push(`${spec.key} ${reason}`) },
    );
    expect(r.retired).toEqual(['B']);
    expect(r.done).toBe(12);
    expect([...produced].sort()).toEqual(todo.map((s) => s.key).sort()); // every clip exactly once, none skipped
    expect(skips).toEqual([]);
    expect(log.some((l) => /retired after 3 consecutive failures/.test(l))).toBe(true);

    // HTTP 4xx on one clip: skipped with the reason, not requeued, the engine keeps working.
    const bad = todo[3]!.key;
    const produced2: string[] = [];
    const skips2: string[] = [];
    const r2 = await shardAcrossEngines(todo, [{ base: 'A' }], async (spec) => {
      if (spec.key === bad) throw new EngineError('A', `${bad} → 400 bad text`, 400);
      produced2.push(spec.key);
    }, { retryDelayMs: 0, reportEveryMs: 0, onSkip: (spec, reason) => skips2.push(`${spec.key}|${reason}`) });
    expect(r2.done).toBe(12);
    expect(produced2.length).toBe(11);
    expect(skips2).toEqual([`${bad}|engine error: ${bad} → 400 bad text`]);

    // Every engine down: the run fails instead of skipping its way to exit 0.
    await expect(
      shardAcrossEngines(todo, [{ base: 'A' }, { base: 'B' }], async (_spec, e) => {
        throw new EngineError(e.base, `${e.base}: ECONNREFUSED`);
      }, { retryDelayMs: 0, reportEveryMs: 0, onSkip: () => {} }),
    ).rejects.toThrow(/every engine is down/);
  });
});

describe('render-audio — --dry-run --fixtures writes a manifest, indexes and skipped.jsonl without an engine or ffmpeg', () => {
  let tmp = '';
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tsuzuku-render-'));
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('runs the whole pipeline in dry-run mode over the fixture corpus', async () => {
    const out = join(tmp, 'audio');
    const cache = join(tmp, 'cache');
    const log: string[] = [];
    const r = await renderAudio({ root: CONTENT, out, cache, castPath: CAST, tiers: ['core', 'pool', 'ear'], engines: [], dryRun: true, fixtures: FIXTURES, ffmpeg: '/nonexistent/ffmpeg', dict: 'high', prune: true, log: (s) => log.push(s) });
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as AudioManifest;
    expect(manifest.schema).toBe('tsuzuku.audio/1');
    expect(manifest.dryRun).toBe(true);
    expect(manifest.audioVersion).toMatch(/^a-[0-9a-f]{10}$/);
    expect(manifest.contentVersion).toBe('c-f1x7ure0001');
    expect(manifest.engine).toBe('VOICEVOX 0.25.2');
    expect(manifest.tiers).toEqual(['core', 'ear', 'pool']);
    expect(manifest.credits).toEqual(['VOICEVOX:九州そら', 'VOICEVOX:玄野武宏']);
    expect(manifest.files.length).toBeGreaterThan(5);
    expect(manifest.files.every((f) => /^sprites\/(s\d\d|kana)\/[a-z0-9-]+-[0-9a-f]{8}\.webm$/.test(f.path))).toBe(true);
    expect(manifest.files.some((f) => f.path.startsWith('sprites/s04/s-04-1-'))).toBe(true);
    expect(manifest.files.some((f) => f.path.startsWith('sprites/s04/words-01-'))).toBe(true);
    expect(manifest.files.some((f) => f.path.startsWith('sprites/s04/grammar-01-'))).toBe(true);
    expect(manifest.files.some((f) => f.path.startsWith('sprites/s04/examples-01-'))).toBe(true);
    expect(manifest.files.some((f) => f.path.startsWith('sprites/s04/misc-01-'))).toBe(true);
    expect(manifest.files.some((f) => f.path.startsWith('sprites/s04/ear-01-'))).toBe(true);
    expect(manifest.files.some((f) => f.path.startsWith('sprites/kana/row-h-a-'))).toBe(true);
    const sum = manifest.files.reduce((s, f) => s + f.bytes, 0);
    expect(Object.values(manifest.belts).reduce((s, b) => s + b.bytes, 0)).toBe(sum);
    expect(manifest.totals.bytes).toBe(sum);
    expect(manifest.reusedBytesShare).toBeNull();
    expect(manifest.changedClipShare).toBe(1);
    expect(manifest.contentDiffShare).toBeNull();
    expect(manifest.partial).toBeNull();
    // Indexes on disk, named by the manifest (the two check-only sidecars included).
    for (const i of manifest.indexes) expect(existsSync(join(out, i.path))).toBe(true);
    expect(manifest.indexes.map((i) => i.path.replace(`${manifest.audioVersion}/`, '')).sort()).toEqual(['files.json', 'kana.json', 'kana/tracks.json', 'kana/words.json', 'n5/ear.json', 'n5/sentences.json', 'n5/words.json', 's04/stories.json']);
    // skipped.jsonl holds the two fixture misreads (何でも, 二分) at both rates.
    const skipped = readFileSync(join(cache, 'skipped.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { key: string; reason: string });
    expect(skipped.map((s) => s.key).sort()).toEqual(['s-04-2#L0', 's-04-2#L0', 's-04-2#L1', 's-04-2#L1']);
    expect(skipped[0]?.reason).toContain("ナ'ンデモ/タベ'ル");
    expect(r.skipped.length).toBe(4);
    expect(r.rendered).toBeGreaterThan(50);
    expect(log.some((l) => l.includes('DRY RUN'))).toBe(true);
    // No sprite bytes were written in a dry run.
    expect(existsSync(join(out, 'sprites'))).toBe(false);

    const words = JSON.parse(readFileSync(join(out, manifest.audioVersion, 'n5', 'words.json'), 'utf8')) as CueIndex;
    expect(words.cues['j-日#ex0']).toEqual(words.cues['v-n5-0004']); // reuse: same cue, own key
    expect(words.cues['j-日#ex1']).not.toEqual(words.cues['v-n5-0004']);
    expect(words.cues['v-n5-0002']?.[0]?.pv).toBe(true);
    expect(words.cues['v-n5-0003']?.[0]?.pv).toBe(true);
    expect(words.cues['v-n5-0005']?.[0]?.pv).toBeUndefined(); // pitchConfidence low: not graded, not overridden
    expect(words.cues['v-n5-0001#pair']?.length).toBe(1); // the T3 partner clip, keyed by the item
    expect(JSON.stringify(words)).not.toContain('"k":'); // the kana hash lives in the sidecar, not in a runtime index
    const kana = JSON.parse(readFileSync(join(out, manifest.audioVersion, KANA_SIDECAR), 'utf8')) as KanaIndex;
    expect(kana.kind).toBe('kana');
    expect(kana.keys['v-n5-0002']).toBe(kanaHash('あめ'));
    expect(kana.keys['v-n5-0001#pair']).toBe(kanaHash('はっい'));
    expect(kana.keys['s-04-1#L1']).toBe(kanaHash('きょうはあめです。'));
    const stories = JSON.parse(readFileSync(join(out, manifest.audioVersion, 's04', 'stories.json'), 'utf8')) as StoriesIndex;
    expect(stories.texts['s-04-1']?.lines.length).toBe(3);
    expect(stories.texts['s-04-1']?.whole).not.toBeNull(); // every line present → a Radio track
    expect(stories.texts['s-04-1']?.lines[1]?.[0]?.v).toBe(stories.voices.indexOf('VOICEVOX:玄野武宏'));
    expect(stories.texts['s-04-2']).toBeUndefined(); // both lines skipped → no sprite for the text
    expect(Object.keys(stories.misc)).toEqual(['m-04-1']);
  }, 60_000);

  it('a text with one skipped line ships its lines but no whole track (whole: null, lines sized to the story)', async () => {
    // The fixture corpus with the 二分 line (a fixture misread → skipped in a dry run) moved into s-04-1 as its last line.
    const root = join(tmp, 'content-hole');
    copyDir(CONTENT, root);
    const storyPath = join(root, 'stories', 'n5', 'stories-s04.json');
    const story = JSON.parse(readFileSync(storyPath, 'utf8')) as { items: StoryItem[] };
    const misread = story.items[1]!.lines[1]!;
    story.items[0]!.lines.push({ ...misread, speaker: 'ハナ' });
    writeFileSync(storyPath, JSON.stringify(story));
    const r = await renderAudio({ root, out: join(tmp, 'hole', 'audio'), cache: join(tmp, 'hole', 'cache'), castPath: CAST, tiers: ['core'], engines: [], dryRun: true, fixtures: FIXTURES, ffmpeg: 'ffmpeg', dict: 'high', prune: true, log: () => {} });
    const st = r.indexes.find((f) => f.path === 's04/stories.json')?.json as StoriesIndex;
    const t = st.texts['s-04-1']!;
    expect(t.lines.length).toBe(4);
    expect(t.lines[3]).toEqual([]); // the hole
    expect(t.whole).toBeNull(); // Radio skips the text; the ClipPlayer plays lines 0–2 and the device voice covers line 3
    expect(t.lines[0]?.[0]?.r).toBe(1);
    expect(r.skipped.filter((s) => s.key === 's-04-1#L3').length).toBe(2); // both rates
  }, 60_000);

  it('a dry run or a partial render refuses to overwrite a complete real pack unless --force; a partial render is marked and never prunes', async () => {
    const out = join(tmp, 'real', 'audio');
    mkdirSync(out, { recursive: true });
    const real = { schema: 'tsuzuku.audio/1', audioVersion: 'a-rea1000000', contentVersion: 'c-x', dryRun: false, partial: null, files: [], indexes: [] };
    writeFileSync(join(out, 'manifest.json'), JSON.stringify(real));
    const base = { root: CONTENT, out, cache: join(tmp, 'real', 'cache'), castPath: CAST, tiers: ['core' as const], engines: [], fixtures: FIXTURES, ffmpeg: 'ffmpeg', dict: 'high' as const, prune: true, log: () => {} };
    await expect(renderAudio({ ...base, dryRun: true })).rejects.toThrow(/complete real pack \(a-rea1000000\).*dry run/);
    expect(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))).toEqual(real); // untouched
    // (A partial real render would hit the same guard; without engines we can only show the dry-run side.)
    const forced = await renderAudio({ ...base, dryRun: true, force: true });
    expect(forced.manifest.dryRun).toBe(true);
    expect(forced.manifest.reusedBytesShare).toBe(0); // measured against the real manifest it replaced (which named no sprites)
    // Partial renders carry what they left out.
    const limited = await renderAudio({ ...base, out: join(tmp, 'partial-limit', 'audio'), cache: join(tmp, 'partial-limit', 'cache'), dryRun: true, limit: 5, log: () => {} });
    expect(limited.manifest.partial).toEqual({ limit: 5 });
    expect(limited.specs).toBe(5);
    const log: string[] = [];
    const ranged = await renderAudio({ ...base, out: join(tmp, 'partial-range', 'audio'), cache: join(tmp, 'partial-range', 'cache'), dryRun: true, stations: [4, 4], log: (l) => log.push(l) });
    expect(ranged.manifest.partial).toEqual({ stations: [4, 4] });
    expect(log.some((l) => /partial render \(stations 4-4\).*pack\.ts will refuse it/.test(l))).toBe(true);
    expect(log.some((l) => /PARTIAL/.test(l))).toBe(true);
  }, 60_000);

  it('a text longer than 90 s is still ONE sprite (lines in order, then the slow takes); mixed sprites in the same pack never exceed 90 s', async () => {
    const root = join(tmp, 'content-long');
    copyDir(CONTENT, root);
    const storyPath = join(root, 'stories', 'n5', 'stories-s04.json');
    const story = JSON.parse(readFileSync(storyPath, 'utf8')) as { items: StoryItem[] };
    const kana = 'きのうはともだちとえいがをみて、そのあとレストランでばんごはんをたべました。'; // 38 morae ≈ 5.6 s estimated
    const lines: StoryLine[] = Array.from({ length: 30 }, (_, i) => ({ speaker: i % 2 ? 'ケン' : 'ハナ', ja: kana, kana, en: `line ${i}`, tokens: [kana] }));
    story.items.push({ ...story.items[0]!, id: 's-04-3', titleJa: 'ながいはなし', titleEn: 'A long one', lines, learnerSpeaker: 'ハナ' });
    writeFileSync(storyPath, JSON.stringify(story));
    const r = await renderAudio({ root, out: join(tmp, 'long', 'audio'), cache: join(tmp, 'long', 'cache'), castPath: CAST, tiers: ['core'], engines: [], dryRun: true, fixtures: FIXTURES, ffmpeg: 'ffmpeg', dict: 'high', prune: true, log: () => {} });
    const textSprites = r.manifest.files.filter((f) => /^sprites\/s04\/s-04-3-/.test(f.path));
    expect(textSprites.length).toBe(1);
    expect(textSprites[0]?.clips).toBe(60); // 30 lines × (rate 1 + slow)
    expect(textSprites[0]?.seconds).toBeGreaterThan(MAX_MIXED_SECONDS);
    expect(textSprites[0]?.seconds).toBeGreaterThan(300);
    for (const f of r.manifest.files.filter((f) => /\/(words|grammar|examples|misc|ear)-\d\d-/.test(f.path))) expect(f.seconds, f.path).toBeLessThanOrEqual(MAX_MIXED_SECONDS + 0.001);
    const st = r.indexes.find((f) => f.path === 's04/stories.json')?.json as StoriesIndex;
    const t = st.texts['s-04-3']!;
    expect(t.lines.length).toBe(30);
    expect(t.whole).not.toBeNull();
    expect(t.whole!.e - t.whole!.s).toBeGreaterThan(MAX_MIXED_SECONDS); // the Radio track is the whole text, edge to edge
    expect(t.lines[29]?.[0]?.e).toBeLessThanOrEqual(t.whole!.e); // rate-1 lines inside the whole track…
    expect(t.lines[0]?.[1]?.s).toBeGreaterThan(t.whole!.e); // …and the slow takes after it
  }, 60_000);

  it('is idempotent: a second dry run gives the same audioVersion, index bytes and sprite names', async () => {
    const run = async (dir: string) => renderAudio({ root: CONTENT, out: join(dir, 'audio'), cache: join(dir, 'cache'), castPath: CAST, tiers: ['core'], engines: [], dryRun: true, fixtures: FIXTURES, ffmpeg: 'ffmpeg', dict: 'high', prune: true, log: () => {} });
    const a = await run(join(tmp, 'a'));
    const b = await run(join(tmp, 'b'));
    expect(b.manifest.audioVersion).toBe(a.manifest.audioVersion);
    expect(b.manifest.files.map((f) => f.path)).toEqual(a.manifest.files.map((f) => f.path));
    expect(b.manifest.indexes.map((i) => i.sha256)).toEqual(a.manifest.indexes.map((i) => i.sha256));
    // The second run sees the first as "previous" when pointed at it: everything is reused.
    const c = await renderAudio({ root: CONTENT, out: join(tmp, 'c', 'audio'), cache: join(tmp, 'c', 'cache'), castPath: CAST, tiers: ['core'], engines: [], dryRun: true, fixtures: FIXTURES, ffmpeg: 'ffmpeg', dict: 'high', prune: true, previousManifest: join(tmp, 'a', 'audio', 'manifest.json'), log: () => {} });
    expect(c.manifest.reusedBytesShare).toBe(1);
    expect(c.manifest.contentDiffShare).toBe(0); // measured on the two kana sidecars: nothing changed
  }, 60_000);

  it('a one-word change renames only the sprites that contain that word', async () => {
    const fixtureRoot = join(tmp, 'content2');
    // Copy the fixture corpus and change one line's kana (飴 → あめー would break verification; change the English-only field keeps bytes; change a line instead).
    copyDir(CONTENT, fixtureRoot);
    const storyPath = join(fixtureRoot, 'stories', 'n5', 'stories-s04.json');
    const story = JSON.parse(readFileSync(storyPath, 'utf8')) as { items: StoryItem[] };
    const line = story.items[0]!.lines[1]!;
    line.ja = '{今日|きょう}は{雨|あめ}ですね。';
    line.kana = 'きょうはあめですね。';
    line.tokens = ['今日', 'は', '雨', 'です', 'ね', '。'];
    line.tokenIds = [null, null, 'v-n5-0002', null, null, null];
    writeFileSync(storyPath, JSON.stringify(story));
    const before = await renderAudio({ root: CONTENT, out: join(tmp, 'd1', 'audio'), cache: join(tmp, 'd1', 'cache'), castPath: CAST, tiers: ['core'], engines: [], dryRun: true, fixtures: FIXTURES, ffmpeg: 'ffmpeg', dict: 'high', prune: true, log: () => {} });
    const after = await renderAudio({ root: fixtureRoot, out: join(tmp, 'd2', 'audio'), cache: join(tmp, 'd2', 'cache'), castPath: CAST, tiers: ['core'], engines: [], dryRun: true, fixtures: FIXTURES, ffmpeg: 'ffmpeg', dict: 'high', prune: true, previousManifest: join(tmp, 'd1', 'audio', 'manifest.json'), log: () => {} });
    const changed = after.manifest.files.filter((f) => !before.manifest.files.some((g) => g.path === f.path)).map((f) => f.path);
    expect(changed.length).toBe(1);
    expect(changed[0]).toMatch(/^sprites\/s04\/s-04-1-/);
    expect(after.manifest.reusedBytesShare).toBeGreaterThan(0.5);
    // The content diff is small (one line's kana of ~100 keys), so audio:check would gate the reuse warning on it — not on the cold cache's changedClipShare of 1.
    expect(after.manifest.changedClipShare).toBe(1);
    expect(after.manifest.contentDiffShare).toBeGreaterThan(0);
    expect(after.manifest.contentDiffShare).toBeLessThan(0.05);
  }, 60_000);
});
