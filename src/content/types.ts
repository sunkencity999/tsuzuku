/**
 * TSUZUKU (つづく) — content types.
 *
 * Single source of truth for every JSON content file under `public/content/**`
 * and for the small runtime curriculum constants (BELTS, STATIONS).
 * The validator (`scripts/validate-content.ts`), the station assigner
 * (`scripts/assign-stations.ts`), the writer packets and the app all read
 * from these shapes. Rules enforced by the validator are listed with their
 * ids (V01…V46) in `docs/CONTENT_GUIDE.md`; JSDoc below cites them.
 *
 * Design intent for parallel AI writers:
 *  - flat objects, string-union enums, no nested optional mazes;
 *  - every required field is obviously fillable from a dictionary + a sentence;
 *  - optional fields are omitted, never `null`;
 *  - heavy content lives in JSON, this file holds types + tiny constants.
 *
 * ID CONVENTIONS (V04/V05)
 * ─────────────────────────────────────────────────────────────────────────────
 *  kana        k-h-a        k-k-shi     `k-<h|k>-<ime-romaji>`   (h = hiragana, k = katakana)
 *  vocab       v-n5-0001                `v-n<5..1>-<4 digits>`   level + 4-digit sequence
 *  kanji       j-食                      `j-<char>`               the character itself is the key
 *  grammar     g-n5-001                 `g-n<5..1>-<3 digits>`
 *  story       s-07-1                   `s-<station 01..53>-<1..9>`
 *  conjugation cj-0001                  `cj-<4 digits>`          golden-table rows
 *  component   c-person                 `c-<canonical-name>`     kebab-case canonical component name
 *  michikusa   m-07-1                   `m-<station 01..53>-<1..4>`
 *  station     st-07                    `st-<01..53>`            (STATIONS below; `st-00` = Nihonbashi)
 *  pool        pool-07                  `pool-<station 01..53>`  generated listening pool (design 08 §4); not an item id
 *
 * Ids are immutable once shipped; renames go through `ContentManifest.redirects`.
 * Gaps in a sequence are allowed (dedupe may drop rows); an id is never reused.
 * Card keys in the learner's save are `${itemId}#${facet}`, e.g. `v-n5-0123#prod`.
 * This hyphen grammar is authoritative: wherever a design file still shows the
 * older colon form (`v:n5:0123`), this file and `docs/ARCHITECTURE.md` win.
 *
 * FURIGANA (RUBY) MARKUP (V11–V13)
 * ─────────────────────────────────────────────────────────────────────────────
 * Inside any `ja` string, kanji are wrapped as `{漢字|かんじ}`: base before the
 * pipe, kana reading after it. Okurigana stay outside: `{飲|の}みます`.
 * Every kanji in `ja` must be inside a ruby. Stripping rubies to their bases
 * yields the plain sentence; replacing each ruby with its reading must yield
 * the sibling `kana` field exactly. `kana` fields are kana-only (V10).
 */

/* ────────────────────────────────────────────────────────────────────────── */
/* Core unions                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

/** JLPT level as a number; 5 = N5 … 1 = N1. */
export type Jlpt = 5 | 4 | 3 | 2 | 1;

/** Curriculum level used in file paths and belt definitions. `dan` is the beyond-N1 hook. */
export const LEVELS = ['kana', 'n5', 'n4', 'n3', 'n2', 'n1', 'dan'] as const;
export type Level = (typeof LEVELS)[number];

