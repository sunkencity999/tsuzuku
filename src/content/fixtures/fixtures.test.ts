/**
 * The fixture must be valid content per CONTENT_GUIDE §18, because every
 * group's tests trust it. This re-checks the rules a unit test can reach
 * (V03 no null/empty, V04/V05 ids, V06 references, V10 kana fields, V11–V13
 * ruby, V14 counts, V15 lengths, V16 target presence, V17 mnemonics,
 * V18 pitch, V19 tokens + tokenIds, V20 allowlist, V21 comprehension,
 * V25/V27 story form, V35 manifest consistency).
 */
import { CONTENT_KINDS, ID_PATTERNS, KANA_SENTENCE_RE, KANA_WORD_RE, STATIONS, type ContentFile, type ContentItem, type ContentKind, type GrammarItem, type ListeningPool, type StoryItem, type VocabItem } from '../types';
import { hasKanji, toKana, toPlain, tokensMatchPlain } from '../ruby';
import { kindOfId, isValidId } from '../../shared/ids';
import {
  COMPONENTS,
  CONJUGATION,
  DIALOGUE,
  FIXTURE,
  FIXTURE_CHUNK_IDS,
  FIXTURE_IDS,
  FIXTURE_PITCH_HIGH_ID,
  FIXTURE_REDIRECT_FROM,
  FIXTURE_STORY_ID,
  G,
  GRAMMAR,
  KANA,
  KANJI,
  MICHIKUSA,
  PATHS,
  STATION_1,
  STATION_4,
  STORY,
  V,
  VOCAB,
  createFakeLoader,
} from './index';

const MORA_RE = /[ぁ-ゖァ-ヺー][ゃゅょャュョぁぃぅぇぉァィゥェォ]?/g;
const moraCount = (kana: string): number => (kana.match(MORA_RE) ?? []).length;

/** Every string leaf of a JSON-like value with its key path. */
function* leaves(x: unknown, path = ''): Generator<[string, unknown]> {
  if (Array.isArray(x)) {
    for (let i = 0; i < x.length; i++) yield* leaves(x[i], `${path}[${i}]`);
  } else if (typeof x === 'object' && x !== null) {
    for (const [k, v] of Object.entries(x)) yield* leaves(v, path ? `${path}.${k}` : k);
  } else {
    yield [path, x];
  }
}

const ALL_FILES = Object.entries(FIXTURE.files);
const ITEM_FILES = ALL_FILES.filter(([, f]) => (f as { schema?: string }).schema === 'tsuzuku.content/1') as [string, ContentFile<ContentItem>][];

