/**
 * TSUZUKU — per-clip verification of a VOICEVOX `audio_query` (design 08 §7 step 3).
 *
 * Pure functions over the engine's query JSON and the content kana:
 *
 *  - **Morae.** The engine's moras (`accent_phrases[].moras[].text`, `pause_mora`
 *    dropped) must equal `moraSplit(kana)` under the LENIENT FOLD: katakana →
 *    hiragana, は/わ, へ/え, を/お, ぢ/じ, づ/ず, and long vowels canonical (おう /
 *    おお / えい / ええ / いい and ー all become ー so とうきょう ≡ トオキョオ).
 *    The fold is applied per mora on BOTH sides, so alignment is kept 1:1.
 *  - **Accent.** For a `pitchConfidence: high` word `accent_phrases[0].accent`
 *    must equal `pitch`, with VOICEVOX's convention for heiban: 0 ↔ the mora
 *    count. `withAccent()` returns the override query (design 08 §15: the only
 *    words the app grades for pitch are rendered with the dictionary accent).
 *  - **Ladder strings.** `kanaPatch()` builds the step-2 `is_kana=true` query
 *    text: the engine's own `kana` (AquesTalk notation: `ナ'ニデモ/タベ'ル`, `'`
 *    after the accent mora, `/` between phrases, `、` for a pause, `？` for a
 *    question) with the misread span replaced by the content kana, so the
 *    engine keeps its phrasing and accents and only the wrong morae change.
 *    The replacement is written in the ENGINE's notation (`engineMorae`): the
 *    is_kana parser rejects ー (measured: `コーヒー'` → HTTP 400, `コオヒイ'` →
 *    200), so every ー of the content kana is expanded to the preceding vowel
 *    with `expandLongVowelMark` before it is katakana-ized.
 *    `kanaText()` is the step-3 fallback (the content kana as plain text).
 *  - **Minimal-pair partner.** `synthesizeMinimalPair()` is the partner the
 *    runtime keys as `<itemId>#pair` (`src/exercises/listening/MinimalPair.tsx`
 *    `pairClipKey`): re-exported from `src/learn/distractors.ts` (one body for
 *    the drill and the pack; ARCHITECTURE §0 lists it among the modules the
 *    script tier may import, and `render-audio.test.ts` asserts the identity).
 *
 * Ladder (design 08 §7): 0 surface → 1 user-dict the offending `tokenIds` word →
 * 2 kana patch → 3 kana text → skip (`.audio-cache/skipped.jsonl`). A skipped
 * clip is covered by `speechSynthesis`; silence never ships.
 */
import { expandLongVowelMark, moraSplit, normalizeJa, toHiragana, toKatakana } from '../../src/shared/jp.ts';

/* ── engine shapes (VOICEVOX 0.25.2 /audio_query) ─────────────────────── */

export interface VvMora {
  text: string;
  consonant: string | null;
  consonant_length: number | null;
  vowel: string;
  vowel_length: number;
  pitch: number;
}

export interface VvAccentPhrase {
  moras: VvMora[];
  accent: number;
  pause_mora: VvMora | null;
  is_interrogative?: boolean;
}

export interface AudioQuery {
  accent_phrases: VvAccentPhrase[];
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volumeScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
  pauseLength?: number | null;
  pauseLengthScale?: number;
  outputSamplingRate: number;
  outputStereo: boolean;
  kana?: string;
}

/** The four rungs before a skip (design 08 §7 step 3). */
export const LADDER = ['surface', 'user-dict', 'kana-patch', 'kana-text'] as const;
export type LadderStep = (typeof LADDER)[number];

/* ── lenient fold ──────────────────────────────────────────────────────── */

