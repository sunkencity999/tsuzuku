/**
 * TSUZUKU — typed synchronous event bus (ARCHITECTURE §2).
 *
 * D/E/F emit facts; B reduces them and emits derived events; G listens for
 * ceremonies. XP amounts are decided only in B. `emit` is synchronous and
 * subscribers are isolated: a throwing subscriber never stops the others.
 */
import type { Belt, CardKey, ErrorTag, ExerciseId, Facet, ListeningGenre } from '../content/types';
import type { BadgeId, ShinsaSection, WallpaperId } from './catalog';
import type { AttemptResult, SessionMode, SessionResult } from './session-types';
import type { EpochDay, ItemBelt, ItemKind, Rating } from './store-types';

export interface Events {
  'attempt:graded': AttemptResult & {
    sessionId: string;
    exercise: ExerciseId;
    itemId: string | null;
    kind: ItemKind | null;
    facet: Facet | null;
    cardKey: CardKey | null;
    rating: Rating | null;
    judge?: 'pass' | 'fail';
    mature: boolean;
    ippon: boolean;
    kiai: boolean;
    combo: number;
    recovery: boolean;
    firstProd: boolean;
  };
  'item:introduced': { itemId: string; kind: ItemKind; station: number };
  'item:promoted': { itemId: string; kind: ItemKind; from: ItemBelt; to: ItemBelt };
  'session:started': { sessionId: string; mode: SessionMode; zen: boolean };
  'session:finished': SessionResult;
  'scroll:completed': { scrollId: string; itemIds: string[]; flawless: boolean };
  'story:read': {
    storyId: string;
    mode: 'read' | 'speed';
    chars: number;
    cpm: number;
    correct: number;
    total: number;
    glossTaps: number;
    minutes: number;
    bridge: boolean;
  };
  /**
   * One Listening Arena set (design 08 §10.4, §12). `storyId` is `null` in
   * walk mode (the Ear Walk: pool sentences, no text), where `refs` carries
   * the pool refs heard. `genre` / `bridge` describe the text; `authentic` is
   * `isAuthenticText(story)` set by the emitter (the reducer cannot see the
   * text's kind / register); `cold` = the text was not in `progress.listened`
   * when the set started (a first hearing on either surface).
   */
  'listening:set': {
    storyId: string | null;
    correct: number;
    total: number;
    rate: number;
    minutes: number;
    /** Pool refs of a walk-mode set (`v-n5-0249#ex0`, `s-07-2#L3`). */
    refs?: string[];
    genre?: ListeningGenre;
    bridge?: boolean;
    /** Design 08 §12: bridge text, `AUTHENTIC_GENRES` piece or casual dialogue. */
    authentic?: boolean;
    cold?: boolean;
    mode?: 'text' | 'walk';
  };
  /**
   * Passive hearing (design 08 §10.2 Radio, §10.3 Read-along, §12): a `listen`
   * ledger row with `source: app`, 0 XP, never a `story:read`. `refs` are the
   * text ids or pool refs heard; `seconds` counts only audio actually played
   * at volume > 0 (media events, not wall clock); `rate` the playback rate;
   * `cold` = first hearing on either surface; `authentic` = `isAuthenticText`
   * at rate ≥ 1.0 with the gist question answered correctly; `gistCorrect` is
   * `null` when no question was asked or it was skipped.
   */
  'listen:played': {
    source: 'radio' | 'readalong';
    refs: string[];
    seconds: number;
    rate: number;
    cold: boolean;
    authentic: boolean;
    gistCorrect: boolean | null;
  };
  'line:scored': {
    kind: 'dictation' | 'shadow';
    score: number;
    pass: boolean;
    tier?: 1 | 2 | 3 | 4 | 5;
    replays?: number;
    path?: 'recognition' | 'self';
  };
  'roleplay:done': {
    storyId: string;
    best: number;
    total: number;
    aizuchiHit: number;
    aizuchiTotal: number;
    registerOk: boolean;
  };
  'output:done': {
    kind: 'three-ways' | 'monologue' | 'reduce-expand' | 'writing';
    seconds?: number;
    words?: number;
    registersCorrect?: 0 | 1 | 2 | 3;
    patternsHit?: number;
    path?: 'recognition' | 'self';
  };
  'arcade:done': { mode: 'rapid' | 'gojuon'; correct: number; misses: number; ms: number; recheck: CardKey[] };
  'weak-point:set-done': { tag: ErrorTag };
  'weak-point:cleared': { tag: ErrorTag };
  'michikusa:read': { id: string };
  'nemesis:defeated': { itemId: string };
  'session:abandoned': { sessionId: string; steps: number };
  'gate:result': {
    station: number;
    outcome: 'pass' | 'perfect' | 'fail' | 'assisted' | 'revenge';
    score: number;
    phases: number[];
  };
  'shinsa:result': { belt: Belt; passed: boolean; sections: Record<ShinsaSection, number> };
  'kage:result': { week: number; score: number; beat: boolean };
  'ledger:entry': { minutes: number; kind: 0 | 1 | 2 | 3; source: 0 | 1 };
  'field-mission:done': { tier: 1 | 2 | 3 | 4 | 5; minutes: number; conversation: boolean };
  'kiai:entered': Record<string, never>;
  'backup:exported': Record<string, never>;
  'welcome-back:done': Record<string, never>;
  // emitted by B
  'xp:gained': { amount: number; reason: string; total: number };
  'level:up': { level: number };
  'badge:earned': { id: BadgeId };
  'wallpaper:unlocked': { id: WallpaperId };
  'wallpaper:revealed': { id: WallpaperId; quadrant: 1 | 2 | 3 | 4 };
  'stamp:earned': { station: number; perfect: boolean; assisted: boolean };
  'belt:promoted': { belt: Belt };
  'streak:changed': { current: number; state: 'lit' | 'gold' | 'ember' | 'frozen' | 'rest' | 'broken' };
  'quest:completed': { id: string; allDone: boolean };
  'day:rolled': { day: EpochDay; awayDays: number };
}

