import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validate, formatReport, moraCount } from './validate-content.ts';
import type { Finding, ValidateResult } from './validate-content.ts';
import { assign } from './assign-stations.ts';
import type { PlanEntry } from './assign-stations.ts';
import { writeIndex } from './build-content-index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const GOOD = join(here, '__fixtures__', 'good');
const PLAN = JSON.parse(readFileSync(join(here, '__fixtures__', 'plan-good.json'), 'utf8')) as PlanEntry[];

type Json = Record<string, unknown>;
const tmps: string[] = [];

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tsuzuku-validate-'));
  cpSync(GOOD, dir, { recursive: true });
  tmps.push(dir);
  return dir;
}

function mutate(root: string, rel: string, fn: (doc: Json) => void): void {
  const p = join(root, rel);
  const doc = JSON.parse(readFileSync(p, 'utf8')) as Json;
  fn(doc);
  writeFileSync(p, JSON.stringify(doc, null, 2) + '\n');
}

function item(doc: Json, i = 0): Json {
  return (doc['items'] as Json[])[i]!;
}

function rules(findings: Finding[]): string[] {
  return [...new Set(findings.map((f) => f.rule))].sort();
}

/** Assign stations and build the manifest so strict rules (V20/V34–V36) run against bundles. */
function pipeline(root: string): void {
  assign(root, PLAN, { write: true, allowlistsDir: join(root, '..', `${root.split('/').pop()}-allowlists`) });
  writeIndex(root, '1.0.0', { generatedAt: '2026-10-17T00:00:00.000Z' });
}

function expectRule(result: ValidateResult, rule: string): void {
  const hit = result.failures.filter((f) => f.rule === rule);
  if (hit.length === 0) throw new Error(`expected a ${rule} failure; got ${JSON.stringify(rules(result.failures))}\n${formatReport(result, '')}`);
}

afterAll(() => {
  for (const d of tmps) {
    rmSync(d, { recursive: true, force: true });
    rmSync(`${d}-allowlists`, { recursive: true, force: true });
  }
});

describe('validate — good fixture', () => {
  it('passes with no failures (bundles absent → V20/V34 only warn)', () => {
    const root = copyFixture();
    const r = validate(root);
    expect(r.failures).toEqual([]);
    expect(r.files).toBe(9);
    expect(r.bundles).toBe(false);
    expect(rules(r.warnings)).toContain('V20');
    expect(rules(r.warnings)).toContain('V34');
  });

  it('passes strict after assign + index except the quota rule (tiny corpus) and keeps V35 green', () => {
    const root = copyFixture();
    pipeline(root);
    const r = validate(root, { strict: true });
    expect(r.bundles).toBe(true);
    expect(rules(r.failures)).toEqual(['V34']);
    expect(r.linked).toBe(12);
  });

  it('formatReport prints a grouped report with totals', () => {
    const root = copyFixture();
    const text = formatReport(validate(root), root);
    expect(text).toMatch(/TOTAL: 0 failures/);
    expect(text).toContain('kana/hiragana.json');
  });

  it('moraCount attaches small kana', () => {
    expect(moraCount('きゃく')).toBe(2);
    expect(moraCount('がっこう')).toBe(4);
    expect(moraCount('コーヒー')).toBe(4);
  });
});

