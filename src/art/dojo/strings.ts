/**
 * TSUZUKU — Dojo scene copy (Sensei voice, design 01 §3).
 * Linted by `src/i18n/banned.test.ts`. Plain strings; `{name}`-style
 * placeholders are filled by `fill()`. Japanese carries `lang="ja"` in TSX.
 * Every Japanese glyph here is in every font family's base slice
 * (src/styles/fonts.test.ts) and carries a reading and English beside it.
 */
import type { Belt } from '../../content/types';

export const S = {
  /* ── the scene ────────────────────────────────────────────────────── */
  sceneLabel: 'Your dojo: {belt} belt, {days} training days, {phase}, {season}.',
  sceneLoading: 'The dojo is being swept.',
  kotodamaJa: '言霊',
  kotodamaCount: '{total} word-spirits',
  kotodamaShown: '{rendered} of {total} drifting here',
  kotodamaNone: 'No word-spirits yet. Each item that reaches Black belt becomes a flame here.',
  flameLabel: 'Tsuzuku Flame',

  /* ── hotspots (accessible links over the scene) ─────────────────── */
  hotspotsLabel: 'Places in the dojo',
  tipScroll: 'Scroll',
  tipBonsai: 'Bonsai',
  tipRack: 'Belt',
  tipShelf: 'Crests',
  tipStamps: 'Stamps',
  tipHearth: 'Flame',
  hotspotScroll: 'Wall scroll. Open Station {n}, {name}.',
  hotspotScrollRoad: 'Wall scroll. Open the road.',
  hotspotBonsai: 'Bonsai, {days} training days. Open your records.',
  hotspotRack: 'Belt rack, {belt} belt. Open your kakejiku.',
  hotspotShelf: 'Mon shelf, {n} of {total} categories. Open your crests.',
  hotspotStamps: 'Stamp rack. Open your goshuin book.',
  hotspotHearth: 'Hearth. {state}',

  /* ── hearth / flame states (design 03 §7) ─────────────────────────── */
  hearthUnlit: 'The hearth is cold. Any session lights it.',
  /* design 09 §7 A: the never-lit hearth of day one says "Unlit", never "out" */
  hearthNeverLit: 'Unlit. Your first session lights it.',
  hearthEmber: 'Embers. One Kumite or larger brings the flame back.',
  hearthSteady: 'The flame is lit.',
  hearthRoaring: 'Full training day. The flame burns gold.',
  hearthCrystal: 'A freeze held the flame. Rest is training.',

  /* ── sky and season (for the scene label) ─────────────────────────── */
  phaseDawn: 'dawn',
  phaseDay: 'daylight',
  phaseDusk: 'dusk',
  phaseNight: 'night',
  seasonSpring: 'spring',
  seasonSummer: 'summer',
  seasonAutumn: 'autumn',
  seasonWinter: 'winter',

  /* ── empty states inside the picture ──────────────────────────────── */
  scrollEmpty: 'The scroll waits for a kanji. You choose one at your next belt.',
  stampsEmpty: 'The goshuin book is closed until your first Gatekeeper.',
  bonsaiPruned: 'The bonsai was pruned while you were away. It grows again from today.',
  bonsaiBlooming: 'The bonsai is in bloom: one hundred training days.',
  kageSitting: 'Your Kage sits in the corner. You beat it this week.',
  /* design 09 §8 the week: Monday, the silhouette leaves */
  kageLeft: 'The Kage left the corner. It runs again this week.',

  /* ── since yesterday (design 09 §7 A beat 1,700): what the effort grew ── */
  sinceYesterday: 'Since yesterday:',
  sinceLantern: 'a new lantern on the eaves',
  sinceBonsai: 'the bonsai grew',
  sinceStamp: 'a new goshuin on the rack',
  sinceMon: 'a new crest on the shelf',
  sinceBelt: 'a new belt on the rack',
  sinceScroll: 'a kanji on the wall scroll',
  sinceStation: 'the road moved on',
  sinceJoin: ' · ',

  /* ── the eaves ornament (design 09 §7 H): drawn, with its reading and English ── */
  ornamentTanabataJa: '七夕',
  ornamentTanabataReading: 'tanabata',
  ornamentTanabataEn: 'star festival wishes on the eaves',
  ornamentKoinoboriJa: '鯉のぼり',
  ornamentKoinoboriReading: 'koinobori',
  ornamentKoinoboriEn: 'carp streamers for the children’s day',
  ornamentYukiJa: '雪',
  ornamentYukiReading: 'yuki',
  ornamentYukiEn: 'snow on the eaves',
} as const;

/** Belt names for the scene label. */
export const BELT_NAME: Record<Belt, string> = {
  white: 'white',
  yellow: 'yellow',
  orange: 'orange',
  green: 'green',
  blue: 'blue',
  purple: 'purple',
  brown: 'brown',
  black: 'black',
};

/** `fill('{n} days', { n: 3 })` → `3 days`; unknown keys are left in place. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
