import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STATIONS } from '../src/content/types.ts';
import type { ComponentDef, GrammarItem, KanjiItem, StationBundle, StoryItem, VocabItem } from '../src/content/types.ts';
import { assign, buildPoolFiles, buildPools, bundlesFromCorpus, buildMatchPool, compareRefs, linkSentence, matchToken, orderRankedVocab, placeComponents, readPoolCorpus, sentenceMorae, stationPools, stemApplies, stringifyPool, topoSortKanji, vocabSurfaceList, writePools } from './assign-stations.ts';
import type { PlanEntry } from './assign-stations.ts';

const here = dirname(fileURLToPath(import.meta.url));
const GOOD = join(here, '__fixtures__', 'good');
const tmps: string[] = [];

afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmps.push(d);
  return d;
}

function writeJson(p: string, v: unknown): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
}

/* ── synthetic N5 corpus big enough to fill Stations 1–15 ────────────────── */

const KANA = [...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわ'];
/** Unique kana-only surface for item n (bijective base-45 encoding, ≥ 2 chars). */
function kanaWord(n: number): string {
  let s = '';
  let x = n;
  do {
    s = KANA[x % KANA.length]! + s;
    x = Math.floor(x / KANA.length);
  } while (x > 0);
  return s.length < 2 ? 'ん' + s : s;
}

function vocabItem(level: number, n: number, extra: Partial<VocabItem> = {}): VocabItem {
  const w = kanaWord(n + level * 10000);
  return {
    id: `v-n${level}-${String(n).padStart(4, '0')}`,
    word: w,
    kana: w,
    meanings: ['thing'],
    pos: 'n',
    jlpt: level as VocabItem['jlpt'],
    tags: ['objects'],
    examples: [{ ja: `${w}です。`, kana: `${w}です。`, en: 'It is a thing.' }],
    ...extra,
  };
}

const PRIMS: [string, string][] = [
  ['sun', '日'], ['one', '一'], ['tree', '木'], ['earth', '土'], ['inch', '寸'], ['temple', '寺'], ['person', '人'], ['mouth', '口'],
  ['rice field', '田'], ['power', '力'], ['moon', '月'], ['water', '水'], ['fire', '火'], ['gold', '金'], ['mountain', '山'], ['river', '川'],
];
const COMPONENTS: ComponentDef[] = PRIMS.map(([name, char]) => ({ id: `c-${name.replace(/ /g, '-')}`, char, name }));

/** 100 synthetic N5 kanji: one glyph per CJK code point, components from PRIMS, with dependency edges. */
function kanjiCorpus(): KanjiItem[] {
  const out: KanjiItem[] = [];
  for (let i = 0; i < 100; i++) {
    const ch = String.fromCharCode(0x4e00 + 0x100 + i);
    const comps = [PRIMS[i % PRIMS.length]![0], PRIMS[(i * 7 + 3) % PRIMS.length]![0]];
    out.push({
      id: `j-${ch}`,
      char: ch,
      meanings: ['x'],
      on: ['カ'],
      kun: [],
      strokes: 5,
      jlpt: 5,
      components: comps,
      mnemonic: `${comps[0]!.toUpperCase()} and ${comps[1]!.toUpperCase()}: X.`,
      examples: [{ word: `${ch}日`, kana: 'かにち', en: 'x' }, { word: `${ch}人`, kana: 'かじん', en: 'x' }],
    });
  }
  // Dependency edges: kanji #0 is itself a component glyph (寺) of kanji #5 and #40; put the dependents FIRST in corpus order.
  out[5]!.components = ['sun', '寺'];
  out[40]!.components = ['寺', 'tree'];
  out[0]!.char = '寺';
  out[0]!.id = 'j-寺';
  out[0]!.components = ['earth', 'inch'];
  // kanji #70 depends on kanji #90 (a glyph that is a listed PRIM with a ComponentDef: 川 'river').
  out[90]!.char = '川';
  out[90]!.id = 'j-川';
  out[90]!.components = ['river'];
  out[70]!.components = ['river', 'sun'];
  return out;
}

function grammarItem(n: number): GrammarItem {
  return {
    id: `g-n5-${String(n).padStart(3, '0')}`,
    pattern: `〜ぱたーん${n}`,
    meaning: 'x',
    formation: ['x'],
    explanation: 'x',
    jlpt: 5,
    register: 'neutral',
    examples: [
      // the words of v-n5-0001 … 0003 (Station 1): a grammar example links its words and lands at the grammar's own station
      { ja: `${kanaWord(50001)}です。`, kana: `${kanaWord(50001)}です。`, en: 'A.' },
      { ja: `${kanaWord(50002)}です。`, kana: `${kanaWord(50002)}です。`, en: 'I.' },
      { ja: `${kanaWord(50003)}です。`, kana: `${kanaWord(50003)}です。`, en: 'U.' },
    ],
    clozeHints: ['です'],
    mistakes: [],
    related: [],
    tags: [],
  };
}

interface Synth {
  root: string;
  plan: PlanEntry[];
}

function synthCorpus(opts: { ranked?: boolean } = {}): Synth {
  const root = tmp('tsuzuku-assign-');
  cpSync(join(GOOD, 'kana'), join(root, 'kana'), { recursive: true });
  writeJson(join(root, '_meta/components.json'), { schema: 'tsuzuku.content/1', type: 'component', items: COMPONENTS });
  const plan: PlanEntry[] = [];
  const entry = (path: string, type: PlanEntry['type'], count: number, idStart: number): PlanEntry => ({ path, type, pass: 1, belt: null, jlpt: 5, count, idPrefix: '', idStart });
  // vocab n5: 6 files (135,135,135,135,130,130) = 800
  const sizes = [135, 135, 135, 135, 130, 130];
  let n = 1;
  for (let f = 0; f < sizes.length; f++) {
    const items: VocabItem[] = [];
    for (let i = 0; i < sizes[f]!; i++, n++) {
      const extra: Partial<VocabItem> = {};
      if (opts.ranked) extra.frequencyRank = 801 - n; // reverse order: the LAST item is the most frequent
      if (n === 10) extra.altForms = ['下さい'];
      if (n === 11) {
        extra.pos = 'v5';
        extra.word = '飲む';
        extra.kana = 'のむ';
      }
      items.push(vocabItem(5, n, extra));
    }
    const rel = `vocab/n5/vocab-n5-${String(f + 1).padStart(3, '0')}.json`;
    writeJson(join(root, rel), { schema: 'tsuzuku.content/1', type: 'vocab', level: 'n5', items });
    plan.push(entry(`public/content/${rel}`, 'vocab', sizes[f]!, n - sizes[f]!));
  }
  writeJson(join(root, 'kanji/n5/kanji-n5-001.json'), { schema: 'tsuzuku.content/1', type: 'kanji', level: 'n5', items: kanjiCorpus() });
  plan.push(entry('public/content/kanji/n5/kanji-n5-001.json', 'kanji', 100, 0));
  const gsizes = [23, 22, 23, 22];
  let g = 1;
  for (let f = 0; f < gsizes.length; f++) {
    const items: GrammarItem[] = [];
    for (let i = 0; i < gsizes[f]!; i++, g++) items.push(grammarItem(g));
    const rel = `grammar/n5/grammar-n5-${String(f + 1).padStart(3, '0')}.json`;
    writeJson(join(root, rel), { schema: 'tsuzuku.content/1', type: 'grammar', level: 'n5', items });
    plan.push(entry(`public/content/${rel}`, 'grammar', gsizes[f]!, g - gsizes[f]!));
  }
  // a story + michikusa at station 4 so storyIds/michikusaIds get filled
  writeJson(join(root, 'stories/n5/stories-s04.json'), {
    schema: 'tsuzuku.content/1',
    type: 'story',
    level: 'n5',
    items: [{ id: 's-04-1', stationId: 'st-04', titleJa: 'あ', titleEn: 'A', kind: 'story', register: 'polite', lines: [{ ja: `${kanaWord(50001)}です。`, kana: `${kanaWord(50001)}です。`, en: 'x', tokens: [kanaWord(50001), 'です', '。'] }], vocabIds: [], grammarIds: [], comprehension: [], recapEn: 'x', names: ['ミカ'] }],
  });
  writeJson(join(root, 'michikusa/michikusa-s04.json'), {
    schema: 'tsuzuku.content/1',
    type: 'michikusa',
    items: [{ id: 'm-04-1', stationId: 'st-04', kind: 'culture', titleEn: 'x', bodyEn: 'x' }],
  });
  return { root, plan };
}

function readItems<T>(root: string, rel: string): T[] {
  return (JSON.parse(readFileSync(join(root, rel), 'utf8')) as { items: T[] }).items;
}

function allVocab(root: string): VocabItem[] {
  const out: VocabItem[] = [];
  for (const f of readdirSync(join(root, 'vocab/n5')).sort()) out.push(...readItems<VocabItem>(root, `vocab/n5/${f}`));
  return out;
}

/* ── tests ───────────────────────────────────────────────────────────────── */

describe('assign-stations — synthetic N5 corpus', () => {
  it('fills Stations 1–15 within ±10 % of quota and writes station in place', () => {
    const { root, plan } = synthCorpus();
    const r = assign(root, plan, { allowlistsDir: join(root, '..', 'allow-' + root.split('/').pop()) });
    tmps.push(join(root, '..', 'allow-' + root.split('/').pop()));
    expect(r.missingFiles).toEqual([]);
    expect(r.assigned.vocab).toBe(800);
    expect(r.assigned.kanji).toBe(100);
    expect(r.assigned.grammar).toBe(90);
    expect(r.assigned.kana).toBe(21);
    for (const st of STATIONS.slice(0, 15)) {
      const b = r.bundles[st.number - 1]!;
      for (const kind of ['vocab', 'kanji', 'grammar'] as const) {
        const have = b[`${kind}Ids`].length;
        expect(Math.abs(have - st.quota[kind])).toBeLessThanOrEqual(st.quota[kind] * 0.1);
      }
    }
    for (const b of r.bundles.slice(15)) expect(b.vocabIds.length + b.kanjiIds.length + b.grammarIds.length).toBe(0);
    // written in place, key order preserved (station appended last)
    const first = allVocab(root)[0]!;
    expect(first.station).toBe(1);
    expect(Object.keys(first).at(-1)).toBe('station');
    expect(allVocab(root).filter((v) => v.station === 3).length).toBe(40);
    // kana by station
    const hira = readItems<{ id: string; station?: number; type: string }>(root, 'kana/hiragana.json');
    expect(hira.find((k) => k.id === 'k-h-a')!.station).toBe(1);
    expect(hira.find((k) => k.type === 'yoon')!.station).toBe(2);
    const kata = readItems<{ id: string; station?: number; type: string }>(root, 'kana/katakana.json');
    expect(kata.find((k) => k.type === 'basic')!.station).toBe(2);
    expect(kata.find((k) => k.type === 'extended')!.station).toBe(3);
    // stories / michikusa / files
    expect(r.bundles[3]!.storyIds).toEqual(['s-04-1']);
    expect(r.bundles[3]!.michikusaIds).toEqual(['m-04-1']);
    expect(r.bundles[3]!.files).toContain('stories/n5/stories-s04.json');
    expect(r.bundles[0]!.files).toEqual(['kana/hiragana.json', 'vocab/n5/vocab-n5-001.json']);
    expect(r.report).toMatch(/04 Hodogaya/);
    expect(existsSync(join(root, 'stations/53.json'))).toBe(true);
  });

  it('never places a kanji before its component kanji (station and in-bundle order)', () => {
    const { root, plan } = synthCorpus();
    const r = assign(root, plan, { allowlistsDir: tmp('allow-') });
    const kanji = readItems<KanjiItem>(root, 'kanji/n5/kanji-n5-001.json');
    const byChar = new Map(kanji.map((k) => [k.char, k]));
    const indexInBundles = new Map<string, number>();
    r.bundles.forEach((b) => b.kanjiIds.forEach((id, i) => indexInBundles.set(id, i)));
    const check = (dependent: string, dep: string) => {
      const a = byChar.get(dependent)!;
      const d = byChar.get(dep)!;
      expect(d.station!).toBeLessThanOrEqual(a.station!);
      if (d.station === a.station) expect(indexInBundles.get(d.id)!).toBeLessThan(indexInBundles.get(a.id)!);
    };
    check(kanji[5]!.char, '寺');
    check(kanji[40]!.char, '寺');
    check(kanji[70]!.char, '川');
    // topoSortKanji is stable for independent items
    const sorted = topoSortKanji(kanji, COMPONENTS);
    expect(sorted.indexOf(byChar.get('寺')!)).toBeLessThan(sorted.indexOf(kanji[5]!));
    expect(sorted.filter((k) => ![kanji[0], kanji[5], kanji[40], kanji[70], kanji[90]].includes(k)).map((k) => k.id)).toEqual(
      kanji.filter((k) => ![kanji[0], kanji[5], kanji[40], kanji[70], kanji[90]].includes(k)).map((k) => k.id),
    );
  });

  it('places every component one station ahead of its first kanji, N5 set across Stations 2–3, never Station 1', () => {
    const { root, plan } = synthCorpus();
    const r = assign(root, plan, { allowlistsDir: tmp('allow-') });
    const kanji = readItems<KanjiItem>(root, 'kanji/n5/kanji-n5-001.json');
    const firstUse = new Map<string, number>();
    for (const k of [...kanji].sort((a, b) => a.station! - b.station!)) for (const name of k.components) {
      const c = COMPONENTS.find((x) => x.name === name);
      if (c && !firstUse.has(c.id)) firstUse.set(c.id, k.station!);
    }
    expect(r.bundles[0]!.componentIds).toEqual([]);
    const placedAt = new Map<string, number>();
    for (const b of r.bundles) for (const id of b.componentIds) placedAt.set(id, b.number);
    expect(placedAt.size).toBe(firstUse.size);
    for (const [id, st] of placedAt) {
      expect(st).toBeGreaterThanOrEqual(2);
      expect(st).toBeLessThan(firstUse.get(id)!);
      expect([2, 3]).toContain(st); // all first used by N5 kanji
    }
    expect(r.bundles[1]!.componentIds.length).toBeGreaterThan(0);
    expect(r.bundles[2]!.componentIds.length).toBeGreaterThan(0);
    // placeComponents: a later-level first use lands at station − 1
    const late = placeComponents([{ item: { ...kanji[1]!, station: 20, components: ['moon'] } }], COMPONENTS);
    expect(late.byStation.get(19)).toEqual(['c-moon']);
  });

  it('surfaces resolve every allowlisted word / kana / altForm and are cumulative', () => {
    const { root, plan } = synthCorpus();
    const r = assign(root, plan, { allowlistsDir: tmp('allow-') });
    const vocab = allVocab(root);
    for (const b of r.bundles) {
      for (const v of vocab) {
        if (v.station! > b.number) continue;
        for (const s of vocabSurfaceList(v)) expect(b.surfaces[s]).toBeDefined();
      }
    }
    expect(r.bundles[0]!.surfaces['下さい']).toBe('v-n5-0010');
    expect(r.bundles[0]!.surfaces['飲む']).toBe('v-n5-0011');
    expect(Object.keys(r.bundles[52]!.surfaces)).toEqual(Object.keys(r.bundles[52]!.surfaces).sort());
  });

  it('orders vocab by frequencyRank within a level when present', () => {
    const { root, plan } = synthCorpus({ ranked: true });
    const r = assign(root, plan, { allowlistsDir: tmp('allow-') });
    expect(r.bundles[0]!.vocabIds).toContain('v-n5-0800');
    expect(r.bundles[0]!.vocabIds).not.toContain('v-n5-0001');
    expect(allVocab(root).find((v) => v.id === 'v-n5-0001')!.station).toBe(15);
  });

  it('is idempotent and bundlesFromCorpus regenerates the written bundles byte-identically', () => {
    const { root, plan } = synthCorpus();
    const allow = tmp('allow-');
    assign(root, plan, { allowlistsDir: allow });
    const snapshot = (dir: string) => Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
    const before = { stations: snapshot(join(root, 'stations')), vocab: snapshot(join(root, 'vocab/n5')), allow: snapshot(allow) };
    const second = assign(root, plan, { allowlistsDir: allow });
    expect(second.report).toMatch(/wrote 0 changed content file/);
    expect(snapshot(join(root, 'stations'))).toEqual(before.stations);
    expect(snapshot(join(root, 'vocab/n5'))).toEqual(before.vocab);
    expect(snapshot(allow)).toEqual(before.allow);
    const regenerated = bundlesFromCorpus(root);
    regenerated.forEach((b: StationBundle) => {
      expect(JSON.stringify(b, null, 2) + '\n').toBe(before.stations[`${String(b.number).padStart(2, '0')}.json`]);
    });
  });

  it('writes cumulative allowlists; Stations 1–3 share the White set; names include the cast and story names', () => {
    const { root, plan } = synthCorpus();
    const allow = tmp('allow-');
    const r = assign(root, plan, { allowlistsDir: allow });
    expect(readdirSync(allow).length).toBe(53);
    const a1 = r.allowlists[1]!;
    const a3 = r.allowlists[3]!;
    const a4 = r.allowlists[4]!;
    expect(a1.vocab).toEqual(a3.vocab);
    expect(a3.vocab.length).toBe(80);
    expect(a4.vocab.length).toBe(140);
    expect(a4.grammar.length).toBe(8);
    expect(a4.kana.length).toBe(21);
    expect(a4.names).toContain('ハナ');
    expect(a4.names).toContain('ミカ');
    expect(a3.names).not.toContain('ミカ');
    expect(a4.surfaces[kanaWord(1 + 50000)]).toBe('v-n5-0001');
    const onDisk = JSON.parse(readFileSync(join(allow, 'station-04.json'), 'utf8')) as { vocab: string[] };
    expect(onDisk.vocab).toEqual(a4.vocab);
  });

  it('dry run writes nothing and reports missing plan files', () => {
    const { root, plan } = synthCorpus();
    const extra: PlanEntry = { path: 'public/content/vocab/n4/vocab-n4-001.json', type: 'vocab', pass: 1, belt: null, jlpt: 4, count: 1, idPrefix: '', idStart: 1 };
    const r = assign(root, [...plan, extra], { write: false, allowlistsDir: tmp('allow-') });
    expect(r.missingFiles).toEqual(['vocab/n4/vocab-n4-001.json']);
    expect(existsSync(join(root, 'stations'))).toBe(false);
    expect(allVocab(root).every((v) => v.station === undefined)).toBe(true);
    expect(r.bundles[0]!.vocabIds.length).toBe(20);
    expect(r.report).toMatch(/dry run/);
  });

  it('ranked level: files ordered by median rank, items by rank within a file, so a station spans ≤ 3 files', () => {
    const { root, plan } = synthCorpus({ ranked: true });
    const r = assign(root, plan, { allowlistsDir: tmp('allow-') });
    const fileOf = new Map<string, string>();
    for (const f of readdirSync(join(root, 'vocab/n5')).sort()) for (const v of readItems<VocabItem>(root, `vocab/n5/${f}`)) fileOf.set(v.id, f);
    for (const b of r.bundles.slice(0, 15)) {
      const files = new Set(b.vocabIds.map((id) => fileOf.get(id)));
      expect(files.size).toBeLessThanOrEqual(3);
    }
    // ranks run 800 → 1 across the corpus, so file 6 (ranks 1–130) comes first and fills Station 1 alone
    expect(r.bundles[0]!.vocabIds.length).toBeGreaterThan(0);
    expect(r.bundles[0]!.vocabIds.every((id) => fileOf.get(id) === 'vocab-n5-006.json')).toBe(true);
    const a = allVocab(root);
    const station = (id: string) => a.find((v) => v.id === id)!.station!;
    expect(station('v-n5-0800')).toBe(1);
    expect(station('v-n5-0671')).toBeLessThanOrEqual(station('v-n5-0670')); // file 6 (least ranks) before file 5
    expect(station('v-n5-0671')).toBeLessThan(station('v-n5-0536')); // … and before the rest of file 5
    expect(station('v-n5-0001')).toBe(15);
  });

  it('orderRankedVocab: median-ordered files, rank within a file, unranked last; an unranked level keeps plan order', () => {
    const mk = (rel: string, ranks: (number | undefined)[]) => ranks.map((r, i) => ({ item: { ...vocabItem(5, i + 1), ...(r === undefined ? {} : { frequencyRank: r }) }, file: { rel } }));
    const a = mk('a', [50, 10, 30]); // median 30
    const b = mk('b', [5, 200, 7]); // median 7 → first
    const out = orderRankedVocab([...a, ...b]);
    expect(out.map((p) => `${p.file.rel}${p.item.frequencyRank}`)).toEqual(['b5', 'b7', 'b200', 'a10', 'a30', 'a50']);
    expect(orderRankedVocab(mk('a', [undefined, 3, undefined])).map((p) => p.item.frequencyRank)).toEqual([3, undefined, undefined]);
    const plain = [...mk('a', [undefined, undefined]), ...mk('b', [undefined])];
    expect(orderRankedVocab(plain)).toEqual(plain);
    // a file without ranks sorts after every ranked file
    expect(orderRankedVocab([...mk('z', [undefined]), ...mk('y', [9])]).map((p) => p.file.rel)).toEqual(['y', 'z']);
  });

  it('a single-kanji stem links only before okurigana: 有名 is not ある while 食べ始めた is still 食べる', () => {
    const aru = vocabItem(5, 9001, { word: 'ある', kana: 'ある', pos: 'v5', altForms: ['有る', '在る'] });
    const taberu = vocabItem(5, 9002, { word: '食べる', kana: 'たべる', pos: 'v1' });
    const maku = vocabItem(5, 9003, { word: '巻く', kana: 'まく', pos: 'v5' });
    const amai = vocabItem(5, 9004, { word: '甘い', kana: 'あまい', pos: 'adj-i' });
    const miru = vocabItem(5, 9005, { word: '見る', kana: 'みる', pos: 'v1' });
    const tateru = vocabItem(5, 9006, { word: '建てる', kana: 'たてる', pos: 'v1' });
    const pool = buildMatchPool([aru, taberu, maku, amai, miru, tateru], []);
    expect(matchToken(pool, '有名')).toEqual({ id: null, known: false, punct: false });
    expect(matchToken(pool, '有った').id).toBe(aru.id);
    expect(matchToken(pool, '在りました').id).toBe(aru.id);
    expect(matchToken(pool, 'あった').known).toBe(true); // function token
    expect(matchToken(pool, '食べ始めた').id).toBe(taberu.id);
    expect(matchToken(pool, '食べ方').id).toBe(taberu.id);
    expect(matchToken(pool, '建て直した').id).toBe(tateru.id);
    expect(matchToken(pool, '巻物').id).toBeNull();
    expect(matchToken(pool, '巻いて').id).toBe(maku.id);
    expect(matchToken(pool, '甘酒').id).toBeNull();
    expect(matchToken(pool, '甘くて').id).toBe(amai.id);
    expect(matchToken(pool, '見').id).toBe(miru.id); // bare ren'yōkei (見に行く)
    expect(matchToken(pool, '見物').id).toBeNull();
    expect(stemApplies('有', '有名')).toBe(false);
    expect(stemApplies('有', '有る')).toBe(true);
    expect(stemApplies('食べ', '食べ始めた')).toBe(true);
  });

  it('links story tokenIds against the cumulative allowlist (matchToken semantics)', () => {
    const { root, plan } = synthCorpus();
    const r = assign(root, plan, { allowlistsDir: tmp('allow-') });
    expect(r.linked).toBe(1);
    const story = readItems<{ lines: { tokens: string[]; tokenIds: (string | null)[] }[] }>(root, 'stories/n5/stories-s04.json')[0]!;
    expect(story.lines[0]!.tokenIds).toEqual(['v-n5-0001', null, null]);
    const pool = buildMatchPool(allVocab(root).slice(0, 20), [grammarItem(1)]);
    expect(matchToken(pool, '飲みます').id).toBe('v-n5-0011');
    expect(matchToken(pool, '下さい').id).toBe('v-n5-0010');
    expect(matchToken(pool, 'ハナさん').known).toBe(true);
    expect(matchToken(pool, '三').known).toBe(true);
    expect(matchToken(pool, '。').punct).toBe(true);
    expect(matchToken(pool, 'りんご').known).toBe(false);
  });

  it('POS floors pull core verbs to Station 6 and い/な-adjectives to Station 7 without moving later boundaries', () => {
    const { root, plan } = synthCorpus();
    // vocab-n5-003 (v-n5-0271…0405) is where the N5 briefs put every verb and adjective.
    const rel = 'vocab/n5/vocab-n5-003.json';
    const items = readItems<VocabItem>(root, rel);
    items.forEach((v, i) => {
      if (i < 20) v.pos = 'v5'; // v-n5-0271…0290
      else if (i < 28) v.pos = 'adj-i'; // v-n5-0291…0298
      else if (i < 34) v.pos = 'adj-na'; // v-n5-0299…0304
    });
    writeJson(join(root, rel), { schema: 'tsuzuku.content/1', type: 'vocab', level: 'n5', items });
    const plain = assign(root, plan, { allowlistsDir: tmp('allow-'), write: false, posFloors: [] });
    const r = assign(root, plan, { allowlistsDir: tmp('allow-') });
    const posOf = new Map(allVocab(root).map((v) => [v.id, v.pos]));
    const count = (b: StationBundle, pos: string) => b.vocabIds.filter((id) => posOf.get(id) === pos).length;
    // plan order alone leaves Station 6 verbless (the Vます station)
    expect(count(plain.bundles[5]!, 'v5')).toBe(0);
    expect(count(plain.bundles[6]!, 'adj-na')).toBe(6);
    // floors: the first 12 verbs land at Station 6, the remaining 8 at 7; 8 い- and 6 な-adjectives at Station 7
    expect(count(r.bundles[5]!, 'v5')).toBe(12);
    expect(r.bundles[5]!.vocabIds).toContain('v-n5-0271');
    expect(r.bundles[5]!.vocabIds).toContain('v-n5-0282');
    expect(count(r.bundles[6]!, 'v5')).toBe(8);
    expect(count(r.bundles[6]!, 'adj-i')).toBe(8);
    expect(count(r.bundles[6]!, 'adj-na')).toBe(6);
    // the displaced tail of Station 6 moved to 7; quotas and every later boundary are unchanged
    expect(r.bundles[6]!.vocabIds).toContain('v-n5-0249');
    for (const b of r.bundles) expect(b.vocabIds.length).toBe(plain.bundles[b.number - 1]!.vocabIds.length);
    const upTo = (bs: StationBundle[], n: number) => bs.filter((b) => b.number <= n).flatMap((b) => b.vocabIds).sort();
    expect(upTo(r.bundles, 6)).not.toEqual(upTo(plain.bundles, 6));
    expect(upTo(r.bundles, 7)).toEqual(upTo(plain.bundles, 7));
    for (const b of r.bundles.slice(7)) expect([...b.vocabIds].sort()).toEqual([...plain.bundles[b.number - 1]!.vocabIds].sort());
    expect(allVocab(root).find((v) => v.id === 'v-n5-0271')!.station).toBe(6);
    expect(allVocab(root).find((v) => v.id === 'v-n5-0253')!.station).toBe(7);
  });

  it('writes the 53 listening pools (design 08 §4): an example lands at the station of its latest id, an out-of-corpus token keeps a sentence out, story lines enter by their tokenIds, refs are sorted and a second run is byte-identical', () => {
    const { root, plan } = synthCorpus();
    // v-n5-0249 (file 2) borrows the word of v-n5-0700 (file 6), so its example's latest id sits at a later station
    const rel2 = 'vocab/n5/vocab-n5-002.json';
    const items2 = readItems<VocabItem>(root, rel2);
    const w249 = kanaWord(249 + 50000);
    const w700 = kanaWord(700 + 50000);
    items2.find((x) => x.id === 'v-n5-0249')!.examples = [{ ja: `${w249}と${w700}です。`, kana: `${w249}と${w700}です。`, en: 'x' }];
    items2.find((x) => x.id === 'v-n5-0250')!.examples = [{ ja: `${kanaWord(250 + 50000)}とりんごです。`, kana: `${kanaWord(250 + 50000)}とりんごです。`, en: 'x' }];
    writeJson(join(root, rel2), { schema: 'tsuzuku.content/1', type: 'vocab', level: 'n5', items: items2 });
    const allow = tmp('allow-');
    const r = assign(root, plan, { allowlistsDir: allow });
    const station = (id: string) => allVocab(root).find((x) => x.id === id)!.station!;
    expect(station('v-n5-0700')).toBeGreaterThan(station('v-n5-0249'));
    expect(r.pools.length).toBe(53);
    expect(r.pools.map((p) => p.station)).toEqual(Array.from({ length: 53 }, (_, i) => i + 1));
    const holder = r.pools.find((p) => p.refs.some((x) => x.ref === 'v-n5-0249#ex0'))!;
    expect(holder.station).toBe(station('v-n5-0700'));
    const ref249 = holder.refs.find((x) => x.ref === 'v-n5-0249#ex0')!;
    expect(ref249).toEqual({ ref: 'v-n5-0249#ex0', ids: ['v-n5-0249', 'v-n5-0700'], kana: `${w249}と${w700}です。`, morae: sentenceMorae(`${w249}と${w700}です。`) });
    // りんご links nowhere in this corpus: the sentence enters no pool
    expect(r.pools.some((p) => p.refs.some((x) => x.ref.startsWith('v-n5-0250#')))).toBe(false);
    // a plain example sits at its own station; the fixture story's line enters by its tokenIds at the text's station (its one id is from Station 1)
    expect(r.pools.find((p) => p.refs.some((x) => x.ref === 'v-n5-0001#ex0'))!.station).toBe(station('v-n5-0001'));
    const p4 = r.pools.find((p) => p.station === 4)!;
    expect(p4.refs[0]).toMatchObject({ ref: 's-04-1#L0', ids: ['v-n5-0001'] });
    // sorted stories → grammar → vocab, by id then index
    for (const p of r.pools) expect([...p.refs].sort(compareRefs).map((x) => x.ref)).toEqual(p.refs.map((x) => x.ref));
    expect(p4.refs.map((x) => x.ref.charAt(0)).join('')).toMatch(/^s*g*v*$/);
    expect(p4.refs.some((x) => x.ref.startsWith('g-n5-'))).toBe(true);
    // files on disk, byte-stable, regenerated identically by buildPools and by a second assign
    const dir = join(root, 'listening');
    expect(readdirSync(dir).sort()).toEqual(Array.from({ length: 53 }, (_, i) => `pool-${String(i + 1).padStart(2, '0')}.json`));
    const text = readFileSync(join(dir, 'pool-04.json'), 'utf8');
    expect(text).toBe(stringifyPool(p4));
    expect(JSON.parse(text)).toMatchObject({ schema: 'tsuzuku.pool/1', station: 4 });
    expect(r.report).toMatch(/wrote 53 listening pools \(53 changed\)/);
    const snapshot = () => Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
    const before = snapshot();
    const again = assign(root, plan, { allowlistsDir: allow });
    expect(snapshot()).toEqual(before);
    expect(again.report).toMatch(/wrote 53 listening pools \(0 changed\)/);
    const regenerated = buildPools(root, bundlesFromCorpus(root)).pools;
    for (const p of regenerated) expect(stringifyPool(p)).toBe(before[`pool-${String(p.station).padStart(2, '0')}.json`]);
    // a hand edit is undone by writePools alone (the --pools-only path), which touches nothing else
    writeFileSync(join(dir, 'pool-04.json'), text.replace('"morae": ', '"morae": 9'));
    const stories = readFileSync(join(root, 'stories/n5/stories-s04.json'), 'utf8');
    const w = writePools(root, bundlesFromCorpus(root));
    expect(w.changed).toEqual(['listening/pool-04.json']);
    expect(readFileSync(join(dir, 'pool-04.json'), 'utf8')).toBe(text);
    expect(readFileSync(join(root, 'stories/n5/stories-s04.json'), 'utf8')).toBe(stories);
    // a dry run writes no pools
    expect(assign(root, plan, { write: false, allowlistsDir: allow }).pools).toEqual([]);
  });

  it("story lines enter by their writers' tokenIds, not by the segmenter: ids ⊆ tokenIds, a line the segmenter cannot cover still enters at its text's station, a plusOne line lands where the plusOne word is introduced, a line with an unknown content token is absent; an example's ids start with its owner even when the segmenter leaves the headword unlinked", () => {
    const { root, plan } = synthCorpus();
    const w1 = kanaWord(1 + 50000);
    const w700 = kanaWord(700 + 50000);
    // a grammar hint ました: the V20 matcher counts any token containing it as known (歩きました → the grammar id), the segmenter keeps 歩き unknown (歩く is not in the corpus)
    const relG = 'grammar/n5/grammar-n5-001.json';
    const grammar = readItems<GrammarItem>(root, relG);
    grammar[0]!.clozeHints = ['ました'];
    writeJson(join(root, relG), { schema: 'tsuzuku.content/1', type: 'grammar', level: 'n5', items: grammar });
    // a numeral item whose example carries the headword only as a kanji numeral (known, unlinked by the segmenter)
    const rel2 = 'vocab/n5/vocab-n5-002.json';
    const items2 = readItems<VocabItem>(root, rel2);
    const num = items2.find((x) => x.id === 'v-n5-0252')!;
    num.word = '三';
    num.kana = 'さん';
    num.pos = 'num';
    num.examples = [{ ja: `三${w1}です。`, kana: `さん${w1}です。`, en: 'x' }];
    writeJson(join(root, rel2), { schema: 'tsuzuku.content/1', type: 'vocab', level: 'n5', items: items2 });
    const line = (ja: string, tokens: string[], extra: Record<string, unknown> = {}) => ({ ja, kana: ja, en: 'x', tokens, ...extra });
    writeJson(join(root, 'stories/n5/stories-s04.json'), {
      schema: 'tsuzuku.content/1',
      type: 'story',
      level: 'n5',
      items: [
        {
          id: 's-04-1',
          stationId: 'st-04',
          titleJa: 'あ',
          titleEn: 'A',
          kind: 'story',
          register: 'polite',
          lines: [
            line(`${w1}です。`, [w1, 'です', '。']), // L0: own-station, one id
            line('歩きました。', ['歩きました', '。'], { kana: 'あるきました。' }), // L1: linked through the hint rule; the segmenter cannot cover 歩き
            line(`${w700}です。`, [w700, 'です', '。'], { plusOne: ['v-n5-0700'] }), // L2: plusOne word from a later station
            line('りんごです。', ['りんご', 'です', '。']), // L3: an unknown content token
            line('そうですね。', ['そう', 'です', 'ね', '。']), // L4: function tokens only — no id, the text's station
          ],
          vocabIds: [],
          grammarIds: [],
          comprehension: [],
          recapEn: 'x',
          names: ['ミカ'],
        },
      ],
    });
    const allow = tmp('allow-');
    const r = assign(root, plan, { allowlistsDir: allow });
    const station = (id: string) => allVocab(root).find((x) => x.id === id)!.station!;
    const story = readItems<StoryItem>(root, 'stories/n5/stories-s04.json')[0]!;
    const tokenIds = story.lines.map((ln) => ln.tokenIds!);
    expect(tokenIds[0]).toEqual(['v-n5-0001', null, null]);
    expect(tokenIds[1]).toEqual(['g-n5-001', null]);
    expect(tokenIds[2]).toEqual(['v-n5-0700', null, null]);
    expect(tokenIds[3]).toEqual([null, null, null]);
    expect(tokenIds[4]).toEqual([null, null, null, null]);
    const where = (ref: string) => r.pools.find((p) => p.refs.some((x) => x.ref === ref));
    const refOf = (ref: string) => where(ref)!.refs.find((x) => x.ref === ref)!;
    expect(where('s-04-1#L0')!.station).toBe(4);
    expect(refOf('s-04-1#L0').ids).toEqual(['v-n5-0001']);
    // the segmenter alone would reject 歩きました (歩き is an unknown run), the writers' tokenIds admit it at the text's station
    expect(linkSentence(stationPools(bundlesFromCorpus(root), readPoolCorpus(root))(4), '歩きました。').unknownTokens).toEqual(['歩き']);
    expect(where('s-04-1#L1')!.station).toBe(4);
    expect(refOf('s-04-1#L1').ids).toEqual(['g-n5-001']);
    // the plusOne line sits where its plusOne word is introduced, with that word as its one id
    expect(station('v-n5-0700')).toBeGreaterThan(4);
    expect(where('s-04-1#L2')!.station).toBe(station('v-n5-0700'));
    expect(refOf('s-04-1#L2').ids).toEqual(['v-n5-0700']);
    // an unknown content token keeps the line out of every pool; a line of function tokens only has no id and sits at its text's station
    expect(where('s-04-1#L3')).toBeUndefined();
    expect(where('s-04-1#L4')!.station).toBe(4);
    expect(refOf('s-04-1#L4').ids).toEqual([]);
    // every story ref's ids are a subset of its line's non-null tokenIds
    for (const p of r.pools) {
      for (const x of p.refs) {
        if (!x.ref.startsWith('s-')) continue;
        const i = Number(x.ref.split('#L')[1]);
        const linked = new Set(tokenIds[i]!.filter((id): id is string => typeof id === 'string'));
        for (const id of x.ids) expect(linked.has(id), `${x.ref} ${id}`).toBe(true);
      }
    }
    // the verdicts say the same: a story line's ownStation is "lands at its text's station"
    const { verdicts } = buildPools(root, bundlesFromCorpus(root));
    expect(verdicts.filter((v) => v.ref.startsWith('s-04-1#')).map((v) => [v.ref, v.knownAt, v.ownStation, v.unknownTokens])).toEqual([
      ['s-04-1#L0', 4, true, []],
      ['s-04-1#L1', 4, true, []],
      ['s-04-1#L2', station('v-n5-0700'), false, []],
      ['s-04-1#L3', null, false, ['りんご']],
      ['s-04-1#L4', 4, true, []],
    ]);
    // the numeral item's example: 三 is a known, unlinked numeral run for the segmenter, yet the ref carries its owner first and never lands before the owner's station
    const ex = refOf('v-n5-0252#ex0');
    expect(ex.ids[0]).toBe('v-n5-0252');
    expect(ex.ids).toEqual(['v-n5-0252', 'v-n5-0001']);
    expect(where('v-n5-0252#ex0')!.station).toBe(Math.max(station('v-n5-0252'), station('v-n5-0001')));
    expect(station('v-n5-0252')).toBeGreaterThan(station('v-n5-0001'));
    for (const p of r.pools) for (const x of p.refs) if (!x.ref.startsWith('s-')) expect(x.ids[0], x.ref).toBe(x.ref.split('#')[0]);
    // the plan row's shape: buildPoolFiles returns the pools alone
    expect(buildPoolFiles(root, bundlesFromCorpus(root))).toEqual(r.pools);
  });
});