describe('validate — one failing fixture per rule', () => {
  it('V01 envelope', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      d['schema'] = 'tsuzuku.content/0';
    });
    expectRule(validate(root), 'V01');
  });

  it('V01 level present iff path has a level segment', () => {
    const root = copyFixture();
    mutate(root, 'kana/hiragana.json', (d) => {
      d['level'] = 'kana';
    });
    expectRule(validate(root), 'V01');
  });

  it('V02 item count (and _meta exempt from the cap)', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      d['items'] = [];
    });
    const r = validate(root);
    expectRule(r, 'V02');
    const root2 = copyFixture();
    mutate(root2, '_meta/components.json', (d) => {
      const items = d['items'] as Json[];
      for (let i = 0; i < 160; i++) items.push({ id: `c-x${i}`.replace(/\d/g, (n) => 'abcdefghij'[Number(n)]!), char: '卜', name: `x${i}`.replace(/\d/g, (n) => 'abcdefghij'[Number(n)]!) });
    });
    expect(validate(root2).failures.filter((f) => f.rule === 'V02')).toEqual([]);
  });

  it('V03 shape (unknown key, null, empty string)', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['bogus'] = 1;
      item(d, 1)['notes'] = null;
      item(d, 2)['notes'] = '';
    });
    const r = validate(root);
    const msgs = r.failures.filter((f) => f.rule === 'V03').map((f) => f.message);
    expect(msgs.some((m) => m.includes('unknown key bogus'))).toBe(true);
    expect(msgs.some((m) => m.includes('null'))).toBe(true);
    expect(msgs.some((m) => m.includes('empty string'))).toBe(true);
  });

  it('V04 id grammar', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['id'] = 'v-n5-1';
    });
    expectRule(validate(root), 'V04');
  });

  it('V05 id consistency (duplicate id, jlpt mismatch, kanji id ≠ char)', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 1)['id'] = 'v-n5-0001';
      item(d, 2)['jlpt'] = 4;
    });
    mutate(root, 'kanji/n5/kanji-n5-001.json', (d) => {
      item(d)['char'] = '月';
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V05').length).toBeGreaterThanOrEqual(3);
  });

  it('V06 references resolve', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['kanjiIds'] = ['j-龍'];
    });
    expectRule(validate(root), 'V06');
  });

  it('V07 enums (pos, tag, component name)', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['pos'] = 'verb';
      item(d, 1)['tags'] = ['people', 'neutral'];
    });
    mutate(root, 'kanji/n5/kanji-n5-001.json', (d) => {
      item(d)['components'] = ['moon'];
      item(d)['mnemonic'] = 'A MOON in the window.';
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V07').length).toBeGreaterThanOrEqual(3);
  });

  it('V08 path grammar and sequence gaps', () => {
    const root = copyFixture();
    renameSync(join(root, 'vocab/n5/vocab-n5-001.json'), join(root, 'vocab/n5/vocab-n5-002.json'));
    expectRule(validate(root), 'V08');
    const root2 = copyFixture();
    mkdirSync(join(root2, 'stories/n4'), { recursive: true });
    renameSync(join(root2, 'stories/n5/stories-s04.json'), join(root2, 'stories/n4/stories-s04.json'));
    expectRule(validate(root2), 'V08');
  });

  it('V10 kana-only fields', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['kana'] = '私';
    });
    mutate(root, 'kanji/n5/kanji-n5-001.json', (d) => {
      item(d)['on'] = ['にち'];
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V10').length).toBeGreaterThanOrEqual(2);
  });

  it('V11 ruby well-formed', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      (item(d)['examples'] as Json[])[0]!['ja'] = '{私|わたし}は{学生|がく|せい}です。';
    });
    expectRule(validate(root), 'V11');
  });

  it('V12 bare kanji / ruby in plain field', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      (item(d)['examples'] as Json[])[0]!['ja'] = '私は{学生|がくせい}です。';
      item(d, 1)['word'] = '{先生|せんせい}';
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V12').length).toBeGreaterThanOrEqual(2);
  });

  it('V13 reconstruction', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      (item(d)['examples'] as Json[])[0]!['kana'] = 'わたしはがくせいでした。';
    });
    expectRule(validate(root), 'V13');
  });

  it('V14 counts', () => {
    const root = copyFixture();
    mutate(root, 'kanji/n5/kanji-n5-001.json', (d) => {
      (item(d)['examples'] as Json[]).pop();
    });
    mutate(root, 'grammar/n5/grammar-n5-001.json', (d) => {
      item(d)['mistakes'] = ['書くください → 書いてください'];
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V14').length).toBeGreaterThanOrEqual(2);
  });

  it('V15 length caps', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['notes'] = 'x'.repeat(201);
      (item(d, 1)['examples'] as Json[])[0]!['ja'] = 'あ'.repeat(26);
      (item(d, 1)['examples'] as Json[])[0]!['kana'] = 'あ'.repeat(26);
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V15').length).toBeGreaterThanOrEqual(2);
  });

  it('V16 target presence', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      (item(d, 4)['examples'] as Json[])[0] = { ja: 'これは{水|みず}です。', kana: 'これはみずです。', en: 'This is water.' };
    });
    expectRule(validate(root), 'V16');
  });

  it('V17 mnemonic mentions every component', () => {
    const root = copyFixture();
    mutate(root, 'kanji/n5/kanji-n5-001.json', (d) => {
      item(d, 2)['mnemonic'] = 'The monks read the TIME from a shadow.';
    });
    expectRule(validate(root), 'V17');
  });

  it('V18 numeric sanity', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['pitch'] = 7;
      delete item(d, 1)['pitchConfidence'];
    });
    mutate(root, 'kanji/n5/kanji-n5-001.json', (d) => {
      item(d)['strokes'] = 40;
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V18').length).toBeGreaterThanOrEqual(3);
    // `pitchConfidence: "high"` is what the pitch post-pass writes (review round 2b), so it is not a warning
    const root2 = copyFixture();
    mutate(root2, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['pitchConfidence'] = 'high';
    });
    expect(rules(validate(root2).warnings)).not.toContain('V18');
  });

  it('V19 token integrity and writer-supplied tokenIds', () => {
    const root = copyFixture();
    mutate(root, 'stories/n5/stories-s04.json', (d) => {
      const line = (item(d)['lines'] as Json[])[0]!;
      line['tokens'] = ['ハナさん', '、', 'これ', 'は', '本', 'です', 'か'];
      const line2 = (item(d)['lines'] as Json[])[2]!;
      line2['tokenIds'] = [null];
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V19').length).toBeGreaterThanOrEqual(2);
  });

  it('V20 coverage rules fail only in strict mode with bundles', () => {
    const root = copyFixture();
    mutate(root, 'stories/n5/stories-s04.json', (d) => {
      item(d)['bridge'] = true;
      (item(d)['lines'] as Json[])[0]!['plusOne'] = ['v-n5-0005'];
    });
    expect(rules(validate(root).failures)).not.toContain('V20');
    pipeline(root);
    expectRule(validate(root, { strict: true }), 'V20');
  });

  it('V20 unknown words lower coverage below the target', () => {
    const root = copyFixture();
    mutate(root, 'stories/n5/stories-s04.json', (d) => {
      for (const i of [0, 2, 4]) {
        const line = (item(d)['lines'] as Json[])[i]!;
        line['ja'] = 'りんごとみかんとぶどうとばななをたべますか。';
        line['kana'] = 'りんごとみかんとぶどうとばななをたべますか。';
        line['tokens'] = ['りんご', 'と', 'みかん', 'と', 'ぶどう', 'と', 'ばなな', 'を', 'たべます', 'か', '。'];
      }
    });
    pipeline(root);
    const r = validate(root, { strict: true });
    expect(r.failures.some((f) => f.rule === 'V20' && /coverage/.test(f.message))).toBe(true);
  });

  it('V21 comprehension', () => {
    const root = copyFixture();
    mutate(root, 'stories/n5/stories-s04.json', (d) => {
      const q = (item(d)['comprehension'] as Json[])[0]!;
      q['choices'] = ['A book', 'A book', 'Water', 'Bread'];
      (item(d)['comprehension'] as Json[])[1]!['q'] = '本ですか。';
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V21').length).toBeGreaterThanOrEqual(2);
  });

  it('V22 register heuristic warns', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      for (const it of (d['items'] as Json[]).slice(0, 6)) {
        (it['examples'] as Json[])[0]!['ja'] = `${(it['examples'] as Json[])[0]!['ja'] as string}`.replace('です。', 'だ。');
        (it['examples'] as Json[])[0]!['kana'] = `${(it['examples'] as Json[])[0]!['kana'] as string}`.replace('です。', 'だ。');
      }
    });
    expect(rules(validate(root).warnings)).toContain('V22');
  });

  it('V23 grammar graph', () => {
    const root = copyFixture();
    mutate(root, 'grammar/n5/grammar-n5-001.json', (d) => {
      item(d)['related'] = ['g-n5-001', 'g-n5-002', 'g-n5-002'];
      item(d, 1)['unlocksForms'] = ['masu', 'subjunctive'];
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V23').length).toBeGreaterThanOrEqual(3);
  });

  it('V24 kana consistency', () => {
    const root = copyFixture();
    mutate(root, 'kana/hiragana.json', (d) => {
      item(d, 3)['row'] = 's';
      item(d, 9)['type'] = 'basic';
      item(d, 11)['id'] = 'k-h-kiya';
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V24').length).toBeGreaterThanOrEqual(3);
  });

  it('V25 story form', () => {
    const root = copyFixture();
    mutate(root, 'stories/n5/stories-s04.json', (d) => {
      delete (item(d)['lines'] as Json[])[0]!['speaker'];
      item(d)['names'] = ['アオ'];
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V25').length).toBeGreaterThanOrEqual(2);
  });

  it('V26 conjugation', () => {
    const root = copyFixture();
    mutate(root, 'conjugation/conjugation-001.json', (d) => {
      item(d)['form'] = 'adj-neg';
      item(d, 2)['alt'] = ['大きくない'];
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V26').length).toBeGreaterThanOrEqual(2);
  });

  it('V27 dialogue fields', () => {
    const root = copyFixture();
    mutate(root, 'stories/n5/stories-s04.json', (d) => {
      const learner = (item(d)['lines'] as Json[])[1]!;
      (learner['options'] as Json[])[0]!['kind'] = 'ok';
      learner['mustInclude'] = ['水'];
      (item(d)['lines'] as Json[])[0]!['registerTarget'] = 'casual';
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V27').length).toBeGreaterThanOrEqual(3);
  });

  it('V30 denylist (term, katakana form, pattern) and absent-list warning', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['notes'] = 'like Pikachu';
      item(d, 1)['notes'] = 'ピカチュウのように';
      item(d, 2)['notes'] = 'a Pokémon reference';
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V30').length).toBe(3);
    const root2 = copyFixture();
    rmSync(join(root2, '_meta/denylist.json'));
    expect(rules(validate(root2).warnings)).toContain('V30');
  });

  it('V31 script hygiene', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      (item(d)['examples'] as Json[])[0]!['ja'] = '{私|わたし}は3{年生|ねんせい}です。';
      (item(d)['examples'] as Json[])[0]!['kana'] = 'わたしは3ねんせいです。';
      item(d, 1)['notes'] = 'ＡＢＣ';
      item(d, 2)['notes'] = ' padded ';
      item(d, 3)['notes'] = 'ﾃｽﾄ';
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V31').length).toBeGreaterThanOrEqual(4);
  });

  it('V32 dedupe (word+kana, kanji char, kana glyph) and homograph exemption', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 1)['word'] = '私';
      item(d, 1)['kana'] = 'わたし';
    });
    mutate(root, 'kanji/n5/kanji-n5-001.json', (d) => {
      item(d, 1)['char'] = '日';
      item(d, 1)['id'] = 'j-日';
    });
    const r = validate(root);
    expect(r.failures.filter((f) => f.rule === 'V32').length).toBeGreaterThanOrEqual(2);
    const root2 = copyFixture();
    mutate(root2, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['tags'] = ['people', 'homograph'];
      item(d, 1)['word'] = '私';
      item(d, 1)['kana'] = 'わたし';
      item(d, 1)['tags'] = ['people', 'homograph'];
    });
    expect(validate(root2).failures.filter((f) => f.rule === 'V32')).toEqual([]);
  });

  it('V33 gloss style warns', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 6)['meanings'] = ['drink.'];
      (item(d, 7)['examples'] as Json[])[0]!['en'] = 'Water please';
    });
    const r = validate(root);
    expect(r.warnings.filter((f) => f.rule === 'V33').length).toBeGreaterThanOrEqual(3);
  });

  it('V34 quotas: warn without --strict, fail with --strict after assignment', () => {
    const root = copyFixture();
    pipeline(root);
    expect(rules(validate(root).failures)).not.toContain('V34');
    expect(rules(validate(root).warnings)).toContain('V34');
    expectRule(validate(root, { strict: true }), 'V34');
  });

  it('V35 manifest must regenerate byte-identically', () => {
    const root = copyFixture();
    pipeline(root);
    expect(validate(root, { strict: true }).failures.filter((f) => f.rule === 'V35')).toEqual([]);
    mutate(root, 'manifest.json', (d) => {
      (d['files'] as Json[])[0]!['bytes'] = 1;
    });
    expectRule(validate(root, { strict: true }), 'V35');
    const root2 = copyFixture();
    pipeline(root2);
    mutate(root2, 'stations/04.json', (d) => {
      d['grammarIds'] = [];
    });
    expectRule(validate(root2, { strict: true }), 'V35');
  });

  it('V36 strips the 〜 marker and takes a single-kanji target only with its own reading', () => {
    const root = copyFixture();
    const setDef = (ja: string, kana: string) =>
      mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
        const it = item(d, 7); // 水 みず → an affix-shaped 〜水 / 〜みず
        it['word'] = '〜水';
        it['kana'] = '〜みず';
        it['definitionJa'] = { ja, kana };
      });
    const target = (r: ValidateResult) => r.failures.filter((f) => f.rule === 'V36' && /contains the target/.test(f.message)).map((f) => f.message);
    setDef('{飲|の}む{水|みず}のこと。', 'のむみずのこと。');
    pipeline(root);
    expect(target(validate(root, { strict: true }))).toEqual(['definitionJa contains the target "〜水"']);
    // the same kanji under another reading is a different word (泊 in 泊まる for 〜泊): not the target
    setDef('{飲|の}む{水|すい}のこと。', 'のむすいのこと。');
    expect(target(validate(root, { strict: true }))).toEqual([]);
    // the reading alone (≥ 2 chars) still counts
    setDef('のむみずのこと。', 'のむみずのこと。');
    expect(target(validate(root, { strict: true }))).toEqual(['definitionJa contains the target "〜みず"']);
  });

  it('V36 allowlist check: a single-kanji stem before kanji is a W, not an F', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      // 飲 is the one-kanji stem of 飲む (v-n5-0007); 本 is allowlisted on its own. The old segmentation
      // resolved 飲本 as 飲|本; now the compound surfaces as a warning while nothing fails.
      item(d, 7)['definitionJa'] = { ja: '{飲本|のみほん}のこと。', kana: 'のみほんのこと。' };
    });
    pipeline(root);
    const r = validate(root, { strict: true });
    expect(r.failures.filter((f) => f.rule === 'V36' && f.id === 'v-n5-0008')).toEqual([]);
    const w = r.warnings.filter((f) => f.rule === 'V36' && f.id === 'v-n5-0008').map((f) => f.message);
    expect(w).toEqual(['definitionJa resolves "飲" only by letting a single-kanji verb/adjective stem swallow the next kanji (likely a compound outside the Station 1 allowlist)']);
    // a span nothing resolves is still an F
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 7)['definitionJa'] = { ja: '{飲龍|のみりゅう}のこと。', kana: 'のみりゅうのこと。' };
    });
    const r2 = validate(root, { strict: true });
    expect(r2.failures.filter((f) => f.rule === 'V36' && f.id === 'v-n5-0008').map((f) => f.message)).toEqual(['definitionJa uses words outside the Station 1 allowlist: 龍']);
    expect(r2.warnings.filter((f) => f.rule === 'V36' && f.id === 'v-n5-0008').map((f) => f.message)).toEqual(['definitionJa resolves "飲龍" only by letting a single-kanji verb/adjective stem swallow the next kanji (likely a compound outside the Station 1 allowlist)']);
  });

  it('V36 J-J definitions', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 7)['definitionJa'] = { ja: '{飲|の}む{水|みず}のこと。', kana: 'のむみずのこと。' };
    });
    pipeline(root);
    expectRule(validate(root, { strict: true }), 'V36');
    expect(rules(validate(root).failures)).not.toContain('V36');
  });
});