describe('fixture shape (V01–V05)', () => {
  it('every file has a valid envelope and 1..150 items', () => {
    for (const [path, f] of ITEM_FILES) {
      expect(f.schema).toBe('tsuzuku.content/1');
      expect(f.items.length).toBeGreaterThanOrEqual(1);
      expect(f.items.length).toBeLessThanOrEqual(150);
      const dir = path.split('/')[0];
      const expectedType: Record<string, ContentKind> = { kana: 'kana', vocab: 'vocab', kanji: 'kanji', grammar: 'grammar', stories: 'story', conjugation: 'conjugation', michikusa: 'michikusa', _meta: 'component' };
      expect(f.type).toBe(expectedType[dir!]);
      const hasLevel = /^(kana|vocab|kanji|grammar|stories)\//.test(path);
      expect('level' in f).toBe(hasLevel);
    }
  });

  it('no null, no empty string, no leading/trailing whitespace anywhere', () => {
    for (const [path, body] of ALL_FILES) {
      for (const [k, v] of leaves(body)) {
        // tokenIds hold null for function tokens by design; the generated manifest types `level` as `Level | null`
        if (!/\.tokenIds\[\d+\]$/.test(k) && path !== PATHS.manifest) expect(v, `${path} ${k}`).not.toBeNull();
        if (typeof v === 'string') {
          expect(v, `${path} ${k}`).not.toBe('');
          expect(v, `${path} ${k}`).toBe(v.trim());
        }
      }
    }
    // tokenIds may hold null by design (function tokens) — checked separately below
  });

  it('every id matches its ID_PATTERN and is unique', () => {
    const seen = new Set<string>();
    for (const item of Object.values(FIXTURE.items)) {
      const kind = kindOfId(item.id);
      expect(ID_PATTERNS[kind === 'chunk' ? 'vocab' : kind].test(item.id), item.id).toBe(true);
      expect(isValidId(item.id)).toBe(true);
      expect(seen.has(item.id), `duplicate ${item.id}`).toBe(false);
      seen.add(item.id);
    }
    for (const row of CONJUGATION) expect(ID_PATTERNS.conjugation.test(row.id)).toBe(true);
    expect(ID_PATTERNS.station.test(STORY.stationId)).toBe(true);
  });

  it('kanji id = j- + char; vocab/grammar level segment = jlpt; story/michikusa station = stationId', () => {
    for (const k of KANJI) expect(k.id).toBe(`j-${k.char}`);
    for (const v of VOCAB) expect(v.id.split('-')[1]).toBe(`n${v.jlpt}`);
    for (const g of GRAMMAR) expect(g.id.split('-')[1]).toBe(`n${g.jlpt}`);
    for (const s of [STORY, DIALOGUE]) expect(s.stationId).toBe(`st-${s.id.split('-')[1]}`);
    for (const m of MICHIKUSA) expect(m.stationId).toBe(`st-${m.id.split('-')[1]}`);
    const st4 = STATIONS.find((s) => s.id === 'st-04')!;
    expect(st4.quota.stories).toBeGreaterThanOrEqual(2);
  });

  it('counts: 10 kana · 12 vocab · 4 kanji · 3 grammar · 1 story + 1 dialogue · 2 michikusa · 4 components', () => {
    expect(KANA).toHaveLength(10);
    expect(VOCAB).toHaveLength(12);
    expect(KANJI).toHaveLength(4);
    expect(GRAMMAR).toHaveLength(3);
    expect(STORY.kind).toBe('story');
    expect(DIALOGUE.kind).toBe('dialogue');
    expect(MICHIKUSA).toHaveLength(2);
    expect(COMPONENTS).toHaveLength(4);
    expect(FIXTURE_IDS.vocab).toHaveLength(12);
    expect(Object.keys(FIXTURE.items)).toHaveLength(10 + 12 + 4 + 3 + 2 + 2 + 4);
  });
});

describe('references resolve (V06, V07, V23)', () => {
  const ids = new Set(Object.keys(FIXTURE.items));
  const componentNames = new Set(COMPONENTS.map((c) => c.name));

  it('vocab kanjiIds / confusables / pairId, kanji lookalikes, grammar related, kana lookalikes', () => {
    for (const v of VOCAB) {
      for (const id of v.kanjiIds ?? []) expect(ids.has(id), id).toBe(true);
      for (const id of v.confusables ?? []) expect(ids.has(id), id).toBe(true);
      if (v.pairId) expect(ids.has(v.pairId)).toBe(true);
      // kanjiIds is optional (the linker fills it), but where the kanji item exists it must be listed
      for (const ch of v.word.match(/[一-鿿]/g) ?? []) if (ids.has(`j-${ch}`)) expect(v.kanjiIds ?? [], `${v.id} ${ch}`).toContain(`j-${ch}`);
    }
    for (const k of KANJI) {
      for (const id of k.lookalikes ?? []) expect(ids.has(id)).toBe(true);
      for (const name of k.components) expect(componentNames.has(name), `${k.id} ${name}`).toBe(true);
    }
    for (const g of GRAMMAR) {
      expect(new Set(g.related).size).toBe(g.related.length);
      for (const id of g.related) {
        expect(id).not.toBe(g.id);
        expect(ids.has(id), id).toBe(true);
      }
    }
    for (const k of KANA) for (const id of k.lookalikes ?? []) expect(ids.has(id), id).toBe(true);
  });

  it('story vocabIds / grammarIds / plusOne resolve and lie in the Station 4 allowlist (V20)', () => {
    const allow = new Set([...STATION_1.vocabIds, ...STATION_4.vocabIds]);
    const grammarAllow = new Set(STATION_4.grammarIds);
    for (const s of [STORY, DIALOGUE]) {
      for (const id of s.vocabIds) {
        expect(ids.has(id), id).toBe(true);
        expect(allow.has(id), id).toBe(true);
      }
      for (const id of s.grammarIds) expect(grammarAllow.has(id), id).toBe(true);
      for (const l of s.lines) for (const id of l.plusOne ?? []) expect(ids.has(id)).toBe(true);
    }
  });

  it('manifest redirects target existing ids and the source is a gap', () => {
    for (const [from, to] of Object.entries(FIXTURE.manifest.redirects)) {
      expect(ids.has(from), from).toBe(false);
      expect(ids.has(to), to).toBe(true);
    }
    expect(FIXTURE.manifest.redirects[FIXTURE_REDIRECT_FROM]).toBe(V.コーヒー);
  });
});

