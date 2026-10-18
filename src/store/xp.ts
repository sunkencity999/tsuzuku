/**
 * TSUZUKU — XP and levels (design 02 §5, 06 §1). Level = effort.
 *
 * XP amounts are decided ONLY here (ARCHITECTURE §2): `startXp` listens to
 * the facts other groups emit and answers synchronously with `xp:gained`, so
 * `learn/apply.recordAttempt` can capture `xpDelta` while its emit is still
 * on the stack. Level-ups emit `level:up`.
 *
 * `xpFor(name, payload)` is the pure table lookup for one event. The reducer
 * adds the stateful rules on top: combo milestones need the previous combo,
 * the shadow "set of 5" needs a running count, Rapid Fire pays only the first
 * run of the day, and the ledger caps (60 external minutes, 4 entries = 20 XP
 * per day) are derived from the ledger slice itself so they survive a reload.
 *
 * Listening (design 08): a `listening:set` pays `listeningSet + listeningQuestion ·
 * correct` whether it heard a text or pool sentences (`mode: 'walk'`, the Ear
 * Walk — a set is a set); `listen:played` (茶屋ラジオ §10.2, Read-along §10.3)
 * pays nothing on either source — Level = effort, and passive hearing is
 * input: it is a ledger row (`ledger.ts`), never XP, never a `story:read`.
 */
import { MISSIONS } from '../shared/catalog';
import { bus, type Events } from '../shared/events';
import type { Store } from '../shared/store-types';

/* ────────────────────────────────────────────────────────────────────────── */
/* Table (design 06 §1)                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export const XP_TABLE: Record<string, number> = {
  reviewGood: 2,
  reviewHard: 1,
  reviewAgain: 1,
  recovery: 2,
  ippon: 3,
  kiaiMultiplier: 1.5,
  itemIntroduced: 5,
  firstProd: 10,
  promoteYellow: 5,
  promoteGreen: 10,
  promoteBrown: 20,
  promoteBlack: 40,
  combo10: 10,
  combo25: 25,
  combo50: 60,
  combo100: 150,
  scroll: 30,
  scrollFlawless: 10,
  episode: 25,
  episodeQuestion: 5,
  speedRead: 15,
  listeningSet: 20,
  listeningQuestion: 5,
  dictationMin: 3,
  dictationMax: 6,
  shadowLine: 3,
  shadowSet: 10,
  shadowSetSize: 5,
  rolePlay: 25,
  rolePlayAllBest: 10,
  rolePlayAizuchi: 5,
  threeWays: 15,
  monologue: 15,
  reduceExpand: 20,
  writing: 30,
  weakSet: 15,
  rapidPerCorrect: 1,
  rapidCap: 60,
  michikusa: 5,
  fullDay: 50,
  gatePass: 300,
  gatePerfectBonus: 100,
  gateAssisted: 150,
  gateRevenge: 450,
  shinsa: 1000,
  kage: 60,
  nemesis: 40,
  fieldMissionMin: 30,
  fieldMissionMax: 100,
  externalMinute: 1,
  externalMinuteCap: 60,
  ledgerEntry: 5,
  ledgerEntryCap: 20,
};

const T = XP_TABLE as Record<keyof typeof XP_TABLE & string, number>;

/** Combo milestones (design 05 §5) → XP. */
export const COMBO_XP: readonly [combo: number, xp: number][] = [
  [10, T.combo10],
  [25, T.combo25],
  [50, T.combo50],
  [100, T.combo100],
];

const PROMOTION_XP = { yellow: T.promoteYellow, green: T.promoteGreen, brown: T.promoteBrown, black: T.promoteBlack, white: 0 } as const;

const ARCADE: ReadonlySet<string> = new Set(['rapid-fire', 'gojuon-fighter']);