describe('validate — linker and options', () => {
  it('writes tokenIds parallel to tokens in strict mode (and content:assign already linked them)', () => {
    const root = copyFixture();
    pipeline(root);
    const story = JSON.parse(readFileSync(join(root, 'stories/n5/stories-s04.json'), 'utf8')) as Json;
    const lines = item(story)['lines'] as Json[];
    for (const ln of lines) expect((ln['tokenIds'] as unknown[]).length).toBe((ln['tokens'] as unknown[]).length);
    expect(lines[0]!['tokenIds']).toEqual([null, null, null, 'v-n5-0006', null, 'v-n5-0005', null, null, null]);
    expect(lines[6]!['tokenIds']).toEqual(['v-n5-0008', null, 'v-n5-0007', null, null]);
    const r = validate(root, { strict: true });
    expect(r.linked).toBe(12);
  });

  it('links inflected forms through the fixture: 飲んで → 飲む, いきます / いった → 行く, たべました → 食べる; auxiliary spellings need no vocabIds entry', () => {
    const root = copyFixture();
    mutate(root, 'stories/n5/stories-s04.json', (d) => {
      const lines = item(d)['lines'] as Json[];
      Object.assign(lines[2]!, { ja: '{水|みず}を{飲|の}んで、{学校|がっこう}へいきます。', kana: 'みずをのんで、がっこうへいきます。', tokens: ['水', 'を', '飲んで', '、', '学校', 'へ', 'いきます', '。'] });
      Object.assign(lines[4]!, { ja: '{友達|ともだち}はパンをたべました。', kana: 'ともだちはパンをたべました。', tokens: ['友達', 'は', 'パン', 'を', 'たべました', '。'] });
      Object.assign(lines[8]!, { ja: '{学校|がっこう}へいった。', kana: 'がっこうへいった。', tokens: ['学校', 'へ', 'いった', '。'] });
      // the one kanji 行きます becomes the auxiliary spelling too, so 行く is used only as いきます / いった
      const last = lines[11]!;
      const swap = (t: string) => t.replace('行きます', 'いきます');
      Object.assign(last, { ja: 'はい、{大|おお}きいです。{私|わたし}は{学校|がっこう}へいきます。', kana: swap(String(last['kana'])), tokens: (last['tokens'] as string[]).map(swap), mustInclude: ['学校', 'いきます'] });
      last['options'] = (last['options'] as Json[]).map((o) => ({ ...o, text: swap(String(o['text'])), ...(o['recast'] ? { recast: swap(String(o['recast'])) } : {}) }));
      last['accept'] = (last['accept'] as string[]).map(swap);
      item(d)['vocabIds'] = (item(d)['vocabIds'] as string[]).filter((x) => x !== 'v-n5-0007' && x !== 'v-n5-0012');
    });
    pipeline(root);
    const r = validate(root, { strict: true });
    const story = JSON.parse(readFileSync(join(root, 'stories/n5/stories-s04.json'), 'utf8')) as Json;
    const lines = item(story)['lines'] as Json[];
    expect(lines[2]!['tokenIds']).toEqual(['v-n5-0008', null, 'v-n5-0007', null, 'v-n5-0013', null, 'v-n5-0012', null]);
    expect(lines[4]!['tokenIds']).toEqual(['v-n5-0003', null, 'v-n5-0011', null, 'v-n5-0010', null]);
    expect(lines[8]!['tokenIds']).toEqual(['v-n5-0013', null, 'v-n5-0012', null]);
    expect(lines[5]!['tokenIds']).toEqual(['v-n5-0014', null, 'v-n5-0004', null, null, 'v-n5-0002', null, null]); // no copula item: ではありません stays a function token
    // V20: 飲む (飲んで, a content use) is asked for in vocabIds; 行く is not, since いきます / いった are auxiliary spellings
    const missing = r.warnings.filter((f) => f.rule === 'V20' && /missing from vocabIds/.test(f.message)).map((f) => /word (v-n5-\d{4})/.exec(f.message)?.[1]);
    expect(missing).toEqual(['v-n5-0007']);
  });

  it('--fix-tokenids rewrites stale tokenIds; without it they fail V19', () => {
    const root = copyFixture();
    pipeline(root);
    mutate(root, 'stories/n5/stories-s04.json', (d) => {
      (item(d)['lines'] as Json[])[0]!['tokenIds'] = [null, null, null, null, null, null, null, null, null];
    });
    expectRule(validate(root), 'V19');
    const r = validate(root, { fixTokenIds: true });
    expect(r.failures.filter((f) => f.rule === 'V19')).toEqual([]);
    const story = JSON.parse(readFileSync(join(root, 'stories/n5/stories-s04.json'), 'utf8')) as Json;
    expect(((item(story)['lines'] as Json[])[0]!['tokenIds'] as unknown[])[3]).toBe('v-n5-0006');
  });

  it('--only filters findings to matching files', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d)['pos'] = 'verb';
    });
    mutate(root, 'kanji/n5/kanji-n5-001.json', (d) => {
      item(d)['strokes'] = 99;
    });
    expect(rules(validate(root, { only: 'kanji/**' }).failures)).toEqual(['V18']);
    expect(rules(validate(root, { only: 'vocab/n5/vocab-n5-001.json' }).failures)).toEqual(['V07']);
  });

  it('components/denylist overrides are honoured', () => {
    const root = copyFixture();
    const r = validate(root, { components: [{ id: 'c-sun', char: '日', name: 'sun' }], denylist: ['katana'] });
    expect(rules(r.failures)).toContain('V07');
    expect(rules(r.failures)).toContain('V30');
    expect(existsSync(join(root, '_meta/denylist.json'))).toBe(true);
  });
});

/* ── round 2: V30 matcher equivalence, V37/V38, V20/V26/V33/V35 accuracy ─── */

import { compileDenylist, findDenylisted, DEFECTIVE_VERB_FORMS, ICHIDAN_ENDING_RE, KNOWN_ICHIDAN } from './validate-content.ts';
import type { Denylist } from './validate-content.ts';
import { deriveContentVersion } from './build-content-index.ts';
import { readdirSync, statSync } from 'node:fs';

/** The matcher V30 used before round 2: one regex per Latin term, `includes` per other term, then patterns. */
function legacyDenyMatch(d: Denylist, s: string): boolean {
  for (const t of d.terms) {
    if (!t) continue;
    if (/^[\x20-\x7e]+$/.test(t)) {
      if (new RegExp(`(^|[^A-Za-z])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`, 'i').test(s)) return true;
    } else if (s.includes(t)) return true;
  }
  for (const p of d.patterns) if (new RegExp(p, 'iu').test(s)) return true;
  return false;
}

/** Every string value in every JSON file under `dir` (except the denylist itself, which the validator never scans). */
function allStrings(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allStrings(p, out);
    else if (name.endsWith('.json') && name !== 'denylist.json') {
      const walk = (v: unknown): void => {
        if (typeof v === 'string') out.push(v);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
      };
      walk(JSON.parse(readFileSync(p, 'utf8')));
    }
  }
  return out;
}