describe('ruby and kana fields (V10–V13)', () => {
  const sentences: [where: string, ja: string, kana: string][] = [];
  for (const v of VOCAB) {
    for (const e of v.examples) sentences.push([v.id, e.ja, e.kana]);
    if (v.definitionJa) sentences.push([v.id, v.definitionJa.ja, v.definitionJa.kana]);
  }
  for (const g of GRAMMAR) for (const e of g.examples) sentences.push([g.id, e.ja, e.kana]);
  for (const s of [STORY, DIALOGUE]) for (const l of s.lines) sentences.push([s.id, l.ja, l.kana]);
  for (const m of MICHIKUSA) if (m.ja && m.kana) sentences.push([m.id, m.ja, m.kana]);

  it.each(sentences)('%s %s reconstructs to its kana', (_where, ja, kana) => {
    expect(toKana(ja)).toBe(kana);
    expect(KANA_SENTENCE_RE.test(kana)).toBe(true);
    // no bare kanji outside rubies (V12)
    expect(hasKanji(ja.replace(/\{[^{}|]+\|[^{}|]+\}/g, ''))).toBe(false);
    // no digits or Latin in ja/kana (V31)
    expect(/[0-9A-Za-z]/.test(ja.replace(/\{[A-Z]{1,4}\|[^}]+\}/g, ''))).toBe(false);
  });

  it('word-level kana fields are kana only; titles obey the ruby rules', () => {
    for (const v of VOCAB) expect(KANA_WORD_RE.test(v.kana), v.id).toBe(true);
    for (const k of KANA) {
      expect(KANA_WORD_RE.test(k.kana)).toBe(true);
      expect(KANA_WORD_RE.test(k.exampleWord.kana)).toBe(true);
    }
    for (const k of KANJI) {
      for (const on of k.on) expect(/^[ァ-ヺー]+$/.test(on), `${k.id} on ${on}`).toBe(true);
      for (const kun of k.kun) expect(/^[ぁ-ゖー]+(\.[ぁ-ゖー]+)?$/.test(kun), `${k.id} kun ${kun}`).toBe(true);
      expect(k.on.length + k.kun.length).toBeGreaterThan(0);
      for (const e of k.examples) expect(KANA_WORD_RE.test(e.kana)).toBe(true);
    }
    for (const row of CONJUGATION) {
      expect(KANA_WORD_RE.test(row.kana)).toBe(true);
      expect(KANA_WORD_RE.test(row.answerKana)).toBe(true);
      for (const alt of row.alt ?? []) expect(alt).not.toBe(row.answer);
    }
    for (const s of [STORY, DIALOGUE]) expect(hasKanji(toPlain(s.titleJa).replace(/\{[^{}|]+\|[^{}|]+\}/g, '')) === hasKanji(s.titleJa)).toBe(true);
    expect(toKana(STORY.titleJa)).toBe('みずといぬ');
  });

  it('plain fields never carry ruby (V12)', () => {
    const plain: string[] = [];
    for (const v of VOCAB) plain.push(v.word, ...(v.altForms ?? []), ...(v.collocations ?? []));
    for (const g of GRAMMAR) plain.push(...g.clozeHints);
    for (const s of [STORY, DIALOGUE]) for (const l of s.lines) plain.push(...l.tokens, ...(l.accept ?? []), ...(l.mustInclude ?? []), ...(l.options ?? []).map((o) => o.text));
    for (const k of KANJI) for (const e of k.examples) plain.push(e.word);
    for (const row of CONJUGATION) plain.push(row.word, row.answer);
    for (const p of plain) expect(/[{}|]/.test(p), p).toBe(false);
  });
});

