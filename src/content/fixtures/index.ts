/**
 * TSUZUKU — in-memory fixture corpus (ARCHITECTURE §0/§3, module plan C).
 *
 * A tiny but complete corpus every group's tests run against, valid per
 * `docs/CONTENT_GUIDE.md`: 10 kana · 12 vocab (a set-phrase chunk, an
 * aizuchi chunk, a `pitchConfidence: 'high'` word, a loanword, a
 * `usually-kana` word, a dedupe gap at `v-n5-0009` with a redirect) ·
 * 4 kanji with 4 components · 3 grammar points · 1 story + 1 dialogue
 * (12 lines each, `tokens` + `tokenIds`) · 2 michikusa · a manifest with
 * station bundles for Stations 1 (White, kana) and 4 (Yellow, N5).
 *
 * `fixtures.test.ts` re-validates every item with `content/ruby.ts`
 * (V13 reconstruction, V19 token integrity, id grammar), so the data here
 * is written like real content files — `kana` strings by hand, not derived.
 *
 *  - `FIXTURE.files` holds every file body under its content path, so
 *    `fixtureFetch()` can serve the real `createLoader()` in tests.
 *  - `createFakeLoader()` is a synchronous in-memory `ContentLoader`: every
 *    item is `get()`-able without a `load()` call; `pool(n)` serves
 *    `Fixture.pools[n]` (design 08 §4) and rejects `missing-pool` otherwise —
 *    the shipped fixture holds no pools, so `manifest.totals.pool` is 0.
 *
 * In the real corpus the four components would land at Station 3 (one
 * station ahead of their first kanji); with only Stations 1 and 4 in the
 * fixture they ride in Station 4's `componentIds`.
 */
import { signal } from '@preact/signals';
import { kindOfId, stationOfId, type IdKind } from '../../shared/ids';
import { ContentError, isChunk, type ContentLoader, type CumulativeSets } from '../loader';
import type {
  ComponentDef,
  ConjugationGoldenEntry,
  ContentFile,
  ContentItem,
  ContentKind,
  ContentManifest,
  GrammarItem,
  KanaItem,
  KanjiItem,
  ListeningPool,
  ManifestFile,
  MichikusaItem,
  StationBundle,
  StoryItem,
  StoryLine,
  VocabItem,
} from '../types';

/* ────────────────────────────────────────────────────────────────────────── */
/* Ids                                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

/** Vocab ids by headword (readable fixture references). */
export const V = {
  私: 'v-n5-0001',
  犬: 'v-n5-0002',
  水: 'v-n5-0003',
  おはよう: 'v-n5-0004',
  はい: 'v-n5-0005',
  食べる: 'v-n5-0006',
  飲む: 'v-n5-0007',
  人: 'v-n5-0008',
  // v-n5-0009 was a duplicate dropped at merge time → `redirects['v-n5-0009'] = V.コーヒー`
  日: 'v-n5-0010',
  コーヒー: 'v-n5-0011',
  パン: 'v-n5-0012',
  おいしい: 'v-n5-0013',
} as const;

/** Grammar ids by pattern. */
export const G = { です: 'g-n5-001', は: 'g-n5-002', ます: 'g-n5-003' } as const;

export const FIXTURE_STORY_ID = 's-04-1';
export const FIXTURE_DIALOGUE_ID = 's-04-2';
/** The one vocab item that spawns a `pitch` card. */
export const FIXTURE_PITCH_HIGH_ID = V.飲む;
/** Set-phrase and aizuchi chunks (`ItemKind` `'chunk'`). */
export const FIXTURE_CHUNK_IDS: readonly string[] = [V.おはよう, V.はい];
/** Old id that `manifest.redirects` maps to `V.コーヒー`. */
export const FIXTURE_REDIRECT_FROM = 'v-n5-0009';