describe('V30 denylist matcher', () => {
  const fixtureList = JSON.parse(readFileSync(join(GOOD, '_meta/denylist.json'), 'utf8')) as { terms: string[]; patterns: string[] };
  const denylist: Denylist = {
    // the fixture list plus terms with every awkward shape the real list has: regex metacharacters,
    // digits, spaces, mixed case, non-ASCII Latin, a CJK term that is a prefix of another, an empty term
    terms: [...fixtureList.terms, 'Dr. Stone', 'K-On', 'Jump+', 'PS5', 'Ranma 1/2', 'THE IDOLM@STER', 'Persona', 'Persona 3', 'Pokémon', 'HUNTER×HUNTER', 'ロケット団', 'ロケット', '999', ''],
    patterns: [...fixtureList.patterns, '[A-Z]{2,4}48(?!\\d)'],
  };
  const probes = [
    ...allStrings(GOOD),
    'like Pikachu', 'PIKACHU!', 'pikachu', 'Pikachus', 'xPikachu', 'a Pokémon reference', 'Pokemon Go', 'pokémon', 'ピカチュウのように', 'ピカチュ',
    'Dr. Stone is on', 'Dr Stone', 'dr. stone!', 'K-On', 'K-On!', 'K-Online', 'Jump+ app', 'Jump', 'PS5 game', 'PS50', 'ranma 1/2', 'THE IDOLM@STER',
    'Persona 3 Reload', 'personable', 'persona', 'HUNTER×HUNTER', 'Hunter×Hunter', 'ロケット団の人', 'ロケット', 'ロケッ', 'Totoro', 'トトロ', 'トト',
    'Nintendo Switch', 'nintendo', 'Switch', 'AKB48', 'akb48', 'AKB480', '999 bottles', 'room 9999', '', ' ', '日本の本です。',
  ];

  it('the alternation/bucket matcher flags exactly the strings the per-term matcher flagged', () => {
    const compiled = compileDenylist(denylist);
    expect(compiled.latin.length).toBeGreaterThan(0);
    expect(compiled.other.size).toBeGreaterThan(0);
    expect(compiled.latinNeedsLetter).toBe(false); // '999' has no letter, so the Latin fast path is off
    const legacy = probes.filter((s) => legacyDenyMatch(denylist, s));
    const fresh = probes.filter((s) => findDenylisted(compiled, s) !== null);
    expect(fresh).toEqual(legacy);
    expect(legacy).toContain('like Pikachu');
    expect(legacy).toContain('Pokemon Go');
    expect(legacy).toContain('ロケット団の人');
    expect(legacy).not.toContain('Pikachus');
    expect(legacy).not.toContain('K-Online');
    expect(legacy).toContain('PS50'); // the boundary is letter-only (digits adjoin), as before
    expect(legacy).not.toContain('日本の本です。');
    // the fixture corpus itself is clean under both
    expect(allStrings(GOOD).filter((s) => legacyDenyMatch(denylist, s))).toEqual([]);
  });

  it('reports the term as the denylist spells it, longest first, and keeps the Latin fast path when every term has a letter', () => {
    const c = compileDenylist({ terms: ['Persona', 'Persona 3', 'ピカチュウ', 'Dr. Stone'], patterns: ['\\bPok[eé]mon\\b', '('] });
    expect(c.latinNeedsLetter).toBe(true);
    expect(c.invalidPatterns).toEqual(['(']);
    expect(findDenylisted(c, 'persona 3 reload')).toEqual({ kind: 'term', value: 'Persona 3' });
    expect(findDenylisted(c, 'PERSONA!')).toEqual({ kind: 'term', value: 'Persona' });
    expect(findDenylisted(c, 'DR. STONE')).toEqual({ kind: 'term', value: 'Dr. Stone' });
    expect(findDenylisted(c, 'Dr Stone')).toBeNull();
    expect(findDenylisted(c, 'あのピカチュウ')).toEqual({ kind: 'term', value: 'ピカチュウ' });
    expect(findDenylisted(c, 'a Pokémon')).toEqual({ kind: 'pattern', value: '\\bPok[eé]mon\\b' });
    expect(findDenylisted(c, 'personable')).toBeNull();
    expect(findDenylisted(c, '日本')).toBeNull();
  });

  it('an invalid pattern is a V30 warning on the denylist file, not a crash', () => {
    const root = copyFixture();
    const r = validate(root, { denylist: { terms: ['Pikachu'], patterns: ['('] } });
    expect(r.warnings.some((w) => w.rule === 'V30' && w.file === '_meta/denylist.json' && /invalid pattern/.test(w.message))).toBe(true);
  });
});

describe('V37 pos vs verb ending (W only)', () => {
  it('the good fixture carries no V37/V38 warnings', () => {
    const r = validate(copyFixture());
    expect(rules(r.warnings)).not.toContain('V37');
    expect(rules(r.warnings)).not.toContain('V38');
  });

  it('ICHIDAN_ENDING_RE accepts い/え-row + る in both scripts and rejects everything else', () => {
    for (const k of ['たべる', 'みる', 'おきる', 'でる', 'ウケる', 'かりる', 'ねる']) expect(ICHIDAN_ENDING_RE.test(k)).toBe(true);
    for (const k of ['のむ', 'いく', 'つくる', 'ある', 'する', 'たべ', 'かう', 'のる']) expect(ICHIDAN_ENDING_RE.test(k)).toBe(false);
    expect(ICHIDAN_ENDING_RE.test('はしる')).toBe(true); // い-row + る looks ichidan; 走る is a godan exception, which is why v5 needs KNOWN_ICHIDAN
    expect(KNOWN_ICHIDAN.has('食べる')).toBe(true);
    expect(KNOWN_ICHIDAN.has('帰る')).toBe(false);
  });

  it('flags v1 with a godan ending, v1 ending in する/くる, and v5 that is a known ichidan verb; never fails', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 11)['pos'] = 'v1'; // 行く いく
      item(d, 9)['pos'] = 'v5'; // 食べる たべる (known ichidan, not in the fixture conjugation table)
      item(d, 14)['word'] = '勉強する';
      item(d, 14)['kana'] = 'べんきょうする';
      item(d, 14)['pos'] = 'v1';
      (item(d, 14)['examples'] as Json[])[0] = { ja: '{毎日|まいにち}{勉強|べんきょう}します。', kana: 'まいにちべんきょうします。', en: 'I study every day.' };
      item(d, 14)['meanings'] = ['to study'];
    });
    const r = validate(root);
    const w = r.warnings.filter((f) => f.rule === 'V37');
    expect(r.failures.filter((f) => f.rule === 'V37')).toEqual([]);
    expect(w.find((f) => f.id === 'v-n5-0012')?.message).toMatch(/suggested pos v5/);
    expect(w.find((f) => f.id === 'v-n5-0010')?.message).toMatch(/known ichidan verb; suggested pos v1/);
    expect(w.find((f) => f.id === 'v-n5-0015')?.message).toMatch(/ends in する\/くる; suggested pos v-irr/);
    expect(w.length).toBe(3);
  });

  it('uses the conjugation table as ground truth where the head word appears', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 6)['pos'] = 'v1'; // 飲む is v5 in conjugation-001
    });
    mutate(root, 'conjugation/conjugation-001.json', (d) => {
      (d['items'] as Json[]).push({ id: 'cj-0004', word: '食べる', kana: 'たべる', pos: 'v1', form: 'masu', answer: '食べます', answerKana: 'たべます' });
      (d['items'] as Json[]).push({ id: 'cj-0005', word: '帰る', kana: 'かえる', pos: 'v5', form: 'masu', answer: '帰ります', answerKana: 'かえります' });
    });
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      // 帰る: え-mora + る but attested v5 → silent; 食べる attested v1 → silent even though the ending check would pass anyway
      item(d, 12)['word'] = '帰る';
      item(d, 12)['kana'] = 'かえる';
      item(d, 12)['pos'] = 'v5';
      item(d, 12)['meanings'] = ['to go home'];
      (item(d, 12)['examples'] as Json[])[0] = { ja: '{家|いえ}に{帰|かえ}ります。', kana: 'いえにかえります。', en: 'I go home.' };
    });
    const r = validate(root);
    const w = r.warnings.filter((f) => f.rule === 'V37');
    expect(w.map((f) => f.id)).toEqual(['v-n5-0007']);
    expect(w[0]!.message).toMatch(/conjugation table lists "飲む" as v5; suggested pos v5/);
  });

  it('a v5 whose ending looks ichidan but is not a known ichidan verb stays silent', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 12)['word'] = '走る';
      item(d, 12)['kana'] = 'はしる';
      item(d, 12)['pos'] = 'v5';
      item(d, 11)['word'] = '切る';
      item(d, 11)['kana'] = 'きる';
      item(d, 11)['pos'] = 'v5';
    });
    expect(validate(root).warnings.filter((f) => f.rule === 'V37')).toEqual([]);
  });
});

describe('V38 repeated kanji component (W only)', () => {
  it('warns once per kanji, names the repeated part and does not dedupe or fail', () => {
    const root = copyFixture();
    mutate(root, 'kanji/n5/kanji-n5-001.json', (d) => {
      item(d, 3)['components'] = ['tree', 'one', 'tree'];
    });
    const r = validate(root);
    expect(r.failures).toEqual([]);
    const w = r.warnings.filter((f) => f.rule === 'V38');
    expect(w.length).toBe(1);
    expect(w[0]!.id).toBe('j-本');
    expect(w[0]!.message).toMatch(/repeats "tree" \(tree, one, tree\)/);
    const doc = JSON.parse(readFileSync(join(root, 'kanji/n5/kanji-n5-001.json'), 'utf8')) as Json;
    expect(item(doc, 3)['components']).toEqual(['tree', 'one', 'tree']);
  });
});

