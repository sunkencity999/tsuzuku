/**
 * TSUZUKU — the story linker: token → item id (CONTENT_GUIDE §14.2 / V20).
 *
 * Shared by `assign-stations.ts` (`content:assign` writes `StoryLine.tokenIds`
 * through `linkStories`) and `validate-content.ts` (V19 / V20 and the V36
 * segmentation). Runs under Node's native type stripping (erasable TypeScript
 * only); `assign-stations.ts` re-exports everything here for older imports.
 *
 * `buildMatchPool` turns a cumulative allowlist (+ a story's plusOne words)
 * into the lookups `matchToken` consults, in this order:
 *  1. `exact`    — word / kana / altForm (`〜` stripped) → id; the first
 *     allowlisted item keeps a surface. The kana reading of an affix (総〜,
 *     高〜, 〜性) is not a surface: a bound morpheme never stands alone, so a
 *     bare そう / こう / せい token is never the affix.
 *  2. `forms`    — generated inflections (`inflectedForms`) of the verbs and
 *     of an `aux` copula item: polite ます-row, ない / なかった, た / て with the
 *     godan onbin (って った / んで んだ / いて いた / いで いだ / して した; 行く
 *     and いく・ゆく take って), the contracted てる / てた, ば, volitional,
 *     godan 〜たい; the する (し・します・しない・した・して・しよう・すれば) and
 *     来る (き・きます・こない・きた・きて・こよう・くれば) paradigms; ではない /
 *     じゃありません / じゃなかった / でしょう … for です. A form is matched
 *     whole, so it is always the longest surface and never a shorter word's
 *     stem (出して → 出す, not the 出 stem of 出る; いきます → 行く, not the
 *     いき stem of 生きる). Which surfaces inflect: every kana-written
 *     surface (word, kana altForm, or the kana reading of an `AUX_VERBS`
 *     lexeme), and kanji surfaces with a one-character stem or a する
 *     compound — a longer kanji stem is already unambiguous for step 4. The
 *     kana reading of any other kanji verb does not inflect (なった is not
 *     鳴る, しまった is not 閉まる): stories write content verbs in kanji with
 *     ruby. Collisions: an `AUX_VERBS` lexeme beats a content verb (きた →
 *     来る, not 着る; いって → 行く, not 言う or 要る), otherwise the first
 *     allowlisted item wins. A kana token that `exact` knows only as the
 *     READING of a kanji word (きた ← 北, した ← 下, いない ← 以内) yields to
 *     a generated form for the same reason — and, since stories write content
 *     words in kanji with ruby, to every other reading of the token as well:
 *     a function token (に is the particle, not 二; さん the suffix, not 三;
 *     こと the nominaliser, not 琴), a name or a numeral — but not to an
 *     inflection stem (わたし is 私, not the わた stem of 渡す), so it sits
 *     between step 3 and step 4 (わたし → 私, たぶん → 多分). The reading of an
 *     `AUX_VERBS` lexeme is a real surface (いく おく みる くる link to 行く 置く
 *     見る 来る once allowlisted — auxiliaries are written in kana). The kana stage is the
 *     exception (`kanaStage`, Stations 1–3: all-kana text written against the
 *     White set), where the reading wins right after the forms (いち、に、さん
 *     counts 二 and 三). Outside the kana stage a kana-written word beats the
 *     mere reading of a kanji word registered before it (いや over 嫌, なる
 *     over 鳴る); in it, the first allowlisted item keeps the surface. A kanji
 *     homograph that a longer
 *     stem of another verb also inflects to (降りました: 降る / 降りる) goes to
 *     the longest stem, like every prefix match (`resolveForm`). Bare し / き
 *     are not forms (し is the conjunction particle; き alone is never
 *     written for 来).
 *  3. function tokens (`FUNCTION_TOKENS`), cast / story names, kanji numerals
 *     → known, unlinked. A form of an allowlisted verb that is also a
 *     function token (します, いった, もらって …) is linked by step 2; before
 *     the verb is introduced it stays a function token.
 *  4. `prefixes` — inflection stems, longest first (a single-kanji stem only
 *     before okurigana or at token end, `stemApplies`), then counters after a
 *     numeral, grammar clozeHints and name + suffix.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { hasKanji, toPlain } from '../src/content/ruby.ts';
import { speechMorae } from '../src/shared/jp.ts';
import type { GrammarItem, ListeningPool, PoolRef, SentenceExample, StationBundle, StoryItem, VocabItem } from '../src/content/types.ts';

/** Fixed Tabi Nikki cast (CONTENT_GUIDE §14.1): always allowlisted names, never unknown tokens. */
export const CAST_NAMES: ReadonlySet<string> = new Set(['ハナ', 'ケン', 'アオ', '田中', '田中さん']);

/**
 * Function tokens that never count as unknown in V20: particles, copula and
 * ます-forms, て-form auxiliaries (dictionary, ます and て forms), する-forms and
 * name suffixes (CONTENT_GUIDE §14.2, extended with their inflections). They
 * are consulted AFTER `exact` and `forms`, so once the verb behind one is
 * allowlisted the token links to it.
 */
export const FUNCTION_TOKENS: ReadonlySet<string> = new Set([
  // particles
  'は', 'が', 'を', 'に', 'で', 'と', 'へ', 'から', 'まで', 'より', 'の', 'も', 'か', 'ね', 'よ', 'な', 'わ', 'って',
  'や', 'し', 'ば', 'ても', 'でも', 'のに', 'ので', 'けど', 'けれど', 'けれども', 'のは', 'のが', 'には', 'では', 'とは', 'へは',
  'からは', 'までは', 'とか', 'だけ', 'しか', 'ほど', 'くらい', 'ぐらい', 'ずつ', 'など', 'なんて', 'かな', 'よね', 'ぞ', 'ぜ', 'さ', 'っけ',
  // formal nouns, demonstrative adverbs, the sentence-final もん and the adverbial negative (こと is not 琴, そう is not 僧, なく is not 鳴く)
  'こと', 'もん', 'そう', 'こう', 'なく', 'なくて', 'なかった',
  // the 連用形 あり (〜であり) and the interjections え / おや (not 蟻, 絵, 親)
  'あり', 'え', 'おや',
  // copula and ます-forms
  'です', 'だ', 'でした', 'だった', 'じゃない', 'ではない', 'じゃありません', 'ではありません', 'じゃなかった', 'ではなかった',
  'でしょう', 'だろう', 'ます', 'ません', 'ました', 'ましょう', 'ませんでした', 'ましょうか', 'ませんか', 'なら', 'なの', 'なん',
  // て-form auxiliaries
  'いる', 'います', 'いた', 'いました', 'いない', 'いません', 'いて', 'ある', 'あります', 'あった', 'ありました', 'ない', 'ありません', 'あって',
  'おく', 'おきます', 'おいた', 'おいて', 'みる', 'みます', 'みた', 'みて', 'しまう', 'しまいます', 'しまった', 'しまって',
  'くれる', 'くれます', 'くれた', 'くれて', 'もらう', 'もらいます', 'もらった', 'もらって', 'あげる', 'あげます', 'あげた', 'あげて',
  'いく', 'いきます', 'いった', 'いって', 'くる', 'きます', 'きた', 'きて', 'する', 'します', 'した', 'して', 'しない', 'しません',
  // name suffixes
  'さん', 'ちゃん', 'くん', '様', 'さま', 'たち',
]);

/** て-form auxiliaries / light verbs by kana dictionary form: their kana inflections win a `forms` collision. */
export const AUX_VERBS: ReadonlySet<string> = new Set(['いく', 'ゆく', 'くる', 'いる', 'おる', 'ある', 'おく', 'みる', 'しまう', 'くれる', 'もらう', 'あげる', 'する']);