describe('counts, lengths, targets (V14–V18)', () => {
  it('vocab: 1–4 meanings, 1–6 tags, ≥ 1 example containing the target, N5 ≤ 25 chars, pitch sane', () => {
    for (const v of VOCAB) {
      expect(v.meanings.length).toBeGreaterThanOrEqual(1);
      expect(v.meanings.length).toBeLessThanOrEqual(4);
      expect(v.tags.length).toBeGreaterThanOrEqual(1);
      expect(v.tags.length).toBeLessThanOrEqual(6);
      expect(v.examples.length).toBeGreaterThanOrEqual(1);
      const stem = ['v1', 'v5', 'adj-i', 'n-suru'].includes(v.pos) ? v.word.slice(0, -1) : v.word;
      for (const e of v.examples) {
        const plain = toPlain(e.ja);
        expect(plain.length, `${v.id} ${plain}`).toBeLessThanOrEqual(25);
        const hit = plain.includes(v.word) || plain.includes(v.kana) || (v.altForms ?? []).some((a) => plain.includes(a)) || (stem.length > 0 && plain.includes(stem));
        expect(hit, `${v.id}: ${plain}`).toBe(true);
        expect(/[.?!]$/.test(e.en)).toBe(true);
      }
      for (const m of v.meanings) {
        expect(m.length).toBeLessThanOrEqual(40);
        expect(m.endsWith('.')).toBe(false);
        if (v.pos === 'v1' || v.pos === 'v5') expect(m.startsWith('to ')).toBe(true);
      }
      if (v.pitch !== undefined) {
        expect(Number.isInteger(v.pitch)).toBe(true);
        expect(v.pitch).toBeGreaterThanOrEqual(0);
        expect(v.pitch).toBeLessThanOrEqual(moraCount(v.kana));
        expect(v.pitchConfidence).toBeDefined();
      } else expect(v.pitchConfidence).toBeUndefined();
      if (v.notes) expect(v.notes.length).toBeLessThanOrEqual(200);
    }
    const high = VOCAB.filter((v) => v.pitchConfidence === 'high');
    expect(high.map((v) => v.id)).toEqual([FIXTURE_PITCH_HIGH_ID]);
    const chunks = VOCAB.filter((v) => v.tags.includes('set-phrase') || v.tags.includes('aizuchi')).map((v) => v.id);
    expect(chunks).toEqual([...FIXTURE_CHUNK_IDS]);
    expect(VOCAB.some((v) => v.tags.includes('loanword'))).toBe(true);
    expect(VOCAB.some((v) => v.tags.includes('usually-kana'))).toBe(true);
  });

  it('kanji: 1–3 meanings, 1–5 components, ≥ 2 examples containing the char, mnemonic ≤ 280 naming every component (V17), strokes 1–30', () => {
    for (const k of KANJI) {
      expect(k.meanings.length).toBeGreaterThanOrEqual(1);
      expect(k.meanings.length).toBeLessThanOrEqual(3);
      expect(k.components.length).toBeGreaterThanOrEqual(1);
      expect(k.components.length).toBeLessThanOrEqual(5);
      expect(k.examples.length).toBeGreaterThanOrEqual(2);
      for (const e of k.examples) expect(e.word.includes(k.char), `${k.id} ${e.word}`).toBe(true);
      expect(k.mnemonic.length).toBeLessThanOrEqual(280);
      for (const name of k.components) expect(new RegExp(`\\b${name}\\b`, 'i').test(k.mnemonic), `${k.id} mnemonic lacks ${name}`).toBe(true);
      expect(k.strokes).toBeGreaterThanOrEqual(1);
      expect(k.strokes).toBeLessThanOrEqual(30);
      if (k.radical) expect(k.radical).not.toBe(COMPONENTS.find((c) => c.name === k.components[0])?.char);
    }
  });

  it('grammar: ≥ 3 examples each containing a clozeHint, 1–6 formation lines, mistakes in × → ○ form, explanation ≤ 120 words', () => {
    for (const g of GRAMMAR) {
      expect(g.examples.length).toBeGreaterThanOrEqual(3);
      expect(g.clozeHints.length).toBeGreaterThanOrEqual(1);
      expect(g.formation.length).toBeGreaterThanOrEqual(1);
      expect(g.formation.length).toBeLessThanOrEqual(6);
      expect(g.mistakes.length).toBeLessThanOrEqual(3);
      for (const m of g.mistakes) expect(/^× .+ → ○ .+( \(.+\))?$/.test(m), m).toBe(true);
      for (const e of g.examples) {
        const plain = toPlain(e.ja);
        expect(g.clozeHints.some((h) => plain.includes(h)), `${g.id} ${plain}`).toBe(true);
        expect(plain.length).toBeLessThanOrEqual(25);
      }
      expect(g.explanation.split(/\s+/).length).toBeLessThanOrEqual(120);
      for (const f of g.unlocksForms ?? []) expect(typeof f).toBe('string');
    }
    const forms = GRAMMAR.find((g) => g.id === G.ます)?.unlocksForms;
    expect(forms).toEqual(['masu', 'masen', 'mashita']);
  });

  it('kana: mnemonic ≤ 160, exampleWord contains the kana, type/row consistent (V24)', () => {
    for (const k of KANA) {
      expect(k.mnemonic.length).toBeLessThanOrEqual(160);
      expect(k.exampleWord.word.includes(k.kana), k.id).toBe(true);
      expect(k.script).toBe('hiragana');
      expect(/^[ぁ-ゖ]+$/.test(k.kana)).toBe(true);
      expect(k.type).toBe('basic');
      expect(/^[a-z]+$/.test(k.romaji)).toBe(true);
      expect(k.id).toBe(`k-h-${k.romaji}`);
      expect(k.station).toBe(1);
    }
    const glyphs = new Set(KANA.map((k) => k.kana));
    expect(glyphs.size).toBe(KANA.length);
  });

  it('michikusa: bodyEn ≤ 60 words, sourceNote where required and ≤ 80 chars, kana iff ja', () => {
    for (const m of MICHIKUSA) {
      expect(m.bodyEn.split(/\s+/).length).toBeLessThanOrEqual(60);
      if (['road-history', 'etymology', 'kanji-origin'].includes(m.kind)) expect(m.sourceNote, m.id).toBeDefined();
      if (m.sourceNote) expect(m.sourceNote.length).toBeLessThanOrEqual(80);
      expect(m.ja === undefined).toBe(m.kana === undefined);
    }
  });
});

