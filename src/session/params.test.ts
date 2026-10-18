/**
 * params.ts — resolved step params: bunsetsu tiles, Form Chain links, Minimal Pair sides (design 04 §4, §5).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CardKey, GrammarItem, KanjiItem, ListeningPool, PoolRef, StoryItem, VocabItem } from '../content/types';
import { FIXTURE, FIXTURE_DIALOGUE_ID, FIXTURE_IDS, FIXTURE_STORY_ID, G, KANJI, V, createFakeLoader } from '../content/fixtures';
import { toPlain } from '../content/ruby';
import { bus } from '../shared/events';
import { epochDay } from '../shared/time';
import type { CardTuple } from '../shared/store-types';
import { resetStoreForTests } from '../store';
import { DEFAULT_TEST_NOW, card, makeTestStore } from '../store/testing';
import { conjugate } from '../learn';
import { isListeningText, isSpeakable, knownSentences, loadPlanContext, loadPools, pickStories, resolveParams, splitBunsetsu, storyCoverage } from './builder';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();
const CONJUGABLE = ['v1', 'v5', 'v-irr', 'adj-i', 'adj-na'];

function due(s = 5): CardTuple {
  return card({ due: TODAY, s, d: 5, reps: 6, lapses: 0, state: 2, last: TODAY - 1, flags: 0 });
}

/** Base-facet cards for every fixture item (builder.test pattern). */
function allCards(): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  for (const id of FIXTURE_IDS.vocab) out[`${id}#${id === V.おはよう || id === V.はい ? 'prod' : 'rec'}`] = due();
  for (const id of FIXTURE_IDS.kanji) out[`${id}#comp`] = due();
  for (const id of FIXTURE_IDS.grammar) out[`${id}#cloze`] = due();
  for (const id of FIXTURE_IDS.component) out[`${id}#rec`] = due();
  return out;
}

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('bunsetsu tiles and Minimal Pair (design 04 §4, §5)', () => {
  it('splitBunsetsu never cuts a particle that continues a word (ありがとう・ながら・とき・べからず) and keeps のは/のが on the word', () => {
    expect(splitBunsetsu('ありがとうございました。')).toEqual(['ありがとうございました', '。']);
    expect(splitBunsetsu('残念ながら、行けません。')).toEqual(['残念ながら', '、', '行けません', '。']);
    expect(splitBunsetsu('失敗したときこそ学ぶ。')).toEqual(['失敗したときこそ学ぶ', '。']);
    expect(splitBunsetsu('忘るべからず。')).toEqual(['忘るべからず', '。']);
    expect(splitBunsetsu('助けるのが友達というものだ。')).toEqual(['助けるのが', '友達というものだ', '。']);
    expect(splitBunsetsu('来るのは恐縮です。')).toEqual(['来るのは', '恐縮です', '。']);
    // a particle before kanji, katakana or punctuation still closes its tile
    expect(splitBunsetsu('これはペンです。')).toEqual(['これは', 'ペンです', '。']);
    expect(splitBunsetsu('本を読む。')).toEqual(['本を', '読む', '。']);
    expect(splitBunsetsu('私の。')).toEqual(['私の', '。']);
  });

  it('Minimal Pair speaks either half of the pair across draws, and the answer is always one of the choices', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const p = resolveParams(ctx, 'minimal-pair', loader.get(V.犬)!, { rep: i });
      expect(p.choices).toHaveLength(2);
      expect(p.choices).toContain(p.answer);
      seen.add(p.answer as string);
    }
    expect(seen.size).toBe(2);
    expect(seen.has('いぬ')).toBe(true);
  });

  it('Minimal Pair names the real partner in distractorIds (design 08 §10.4: both clips keyed by item id); a synthesized partner leaves it unset', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const inu = loader.get<VocabItem>(V.犬)!;
    const p = resolveParams(ctx, 'minimal-pair', inu, { rep: 0 });
    // the nearest loaded neighbour of いぬ (mora distance 2; the smallest kana wins a tie) is のむ
    expect(p.distractorIds).toEqual([V.飲む]);
    const partner = ctx.vocabPool.find((v) => v.id === p.distractorIds![0])!;
    expect(p.choices).toContain(partner.kana);
    expect(p.choices).toContain(inu.kana);
    // the step shape the drill pins (MinimalPair.test.tsx): choices + answer + rate + distractorIds, nothing else
    expect(Object.keys(p).sort()).toEqual(['answer', 'choices', 'distractorIds', 'rate']);
    // the partner is never the item itself, whichever half is spoken
    for (let i = 1; i < 20; i++) expect(resolveParams(ctx, 'minimal-pair', inu, { rep: i }).distractorIds).toEqual([V.飲む]);
    // no loaded neighbour within two morae: the partner is synthesized (いっぬ), has no item id, and the field stays unset
    const alone = resolveParams({ ...ctx, vocabPool: [inu, loader.get<VocabItem>(V.おはよう)!] }, 'minimal-pair', inu, { rep: 0 });
    expect(alone.distractorIds).toBeUndefined();
    expect(alone.choices).toHaveLength(2);
    expect(alone.choices).toContain(inu.kana);
    expect(alone.choices!.some((c) => c !== inu.kana && !ctx.vocabPool.some((v) => v.kana === c))).toBe(true);
    expect(Object.keys(alone).sort()).toEqual(['answer', 'choices', 'rate']);
  });
});