const PUNCT_TOKEN_RE = /^[\p{P}\p{S}\s]+$/u;
const KANJI_NUMERAL_RE = /^[〇零一二三四五六七八九十百千万億兆]+$/;

/** A generated inflection: the item it belongs to, its stem length and whether the lexeme is an `AUX_VERBS` auxiliary. */
export interface FormEntry {
  id: string;
  stem: number;
  aux: boolean;
}

export interface MatchPool {
  /** exact surface → vocab id */
  exact: Map<string, string>;
  /** generated inflection (`inflectedForms`) → its item */
  forms: Map<string, FormEntry>;
  /** `exact` surfaces that are only the kana reading of a kanji word (きた ← 北); every other reading of the token beats them (module header) */
  readings: Set<string>;
  /** Stations 1–3: all-kana stories written against the White set — a reading wins right after the forms */
  kanaStage: boolean;
  /** inflection stems (longest first) → vocab id, with the surface + pos the stem came from (homograph check) */
  prefixes: { s: string; id: string; surface: string; pos: string }[];
  /** counter surfaces (numeral prefix required) → vocab id */
  counters: { s: string; id: string }[];
  /** grammar clozeHints (longest first) → grammar id */
  hints: { h: string; id: string }[];
  /** plusOne vocab ids included in the pool */
  plusOne: Set<string>;
}

export interface TokenMatch {
  /** vocab/grammar id the token resolved to, or null (function token, name, numeral, punctuation, unknown). */
  id: string | null;
  known: boolean;
  punct: boolean;
}

function bareSurface(s: string): string {
  return s.replace(/^〜/, '').replace(/〜$/, '');
}

/** Godan final kana → the i / a / e / o-row kana of the same consonant. */
const GODAN_ROWS: Readonly<Record<string, readonly [string, string, string, string]>> = {
  う: ['い', 'わ', 'え', 'お'], く: ['き', 'か', 'け', 'こ'], ぐ: ['ぎ', 'が', 'げ', 'ご'], す: ['し', 'さ', 'せ', 'そ'], つ: ['ち', 'た', 'て', 'と'],
  ぬ: ['に', 'な', 'ね', 'の'], ぶ: ['び', 'ば', 'べ', 'ぼ'], む: ['み', 'ま', 'め', 'も'], る: ['り', 'ら', 'れ', 'ろ'],
};
const POLITE = ['ます', 'ません', 'ました', 'ませんでした', 'ましょう'] as const;
const NEGATIVE = ['ない', 'なかった'] as const;
const TE_TA = ['て', 'た', 'てる', 'てた'] as const;
const DE_DA = ['で', 'だ', 'でる', 'でた'] as const;
const TAI = ['たい', 'たかった', 'たくない'] as const;
/** Negative, polite-negative and でしょう forms of the copula, linked to an `aux` です / だ item. */
const COPULA_FORMS = ['ではない', 'じゃない', 'ではなかった', 'じゃなかった', 'ではありません', 'じゃありません', 'ではありませんでした', 'じゃありませんでした', 'でしょう'] as const;

/**
 * Whole-token inflections of one surface for the linker's `forms` map (see the
 * module header). Ichidan verbs get no 〜たい (いたい / みたい / きたい are other
 * words), godan verbs do; ある has no 〜ない row (its negative is the function
 * token ない); a kanji 来る compound relies on the 来 stem prefix instead.
 */
export function inflectedForms(surface: string, pos: string): string[] {
  const out: string[] = [];
  const add = (base: string, suffixes: readonly string[]): void => {
    for (const s of suffixes) out.push(base + s);
  };
  if (pos === 'aux') {
    if (surface === 'です' || surface === 'だ') out.push(...COPULA_FORMS);
  } else if (pos === 'v-irr') {
    if (surface.endsWith('する')) {
      const b = surface.slice(0, -2);
      if (b) out.push(`${b}し`);
      add(`${b}し`, [...POLITE, ...NEGATIVE, ...TE_TA, 'よう']);
      out.push(`${b}すれば`);
    } else if (surface.endsWith('くる')) {
      const b = surface.slice(0, -2);
      add(`${b}き`, [...POLITE, ...TE_TA]);
      add(`${b}こ`, [...NEGATIVE, 'よう']);
      out.push(`${b}くれば`);
    }
  } else if (pos === 'v1') {
    if (!surface.endsWith('る')) return out;
    add(surface.slice(0, -1), [...POLITE, ...NEGATIVE, ...TE_TA, 'よう', 'れば', 'られる']);
  } else if (pos === 'v5') {
    const last = surface.slice(-1);
    const rows = GODAN_ROWS[last];
    if (!rows) return out;
    const b = surface.slice(0, -1);
    const [i, a, e, o] = rows;
    add(b + i, [...POLITE, ...TAI]);
    if (!surface.endsWith('ある')) add(b + a, NEGATIVE);
    const voiced = last === 'ぐ' || last === 'ぬ' || last === 'ぶ' || last === 'む';
    const onbin = last === 'す' ? 'し' : last === 'く' && !/(?:行|い|ゆ)く$/.test(surface) ? 'い' : last === 'ぐ' ? 'い' : voiced ? 'ん' : 'っ';
    add(b + onbin, voiced ? DE_DA : TE_TA);
    out.push(`${b}${e}ば`, `${b}${o}う`);
  }
  return out;
}

export function buildMatchPool(vocab: Iterable<VocabItem>, grammar: Iterable<GrammarItem>, plusOne: Iterable<VocabItem> = [], opts: { kanaStage?: boolean } = {}): MatchPool {
  const pool: MatchPool = { exact: new Map(), forms: new Map(), readings: new Set(), kanaStage: opts.kanaStage === true, prefixes: [], counters: [], hints: [], plusOne: new Set() };
  const add = (v: VocabItem) => {
    const word = typeof v.word === 'string' ? v.word : '';
    const kana = typeof v.kana === 'string' ? v.kana : '';
    const alts = Array.isArray(v.altForms) ? v.altForms.filter((a): a is string => typeof a === 'string') : [];
    if (v.pos === 'counter') {
      for (const s of [word, kana, ...alts]) if (s) pool.counters.push({ s: bareSurface(s), id: v.id });
      return;
    }
    const surfaces = [word, kana, ...alts].map(bareSurface).filter(Boolean);
    const bareKana = bareSurface(kana);
    const reading = hasKanji(word) && bareKana && bareKana !== bareSurface(word) && !alts.map(bareSurface).includes(bareKana) ? bareKana : null;
    // A bound morpheme (総〜, 高〜, 〜性) never stands alone, so its reading cannot be a token on its own: そう is not 総〜.
    const affix = word.includes('〜');
    // An auxiliary lexeme is written in kana by design (ていく, ておく, てみる, てくる), so its reading is a real surface, not a mere reading.
    const auxReading = AUX_VERBS.has(bareKana);
    for (const s of surfaces) {
      if (affix && s === reading) continue;
      if (pool.exact.has(s)) {
        // A kana-written word beats the mere reading of a kanji word registered before it (いや over 嫌, なる over 鳴る) —
        // outside the kana stage, where every word is kana and the first allowlisted item keeps the surface (さん counts 三 before 〜さん).
        if (s !== reading && pool.readings.has(s) && !pool.kanaStage) {
          pool.exact.set(s, v.id);
          pool.readings.delete(s);
        }
        continue;
      }
      pool.exact.set(s, v.id);
      if (s === reading && !auxReading) pool.readings.add(s);
    }
    const aux = auxReading;
    for (const s of surfaces) {
      // Kanji verbs are written in kanji: their kana reading inflects only for the auxiliaries (きた, いって, おいた).
      if (s === reading && !aux) continue;
      // A kanji surface with a 2+-character stem is unambiguous for the prefix rule; forms matter for 1-kanji stems (出す / 出る) and する compounds.
      if (s !== reading && hasKanji(s) && s.length > 2 && v.pos !== 'v-irr') continue;
      for (const f of inflectedForms(s, String(v.pos))) {
        const cur = pool.forms.get(f);
        if (cur && (!aux || cur.aux)) continue;
        pool.forms.set(f, { id: v.id, stem: s.length - 1, aux });
      }
    }
    const pos = String(v.pos);
    if (v.pos === 'v1' || v.pos === 'v5' || v.pos === 'adj-i') {
      for (const s of surfaces) {
        const stem = s.slice(0, -1);
        if (stem.length > 0 && (hasKanji(stem) || stem.length >= 2)) pool.prefixes.push({ s: stem, id: v.id, surface: s, pos });
      }
    } else if (v.pos === 'adj-na' || v.pos === 'n-suru') {
      for (const s of surfaces) if (s.length >= 2 || hasKanji(s)) pool.prefixes.push({ s, id: v.id, surface: s, pos });
    } else if (v.pos === 'v-irr' && word.endsWith('来る')) {
      pool.prefixes.push({ s: word.slice(0, -1), id: v.id, surface: word, pos });
    }
  };
  for (const v of vocab) add(v);
  for (const v of plusOne) {
    pool.plusOne.add(v.id);
    add(v);
  }
  pool.prefixes.sort((a, b) => b.s.length - a.s.length);
  for (const g of grammar) {
    if (!Array.isArray(g.clozeHints)) continue;
    for (const h of g.clozeHints) if (typeof h === 'string' && h.length >= 2) pool.hints.push({ h, id: g.id });
  }
  pool.hints.sort((a, b) => b.h.length - a.h.length);
  return pool;
}

