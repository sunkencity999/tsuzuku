/**
 * TSUZUKU — reward catalog ids (design 06 §2–§3, 03 §6, 04 §9, 04 §12, 01 §5).
 *
 * Shared by B (unlock rules), G (art), E/F (quests, missions). Ids only plus the
 * tiny tables other groups must agree on; conditions and art live elsewhere.
 */
import type { Belt, DrillId } from '../content/types';

/* ────────────────────────────────────────────────────────────────────────── */
/* Mon (紋) — 68 badges, design 06 §2 order (+ design 08 §11 listening pair)    */
/* ────────────────────────────────────────────────────────────────────────── */

export const BADGE_IDS = [
  'first-step',
  'gojuon',
  'katakana',
  'voiced',
  'rain-candy',
  'gojuon-perfect',
  'three-day',
  'seven',
  'thirty',
  'hundred',
  'year',
  'rise-eight',
  'ember',
  'samurai-rest',
  'five-hundred-days',
  'thousand-cuts',
  'ten-thousand',
  'hundred-thousand',
  'ten-chain',
  'fifty-chain',
  'hundred-chain',
  'unscathed',
  'ippon',
  'hundred-ippon',
  'gatekeepers-respect',
  'perfect-gate',
  'revenge',
  'halfway',
  'kyoto',
  'belt-yellow',
  'belt-orange',
  'belt-green',
  'belt-blue',
  'belt-purple',
  'belt-brown',
  'belt-black',
  'bookworm',
  'dictionary-free',
  'speed-reader',
  'golden-ear',
  'fast-ear',
  // design 08 §11: teahouse-regular (stats.radioMinutes ≥ 600, Bronze) and first-hearing (stats.coldSetsPassed ≥ 20, Silver);
  // names, mon glyphs and copy live in store/defs-strings.ts and art/mon.ts with the other badges
  'teahouse-regular',
  'first-hearing',
  'voice',
  'shadow-warrior',
  'aizuchi',
  'three-forms',
  'one-minute-monologue',
  'hundred-kanji',
  'thousand-kanji',
  'thousand-words',
  'five-thousand',
  'grammarian',
  'form-chain-20',
  'particle-sage',
  'honest',
  'weak-conquered',
  'nemesis-slayer',
  'shadow-breaker',
  'beyond-the-wall',
  'hundred-hours',
  'thousand-hours',
  'field',
  'first-convo',
  'comeback',
  'zen',
  'backup',
  'tsuzuku',
] as const;
export type BadgeId = (typeof BADGE_IDS)[number];

export type BadgeTier = 'bronze' | 'silver' | 'gold';
/** Ring colors (design 06 §2); gold uses `--kin`. */
export const BADGE_RING = { bronze: '#B87333', silver: '#C9CED6' } as const;