describe('Form Chain links (design 04 §4 "one verb, 5 target forms")', () => {
  it('a one-form point still yields 5 links: its own form first, then forms of points already met, then any form the verb takes', async () => {
    await makeTestStore({ save: { progress: { station: 12 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const ta: GrammarItem = { ...loader.get<GrammarItem>(G.ます)!, id: 'g-n5-064', unlocksForms: ['ta'] };
    const one = resolveParams(ctx, 'form-chain', ta, { rep: 0 });
    expect(one.forms).toHaveLength(5);
    expect(one.forms![0]).toBe('ta');
    expect(new Set(one.forms).size).toBe(5);
    expect(one.answers).toHaveLength(5);
    for (const a of one.answers!) expect(a.length).toBeGreaterThan(0);
    expect(one.accept!.length).toBeGreaterThanOrEqual(5);
    // the head word travels whole (contract #10/#27): its part of speech and the accepted surfaces per form, parallel
    // to `forms`, so the drill never infers the group from the answers
    expect(CONJUGABLE).toContain(one.pos);
    expect(one.accepts).toHaveLength(5);
    one.forms!.forEach((f, i) => {
      const row = one.accepts![i]!;
      expect(row[0]).toBe(one.answers![i]);
      expect(conjugate(one.sentence!, one.kana!, one.pos!, f)?.answer).toBe(one.answers![i]);
      for (const s of row) expect(one.accept).toContain(s);
    });
    // forms unlocked by an already-introduced point (station ≤ current) are preferred over arbitrary padding
    const met: GrammarItem = { ...ta, id: 'g-n5-046', unlocksForms: ['te', 'te-iru'], station: 4 };
    const chain = resolveParams({ ...ctx, grammarPool: [met] }, 'form-chain', ta, { rep: 0 });
    expect(chain.forms![0]).toBe('ta');
    expect(chain.forms!.slice(1, 3).sort()).toEqual(['te', 'te-iru']);
    expect(chain.forms).toHaveLength(5);
    // a point ahead on the road counts only once the learner knows it
    const ahead: GrammarItem = { ...met, id: 'g-n5-077', unlocksForms: ['potential'], station: 14 };
    const known = resolveParams({ ...ctx, grammarPool: [ahead], known: new Set([...ctx.known, ahead.id]) }, 'form-chain', ta, { rep: 0 });
    expect(known.forms![1]).toBe('potential');
  });

  it('Form Forge sends the verb whole as well: pos, and a one-row accepts parallel to [targetForm]', async () => {
    await makeTestStore({ save: { progress: { station: 12 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const p = resolveParams(ctx, 'form-forge', loader.get(G.ます)!, { rep: 0 });
    expect(p.targetForm).toBe('masu');
    expect(CONJUGABLE).toContain(p.pos);
    expect(p.accepts).toEqual([p.accept]);
    expect(p.accepts![0]![0]).toBe(p.answer);
    const c = conjugate(p.sentence!, p.kana!, p.pos!, 'masu')!;
    expect(p.answer).toBe(c.answer);
    expect(p.accepts![0]).toContain(c.answerKana);
  });
});

describe('Form Forge / Form Chain head words by declared form (design 04 §4)', () => {
  it('an adjective-only point draws an adjective; a mixed point draws both kinds over the rotation', async () => {
    await makeTestStore({ save: { progress: { station: 10 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 10 });
    const base = loader.get<GrammarItem>(G.ます)!;
    for (const form of ['adj-neg', 'adj-te', 'adj-adv', 'adj-past', 'adj-ba'] as const) {
      const p = resolveParams(ctx, 'form-forge', { ...base, unlocksForms: [form] }, { rep: 2 });
      expect(p.targetForm, form).toBe(form);
      expect(['adj-i', 'adj-na']).toContain(p.pos);
      expect(p.answer, form).toBeTruthy();
      expect(p.answer).toBe(conjugate(p.sentence!, p.kana!, p.pos!, form)!.answer);
    }
    const chain = resolveParams(ctx, 'form-chain', { ...base, unlocksForms: ['adj-te'] }, { rep: 0 });
    expect(chain.pos).toBe('adj-i');
    expect(chain.forms![0]).toBe('adj-te');
    for (const f of chain.forms!) expect(conjugate(chain.sentence!, chain.kana!, chain.pos!, f), f).not.toBeNull();
    const seen = new Set<string>();
    for (let rep = 0; rep < 6; rep++) seen.add(resolveParams(ctx, 'form-forge', { ...base, unlocksForms: ['nai', 'adj-neg'] }, { rep }).pos as string);
    expect(seen.has('adj-i')).toBe(true);
    expect(seen.has('v1') || seen.has('v5')).toBe(true);
  });

  it('a head word that lacks the declared form is never drawn (ある for たい)', async () => {
    await makeTestStore({ save: { progress: { station: 10 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 10 });
    const aru: VocabItem = { ...loader.get<VocabItem>(V.飲む)!, id: 'v-n5-9999', word: 'ある', kana: 'ある', pos: 'v5', meanings: ['to exist'] };
    const pool = { ...ctx, vocabPool: [aru, ...ctx.vocabPool] };
    const tai = { ...loader.get<GrammarItem>(G.ます)!, unlocksForms: ['tai' as const] };
    for (let rep = 0; rep < 8; rep++) {
      const p = resolveParams(pool, 'form-forge', tai, { rep });
      expect(p.sentence, `rep ${rep}`).not.toBe('ある');
      expect(p.targetForm).toBe('tai');
    }
  });
});

describe('Kanji Read picks the sentence by word AND reading, blanking an aligned span (design 04 §3)', () => {
  const kanji = (over: Partial<KanjiItem>): KanjiItem => ({ ...KANJI[0]!, ...over });

  it('日/にち never borrows 日/ひ’s sentence; a compound ruby group is never cut', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    // The fixture's 日 is read ひ (いい{日|ひ}ですね。); a kanji example reading it にち must not take that sentence.
    const hi = loader.get<VocabItem>(V.日)!;
    const pool = { ...ctx, stories: [] as StoryItem[] };
    const nichi = resolveParams(pool, 'kanji-read', kanji({ id: 'j-日', char: '日', examples: [{ word: '日', kana: 'にち', en: 'day (counter)' }] }), { rep: 0 });
    expect(nichi.sentence).toBe('日');
    expect(nichi.blank).toEqual([0, 1]);
    expect(nichi.answer).toBe('にち');
    const hiRead = resolveParams(pool, 'kanji-read', kanji({ id: 'j-日', char: '日', examples: [{ word: '日', kana: 'ひ', en: 'day' }] }), { rep: 0 });
    expect(hiRead.sentence).toBe(hi.examples[0]!.ja);
    expect(hiRead.blank).toEqual([2, 3]);

    const jikan: VocabItem = { ...hi, id: 'v-n5-9002', word: '時間', kana: 'じかん', meanings: ['time'], examples: [{ ja: '{二時間|にじかん}ぐらいです。', kana: 'にじかんぐらいです。', en: 'About two hours.' }, { ja: '{時間|じかん}があります。', kana: 'じかんがあります。', en: 'There is time.' }] };
    const toki = kanji({ id: 'j-時', char: '時', examples: [{ word: '時間', kana: 'じかん', en: 'time' }] });
    const p = resolveParams({ ...pool, vocabPool: [...pool.vocabPool, jikan] }, 'kanji-read', toki, { rep: 0 });
    expect(p.sentence).toBe('{時間|じかん}があります。');
    expect(p.blank).toEqual([0, 2]);
    const compoundOnly = resolveParams({ ...pool, vocabPool: [...pool.vocabPool, { ...jikan, examples: [jikan.examples[0]!] }] }, 'kanji-read', toki, { rep: 0 });
    expect(compoundOnly.sentence).toBe('時間');
  });

  it('a story line with a contradicting reading is skipped for one that agrees (清見寺という古い寺)', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const tera: VocabItem = { ...loader.get<VocabItem>(V.水)!, id: 'v-n5-9003', word: '寺', kana: 'てら', meanings: ['temple'], examples: [] };
    const story: StoryItem = { ...loader.get<StoryItem>(FIXTURE_STORY_ID)!, id: 's-04-9', lines: [{ ja: '{道|みち}の{上|うえ}に{清見寺|せいけんじ}という{古|ふる}い{寺|てら}があります。', kana: 'みちのうえにせいけんじというふるいてらがあります。', en: 'On the road stands an old temple called Seikenji.', tokens: ['道', 'の', '上', 'に', '清見寺', 'という', '古い', '寺', 'が', 'あります', '。'], tokenIds: [null, null, null, null, null, null, null, 'v-n5-9003', null, null, null] }] };
    const p = resolveParams({ ...ctx, stories: [story], vocabPool: [...ctx.vocabPool, tera] }, 'kanji-read', kanji({ id: 'j-寺', char: '寺', examples: [{ word: '寺', kana: 'てら', en: 'temple' }] }), { rep: 0 });
    expect(p.sentence).toBe(story.lines[0]!.ja);
    // 道0 の1 上2 に3 清4 見5 寺6 と7 い8 う9 古10 い11 寺12 — the first 寺 (読み じ) is inside a ruby group and skipped
    expect(p.blank).toEqual([12, 13]);
    expect(p.answer).toBe('てら');
  });
});

describe('story coverage follows V20 (plusOne, shared White allowlist)', () => {
  it('a plusOne token counts as covered; the allowlist does too; anything else unknown does not', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const base = loader.get<StoryItem>(FIXTURE_STORY_ID)!;
    const story: StoryItem = { ...base, lines: [{ ...base.lines[3]!, tokenIds: [V.私, G.は, V.コーヒー, null, V.飲む, null], plusOne: [V.コーヒー] }] };
    expect(storyCoverage(story, new Set([V.私, G.は, V.飲む]))).toBe(1);
    expect(storyCoverage(story, new Set([V.私, G.は]))).toBe(0.75);
    expect(storyCoverage(story, new Set([V.私, G.は]), new Set([V.飲む]))).toBe(1);
    expect(storyCoverage({ ...story, lines: [{ ...story.lines[0]!, plusOne: [] }] }, new Set([V.私, G.は, V.飲む]))).toBe(0.75);
    const ctx = await loadPlanContext({ loader, station: 4 });
    expect(pickStories({ ...ctx, stories: [story], known: new Set([V.私, G.は]), allowlist: new Set([V.飲む]) }).map((s) => s.id)).toEqual([story.id]);
    expect(pickStories({ ...ctx, stories: [story], known: new Set([V.私, G.は]), allowlist: new Set() })).toEqual([]);
  });
});

describe('splitBunsetsu cuts after も and before a bunsetsu-initial hiragana word', () => {
  it('yields two or more movable tiles where the old rule yielded one', () => {
    expect(splitBunsetsu('ケンさんも学生です。')).toEqual(['ケンさんも', '学生です', '。']);
    expect(splitBunsetsu('トイレはどこですか。')).toEqual(['トイレは', 'どこですか', '。']);
    expect(splitBunsetsu('どんな音楽をよく聞きますか。')).toEqual(['どんな音楽を', 'よく聞きますか', '。']);
    expect(splitBunsetsu('いつも水を飲みます。')).toEqual(['いつも', '水を', '飲みます', '。']);
    // word-internal matches still hold
    expect(splitBunsetsu('ありがとうございます。')).toEqual(['ありがとうございます', '。']);
    expect(splitBunsetsu('ケンでもいいです。')).toEqual(['ケンでもいいです', '。']);
  });
});

describe('Pitch Ear minimal pairs (design 04 §2): distractorIds carries the loaded homophones with a different pitch', () => {
  const base = (): VocabItem => loader.get<VocabItem>(V.飲む)!;
  const 雨 = (): VocabItem => ({ ...base(), id: 'v-n5-9801', word: '雨', kana: 'あめ', pos: 'n', meanings: ['rain'], pitch: 1, pitchConfidence: 'high', confusables: undefined, pairId: undefined, kanjiIds: undefined });
  const 飴 = (): VocabItem => ({ ...雨(), id: 'v-n5-9802', word: '飴', meanings: ['candy'], pitch: 0 });

  it('a kana-equal lookup over the loaded vocab finds the high-confidence homophone, both ways', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const ame1 = 雨();
    const ame0 = 飴();
    const pool = { ...ctx, vocabPool: [...ctx.vocabPool, ame1, ame0] };
    const rain = resolveParams(pool, 'pitch-ear', ame1, { rep: 0 });
    expect(rain.answer).toBe('頭高');
    expect(rain.choices).toEqual(['平板', '頭高', '中高', '尾高']);
    expect(rain.distractorIds).toEqual([ame0.id]);
    expect(resolveParams(pool, 'pitch-ear', ame0, { rep: 0 }).distractorIds).toEqual([ame1.id]);
  });

  it('a same-pitch or low-confidence twin is not a contrast; with no homophone the field stays unset (confusables fallback kept)', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const ame1 = 雨();
    const samePitch: VocabItem = { ...飴(), pitch: 1 };
    const low: VocabItem = { ...飴(), pitchConfidence: 'low' };
    expect(resolveParams({ ...ctx, vocabPool: [...ctx.vocabPool, ame1, samePitch] }, 'pitch-ear', ame1, { rep: 0 }).distractorIds).toBeUndefined();
    expect(resolveParams({ ...ctx, vocabPool: [...ctx.vocabPool, ame1, low] }, 'pitch-ear', ame1, { rep: 0 }).distractorIds).toBeUndefined();
    // 飲む has confusables (食べる) but no homophone: the planner leaves distractorIds alone so the drill's own fallback applies.
    const nomu = resolveParams(ctx, 'pitch-ear', base(), { rep: 0 });
    expect(nomu.answer).toBe('頭高');
    expect(nomu.distractorIds).toBeUndefined();
  });

  it('pairId wins when it names a homophone, else confusables (low confidence allowed there), and a non-homophone pairId is ignored', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const ame0 = 飴();
    const lowTwin: VocabItem = { ...飴(), id: 'v-n5-9803', pitchConfidence: 'low' };
    const pool = { ...ctx, vocabPool: [...ctx.vocabPool, ame0, lowTwin] };
    // pairId → only that one, even though a second homophone is loaded
    expect(resolveParams(pool, 'pitch-ear', { ...雨(), pairId: ame0.id }, { rep: 0 }).distractorIds).toEqual([ame0.id]);
    // a transitivity partner that is not a homophone is ignored; the lookup takes over (high only)
    expect(resolveParams(pool, 'pitch-ear', { ...雨(), pairId: V.食べる }, { rep: 0 }).distractorIds).toEqual([ame0.id]);
    // confusables: the listed homophones, whatever their confidence, and nothing else
    expect(resolveParams(pool, 'pitch-ear', { ...雨(), confusables: [lowTwin.id, V.食べる] }, { rep: 0 }).distractorIds).toEqual([lowTwin.id]);
    // an unloaded confusable resolves to nothing → lookup
    expect(resolveParams(pool, 'pitch-ear', { ...雨(), confusables: ['v-n5-0000'] }, { rep: 0 }).distractorIds).toEqual([ame0.id]);
  });
});

describe('clip keys and pool-first dictation (design 08 §4, §8)', () => {
  const POOL_NOMU: ListeningPool = { schema: 'tsuzuku.pool/1', station: 4, refs: [{ ref: `${V.飲む}#ex0`, ids: [V.コーヒー, V.飲む], kana: 'まいあさコーヒーをのみます。', morae: 14 }] };

  it('resolveParams sets clip keys for examples, story lines and bare words; a pinned example skips the rotation; the Ear Walk carries refs', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    expect(ctx.pools).toBeUndefined();
    const nomu = loader.get<VocabItem>(V.飲む)!;
    expect(resolveParams(ctx, 'sentence-listen', nomu, { rep: 0 }).clip).toBe(`${V.飲む}#ex0`);
    expect(resolveParams(ctx, 'shadow', nomu, { rep: 0 }).clip).toBe(`${V.飲む}#ex0`);
    expect(resolveParams(ctx, 'shadow', null, { storyId: FIXTURE_STORY_ID, lineIndex: 3 }).clip).toBe(`${FIXTURE_STORY_ID}#L3`);
    expect(resolveParams(ctx, 'sentence-listen', nomu, { storyId: FIXTURE_STORY_ID, lineIndex: 8 })).toMatchObject({ clip: `${FIXTURE_STORY_ID}#L8`, storyId: FIXTURE_STORY_ID, lineIndex: 8 });
    expect(resolveParams(ctx, 'pattern-cloze', loader.get(G.です)!, { rep: 0 }).clip).toBe(`${G.です}#ex0`);
    expect(resolveParams(ctx, 'pattern-cloze', loader.get(G.です)!, { rep: 1 }).clip).toBe(`${G.です}#ex1`);
    expect(resolveParams(ctx, 'pattern-cloze', loader.get(G.です)!, { rep: 4 }).clip).toBe(`${G.です}#ex1`);
    expect(resolveParams(ctx, 'pattern-cloze', { ...loader.get<GrammarItem>(G.です)!, examples: [] }, { rep: 0 }).clip).toBeUndefined();
    const bare = resolveParams(ctx, 'sentence-listen', { ...nomu, examples: [] }, { rep: 0 });
    expect(toPlain(bare.sentence!)).toBe('飲む');
    expect(bare.clip).toBe(V.飲む);
    const pinned = resolveParams(ctx, 'sentence-listen', loader.get(G.ます)!, { rep: 0, example: 2 });
    expect(pinned.clip).toBe(`${G.ます}#ex2`);
    expect(pinned.sentence).toBe(loader.get<GrammarItem>(G.ます)!.examples[2]!.ja);
    expect(resolveParams(ctx, 'pattern-cloze', loader.get(G.です)!, { rep: 0, example: 2 }).clip).toBe(`${G.です}#ex2`);
    // the Arena derives its own line keys: text steps carry none; an Ear Walk carries its refs
    expect(resolveParams(ctx, 'listening-set', loader.get(FIXTURE_STORY_ID)!, { storyId: FIXTURE_STORY_ID }).clip).toBeUndefined();
    const walk = resolveParams(ctx, 'listening-set', null, { refs: ['s-04-1#L0', 'v-n5-0007#ex0'] });
    expect(walk.refs).toEqual(['s-04-1#L0', 'v-n5-0007#ex0']);
    expect(walk.storyId).toBeUndefined();
    expect(walk.rate).toBeGreaterThan(0);
  });

  it('sentence-listen chooses the all-known pool example when one exists, else a known story line with the word, else the bare word', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const nomu = loader.get<VocabItem>(V.飲む)!;
    // コーヒー unknown → the example is not i+0 → a story line whose tokens are all known, keyed by the line
    const known = new Set([...ctx.known].filter((id) => id !== V.コーヒー));
    const line = resolveParams({ ...ctx, pools: [POOL_NOMU], known }, 'sentence-listen', nomu, { rep: 0 });
    expect(line.storyId).toBe(FIXTURE_STORY_ID);
    expect(line.lineIndex).toBe(8);
    expect(line.clip).toBe(`${FIXTURE_STORY_ID}#L8`);
    expect(line.sentence).toBe(loader.get<StoryItem>(FIXTURE_STORY_ID)!.lines[8]!.ja);
    // the rotation walks the known lines
    expect(resolveParams({ ...ctx, pools: [POOL_NOMU], known }, 'sentence-listen', nomu, { rep: 1 }).lineIndex).toBe(10);
    // every word known → the pool example wins, with its ref as the clip key
    const ex = resolveParams({ ...ctx, pools: [POOL_NOMU] }, 'sentence-listen', nomu, { rep: 0 });
    expect(ex.clip).toBe(`${V.飲む}#ex0`);
    expect(ex.sentence).toBe(nomu.examples[0]!.ja);
    expect(ex.storyId).toBeUndefined();
    // pools present, no i+0 example and no known line → the bare word, never an example with an untaught word
    const bare = resolveParams({ ...ctx, pools: [POOL_NOMU], known, stories: [] }, 'sentence-listen', nomu, { rep: 0 });
    expect(toPlain(bare.sentence!)).toBe('飲む');
    expect(bare.clip).toBe(V.飲む);
    expect(bare.storyId).toBeUndefined();
    // shadow keeps the example rotation (its warm-up draws from knownSentences instead)
    expect(resolveParams({ ...ctx, pools: [POOL_NOMU], known }, 'shadow', nomu, { rep: 0 }).clip).toBe(`${V.飲む}#ex0`);
  });

  it('pickStories filters: speakable, audioFirst, genre, listening', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const story = loader.get<StoryItem>(FIXTURE_STORY_ID)!;
    const dialogue = loader.get<StoryItem>(FIXTURE_DIALOGUE_ID)!;
    const { learnerSpeaker: _ls, ...noPart } = dialogue;
    void _ls;
    const piece: StoryItem = { ...noPart, id: 's-04-4', audioFirst: true, genre: 'exchange' };
    const pieceWithPart: StoryItem = { ...dialogue, id: 's-04-5', audioFirst: true, genre: 'phone', learnerSpeaker: 'ハナ' };
    const told: StoryItem = { ...story, id: 's-04-6', audioFirst: true, genre: 'self-intro', narrator: 'ハナ' };
    const all = { ...ctx, stories: [story, dialogue, piece, pieceWithPart, told] };
    const ids = (xs: StoryItem[]): string[] => xs.map((s) => s.id);
    expect(ids(pickStories(all, { speakable: true }))).toEqual([dialogue.id, pieceWithPart.id]);
    expect(ids(pickStories(all, { kind: 'dialogue' }))).toEqual([dialogue.id, piece.id, pieceWithPart.id]);
    expect(ids(pickStories(all, { audioFirst: true }))).toEqual([piece.id, pieceWithPart.id, told.id]);
    expect(ids(pickStories(all, { audioFirst: false }))).toEqual([story.id, dialogue.id]);
    expect(ids(pickStories(all, { genre: 'phone' }))).toEqual([pieceWithPart.id]);
    expect(ids(pickStories(all, { listening: true }))).toEqual([dialogue.id, piece.id, pieceWithPart.id, told.id]);
    expect(ids(pickStories(all, { kind: 'story', audioFirst: false }))).toEqual([story.id]);
    expect(isSpeakable(piece)).toBe(false);
    expect(isSpeakable(pieceWithPart)).toBe(true);
    expect(isSpeakable(told)).toBe(false);
    expect(isSpeakable(story)).toBe(false);
    expect(isListeningText(told)).toBe(true);
    expect(isListeningText(dialogue)).toBe(true);
    expect(isListeningText(story)).toBe(false);
  });

  it('knownSentences tops up with i+0 pool examples carrying clip keys; without pools, with examples[0]; story lines carry their line key', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: allCards() });
    const ctx = await loadPlanContext({ loader, station: 4 });
    const refs: PoolRef[] = [
      { ref: `${V.人}#ex0`, ids: [V.人, G.は, G.です], kana: 'あのひとはケンです。', morae: 10 },
      { ref: `${G.です}#ex1`, ids: [G.は, V.水, G.です], kana: 'これはみずです。', morae: 8 },
      { ref: `${V.飲む}#ex0`, ids: [V.コーヒー, V.飲む], kana: 'まいあさコーヒーをのみます。', morae: 14 },
      { ref: `${FIXTURE_STORY_ID}#L1`, ids: [V.私, G.は, G.です], kana: 'わたしはハナです。', morae: 9 },
    ];
    const pools: ListeningPool[] = [{ schema: 'tsuzuku.pool/1', station: 4, refs }];
    const known = new Set([...ctx.known].filter((id) => id !== V.コーヒー));
    const got = knownSentences({ ...ctx, stories: [], pools, known }, 10);
    // story-line refs are not examples; the コーヒー example is not i+0
    expect(got.map((s) => s.clip).sort()).toEqual([`${G.です}#ex1`, `${V.人}#ex0`]);
    expect(got.find((s) => s.clip === `${V.人}#ex0`)!.sentence).toBe(loader.get<VocabItem>(V.人)!.examples[0]!.ja);
    expect(got.find((s) => s.clip === `${G.です}#ex1`)!.kana).toBe(loader.get<GrammarItem>(G.です)!.examples[1]!.kana);
    const legacy = knownSentences({ ...ctx, stories: [], known }, 50);
    expect(legacy.length).toBeGreaterThan(5);
    expect(legacy.every((s) => /#ex0$/.test(s.clip ?? ''))).toBe(true);
    expect(legacy.some((s) => s.clip === `${V.コーヒー}#ex0`)).toBe(false);
    const lines = knownSentences(ctx, 3);
    expect(lines).toHaveLength(3);
    expect(lines.every((s) => s.storyId !== undefined && s.clip === `${s.storyId}#L${s.lineIndex}`)).toBe(true);
  });

  it('loadPools skips stations without a pool and keeps the rest ascending', async () => {
    expect(await loadPools(loader, 4)).toEqual([]);
    const pool = (station: number): ListeningPool => ({ schema: 'tsuzuku.pool/1', station, refs: [] });
    const L = createFakeLoader({ ...FIXTURE, pools: { 4: pool(4), 1: pool(1) } });
    expect((await loadPools(L, 4)).map((p) => p.station)).toEqual([1, 4]);
    expect((await loadPools(L, 3)).map((p) => p.station)).toEqual([1]);
    expect(await loadPools(L, 0)).toEqual([]);
  });
});