const OKURIGANA_START_RE = /^[ぁ-ゟ]/;

/**
 * Whether an inflection-stem prefix may claim `token`. A stem of two or more
 * characters always may: that is how compound forms link to their head word
 * (食べ始めた → 食べる, 建て直した → 建てる, 考え方 → 考える). A single-kanji stem
 * (有 ← 有る, 巻 ← 巻く, 甘 ← 甘い, 見 ← 見る) only may when what follows is
 * okurigana — or nothing, the bare ren'yōkei (見に行く) — because a kanji after
 * it starts a different word: 有名, 巻物, 甘酒, 包丁 are not forms of ある, 巻く,
 * 甘い, 包む.
 */
export function stemApplies(stem: string, token: string): boolean {
  if (stem.length > 1) return true;
  const rest = token.slice(stem.length);
  return rest.length === 0 || OKURIGANA_START_RE.test(rest);
}

/** The longest inflection stem that claims `token`, if any. */
function prefixMatch(pool: MatchPool, token: string): MatchPool['prefixes'][number] | undefined {
  for (const p of pool.prefixes) if (token.startsWith(p.s) && stemApplies(p.s, token)) return p;
  return undefined;
}

/**
 * The item behind a generated form. A longer stem of another verb that ALSO
 * inflects to this token is a homograph (降りました: 降りる / 降る; 開けば is not
 * one, 開ける has no such form), and the longest stem wins as it does for every
 * prefix match — unless the form is a kana auxiliary (いきます → 行く even beside
 * the いき stem of 生きる; おりました → おる beside 降りる).
 */
function resolveForm(pool: MatchPool, token: string, form: FormEntry): string {
  if (form.aux && !hasKanji(token)) return form.id;
  const p = prefixMatch(pool, token);
  if (!p || p.id === form.id || p.s.length <= form.stem) return form.id;
  return inflectedForms(p.surface, p.pos).includes(token) ? p.id : form.id;
}

export function matchToken(pool: MatchPool, token: string, names: ReadonlySet<string> = new Set()): TokenMatch {
  if (PUNCT_TOKEN_RE.test(token)) return { id: null, known: true, punct: true };
  const exact = pool.exact.get(token);
  const readingOnly = exact !== undefined && pool.readings.has(token);
  if (exact !== undefined && !readingOnly) return { id: exact, known: true, punct: false };
  const form = pool.forms.get(token);
  if (form !== undefined) return { id: resolveForm(pool, token, form), known: true, punct: false };
  // The kana stage writes every word in kana, so a reading is the word (いち、に、さん); elsewhere it is the last resort (below).
  if (readingOnly && pool.kanaStage) return { id: exact as string, known: true, punct: false };
  if (FUNCTION_TOKENS.has(token)) return { id: null, known: true, punct: false };
  if (names.has(token) || CAST_NAMES.has(token)) return { id: null, known: true, punct: false };
  if (KANJI_NUMERAL_RE.test(token)) return { id: null, known: true, punct: false };
  // The kana reading of a kanji word, once no function token, name or numeral claims the token (わたし → 私, not the わた stem of 渡す; たぶん → 多分).
  if (readingOnly) return { id: exact as string, known: true, punct: false };
  const p = prefixMatch(pool, token);
  if (p) return { id: p.id, known: true, punct: false };
  for (const c of pool.counters) {
    if (token.endsWith(c.s) && token.length > c.s.length && KANJI_NUMERAL_RE.test(token.slice(0, -c.s.length))) return { id: c.id, known: true, punct: false };
  }
  for (const h of pool.hints) if (token === h.h || token.includes(h.h) || (token.length >= 2 && h.h.includes(token))) return { id: h.id, known: true, punct: false };
  for (const nm of [...names, ...CAST_NAMES]) if (token.startsWith(nm) && FUNCTION_TOKENS.has(token.slice(nm.length))) return { id: null, known: true, punct: false };
  return { id: null, known: false, punct: false };
}

/** Allowlist station for a text: Stations 1–3 share the White set. */
export function allowlistStationFor(station: number): number {
  return station <= 3 ? 3 : station;
}