/* ────────────────────────────────────────────────────────────────────────── */
/* Kana (Station 1)                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

const kana = (
  id: string,
  glyph: string,
  romaji: string,
  row: KanaItem['row'],
  mnemonic: string,
  word: string,
  en: string,
  lookalikes?: string[],
): KanaItem => ({
  id,
  kana: glyph,
  romaji,
  script: 'hiragana',
  type: 'basic',
  row,
  mnemonic,
  exampleWord: { word, kana: word, en },
  ...(lookalikes ? { lookalikes } : {}),
  station: 1,
});

export const KANA: readonly KanaItem[] = [
  kana('k-h-a', 'あ', 'a', 'a', 'あ: an antenna on a roof with a loop of cable hanging off it — the first sound you shout, "ah!"', 'あめ', 'rain'),
  kana('k-h-i', 'い', 'i', 'a', 'い: two short strokes side by side like two icicles — "ee".', 'いぬ', 'dog'),
  kana('k-h-u', 'う', 'u', 'a', 'う: a face in profile with the lips pushed out, saying "ooh".', 'うみ', 'sea'),
  kana('k-h-e', 'え', 'e', 'a', 'え: an energetic runner dashing right, scarf trailing behind — "eh".', 'えき', 'station'),
  kana('k-h-o', 'お', 'o', 'a', 'お: a ball balanced on a bar with a dot flying off — "oh!"', 'おちゃ', 'tea'),
  kana('k-h-ka', 'か', 'ka', 'k', 'か: a katana swinging down, a chip flying off the blade.', 'かわ', 'river'),
  kana('k-h-ki', 'き', 'ki', 'k', 'き: a key with two teeth and a loop at the bottom.', 'きた', 'north'),
  kana('k-h-ne', 'ね', 'ne', 'n', 'ね: a neko (cat) sitting upright, its tail curled into a loop at the bottom right.', 'ねこ', 'cat', ['k-h-re', 'k-h-wa']),
  kana('k-h-re', 'れ', 're', 'r', 'れ: like ね, but the tail flicks out to the rear with no loop.', 'これ', 'this', ['k-h-ne', 'k-h-wa']),
  kana('k-h-wa', 'わ', 'wa', 'w', 'わ: like ね and れ, but the right side swings round in one wave, no loop and no flick.', 'わたし', 'I', ['k-h-ne', 'k-h-re']),
];

/* ────────────────────────────────────────────────────────────────────────── */
/* Vocab (Stations 1 and 4)                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

const ex = (ja: string, kana: string, en: string) => ({ ja, kana, en });

export const VOCAB: readonly VocabItem[] = [
  { id: V.私, word: '私', kana: 'わたし', meanings: ['I', 'me'], pos: 'pron', jlpt: 5, tags: ['people'], pitch: 0, pitchConfidence: 'low', examples: [ex('{私|わたし}はハナです。', 'わたしはハナです。', 'I am Hana.')], station: 1 },
  { id: V.犬, word: '犬', kana: 'いぬ', meanings: ['dog'], pos: 'n', jlpt: 5, tags: ['animals'], pitch: 2, pitchConfidence: 'low', examples: [ex('{犬|いぬ}が{水|みず}を{飲|の}みます。', 'いぬがみずをのみます。', 'The dog drinks water.')], station: 1 },
  { id: V.水, word: '水', kana: 'みず', meanings: ['water'], pos: 'n', jlpt: 5, tags: ['drink', 'nature'], pitch: 0, pitchConfidence: 'low', examples: [ex('{水|みず}をください。', 'みずをください。', 'Water, please.')], collocations: ['水を飲む'], station: 1 },
  { id: V.おはよう, word: 'おはよう', kana: 'おはよう', meanings: ['good morning'], pos: 'expr', jlpt: 5, tags: ['greetings', 'set-phrase', 'casual'], pitch: 0, pitchConfidence: 'low', examples: [ex('おはよう、ケン。', 'おはよう、ケン。', 'Morning, Ken.')], notes: 'Casual; add ございます with anyone you would use です/ます with.', station: 1 },
  { id: V.はい, word: 'はい', kana: 'はい', meanings: ['yes', '(backchannel: I hear you)'], pos: 'int', jlpt: 5, tags: ['communication', 'aizuchi'], pitch: 1, pitchConfidence: 'low', examples: [ex('はい、{私|わたし}です。', 'はい、わたしです。', 'Yes, it is me.')], station: 1 },
  { id: V.食べる, word: '食べる', kana: 'たべる', meanings: ['to eat'], pos: 'v1', jlpt: 5, tags: ['food', 'actions'], pitch: 2, pitchConfidence: 'low', trans: 'vt', examples: [ex('パンを{食|た}べます。', 'パンをたべます。', 'I eat bread.')], kanjiIds: ['j-食'], confusables: [V.飲む], collocations: ['ご飯を食べる'], station: 4 },
  { id: V.飲む, word: '飲む', kana: 'のむ', meanings: ['to drink'], pos: 'v5', jlpt: 5, tags: ['drink', 'actions'], pitch: 1, pitchConfidence: 'high', trans: 'vt', examples: [ex('{毎朝|まいあさ}コーヒーを{飲|の}みます。', 'まいあさコーヒーをのみます。', 'I drink coffee every morning.')], kanjiIds: ['j-飲'], confusables: [V.食べる], collocations: ['お茶を飲む', '薬を飲む'], station: 4 },
  { id: V.人, word: '人', kana: 'ひと', meanings: ['person'], pos: 'n', jlpt: 5, tags: ['people'], pitch: 2, pitchConfidence: 'low', examples: [ex('あの{人|ひと}はケンです。', 'あのひとはケンです。', 'That person is Ken.')], kanjiIds: ['j-人'], station: 4 },
  { id: V.日, word: '日', kana: 'ひ', meanings: ['day', 'sun'], pos: 'n', jlpt: 5, tags: ['time', 'nature'], pitch: 0, pitchConfidence: 'low', examples: [ex('いい{日|ひ}ですね。', 'いいひですね。', 'It is a nice day, isn\'t it?')], kanjiIds: ['j-日'], station: 4 },
  { id: V.コーヒー, word: 'コーヒー', kana: 'コーヒー', meanings: ['coffee'], pos: 'n', jlpt: 5, tags: ['drink', 'loanword'], pitch: 3, pitchConfidence: 'low', examples: [ex('コーヒーはおいしいです。', 'コーヒーはおいしいです。', 'Coffee is delicious.')], station: 4 },
  { id: V.パン, word: 'パン', kana: 'パン', meanings: ['bread'], pos: 'n', jlpt: 5, tags: ['food', 'loanword'], pitch: 1, pitchConfidence: 'low', examples: [ex('パンを{食|た}べますか。', 'パンをたべますか。', 'Will you have some bread?')], station: 4 },
  { id: V.おいしい, word: 'おいしい', kana: 'おいしい', meanings: ['delicious', 'tasty'], pos: 'adj-i', jlpt: 5, tags: ['food', 'states', 'usually-kana'], pitch: 0, pitchConfidence: 'low', examples: [ex('この{水|みず}はおいしいです。', 'このみずはおいしいです。', 'This water tastes good.')], altForms: ['美味しい'], station: 4 },
];

/* ────────────────────────────────────────────────────────────────────────── */
/* Components and kanji (Station 4)                                           */
/* ────────────────────────────────────────────────────────────────────────── */