describe('V40 unlocksForms with nothing to conjugate (W only)', () => {
  it('warns when a station declares a verb form but its cumulative allowlist has no verb; silent on the good fixture and without bundles; never fails', () => {
    expect(validate(copyFixture()).warnings.filter((f) => f.rule === 'V40')).toEqual([]);
    const root = copyFixture();
    pipeline(root);
    expect(validate(root, { strict: true }).warnings.filter((f) => f.rule === 'V40')).toEqual([]);
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      for (const it of d['items'] as Json[]) if (it['pos'] === 'v1' || it['pos'] === 'v5') it['pos'] = 'n';
    });
    const r = validate(root, { strict: true });
    const w = r.warnings.filter((f) => f.rule === 'V40');
    expect(w.map((f) => f.id)).toEqual(['g-n5-003']);
    expect(w[0]!.file).toBe('grammar/n5/grammar-n5-001.json');
    expect(w[0]!.message).toMatch(/unlocksForms masu at Station 4, but the cumulative allowlist has no conjugable verb/);
    expect(r.failures.filter((f) => f.rule === 'V40')).toEqual([]);
    // an adjective form with no adjective in the allowlist is the other half
    mutate(root, 'grammar/n5/grammar-n5-001.json', (d) => {
      item(d, 2)['unlocksForms'] = ['adj-neg'];
    });
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      for (const it of d['items'] as Json[]) if (it['pos'] === 'adj-i') it['pos'] = 'n';
    });
    const adj = validate(root).warnings.filter((f) => f.rule === 'V40');
    expect(adj.map((f) => f.message)).toEqual([expect.stringMatching(/unlocksForms adj-neg at Station 4, but the cumulative allowlist has no adjective/)]);
  });
});

describe('V39 duplicated michikusa card (W only)', () => {
  it('the good fixture carries no V39 warnings', () => {
    expect(validate(copyFixture()).warnings.filter((f) => f.rule === 'V39')).toEqual([]);
  });

  it('warns both items when the same ja (different ruby split) or kana is collected at another station, never fails', () => {
    const root = copyFixture();
    writeFileSync(
      join(root, 'michikusa/michikusa-s05.json'),
      JSON.stringify(
        {
          schema: 'tsuzuku.content/1',
          type: 'michikusa',
          writer: 'fixture',
          items: [
            { id: 'm-05-1', stationId: 'st-05', kind: 'proverb', titleEn: 'Time is money, again', bodyEn: 'The same saying, collected a second time at Totsuka.', ja: '{時|とき}は{金|かね}なり。', kana: 'ときはかねなり。' },
            { id: 'm-05-2', stationId: 'st-05', kind: 'culture', titleEn: 'Fifty-three again', bodyEn: 'A different card with a different Japanese word.', ja: '{宿場|しゅくば}', kana: 'しゅくば' },
          ],
        },
        null,
        2,
      ) + '\n',
    );
    const r = validate(root);
    expect(r.failures).toEqual([]);
    const w = r.warnings.filter((f) => f.rule === 'V39');
    expect(w.map((f) => f.id).sort()).toEqual(['m-04-2', 'm-05-1']);
    expect(w.find((f) => f.id === 'm-04-2')!.message).toMatch(/also collected at m-05-1/);
    expect(w.find((f) => f.id === 'm-05-1')!.file).toBe('michikusa/michikusa-s05.json');
  });

  it('does not warn for two cards at the same station', () => {
    const root = copyFixture();
    mutate(root, 'michikusa/michikusa-s04.json', (d) => {
      item(d, 0)['ja'] = '{時|とき}は{金|かね}なり。';
      item(d, 0)['kana'] = 'ときはかねなり。';
    });
    expect(validate(root).warnings.filter((f) => f.rule === 'V39')).toEqual([]);
  });
});

describe('validator accuracy (round 2)', () => {
  it('V20 warns when vocabIds covers < 60 % of the allowlisted words detected in the text, even in strict mode', () => {
    const root = copyFixture();
    mutate(root, 'stories/n5/stories-s04.json', (d) => {
      item(d)['vocabIds'] = ['v-n5-0005'];
    });
    pipeline(root);
    const r = validate(root, { strict: true });
    const w = r.warnings.filter((f) => f.rule === 'V20' && /vocabIds covers/.test(f.message));
    expect(w.length).toBe(1);
    expect(w[0]!.id).toBe('s-04-1');
    expect(w[0]!.message).toMatch(/covers 1 of \d+ allowlisted words .* % < 60 %/);
    expect(r.failures.filter((f) => f.rule === 'V20' && /vocabIds covers/.test(f.message))).toEqual([]);
    // the full list passes silently
    const root2 = copyFixture();
    pipeline(root2);
    expect(validate(root2, { strict: true }).warnings.filter((f) => f.rule === 'V20' && /vocabIds covers/.test(f.message))).toEqual([]);
  });

  it('V33 exempts proper nouns (weekdays, months, nationalities, festivals, places, acronyms) but still warns on ordinary words', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 1)['meanings'] = ['Monday', 'Japanese person', 'Western-style clothes', 'Obon', "New Year's Eve", 'Europe', 'TV', 'United Nations', 'Buddhist temple', 'Tanabata'];
      item(d, 2)['meanings'] = ['Friend', 'Big book'];
    });
    const r = validate(root);
    const upper = r.warnings.filter((f) => f.rule === 'V33' && /starts uppercase/.test(f.message));
    expect(upper.map((f) => f.id)).toEqual(['v-n5-0003', 'v-n5-0003']);
    expect(upper.map((f) => /"(.*)"$/.exec(f.message)?.[1])).toEqual(['Friend', 'Big book']);
  });

  it('V26 does not ask for forms a defective verb lacks (ある, 要る) but still reports its real gaps', () => {
    const root = copyFixture();
    mutate(root, 'conjugation/conjugation-001.json', (d) => {
      (d['items'] as Json[]).push(
        { id: 'cj-0004', word: 'ある', kana: 'ある', pos: 'v5', form: 'masu', answer: 'あります', answerKana: 'あります' },
        { id: 'cj-0005', word: '要る', kana: 'いる', pos: 'v5', form: 'masu', answer: '要ります', answerKana: 'いります' },
      );
    });
    const r = validate(root);
    const aru = r.warnings.find((f) => f.rule === 'V26' && f.id === 'cj-0004')!;
    expect(aru).toBeDefined();
    for (const fm of DEFECTIVE_VERB_FORMS['ある']!) expect(aru.message).not.toMatch(new RegExp(`\\b${fm}\\b`));
    expect(aru.message).toMatch(/\bte\b/);
    expect(aru.message).toMatch(/\bnai\b/);
    const iru = r.warnings.find((f) => f.rule === 'V26' && f.id === 'cj-0005')!;
    expect(iru.message).not.toMatch(/imperative|volitional|passive|causative|prohibitive|tai|te-iru/);
    // a regular verb keeps the full list
    const nomu = r.warnings.find((f) => f.rule === 'V26' && f.id === 'cj-0001')!;
    expect(nomu.message).toMatch(/potential/);
    expect(nomu.message).toMatch(/imperative/);
  });

  it('V35 flags a derived contentVersion that no longer matches the content', () => {
    const root = copyFixture();
    assign(root, PLAN, { write: true, allowlistsDir: join(root, '..', `${root.split('/').pop()}-allowlists`) });
    writeIndex(root, undefined, { generatedAt: '2026-10-17T00:00:00.000Z' });
    const before = validate(root, { strict: true });
    expect(before.failures.filter((f) => f.rule === 'V35')).toEqual([]);
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as { contentVersion: string };
    expect(manifest.contentVersion).toBe(deriveContentVersion(root));
    const p = join(root, 'michikusa/michikusa-s04.json');
    writeFileSync(p, readFileSync(p, 'utf8').replace('Hodogaya was', 'Hodogaya is'));
    const after = validate(root, { strict: true });
    expect(after.failures.some((f) => f.rule === 'V35' && /contentVersion .* is stale/.test(f.message))).toBe(true);
    // an overridden version is never compared
    writeIndex(root, '2026.10.1', { generatedAt: '2026-10-17T00:00:00.000Z' });
    expect(validate(root, { strict: true }).failures.filter((f) => f.rule === 'V35')).toEqual([]);
  });
});

/* ── design 08 §5: listening pieces — V41 / V42 / V43 / V45 / V46, the V05 / V34 amendments, the pool skip ── */

import { castNames, lineMorae, ownStationUnknowns, PIECE_LINE_MAX_MORAE, PIECE_TARGET_SECONDS, POOL_FILE_RE, speechSeconds, textSpeechSeconds } from './validate-content.ts';
import { buildMatchPool } from './linker.ts';
import type { GrammarItem, StoryLine, VocabItem } from '../src/content/types.ts';

const CAST = join(here, '__fixtures__', 'cast.sample.json');
const POOL = join(here, '__fixtures__', 'pool.sample.json');
/** A path that never exists, so these tests do not depend on whether scripts/audio/cast.json has landed. */
const NO_CAST = join(here, '__fixtures__', 'no-such-cast.json');
const LISTENING = 'stories/n5/listening-s04.json';

/** validate() with the cast check pointed at an absent file unless the test says otherwise. */
function v(root: string, o: Parameters<typeof validate>[1] = {}): ValidateResult {
  return validate(root, { cast: NO_CAST, ...o });
}

/**
 * A valid Station 4 audio-first dialogue built from the fixture text: `genre: 'exchange'`, no `learnerSpeaker`
 * (not a role-play, so V27 does not apply), gist / detail / speaker questions each with a `lineRef`.
 */
