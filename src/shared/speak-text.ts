/**
 * TSUZUKU — what the voice engine is handed (design 08 §7, ARCHITECTURE §0/§3).
 *
 * The two text cleaners that every speaking surface and the audio render
 * pipeline agree on, moved here from `src/audio/tts.ts` so that Node can
 * import them: this module is pure (no store, no signals, no DOM) and imports
 * `content/ruby.ts` with its extension, so `scripts/audio/render-audio.ts`
 * hands VOICEVOX exactly the string `speak()` would hand `speechSynthesis`
 * (`textToSpeak(toPlain(ja), kana)`), and the clip and the caller agree.
 *
 *  - `stripDisplayMarks(text)`: the marks a card shows but a voice must not
 *    read — leading / trailing 〜 ～ ~ (〜てはいけない → てはいけない), an
 *    interior 〜 slot and … ‥ runs become a pause (、), 「」 around a bare
 *    pattern are unwrapped, a parenthetical is unwrapped when it is a 1–2 kana
 *    optional piece (〜なくして(は) → なくしては, (ら)れる → られる) and dropped
 *    otherwise ((N), (V), (imperative)), and a spaced / or ／ between
 *    alternatives becomes a pause. Ruby must already be stripped; real
 *    sentence text is untouched. Returns '' when nothing speakable is left.
 *  - `textToSpeak(text, kana?)`: the plain surface (ruby stripped, display
 *    marks removed) for sentences; the kana reading for an isolated word when
 *    the caller supplied one (単漢字 like 日 / 人 are misread in isolation).
 *
 * `src/audio/tts.ts` and `@/audio` re-export both, so existing importers keep
 * working. Behaviour is byte-identical to the tts.ts bodies this replaces.
 */
import { toPlain } from '../content/ruby.ts';

/** Isolated word: speak the kana when given (≤ this many plain chars, no sentence punctuation). Design 08 §7. */
export const WORD_MAX_CHARS = 8;

const SENTENCE_PUNCT_RE = /[。！？!?．.]/;

/** 〜 ～ ~ at either edge of the text (with any whitespace around them). */
const EDGE_TILDE_RE = /^[\s　]*[〜～~]+[\s　]*|[\s　]*[〜～~]+[\s　]*$/g;
/** An interior 〜 slot (〜より〜のほうが); a 〜 between digits (10〜20) is a real range and stays. */
const INNER_TILDE_RE = /(?<![0-9０-９])[〜～~]+(?![0-9０-９])/g;
/** Ellipsis runs: … ‥ or three or more dots. */
const ELLIPSIS_RE = /[…‥]+|[.．]{3,}/g;
/** One parenthetical, half- or full-width, no nesting. */
const PAREN_RE = /[（(]\s*([^（）()]*?)\s*[）)]/g;
/** An optional particle / okurigana shown in parentheses: (は) (に) (さ) (ら) (よ) (も). */
const OPTIONAL_KANA_RE = /^[ぁ-ゖァ-ヺー]{1,2}$/;
/** A whole text wrapped in one pair of corner quotes. */
const BARE_QUOTE_RE = /^[「『]([^「」『』]*)[」』]$/;
/** A spaced slash or a full-width one between alternatives (〜ゆえに / 〜ゆえの). */
const ALT_SLASH_RE = /[\s　]*[／/][\s　]*/g;
/** Pause clean-up: runs, a pause before other punctuation, after an opening quote, at either end. */
const PAUSE_RUN_RE = /、{2,}/g;
const PAUSE_BEFORE_PUNCT_RE = /、(?=[。、，，！？!?.．」』])/g;
const PAUSE_AFTER_OPEN_RE = /(?<=[「『])、/g;
const PAUSE_EDGE_RE = /^、+|、+$/g;
const HAS_SPEAKABLE_RE = /[\p{L}\p{N}]/u;

/**
 * Removes the marks a card shows but a voice must not read: leading / trailing
 * 〜 ～ ~, an interior 〜 slot and … ‥ runs (→ 、), 「」 around a bare pattern,
 * a spaced / between alternatives (→ 、) and parentheticals — unwrapped when
 * they hold a 1–2 kana optional piece ((は), (ら)), dropped otherwise ((N),
 * (V), (imperative)). Ruby must already be stripped. Returns '' when nothing
 * speakable is left, so `speak()` resolves without an utterance. Design 08 §7.
 */
export function stripDisplayMarks(text: string): string {
  let s = text.trim();
  const bare = BARE_QUOTE_RE.exec(s);
  if (bare) s = (bare[1] as string).trim();
  s = s.replace(PAREN_RE, (_m, inner: string) => (OPTIONAL_KANA_RE.test(inner) ? inner : ''));
  s = s.replace(EDGE_TILDE_RE, '');
  s = s.replace(INNER_TILDE_RE, '、');
  s = s.replace(ELLIPSIS_RE, '、');
  s = s.replace(ALT_SLASH_RE, '、');
  s = s.replace(PAUSE_RUN_RE, '、').replace(PAUSE_BEFORE_PUNCT_RE, '').replace(PAUSE_AFTER_OPEN_RE, '').replace(PAUSE_EDGE_RE, '');
  s = s.replace(/[ \t]{2,}/g, ' ').trim();
  return HAS_SPEAKABLE_RE.test(s) ? s : '';
}

/**
 * What to hand the engine: the plain surface (ruby stripped, display marks
 * removed by `stripDisplayMarks`) for sentences; the kana reading for an
 * isolated word when the caller supplied one (単漢字 like 日 / 人 are misread
 * in isolation, sentences are not). The word test runs on the cleaned
 * surface, so 〜放題 with kana ほうだい speaks ほうだい. Design 08 §7: the render
 * pipeline calls this with `toPlain(ja)` so clip text and spoken text agree.
 */
export function textToSpeak(text: string, kana?: string): string {
  const plain = stripDisplayMarks(toPlain(text));
  if (kana) {
    const reading = stripDisplayMarks(kana);
    if (reading.length > 0) {
      const isWord = !SENTENCE_PUNCT_RE.test(plain) && Array.from(plain).length <= WORD_MAX_CHARS && !/[\s　]/.test(plain);
      if (isWord) return reading;
    }
  }
  return plain;
}