export const COMPONENTS: readonly ComponentDef[] = [
  { id: 'c-eat', char: '食', name: 'eat', variants: ['飠'], hint: 'A lid over a bowl of rice on a stand.' },
  { id: 'c-yawn', char: '欠', name: 'yawn', hint: 'A person with the mouth wide open.' },
  { id: 'c-person', char: '人', name: 'person', variants: ['亻'], hint: 'Two legs mid-stride.' },
  { id: 'c-sun', char: '日', name: 'sun', hint: 'A window with one bar: the sun through a paper screen.' },
];

export const KANJI: readonly KanjiItem[] = [
  {
    id: 'j-食', char: '食', meanings: ['eat', 'food'], on: ['ショク'], kun: ['た.べる', 'く.う'], strokes: 9, jlpt: 5, components: ['eat'],
    mnemonic: 'A lid over a bowl of rice on its stand: the whole shape is one meal, so you EAT.',
    examples: [{ word: '食べる', kana: 'たべる', en: 'to eat' }, { word: '食べ物', kana: 'たべもの', en: 'food' }],
    station: 4,
  },
  {
    id: 'j-飲', char: '飲', meanings: ['drink'], on: ['イン'], kun: ['の.む'], strokes: 12, jlpt: 5, components: ['eat', 'yawn'],
    mnemonic: 'After you EAT, you open wide in a YAWN — but it is really a long, grateful DRINK.',
    examples: [{ word: '飲む', kana: 'のむ', en: 'to drink' }, { word: '飲み物', kana: 'のみもの', en: 'drink' }],
    station: 4,
  },
  {
    id: 'j-人', char: '人', meanings: ['person'], on: ['ジン', 'ニン'], kun: ['ひと'], strokes: 2, jlpt: 5, components: ['person'],
    mnemonic: 'Two strokes leaning on each other like legs mid-stride: a PERSON walking down the road.',
    examples: [{ word: '人', kana: 'ひと', en: 'person' }, { word: '日本人', kana: 'にほんじん', en: 'Japanese person' }],
    station: 4,
  },
  {
    id: 'j-日', char: '日', meanings: ['sun', 'day'], on: ['ニチ', 'ジツ'], kun: ['ひ', 'か'], strokes: 4, jlpt: 5, components: ['sun'],
    mnemonic: 'A window with one bar across it, the SUN seen through a paper screen at dawn.',
    examples: [{ word: '日', kana: 'ひ', en: 'day' }, { word: '毎日', kana: 'まいにち', en: 'every day' }],
    station: 4,
  },
];

/* ────────────────────────────────────────────────────────────────────────── */
/* Grammar (Station 4)                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

export const GRAMMAR: readonly GrammarItem[] = [
  {
    id: G.です, pattern: '〜です', meaning: 'is …', formation: ['N + です', 'な-adj + です', 'い-adj + です'],
    explanation: 'Put です after a noun or adjective to state what something is, politely. It does not change for person or number: 私はハナです, 犬です. It is the polite partner of だ, so you use it with strangers, shop staff and teachers. It is not a verb of existence; for "there is" you will use あります and います.',
    jlpt: 5, register: 'polite',
    examples: [ex('{私|わたし}はハナです。', 'わたしはハナです。', 'I am Hana.'), ex('これは{水|みず}です。', 'これはみずです。', 'This is water.'), ex('コーヒーはおいしいです。', 'コーヒーはおいしいです。', 'Coffee is delicious.')],
    clozeHints: ['です'], mistakes: ['× 学生ですです → ○ 学生です (one です per clause)'], related: [G.は], tags: ['communication'],
    station: 4,
  },
  {
    id: G.は, pattern: '〜は', meaning: 'as for … (topic marker)', formation: ['N + は + comment'],
    explanation: 'は marks what the sentence is about; everything after it is the comment. Use it to introduce yourself, to name what you are talking about, and to contrast two things. It is written は but read わ. It is not the subject marker が, which points at who or what does something.',
    jlpt: 5, register: 'neutral',
    examples: [ex('{犬|いぬ}は{水|みず}を{飲|の}みます。', 'いぬはみずをのみます。', 'The dog drinks water.'), ex('ケンはパンを{食|た}べます。', 'ケンはパンをたべます。', 'Ken eats bread.'), ex('コーヒーはおいしいですね。', 'コーヒーはおいしいですね。', 'Coffee is delicious, isn\'t it?')],
    clozeHints: ['は'], mistakes: ['× 私がハナです → ○ 私はハナです (introducing yourself takes は, not が)'], related: [G.です], tags: [],
    station: 4,
  },
  {
    id: G.ます, pattern: '〜ます', meaning: 'polite present or future …',
    formation: ['V-stem + ます', 'Group 1: 飲む → 飲みます', 'Group 2: 食べる → 食べます', 'Irregular: する → します · 来る → 来ます'],
    explanation: 'Attach ます to the verb stem to make the polite present. It covers habits and the future alike: 飲みます is "I drink" and "I will drink". Negative is ません, past is ました. You use it with anyone you would use です with; the plain forms come later on the road.',
    jlpt: 5, register: 'polite',
    examples: [ex('パンを{食|た}べます。', 'パンをたべます。', 'I eat bread.'), ex('{水|みず}を{飲|の}みます。', 'みずをのみます。', 'I drink water.'), ex('{人|ひと}がいます。', 'ひとがいます。', 'There is a person.')],
    clozeHints: ['ます'], mistakes: ['× 食べるます → ○ 食べます (ます attaches to the stem, not the dictionary form)'], related: [G.です], tags: ['actions'],
    unlocksForms: ['masu', 'masen', 'mashita'],
    station: 4,
  },
];

/* ────────────────────────────────────────────────────────────────────────── */
/* Story and dialogue (Station 4)                                             */
/* ────────────────────────────────────────────────────────────────────────── */