function piece(root: string, id = 's-04-4', over: Json = {}): Json {
  const story = JSON.parse(readFileSync(join(root, 'stories/n5/stories-s04.json'), 'utf8')) as Json;
  const base = item(story);
  const lines = (base['lines'] as Json[]).map((l) => {
    const { options: _o, accept: _a, mustInclude: _m, ...rest } = l;
    return rest;
  });
  const comprehension = (base['comprehension'] as Json[]).map((q, i) => ({ ...q, kind: ['gist', 'detail', 'speaker'][i], lineRef: i }));
  const { learnerSpeaker: _ls, ...rest } = base;
  return { ...rest, id, titleJa: '{水|みず}', titleEn: 'Water', genre: 'exchange', audioFirst: true, lines, comprehension, ...over };
}

/** A speaker-less (`kind: 'story'`) piece read by a cast narrator — the one-sided shape of design 08 §3. */
function storyPiece(root: string, id = 's-04-4', over: Json = {}): Json {
  const p = piece(root, id);
  const lines = (p['lines'] as Json[]).map((l) => {
    const { speaker: _s, aizuchiSlot: _z, ...rest } = l;
    return rest;
  });
  const comprehension = (p['comprehension'] as Json[]).map((q) => ({ ...q, kind: q['kind'] === 'speaker' ? 'detail' : q['kind'] }));
  return { ...p, kind: 'story', narrator: 'anchor', lines, comprehension, ...over };
}

function writeStoryFile(root: string, rel: string, items: Json[], level = 'n5'): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), JSON.stringify({ schema: 'tsuzuku.content/1', type: 'story', level, writer: 'fixture-listening', items }, null, 2) + '\n');
}

const LONG_LINE = {
  ja: 'わたしはまいあさがっこうでともだちとパンをたべます。',
  kana: 'わたしはまいあさがっこうでともだちとパンをたべます。',
  en: 'Every morning I eat bread with my friends at school.',
  tokens: ['わたし', 'は', 'まいあさ', 'がっこう', 'で', 'ともだち', 'と', 'パン', 'を', 'たべます', '。'],
};

describe('listening pieces (design 08 §5) — placement, pool skip, pipeline', () => {
  it('a valid piece in listening-s04.json passes; listening/pool-NN.json is skipped by the walk; anything else under listening/ is still V08', () => {
    const root = copyFixture();
    writeStoryFile(root, LISTENING, [piece(root)]);
    mkdirSync(join(root, 'listening'));
    cpSync(POOL, join(root, 'listening/pool-04.json'));
    const r = v(root);
    expect(r.failures).toEqual([]);
    expect(r.files).toBe(10);
    expect(r.warnings.filter((w) => w.file.startsWith('listening/'))).toEqual([]);
    expect(rules(r.warnings)).not.toContain('V01');
    expect(rules(r.warnings)).not.toContain('V08');
    expect(POOL_FILE_RE.test('listening/pool-07.json')).toBe(true);
    expect(POOL_FILE_RE.test('listening/pool-7.json')).toBe(false);
    writeFileSync(join(root, 'listening/notes.json'), '{}\n');
    expect(v(root).failures.map((f) => `${f.rule} ${f.file}`)).toEqual(['V08 listening/notes.json']);
    rmSync(join(root, 'listening/notes.json'));
    // strict after the pipeline: the piece joins the station bundle and nothing but the tiny-corpus quota rule fails
    pipeline(root);
    const s = v(root, { strict: true });
    expect(rules(s.failures)).toEqual(['V34']);
    const b = JSON.parse(readFileSync(join(root, 'stations/04.json'), 'utf8')) as { storyIds: string[] };
    expect(b.storyIds).toEqual(['s-04-1', 's-04-4']);
    const m = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as { files: { path: string; type: string; stations: number[] }[]; totals: Record<string, number> };
    expect(m.files.find((f) => f.path === LISTENING)).toMatchObject({ type: 'story', stations: [4] });
    expect(m.totals['pool']).toBe(0);
  });

  it('V05 amendment: a sequence up to quota.stories + quota.listening is accepted, one beyond it fails', () => {
    const root = copyFixture();
    writeStoryFile(root, LISTENING, [piece(root, 's-04-5')]);
    expect(v(root).failures.filter((f) => f.rule === 'V05')).toEqual([]);
    writeStoryFile(root, LISTENING, [piece(root, 's-04-6')]);
    expect(v(root).failures.filter((f) => f.rule === 'V05').map((f) => f.message)).toEqual(['story sequence 6 > quota.stories + quota.listening (3 + 2) for st-04']);
  });
});

describe('V41 listening fields (F)', () => {
  it('genre before its station, an unknown genre, audioFirst without genre, audioFirst: false', () => {
    const root = copyFixture();
    writeStoryFile(root, LISTENING, [
      piece(root, 's-04-2', { genre: 'news' }),
      piece(root, 's-04-4', { genre: 'podcast' }),
      piece(root, 's-04-5', { genre: undefined }),
    ]);
    const msgs = v(root).failures.filter((f) => f.rule === 'V41').map((f) => `${f.id} ${f.message}`);
    expect(msgs).toContain('s-04-2 genre "news" only from Station 32 (this text is at Station 4)');
    expect(msgs).toContain('s-04-4 genre "podcast" is not a ListeningGenre');
    expect(msgs).toContain('s-04-5 audioFirst requires genre');
    const root2 = copyFixture();
    writeStoryFile(root2, LISTENING, [piece(root2, 's-04-4', { audioFirst: false })]);
    expect(v(root2).failures.filter((f) => f.rule === 'V41').map((f) => f.message)).toContain('audioFirst is true or omitted (got false)');
  });

  it('narrator on a dialogue, a speaker-kind question in a story, lineRef out of range, an unknown question kind', () => {
    const root = copyFixture();
    const dialogue = piece(root, 's-04-4', { narrator: 'ケン' });
    (dialogue['comprehension'] as Json[])[2]!['lineRef'] = 99;
    (dialogue['comprehension'] as Json[])[1]!['kind'] = 'trivia';
    const story = storyPiece(root, 's-04-5');
    (story['comprehension'] as Json[])[2]!['kind'] = 'speaker';
    writeStoryFile(root, LISTENING, [dialogue, story]);
    const msgs = v(root).failures.filter((f) => f.rule === 'V41').map((f) => `${f.id} ${f.message}`);
    expect(msgs).toContain('s-04-4 narrator only on kind "story" (a dialogue names its speakers per line)');
    expect(msgs).toContain('s-04-4 comprehension[2].lineRef 99 is not a line index (0–11)');
    expect(msgs).toContain('s-04-4 comprehension[1].kind "trivia" is not a QuestionKind');
    expect(msgs).toContain('s-04-5 comprehension[2].kind "speaker" only in a dialogue');
    // the narrator-read story piece itself is fine (no speakers, questions gist/detail/detail)
    expect(msgs.filter((m) => m.startsWith('s-04-5 ')).length).toBe(1);
  });

  it('a 25-mora line at Station 4 fails the dictable cap, no gist question fails, emotion is checked', () => {
    const root = copyFixture();
    const p = piece(root);
    (p['lines'] as Json[])[2] = { speaker: 'ケン', ...LONG_LINE, emotion: 'shouting' };
    (p['lines'] as Json[])[3]!['emotion'] = 'warm';
    (p['comprehension'] as Json[])[0]!['kind'] = 'detail';
    writeStoryFile(root, LISTENING, [p]);
    const r = v(root);
    const msgs = r.failures.filter((f) => f.rule === 'V41').map((f) => f.message);
    expect(lineMorae(LONG_LINE.kana)).toBe(25);
    expect(lineMorae('はい、ほんです。')).toBe(6);
    expect(PIECE_LINE_MAX_MORAE).toBe(22);
    expect(msgs).toContain('lines[2] is 25 morae > 22 (every line of a piece is dictable through Station 15)');
    expect(msgs).toContain('an audioFirst text needs ≥ 1 comprehension question with kind "gist"');
    expect(msgs).toContain('lines[2].emotion "shouting" is not a LineEmotion');
    expect(msgs.filter((m) => /emotion/.test(m)).length).toBe(1); // warm is fine on a dialogue line
    // the same long line at Station 16 is not capped (cap is through Station 15; the Station 16 file is a different fixture station)
    const root2 = copyFixture();
    writeStoryFile(root2, 'stories/n4/listening-s16.json', [piece(root2, 's-16-4', { stationId: 'st-16', genre: 'narrative', lines: (p['lines'] as Json[]).map((l) => ({ ...l, emotion: undefined })) })], 'n4');
    expect(v(root2).failures.filter((f) => f.rule === 'V41' && /morae/.test(f.message))).toEqual([]);
  });

  it('emotion on a story line without narrator is a W; with a narrator it is silent', () => {
    const root = copyFixture();
    const withNarrator = storyPiece(root, 's-04-4');
    (withNarrator['lines'] as Json[])[0]!['emotion'] = 'whisper';
    const without = storyPiece(root, 's-04-5', { narrator: undefined });
    (without['lines'] as Json[])[0]!['emotion'] = 'whisper';
    writeStoryFile(root, LISTENING, [withNarrator, without]);
    const r = v(root);
    expect(r.failures.filter((f) => f.rule === 'V41')).toEqual([]);
    expect(r.warnings.filter((f) => f.rule === 'V41').map((f) => `${f.id} ${f.message}`)).toEqual(['s-04-5 lines[0].emotion on a story line without narrator (no cast voice to style)']);
  });

  it('an audioFirst dialogue with a learnerSpeaker that is not one of its speakers fails V41 (and V25); without learnerSpeaker V27 is not required', () => {
    const root = copyFixture();
    writeStoryFile(root, LISTENING, [piece(root, 's-04-4', { learnerSpeaker: 'アオ' }), piece(root, 's-04-5')]);
    const r = v(root);
    expect(r.failures.filter((f) => f.rule === 'V41').map((f) => `${f.id} ${f.message}`)).toEqual([
      's-04-4 audioFirst dialogue: learnerSpeaker "アオ" is not one of its speakers (ケン, ハナ); omit it unless the piece is also a role-play',
    ]);
    expect(r.failures.some((f) => f.rule === 'V25' && f.id === 's-04-4')).toBe(true);
    expect(r.failures.filter((f) => f.rule === 'V27')).toEqual([]);
    // naming a real speaker turns the piece into a role-play: V27 now asks for the learner-line fields
    const root2 = copyFixture();
    writeStoryFile(root2, LISTENING, [piece(root2, 's-04-4', { learnerSpeaker: 'ハナ' })]);
    const r2 = v(root2);
    expect(r2.failures.filter((f) => f.rule === 'V41')).toEqual([]);
    expect(r2.failures.some((f) => f.rule === 'V27' && /learner line/.test(f.message))).toBe(true);
  });
});