const VOWEL_OF: Record<string, string> = {};
{
  const rows: [string, string][] = [
    ['あかさたなはまやらわがざだばぱぁゃゎ', 'あ'],
    ['いきしちにひみりゐぎじぢびぴぃ', 'い'],
    ['うくすつぬふむゆるぐずづぶぷぅゅゔ', 'う'],
    ['えけせてねへめれゑげぜでべぺぇ', 'え'],
    ['おこそとのほもよろをごぞどぼぽぉょ', 'お'],
  ];
  for (const [chars, v] of rows) for (const ch of chars) VOWEL_OF[ch] = v;
}

/** The vowel a mora ends in (ん / っ / ー have none). */
function vowelOf(mora: string): string | undefined {
  const last = mora[mora.length - 1] as string;
  return VOWEL_OF[last];
}

/** Lenient fold of ONE mora (hiragana in, hiragana out): は→わ, へ→え, を→お, ぢ→じ, づ→ず. */
export function foldMora(mora: string): string {
  const h = toHiragana(mora);
  if (h === 'は') return 'わ';
  if (h === 'へ') return 'え';
  if (h === 'を') return 'お';
  if (h === 'ぢ') return 'じ';
  if (h === 'づ') return 'ず';
  return h;
}

/**
 * Folds a mora sequence leniently, keeping one entry per mora: each mora
 * through `foldMora`, then a bare vowel that extends the previous mora's vowel
 * (おう / おお after an お-row mora, えい / ええ after an え-row mora, あ after あ,
 * い after い, う after う) becomes ー. The same fold runs on both sides, so
 * とうきょう and the engine's トオキョオ compare equal.
 */
export function foldMorae(morae: readonly string[]): string[] {
  const out: string[] = [];
  // The vowel the running sound currently ends in (survives a folded ー, so とおい keeps its い).
  let prevVowel: string | undefined;
  for (const raw of morae) {
    const m = foldMora(raw);
    if (out.length > 0 && 'あいうえお'.includes(m)) {
      const extends_ = prevVowel === m || (prevVowel === 'お' && m === 'う') || (prevVowel === 'え' && m === 'い');
      if (extends_) {
        out.push('ー');
        continue;
      }
    }
    out.push(m);
    if (m !== 'ー') prevVowel = vowelOf(m);
  }
  return out;
}

/** The content kana as folded morae: NFKC, punctuation and spaces dropped, `moraSplit`, lenient fold. */
export function lenientMorae(kana: string): string[] {
  return foldMorae(moraSplit(normalizeJa(kana)));
}

/**
 * The content kana as the ENGINE writes morae: NFKC, punctuation dropped, every
 * ー expanded to the preceding vowel (コーヒー → コオヒイ, クォーツ → クォオツ),
 * katakana, one entry per mora. This is the only form the `is_kana=true`
 * parser accepts, so every ladder string is built from it; folded with
 * `foldMorae` it equals `lenientMorae(kana)` (a ー and its expansion fold alike).
 */
export function engineMorae(kana: string): string[] {
  return moraSplit(toKatakana(expandLongVowelMark(toHiragana(normalizeJa(kana)))));
}

/** The engine's moras in order (`pause_mora` dropped), folded the same way. */
export function queryMorae(q: AudioQuery): string[] {
  const raw: string[] = [];
  for (const p of q.accent_phrases) for (const m of p.moras) raw.push(m.text);
  return foldMorae(raw);
}

/** Raw mora texts of the query (katakana, as the engine returns them), `pause_mora` dropped. */
export function rawQueryMorae(q: AudioQuery): string[] {
  const raw: string[] = [];
  for (const p of q.accent_phrases) for (const m of p.moras) raw.push(m.text);
  return raw;
}

export interface MoraVerdict {
  ok: boolean;
  /** Folded morae the engine would speak. */
  got: string[];
  /** Folded morae the content kana expects. */
  want: string[];
}

/** Step (a) of design 08 §7: the query speaks exactly the content kana under the lenient fold. */
export function verifyMorae(q: AudioQuery, kana: string): MoraVerdict {
  const got = queryMorae(q);
  const want = lenientMorae(kana);
  return { ok: got.length === want.length && got.every((m, i) => m === want[i]), got, want };
}