type LineExtra = Partial<Pick<StoryLine, 'speaker' | 'aizuchiSlot' | 'options' | 'accept' | 'mustInclude'>>;

const line = (ja: string, kana: string, en: string, tokens: string[], tokenIds: (string | null)[], extra: LineExtra = {}): StoryLine => ({
  ...extra,
  ja,
  kana,
  en,
  tokens,
  tokenIds,
});

export const STORY: StoryItem = {
  id: FIXTURE_STORY_ID,
  stationId: 'st-04',
  titleJa: '{水|みず}と{犬|いぬ}',
  titleEn: 'Water and a Dog',
  kind: 'story',
  register: 'polite',
  lines: [
    line('おはよう。', 'おはよう。', 'Good morning.', ['おはよう', '。'], [V.おはよう, null]),
    line('{私|わたし}はハナです。', 'わたしはハナです。', 'I am Hana.', ['私', 'は', 'ハナ', 'です', '。'], [V.私, G.は, null, G.です, null]),
    line('ケンもいます。', 'ケンもいます。', 'Ken is here too.', ['ケン', 'も', 'います', '。'], [null, null, null, null]),
    line('{私|わたし}はコーヒーを{飲|の}みます。', 'わたしはコーヒーをのみます。', 'I drink coffee.', ['私', 'は', 'コーヒー', 'を', '飲みます', '。'], [V.私, G.は, V.コーヒー, null, V.飲む, null]),
    line('コーヒーはおいしいです。', 'コーヒーはおいしいです。', 'The coffee is delicious.', ['コーヒー', 'は', 'おいしい', 'です', '。'], [V.コーヒー, G.は, V.おいしい, G.です, null]),
    line('ケンはパンを{食|た}べます。', 'ケンはパンをたべます。', 'Ken eats bread.', ['ケン', 'は', 'パン', 'を', '食べます', '。'], [null, G.は, V.パン, null, V.食べる, null]),
    line('パンもおいしいですね。', 'パンもおいしいですね。', 'The bread is delicious too, isn\'t it?', ['パン', 'も', 'おいしい', 'です', 'ね', '。'], [V.パン, null, V.おいしい, G.です, null, null]),
    line('{犬|いぬ}がいます。', 'いぬがいます。', 'There is a dog.', ['犬', 'が', 'います', '。'], [V.犬, null, null, null]),
    line('{犬|いぬ}は{水|みず}を{飲|の}みます。', 'いぬはみずをのみます。', 'The dog drinks water.', ['犬', 'は', '水', 'を', '飲みます', '。'], [V.犬, G.は, V.水, null, V.飲む, null]),
    line('{人|ひと}が{三人|さんにん}います。', 'ひとがさんにんいます。', 'There are three people.', ['人', 'が', '三人', 'います', '。'], [V.人, null, null, null, null]),
    line('はい、{私|わたし}も{水|みず}を{飲|の}みます。', 'はい、わたしもみずをのみます。', 'Yes, I drink water too.', ['はい', '、', '私', 'も', '水', 'を', '飲みます', '。'], [V.はい, null, V.私, null, V.水, null, V.飲む, null]),
    line('{人|ひと}と{犬|いぬ}の{日|ひ}です。', 'ひとといぬのひです。', 'It is a day of people and dogs.', ['人', 'と', '犬', 'の', '日', 'です', '。'], [V.人, null, V.犬, null, V.日, G.です, null]),
  ],
  vocabIds: [V.おはよう, V.私, V.コーヒー, V.飲む, V.おいしい, V.パン, V.食べる, V.犬, V.水, V.人, V.はい, V.日],
  grammarIds: [G.です, G.は, G.ます],
  comprehension: [
    { q: 'What does Hana drink?', choices: ['Water', 'Coffee', 'Tea', 'Milk'], answer: 1 },
    { q: 'Who eats bread?', choices: ['Hana', 'The dog', 'Ken', 'Nobody'], answer: 2 },
    { q: 'How many people are there?', choices: ['Three', 'One', 'Two', 'Four'], answer: 0 },
  ],
  recapEn: 'Hana greets the morning with Ken. She drinks coffee, Ken eats bread, and a dog turns up to drink water. Three people, one dog: a quiet first day on the road.',
  names: ['ハナ', 'ケン'],
};

const KEN = 'ケン';
const HANA = 'ハナ';