describe('V42 cast (F in strict mode, W otherwise)', () => {
  it('an unknown speaker is a W without --strict and an F with it; a narrator resolves like a speaker; unused entries warn', () => {
    const root = copyFixture();
    writeStoryFile(root, LISTENING, [piece(root, 's-04-4'), storyPiece(root, 's-04-5')]);
    mutate(root, LISTENING, (d) => {
      for (const ln of item(d)['lines'] as Json[]) if (ln['speaker'] === 'ケン') ln['speaker'] = '山田さん';
    });
    const w = validate(root, { cast: CAST });
    const v42 = w.warnings.filter((f) => f.rule === 'V42');
    expect(v42.find((f) => f.id === 's-04-4')?.message).toMatch(/^speaker "山田さん" does not resolve in .*cast\.sample\.json/);
    expect(v42.filter((f) => f.id === 's-04-5')).toEqual([]); // narrator 'anchor' is in the cast
    expect(v42.filter((f) => /used by no text/.test(f.message)).map((f) => /"(.+)"/.exec(f.message)?.[1]).sort()).toEqual(['lecturer', 'reader', '森さん', '田中さん']);
    expect(w.failures.filter((f) => f.rule === 'V42')).toEqual([]);
    const s = validate(root, { cast: CAST, strict: true });
    expect(s.failures.filter((f) => f.rule === 'V42').map((f) => f.id)).toEqual(['s-04-4']);
    // an unknown narrator is reported as such
    writeStoryFile(root, LISTENING, [storyPiece(root, 's-04-5', { narrator: 'ghost' })]);
    expect(validate(root, { cast: CAST, strict: true }).failures.filter((f) => f.rule === 'V42').map((f) => f.message)).toEqual([expect.stringMatching(/^narrator "ghost" does not resolve/)]);
  });

  it('an absent cast file is exactly one "cast check skipped" W and never an F; a parsed cast in any supported shape works', () => {
    const root = copyFixture();
    writeStoryFile(root, LISTENING, [piece(root)]);
    const a = validate(root, { cast: NO_CAST });
    expect(a.warnings.filter((f) => f.rule === 'V42').map((f) => f.message)).toEqual([expect.stringMatching(/^cast check skipped: .*no-such-cast\.json not found/)]);
    expect(validate(root, { cast: NO_CAST, strict: true }).failures.filter((f) => f.rule === 'V42')).toEqual([]);
    expect(castNames({ speakers: [{ name: 'ハナ' }, 'anchor'] })).toEqual(new Set(['ハナ', 'anchor']));
    expect(castNames([{ name: 'ケン' }, { character: 'no name' }])).toEqual(new Set(['ケン']));
    expect(castNames({ schema: 'tsuzuku.cast/1', ハナ: { character: '九州そら' }, anchor: { character: '波音リツ' } })).toEqual(new Set(['ハナ', 'anchor']));
    expect(castNames(null)).toEqual(new Set());
    // a parsed object passed directly is used as the cast
    const r = validate(root, { cast: { speakers: [{ name: 'ハナ' }] }, strict: true });
    const f42 = r.failures.filter((f) => f.rule === 'V42');
    expect(f42.map((f) => f.id).sort()).toEqual(['s-04-1', 's-04-4']); // one row per text that uses the unknown speaker
    for (const f of f42) expect(f.message).toMatch(/^speaker "ケン" does not resolve in scripts\/audio\/cast\.json/);
  });
});

describe('V43 quota and placement (F at release, W before)', () => {
  it('3 pieces at a station: every station off quota is W, under or over, with or without --strict; F with --strict --listening-release; pieces never count as stories (V34 amendment)', () => {
    const root = copyFixture();
    writeStoryFile(root, LISTENING, [piece(root, 's-04-2'), piece(root, 's-04-4'), piece(root, 's-04-5')]);
    const w = v(root);
    expect(w.failures.filter((f) => f.rule === 'V43')).toEqual([]);
    const w43 = w.warnings.filter((f) => f.rule === 'V43').map((f) => `${f.file} ${f.message}`);
    expect(w43.length).toBe(50); // st-04 over quota + the 49 stations from 5 that hold no piece yet (Stations 1–3 have quota 0)
    expect(w43).toContain('stories/n5/listening-s04.json st-04 listening pieces: 3 vs quota.listening 2');
    expect(w43).toContain('stories/n1/listening-s53.json st-53 listening pieces: 0 vs quota.listening 2');
    expect(w43.some((m) => / st-0[1-3] /.test(m))).toBe(false);
    pipeline(root);
    const s = v(root, { strict: true });
    expect(s.failures.filter((f) => f.rule === 'V43')).toEqual([]);
    expect(s.warnings.filter((f) => f.rule === 'V43').length).toBe(50);
    const rel = v(root, { strict: true, listeningRelease: true });
    const f43 = rel.failures.filter((f) => f.rule === 'V43');
    expect(f43.length).toBe(50);
    expect(f43.find((f) => f.file === LISTENING)?.message).toBe('st-04 listening pieces: 3 vs quota.listening 2');
    expect(f43.find((f) => f.file === 'stories/n1/listening-s53.json')?.message).toBe('st-53 listening pieces: 0 vs quota.listening 2');
    expect(rel.failures.find((f) => f.rule === 'V34' && /st-04 stories/.test(f.message))?.message).toBe('st-04 stories: 1 vs quota 3 (texts without audioFirst)');
  });

  it('with no piece anywhere, strict mode notes once that the listening quota is not checked (Pass 4 has not started) and never fails', () => {
    const root = copyFixture();
    pipeline(root);
    expect(v(root).warnings.filter((f) => f.rule === 'V43')).toEqual([]);
    const s = v(root, { strict: true, listeningRelease: true });
    expect(s.failures.filter((f) => f.rule === 'V43')).toEqual([]);
    expect(s.warnings.filter((f) => f.rule === 'V43').map((f) => f.message)).toEqual(['no audioFirst piece in the corpus yet (Pass 4): quota.listening not checked']);
  });

  it('placement: an audioFirst text inside stories-sNN.json and a plain text inside listening-sNN.json (W before release, F only with --strict --listening-release — one switch for the whole rule)', () => {
    const root = copyFixture();
    const plain = piece(root, 's-04-5', { audioFirst: undefined, genre: undefined });
    const misplaced = piece(root, 's-04-4');
    writeStoryFile(root, LISTENING, [plain]);
    mutate(root, 'stories/n5/stories-s04.json', (d) => {
      (d['items'] as Json[]).push(misplaced);
    });
    const w = v(root);
    expect(w.failures.filter((f) => f.rule === 'V43')).toEqual([]);
    const msgs = w.warnings.filter((f) => f.rule === 'V43').map((f) => `${f.id} ${f.message}`);
    expect(msgs).toContain('s-04-4 an audioFirst text lives in stories/<level>/listening-s04.json, not in stories-s04.json');
    expect(msgs).toContain('s-04-5 listening-sNN.json holds audioFirst pieces only (this text has no audioFirst: true)');
    pipeline(root);
    const strict = v(root, { strict: true });
    expect(strict.failures.filter((f) => f.rule === 'V43')).toEqual([]);
    expect(strict.warnings.filter((f) => f.rule === 'V43' && typeof f.id === 'string').map((f) => f.id).sort()).toEqual(['s-04-4', 's-04-5']);
    const rel = v(root, { strict: true, listeningRelease: true });
    expect(rel.failures.filter((f) => f.rule === 'V43' && typeof f.id === 'string').map((f) => f.id).sort()).toEqual(['s-04-4', 's-04-5']);
    expect(rel.warnings.filter((f) => f.rule === 'V43')).toEqual([]);
  });

  it('no pieces at Stations 1–3: a Station 2 piece is refused by V43, by V41 (genre gate) and by the V05 sequence (quota.listening 0)', () => {
    const root = copyFixture();
    writeStoryFile(root, 'stories/kana/listening-s02.json', [piece(root, 's-02-4', { stationId: 'st-02' })], 'kana');
    const r = v(root);
    const w43 = r.warnings.filter((f) => f.rule === 'V43').map((f) => f.message);
    expect(w43).toContain('audioFirst pieces only from Station 4 (none at Stations 1–3)');
    expect(w43).toContain('st-02 listening pieces: 1 vs quota.listening 0');
    expect(r.failures.some((f) => f.rule === 'V41' && f.message === 'genre "exchange" only from Station 4 (this text is at Station 2)')).toBe(true);
    expect(r.failures.some((f) => f.rule === 'V05' && f.message === 'story sequence 4 > quota.stories + quota.listening (3 + 0) for st-02')).toBe(true);
  });
});