export function cumulativeIds(bundles: readonly StationBundle[], upTo: number, key: 'kanaIds' | 'vocabIds' | 'grammarIds'): Set<string> {
  const out = new Set<string>();
  for (const b of bundles) if (b.number <= upTo) for (const id of b[key] ?? []) out.add(id);
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Sentence segmentation and the listening pools (design 08 §4)              */
/* ────────────────────────────────────────────────────────────────────────── */
/*
 * Stories arrive tokenised by their writers; example sentences do not. The
 * pool builder therefore segments a plain sentence itself (`segmentSentence`):
 * the minimum-cost cover of the sentence by the pool's surfaces (`exact`,
 * generated `forms`, `FUNCTION_TOKENS`, `CAST_NAMES`, the text's `names` with a
 * name suffix, grammar cloze hints), kanji-numeral runs with the counter that
 * follows them, inflection stems extended over their okurigana and inflection
 * (trailing particles, auxiliaries after て / で, hints and kana words come
 * off: 食べますか is 食べます + か, 伸びていた is 伸びて + いた, 歩きながら is 歩き
 * + ながら) and unknown runs. The costs (below) make fewer and longer tokens
 * win, a function token or a hint lose to a word, and a bare reading or an
 * unknown character cost most; punctuation is its own token; a run no
 * candidate claims is ONE unknown token (りんご, コーヒー), never split, and a
 * lone hiragana is never carved off a kana word to pass the rest as known
 * (`COST_UNKNOWN_LONE_HIRAGANA`, `strayOk`). `matchToken` then links every
 * segment, so a sentence links exactly as a story line with the same tokens
 * would (`linkSentence`). Calibrated against the stories' own `tokenIds`
 * (`linker.test.ts`, `listening-report.ts` §4): the all-known verdict agrees
 * on ≈ 94 % of lines (the rest is the V20 matcher's hint rule, which counts a
 * verb as known through the ました inside it), the linked id set on the lines
 * the writers tokenised the same way (≈ 58 %; とても / ように / のため kept
 * whole or split). Story lines themselves enter the pools by their writers'
 * `tokenIds`, not by this segmenter (`buildPools`).
 */

const PUNCT_CHAR_RE = /^[\p{P}\p{S}\s]$/u;
const KANJI_NUMERAL_CHAR_RE = /^[〇零一二三四五六七八九十百千万億兆]$/;
const HIRAGANA_CHAR_RE = /^[ぁ-ゖ]$/;
const NO_NAMES: ReadonlySet<string> = new Set();

/*
 * Costs of the minimum-cost segmentation (`segmentSentence`). Fewer tokens
 * win (every token costs about 1), a longer content token beats a shorter
 * one (−0.05 per character), a function token carries no length bonus, a
 * grammar cloze hint costs more than a word (so のため is の + ため as the
 * stories have it, while ように with no word behind it stays one hint), the
 * kana READING of a kanji word — a last resort in `matchToken` too — costs
 * more than a word or a function token (はまだ is は + まだ, never はま + だ),
 * and a character nothing claims costs most. Punctuation is free and always
 * a boundary.
 */
const COST_TOKEN = 1;
const COST_PER_CHAR = 0.05;
/** A function token or a bare numeral: a little under a word, so もの + では + なく beats もので + はなく. */
const COST_FUNCTION = 0.92;
/**
 * A grammar cloze hint. A short one is a lexical unit the stories keep whole
 * (ように, たびに, ながら): just under a word + a particle. One that is only
 * function tokens end to end (ですか, ことは) costs more than that split. A
 * long one is a multi-word pattern the stories split into words (どこですか,
 * てもいいです): it grows with its length so that known words win and the hint
 * is used only where a piece of it is otherwise unknown (てはいけません).
 */
const COST_HINT_SHORT = 1.8;
const COST_HINT_FUNCTION = 2.2;
function hintCost(h: string, functionOnly: boolean): number {
  if (functionOnly) return COST_HINT_FUNCTION;
  return h.length <= 3 ? COST_HINT_SHORT : 1 + 0.6 * h.length;
}
/** The bare kana reading of a kanji word (and its stem): a last resort, dearer per character than an unknown run is, so はん is never carved out of ごはん and 担う never claims になって. */
const COST_READING_BASE = 1.6;
const COST_READING_PER_CHAR = 0.3;
function readingCost(len: number): number {
  return COST_READING_BASE + COST_READING_PER_CHAR * len;
}
/** Compound particles the stories write as two tokens (の + は, に + は): a shade over their parts. */
const COMPOUND_PARTICLES: ReadonlySet<string> = new Set(['のは', 'のが', 'には', 'では', 'とは', 'へは', 'からは', 'までは']);
const COST_COMPOUND_PARTICLE = 1.94;
/** The honorific prefix before a kanji word (お水, ご両親): known, no id. */
const HONORIFIC_PREFIXES: ReadonlySet<string> = new Set(['お', 'ご']);

/**
 * A token no surface claims that still counts as known (no id): only the
 * honorific prefix (お水, ご両親, おかし — before a kanji or a known kana word).
 * Nothing else is tolerated: a lone hiragana the pool cannot place is an
 * unknown token like any other, so an unknown kana word is never carved into
 * function tokens + one stray character and passed as known (まだ is not ま +
 * だ, よく is not よ + く, かばん is not か + ば + ん — `COST_UNKNOWN_LONE_HIRAGANA`
 * keeps such a run whole so the report names the word).
 */
function strayOk(token: string): boolean {
  return HONORIFIC_PREFIXES.has(token);
}
const KANJI_CHAR_RE = /^[㐀-䶿一-鿿々〆]$/;
/** An unknown run: a flat cost per run plus more per character than any known token costs, so a run is never carved by the particles inside it (ごはん is not ご + は + ん) and never swallows a known word. */
const COST_UNKNOWN_RUN = 3;
const COST_UNKNOWN_CHAR = 1.05;
/**
 * A lone unknown hiragana costs this much more: every one-mora hiragana word
 * is a particle or written in kanji, so a single stray character is never the
 * right reading of a kana stretch. Carving a function token off an unknown
 * kana word (よ + く, ま + だ, か + ば + ん, から + い) therefore never pays, and
 * the whole word stays one unknown run. A lone unknown KANJI (犬, 木) is a
 * plausible word and takes no surcharge, so 犬が is still 犬 + が.
 */
const COST_UNKNOWN_LONE_HIRAGANA = 1.5;

/** Name suffixes a name takes as one token (ハナさん, 田中さんたち), as `matchToken`'s name + function-token rule links them. */
const NAME_SUFFIXES: readonly string[] = ['さん', 'ちゃん', 'くん', '様', 'さま', 'たち'];

/**
 * Inflectional endings of a verb or い-adjective stem: the stories keep them on
 * the word (食べました, 高くない, 読んだ, 行きたい, 食べれば), so a stem's
 * extension that ends in one of them is complete and nothing is backed off.
 * The voiced onbin forms (読んだ, 泳いで) and the conditional (書けば) are
 * listed with the kana before them, so a copula (話 + だ), a particle (遅く +
 * まで) or a word (冷たい + そば) is never taken for one.
 */
const INFLECTION_ENDINGS: ReadonlySet<string> = new Set([
  'た', 'て', 'んだ', 'いだ', 'んで', 'いで', 'ない', 'なかった', 'なく', 'なくて', 'なければ', 'なくても', 'ず', 'ずに', 'ぬ',
  'ます', 'ません', 'ました', 'ませんでした', 'ましょう', 'たい', 'たかった', 'たくない', 'たくて',
  'れば', 'ければ', 'けば', 'げば', 'せば', 'てば', 'ねば', 'べば', 'めば', 'えば', 'れる', 'られる', 'せる', 'させる', 'おう', 'よう',
  'たら', 'んだら', 'いだら', 'たり', 'んだり', 'いだり', 'ても', 'んでも', 'いでも', 'てる', 'てた', 'んでる', 'んでた', 'いでる', 'いでた', 'ちゃう', 'ちゃった', 'じゃう', 'じゃった',
]);

/** Dictionary form and generated inflections of the て-form auxiliaries (`AUX_VERBS`): backed off a stem's extension after て / で (伸びて + いた, 教えて + もらいました). */
const AUX_FORMS: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  const pos: Record<string, string> = { いく: 'v5', ゆく: 'v5', くる: 'v-irr', いる: 'v1', おる: 'v5', ある: 'v5', おく: 'v5', みる: 'v1', しまう: 'v5', くれる: 'v1', もらう: 'v5', あげる: 'v1' };
  for (const [k, p] of Object.entries(pos)) {
    out.add(k);
    for (const f of inflectedForms(k, p)) out.add(f);
  }
  return out;
})();

/** する-forms: never backed off a stem's extension (した is the tail of ました, not a word after 食べま). */
const SURU_FORMS: ReadonlySet<string> = new Set(['する', 'します', 'した', 'して', 'しない', 'しません', 'しよう', 'すれば']);

interface Surface {
  s: string;
  cost: number;
}

interface Stem {
  s: string;
  /** a single-character stem resolves only before okurigana (`stemApplies`) */
  one: boolean;
  /** the stem of a kanji word's bare kana reading (costs `COST_READING`) */
  reading: boolean;
  /** a な-adjective or する-noun: the word itself, never extended over the hiragana after it (静か + な, 勉強 + します) */
  whole: boolean;
}

interface SegmentIndex {
  /** first character → surfaces (exact, forms, function tokens, cast names, hints), longest first */
  byFirst: Map<string, Surface[]>;
  /** first character → inflection stems, longest first (`Stem`) */
  stems: Map<string, Stem[]>;
  /** counter surfaces, longest first */
  counters: string[];
  /** surfaces backed off a stem's hiragana extension (phase 3): function tokens, hints and the pool's kana words, minus inflection endings and する-forms */
  suffixes: Set<string>;
  maxSuffix: number;
  maxAux: number;
}

const SEGMENT_INDEX = new WeakMap<MatchPool, SegmentIndex>();

function contentCost(len: number): number {
  return COST_TOKEN - COST_PER_CHAR * len;
}