export const DIALOGUE: StoryItem = {
  id: FIXTURE_DIALOGUE_ID,
  stationId: 'st-04',
  titleJa: 'コーヒーとパン',
  titleEn: 'Coffee and Bread',
  kind: 'dialogue',
  register: 'polite',
  learnerSpeaker: HANA,
  lines: [
    line('おはよう、ハナ。', 'おはよう、ハナ。', 'Good morning, Hana.', ['おはよう', '、', 'ハナ', '。'], [V.おはよう, null, null, null], { speaker: KEN }),
    line('おはよう、ケン。', 'おはよう、ケン。', 'Good morning, Ken.', ['おはよう', '、', 'ケン', '。'], [V.おはよう, null, null, null], {
      speaker: HANA,
      options: [
        { text: 'おはよう、ケン。', kind: 'best' },
        { text: 'おはよう。', kind: 'ok', recast: 'おはよう、ケン。' },
        { text: 'おはようです、ケン。', kind: 'grammar-wrong', recast: 'おはよう、ケン。' },
      ],
      mustInclude: ['おはよう'],
      accept: ['おはようございます、ケン。'],
    }),
    line('コーヒーを{飲|の}みますか。', 'コーヒーをのみますか。', 'Will you have some coffee?', ['コーヒー', 'を', '飲みます', 'か', '。'], [V.コーヒー, null, V.飲む, null, null], { speaker: KEN }),
    line('はい、{飲|の}みます。', 'はい、のみます。', 'Yes, I will.', ['はい', '、', '飲みます', '。'], [V.はい, null, V.飲む, null], {
      speaker: HANA,
      options: [
        { text: 'はい、飲みます。', kind: 'best' },
        { text: 'はい。', kind: 'ok', recast: 'はい、飲みます。' },
        { text: 'はい、飲むます。', kind: 'grammar-wrong', recast: 'はい、飲みます。' },
      ],
      mustInclude: ['飲みます'],
      accept: ['はい、コーヒーを飲みます。'],
    }),
    line(
      '{私|わたし}はパンを{食|た}べます。ハナも{食|た}べますか。',
      'わたしはパンをたべます。ハナもたべますか。',
      'I am having bread. Will you have some too, Hana?',
      ['私', 'は', 'パン', 'を', '食べます', '。', 'ハナ', 'も', '食べます', 'か', '。'],
      [V.私, G.は, V.パン, null, V.食べる, null, null, null, V.食べる, null, null],
      { speaker: KEN, aizuchiSlot: true },
    ),
    line('はい、{私|わたし}もパンを{食|た}べます。', 'はい、わたしもパンをたべます。', 'Yes, I will have bread too.', ['はい', '、', '私', 'も', 'パン', 'を', '食べます', '。'], [V.はい, null, V.私, null, V.パン, null, V.食べる, null], {
      speaker: HANA,
      options: [
        { text: 'はい、私もパンを食べます。', kind: 'best' },
        { text: 'はい、食べます。', kind: 'ok', recast: 'はい、私もパンを食べます。' },
        { text: 'うん、食べる。', kind: 'register-wrong', recast: 'はい、私もパンを食べます。' },
      ],
      mustInclude: ['パン', '食べます'],
      accept: ['私も食べます。'],
    }),
    line('パンはおいしいですね。', 'パンはおいしいですね。', 'The bread is good, isn\'t it?', ['パン', 'は', 'おいしい', 'です', 'ね', '。'], [V.パン, G.は, V.おいしい, G.です, null, null], { speaker: KEN }),
    line('はい、おいしいです。', 'はい、おいしいです。', 'Yes, it is delicious.', ['はい', '、', 'おいしい', 'です', '。'], [V.はい, null, V.おいしい, G.です, null], {
      speaker: HANA,
      options: [
        { text: 'はい、おいしいです。', kind: 'best' },
        { text: 'おいしいですね。', kind: 'ok', recast: 'はい、おいしいです。' },
        { text: 'はい、おいしいだです。', kind: 'grammar-wrong', recast: 'はい、おいしいです。' },
      ],
      mustInclude: ['おいしい'],
      accept: ['とてもおいしいです。'],
    }),
    line('{犬|いぬ}がいますよ。', 'いぬがいますよ。', 'Look, there is a dog.', ['犬', 'が', 'います', 'よ', '。'], [V.犬, null, null, null, null], { speaker: KEN }),
    line('{犬|いぬ}は{水|みず}を{飲|の}みますか。', 'いぬはみずをのみますか。', 'Does the dog drink water?', ['犬', 'は', '水', 'を', '飲みます', 'か', '。'], [V.犬, G.は, V.水, null, V.飲む, null, null], {
      speaker: HANA,
      options: [
        { text: '犬は水を飲みますか。', kind: 'best' },
        { text: '水を飲みますか。', kind: 'ok', recast: '犬は水を飲みますか。' },
        { text: '犬を水は飲みますか。', kind: 'grammar-wrong', recast: '犬は水を飲みますか。' },
      ],
      mustInclude: ['犬', '水'],
      accept: ['この犬は水を飲みますか。'],
    }),
    line(
      'はい、{飲|の}みます。{人|ひと}も{犬|いぬ}も{水|みず}を{飲|の}みます。',
      'はい、のみます。ひともいぬもみずをのみます。',
      'Yes, it does. People and dogs both drink water.',
      ['はい', '、', '飲みます', '。', '人', 'も', '犬', 'も', '水', 'を', '飲みます', '。'],
      [V.はい, null, V.飲む, null, V.人, null, V.犬, null, V.水, null, V.飲む, null],
      { speaker: KEN, aizuchiSlot: true },
    ),
    line('{私|わたし}も{水|みず}を{飲|の}みます。', 'わたしもみずをのみます。', 'I will drink water too.', ['私', 'も', '水', 'を', '飲みます', '。'], [V.私, null, V.水, null, V.飲む, null], {
      speaker: HANA,
      options: [
        { text: '私も水を飲みます。', kind: 'best' },
        { text: '水を飲みます。', kind: 'ok', recast: '私も水を飲みます。' },
        { text: 'あたしも水、飲む。', kind: 'register-wrong', recast: '私も水を飲みます。' },
        { text: '私も水が飲みます。', kind: 'grammar-wrong', recast: '私も水を飲みます。' },
      ],
      mustInclude: ['水', '飲みます'],
      accept: ['私も飲みます。'],
    }),
  ],
  vocabIds: [V.おはよう, V.はい, V.コーヒー, V.飲む, V.私, V.パン, V.食べる, V.おいしい, V.犬, V.水, V.人],
  grammarIds: [G.です, G.は, G.ます],
  comprehension: [
    { q: 'What does Ken eat?', choices: ['Rice', 'Bread', 'Fish', 'Soup'], answer: 1 },
    { q: 'What does the dog drink?', choices: ['Coffee', 'Milk', 'Water', 'Tea'], answer: 2 },
    { q: 'Who greets first?', choices: ['Ken', 'Hana', 'The dog', 'Nobody'], answer: 0 },
  ],
  recapEn: 'Ken and Hana share a morning: coffee, bread and a stray dog that stops to drink water. Hana decides she will drink water too.',
  names: [HANA, KEN],
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Michikusa (Station 4)                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export const MICHIKUSA: readonly MichikusaItem[] = [
  {
    id: 'm-04-1', stationId: 'st-04', kind: 'road-history', titleEn: 'The long hill at Hodogaya',
    bodyEn: 'Hodogaya was the fourth post town on the Tōkaidō and the first where travelers from Edo met a real climb. The Gontazaka slope west of the inn district was steep enough that porters waited at its foot, and woodblock prints show travelers pausing to look back toward the bay.',
    sourceNote: 'Hiroshige, Fifty-three Stations of the Tōkaidō (Hōeidō edition, 1833–34)',
  },
  {
    id: 'm-04-2', stationId: 'st-04', kind: 'proverb', titleEn: 'Dumplings over flowers',
    bodyEn: 'The proverb 花より団子 says people prefer something useful, a dumpling, to something merely pretty, like cherry blossoms. It is said with a smile about anyone who heads straight for the food stalls at a blossom viewing.',
    ja: '{花|はな}より{団子|だんご}',
    kana: 'はなよりだんご',
  },
];

/* ────────────────────────────────────────────────────────────────────────── */
/* Conjugation golden rows (not exposed by the loader; here for engine tests) */
/* ────────────────────────────────────────────────────────────────────────── */

export const CONJUGATION: readonly ConjugationGoldenEntry[] = [
  { id: 'cj-0001', word: '行く', kana: 'いく', pos: 'v5', form: 'te', answer: '行って', answerKana: 'いって' },
  { id: 'cj-0002', word: '食べる', kana: 'たべる', pos: 'v1', form: 'masu', answer: '食べます', answerKana: 'たべます' },
  { id: 'cj-0003', word: '飲む', kana: 'のむ', pos: 'v5', form: 'te', answer: '飲んで', answerKana: 'のんで' },
  { id: 'cj-0004', word: 'する', kana: 'する', pos: 'v-irr', form: 'te', answer: 'して', answerKana: 'して' },
  { id: 'cj-0005', word: '高い', kana: 'たかい', pos: 'adj-i', form: 'adj-neg', answer: '高くない', answerKana: 'たかくない' },
  { id: 'cj-0006', word: '静か', kana: 'しずか', pos: 'adj-na', form: 'adj-neg', answer: '静かじゃない', answerKana: 'しずかじゃない', alt: ['静かではない'] },
];

/* ────────────────────────────────────────────────────────────────────────── */
/* Files, bundles, manifest                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export const PATHS = {
  manifest: 'manifest.json',
  hiragana: 'kana/hiragana.json',
  vocab1: 'vocab/n5/vocab-n5-001.json',
  vocab2: 'vocab/n5/vocab-n5-002.json',
  kanji: 'kanji/n5/kanji-n5-001.json',
  grammar: 'grammar/n5/grammar-n5-001.json',
  stories: 'stories/n5/stories-s04.json',
  michikusa: 'michikusa/michikusa-s04.json',
  components: '_meta/components.json',
  conjugation: 'conjugation/conjugation-001.json',
  station1: 'stations/01.json',
  station4: 'stations/04.json',
} as const;

const GENERATED_AT = '2026-10-17T00:00:00Z';
export const FIXTURE_CONTENT_VERSION = '2026.10.0-fixture';

function file<T>(type: ContentKind, items: readonly T[], level?: ContentFile<T>['level']): ContentFile<T> {
  return { schema: 'tsuzuku.content/1', type, ...(level ? { level } : {}), writer: `fixture-${type}`, generatedAt: GENERATED_AT, items: [...items] };
}

const STATION_1_VOCAB = VOCAB.filter((v) => v.station === 1);
const STATION_4_VOCAB = VOCAB.filter((v) => v.station === 4);

const ITEM_FILES: Record<string, ContentFile<ContentItem>> = {
  [PATHS.hiragana]: file<ContentItem>('kana', KANA, 'kana'),
  [PATHS.vocab1]: file<ContentItem>('vocab', STATION_1_VOCAB, 'n5'),
  [PATHS.vocab2]: file<ContentItem>('vocab', STATION_4_VOCAB, 'n5'),
  [PATHS.kanji]: file<ContentItem>('kanji', KANJI, 'n5'),
  [PATHS.grammar]: file<ContentItem>('grammar', GRAMMAR, 'n5'),
  [PATHS.stories]: file<ContentItem>('story', [STORY, DIALOGUE], 'n5'),
  [PATHS.michikusa]: file<ContentItem>('michikusa', MICHIKUSA),
  [PATHS.components]: file<ContentItem>('component', COMPONENTS),
};

const CONJUGATION_FILE: ContentFile<ConjugationGoldenEntry> = file('conjugation', CONJUGATION);

/** `surfaces` of a bundle: word / kana / altForm → id for every vocab item at a station `<= n`. */
function surfacesUpTo(n: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of VOCAB) {
    if ((v.station ?? 0) > n) continue;
    out[v.word] = v.id;
    out[v.kana] = v.id;
    for (const alt of v.altForms ?? []) out[alt] = v.id;
  }
  return out;
}