/** Belt ids, in road order. */
export const BELT_IDS = ['white', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black'] as const;
export type Belt = (typeof BELT_IDS)[number];

/**
 * Content file kinds; also the first path segment of each content directory.
 * `pool` (design 08 §4–§5) is the generated listening pool `listening/pool-<NN>.json`
 * (`ListeningPool`, schema `tsuzuku.pool/1`): listed in the manifest like `stations/NN.json`,
 * never a `ContentFile`, never hand-written, skipped by the validator's walk.
 */
export const CONTENT_KINDS = [
  'kana',
  'vocab',
  'kanji',
  'grammar',
  'story',
  'conjugation',
  'component',
  'michikusa',
  'station',
  'pool',
] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

/**
 * SRS facets (design 05 §2). One FSRS card per item × facet.
 *  rec    receptive meaning (vocab, kana, component)
 *  listen audio → meaning (vocab)
 *  prod   production: typing / speaking (vocab, kana, grammar, chunk)
 *  pitch  pitch-accent perception (high-confidence vocab only)
 *  read   kanji reading in context
 *  comp   kanji component assembly
 *  cloze  grammar pattern cloze
 */
export const FACETS = ['rec', 'listen', 'prod', 'pitch', 'read', 'comp', 'cloze'] as const;
export type Facet = (typeof FACETS)[number];
export type CardKey = `${string}#${Facet}`;

/**
 * Drill ids (design 04): every id here is registered by exactly one component
 * (26 by group D, 9 by group F) and may appear as `Step.exercise`.
 */
export const DRILL_IDS = [
  'kana-flash',
  'kana-ear',
  'kana-forge',
  'gojuon-fighter',
  'meaning-guard',
  'meaning-recall',
  'meaning-judge',
  'audio-flash',
  'production-forge',
  'pitch-ear',
  'component-flash',
  'component-assembly',
  'kanji-read',
  'lookalike-duel',
  'kanji-write',
  'pattern-cloze',
  'particle-duel',
  'form-forge',
  'form-chain',
  'transform',
  'scramble',
  'judgment-call',
  'sentence-listen',
  'listening-set',
  'minimal-pair',
  'shadow',
  'say-three-ways',
  'monologue',
  'story-read',
  'speed-read',
  'role-play',
  'rapid-fire',
  'nemesis-duel',
  'writing-dojo',
  'field-mission',
] as const;
export type DrillId = (typeof DRILL_IDS)[number];

/**
 * Composite runners (design 03/04): session shapes the SessionRunner (group E)
 * builds out of drills. They are never registered as exercises and never
 * appear as `Step.exercise`; they are routes / `SessionMode`s.
 */
export const RUNNER_IDS = ['weak-point-set', 'gatekeeper', 'shinsa', 'kage'] as const;
export type RunnerId = (typeof RUNNER_IDS)[number];

/** Drill ids + runner ids (39). Use `DrillId` for anything a registry or a Step touches. */
export const EXERCISE_IDS = [...DRILL_IDS, ...RUNNER_IDS] as const;
export type ExerciseId = (typeof EXERCISE_IDS)[number];

/** Error tags attached to graded attempts (design 05 §7). */
export const ERROR_TAGS = [
  'particle',
  'conjugation',
  'vowel-length',
  'voicing',
  'small-kana',
  'kanji-reading',
  'kanji-meaning',
  'word-choice',
  'register',
  'word-order',
  'pitch',
  'transcription',
  'aizuchi',
  'listening',
] as const;
export type ErrorTag = (typeof ERROR_TAGS)[number];

/**
 * Register tags. `neutral` is the default and is never written as a tag.
 * Used in `VocabItem.tags`, `GrammarItem.register`, `StoryItem.register`.
 */
export const REGISTER_TAGS = [
  'neutral',
  'polite',
  'casual',
  'formal',
  'written',
  'honorific',
  'humble',
  'slang',
  'dialect',
  'literary',
] as const;
export type RegisterTag = (typeof REGISTER_TAGS)[number];

/** Semantic-domain tags (V07). Pick 1–3 per vocab item. Full definitions in CONTENT_GUIDE.md §7. */
export const DOMAIN_TAGS = [
  'people',
  'family',
  'body',
  'health',
  'food',
  'drink',
  'cooking',
  'clothing',
  'home',
  'objects',
  'school',
  'study',
  'work',
  'business',
  'money',
  'shopping',
  'travel',
  'transport',
  'places',
  'city',
  'nature',
  'weather',
  'animals',
  'plants',
  'time',
  'calendar',
  'numbers',
  'quantity',
  'position',
  'colors',
  'shapes',
  'emotions',
  'personality',
  'communication',
  'language',
  'media',
  'technology',
  'arts',
  'music',
  'sports',
  'hobbies',
  'culture',
  'society',
  'politics',
  'law',
  'science',
  'abstract',
  'actions',
  'states',
  'greetings',
] as const;
export type DomainTag = (typeof DOMAIN_TAGS)[number];

/** Misc tags that change validator or exercise behavior (V07, V32). */
export const MISC_TAGS = [
  'homograph', //  same word+kana as another item with a disjoint meaning (V32 exemption)
  'usually-kana', //  the word is normally written in kana; `word` is kana
  'loanword', //  katakana loanword
  'onomatopoeia', //  giongo / gitaigo
  'set-phrase', //  fixed expression taught as a chunk (prod facet via shadow / role-play)
  'aizuchi', //  backchannel chunk (はい・ええ・なるほど …)
  'counter', //  counter word (〜つ・〜人・〜枚 …)
  'proper-noun', //  place or fictional-cast name allowed in stories
] as const;
export type MiscTag = (typeof MISC_TAGS)[number];

export type Tag = DomainTag | RegisterTag | MiscTag;

/**
 * Part of speech. Chosen so the conjugation engine can work from `pos` +
 * dictionary form alone: godan endings are read from the final kana.
 *  n        noun                         n-suru   noun that takes する (勉強)
 *  n-adv    adverbial noun (今日・毎朝)   pron     pronoun (私・これ)
 *  num      numeral                      counter  counter (〜枚)
 *  v1       ichidan verb (食べる)         v5       godan verb (飲む・行く)
 *  v-irr    irregular (する・来る)        adj-i    い-adjective (いい handled by engine)
 *  adj-na   な-adjective                  adv      adverb
 *  prt      particle                     conj     conjunction
 *  int      interjection                 expr     fixed expression / greeting
 *  pref     prefix (お〜)                 suf      suffix (〜さん)
 *  aux      auxiliary (です・そうだ)
 */
export const POS_VALUES = [
  'n',
  'n-suru',
  'n-adv',
  'pron',
  'num',
  'counter',
  'v1',
  'v5',
  'v-irr',
  'adj-i',
  'adj-na',
  'adv',
  'prt',
  'conj',
  'int',
  'expr',
  'pref',
  'suf',
  'aux',
] as const;
export type Pos = (typeof POS_VALUES)[number];

/** POS values the conjugation engine accepts. */
export type ConjugablePos = Extract<Pos, 'v1' | 'v5' | 'v-irr' | 'adj-i' | 'adj-na'>;

/**
 * Conjugation forms produced by `src/learn/conjugate.ts` and pinned by the golden table.
 * 20 verb forms + 6 adjective forms (adj-* apply to both い and な adjectives).
 */
export const CONJ_FORMS = [
  // verbs
  'masu',
  'masen',
  'mashita',
  'masen-deshita',
  'masho',
  'te',
  'nai',
  'ta',
  'nakatta',
  'potential',
  'volitional',
  'passive',
  'causative',
  'causative-passive',
  'imperative',
  'prohibitive',
  'ba',
  'tara',
  'tai',
  'te-iru',
  // adjectives
  'adj-neg',
  'adj-past',
  'adj-past-neg',
  'adj-te',
  'adj-adv',
  'adj-ba',
] as const;
export type ConjForm = (typeof CONJ_FORMS)[number];

/* ────────────────────────────────────────────────────────────────────────── */
/* Shared sub-objects (one level deep, never deeper)                          */
/* ────────────────────────────────────────────────────────────────────────── */

/** A full sentence: `ja` carries ruby markup, `kana` is the TTS text, `en` a natural translation. */
export interface SentenceExample {
  /** Japanese with ruby markup, e.g. `{私|わたし}は{毎朝|まいあさ}コーヒーを{飲|の}みます。` */
  ja: string;
  /** Kana-only reading of `ja` (katakana stays katakana), e.g. `わたしはまいあさコーヒーをのみます。` */
  kana: string;
  /** Natural modern English. */
  en: string;
}

/** A single word used as an example (kanji items, kana items). */
export interface WordExample {
  /** Plain word, no ruby, e.g. `食べ物`. */
  word: string;
  /** Kana reading, e.g. `たべもの`. */
  kana: string;
  /** Short gloss in house style, e.g. `food`. */
  en: string;
}

/** Comprehension question for stories (V21; listening fields V41). */
export interface ComprehensionQuestion {
  /** English through Station 15; Japanese (with ruby) allowed from Station 16. */
  q: string;
  /** Exactly four distinct choices. */
  choices: [string, string, string, string];
  /** Index into `choices`. */
  answer: 0 | 1 | 2 | 3;
  /** What the question tests (design 08 §5); the Arena asks `gist` first. `speaker` only in a dialogue (V41). */
  kind?: QuestionKind;
  /** Index into `lines` of the line that answers the question; a miss replays this line (design 08 §9). Must be a valid line index (V41). */
  lineRef?: number;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Listening pieces (design 08 §3, §5)                                        */
/* ────────────────────────────────────────────────────────────────────────── */

/** Genres of audio-first listening pieces (design 08 §3 belt table); `StoryItem.genre`. */
export const LISTENING_GENRES = [
  'exchange',
  'self-intro',
  'phone',
  'directions',
  'voicemail',
  'casual-talk',
  'narrative',
  'announcement',
  'weather',
  'interview',
  'news',
  'drama',
  'debate',
  'lecture',
  'essay',
] as const;
export type ListeningGenre = (typeof LISTENING_GENRES)[number];

/** First station at which a genre may appear (design 08 §3); V41 fails a piece placed earlier. */
export const GENRE_FROM_STATION: Record<ListeningGenre, number> = {
  exchange: 4,
  'self-intro': 4,
  phone: 8,
  directions: 10,
  voicemail: 10,
  'casual-talk': 10,
  narrative: 16,
  announcement: 16,
  weather: 16,
  interview: 25,
  news: 32,
  drama: 32,
  debate: 39,
  lecture: 39,
  essay: 47,
};

/** Genres whose pieces count as authentic-style listening for the 耳 cap (design 08 §12). */
export const AUTHENTIC_GENRES: ReadonlySet<ListeningGenre> = new Set<ListeningGenre>(['casual-talk', 'interview', 'news', 'drama', 'debate', 'lecture']);

/**
 * Authentic-style text (design 08 §12): a bridge text, an `AUTHENTIC_GENRES` piece, or a casual
 * dialogue (the 29 existing casual non-bridge dialogues from Station 10). Minutes on such texts —
 * a passed `listening:set` at ≥ 1.0× or a `listen:played` with the gist question right — feed
 * `stats.listeningAuthenticMinutes`.
 */
export const isAuthenticText = (s: Pick<StoryItem, 'bridge' | 'genre' | 'kind' | 'register'>): boolean =>
  !!s.bridge || (!!s.genre && AUTHENTIC_GENRES.has(s.genre)) || (s.kind === 'dialogue' && s.register === 'casual');

/** Voice style of one line (design 08 §5–§6); only changes the rendered voice, never the text. `StoryLine.emotion`. */
export const LINE_EMOTIONS = ['neutral', 'warm', 'annoyed', 'sad', 'glad', 'whisper'] as const;
export type LineEmotion = (typeof LINE_EMOTIONS)[number];

/** Comprehension question kinds (design 08 §5); `ComprehensionQuestion.kind`. */
export const QUESTION_KINDS = ['gist', 'detail', 'number', 'speaker', 'inference'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/* ────────────────────────────────────────────────────────────────────────── */
/* Kana                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export type KanaScript = 'hiragana' | 'katakana';
export type KanaType = 'basic' | 'dakuten' | 'handakuten' | 'yoon' | 'extended';
/** Gojūon row by consonant; `nn` = ん/ン; `ext` = extended katakana (ファ・ティ・ヴ …). */
export type KanaRow =
  | 'a' | 'k' | 'g' | 's' | 'z' | 't' | 'd' | 'n' | 'h' | 'b' | 'p'
  | 'm' | 'y' | 'r' | 'w' | 'nn' | 'ext';

/** One kana or digraph. 238 items in V1 (104 hiragana, 134 katakana). File: `kana/<script>.json`. */
export interface KanaItem {
  /** `k-h-a`, `k-k-shi`, `k-h-kya`, `k-k-fa`, `k-k-thi` (IME-safe romaji segment; see guide §3). */
  id: string;
  /** The character(s): `あ`, `きゃ`, `ファ`. */
  kana: string;
  /** Display romaji, modern Hepburn lowercase: `a`, `shi`, `kya`, `fa`, `ti`. */
  romaji: string;
  script: KanaScript;
  type: KanaType;
  row: KanaRow;
  /** ≤ 160 chars, one concrete visual image; no franchise references. */
  mnemonic: string;
  /** One real word that uses this kana (N5 word for hiragana, loanword for katakana). */
  exampleWord: WordExample;
  /** Ids of visually confusable kana for the Kana Ear grid (ね/れ/わ, シ/ツ, ソ/ン). */
  lookalikes?: string[];
  /** Station 1–3; set by `assign-stations.ts`, writers omit. */
  station?: number;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Vocabulary                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

/** One vocabulary item. ~6,350 in V1. File: `vocab/<level>/vocab-<level>-<NNN>.json`, ≤ 150 items. */
export interface VocabItem {
  /** `v-n5-0001` — level segment must equal `jlpt` (V05). */
  id: string;
  /** Dictionary form with its usual kanji (plain, no ruby): `食べる`. Kana if `usually-kana`. */
  word: string;
  /** Kana-only reading: `たべる` (katakana for loanwords: `コーヒー`). */
  kana: string;
  /** Optional Hepburn romaji; the app never shows it, the validator ignores it. */
  romaji?: string;
  /** 1–4 glosses in house style, most frequent first: `["to eat"]`. */
  meanings: string[];
  pos: Pos;
  jlpt: Jlpt;
  /** 1–3 domain tags + register tags (omit `neutral`) + misc tags. */
  tags: Tag[];
  /** Pitch-accent nucleus: 0 = heiban, n = drop after mora n. Integer in [0, mora count]. */
  pitch?: number;
  /**
   * Required when `pitch` is present. Only `high` spawns a pitch card. Writers always emit
   * `low` (V18 warns on a writer-set `high`); a post-pass script upgrades to `high` only
   * where the value matches a licensed pitch dataset.
   */
  pitchConfidence?: 'high' | 'low';
  /** ≥ 1 example sentence containing the word (V14, V16). Exactly 1 in Pass 1; ≥ 2 by release (Pass 3 `vocab-examples-2`). */
  examples: SentenceExample[];
  /**
   * Japanese definition for J-J mode (design 04 §2, 05 §13). Ruby rules apply to `ja`;
   * ≤ 45 chars; every content word must be in the cumulative allowlist ≤ the item's station;
   * the target word itself is absent. Required for `jlpt ≤ 3` by release (Pass 3 `jj-definitions`, V36).
   */
  definitionJa?: { ja: string; kana: string };
  /** General-corpus frequency rank (1 = most frequent); `assign-stations` orders items by it within a level when present. */
  frequencyRank?: number;
  /** ≤ 200 chars: nuance, false friend, collocation note. */
  notes?: string;
  /** Kanji ids for every kanji in `word`: `["j-食"]`. Added by the linker if omitted. */
  kanjiIds?: string[];
  /** Accepted alternative spellings (`解る` for 分かる, `ケイタイ` for 携帯). */
  altForms?: string[];
  /** 1–3 common collocations shown after answering, plain Japanese. */
  collocations?: string[];
  /** Transitivity for verbs. */
  trans?: 'vt' | 'vi';
  /** Transitive/intransitive partner vocab id. */
  pairId?: string;
  /** Vocab ids of easily confused words (Judge card distractors). */
  confusables?: string[];
  /** Station 1–53; set by `assign-stations.ts`, writers omit. */
  station?: number;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Kanji and components                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

/** A canonical kanji component. File: `_meta/components.json`. Names are the vocabulary mnemonics must use (V17). */
export interface ComponentDef {
  /** `c-person` — kebab-case of `name`. */
  id: string;
  /** Representative glyph: `人`. */
  char: string;
  /** Canonical English name, lowercase: `person`. */
  name: string;
  /** Variant glyphs that count as the same component: `["亻"]`. */
  variants?: string[];
  /** Short visual hint for the component flash card, ≤ 80 chars. */
  hint?: string;
}

/** One kanji. ~1,000 in V1 (N5→N2). File: `kanji/<level>/kanji-<level>-<NNN>.json`. */
export interface KanjiItem {
  /** `j-食` — must equal `j-` + `char` (V05). */
  id: string;
  char: string;
  /** 1–3 glosses, most central first: `["eat", "food"]`. */
  meanings: string[];
  /** On-readings in katakana: `["ショク", "ジキ"]`. May be empty for kun-only kanji. */
  on: string[];
  /** Kun-readings in hiragana, okurigana after a dot: `["た.べる", "く.う"]`. May be empty. */
  kun: string[];
  /** Stroke count, 1–30. */
  strokes: number;
  jlpt: Jlpt;
  /** 1–5 canonical component names from `_meta/components.json`: `["eat", "person"]`. */
  components: string[];
  /** ≤ 280 chars; one concrete scene; must mention every entry of `components` verbatim (V17). */
  mnemonic: string;
  /** ≥ 2 real words using this kanji; the first should use the primary reading (V14). */
  examples: WordExample[];
  /** Traditional radical glyph if different from the first component. */
  radical?: string;
  /** Kanji ids of look-alikes (未/末, 微/徴) for Lookalike Duel. */
  lookalikes?: string[];
  /** Station 4–46; set by `assign-stations.ts`, writers omit. */
  station?: number;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Grammar                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/** One grammar point. ~450 in V1. File: `grammar/<level>/grammar-<level>-<NNN>.json`. */
export interface GrammarItem {
  /** `g-n5-001` — level segment must equal `jlpt` (V05). */
  id: string;
  /** Display pattern with 〜 and slot letters: `〜てください`, `Vた + ことがある`. */
  pattern: string;
  /** One-line English meaning: `please do …`. */
  meaning: string;
  /** 1–6 formation lines: `["V-て + ください", "Group 1: 書く → 書いて"]`. */
  formation: string[];
  /** ≤ 120 words, plain English, pattern-first, addresses the learner as "you". */
  explanation: string;
  jlpt: Jlpt;
  /** Register this pattern belongs to; `neutral` when it works everywhere. */
  register: RegisterTag;
  /** ≥ 3 example sentences (V14); each must contain a `clozeHints` substring (V16). */
  examples: SentenceExample[];
  /** Substrings the cloze exercise blanks out, plain (no ruby): `["てください"]`. ≥ 1. */
  clozeHints: string[];
  /**
   * 0–3 common learner mistakes, ≤ 160 chars each, in the machine-parseable form
   * `× <wrong> → ○ <right> (<why>)` (V14 checks the format) so Judgment Call can mine them.
   */
  mistakes: string[];
  /** Grammar ids of contrasting or prerequisite points; no self-reference (V23). */
  related: string[];
  /** Domain / register / misc tags; may be empty. */
  tags: Tag[];
  notes?: string;
  /** Forms the Form Forge may drill once this point is learned. */
  unlocksForms?: ConjForm[];
  /** Station 4–53; set by `assign-stations.ts`, writers omit. */
  station?: number;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Stories and dialogues (Pass 2)                                             */
/* ────────────────────────────────────────────────────────────────────────── */

export type StoryKind = 'story' | 'dialogue';

/** One line of a story or dialogue. */
export interface StoryLine {
  /** Speaker label for dialogues (`A`, `B`, or a cast name in kana); absent in `story` kind (V25). */
  speaker?: string;
  /** Japanese with ruby markup. */
  ja: string;
  /** Kana-only reading of `ja`. */
  kana: string;
  en: string;
  /** Word-level surfaces whose concatenation equals plain `ja` exactly (V19). Punctuation is its own token. */
  tokens: string[];
  /**
   * Parallel to `tokens`: the vocab/grammar id each token resolved to, or `null` for function
   * tokens, names, numerals and punctuation. GENERATED by the linker/validator (the V20 match);
   * writers omit. Lets coverage, gloss and capture run without loading every allowlist file.
   */
  tokenIds?: (string | null)[];
  /** Vocab ids used here that are beyond the station allowlist; ≤ 1 per line, ≤ 3 per story (6 for Stations 1–3) (V20). */
  plusOne?: string[];
  /** Dialogue NPC line: the learner must backchannel at the end of this line (role-play aizuchi slot). */
  aizuchiSlot?: boolean;
  /** Dialogue: from this line on the learner's lines are scored against this register (register switching, Station 21+). */
  registerTarget?: RegisterTag;
  /** Learner line (speaker === learnerSpeaker): accepted plain surfaces besides plain `ja` for Type/Speak mode. */
  accept?: string[];
  /** Learner line: plain content words that must appear in a Type/Speak answer. */
  mustInclude?: string[];
  /**
   * Learner line: 3–4 Choose-mode options (V27: exactly one `best`, `best.text` equals plain `ja`,
   * every wrong option plausible and carrying its `recast`). Required for `dialogue` texts in Pass 2.
   */
  options?: { text: string; kind: 'best' | 'ok' | 'register-wrong' | 'grammar-wrong'; recast?: string }[];
  /** Voice style for the rendered clip (design 08 §5); ∈ `LINE_EMOTIONS` (V41, W on a `story` line without `narrator`). */
  emotion?: LineEmotion;
}

/**
 * One graded reading or dialogue. 137 texts in V1 (3 per station for 1–31, 2 for 32–53) in
 * `stories/<level>/stories-s<NN>.json`, plus the audio-first listening pieces (design 08 §3:
 * `quota.listening` = 2 per station 4–53, ids after the station's texts) in their own
 * `stories/<level>/listening-s<NN>.json` files with the same schema (V43 checks the placement).
 */
export interface StoryItem {
  /** `s-07-1` — station number (2 digits) + sequence 1–9. */
  id: string;
  /** `st-07` — must exist in STATIONS (V06) and match the id's station segment. */
  stationId: string;
  titleJa: string;
  titleEn: string;
  kind: StoryKind;
  register: RegisterTag;
  /** ≥ 12 lines, ≤ 60 (V14, V25). */
  lines: StoryLine[];
  /** Every vocab item used (allowlist ∪ plusOne), for coverage checks (V20). */
  vocabIds: string[];
  /** Every grammar point used (must be in the station's cumulative grammar allowlist). */
  grammarIds: string[];
  /** ≥ 3 questions (V14, V21). */
  comprehension: ComprehensionQuestion[];
  /** ≤ 60 words: what happened, for the 次回予告 and the Scroll re-read. */
  recapEn: string;
  /** Proper nouns used (cast names, places) that are exempt from coverage; kana or ruby'd in `ja`. */
  names?: string[];
  /** Native Bridge passage (Station 27+): authentic register, 93 % coverage target (`COVERAGE_TARGETS.bridge`). */
  bridge?: boolean;
  /**
   * For dialogues reused in role-play: the `speaker` label the learner plays. On an `audioFirst`
   * dialogue it is set only when the piece should also be a role-play (design 08 §5, §11); then V27 applies.
   */
  learnerSpeaker?: string;
  /** Listening piece genre (design 08 §3); ∈ `LISTENING_GENRES`, first allowed at `GENRE_FROM_STATION[genre]` (V41). */
  genre?: ListeningGenre;
  /** Audio-first piece (design 08 §3): heard before it is read; requires `genre`; lives in `listening-s<NN>.json` (V41, V43). */
  audioFirst?: true;
  /** Cast name of a speaker-less text's reader (`kind: 'story'` only, V41): the caller of a one-sided phone piece, `anchor`, `lecturer`, `reader` (design 08 §6). Resolves in `scripts/audio/cast.json` (V42). */
  narrator?: string;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Conjugation golden table                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

/** One row of the golden table (60 head words: 40 verbs × 20 forms, 20 adjectives × 6 forms; ≈ 903 rows). File: `conjugation/conjugation-<NNN>.json`. */
export interface ConjugationGoldenEntry {
  /** `cj-0001`. */
  id: string;
  /** Dictionary form, plain: `行く`. */
  word: string;
  /** Kana of `word`: `いく`. */
  kana: string;
  pos: ConjugablePos;
  form: ConjForm;
  /** Expected answer, plain (no ruby): `行って`. */
  answer: string;
  /** Kana of `answer`: `いって`. */
  answerKana: string;
  /** Other accepted surfaces (`行ける` / `いける`, ら-dropped potential, etc.). */
  alt?: string[];
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Michikusa (roadside fragments)                                             */
/* ────────────────────────────────────────────────────────────────────────── */

export type MichikusaKind =
  | 'etymology'
  | 'proverb'
  | 'culture'
  | 'pitch'
  | 'kanji-origin'
  | 'usage'
  | 'road-history';

/** A 10-second roadside card; 4 per station (212). File: `michikusa/michikusa-s<NN>.json`. */
export interface MichikusaItem {
  /** `m-07-1`. */
  id: string;
  /** `st-07`. */
  stationId: string;
  kind: MichikusaKind;
  titleEn: string;
  /** ≤ 60 words of English. */
  bodyEn: string;
  /** Optional Japanese quote with ruby markup (proverb, word). */
  ja?: string;
  /** Required when `ja` is present. */
  kana?: string;
  /** ≤ 80 chars naming the public-domain source; required for `road-history`, `etymology`, `kanji-origin` (human spot-check list). */
  sourceNote?: string;
}

/**
 * Any item the loader can hand back by id (ARCHITECTURE §3). Stations and
 * conjugation rows are not items: `StationBundle` is a file, the golden table
 * is read only by `learn/conjugate.test.ts`.
 */
export type ContentItem = KanaItem | VocabItem | KanjiItem | GrammarItem | StoryItem | MichikusaItem | ComponentDef;

/* ────────────────────────────────────────────────────────────────────────── */
/* Curriculum: belts and stations                                             */
/* ────────────────────────────────────────────────────────────────────────── */

export interface BeltDef {
  id: Belt;
  nameEn: string;
  /** `白帯` etc. */
  nameJa: string;
  /** Hex color, identical in both themes (design 01 §4.3). */
  color: string;
  /** Inclusive station range. */
  stations: [number, number];
  level: Level;
  /** Dojo title in Japanese (`見習い`) and romaji. */
  titleJa: string;
  titleRomaji: string;
}

/** Target item counts for one station (design 02 §1). The assigner fills these; V34 checks ±10 %. */
export interface StationQuota {
  vocab: number;
  kanji: number;
  grammar: number;
  /** Texts without `audioFirst` (V34 amendment, design 08 §5). */
  stories: number;
  /** Audio-first listening pieces (design 08 §3): 0 for Stations 1–3, 2 for 4–53 (V43). Story sequence ≤ `stories + listening` (V05). */
  listening: number;
}

export interface StationDef {
  /** `st-07`. */
  id: string;
  /** 1–53. */
  number: number;
  nameJa: string;
  nameRomaji: string;
  belt: Belt;
  /** `null` for the kana stations (1–3). */
  jlpt: Jlpt | null;
  /** Gatekeeper (関守) name, Japanese and English. */
  gateJa: string;
  gateEn: string;
  quota: StationQuota;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Files and manifest                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

/** Every hand-written content file has this envelope (V01). */
export interface ContentFile<T> {
  schema: 'tsuzuku.content/1';
  type: ContentKind;
  /** Level of the items inside, when the kind has one. */
  level?: Level;
  /** Free writer tag, e.g. `writer-vocab-n5-003`. */
  writer?: string;
  /** ISO 8601. */
  generatedAt?: string;
  /** 1–150 items (V02). */
  items: T[];
}

/** Generated per station by `build-content-index`: `stations/<NN>.json`. */
export interface StationBundle {
  schema: 'tsuzuku.station/1';
  number: number;
  kanaIds: string[];
  vocabIds: string[];
  kanjiIds: string[];
  grammarIds: string[];
  /** Component ids introduced at this station (placed one station ahead of the first kanji that uses them). */
  componentIds: string[];
  storyIds: string[];
  michikusaIds: string[];
  /** Content file paths (relative to `content/`) that hold this station's items. */
  files: string[];
  /** Surface (word, kana or altForm) → item id for the CUMULATIVE allowlist ≤ this station; used to capture non-story text without loading every file. */
  surfaces: Record<string, string>;
}

export interface ManifestFile {
  /** Relative to `public/content/`, e.g. `vocab/n5/vocab-n5-003.json`. */
  path: string;
  type: ContentKind;
  level: Level | null;
  count: number;
  bytes: number;
  sha256: string;
  /** Belts whose stations draw from this file. */
  belts: Belt[];
  /** Station numbers whose items live in this file. */
  stations: number[];
}

export interface ManifestStation {
  number: number;
  /** `stations/07.json`. */
  path: string;
  /** Item counts per kind; `pool` is a file kind without items (design 08 §5), so it is excluded like `station`. */
  counts: Record<Exclude<ContentKind, 'conjugation' | 'component' | 'station' | 'pool'>, number>;
}

/** `public/content/manifest.json` — generated, never hand-written (V35). */
export interface ContentManifest {
  schema: 'tsuzuku.manifest/1';
  /**
   * Keys the loader's Cache API mirror (`tsuzuku-content-<contentVersion>`). `build-content-index.ts`
   * derives it from the content (`c-` + 10 hex of a sha256 over every content file) unless
   * `--version` overrides it with a hand-picked id such as `2026.10.1`.
   */
  contentVersion: string;
  generatedAt: string;
  files: ManifestFile[];
  stations: ManifestStation[];
  totals: Record<ContentKind, number>;
  /** Path of the component list, e.g. `_meta/components.json`. */
  componentsPath: string;
  /** Old id → new id for renames. */
  redirects: Record<string, string>;
}

/**
 * One graded listening sentence in a pool (design 08 §4). `ref` is the clip key (design 08 §8):
 * `v-n5-0249#ex0`, `g-n5-024#ex1`, `s-07-2#L3`; `ids` are the content tokens' item ids (every one
 * inside the cumulative allowlist ≤ the pool's station); `kana` is the sentence reading, `morae`
 * its mora count (speech estimate = morae ÷ 7 s + 0.5 s).
 */
export interface PoolRef {
  ref: string;
  ids: string[];
  kana: string;
  morae: number;
}

/**
 * `listening/pool-<NN>.json` (design 08 §4–§5): every sentence whose `knownAt = max(station of ids)`
 * equals `station`. Generated by `content:assign`, listed in the manifest as type `pool`, regenerated
 * byte-identically (V44, reported by `content:index`'s default check). Not a `ContentFile`.
 */
export interface ListeningPool {
  schema: 'tsuzuku.pool/1';
  station: number;
  refs: PoolRef[];
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Id grammar and ruby regex (shared by validator and runtime)                */
/* ────────────────────────────────────────────────────────────────────────── */

export const ID_PATTERNS: Record<ContentKind, RegExp> = {
  kana: /^k-[hk]-[a-z]{1,4}$/,
  vocab: /^v-n[1-5]-\d{4}$/,
  kanji: /^j-[㐀-䶿一-鿿々]$/,
  grammar: /^g-n[1-5]-\d{3}$/,
  story: /^s-(0[1-9]|[1-4]\d|5[0-3])-[1-9]$/,
  conjugation: /^cj-\d{4}$/,
  component: /^c-[a-z]+(-[a-z]+)*$/,
  michikusa: /^m-(0[1-9]|[1-4]\d|5[0-3])-[1-4]$/,
  station: /^st-(0\d|[1-4]\d|5[0-3])$/,
  /** Pool file id (design 08 §5): the file stem of `listening/pool-<NN>.json`, Stations 01–53. */
  pool: /^pool-(0[1-9]|[1-4]\d|5[0-3])$/,
};

/** Matches one ruby `{base|reading}`; group 1 = base, group 2 = reading. */
export const RUBY_RE = /\{([^{}|]+)\|([^{}|]+)\}/g;

/** Characters allowed in `kana` fields of single words (V10). */
export const KANA_WORD_RE = /^[ぁ-ゖァ-ヺー・]+$/;

/** Characters allowed in `kana` fields of sentences (V10): kana, ー, ・, and Japanese punctuation. */
export const KANA_SENTENCE_RE = /^[ぁ-ゖァ-ヺー・、。！？「」『』〜…　 ]+$/;

/* ────────────────────────────────────────────────────────────────────────── */
/* Constants                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

export const BELTS: readonly BeltDef[] = [
  { id: 'white', nameEn: 'White', nameJa: '白帯', color: '#F4EDE0', stations: [1, 3], level: 'kana', titleJa: '見習い', titleRomaji: 'Minarai' },
  { id: 'yellow', nameEn: 'Yellow', nameJa: '黄帯', color: '#F2D54A', stations: [4, 9], level: 'n5', titleJa: '入門', titleRomaji: 'Nyūmon' },
  { id: 'orange', nameEn: 'Orange', nameJa: '橙帯', color: '#F08A24', stations: [10, 15], level: 'n5', titleJa: '門下生', titleRomaji: 'Monkasei' },
  { id: 'green', nameEn: 'Green', nameJa: '緑帯', color: '#3E9B4F', stations: [16, 24], level: 'n4', titleJa: '中堅', titleRomaji: 'Chūken' },
  { id: 'blue', nameEn: 'Blue', nameJa: '青帯', color: '#2F6FD6', stations: [25, 31], level: 'n3', titleJa: '師範代候補', titleRomaji: 'Shihandai-kōho' },
  { id: 'purple', nameEn: 'Purple', nameJa: '紫帯', color: '#7A3FB5', stations: [32, 38], level: 'n3', titleJa: '師範代', titleRomaji: 'Shihandai' },
  { id: 'brown', nameEn: 'Brown', nameJa: '茶帯', color: '#6B3F23', stations: [39, 46], level: 'n2', titleJa: '師範', titleRomaji: 'Shihan' },
  { id: 'black', nameEn: 'Black', nameJa: '黒帯', color: '#0B0B10', stations: [47, 53], level: 'n1', titleJa: '達人', titleRomaji: 'Tatsujin' },
];

/** Station 0 (onboarding) and the arrival point; not part of STATIONS. */
export const NIHONBASHI = { id: 'st-00', number: 0, nameJa: '日本橋', nameRomaji: 'Nihonbashi' } as const;
export const SANJO_OHASHI = { nameJa: '三条大橋', nameRomaji: 'Sanjō Ōhashi', shinsa: 'shodan' } as const;

const st = (
  number: number,
  nameJa: string,
  nameRomaji: string,
  belt: Belt,
  jlpt: Jlpt | null,
  vocab: number,
  kanji: number,
  grammar: number,
  stories: number,
  listening: number,
  gateJa: string,
  gateEn: string,
): StationDef => ({
  id: `st-${String(number).padStart(2, '0')}`,
  number,
  nameJa,
  nameRomaji,
  belt,
  jlpt,
  gateJa,
  gateEn,
  quota: { vocab, kanji, grammar, stories, listening },
});

/**
 * The 53 Tōkaidō stations (design 02 §1). Totals: vocab 6,350 · kanji 1,000 · grammar 450 ·
 * stories 137 (3 per station 1–31, 2 per station 32–53) · listening pieces 100 (design 08 §3:
 * 0 for Stations 1–3, 2 per station 4–53). Row columns: vocab, kanji, grammar, stories, listening.
 */
export const STATIONS: readonly StationDef[] = [
  // White — kana
  st(1, '品川', 'Shinagawa', 'white', null, 20, 0, 0, 3, 0, '潮の関守', 'Tide Keeper'),
  st(2, '川崎', 'Kawasaki', 'white', null, 20, 0, 0, 3, 0, '渡しの関守', 'Ferry Keeper'),
  st(3, '神奈川', 'Kanagawa', 'white', null, 40, 0, 0, 3, 0, '湊の関守', 'Port Keeper'),
  // Yellow — N5-A
  st(4, '保土ヶ谷', 'Hodogaya', 'yellow', 5, 60, 8, 8, 3, 2, '坂の関守', 'Hill Keeper'),
  st(5, '戸塚', 'Totsuka', 'yellow', 5, 60, 8, 8, 3, 2, '夜明けの関守', 'Dawn Keeper'),
  st(6, '藤沢', 'Fujisawa', 'yellow', 5, 60, 8, 7, 3, 2, '松林の関守', 'Pine Grove Keeper'),
  st(7, '平塚', 'Hiratsuka', 'yellow', 5, 60, 8, 8, 3, 2, '七夕の関守', 'Tanabata Keeper'),
  st(8, '大磯', 'Ōiso', 'yellow', 5, 60, 8, 7, 3, 2, '浜辺の関守', 'Shore Keeper'),
  st(9, '小田原', 'Odawara', 'yellow', 5, 60, 8, 7, 3, 2, '城下の関守', 'Castle Town Keeper'),
  // Orange — N5-B
  st(10, '箱根', 'Hakone', 'orange', 5, 60, 9, 8, 3, 2, '大関所の関守', 'Great Checkpoint Keeper'),
  st(11, '三島', 'Mishima', 'orange', 5, 60, 9, 8, 3, 2, '湧水の関守', 'Spring Keeper'),
  st(12, '沼津', 'Numazu', 'orange', 5, 60, 9, 7, 3, 2, '港市の関守', 'Harbor Market Keeper'),
  st(13, '原', 'Hara', 'orange', 5, 60, 9, 8, 3, 2, '富士見の関守', 'Fuji-View Keeper'),
  st(14, '吉原', 'Yoshiwara', 'orange', 5, 60, 8, 7, 3, 2, '左富士の関守', 'Left-Fuji Keeper'),
  st(15, '蒲原', 'Kanbara', 'orange', 5, 60, 8, 7, 3, 2, '雪夜の関守', 'Snowy Night Keeper'),
  // Green — N4
  st(16, '由比', 'Yui', 'green', 4, 72, 22, 10, 3, 2, '薩埵峠の関守', 'Satta Pass Keeper'),
  st(17, '興津', 'Okitsu', 'green', 4, 72, 22, 10, 3, 2, '清見の関守', 'Kiyomi Keeper'),
  st(18, '江尻', 'Ejiri', 'green', 4, 72, 22, 10, 3, 2, '突風の関守', 'Gust Keeper'),
  st(19, '府中', 'Fuchū', 'green', 4, 72, 22, 10, 3, 2, '駿府の関守', 'Sunpu Keeper'),
  st(20, '鞠子', 'Mariko', 'green', 4, 72, 22, 10, 3, 2, 'とろろ汁の関守', 'Tororo Keeper'),
  st(21, '岡部', 'Okabe', 'green', 4, 72, 22, 10, 3, 2, '宇津ノ谷の関守', 'Utsunoya Pass Keeper'),
  st(22, '藤枝', 'Fujieda', 'green', 4, 72, 22, 10, 3, 2, '継立の関守', 'Relay Keeper'),
  st(23, '島田', 'Shimada', 'green', 4, 72, 22, 10, 3, 2, '大井川の関守', 'Ōi River Keeper'),
  st(24, '金谷', 'Kanaya', 'green', 4, 74, 24, 10, 3, 2, '川越しの関守', 'River Crossing Keeper'),
  // Blue — N3-A (Plateau Arc begins)
  st(25, '日坂', 'Nissaka', 'blue', 3, 121, 25, 8, 3, 2, '小夜の中山の関守', 'Sayo-no-Nakayama Keeper'),
  st(26, '掛川', 'Kakegawa', 'blue', 3, 121, 25, 8, 3, 2, '秋風の関守', 'Autumn Wind Keeper'),
  st(27, '袋井', 'Fukuroi', 'blue', 3, 121, 25, 8, 3, 2, '出茶屋の関守', 'Teahouse Keeper'),
  st(28, '見付', 'Mitsuke', 'blue', 3, 121, 25, 8, 3, 2, '天竜川の関守', 'Tenryū Keeper'),
  st(29, '浜松', 'Hamamatsu', 'blue', 3, 121, 25, 8, 3, 2, '冬枯れの関守', 'Winter Field Keeper'),
  st(30, '舞坂', 'Maisaka', 'blue', 3, 121, 25, 8, 3, 2, '今切の関守', 'Imagire Keeper'),
  st(31, '新居', 'Arai', 'blue', 3, 121, 25, 8, 3, 2, '新居関所の関守', 'Arai Checkpoint Keeper'),
  // Purple — N3-B
  st(32, '白須賀', 'Shirasuka', 'purple', 3, 122, 25, 8, 2, 2, '潮見坂の関守', 'Shiomizaka Keeper'),
  st(33, '二川', 'Futagawa', 'purple', 3, 122, 25, 8, 2, 2, '猿ヶ馬場の関守', 'Saru-ga-Baba Keeper'),
  st(34, '吉田', 'Yoshida', 'purple', 3, 122, 25, 8, 2, 2, '豊川橋の関守', 'Toyokawa Bridge Keeper'),
  st(35, '御油', 'Goyu', 'purple', 3, 122, 25, 8, 2, 2, '旅籠の関守', 'Inn Keeper'),
  st(36, '赤坂', 'Akasaka', 'purple', 3, 122, 25, 7, 2, 2, '宿の灯の関守', 'Lantern Inn Keeper'),
  st(37, '藤川', 'Fujikawa', 'purple', 3, 122, 25, 7, 2, 2, '棒鼻の関守', 'Bōbana Keeper'),
  st(38, '岡崎', 'Okazaki', 'purple', 3, 121, 25, 8, 2, 2, '矢矧橋の関守', 'Yahagi Bridge Keeper'),
  // Brown — N2 (Plateau Arc ends)
  st(39, '池鯉鮒', 'Chiryū', 'brown', 2, 212, 44, 12, 2, 2, '馬市の関守', 'Horse Market Keeper'),
  st(40, '鳴海', 'Narumi', 'brown', 2, 212, 44, 11, 2, 2, '絞りの関守', 'Shibori Keeper'),
  st(41, '宮', 'Miya', 'brown', 2, 212, 44, 11, 2, 2, '熱田の関守', 'Atsuta Keeper'),
  st(42, '桑名', 'Kuwana', 'brown', 2, 212, 44, 11, 2, 2, '七里の渡しの関守', 'Seven-Ri Ferry Keeper'),
  st(43, '四日市', 'Yokkaichi', 'brown', 2, 213, 44, 11, 2, 2, '三重川の関守', 'Mie River Keeper'),
  st(44, '石薬師', 'Ishiyakushi', 'brown', 2, 213, 44, 11, 2, 2, '薬師の関守', 'Yakushi Keeper'),
  st(45, '庄野', 'Shōno', 'brown', 2, 213, 43, 11, 2, 2, '白雨の関守', 'Sudden Shower Keeper'),
  st(46, '亀山', 'Kameyama', 'brown', 2, 213, 43, 12, 2, 2, '雪晴れの関守', 'Snow Clearing Keeper'),
  // Black — N1 core (no new kanji in V1; jōyō remainder is a content hook)
  st(47, '関', 'Seki', 'black', 1, 214, 0, 10, 2, 2, '関の関守', 'Keeper of the Barrier'),
  st(48, '坂下', 'Sakashita', 'black', 1, 214, 0, 10, 2, 2, '筆捨山の関守', 'Fudesute Keeper'),
  st(49, '土山', 'Tsuchiyama', 'black', 1, 214, 0, 10, 2, 2, '春雨の関守', 'Spring Rain Keeper'),
  st(50, '水口', 'Minakuchi', 'black', 1, 214, 0, 10, 2, 2, '干瓢の関守', 'Kanpyō Keeper'),
  st(51, '石部', 'Ishibe', 'black', 1, 214, 0, 10, 2, 2, '目川の関守', 'Megawa Keeper'),
  st(52, '草津', 'Kusatsu', 'black', 1, 215, 0, 10, 2, 2, '追分の関守', 'Fork Keeper'),
  st(53, '大津', 'Ōtsu', 'black', 1, 215, 0, 10, 2, 2, '走井の関守', 'Hashirii Keeper'),
];

/** Maximum items per hand-written content file (V02). */
export const MAX_ITEMS_PER_FILE = 150;

/**
 * Story coverage thresholds (V20): fraction of non-punctuation tokens that must be known.
 * The cliffs are staggered on purpose (design 02 §6.3): casual narration starts at Station 25
 * at the 0.97 target, Native Bridge (`bridge: true`) passages start at Station 27 at 0.93,
 * ordinary passages drop to 0.95 at Station 29 and to 0.93 at Station 39.
 */
export const COVERAGE_TARGETS = { 'st-01-28': 0.97, 'st-29-38': 0.95, 'st-39-53': 0.93, bridge: 0.93 } as const;

/** First station at which a `bridge: true` passage may appear. */
export const BRIDGE_FROM_STATION = 27;

/** The V20 threshold for a story at `station` (1–53). */
export function coverageTargetFor(station: number, bridge: boolean): number {
  if (bridge) return COVERAGE_TARGETS.bridge;
  if (station <= 28) return COVERAGE_TARGETS['st-01-28'];
  if (station <= 38) return COVERAGE_TARGETS['st-29-38'];
  return COVERAGE_TARGETS['st-39-53'];
}

/** Plain-`ja` length caps per level in characters (V15); N5 additionally ≤ 14 tokens. */
export const SENTENCE_MAX_CHARS: Record<Exclude<Level, 'kana' | 'dan'>, number> = {
  n5: 25,
  n4: 35,
  n3: 45,
  n2: 60,
  n1: 80,
};