/** True when `s` is function tokens end to end (ですか = です + か; ことは = こと + は). */
function functionOnly(s: string): boolean {
  const ok = new Array<boolean>(s.length + 1).fill(false);
  ok[0] = true;
  for (let i = 0; i < s.length; i++) {
    if (!ok[i]) continue;
    for (let j = i + 1; j <= s.length; j++) if (FUNCTION_TOKENS.has(s.slice(i, j))) ok[j] = true;
  }
  return ok[s.length] as boolean;
}

/** The hint minus its leading inflection endings and function tokens (てはいけません → いけません), when ≥ 2 characters remain. */
function hintPiece(h: string): string | null {
  let off = 0;
  for (;;) {
    let step = 0;
    for (let k = Math.min(6, h.length - off); k >= 1; k--) {
      const part = h.slice(off, off + k);
      if (INFLECTION_ENDINGS.has(part) || FUNCTION_TOKENS.has(part)) {
        step = k;
        break;
      }
    }
    if (step === 0) break;
    off += step;
  }
  return off > 0 && h.length - off >= 2 ? h.slice(off) : null;
}

function segmentIndex(pool: MatchPool): SegmentIndex {
  let idx = SEGMENT_INDEX.get(pool);
  if (idx) return idx;
  const costs = new Map<string, number>();
  const offer = (s: string, cost: number): void => {
    if (!s) return;
    const cur = costs.get(s);
    if (cur === undefined || cost < cur) costs.set(s, cost);
  };
  for (const s of pool.exact.keys()) offer(s, pool.readings.has(s) && !pool.kanaStage ? readingCost(s.length) : contentCost(s.length));
  for (const s of pool.forms.keys()) offer(s, contentCost(s.length));
  for (const s of FUNCTION_TOKENS) offer(s, COMPOUND_PARTICLES.has(s) ? COST_COMPOUND_PARTICLE : COST_FUNCTION);
  for (const s of CAST_NAMES) offer(s, contentCost(s.length));
  const suffixes = new Set<string>();
  for (const s of FUNCTION_TOKENS) if (!INFLECTION_ENDINGS.has(s) && !SURU_FORMS.has(s)) suffixes.add(s);
  for (const h of pool.hints) {
    offer(h.h, hintCost(h.h, functionOnly(h.h)));
    suffixes.add(h.h);
    // `matchToken` links a token contained in a hint (いけません ⊂ てはいけません): the hint minus its leading endings and function tokens is a surface of its own.
    const piece = hintPiece(h.h);
    if (piece) {
      offer(piece, hintCost(piece, functionOnly(piece)));
      suffixes.add(piece);
    }
  }
  // A kana word (まだ, そば, よう …) after a stem is its own token, not the stem's okurigana.
  for (const s of pool.exact.keys()) if (!hasKanji(s) && !pool.readings.has(s)) suffixes.add(s);
  for (const s of INFLECTION_ENDINGS) suffixes.delete(s);
  let maxSuffix = 0;
  for (const s of suffixes) if (s.length > maxSuffix) maxSuffix = s.length;
  let maxAux = 0;
  for (const s of AUX_FORMS) if (s.length > maxAux) maxAux = s.length;
  const byFirst = new Map<string, Surface[]>();
  for (const [s, cost] of costs) {
    const k = s.charAt(0);
    const b = byFirst.get(k) ?? [];
    b.push({ s, cost });
    byFirst.set(k, b);
  }
  for (const b of byFirst.values()) b.sort((a, c) => c.s.length - a.s.length || (a.s < c.s ? -1 : a.s > c.s ? 1 : 0));
  const stems = new Map<string, Stem[]>();
  for (const p of pool.prefixes) {
    const k = p.s.charAt(0);
    const b = stems.get(k) ?? [];
    const reading = !pool.kanaStage && pool.readings.has(p.surface);
    const whole = p.pos === 'adj-na' || p.pos === 'n-suru';
    const cur = b.find((x) => x.s === p.s);
    if (cur) {
      cur.reading = cur.reading && reading;
      cur.whole = cur.whole && whole;
    } else b.push({ s: p.s, one: p.s.length === 1, reading, whole });
    stems.set(k, b);
  }
  for (const b of stems.values()) b.sort((a, c) => c.s.length - a.s.length);
  const counters = [...new Set(pool.counters.map((c) => c.s))].filter(Boolean).sort((a, c) => c.length - a.length);
  idx = { byFirst, stems, counters, suffixes, maxSuffix, maxAux };
  SEGMENT_INDEX.set(pool, idx);
  return idx;
}

/** Length of the longest string in `list` that `plain` continues with at `off`, or 0. */
function longestAt(list: readonly string[], plain: string, off: number): number {
  for (const s of list) if (plain.startsWith(s, off)) return s.length;
  return 0;
}

/** Length of the longest string in `set` (≤ `max` characters) that `plain` ends with at `end`, or 0. */
function longestTail(set: ReadonlySet<string>, max: number, plain: string, start: number, end: number): number {
  for (let k = Math.min(max, end - start); k >= 1; k--) if (set.has(plain.slice(end - k, end))) return k;
  return 0;
}

/**
 * The stem candidate at `off`: the longest inflection stem that claims the
 * text here, extended over the hiragana that follows (okurigana and
 * inflection) and then trimmed the way the stories tokenise. From the right,
 * repeatedly: (1) an auxiliary form after て / で comes off (伸びて + いた,
 * 教えて + もらいました); otherwise (2) an inflection ending closes the word
 * (食べました, 高くない, 読んだ, 行きたい stay whole); otherwise (3) a particle,
 * copula, hint or kana word comes off (食べますか → 食べます + か; 歩きながら →
 * 歩き + ながら; 高くないです → 高くない + です). The bare stem may stand
 * (ren'yōkei: 見に行く). A な-adjective or する-noun is a whole word and takes
 * no extension (静か + な, 勉強 + します).
 */
function stemCandidateAt(idx: SegmentIndex, plain: string, off: number): { len: number; cost: number } | null {
  const bucket = idx.stems.get(plain.charAt(off));
  if (!bucket) return null;
  let stem: Stem | null = null;
  for (const p of bucket) {
    if (!plain.startsWith(p.s, off)) continue;
    if (p.one && !stemApplies(p.s, plain.slice(off))) continue;
    stem = p;
    break;
  }
  if (!stem) return null;
  const base = off + stem.s.length;
  let end = base;
  if (!stem.whole) {
    while (end < plain.length && HIRAGANA_CHAR_RE.test(plain.charAt(end))) end++;
    while (end > base) {
      // (1) the longest auxiliary, particle, hint or word that follows a て / で form comes off
      let cut = 0;
      for (let k = Math.min(Math.max(idx.maxAux, idx.maxSuffix), end - base - 1); k >= 1; k--) {
        const tail = plain.slice(end - k, end);
        if ((AUX_FORMS.has(tail) || idx.suffixes.has(tail)) && /[てで]$/.test(plain.slice(base, end - k))) {
          cut = k;
          break;
        }
      }
      if (cut > 0) {
        end -= cut;
        continue;
      }
      // (2) an inflection ending closes the word
      if (longestTail(INFLECTION_ENDINGS, 6, plain, base, end) > 0) break;
      // (3) a trailing particle, copula, hint or kana word comes off
      const k = longestTail(idx.suffixes, idx.maxSuffix, plain, base, end);
      if (k === 0) break;
      end -= k;
    }
  }
  // what remains after the stem is okurigana / inflection: short, or closed by an ending (旅行 is not 行 + にはお)
  const ext = end - base;
  if (ext > 2 && longestTail(INFLECTION_ENDINGS, 6, plain, base, end) === 0) return null;
  const len = end - off;
  return { len, cost: stem.reading ? readingCost(len) : contentCost(len) };
}