/** Belt → its Shinsa badge (White has no Shinsa). */
export const BELT_BADGE: Record<Exclude<Belt, 'white'>, BadgeId> = {
  yellow: 'belt-yellow',
  orange: 'belt-orange',
  green: 'belt-green',
  blue: 'belt-blue',
  purple: 'belt-purple',
  brown: 'belt-brown',
  black: 'belt-black',
};
export function beltBadgeId(belt: Belt): BadgeId | null {
  return belt === 'white' ? null : BELT_BADGE[belt];
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Kakejiku (掛け軸) — 29 wallpapers, design 06 §3 order (+ design 08 §11)      */
/* ────────────────────────────────────────────────────────────────────────── */

export const WALLPAPER_IDS = [
  'torii-dawn',
  'kana-grid',
  'neon-alley',
  'sakura-storm',
  'great-wave',
  'kanji-stars',
  'fifty-three',
  'lantern-river',
  'sumi-dragon',
  'okaeri',
  'vs-wall',
  'wall-broken',
  'tanabata',
  'hanko-garden',
  'fuji-ridge',
  'koi-dragon',
  'shoji-light',
  'insert-coin',
  'daruma',
  'vending-night',
  'onsen',
  'waveform',
  'golden-screen',
  'festival',
  'station-sign',
  'kyoto-arrival',
  'road-continues',
  // design 08 §11: chaya-lanterns — a roadside teahouse at dusk, one chōchin per 10 h of `ledgerHours(m).listen`, living, quadrants at 25 / 50 / 75 / 100 h
  'chaya-lanterns',
  'end-card',
] as const;
export type WallpaperId = (typeof WALLPAPER_IDS)[number];

/* ────────────────────────────────────────────────────────────────────────── */
/* 三つの型 — 17 daily quests, design 03 §6 order                                */
/* ────────────────────────────────────────────────────────────────────────── */

export const QUEST_IDS = [
  'clear-due',
  'learn-scroll',
  'read-episode',
  'shadow-five',
  'combo-twenty',
  'dictation-five',
  'chain-three',
  'nemesis-five',
  'pitch-five',
  'rapid-run',
  'michikusa-one',
  'speed-read-one',
  'taiwa-aizuchi',
  'three-ways-one',
  'outside-twenty',
  'weak-set-one',
  'writing-one',
] as const;
export type QuestId = (typeof QUEST_IDS)[number];

/** Weekly strand (design 03 §5); the variety constraint never picks two quests of one strand. */
export type Strand = 'form' | 'input' | 'output';

export interface QuestDef {
  id: QuestId;
  strand: Strand;
  titleEn: string;
  /** Count the quest needs (reps, lines, minutes, runs…). */
  target: number;
  /** First station at which the quest may be drawn (design 04 §13). */
  fromStation: number;
  /** Drill that must be registered for the quest to be drawable (builder skips otherwise). */
  requires?: DrillId;
  /** Build phase of the feature the quest depends on (design 07 §13). */
  phase: 1 | 2 | 3;
}

export const QUESTS: readonly QuestDef[] = [
  { id: 'clear-due', strand: 'form', titleEn: 'Clear all due reviews (or 50)', target: 50, fromStation: 1, phase: 1 },
  { id: 'learn-scroll', strand: 'form', titleEn: 'Learn a Scroll', target: 1, fromStation: 1, phase: 1 },
  { id: 'read-episode', strand: 'input', titleEn: 'Read an episode', target: 1, fromStation: 4, requires: 'story-read', phase: 1 },
  { id: 'shadow-five', strand: 'output', titleEn: 'Shadow 5 lines', target: 5, fromStation: 3, requires: 'shadow', phase: 1 },
  { id: 'combo-twenty', strand: 'form', titleEn: 'Reach a 20 combo', target: 20, fromStation: 1, phase: 1 },
  { id: 'dictation-five', strand: 'input', titleEn: '5 dictation lines', target: 5, fromStation: 4, requires: 'sentence-listen', phase: 1 },
  { id: 'chain-three', strand: 'form', titleEn: '3 Form Chains', target: 3, fromStation: 12, requires: 'form-chain', phase: 1 },
  { id: 'nemesis-five', strand: 'form', titleEn: '5 Nemesis reps', target: 5, fromStation: 6, requires: 'nemesis-duel', phase: 2 },
  { id: 'pitch-five', strand: 'form', titleEn: '5 Pitch Ear items', target: 5, fromStation: 7, requires: 'pitch-ear', phase: 1 },
  { id: 'rapid-run', strand: 'form', titleEn: 'One Rapid Fire run', target: 1, fromStation: 7, requires: 'rapid-fire', phase: 2 },
  { id: 'michikusa-one', strand: 'input', titleEn: 'Read one Michikusa', target: 1, fromStation: 1, phase: 1 },
  { id: 'speed-read-one', strand: 'input', titleEn: 'One Speed Read', target: 1, fromStation: 6, requires: 'speed-read', phase: 1 },
  { id: 'taiwa-aizuchi', strand: 'output', titleEn: 'One role-play with every aizuchi slot hit', target: 1, fromStation: 7, requires: 'role-play', phase: 2 },
  { id: 'three-ways-one', strand: 'output', titleEn: 'One Say It Three Ways', target: 1, fromStation: 27, requires: 'say-three-ways', phase: 2 },
  // From Station 1: the ledger slice, the end-card ledger prompt and the Ledger page exist from the first save, so the
  // input strand has a second Kata once `michikusa-one` is gated closed (every fragment of stations ≤ current + 1
  // collected). The output strand starts with `shadow-five` at Station 3 (design 04 §13), so Stations 1–2 draw two Kata.
  { id: 'outside-twenty', strand: 'input', titleEn: 'Log 20 minutes of outside input', target: 20, fromStation: 1, phase: 2 },
  { id: 'weak-set-one', strand: 'form', titleEn: 'One Weak Point set', target: 1, fromStation: 4, phase: 1 },
  { id: 'writing-one', strand: 'output', titleEn: 'One Writing Dojo piece', target: 1, fromStation: 16, requires: 'writing-dojo', phase: 2 },
];

/* ────────────────────────────────────────────────────────────────────────── */
/* 他流試合 — Field Missions, design 04 §9 / 05 §10                               */
/* ────────────────────────────────────────────────────────────────────────── */

export interface MissionDef {
  id: string;
  tier: 1 | 2 | 3 | 4 | 5;
  /** Minimum belt. */
  belt: Belt;
  /** First station the mission is offered at. */
  fromStation: number;
  titleEn: string;
  titleJa: string;
  /** The task, Sensei voice. */
  promptEn: string;
  /** XP range; the runner picks inside it by self-reported scope. */
  xp: [number, number];
  /** Default minutes logged to the ledger. */
  minutes: number;
  /** A real conversation (feeds `ledger.missions[].conversation`, 初対話). */
  conversation: boolean;
}

export const MISSIONS: readonly MissionDef[] = [
  {
    id: 'read-aloud-sign',
    tier: 1,
    belt: 'white',
    fromStation: 3,
    titleEn: 'Read a sign aloud',
    titleJa: '看板を読む',
    promptEn: 'Find a sign, label or menu in Japanese. Read it aloud. Note one word you did not know.',
    xp: [30, 30],
    minutes: 5,
    conversation: false,
  },
  {
    id: 'order-in-japanese',
    tier: 2,
    belt: 'yellow',
    fromStation: 4,
    titleEn: 'Order in Japanese',
    titleJa: '日本語で注文',
    promptEn: 'Order something, or ask for something, in Japanese — in person, by voice note or in writing.',
    xp: [40, 50],
    minutes: 10,
    conversation: false,
  },
  {
    id: 'subtitled-twenty',
    tier: 3,
    belt: 'orange',
    fromStation: 10,
    titleEn: 'Twenty minutes with Japanese subtitles',
    titleJa: '字幕で二十分',
    promptEn: 'Watch 20 minutes of anything with Japanese subtitles. Log three words you met.',
    xp: [50, 60],
    minutes: 20,
    conversation: false,
  },
  {
    id: 'three-line-comment',
    tier: 4,
    belt: 'green',
    fromStation: 16,
    titleEn: 'A three-line comment',
    titleJa: '三行コメント',
    promptEn: 'Write a three-line comment or message in Japanese somewhere real. Keep a copy.',
    xp: [60, 80],
    minutes: 15,
    conversation: false,
  },
  {
    id: 'real-conversation',
    tier: 5,
    belt: 'blue',
    fromStation: 25,
    titleEn: 'A fifteen-minute conversation',
    titleJa: '十五分の会話',
    promptEn: 'Hold a 15-minute conversation in Japanese. Afterwards, log two things you could not say.',
    xp: [80, 100],
    minutes: 15,
    conversation: true,
  },
];

/* ────────────────────────────────────────────────────────────────────────── */
/* SFX names (design 01 §5) and Shinsa sections (design 04 §12)                */
/* ────────────────────────────────────────────────────────────────────────── */

export const SFX_NAMES = [
  'correct',
  'correct-tier2',
  'correct-tier3',
  'wrong',
  'submit',
  'ippon',
  'kiai',
  'promotion',
  'scroll',
  'badge',
  'stamp',
  'ceremony',
  'wallpaper',
  'tsuzuku',
] as const;
export type SfxName = (typeof SFX_NAMES)[number];

export const SHINSA_SECTIONS = ['ear', 'read', 'form', 'mouth', 'write'] as const;
export type ShinsaSection = (typeof SHINSA_SECTIONS)[number];
export const SHINSA_SECTION_JA: Record<ShinsaSection, string> = {
  ear: '耳',
  read: '読',
  form: '形',
  mouth: '口',
  write: '書',
};
