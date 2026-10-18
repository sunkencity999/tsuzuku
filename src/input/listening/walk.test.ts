import { FIXTURE, FIXTURE_STORY_ID, V, createFakeLoader } from '@/content/fixtures';
import type { ContentItem, PoolRef, StoryItem, VocabItem } from '@/content/types';
import { plusOneId } from '@/learn';
import { rngFor } from '@/shared/hash';
import { speechMoraCount } from './karaoke';
import { DICTATION_MAX_MORAE, type ListenItem } from './set';
import { WALK_MAX, WALK_TARGET, buildWalkSet, heardLines, parseRef, poolRefFor, resolveRef } from './walk';

const loader = createFakeLoader();
const get = (id: string): ContentItem | undefined => loader.get(id);
const STORY = FIXTURE.items[FIXTURE_STORY_ID] as StoryItem;

function exRef(id: string, k: number, ids: string[]): PoolRef {
  const item = loader.get<VocabItem>(id) as VocabItem;
  const ex = item.examples[k] as { kana: string };
  return { ref: `${id}#ex${k}`, ids, kana: ex.kana, morae: speechMoraCount(ex.kana) };
}
function lineRef(storyId: string, i: number): PoolRef {
  const story = loader.get<StoryItem>(storyId) as StoryItem;
  const line = story.lines[i] as { kana: string; tokenIds?: (string | null)[] };
  const ids = Array.from(new Set((line.tokenIds ?? []).filter((x): x is string => !!x && x.startsWith('v-'))));
  return { ref: `${storyId}#L${i}`, ids, kana: line.kana, morae: speechMoraCount(line.kana) };
}

/** Ten pool refs over the fixture: eight vocab examples and two diary lines. */
const REFS: PoolRef[] = [
  exRef(V.犬, 0, [V.犬, V.水, V.飲む]),
  lineRef(FIXTURE_STORY_ID, 3),
  exRef(V.水, 0, [V.水]),
  exRef(V.食べる, 0, [V.パン, V.食べる]),
  exRef(V.飲む, 0, [V.コーヒー, V.飲む]),
  exRef(V.人, 0, [V.人]),
  exRef(V.コーヒー, 0, [V.コーヒー, V.おいしい]),
  lineRef(FIXTURE_STORY_ID, 8),
  exRef(V.パン, 0, [V.パン, V.食べる]),
  exRef(V.おいしい, 0, [V.水, V.おいしい]),
];
const ALL_IDS = new Set(REFS.flatMap((r) => r.ids));
/** Everything known but 飲む: the refs holding it are i+1. */
const KNOWN_BUT_NOMU: ReadonlySet<string> = new Set([...ALL_IDS].filter((id) => id !== V.飲む));

/** A 31-mora example with two clause cuts (design 08 §9) on a vocab item that is not in the fixture. */
const LONG_ID = 'v-n5-0099';
const LONG_KANA = 'わたしはまいあさコーヒーをのんで、パンをたべて、いぬとさんぽします。';
const LONG: VocabItem = {
  id: LONG_ID,
  word: 'さんぽ',
  kana: 'さんぽ',
  meanings: ['a walk'],
  pos: 'n-suru',
  jlpt: 5,
  tags: ['actions'],
  examples: [{ ja: LONG_KANA, kana: LONG_KANA, en: 'Every morning I drink coffee, eat bread and walk the dog.' }],
  station: 4,
};
const LONG_REF: PoolRef = { ref: `${LONG_ID}#ex0`, ids: [LONG_ID, V.コーヒー, V.パン, V.犬], kana: LONG_KANA, morae: speechMoraCount(LONG_KANA) };
const getWithLong = (id: string): ContentItem | undefined => (id === LONG_ID ? LONG : loader.get(id));

const base = { station: 4, known: KNOWN_BUT_NOMU } as const;

