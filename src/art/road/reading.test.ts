/**
 * reading.ts — hiragana readings of the romaji names (long vowels by override), the romaji-below-Green rule, the
 * signage ruby mode, 第N宿; and the session tier's copy of the same rules (RoadNav.tsx) agreeing on every name.
 */
import { describe, expect, it } from 'vitest';
import { BELT_IDS, NIHONBASHI, SANJO_OHASHI, STATIONS } from '../../content/types';
import * as session from '../../session/RoadNav';
import { KANA_OVERRIDE, kanaReading, ordinalJa, romajiAllowed, rubyMarkup, signRubyMode } from './reading';

describe('reading', () => {
  it('hiragana for every station name and both ends; long vowels and づ are spelt natively, never as loanwords', () => {
    expect(kanaReading('Hodogaya')).toBe('ほどがや');
    expect(kanaReading('Ōtsu')).toBe('おおつ');
    expect(kanaReading('Ōiso')).toBe('おおいそ');
    expect(kanaReading('Fuchū')).toBe('ふちゅう');
    expect(kanaReading('Chiryū')).toBe('ちりゅう');
    expect(kanaReading('Shōno')).toBe('しょうの');
    expect(kanaReading('Numazu')).toBe('ぬまづ');
    expect(kanaReading('Sanjō Ōhashi')).toBe('さんじょうおおはし');
    expect(kanaReading('Nihonbashi')).toBe('にほんばし');
    expect(kanaReading('Yokkaichi')).toBe('よっかいち');
    expect(kanaReading('')).toBe('');
    for (const st of STATIONS) {
      const k = kanaReading(st.nameRomaji);
      expect(k, st.nameRomaji).toMatch(/^[ぁ-ゖー]+$/u); // hiragana only: no katakana, no chōon, no space
    }
    // every macron name has a native spelling on file
    for (const st of STATIONS) if (/[āīūēōĀĪŪĒŌ]/.test(st.nameRomaji)) expect(KANA_OVERRIDE[st.nameRomaji], st.nameRomaji).toBeDefined();
    expect(KANA_OVERRIDE[SANJO_OHASHI.nameRomaji]).toBeDefined();
  });

  it('romaji only below Green (design 09 §3.3): White, Yellow, Orange; signage never renders a tap-to-reveal ruby', () => {
    expect(BELT_IDS.filter(romajiAllowed)).toEqual(['white', 'yellow', 'orange']);
    expect(romajiAllowed('green')).toBe(false);
    expect(romajiAllowed('black')).toBe(false);
    expect(signRubyMode('tap')).toBe('always');
    expect(signRubyMode('fog')).toBe('fog');
    expect(signRubyMode('always')).toBe('always');
    expect(signRubyMode('off')).toBe('off');
  });

  it('第N宿 in the shell glyphs for 1–53, nothing off the road; ruby markup pairs the name with its kana', () => {
    expect(ordinalJa(1)).toBe('第一宿');
    expect(ordinalJa(13)).toBe('第十三宿');
    expect(ordinalJa(53)).toBe('第五十三宿');
    expect(ordinalJa(0)).toBe('');
    expect(ordinalJa(54)).toBe('');
    expect(rubyMarkup('保土ヶ谷', 'Hodogaya')).toBe('{保土ヶ谷|ほどがや}');
  });

  it('the session tier (RoadNav.tsx) holds the same rules: readings, ruby markup, ordinals, the belt gate and the ruby mode agree', () => {
    for (const st of STATIONS) {
      expect(session.kanaReading(st.nameRomaji), st.nameRomaji).toBe(kanaReading(st.nameRomaji));
      expect(session.rubyMarkup(st.nameJa, st.nameRomaji)).toBe(rubyMarkup(st.nameJa, st.nameRomaji));
      expect(session.ordinalJa(st.number)).toBe(ordinalJa(st.number));
    }
    for (const end of [NIHONBASHI, SANJO_OHASHI]) expect(session.kanaReading(end.nameRomaji)).toBe(kanaReading(end.nameRomaji));
    for (const b of BELT_IDS) expect(session.romajiAllowed(b)).toBe(romajiAllowed(b));
    for (const m of ['always', 'fog', 'tap', 'off'] as const) expect(session.signRubyMode(m)).toBe(signRubyMode(m));
  });
});
