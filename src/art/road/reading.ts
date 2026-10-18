/**
 * TSUZUKU — readings and signage rules for the road (design 09 §3.3).
 *
 *  kanaReading(romaji)   the kana line of a `.sign` once kana are Green: the
 *                        station's romaji (`STATIONS[n].nameRomaji`) as
 *                        hiragana — ほどがや, おおつ, さんじょうおおはし — the
 *                        way a station sign or furigana writes a native place
 *                        name. Long vowels and the one づ are spelt by
 *                        `KANA_OVERRIDE` (romaji macrons do not say おお / おう
 *                        / づ); everything else is `wanakana` toHiragana.
 *  romajiAllowed(belt)   §3.3's rule: romaji "appears only while the learner's
 *                        kana are below Green" — read from the belt the store
 *                        holds (`profile.belt`): White, Yellow and Orange see
 *                        romaji; from Green on the reading line is kana (ruby).
 *  signRubyMode(mode)    signage inside a link never renders a tap-to-reveal
 *                        ruby (an interactive element nested in an `<a>`, an
 *                        extra tab stop in the roving list): `tap` reads as
 *                        `always` — a proper name cannot be sounded out, §3.3's
 *                        sanctioned exception — `off` stays plain.
 *  ordinalJa(n)          第N宿 in the Shippori `shell` glyphs (第, 宿, 一〜十).
 * `src/session/RoadNav.tsx` carries the same four rules for the session tier
 * (the two groups may not import each other, ARCHITECTURE §0);
 * `reading.test.ts` holds them to the same answers.
 */
import { toHiragana } from 'wanakana';
import { BELT_IDS, type Belt } from '../../content/types';
import type { FuriganaMode } from '../../shared/store-types';
import { kanjiNumber } from '../wallpapers/strings-1';

/** Native spellings romaji cannot carry (long vowels, づ), keyed by the content's romaji. */
export const KANA_OVERRIDE: Readonly<Record<string, string>> = {
  Ōiso: 'おおいそ',
  Numazu: 'ぬまづ',
  Fuchū: 'ふちゅう',
  Chiryū: 'ちりゅう',
  Shōno: 'しょうの',
  Ōtsu: 'おおつ',
  'Sanjō Ōhashi': 'さんじょうおおはし',
};

const PLAIN_VOWEL: Record<string, string> = { ā: 'a', ī: 'i', ū: 'u', ē: 'e', ō: 'o', Ā: 'A', Ī: 'I', Ū: 'U', Ē: 'E', Ō: 'O' };

/** Hiragana reading of a romaji place name; `''` when the romaji is not fully convertible. */
export function kanaReading(romaji: string): string {
  const t = romaji.trim();
  if (t === '') return '';
  const fixed = KANA_OVERRIDE[t];
  if (fixed) return fixed;
  const k = toHiragana(t.replace(/[āīūēōĀĪŪĒŌ]/g, (m) => PLAIN_VOWEL[m] ?? m));
  return /[A-Za-z]/.test(k) ? '' : k;
}

const GREEN = BELT_IDS.indexOf('green');

/** Romaji on signage only while the belt is below Green (design 09 §3.3; the one sanctioned romaji outside input). */
export function romajiAllowed(belt: Belt): boolean {
  const i = BELT_IDS.indexOf(belt);
  return i >= 0 && i < GREEN;
}

/** The furigana mode for a `.sign` inside a link: `tap` becomes `always`; the others stand. */
export function signRubyMode(mode: FuriganaMode): FuriganaMode {
  return mode === 'tap' ? 'always' : mode;
}

/** 第N宿 for 1 ≤ n ≤ 53; `''` outside the road. */
export function ordinalJa(n: number): string {
  if (!Number.isFinite(n) || n < 1 || n > 53) return '';
  return `第${kanjiNumber(Math.floor(n))}宿`;
}

/** `{nameJa|reading}` ruby markup for `<Ruby>` after Green; the plain name when no reading exists. */
export function rubyMarkup(nameJa: string, romaji: string): string {
  const k = kanaReading(romaji);
  return k ? `{${nameJa}|${k}}` : nameJa;
}