export const STATION_1: StationBundle = {
  schema: 'tsuzuku.station/1',
  number: 1,
  kanaIds: KANA.map((k) => k.id),
  vocabIds: STATION_1_VOCAB.map((v) => v.id),
  kanjiIds: [],
  grammarIds: [],
  componentIds: [],
  storyIds: [],
  michikusaIds: [],
  files: [PATHS.hiragana, PATHS.vocab1],
  surfaces: surfacesUpTo(1),
};

export const STATION_4: StationBundle = {
  schema: 'tsuzuku.station/1',
  number: 4,
  kanaIds: [],
  vocabIds: STATION_4_VOCAB.map((v) => v.id),
  kanjiIds: KANJI.map((k) => k.id),
  grammarIds: GRAMMAR.map((g) => g.id),
  componentIds: COMPONENTS.map((c) => c.id),
  storyIds: [STORY.id, DIALOGUE.id],
  michikusaIds: MICHIKUSA.map((m) => m.id),
  files: [PATHS.vocab2, PATHS.kanji, PATHS.grammar, PATHS.stories, PATHS.michikusa, PATHS.components],
  surfaces: surfacesUpTo(4),
};

/** 64 hex chars from FNV-1a over the JSON text — stands in for the real sha256 the index script writes. */
function pseudoSha256(text: string): string {
  let out = '';
  for (let round = 0; round < 8; round++) {
    let h = (0x811c9dc5 ^ round) >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, '0');
  }
  return out;
}

