/**
 * speak-text.ts — the stripDisplayMarks / textToSpeak cases (copied from
 * tts.test.ts, design 08 §7: behaviour is byte-identical to the moved bodies)
 * plus the Node smoke: the render pipeline imports this module under plain
 * `node` (type stripping), so a store / signals / extension-less import here
 * would break `scripts/audio/render-audio.ts`.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WORD_MAX_CHARS, stripDisplayMarks, textToSpeak } from './speak-text';

describe('textToSpeak', () => {
  it('sentences speak the plain surface (ruby stripped), never the kana', () => {
    expect(textToSpeak('{私|わたし}はコーヒーを{飲|の}みます。', 'わたしはコーヒーをのみます。')).toBe('私はコーヒーを飲みます。');
    expect(textToSpeak('私はコーヒーを飲みます。')).toBe('私はコーヒーを飲みます。');
  });

  it('an isolated word speaks its kana when given (単漢字 are misread alone)', () => {
    expect(textToSpeak('日', 'ひ')).toBe('ひ');
    expect(textToSpeak('{飲|の}む', 'のむ')).toBe('のむ');
    expect(textToSpeak('飲む')).toBe('飲む');
    expect(textToSpeak('あ', 'あ')).toBe('あ');
  });

  it('a short collocation with no kana speaks its plain surface, not the bare word (MeaningGuard speakWord passes no kana for collocations)', () => {
    expect(textToSpeak('朝ご飯を食べる')).toBe('朝ご飯を食べる');
    expect(textToSpeak('{朝|あさ}ご{飯|はん}を{食|た}べる')).toBe('朝ご飯を食べる');
    expect(textToSpeak('日が暮れる')).toBe('日が暮れる');
    // Why the caller must not forward the word's kana: a collocation this short counts as a word
    // and the engine would say the bare word instead of the phrase it claims to have played.
    expect(textToSpeak('朝ご飯を食べる', 'あさごはん')).toBe('あさごはん');
  });

  it('the word test is bounded by WORD_MAX_CHARS plain characters', () => {
    expect(WORD_MAX_CHARS).toBe(8);
    expect(textToSpeak('あいうえおかきく', 'x')).toBe('x');
    expect(textToSpeak('あいうえおかきくけ', 'x')).toBe('あいうえおかきくけ');
  });
});

describe('stripDisplayMarks (display-only marks never reach the engine)', () => {
  it('strips a leading or trailing 〜 ～ ~ (grammar / michikusa patterns, suffix vocab)', () => {
    expect(stripDisplayMarks('〜てはいけない')).toBe('てはいけない');
    expect(stripDisplayMarks('〜ざるを得ない')).toBe('ざるを得ない');
    expect(stripDisplayMarks('～ている')).toBe('ている');
    expect(stripDisplayMarks('御〜')).toBe('御');
    expect(stripDisplayMarks('~ばかり ~')).toBe('ばかり');
    expect(stripDisplayMarks('〜に越したことはない')).toBe('に越したことはない');
  });

  it('an interior 〜 slot becomes a pause; a 〜 between digits is a range and stays', () => {
    expect(stripDisplayMarks('必ずしも〜ではない')).toBe('必ずしも、ではない');
    expect(stripDisplayMarks('〜より〜の方が')).toBe('より、の方が');
    expect(stripDisplayMarks('10〜20分かかる')).toBe('10〜20分かかる');
  });

  it('… and ‥ runs collapse to one pause, never doubling existing punctuation', () => {
    expect(stripDisplayMarks('ええと……二月に仕事を辞めたんです。')).toBe('ええと、二月に仕事を辞めたんです。');
    expect(stripDisplayMarks('そう‥‥かな')).toBe('そう、かな');
    expect(stripDisplayMarks('「けんは？」「……。」')).toBe('「けんは？」「。」');
    expect(stripDisplayMarks('まあ…。')).toBe('まあ。');
    expect(stripDisplayMarks('いや...そうだね')).toBe('いや、そうだね');
    expect(stripDisplayMarks('うーん……')).toBe('うーん');
  });

  it('「」 around a bare pattern are unwrapped; quotes inside a sentence stay', () => {
    expect(stripDisplayMarks('「〜てはいけない」')).toBe('てはいけない');
    expect(stripDisplayMarks('『感動』')).toBe('感動');
    expect(stripDisplayMarks('明日、「概ねまっすぐ」って書く。')).toBe('明日、「概ねまっすぐ」って書く。');
    expect(stripDisplayMarks('「はい」「いいえ」')).toBe('「はい」「いいえ」');
  });

  it('a 1–2 kana optional piece in parentheses is unwrapped; other parentheticals are dropped', () => {
    expect(stripDisplayMarks('〜に至って(は)')).toBe('に至っては');
    expect(stripDisplayMarks('〜(ら)れる')).toBe('られる');
    expect(stripDisplayMarks('〜(さ)せられる')).toBe('させられる');
    expect(stripDisplayMarks('〜なり (as soon as)')).toBe('なり');
    expect(stripDisplayMarks('命令形 (imperative)')).toBe('命令形');
    expect(stripDisplayMarks('（N）のために')).toBe('のために');
    expect(stripDisplayMarks('(V)ことがある')).toBe('ことがある');
    expect(stripDisplayMarks('〜(ら)れる (direct passive 受身)')).toBe('られる');
  });

  it('a spaced / or ／ between alternatives becomes a pause', () => {
    expect(stripDisplayMarks('〜に至る / 〜に至るまで')).toBe('に至る、に至るまで');
    expect(stripDisplayMarks('〜ゆえ(に)／〜ゆえの')).toBe('ゆえに、ゆえの');
  });

  it("nothing speakable left → '' (speak resolves without an utterance)", () => {
    expect(stripDisplayMarks('〜')).toBe('');
    expect(stripDisplayMarks('「……」')).toBe('');
    expect(stripDisplayMarks('(N)')).toBe('');
  });

  it('real sentence text is untouched (ruby already stripped by textToSpeak)', () => {
    const line = '石部は、昔、京都から一日で着く宿場町だったそうだ。「京立ち石部泊まり」っていうんだって。';
    expect(stripDisplayMarks(line)).toBe(line);
    expect(stripDisplayMarks('私はコーヒーを飲みます。')).toBe('私はコーヒーを飲みます。');
    expect(stripDisplayMarks('大丈夫ですか？ はい、大丈夫です！')).toBe('大丈夫ですか？ はい、大丈夫です！');
  });

  it('textToSpeak applies it to the surface and the kana; the word test runs on the cleaned surface', () => {
    expect(textToSpeak('〜放題', 'ほうだい')).toBe('ほうだい');
    expect(textToSpeak('〜限り')).toBe('限り');
    expect(textToSpeak('〜に{越|こ}したことはない', '〜にこしたことはない')).toBe('に越したことはない');
    expect(textToSpeak('〜てはいけない')).toBe('てはいけない');
    expect(textToSpeak('{私|わたし}は「〜てはいけない」と{言|い}った。', 'わたしは「〜てはいけない」といった。')).toBe('私は「てはいけない」と言った。');
    expect(textToSpeak('〜', '〜')).toBe('');
  });
});

describe('Node can import the module directly (design 08 §7: the render pipeline runs under plain node)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const moduleUrl = pathToFileURL(resolve(here, 'speak-text.ts')).href;

  it('import() succeeds under node with type stripping and exposes both functions with the tested behaviour', () => {
    const script = [
      `const m = await import(${JSON.stringify(moduleUrl)});`,
      `if (typeof m.stripDisplayMarks !== 'function' || typeof m.textToSpeak !== 'function') { console.error('missing exports'); process.exit(2); }`,
      `const got = [m.stripDisplayMarks('〜(ら)れる (direct passive 受身)'), m.textToSpeak('{飲|の}む', 'のむ'), m.textToSpeak('{私|わたし}はコーヒーを{飲|の}みます。', 'x')];`,
      `console.log(JSON.stringify(got));`,
    ].join('\n');
    const r = spawnSync(process.execPath, ['--input-type=module', '--no-warnings', '-e', script], { encoding: 'utf8', timeout: 30_000 });
    expect(r.error).toBeUndefined();
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual(['られる', 'のむ', '私はコーヒーを飲みます。']);
  });

  it('stays importable under node: no store, signals, DOM or extension-less relative import in the source', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(resolve(here, 'speak-text.ts'), 'utf8');
    const imports = [...src.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1] as string);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec.startsWith('.')).toBe(true);
      expect(spec.endsWith('.ts')).toBe(true);
      expect(spec).not.toMatch(/store|signals|audio\//);
    }
  });
});
