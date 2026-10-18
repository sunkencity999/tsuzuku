/**
 * TSUZUKU — End Card copy added by design 09 §7 B (Shūhitsu) and §7 C (Kadode), owner B2.
 *
 * Sensei voice (design 01 §3, 06 §7, 09 §8): the lantern records what was done
 * and asks for nothing — no time words, no "come back", no countdown. The long
 * flame sentences stay in `./strings.ts` (`S.flame*`); this file holds only the
 * copy that design 09 adds. `banned.test.ts` scans it like every strings file.
 */
import type { LanternState } from '../shared/ui/Lantern';
import type { CeremonyEvent } from './end-card';

export const ES = {
  /** Beat 2,400 — the 20 px tongue catches beside the flame line. */
  lanternForToday: 'A lantern for today.',
  /** Beat 2,700 — small, under "Good training. Rest." */
  dojoKeepsPlace: 'The dojo keeps your place.',
  /**
   * The visible English word beside the drawn tongue (09 §5.10) — the same word the shell gives the same
   * `<Lantern state>` (`S.flameWord*`, src/i18n/strings.ts; group A, so mirrored here rather than imported): one drawn
   * flame, one story. `unlit` is the never-lit hearth of day one.
   */
  lanternWord: {
    lit: 'Lit',
    gold: 'Gold',
    ember: 'Embers',
    frozen: 'Frozen',
    rest: 'Rest',
    broken: 'Out',
    unlit: 'Unlit',
  } satisfies Record<LanternState, string>,
  /**
   * The decorative mark before each earned row — an `aria-hidden` span whose label is the row's own English
   * (紋 crest · 印 seal · 帯 belt · 軸 hanging scroll · Lv level); quests never make a row.
   */
  earnedMark: {
    'badge:earned': '紋',
    'stamp:earned': '印',
    'belt:promoted': '帯',
    'level:up': 'Lv',
    'wallpaper:unlocked': '軸',
    'wallpaper:revealed': '軸',
  } satisfies Record<Exclude<CeremonyEvent['name'], 'quest:completed'>, string>,
  /** Line 3 of 次回予告 when the next station's vista is known: a second sentence after the Gatekeeper line (09 §10 B2, §12.1 d38), never a fourth line. */
  gateWithVista: '{line} Beyond the gate: {vista}.',
  /** 次回予告 keeps 03 §10's three lines even when the composer found nothing for a slot. */
  yokokuNoSentence: 'No episode line yet.',
  yokokuNoWords: 'No new words yet.',
} as const;