function manifestFile(path: string, type: ContentKind, level: ManifestFile['level'], count: number, body: unknown, belts: ManifestFile['belts'], stations: number[]): ManifestFile {
  const text = JSON.stringify(body);
  return { path, type, level, count, bytes: text.length, sha256: pseudoSha256(text), belts, stations };
}

export const MANIFEST: ContentManifest = {
  schema: 'tsuzuku.manifest/1',
  contentVersion: FIXTURE_CONTENT_VERSION,
  generatedAt: GENERATED_AT,
  files: [
    manifestFile(PATHS.hiragana, 'kana', 'kana', KANA.length, ITEM_FILES[PATHS.hiragana], ['white'], [1]),
    manifestFile(PATHS.vocab1, 'vocab', 'n5', STATION_1_VOCAB.length, ITEM_FILES[PATHS.vocab1], ['white'], [1]),
    manifestFile(PATHS.vocab2, 'vocab', 'n5', STATION_4_VOCAB.length, ITEM_FILES[PATHS.vocab2], ['yellow'], [4]),
    manifestFile(PATHS.kanji, 'kanji', 'n5', KANJI.length, ITEM_FILES[PATHS.kanji], ['yellow'], [4]),
    manifestFile(PATHS.grammar, 'grammar', 'n5', GRAMMAR.length, ITEM_FILES[PATHS.grammar], ['yellow'], [4]),
    manifestFile(PATHS.stories, 'story', 'n5', 2, ITEM_FILES[PATHS.stories], ['yellow'], [4]),
    manifestFile(PATHS.michikusa, 'michikusa', null, MICHIKUSA.length, ITEM_FILES[PATHS.michikusa], ['yellow'], [4]),
    manifestFile(PATHS.components, 'component', null, COMPONENTS.length, ITEM_FILES[PATHS.components], ['yellow'], [4]),
    manifestFile(PATHS.conjugation, 'conjugation', null, CONJUGATION.length, CONJUGATION_FILE, [], []),
  ],
  stations: [
    { number: 1, path: PATHS.station1, counts: { kana: KANA.length, vocab: STATION_1_VOCAB.length, kanji: 0, grammar: 0, story: 0, michikusa: 0 } },
    { number: 4, path: PATHS.station4, counts: { kana: 0, vocab: STATION_4_VOCAB.length, kanji: KANJI.length, grammar: GRAMMAR.length, story: 2, michikusa: MICHIKUSA.length } },
  ],
  totals: {
    kana: KANA.length,
    vocab: VOCAB.length,
    kanji: KANJI.length,
    grammar: GRAMMAR.length,
    story: 2,
    conjugation: CONJUGATION.length,
    component: COMPONENTS.length,
    michikusa: MICHIKUSA.length,
    station: 2,
    pool: 0,
  },
  componentsPath: PATHS.components,
  redirects: { [FIXTURE_REDIRECT_FROM]: V.コーヒー },
};

/* ────────────────────────────────────────────────────────────────────────── */
/* FIXTURE                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export interface Fixture {
  manifest: ContentManifest;
  stations: StationBundle[];
  /** Every `ContentItem` by id (components included; stations and conjugation rows are not items). */
  items: Record<string, ContentItem>;
  components: ComponentDef[];
  conjugation: ConjugationGoldenEntry[];
  /** Every file body under its content path (manifest, bundles, item files, conjugation). */
  files: Record<string, unknown>;
  /** Listening pools by station (design 08 §4), served by `createFakeLoader().pool(n)`; absent = `missing-pool` for every station. */
  pools?: Record<number, ListeningPool>;
}

const ALL_ITEMS: readonly ContentItem[] = [...KANA, ...VOCAB, ...KANJI, ...GRAMMAR, STORY, DIALOGUE, ...MICHIKUSA, ...COMPONENTS];

export const FIXTURE: Fixture = {
  manifest: MANIFEST,
  stations: [STATION_1, STATION_4],
  items: Object.fromEntries(ALL_ITEMS.map((it) => [it.id, it])),
  components: [...COMPONENTS],
  conjugation: [...CONJUGATION],
  files: {
    ...ITEM_FILES,
    [PATHS.conjugation]: CONJUGATION_FILE,
    [PATHS.station1]: STATION_1,
    [PATHS.station4]: STATION_4,
    [PATHS.manifest]: MANIFEST,
  },
};