describe('refs', () => {
  it('parseRef reads example and line refs and rejects bare word keys', () => {
    expect(parseRef('v-n5-0249#ex0')).toEqual({ id: 'v-n5-0249', kind: 'ex', index: 0 });
    expect(parseRef('g-n5-024#ex1')).toEqual({ id: 'g-n5-024', kind: 'ex', index: 1 });
    expect(parseRef('s-07-2#L3')).toEqual({ id: 's-07-2', kind: 'line', index: 3 });
    expect(parseRef('v-n5-0249')).toBeNull();
    expect(parseRef('v-n5-0249#def')).toBeNull();
  });

  it('resolveRef keeps a story line’s tokens, tokenIds and speaker, and gives an example an empty token list', () => {
    const line = resolveRef(REFS[1] as PoolRef, get);
    expect(line).not.toBeNull();
    expect(line?.ref).toBe(`${FIXTURE_STORY_ID}#L3`);
    expect(line?.tokens).toEqual((STORY.lines[3] as { tokens: string[] }).tokens);
    expect(line?.tokenIds).toEqual((STORY.lines[3] as { tokenIds?: unknown }).tokenIds);
    expect(line?.morae).toBe(speechMoraCount((STORY.lines[3] as { kana: string }).kana));
    const ex = resolveRef(REFS[0] as PoolRef, get);
    expect(ex?.tokens).toEqual([]);
    expect(ex?.ids).toEqual([V.犬, V.水, V.飲む]);
    expect(ex?.en).toBe('The dog drinks water.');
    expect(resolveRef({ ref: 'v-n5-0999#ex0', ids: [], kana: '', morae: 0 }, get)).toBeNull();
    expect(resolveRef({ ref: `${V.犬}#ex7`, ids: [], kana: '', morae: 0 }, get)).toBeNull();
  });

  it('poolRefFor rebuilds a ref from the content: a line’s vocab / grammar tokenIds, an example’s own item', () => {
    const line = poolRefFor(`${FIXTURE_STORY_ID}#L3`, get);
    expect(line?.ids).toEqual(['v-n5-0001', 'g-n5-002', 'v-n5-0011', 'v-n5-0007']);
    expect(line?.kana).toBe('わたしはコーヒーをのみます。');
    const ex = poolRefFor(`${V.犬}#ex0`, get);
    expect(ex).toEqual({ ref: `${V.犬}#ex0`, ids: [V.犬], kana: 'いぬがみずをのみます。', morae: 10 });
    expect(poolRefFor('nope', get)).toBeNull();
  });
});