interface Candidate {
  len: number;
  cost: number;
  /** A word, name, numeral or stem the text cannot be unknown at: an unknown run neither starts here nor runs over it. */
  strong?: boolean;
}

interface Segmentation {
  tokens: string[];
  /** Per token: claimed by a surface, name, numeral or stem (true), or an unknown run (false). */
  known: boolean[];
}

/**
 * The minimum-cost segmentation (costs above) of `plain` over `pool`: the
 * cover by surfaces — words and alt forms, generated inflections, function
 * tokens, cast names and the text's `names` (with a name suffix), cloze
 * hints — kanji-numeral runs with the counter that follows them, inflection
 * stems with their okurigana (`stemCandidateAt`), and unknown runs. An
 * unknown run extends over hiragana freely and over a kanji or katakana only
 * where no known candidate starts (so it never swallows 水 in お水を, while
 * ごはん stays one run and is not carved into ご + は + ん). Punctuation is
 * free and always a boundary. Deterministic for a given pool and sentence.
 */
function segment(pool: MatchPool, plain: string, names: ReadonlySet<string>): Segmentation {
  const idx = segmentIndex(pool);
  const n = plain.length;
  const cands: Candidate[][] = new Array(n);
  const punct = new Array<number>(n).fill(0);
  const hiraAt = new Array<boolean>(n).fill(false);
  const allNames = [...names, ...CAST_NAMES];
  for (let i = 0; i < n; i++) {
    const c = String.fromCodePoint(plain.codePointAt(i) as number);
    const list: Candidate[] = [];
    cands[i] = list;
    hiraAt[i] = HIRAGANA_CHAR_RE.test(c);
    if (PUNCT_CHAR_RE.test(c)) {
      let end = i + c.length;
      while (end < n) {
        const d = String.fromCodePoint(plain.codePointAt(end) as number);
        if (!PUNCT_CHAR_RE.test(d)) break;
        end += d.length;
      }
      punct[i] = end - i;
      continue;
    }
    const hira = hiraAt[i] as boolean;
    // a strong surface: any word at a kanji / katakana, or a kana WORD of two or more characters that is not a bare reading. A function
    // token is never strong: the costs already carve a particle off an unknown run (は + まだ), while an unknown kana word that happens to
    // start with one (あるき = 歩き, からい = 辛い) must be free to stay one run instead of ある + き.
    for (const sf of idx.byFirst.get(c) ?? []) if (plain.startsWith(sf.s, i)) list.push({ len: sf.s.length, cost: sf.cost, strong: !hira || (sf.s.length >= 2 && sf.cost <= COST_TOKEN && !FUNCTION_TOKENS.has(sf.s)) });
    for (const nm of allNames) {
      if (!nm || !plain.startsWith(nm, i)) continue;
      list.push({ len: nm.length, cost: contentCost(nm.length), strong: true });
      const suffix = longestAt(NAME_SUFFIXES, plain, i + nm.length);
      if (suffix > 0) list.push({ len: nm.length + suffix, cost: contentCost(nm.length + suffix), strong: true });
    }
    if (KANJI_NUMERAL_CHAR_RE.test(c)) {
      let end = i + 1;
      while (end < n && KANJI_NUMERAL_CHAR_RE.test(plain.charAt(end))) end++;
      const counter = longestAt(idx.counters, plain, end);
      list.push({ len: end - i, cost: COST_FUNCTION, strong: true });
      if (counter > 0) list.push({ len: end + counter - i, cost: contentCost(end + counter - i), strong: true });
    }
    const stem = stemCandidateAt(idx, plain, i);
    if (stem) list.push({ ...stem, strong: !hira });
    // the honorific prefix before a kanji word (お水, ご両親)
    if (HONORIFIC_PREFIXES.has(c) && i + 1 < n && KANJI_CHAR_RE.test(plain.charAt(i + 1))) list.push({ len: 1, cost: COST_FUNCTION });
  }
  const strong = cands.map((list) => list.some((cd) => cd.strong === true));
  const best = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
  const next = new Array<number>(n + 1).fill(-1);
  const known = new Array<boolean>(n + 1).fill(false);
  best[n] = 0;
  const consider = (i: number, len: number, cost: number, isKnown: boolean): void => {
    const total = cost + (best[i + len] as number);
    if (total < (best[i] as number)) {
      best[i] = total;
      next[i] = i + len;
      known[i] = isKnown;
    }
  };
  for (let i = n - 1; i >= 0; i--) {
    if (punct[i]! > 0) {
      consider(i, punct[i]!, 0, true);
      continue;
    }
    for (const cd of cands[i]!) consider(i, cd.len, cd.cost, true);
    // an unknown run: any span of positions where no strong candidate starts, up to the next punctuation (a lone hiragana costs extra, `COST_UNKNOWN_LONE_HIRAGANA`)
    let end = i;
    while (end < n && punct[end]! === 0 && !strong[end]) {
      end += String.fromCodePoint(plain.codePointAt(end) as number).length;
      const len = end - i;
      consider(i, len, COST_UNKNOWN_RUN + COST_UNKNOWN_CHAR * len + (len === 1 && hiraAt[i] ? COST_UNKNOWN_LONE_HIRAGANA : 0), false);
    }
  }
  const tokens: string[] = [];
  const flags: boolean[] = [];
  let i = 0;
  while (i < n) {
    const j = next[i] as number;
    // adjacent unknown runs (the DP may cut one in two) are one token
    if (!known[i] && flags.length > 0 && !flags[flags.length - 1]) tokens[tokens.length - 1] += plain.slice(i, j);
    else {
      tokens.push(plain.slice(i, j));
      flags.push(known[i] as boolean);
    }
    i = j;
  }
  return { tokens, known: flags };
}

/**
 * Segments a plain sentence over `pool` (design 08 §4 step 1; `segment`
 * above). Punctuation is its own token; a run nothing claims is ONE unknown
 * token (りんご, コーヒー), never split. `names` are the text's proper nouns
 * (`StoryItem.names`), known like the cast.
 */
export function segmentSentence(pool: MatchPool, plain: string, names: ReadonlySet<string> = NO_NAMES): string[] {
  return segment(pool, plain, names).tokens;
}

export interface SentenceLink {
  /** Item ids the content tokens resolved to, deduplicated, in sentence order. */
  ids: string[];
  /** Tokens `matchToken` could not place (not a word, form, function token, name, numeral or punctuation). */
  unknown: number;
  /** The segmentation `ids` came from. */
  tokens: string[];
  /** The unknown tokens, in order (the rewrite report lists them). */
  unknownTokens: string[];
}

/**
 * Segments `plain` and links every token with `matchToken` (design 08 §4 step
 * 1). `unknown === 0` is the arbiter of "every content token links inside the
 * allowlist": an example sentence enters a pool iff it links with no unknown
 * token, and V46 (`validate-content.ts`) judges own-station examples by the
 * same call. The only token tolerated without a surface is the honorific
 * prefix (`strayOk`); a lone hiragana nothing claims is unknown.
 */
export function linkSentence(pool: MatchPool, plain: string, names: ReadonlySet<string> = NO_NAMES): SentenceLink {
  const { tokens, known } = segment(pool, plain, names);
  const ids: string[] = [];
  const unknownTokens: string[] = [];
  tokens.forEach((t, i) => {
    // A run no candidate claimed is unknown even when `matchToken` would place it (a stray substring of a cloze hint).
    if (!known[i]) {
      if (!strayOk(t)) unknownTokens.push(t);
      return;
    }
    const m = matchToken(pool, t, names);
    if (m.id !== null && !ids.includes(m.id)) ids.push(m.id);
    if (!m.known && !strayOk(t)) unknownTokens.push(t);
  });
  return { ids, unknown: unknownTokens.length, tokens, unknownTokens };
}

/* ── pools ───────────────────────────────────────────────────────────────── */