export type EventName = keyof Events;
export type Handler<K extends EventName> = (payload: Events[K]) => void;
export type Unsubscribe = () => void;

const RING = 200;

type AnyHandler = (payload: unknown) => void;

interface Bus {
  on<K extends EventName>(name: K, fn: Handler<K>): Unsubscribe;
  once<K extends EventName>(name: K, fn: Handler<K>): Unsubscribe;
  emit<K extends EventName>(name: K, payload: Events[K]): void;
  /** Clears every subscriber and the recent ring (tests). */
  reset(): void;
  /** Last 200 emitted events, oldest first (About page debug panel). */
  recent(): [EventName, unknown][];
  listenerCount(name: EventName): number;
}

function createBus(): Bus {
  const handlers = new Map<EventName, Set<AnyHandler>>();
  let ring: [EventName, unknown][] = [];

  const on: Bus['on'] = (name, fn) => {
    let set = handlers.get(name);
    if (!set) {
      set = new Set();
      handlers.set(name, set);
    }
    const h = fn as AnyHandler;
    set.add(h);
    return () => {
      set.delete(h);
    };
  };

  const once: Bus['once'] = (name, fn) => {
    const off = on(name, (p) => {
      off();
      fn(p);
    });
    return off;
  };

  const emit: Bus['emit'] = (name, payload) => {
    ring.push([name, payload]);
    if (ring.length > RING) ring = ring.slice(ring.length - RING);
    const set = handlers.get(name);
    if (!set || set.size === 0) return;
    // Snapshot so (un)subscribing inside a handler never disturbs this emit.
    for (const h of Array.from(set)) {
      try {
        h(payload);
      } catch (err) {
        console.error(`[bus] subscriber of "${name}" threw`, err);
      }
    }
  };

  return {
    on,
    once,
    emit,
    reset() {
      handlers.clear();
      ring = [];
    },
    recent() {
      return ring.slice();
    },
    listenerCount(name) {
      return handlers.get(name)?.size ?? 0;
    },
  };
}

export const bus: Bus = createBus();