/* ── accent ────────────────────────────────────────────────────────────── */

/** VOICEVOX's accent for a dictionary `pitch`: 0 (heiban) ↔ the mora count, else the nucleus position. */
export function expectedAccent(pitch: number, moraCount: number): number {
  if (pitch <= 0) return moraCount;
  return Math.min(pitch, moraCount);
}

export interface AccentVerdict {
  ok: boolean;
  got: number;
  want: number;
}

/** Step (b): `accent_phrases[0].accent` equals the dictionary pitch (heiban 0 ↔ mora count). */
export function verifyAccent(q: AudioQuery, pitch: number): AccentVerdict {
  const first = q.accent_phrases[0];
  if (!first) return { ok: false, got: -1, want: expectedAccent(pitch, 0) };
  const want = expectedAccent(pitch, first.moras.length);
  return { ok: first.accent === want, got: first.accent, want };
}

/** A copy of `q` whose first accent phrase carries `accent` (clamped to its mora count). */
export function withAccent(q: AudioQuery, accent: number): AudioQuery {
  const copy = structuredClone(q);
  const first = copy.accent_phrases[0];
  if (first) first.accent = Math.max(1, Math.min(accent, first.moras.length));
  copy.kana = toAquesTalk(copy);
  return copy;
}

/* ── AquesTalk notation (the engine's `kana` field; `is_kana=true` input) ── */

/**
 * Serialises accent phrases in the engine's kana notation: mora texts with `'`
 * after the accent mora (heiban → `'` at the end), `/` between phrases, `、`
 * where a phrase ends in a pause, `？` after an interrogative phrase. Unvoiced
 * marks (`_`) are not emitted; the parser treats their absence as voiced.
 */
export function toAquesTalk(q: Pick<AudioQuery, 'accent_phrases'>): string {
  const parts: string[] = [];
  q.accent_phrases.forEach((p, i) => {
    let s = '';
    p.moras.forEach((m, k) => {
      s += toKatakana(m.text);
      if (k + 1 === p.accent) s += "'";
    });
    if (p.is_interrogative) s += '？';
    const last = i === q.accent_phrases.length - 1;
    parts.push(s + (last ? '' : p.pause_mora ? '、' : '/'));
  });
  return parts.join('');
}

/**
 * Step 2 of the ladder: the engine's phrasing with the misread span replaced
 * by the content kana. The common prefix and suffix of the folded morae stay;
 * the phrases covering the differing middle are merged into one phrase whose
 * moras are `got[prefix] + want[middle] + got[suffix]`, keeping the first
 * covered phrase's accent (clamped) and the last one's pause. Returns `null`
 * when the morae already match (nothing to patch).
 */