describe('V45 minutes band (W)', () => {
  it('two short pieces warn, two pieces near the belt target do not; the estimate is kana chars ÷ 7 + 0.5 s per line', () => {
    expect(speechSeconds('はい、ほんです。')).toBeCloseTo(6 / 7 + 0.5, 6);
    expect(PIECE_TARGET_SECONDS.yellow).toBe(60);
    expect(PIECE_TARGET_SECONDS.white).toBe(0);
    const root = copyFixture();
    writeStoryFile(root, LISTENING, [piece(root, 's-04-4'), piece(root, 's-04-5')]);
    const short = v(root).warnings.filter((f) => f.rule === 'V45');
    expect(short.map((f) => `${f.file} ${f.message}`)).toEqual([expect.stringMatching(/^stories\/n5\/listening-s04\.json st-04 pieces speak ≈ \d+ s, outside ±30 % of the yellow band \(2 × 60 s = 120 s; kana chars ÷ 7 \+ 0\.5 s per line\)$/)]);
    // 17 lines of 21 kana ≈ 3.5 s each ≈ 60 s per piece → 119 s for two, inside [84, 156]
    const long: Json = {
      ja: 'はい、{大|おお}きいです。{私|わたし}は{学校|がっこう}へ{行|い}きます。',
      kana: 'はい、おおきいです。わたしはがっこうへいきます。',
      en: 'Yes, it is big. I am going to school.',
      tokens: ['はい', '、', '大きい', 'です', '。', '私', 'は', '学校', 'へ', '行きます', '。'],
    };
    const lines = Array.from({ length: 17 }, (_, i) => ({ ...long, speaker: i % 2 ? 'ケン' : 'ハナ' }));
    expect(textSpeechSeconds(lines as unknown as StoryLine[])).toBeCloseTo(17 * (21 / 7 + 0.5), 6);
    writeStoryFile(root, LISTENING, [piece(root, 's-04-4', { lines }), piece(root, 's-04-5', { lines })]);
    const r = v(root);
    expect(r.warnings.filter((f) => f.rule === 'V45')).toEqual([]);
    expect(r.failures.filter((f) => f.rule === 'V41')).toEqual([]);
  });
});

describe('V46 own-station all-known example (W; F for Stations 4–15 with --strict --listening-release)', () => {
  it('ownStationUnknowns: numerals, punctuation, function tokens, cast names, inflections and okurigana after a stem are known; a lone hiragana is tolerated', () => {
    const vocab = JSON.parse(readFileSync(join(GOOD, 'vocab/n5/vocab-n5-001.json'), 'utf8')) as { items: VocabItem[] };
    const grammar = JSON.parse(readFileSync(join(GOOD, 'grammar/n5/grammar-n5-001.json'), 'utf8')) as { items: GrammarItem[] };
    const pool = buildMatchPool(vocab.items, grammar.items);
    expect(ownStationUnknowns(pool, '私は学生です。')).toEqual([]);
    expect(ownStationUnknowns(pool, '水を飲んで、パンを食べました。')).toEqual([]);
    expect(ownStationUnknowns(pool, 'お水をください。')).toEqual([]);
    expect(ownStationUnknowns(pool, 'パンを三つ食べました。')).toEqual([]);
    expect(ownStationUnknowns(pool, '大きかったですね。')).toEqual([]);
    expect(ownStationUnknowns(pool, 'ハナさんは学校へいきます。')).toEqual([]);
    expect(ownStationUnknowns(pool, 'りんごを食べます。')).toEqual(['りんご']);
    expect(ownStationUnknowns(pool, '龍の水です。')).toEqual(['龍']);
    expect(ownStationUnknowns(pool, 'ハナさんはコーヒーを飲みます。')).toEqual(['コーヒー']);
    // だ is the copula function token, so the unknown run stops before it; the verdict (not all-known) is what V46 reads
    expect(ownStationUnknowns(pool, '学校へ行って、本を読んだ。')).toEqual(['読ん']);
    expect(ownStationUnknowns(pool, '本を読みました。')).toEqual(['読み']);
  });

  it('the good fixture is clean; an item whose every example uses a word outside its allowlist warns, fails at release for Stations 4–15, and one all-known example is enough', () => {
    const root = copyFixture();
    pipeline(root);
    expect(v(root).warnings.filter((f) => f.rule === 'V46')).toEqual([]);
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 7)['examples'] = [
        { ja: '{龍|りゅう}の{水|みず}です。', kana: 'りゅうのみずです。', en: 'It is dragon water.' },
        { ja: 'りんごと{水|みず}。', kana: 'りんごとみず。', en: 'An apple and water.' },
      ];
    });
    const w = v(root);
    const v46 = w.warnings.filter((f) => f.rule === 'V46');
    expect(v46.map((f) => f.id)).toEqual(['v-n5-0008']);
    expect(v46[0]!.message).toBe('no example links fully inside the Station 1 allowlist (own-station all-known example for the listening pool, Pass 4b) — examples[0]: 龍; examples[1]: りんご');
    expect(w.failures.filter((f) => f.rule === 'V46')).toEqual([]);
    // Station 1 is White: never an F (the release switch covers Stations 4–15)
    expect(v(root, { strict: true, listeningRelease: true }).failures.filter((f) => f.rule === 'V46')).toEqual([]);
    // the same item placed at Station 4 fails at release and only at release
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 7)['station'] = 4;
    });
    expect(v(root, { strict: true }).failures.filter((f) => f.rule === 'V46')).toEqual([]);
    expect(v(root, { strict: true, listeningRelease: true }).failures.filter((f) => f.rule === 'V46').map((f) => `${f.id} ${f.message}`)).toEqual([
      'v-n5-0008 no example links fully inside the Station 4 allowlist (own-station all-known example for the listening pool, Pass 4b) — examples[0]: 龍; examples[1]: りんご',
    ]);
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      (item(d, 7)['examples'] as Json[]).push({ ja: '{水|みず}を{飲|の}みます。', kana: 'みずをのみます。', en: 'I drink water.' });
    });
    expect(v(root, { strict: true, listeningRelease: true }).failures.filter((f) => f.rule === 'V46')).toEqual([]);
    expect(v(root).warnings.filter((f) => f.rule === 'V46')).toEqual([]);
  });

  it('is silent without station bundles', () => {
    const root = copyFixture();
    mutate(root, 'vocab/n5/vocab-n5-001.json', (d) => {
      item(d, 7)['examples'] = [{ ja: '{龍|りゅう}の{水|みず}です。', kana: 'りゅうのみずです。', en: 'It is dragon water.' }];
    });
    expect(rules(v(root).warnings)).not.toContain('V46');
  });
});

describe('formatReport caps warnings per rule too', () => {
  it('shows at most perRuleCap rows of one warning rule and counts the rest', () => {
    const r: ValidateResult = {
      failures: [],
      warnings: Array.from({ length: 45 }, (_, i) => ({ file: 'vocab/n5/vocab-n5-001.json', id: `v-n5-${String(i + 1).padStart(4, '0')}`, rule: 'V46', message: 'no example links fully inside the Station 4 allowlist' })),
      linked: 0,
      files: 1,
      bundles: true,
    };
    const text = formatReport(r, '/root', 40);
    expect(text.split('\n').filter((l) => /^ {2}W V46 /.test(l)).length).toBe(40);
    expect(text).toContain('… 5 more V46 warnings not shown (cap 40 per rule; --json lists them all)');
    expect(text).toContain('TOTAL: 0 failures, 45 warnings in 1 file');
  });
});

/* ── the shipped corpus (docs/listening-plan.json contracts.tests: "the shipped corpus passes with 0 new F") ── */

describe('the shipped corpus (public/content) under the design 08 rules', () => {
  it('strict mode: no V41–V46 failure; V42 warns once that the cast check is skipped while scripts/audio/cast.json is absent', () => {
    const r = validate(join(here, '..', 'public', 'content'), { strict: true });
    expect(r.bundles).toBe(true);
    expect(r.failures.filter((f) => /^V4[1-6]$/.test(f.rule))).toEqual([]);
    const v42 = r.warnings.filter((f) => f.rule === 'V42');
    if (existsSync(join(here, 'audio', 'cast.json'))) {
      expect(v42.some((f) => /^cast check skipped/.test(f.message))).toBe(false);
    } else {
      expect(v42.map((f) => f.message)).toEqual([expect.stringMatching(/^cast check skipped: /)]);
    }
  }, 120_000);
});