/** Speech estimate per clip (design 08 §2; `src/learn/pool.ts` uses the same constants): morae ÷ 7 s + 0.5 s. */
export const MORAE_PER_SECOND = 7;
export const CLIP_PAD_SECONDS = 0.5;

/**
 * Mora count of a sentence reading (the pool's `morae` field): `speechMorae(kana).length` (`src/shared/jp.ts`),
 * the one body the validator's V41 line cap, the clip indexes' `m` / `c` cues and the planner share —
 * punctuation and spaces dropped (`RE_NOT_MORA`), small kana folded, ー and っ one mora each.
 */
export function sentenceMorae(kana: string): number {
  return speechMorae(kana).length;
}

/** Seconds of speech a clip of `morae` morae takes (design 08 §2 estimate). */
export function speechSecondsFor(morae: number): number {
  return morae / MORAE_PER_SECOND + CLIP_PAD_SECONDS;
}

/** The pool file for station `n`, relative to the content root. */
export function poolPath(n: number): string {
  return `listening/pool-${String(n).padStart(2, '0')}.json`;
}

/** Group order inside a pool file: story lines, grammar examples, vocab examples (design 08 §4). */
const REF_GROUP: Readonly<Record<string, number>> = { s: 0, g: 1, v: 2 };

function parseRef(ref: string): { group: number; id: string; index: number } {
  const hash = ref.indexOf('#');
  const id = hash < 0 ? ref : ref.slice(0, hash);
  const index = hash < 0 ? 0 : Number(ref.slice(hash + 1).replace(/^(ex|L)/, ''));
  return { group: REF_GROUP[id.charAt(0)] ?? 3, id, index: Number.isFinite(index) ? index : 0 };
}

/** Pool order: stories, grammar, vocab; by id then example / line index. */
export function compareRefs(a: PoolRef, b: PoolRef): number {
  const x = parseRef(a.ref);
  const y = parseRef(b.ref);
  return x.group - y.group || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0) || x.index - y.index;
}

/**
 * Canonical pool serialization: the envelope pretty-printed, one `PoolRef`
 * per line (the sample in `scripts/__fixtures__/pool.sample.json`), so a
 * Black station's pool stays well under the 256 KiB hard budget
 * (`POOL_FILE_BUDGET_BYTES`; the largest shipped pool is ≈ 178 KB) while
 * remaining diff-friendly. Byte-stable for a given pool.
 */
export function stringifyPool(pool: ListeningPool): string {
  const refs = pool.refs.map((r) => `    ${JSON.stringify({ ref: r.ref, ids: r.ids, kana: r.kana, morae: r.morae }).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/\["/g, '[ "').replace(/"\]/g, '" ]').replace(/^\{"/, '{ "').replace(/\}$/, ' }')}`);
  return `{\n  "schema": ${JSON.stringify(pool.schema)},\n  "station": ${pool.station},\n  "refs": [${refs.length === 0 ? '' : `\n${refs.join(',\n')}\n  `}]\n}\n`;
}

interface PoolCorpusFile<T> {
  rel: string;
  items: T[];
}

function walkJson(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkJson(p, out);
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
}

function readContentFiles<T>(root: string, dir: string): PoolCorpusFile<T>[] {
  const out: PoolCorpusFile<T>[] = [];
  for (const abs of walkJson(join(root, dir))) {
    try {
      const env = JSON.parse(readFileSync(abs, 'utf8')) as { schema?: unknown; items?: unknown };
      if (env && env.schema === 'tsuzuku.content/1' && Array.isArray(env.items)) out.push({ rel: relative(root, abs).split(sep).join('/'), items: env.items as T[] });
    } catch {
      /* the validator reports broken JSON; a half-written file (a writer's atomic rename in flight) contributes nothing */
    }
  }
  return out;
}

/** Every item of the `tsuzuku.content/1` files under `<root>/<dir>` (a half-written file contributes nothing). */
export function readContentItems<T extends { id: string }>(root: string, dir: string): T[] {
  const out: T[] = [];
  for (const f of readContentFiles<T>(resolve(root), dir)) for (const it of f.items) if (it && typeof it === 'object' && typeof it.id === 'string') out.push(it);
  return out;
}

/** What `buildPools` reads from the content root (also what `checkPools` re-reads). */
export interface PoolCorpus {
  vocab: VocabItem[];
  grammar: GrammarItem[];
  stories: StoryItem[];
}

export function readPoolCorpus(root: string): PoolCorpus {
  return { vocab: readContentItems<VocabItem>(root, 'vocab'), grammar: readContentItems<GrammarItem>(root, 'grammar'), stories: readContentItems<StoryItem>(root, 'stories') };
}

/** A sentence the pool builder judged: where it landed, or why it did not. */
export interface PoolVerdict {
  ref: string;
  /** Owner's station (the item's `station`, the text's station). */
  station: number;
  /** Pool station (`max(station of ids)`, floored at the owner's station — or, for an example the segmenter only covers with a later pool's surfaces, at that pool's station), or null when the sentence enters no pool. */
  knownAt: number | null;
  /** The ref's ids: an example's owner item first, then its linked content tokens; a story line's non-null `tokenIds`. */
  ids: string[];
  /** Unknown tokens (an example: against the whole corpus; a story line: against its own pool); empty when `knownAt` is set. */
  unknownTokens: string[];
  /** True when the sentence is all-known at the owner's station: an example that links inside the cumulative allowlist ≤ its item's station (the V46 condition), a story line whose `knownAt` is its text's station. */
  ownStation: boolean;
  plain: string;
  kana: string;
  morae: number;
}

export interface BuiltPools {
  pools: ListeningPool[];
  /** Every sentence judged, in corpus order (the rewrite report reads the ones with `knownAt === null`). */
  verdicts: PoolVerdict[];
}

/**
 * The cumulative match pool at `station` (Stations 1–3 share the White set,
 * `allowlistStationFor`), built lazily and cached: bundle order is insertion
 * order, so collisions resolve as they do for the stories. With `plus` (a
 * text's plusOne ids) the pool is the one `linkStories` linked that text
 * against — the allowlist plus those words — built fresh, not cached.
 */
export function stationPools(bundles: readonly StationBundle[], corpus: Pick<PoolCorpus, 'vocab' | 'grammar'>): (n: number, plus?: ReadonlySet<string>) => MatchPool {
  const vocabById = new Map(corpus.vocab.map((v) => [v.id, v]));
  const grammarById = new Map(corpus.grammar.map((g) => [g.id, g]));
  const cache = new Map<number, MatchPool>();
  return (n: number, plus?: ReadonlySet<string>): MatchPool => {
    const upTo = allowlistStationFor(n);
    const plain = plus === undefined || plus.size === 0;
    if (plain) {
      const cached = cache.get(upTo);
      if (cached) return cached;
    }
    const vocab = [...cumulativeIds(bundles, upTo, 'vocabIds')].map((id) => vocabById.get(id)).filter((v): v is VocabItem => v !== undefined);
    const grammar = [...cumulativeIds(bundles, upTo, 'grammarIds')].map((id) => grammarById.get(id)).filter((g): g is GrammarItem => g !== undefined);
    const plusItems = plain ? [] : [...(plus as ReadonlySet<string>)].map((id) => vocabById.get(id)).filter((v): v is VocabItem => v !== undefined);
    const p = buildMatchPool(vocab, grammar, plusItems, { kanaStage: upTo <= 3 });
    if (plain) cache.set(upTo, p);
    return p;
  };
}

/** The plusOne ids of a text (every line's `plusOne`), the words its own match pool holds beyond the allowlist. */
export function plusOneIdsOf(s: Pick<StoryItem, 'lines'>): ReadonlySet<string> {
  const out = new Set<string>();
  if (!Array.isArray(s.lines)) return out;
  for (const ln of s.lines) if (ln && Array.isArray(ln.plusOne)) for (const p of ln.plusOne) if (typeof p === 'string') out.add(p);
  return out;
}