describe('stories (V19–V21, V25, V27)', () => {
  const texts: StoryItem[] = [STORY, DIALOGUE];
  const vocabById = new Map(VOCAB.map((v) => [v.id, v]));
  const grammarById = new Map(GRAMMAR.map((g) => [g.id, g]));

  it('12–60 lines, tokens concatenate to plain ja, each token non-empty, line ≤ 38 chars (N5 story cap)', () => {
    for (const s of texts) {
      expect(s.lines.length).toBeGreaterThanOrEqual(12);
      expect(s.lines.length).toBeLessThanOrEqual(60);
      for (const l of s.lines) {
        expect(tokensMatchPlain(l.ja, l.tokens), `${s.id}: ${l.ja}`).toBe(true);
        for (const t of l.tokens) expect(t.length).toBeGreaterThan(0);
        expect(toPlain(l.ja).length).toBeLessThanOrEqual(38);
        expect(l.tokens.filter((t) => !/^[。、！？「」]$/.test(t)).length).toBeLessThanOrEqual(14 * 1.5);
      }
    }
    expect(STORY.lines).toHaveLength(12);
    expect(DIALOGUE.lines).toHaveLength(12);
  });

  it('tokenIds are parallel to tokens, resolve to fixture vocab/grammar, and match the token surface', () => {
    for (const s of texts) {
      for (const l of s.lines) {
        expect(l.tokenIds, `${s.id}: ${l.ja}`).toBeDefined();
        expect(l.tokenIds!.length).toBe(l.tokens.length);
        l.tokenIds!.forEach((id, i) => {
          if (id === null) return;
          const token = l.tokens[i]!;
          const v = vocabById.get(id);
          const g = grammarById.get(id);
          expect(v || g, `${s.id}: ${id} is not a fixture item`).toBeTruthy();
          if (v) {
            const stem = ['v1', 'v5', 'adj-i'].includes(v.pos) ? v.word.slice(0, -1) : v.word;
            const ok = token === v.word || token === v.kana || (v.altForms ?? []).includes(token) || (stem.length > 0 && token.startsWith(stem));
            expect(ok, `${s.id}: token ${token} ≠ ${v.word}`).toBe(true);
            expect(s.vocabIds, `${s.id}: ${id} missing from vocabIds`).toContain(id);
          }
          if (g) {
            expect(g.clozeHints.some((h) => token.includes(h)), `${s.id}: token ${token} ≠ ${g.pattern}`).toBe(true);
            expect(s.grammarIds).toContain(id);
          }
        });
      }
      // every vocabId is actually used by some token
      const used = new Set(s.lines.flatMap((l) => l.tokenIds ?? []));
      for (const id of s.vocabIds) expect(used.has(id), `${s.id}: ${id} listed but unused`).toBe(true);
    }
  });

  it('coverage ≥ 0.97 counting function tokens, names and numerals as known (V20)', () => {
    const FUNCTION = new Set(['は', 'が', 'を', 'に', 'で', 'と', 'へ', 'から', 'まで', 'より', 'の', 'も', 'か', 'ね', 'よ', 'な', 'わ', 'って', 'です', 'だ', 'でした', 'ます', 'ません', 'ました', 'います', 'いる', 'ある', 'あります', 'さん', 'ちゃん', 'くん']);
    const PUNCT = /^[。、！？「」]$/;
    const NUMERAL = /^[一二三四五六七八九十百千万]+[人つ枚本]?$/;
    for (const s of texts) {
      let total = 0;
      let known = 0;
      for (const l of s.lines) {
        l.tokens.forEach((t, i) => {
          if (PUNCT.test(t)) return;
          total++;
          const id = l.tokenIds?.[i] ?? null;
          if (id !== null || FUNCTION.has(t) || (s.names ?? []).includes(t) || NUMERAL.test(t)) known++;
        });
      }
      expect(known / total, `${s.id} coverage ${known}/${total}`).toBeGreaterThanOrEqual(0.97);
    }
  });

  it('comprehension: ≥ 3 questions, 4 distinct English choices, valid answer, varied index', () => {
    for (const s of texts) {
      expect(s.comprehension.length).toBeGreaterThanOrEqual(3);
      const answers = new Set<number>();
      for (const q of s.comprehension) {
        expect(new Set(q.choices).size).toBe(4);
        expect(q.choices[q.answer]).toBeDefined();
        expect(/[ぁ-ゖァ-ヺ一-鿿]/.test(q.q + q.choices.join(''))).toBe(false);
        answers.add(q.answer);
      }
      expect(answers.size).toBeGreaterThan(1);
      expect(s.recapEn.split(/\s+/).length).toBeLessThanOrEqual(60);
      for (const name of s.names ?? []) expect(s.lines.some((l) => toPlain(l.ja).includes(name)), name).toBe(true);
    }
  });

  it('story form: no speaker in a story; every dialogue line has a speaker, ≥ 2 speakers, learnerSpeaker among them (V25)', () => {
    for (const l of STORY.lines) expect(l.speaker).toBeUndefined();
    const speakers = new Set(DIALOGUE.lines.map((l) => l.speaker));
    expect(speakers.has(undefined)).toBe(false);
    expect(speakers.size).toBeGreaterThanOrEqual(2);
    expect(speakers.has(DIALOGUE.learnerSpeaker)).toBe(true);
  });

  it('dialogue learner lines carry options (one best = plain line, recasts on the rest), mustInclude, accept; aizuchi only on long NPC lines (V27)', () => {
    for (const l of DIALOGUE.lines) {
      const plain = toPlain(l.ja);
      if (l.speaker === DIALOGUE.learnerSpeaker) {
        expect(l.options, plain).toBeDefined();
        expect(l.options!.length).toBeGreaterThanOrEqual(3);
        expect(l.options!.length).toBeLessThanOrEqual(4);
        const best = l.options!.filter((o) => o.kind === 'best');
        expect(best).toHaveLength(1);
        expect(best[0]!.text).toBe(plain);
        for (const o of l.options!) if (o.kind !== 'best') expect(o.recast, o.text).toBeDefined();
        expect(new Set(l.options!.map((o) => o.text)).size).toBe(l.options!.length);
        expect(l.mustInclude).toBeDefined();
        for (const m of l.mustInclude!) expect(plain.includes(m), `${plain} ∌ ${m}`).toBe(true);
        expect(l.accept).toBeDefined();
        for (const a of l.accept!) expect(a).not.toBe(plain);
        expect(l.aizuchiSlot).toBeUndefined();
      } else {
        expect(l.options).toBeUndefined();
        if (l.aizuchiSlot) expect(plain.length).toBeGreaterThanOrEqual(12);
      }
    }
    expect(DIALOGUE.lines.filter((l) => l.aizuchiSlot).length).toBeGreaterThanOrEqual(1);
  });

  it('register heuristic: polite texts end their lines in です/ます forms (V22)', () => {
    for (const s of texts) {
      const polite = s.lines.filter((l) => /(です|ます|ません|ました|ましょう|ください)(か|ね|よ)?。$/.test(toPlain(l.ja))).length;
      expect(polite / s.lines.length).toBeGreaterThan(0.5);
    }
  });
});