/* ────────────────────────────────────────────────────────────────────────── */
/* Level curve (design 02 §5)                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export const MAX_LEVEL = 99;

/** Cumulative XP at which level `L` begins: `60·L² + 100·L`. */
export function xpAtLevel(level: number): number {
  return 60 * level * level + 100 * level;
}

/** XP from `level` to `level + 1`: `160 + 120·L`. */
export function xpToNext(level: number): number {
  return 160 + 120 * level;
}

/** Level for a cumulative XP total, clamped to 1–99. */
export function levelFor(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  let lo = 1;
  let hi = MAX_LEVEL;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (xpAtLevel(mid) <= xp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Pure per-event amounts                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Review XP for one graded rep: 2 / 1 / 1 (+2 Recovery, +3 Ippon), × 1.5 inside Kiai. Arcade reps earn 0. */
export function repXp(p: Events['attempt:graded']): number {
  if (ARCADE.has(p.exercise) || p.rating === null) return 0;
  let xp = p.rating >= 3 ? T.reviewGood : p.rating === 2 ? T.reviewHard : T.reviewAgain;
  if (p.recovery && p.correct) xp += T.recovery;
  if (p.ippon) xp += T.ippon;
  if (p.kiai) xp = Math.round(xp * T.kiaiMultiplier);
  return xp;
}

/** Dictation line: 3–6 by accuracy × speed tier (tier 3 = 1.0×). */
export function dictationXp(score: number, tier: 1 | 2 | 3 | 4 | 5 = 3): number {
  const span = T.dictationMax - T.dictationMin;
  return T.dictationMin + Math.round(span * clamp01(score) * (tier / 5));
}

/** Field Mission XP inside the mission's range, by minutes relative to its default. */
export function fieldMissionXp(tier: 1 | 2 | 3 | 4 | 5, minutes: number): number {
  const m = MISSIONS.find((x) => x.tier === tier);
  if (!m) return T.fieldMissionMin;
  const [lo, hi] = m.xp;
  const frac = m.minutes > 0 ? clamp01(minutes / m.minutes) : 1;
  return Math.round(lo + (hi - lo) * frac);
}

/**
 * Base XP of one event (design 06 §1), without the stateful rules the reducer
 * adds (combo milestones, shadow set bonus, Rapid Fire first-run and ledger
 * daily caps). `quest:completed` pays only the Full Training Day.
 */
export function xpFor<K extends keyof Events>(name: K, payload: Events[K]): number {
  switch (name) {
    case 'attempt:graded': {
      const p = payload as Events['attempt:graded'];
      return repXp(p) + (p.firstProd && !ARCADE.has(p.exercise) ? T.firstProd : 0);
    }
    case 'item:introduced':
      return T.itemIntroduced;
    case 'item:promoted':
      return PROMOTION_XP[(payload as Events['item:promoted']).to];
    case 'scroll:completed': {
      const p = payload as Events['scroll:completed'];
      return T.scroll + (p.flawless ? T.scrollFlawless : 0);
    }
    case 'story:read': {
      const p = payload as Events['story:read'];
      if (p.mode === 'speed') return p.total > 0 && p.correct >= p.total ? T.speedRead : 0;
      const passed = p.total > 0 && p.correct / p.total >= 2 / 3;
      return (passed ? T.episode : 0) + T.episodeQuestion * Math.max(0, p.correct);
    }
    case 'listening:set': {
      // Text or walk mode alike (design 08 §10.4: the Ear Walk is `listening-set` in pool mode).
      const p = payload as Events['listening:set'];
      return T.listeningSet + T.listeningQuestion * Math.max(0, p.correct);
    }
    case 'listen:played':
      // Design 08 §10.2 (Radio) / §10.3 (Read-along): passive hearing earns no XP on either source.
      return 0;
    case 'line:scored': {
      const p = payload as Events['line:scored'];
      if (!p.pass) return 0;
      return p.kind === 'dictation' ? dictationXp(p.score, p.tier) : T.shadowLine;
    }
    case 'roleplay:done': {
      const p = payload as Events['roleplay:done'];
      let xp = T.rolePlay;
      if (p.total > 0 && p.best >= p.total) xp += T.rolePlayAllBest;
      if (p.aizuchiTotal > 0 && p.aizuchiHit >= p.aizuchiTotal) xp += T.rolePlayAizuchi;
      return xp;
    }
    case 'output:done': {
      const p = payload as Events['output:done'];
      switch (p.kind) {
        case 'three-ways':
          return T.threeWays;
        case 'monologue':
          return T.monologue;
        case 'reduce-expand':
          return T.reduceExpand;
        case 'writing':
          return T.writing;
      }
      return 0;
    }
    case 'arcade:done': {
      const p = payload as Events['arcade:done'];
      return p.mode === 'rapid' ? Math.min(T.rapidCap, Math.max(0, p.correct) * T.rapidPerCorrect) : 0;
    }
    case 'weak-point:set-done':
      return T.weakSet;
    case 'michikusa:read':
      return T.michikusa;
    case 'quest:completed':
      return (payload as Events['quest:completed']).allDone ? T.fullDay : 0;
    case 'gate:result': {
      const p = payload as Events['gate:result'];
      switch (p.outcome) {
        case 'pass':
          return T.gatePass;
        case 'perfect':
          return T.gatePass + T.gatePerfectBonus;
        case 'assisted':
          return T.gateAssisted;
        case 'revenge':
          return T.gateRevenge;
        case 'fail':
          return 0;
      }
      return 0;
    }
    case 'shinsa:result':
      return (payload as Events['shinsa:result']).passed ? T.shinsa : 0;
    case 'kage:result':
      return (payload as Events['kage:result']).beat ? T.kage : 0;
    case 'nemesis:defeated':
      return T.nemesis;
    case 'ledger:entry': {
      const p = payload as Events['ledger:entry'];
      if (p.source !== 1) return 0;
      return Math.min(T.externalMinuteCap, Math.max(0, Math.round(p.minutes)) * T.externalMinute) + T.ledgerEntry;
    }
    case 'field-mission:done': {
      const p = payload as Events['field-mission:done'];
      return fieldMissionXp(p.tier, p.minutes);
    }
    default:
      return 0;
  }
}

/** XP for the highest combo milestone crossed going from `prev` to `next`. */
export function comboXp(prev: number, next: number): number {
  let xp = 0;
  for (const [combo, amount] of COMBO_XP) if (prev < combo && next >= combo) xp = amount;
  return xp;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Reducer                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/** External ledger minutes and entries already recorded today (the slice includes the current entry). */
function externalToday(store: Store): { minutes: number; entries: number } {
  const today = store.today();
  let minutes = 0;
  let entries = 0;
  for (const e of store.ledger.value.entries) {
    if (e[0] === today && e[3] === 1) {
      minutes += e[1];
      entries++;
    }
  }
  return { minutes, entries };
}

export function startXp(store: Store): () => void {
  const lastCombo = new Map<string, number>();
  let shadowRun = 0;
  let rapidPaidDay: number | null = null;

  function grant(amount: number, reason: string): void {
    const n = Math.round(amount);
    if (n <= 0) return;
    const before = store.profile.value;
    const total = before.xp + n;
    const level = levelFor(total);
    store.patch('profile', (p) => ({ ...p, xp: p.xp + n, level: levelFor(p.xp + n) }));
    bus.emit('xp:gained', { amount: n, reason, total });
    if (level > before.level) bus.emit('level:up', { level });
  }

  const offs: (() => void)[] = [
    bus.on('attempt:graded', (p) => {
      if (ARCADE.has(p.exercise)) return;
      const rep = repXp(p);
      if (rep > 0) grant(rep, p.recovery && p.correct ? 'recovery' : p.ippon ? 'ippon' : 'review');
      if (p.firstProd) grant(T.firstProd, 'first-prod');
      const prev = lastCombo.get(p.sessionId) ?? 0;
      lastCombo.set(p.sessionId, p.combo);
      const combo = comboXp(prev, p.combo);
      if (combo > 0) grant(combo, 'combo');
    }),
    bus.on('item:introduced', (p) => grant(xpFor('item:introduced', p), 'introduced')),
    bus.on('item:promoted', (p) => grant(xpFor('item:promoted', p), 'promotion')),
    bus.on('scroll:completed', (p) => grant(xpFor('scroll:completed', p), 'scroll')),
    bus.on('story:read', (p) => grant(xpFor('story:read', p), p.mode === 'speed' ? 'speed-read' : 'episode')),
    bus.on('listening:set', (p) => grant(xpFor('listening:set', p), 'listening')),
    // Design 08 §10.2 (茶屋ラジオ) / §10.3 (Read-along): passive hearing is input, not effort — 0 XP on both
    // sources, on purpose (`xpFor` says the same). The subscription exists so the rule is stated here, where
    // every XP amount is decided, instead of being implied by a missing handler.
    bus.on('listen:played', () => undefined),
    bus.on('line:scored', (p) => {
      grant(xpFor('line:scored', p), p.kind);
      if (p.kind === 'shadow' && p.pass) {
        shadowRun++;
        if (shadowRun >= T.shadowSetSize) {
          shadowRun = 0;
          grant(T.shadowSet, 'shadow-set');
        }
      }
    }),
    bus.on('roleplay:done', (p) => grant(xpFor('roleplay:done', p), 'role-play')),
    bus.on('output:done', (p) => grant(xpFor('output:done', p), p.kind)),
    bus.on('arcade:done', (p) => {
      if (p.mode !== 'rapid') return;
      const today = store.today();
      if (rapidPaidDay === today) return;
      rapidPaidDay = today;
      grant(xpFor('arcade:done', p), 'rapid-fire');
    }),
    bus.on('weak-point:set-done', (p) => grant(xpFor('weak-point:set-done', p), 'weak-set')),
    bus.on('michikusa:read', (p) => grant(xpFor('michikusa:read', p), 'michikusa')),
    bus.on('quest:completed', (p) => grant(xpFor('quest:completed', p), 'full-day')),
    bus.on('gate:result', (p) => grant(xpFor('gate:result', p), 'gate')),
    bus.on('shinsa:result', (p) => grant(xpFor('shinsa:result', p), 'shinsa')),
    bus.on('kage:result', (p) => grant(xpFor('kage:result', p), 'kage')),
    bus.on('nemesis:defeated', (p) => grant(xpFor('nemesis:defeated', p), 'nemesis')),
    bus.on('field-mission:done', (p) => grant(xpFor('field-mission:done', p), 'field-mission')),
    bus.on('ledger:entry', (p) => {
      if (p.source !== 1) return;
      const sofar = externalToday(store);
      // The slice already holds this entry when it came through addLedgerEntry.
      const minutesBefore = Math.max(0, sofar.minutes - p.minutes);
      const entriesBefore = Math.max(0, sofar.entries - 1);
      const minuteRoom = Math.max(0, T.externalMinuteCap - minutesBefore);
      const minuteXp = Math.min(minuteRoom, Math.max(0, Math.round(p.minutes)) * T.externalMinute);
      if (minuteXp > 0) grant(minuteXp, 'external-input');
      if (entriesBefore * T.ledgerEntry < T.ledgerEntryCap) grant(T.ledgerEntry, 'ledger-entry');
    }),
    bus.on('session:started', () => {
      shadowRun = 0;
    }),
    bus.on('session:finished', (p) => {
      lastCombo.delete(p.planId);
      shadowRun = 0;
    }),
  ];

  return () => {
    for (const off of offs) off();
    lastCombo.clear();
  };
}