function stationOfText(stationId: unknown): number | null {
  const m = /^st-(\d{2})$/.exec(String(stationId));
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * Builds the 53 listening pools (design 08 §4 step 2) from the content on
 * disk and the station bundles. Every sentence whose content tokens all link
 * enters the pool of `knownAt = max(station of ids)`:
 *
 *  - A vocab / grammar **example** is segmented and linked by `linkSentence`,
 *    first against its item's cumulative allowlist (the V46 arbiter:
 *    `ownStation`), then against the whole corpus; one with an unknown token
 *    against the whole corpus enters no pool (a rewrite candidate the report
 *    lists). Its ids start with its own item (V16 guarantees the sentence
 *    contains it — a numeral, counter or suffix the segmenter leaves unlinked
 *    is still the sentence's point), so `knownAt` is never before the station
 *    the item is introduced.
 *  - A **story line** enters by its writers' tokenisation, not by the
 *    segmenter: its ids are its non-null `tokenIds` (what `linkStories`
 *    linked against the text's allowlist + plusOne words), it is admitted iff
 *    every other token is known to that same pool (function token, name,
 *    numeral, punctuation — `matchToken`), and it lands at
 *    `max(text station, stations of its ids)`: an own-station line at its
 *    text, a plusOne line where the plusOne word is introduced. A line with an
 *    unknown content token enters no pool; one not yet linked (a fresh piece
 *    before its strict run) contributes nothing.
 *
 * A sentence of function tokens only (はい。) has no id and sits at its
 * owner's station. Deterministic from the files on disk: refs sorted stories
 * → grammar → vocab, by id then index.
 */
export function buildPools(root: string, bundles: readonly StationBundle[], corpus: PoolCorpus = readPoolCorpus(root)): BuiltPools {
  const last = bundles.reduce((m, b) => Math.max(m, b.number), 0);
  const stationOfId = new Map<string, number>();
  for (const b of bundles) {
    for (const id of b.vocabIds ?? []) stationOfId.set(id, b.number);
    for (const id of b.grammarIds ?? []) stationOfId.set(id, b.number);
  }
  const poolFor = stationPools(bundles, corpus);
  const full = poolFor(last);
  const perStation = new Map<number, PoolRef[]>();
  const verdicts: PoolVerdict[] = [];
  /**
   * Records the verdict and, when every token is known and every id has a station, the ref at `max(floor, stations of ids)` —
   * `floor` is the owner's station (a text's station for a line; for an example, the station whose pool the sentence was settled
   * against, which is the item's own station unless the segmentation needed a later pool's surfaces).
   */
  const admit = (ref: string, station: number, floor: number, plain: string, kana: string, ids: string[], unknownTokens: string[], ownStation: boolean | null, stationOf: (id: string) => number | undefined): void => {
    const morae = sentenceMorae(kana);
    let knownAt: number | null = null;
    if (unknownTokens.length === 0) {
      knownAt = Math.max(station, floor);
      for (const id of ids) {
        const s = stationOf(id);
        if (s === undefined) {
          knownAt = null;
          break;
        }
        if (s > knownAt) knownAt = s;
      }
    }
    verdicts.push({ ref, station, knownAt, ids, unknownTokens, ownStation: ownStation ?? knownAt === station, plain, kana, morae });
    if (knownAt === null) return;
    const arr = perStation.get(knownAt) ?? [];
    arr.push({ ref, ids, kana, morae });
    perStation.set(knownAt, arr);
  };
  const examplesOf = (items: readonly (VocabItem | GrammarItem)[]): void => {
    for (const it of items) {
      const station = typeof it.station === 'number' ? it.station : stationOfId.get(it.id);
      if (station === undefined || !Array.isArray(it.examples)) continue;
      // the owner's own station stands in when the bundles do not list it (an item placed by hand)
      const stationOf = (id: string): number | undefined => stationOfId.get(id) ?? (id === it.id ? station : undefined);
      /** `max(station, stations of ids)`, or null when an id has no station. */
      const latest = (ids: readonly string[]): number | null => {
        let m = station;
        for (const id of ids) {
          const s = stationOf(id);
          if (s === undefined) return null;
          if (s > m) m = s;
        }
        return m;
      };
      it.examples.forEach((ex: SentenceExample, k: number) => {
        if (!ex || typeof ex.ja !== 'string') return;
        const plain = toPlain(ex.ja);
        const kana = typeof ex.kana === 'string' ? ex.kana : '';
        const own = linkSentence(poolFor(station), plain);
        const ownStation = own.unknown === 0;
        let r = own;
        let floor = station;
        if (!ownStation) {
          // Against the whole corpus first (an unknown there is final: a rewrite candidate), then settled at the first station ≥ the
          // latest id's whose own cumulative pool links the sentence all-known — the segmentation depends on the pool's surfaces, so
          // the station the sentence lands in is the one its learner's allowlist actually covers it at (13 refs in 10,000 differ).
          r = linkSentence(full, plain);
          if (r.unknown === 0) {
            // (an id outside every bundle leaves the loop unsettled; `admit` then finds no station for it and places nothing)
            let k = latest(r.ids);
            while (k !== null && k <= last) {
              const at = linkSentence(poolFor(k), plain);
              const m = at.unknown === 0 ? latest(at.ids) : null;
              if (at.unknown === 0 && m !== null && m <= k) {
                r = at;
                floor = k;
                break;
              }
              k = m === null || m <= k ? k + 1 : m;
            }
          }
        }
        const ids = [it.id, ...r.ids.filter((id) => id !== it.id)];
        admit(`${it.id}#ex${k}`, station, floor, plain, kana, ids, r.unknown === 0 ? [] : r.unknownTokens, ownStation, stationOf);
      });
    }
  };
  examplesOf(corpus.vocab);
  examplesOf(corpus.grammar);
  const stationOf = (id: string): number | undefined => stationOfId.get(id);
  for (const s of corpus.stories) {
    const station = stationOfText(s.stationId);
    if (station === null || !Array.isArray(s.lines)) continue;
    const names: ReadonlySet<string> = new Set(Array.isArray(s.names) ? s.names.filter((x): x is string => typeof x === 'string') : []);
    // the text's own pool, as `linkStories` built it: the cumulative allowlist plus the text's plusOne words
    const pool = poolFor(station, plusOneIdsOf(s));
    s.lines.forEach((ln, i) => {
      if (!ln || typeof ln.ja !== 'string' || !Array.isArray(ln.tokens) || !Array.isArray(ln.tokenIds) || ln.tokenIds.length !== ln.tokens.length) return;
      const plain = toPlain(ln.ja);
      const kana = typeof ln.kana === 'string' ? ln.kana : '';
      const ids: string[] = [];
      const unknownTokens: string[] = [];
      ln.tokens.forEach((t, j) => {
        const id = ln.tokenIds![j];
        if (typeof id === 'string') {
          if (!ids.includes(id)) ids.push(id);
          return;
        }
        if (typeof t !== 'string' || !matchToken(pool, t, names).known) unknownTokens.push(String(t));
      });
      admit(`${s.id}#L${i}`, station, station, plain, kana, ids, unknownTokens, null, stationOf);
    });
  }
  const pools: ListeningPool[] = [];
  for (const b of [...bundles].sort((x, y) => x.number - y.number)) {
    const refs = (perStation.get(b.number) ?? []).sort(compareRefs);
    pools.push({ schema: 'tsuzuku.pool/1', station: b.number, refs });
  }
  return { pools, verdicts };
}

/** The pools alone (the plan row's `buildPools(root, bundles): ListeningPool[]` shape); `buildPools` also returns the verdicts. */
export function buildPoolFiles(root: string, bundles: readonly StationBundle[], corpus?: PoolCorpus): ListeningPool[] {
  return buildPools(root, bundles, corpus).pools;
}