export function kanaPatch(q: AudioQuery, kana: string): string | null {
  const v = verifyMorae(q, kana);
  if (v.ok) return null;
  // Engine notation: ー expanded, so the patch never carries a mark the is_kana parser rejects.
  const want = engineMorae(kana);
  const gotRaw = rawQueryMorae(q);
  const gotF = v.got;
  const wantF = foldMorae(want);
  let pre = 0;
  while (pre < gotF.length && pre < wantF.length && gotF[pre] === wantF[pre]) pre++;
  let suf = 0;
  while (suf < gotF.length - pre && suf < wantF.length - pre && gotF[gotF.length - 1 - suf] === wantF[wantF.length - 1 - suf]) suf++;
  // A folded ー at the start of the suffix depends on the mora before it (inside the middle): take it into the middle.
  while (suf > 0 && (gotF[gotF.length - suf] === 'ー' || wantF[wantF.length - suf] === 'ー')) suf--;
  const gotEnd = gotRaw.length - suf;
  const middle = want.slice(pre, want.length - suf).map((m) => toKatakana(m));

  // Phrase spans over the raw mora list.
  const spans: { start: number; end: number; p: VvAccentPhrase }[] = [];
  let at = 0;
  for (const p of q.accent_phrases) {
    spans.push({ start: at, end: at + p.moras.length, p });
    at += p.moras.length;
  }
  const covered = spans.filter((s) => s.end > pre && s.start < gotEnd);
  const before = spans.filter((s) => s.end <= pre);
  const after = spans.filter((s) => s.start >= gotEnd);
  const phrases: VvAccentPhrase[] = before.map((s) => s.p);
  if (covered.length > 0) {
    const first = covered[0] as { start: number; end: number; p: VvAccentPhrase };
    const last = covered[covered.length - 1] as { start: number; end: number; p: VvAccentPhrase };
    const head = gotRaw.slice(first.start, Math.max(first.start, pre));
    const tail = gotRaw.slice(Math.min(last.end, gotEnd), last.end);
    const moras = [...head, ...middle, ...tail].map((text) => ({ text, consonant: null, consonant_length: null, vowel: '', vowel_length: 0, pitch: 0 }));
    const accent = Math.max(1, Math.min(first.p.accent, moras.length));
    phrases.push({ moras, accent, pause_mora: last.p.pause_mora, is_interrogative: last.p.is_interrogative ?? false });
  } else {
    // The difference sits at a phrase boundary (pure insertion): attach it to the previous phrase, or open one.
    const moras = middle.map((text) => ({ text, consonant: null, consonant_length: null, vowel: '', vowel_length: 0, pitch: 0 }));
    const prev = phrases.pop();
    if (prev) phrases.push({ ...prev, moras: [...prev.moras, ...moras] });
    else if (moras.length > 0) phrases.push({ moras, accent: moras.length, pause_mora: null, is_interrogative: false });
  }
  phrases.push(...after.map((s) => s.p));
  return toAquesTalk({ accent_phrases: phrases });
}

/** Step 3 of the ladder: the content kana as plain text (katakana loanwords stay katakana; spaces dropped). */
export function kanaText(kana: string): string {
  return kana.replace(/[\s　]+/g, '');
}

/* ── minimal-pair partner ───────────────────────────────────────────────── */

/**
 * The minimal-pair partner the runtime synthesizes for a word with no corpus
 * neighbour, keyed `<itemId>#pair` by `pairClipKey`: ONE body, re-exported
 * from `src/learn/distractors.ts` (node-importable, listed in ARCHITECTURE §0
 * among the modules scripts may import), so the rendered `#pair` clip and the
 * drill's synthesized distractor can never drift apart
 * (`render-audio.test.ts` asserts the import identity).
 */
export { synthesizeMinimalPair } from '../../src/learn/distractors.ts';

/**
 * Builds an `AudioQuery` from re-queried accent phrases (`/accent_phrases`),
 * keeping every other field of the original query (speed, pitch, pauses…).
 */
export function withAccentPhrases(q: AudioQuery, phrases: VvAccentPhrase[]): AudioQuery {
  const copy = structuredClone(q);
  copy.accent_phrases = structuredClone(phrases);
  copy.kana = toAquesTalk(copy);
  return copy;
}

/* ── timing helpers shared with indexes.ts ─────────────────────────────── */

/** Seconds of audio the query will produce: (pre + Σ moras incl. pauses + post) / speedScale. */
export function queryDuration(q: AudioQuery): number {
  let s = q.prePhonemeLength + q.postPhonemeLength;
  const pauseScale = q.pauseLengthScale ?? 1;
  for (const p of q.accent_phrases) {
    for (const m of p.moras) s += (m.consonant_length ?? 0) + m.vowel_length;
    if (p.pause_mora) s += (q.pauseLength ?? p.pause_mora.vowel_length) * pauseScale;
  }
  return s / q.speedScale;
}

/** Index (into the raw mora list) of each accent-phrase end that carries a pause. */
export function pauseMoraIndexes(q: AudioQuery): number[] {
  const out: number[] = [];
  let at = 0;
  for (const p of q.accent_phrases) {
    at += p.moras.length;
    if (p.pause_mora) out.push(at);
  }
  return out;
}