describe('bundles and manifest (V35)', () => {
  it('bundle ids resolve to items held by the bundle files; surfaces map the cumulative allowlist', () => {
    for (const b of FIXTURE.stations) {
      const held = new Set(b.files.flatMap((p) => (FIXTURE.files[p] as ContentFile<ContentItem>).items.map((it) => it.id)));
      for (const id of [...b.kanaIds, ...b.vocabIds, ...b.kanjiIds, ...b.grammarIds, ...b.componentIds, ...b.storyIds, ...b.michikusaIds]) {
        expect(FIXTURE.items[id], id).toBeDefined();
        expect(held.has(id), `${id} not in ${b.number}.files`).toBe(true);
      }
      for (const [surface, id] of Object.entries(b.surfaces)) {
        const v = FIXTURE.items[id] as VocabItem;
        expect(v).toBeDefined();
        expect((v.station ?? 99) <= b.number).toBe(true);
        expect([v.word, v.kana, ...(v.altForms ?? [])]).toContain(surface);
      }
    }
    expect(Object.keys(STATION_1.surfaces).length).toBeLessThan(Object.keys(STATION_4.surfaces).length);
    expect(STATION_4.surfaces['美味しい']).toBe(V.おいしい);
    expect(STATION_4.surfaces['のむ']).toBe(V.飲む);
    expect(STATION_1.surfaces['のむ']).toBeUndefined();
  });

  it('every item has a station that matches its bundle', () => {
    const inBundle = new Map<string, number>();
    for (const b of FIXTURE.stations) for (const id of [...b.kanaIds, ...b.vocabIds, ...b.kanjiIds, ...b.grammarIds]) inBundle.set(id, b.number);
    for (const it of [...KANA, ...VOCAB, ...KANJI, ...GRAMMAR]) expect(it.station, it.id).toBe(inBundle.get(it.id));
  });

  it('manifest lists every file with the right type, level, count and stations; totals add up', () => {
    const m = FIXTURE.manifest;
    expect(m.schema).toBe('tsuzuku.manifest/1');
    const listed = new Set(m.files.map((f) => f.path));
    for (const [path, body] of ALL_FILES) {
      if (path === PATHS.manifest || path.startsWith('stations/')) continue;
      expect(listed.has(path), path).toBe(true);
      const entry = m.files.find((f) => f.path === path)!;
      const file = body as ContentFile<unknown>;
      expect(entry.type).toBe(file.type);
      expect(entry.level).toBe(file.level ?? null);
      expect(entry.count).toBe(file.items.length);
      expect(entry.bytes).toBe(JSON.stringify(body).length);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(m.files).toHaveLength(ALL_FILES.length - 1 - m.stations.length);
    for (const s of m.stations) {
      const b = FIXTURE.stations.find((x) => x.number === s.number)!;
      expect(FIXTURE.files[s.path]).toBe(b);
      expect(s.counts).toEqual({ kana: b.kanaIds.length, vocab: b.vocabIds.length, kanji: b.kanjiIds.length, grammar: b.grammarIds.length, story: b.storyIds.length, michikusa: b.michikusaIds.length });
      for (const p of b.files) expect(m.files.find((f) => f.path === p)!.stations).toContain(s.number);
    }
    const byType = (t: ContentKind) => m.files.filter((f) => f.type === t).reduce((n, f) => n + f.count, 0);
    for (const t of ['kana', 'vocab', 'kanji', 'grammar', 'story', 'conjugation', 'component', 'michikusa'] as const) expect(m.totals[t], t).toBe(byType(t));
    expect(m.totals.station).toBe(m.stations.length);
    // design 08 §4: 'pool' is a CONTENT_KIND; the fixture ships no pool files, so the total is 0 and every kind has a key.
    expect(Object.keys(m.totals).sort()).toEqual([...CONTENT_KINDS].sort());
    expect(m.totals.pool).toBe(0);
    expect(m.files.some((f) => f.type === 'pool')).toBe(false);
    expect(m.componentsPath).toBe(PATHS.components);
    expect(m.files.find((f) => f.path === m.componentsPath)?.type).toBe('component');
  });

  it('grammar graph has the three points cross-linked', () => {
    const byId = new Map(GRAMMAR.map((g) => [g.id, g] as [string, GrammarItem]));
    expect(byId.get(G.です)?.related).toContain(G.は);
    expect(byId.get(G.は)?.related).toContain(G.です);
  });
});

describe('createFakeLoader pools (design 08 §4)', () => {
  it('pool(n) rejects missing-pool with the conventional path when the fixture has none, and serves Fixture.pools[n] when given', async () => {
    const bare = createFakeLoader();
    await expect(bare.pool(4)).rejects.toMatchObject({ code: 'missing-pool', path: 'listening/pool-04.json' });
    const pool: ListeningPool = {
      schema: 'tsuzuku.pool/1',
      station: 4,
      refs: [{ ref: `${FIXTURE_STORY_ID}#L1`, ids: [V.はい], kana: 'はい、ほんです。', morae: 6 }],
    };
    const withPool = createFakeLoader({ ...FIXTURE, pools: { 4: pool } });
    await expect(withPool.pool(4)).resolves.toBe(pool);
    await expect(withPool.pool(5)).rejects.toMatchObject({ code: 'missing-pool', path: 'listening/pool-05.json' });
    // The pool is not an item: nothing about get() / stationOf changes.
    expect(withPool.get(FIXTURE_STORY_ID)).toBeDefined();
  });
});