/** Ids by kind, for tests that need "some vocab id" without hardcoding one. */
export const FIXTURE_IDS = {
  kana: KANA.map((k) => k.id),
  vocab: VOCAB.map((v) => v.id),
  kanji: KANJI.map((k) => k.id),
  grammar: GRAMMAR.map((g) => g.id),
  story: [STORY.id, DIALOGUE.id],
  michikusa: MICHIKUSA.map((m) => m.id),
  component: COMPONENTS.map((c) => c.id),
} as const;

/* ────────────────────────────────────────────────────────────────────────── */
/* fixtureFetch — serves FIXTURE.files to the real loader                     */
/* ────────────────────────────────────────────────────────────────────────── */

export interface FixtureFetch {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /** Content paths requested so far, in order (404s included). */
  calls: string[];
}

export interface FixtureFetchOptions {
  /** Content paths that answer 404 (to test error handling). */
  missing?: readonly string[];
  /** Paths whose body is served as broken JSON. */
  corrupt?: readonly string[];
}

/**
 * A `fetch` over the fixture: any URL ending in a known content path serves
 * that file's JSON; anything else is a 404. `calls` records each path.
 */
export function fixtureFetch(f: Fixture = FIXTURE, opts: FixtureFetchOptions = {}): FixtureFetch {
  const paths = Object.keys(f.files).sort((a, b) => b.length - a.length);
  const missing = new Set(opts.missing ?? []);
  const corrupt = new Set(opts.corrupt ?? []);
  const fn = (async (input: RequestInfo | URL): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = raw.split(/[?#]/)[0] ?? raw;
    const path = paths.find((p) => url === p || url.endsWith(`/${p}`));
    fn.calls.push(path ?? url);
    if (!path || missing.has(path)) return new Response('not found', { status: 404, statusText: 'Not Found' });
    const body = corrupt.has(path) ? '{ not json' : JSON.stringify(f.files[path]);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as FixtureFetch;
  fn.calls = [];
  return fn;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* createFakeLoader — synchronous in-memory ContentLoader                     */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * A `ContentLoader` over the fixture with everything already in memory:
 * `get()` works without `load()`, `station(n)` rejects with a
 * `ContentError('missing-station')` for a station the fixture lacks,
 * `cumulative(n)` unions the bundles `<= n` exactly like the real loader, and
 * `pool(n)` (design 08 §4) serves `f.pools?.[n]` or rejects
 * `ContentError('missing-pool')` with the conventional path, like the real
 * loader does when the manifest lists no pool for `n`.
 */
export function createFakeLoader(f: Fixture = FIXTURE): ContentLoader {
  const bundles = new Map(f.stations.map((b) => [b.number, b]));
  const stationHint = new Map<string, number>();
  for (const b of f.stations) {
    for (const id of [...b.kanaIds, ...b.vocabIds, ...b.kanjiIds, ...b.grammarIds, ...b.componentIds, ...b.storyIds, ...b.michikusaIds]) stationHint.set(id, b.number);
  }

  const resolveId = (id: string): string => {
    let cur = id;
    for (let hops = 0; hops < 16; hops++) {
      const next = f.manifest.redirects[cur];
      if (next === undefined || next === cur) break;
      cur = next;
    }
    return cur;
  };

  const get = <T extends ContentItem = ContentItem>(id: string): T | undefined => f.items[resolveId(id)] as T | undefined;

  const station = (n: number): Promise<StationBundle> => {
    const b = bundles.get(n);
    return b ? Promise.resolve(b) : Promise.reject(new ContentError('missing-station', `stations/${String(n).padStart(2, '0')}.json`, `fixture: station ${n} is not in the fixture`));
  };

  const pool = (n: number): Promise<ListeningPool> => {
    const p = f.pools?.[n];
    return p ? Promise.resolve(p) : Promise.reject(new ContentError('missing-pool', `listening/pool-${String(n).padStart(2, '0')}.json`, `fixture: station ${n} has no listening pool in the fixture`));
  };

  const cumulative = async (n: number): Promise<CumulativeSets> => {
    const out: CumulativeSets = { kanaIds: new Set(), vocabIds: new Set(), kanjiIds: new Set(), grammarIds: new Set() };
    for (const b of f.stations) {
      if (b.number > n) continue;
      for (const id of b.kanaIds) out.kanaIds.add(id);
      for (const id of b.vocabIds) out.vocabIds.add(id);
      for (const id of b.kanjiIds) out.kanjiIds.add(id);
      for (const id of b.grammarIds) out.grammarIds.add(id);
    }
    return out;
  };

  return {
    manifest: () => Promise.resolve(f.manifest),
    station,
    cumulative,
    load: () => Promise.resolve(),
    preloadStation: async (n) => {
      await station(n);
    },
    prefetchStation: () => undefined,
    get,
    getAsync: (id) => Promise.resolve(get(id)),
    components: () => Promise.resolve(new Map(f.components.map((c) => [c.id, c]))),
    resolveId,
    stationOf: (id) => {
      const rid = resolveId(id);
      const fromId = stationOfId(rid);
      if (fromId !== undefined) return fromId;
      const item = f.items[rid];
      if (item && 'station' in item && typeof item.station === 'number') return item.station;
      return stationHint.get(rid);
    },
    kindOf: (id): IdKind => {
      const rid = resolveId(id);
      const kind = kindOfId(rid);
      const item = f.items[rid];
      return kind === 'vocab' && item && isChunk(item) ? 'chunk' : kind;
    },
    version: signal<string | null>(f.manifest.contentVersion),
    pool,
  };
}