describe('buildWalkSet (design 08 §10.4)', () => {
  it('builds 6–8 gist-free items, alternating choice / dictation, with four distinct choices and lineIndex into refs', () => {
    const items = buildWalkSet(REFS, get, { ...base, rng: rngFor('walk-a') });
    expect(items.length).toBeGreaterThanOrEqual(WALK_TARGET);
    expect(items.length).toBeLessThanOrEqual(WALK_MAX);
    expect(items.length).toBe(Math.min(REFS.length, WALK_MAX));
    expect(items.some((i) => i.kind === 'gist')).toBe(false);
    items.forEach((it, k) => {
      expect(it.kind).toBe(k % 2 === 1 ? 'dictation' : 'choice');
      if (it.kind === 'gist') return;
      expect(it.lineIndex).toBeGreaterThanOrEqual(0);
      expect(it.lineIndex).toBeLessThan(REFS.length);
      if (it.kind === 'choice') {
        expect(it.choices).toHaveLength(4);
        expect(new Set(it.choices).size).toBe(4);
        expect(it.ja).toBe(false);
        expect(it.choices[it.answer]).toBe(resolveRef(REFS[it.lineIndex] as PoolRef, get)?.en);
      }
    });
    // every ref is heard once at most
    const used = items.map((i) => (i.kind === 'gist' ? -1 : i.lineIndex));
    expect(new Set(used).size).toBe(used.length);
    expect(heardLines(items)).toEqual([...new Set(used)].sort((a, b) => a - b));
  });

  it('fewer refs → fewer items; six refs give six', () => {
    expect(buildWalkSet(REFS.slice(0, 6), get, { ...base, rng: rngFor('six') })).toHaveLength(6);
    expect(buildWalkSet(REFS.slice(0, 3), get, { ...base, rng: rngFor('three') })).toHaveLength(3);
    expect(buildWalkSet([], get, { ...base, rng: rngFor('none') })).toEqual([]);
  });

  it('i+1 refs take the dictation slots first (their one unknown word earns the listen evidence)', () => {
    const items = buildWalkSet(REFS, get, { ...base, rng: rngFor('walk-b') });
    const plusCount = REFS.filter((r) => plusOneId(r, KNOWN_BUT_NOMU) !== null).length;
    expect(plusCount).toBe(4);
    const dictations = items.filter((i): i is Extract<ListenItem, { kind: 'dictation' }> => i.kind === 'dictation');
    expect(dictations).toHaveLength(4);
    for (const d of dictations) expect(plusOneId(REFS[d.lineIndex] as PoolRef, KNOWN_BUT_NOMU)).toBe(V.飲む);
    // with everything known there is nothing to prefer, and the set still alternates
    const flat = buildWalkSet(REFS, get, { ...base, known: ALL_IDS, rng: rngFor('walk-b') });
    flat.forEach((it, k) => expect(it.kind).toBe(k % 2 === 1 ? 'dictation' : 'choice'));
  });

  it('from Green the choice items carry the Japanese sentence itself', () => {
    const items = buildWalkSet(REFS, get, { ...base, station: 16, rng: rngFor('green') });
    const choice = items.find((i): i is Extract<ListenItem, { kind: 'choice' }> => i.kind === 'choice');
    expect(choice?.ja).toBe(true);
    expect(choice && choice.choices[choice.answer]).toBe(resolveRef(REFS[choice?.lineIndex ?? 0] as PoolRef, get)?.ja);
  });

  it('a 30-mora ref with clauses yields a clause dictation; without clauses it becomes a choice item', () => {
    expect(LONG_REF.morae).toBeGreaterThan(DICTATION_MAX_MORAE);
    const refs = [REFS[2] as PoolRef, LONG_REF, REFS[5] as PoolRef];
    const known = new Set([...ALL_IDS]); // the long ref's own item is the one unknown → it is i+1 and takes the dictation slot
    const withClauses = buildWalkSet(refs, getWithLong, { station: 4, known, rng: rngFor('long'), clauses: (ref) => (ref === LONG_REF.ref ? [16, 22] : undefined) });
    expect(withClauses).toHaveLength(3);
    const dict = withClauses[1];
    expect(dict?.kind).toBe('dictation');
    if (dict?.kind === 'dictation') {
      expect(dict.lineIndex).toBe(1);
      expect(dict.clause).toBeDefined();
      const [s, e] = dict.clause as [number, number];
      expect([[0, 16], [16, 22], [22, 31]].some(([a, b]) => a === s && b === e)).toBe(true);
    }
    const without = buildWalkSet(refs, getWithLong, { station: 4, known, rng: rngFor('long') });
    expect(without[1]?.kind).toBe('choice');
    expect(without.every((i) => i.kind === 'choice')).toBe(true);
    // a clause list whose every clause is too long or too short leaves the ref a choice item too
    const useless = buildWalkSet(refs, getWithLong, { station: 4, known, rng: rngFor('long'), clauses: () => [2] });
    expect(useless[1]?.kind).toBe('choice');
  });

  it('is deterministic per rng and skips refs the content cannot resolve', () => {
    const a = buildWalkSet(REFS, get, { ...base, rng: rngFor('same') });
    const b = buildWalkSet(REFS, get, { ...base, rng: rngFor('same') });
    expect(a).toEqual(b);
    const c = buildWalkSet(REFS, get, { ...base, rng: rngFor('other') });
    expect(c).not.toEqual(a);
    const ghost: PoolRef = { ref: 'v-n5-0999#ex0', ids: ['v-n5-0999'], kana: 'なにか', morae: 3 };
    const items = buildWalkSet([ghost, ...REFS.slice(0, 5)], get, { ...base, rng: rngFor('ghost') });
    expect(items).toHaveLength(5);
    for (const it of items) {
      if (it.kind === 'gist') continue;
      expect(it.lineIndex).not.toBe(0);
      if (it.kind === 'choice') expect(it.choices).not.toContain('');
    }
  });
});
