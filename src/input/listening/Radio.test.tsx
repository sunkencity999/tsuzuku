import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { DIALOGUE, FIXTURE, STATION_4, STORY, V, createFakeLoader } from '@/content/fixtures';
import type { PoolRef, StationBundle, StoryItem } from '@/content/types';
import { SPEED_TIER_RATES, installServices, nullAudio, resetServices, type AudioService, type ClipCue, type ClipPlayOptions, type ClipPlayback, type ClipPlayer, type ClipReady, type SpeakOptions, type TrackCue } from '@/shared/audio';
import { bus } from '@/shared/events';
import { cardKey } from '@/shared/ids';
import { EXIT_FALLBACK_MS } from '@/shared/ui/TeachOnce';
import { store } from '@/store';
import { captureEvents, card, makeTestStore } from '@/store/testing';
import type { MediaSessionLike } from './media-session';
import { Radio, RADIO_TEACH_ID, REHEAR_LOAD_MAX, levelOfStation, loadRadioInputs, refSurface, type RadioInputs } from './Radio';
import { buildPlaylist, lineMorae, speechSeconds } from './radio-playlist';
import { S, fill } from './radio-strings';

/* ── fixtures ────────────────────────────────────────────────────────────── */

const loader = createFakeLoader();
const BRIDGE: StoryItem = { ...DIALOGUE, id: 's-04-3', register: 'casual', bridge: true, titleEn: 'Bridge talk' };
const PIECE: StoryItem = { ...DIALOGUE, id: 's-04-4', audioFirst: true, genre: 'exchange', titleEn: 'At the counter' };
const REF: PoolRef = { ref: 'v-n5-0007#ex0', ids: [V.飲む, V.コーヒー], kana: 'まいあさコーヒーをのみます。', morae: 14 };

const inputsOf = (stories: StoryItem[], o: Partial<RadioInputs> = {}): RadioInputs => ({ stories, pools: [], kanaTracks: [], ...o });

/* ── audio doubles ───────────────────────────────────────────────────────── */

interface Spoken {
  text: string;
  o: SpeakOptions | undefined;
  resolve(): void;
}

/** A device voice: `speak()` records the call and resolves immediately, or waits when `deferred`. */
function fakeAudio(o: { deferred?: boolean } = {}): AudioService & { spoken: Spoken[] } {
  const spoken: Spoken[] = [];
  return {
    ...nullAudio,
    muted: signal(false),
    hasJaVoice: signal(true),
    spoken,
    speak: (text, opts) =>
      new Promise<void>((resolve) => {
        const entry: Spoken = { text, o: opts, resolve };
        spoken.push(entry);
        if (!o.deferred) resolve();
      }),
  };
}

interface Play {
  cue: ClipCue;
  o: ClipPlayOptions;
  finish(seconds: number): void;
  stopped: boolean;
  /** `inPlace` playbacks: `pause()` / `resume()` calls, and the media seconds the last `onPlayed` / `finish` reported (`position()`). */
  paused: number;
  resumed: number;
  pos: number;
}

/** A pack player: whole-text cues of 600 s per text, per-line cues inside the same sprite, controllable `done`; `inPlace` adds the optional pause / resume / position of the contract. */
function fakeClips(o: { ready?: ClipReady; texts?: StoryItem[]; kana?: TrackCue[]; inPlace?: boolean } = {}): ClipPlayer & { plays: Play[]; unlocked: number; loaded: number[]; prefetched: number[] } {
  const plays: Play[] = [];
  const texts = o.texts ?? [];
  const self = {
    ready: signal<ClipReady>(o.ready ?? 'ready'),
    info: signal(null),
    plays,
    unlocked: 0,
    loaded: [] as number[],
    prefetched: [] as number[],
    loadLevel: () => Promise.resolve(),
    loadStation: (n: number) => {
      self.loaded.push(n);
      return Promise.resolve();
    },
    prefetchStation: (n: number) => {
      self.prefetched.push(n);
    },
    cueFor: (key: string): ClipCue | undefined => {
      const whole = texts.find((t) => t.id === key);
      if (whole) return { key, file: `audio/sprites/s04/${key}-abcdef12.webm`, start: 0, end: 600, voice: 'VOICEVOX:九州そら', rate: 1 };
      const m = /^(s-\d\d-\d)#L(\d+)$/.exec(key);
      if (m && texts.some((t) => t.id === m[1])) {
        const i = Number(m[2]);
        return { key, file: `audio/sprites/s04/${m[1]}-abcdef12.webm`, start: i * 50, end: i * 50 + 50, voice: 'VOICEVOX:九州そら', rate: 1 };
      }
      return undefined;
    },
    cueForText: () => undefined,
    kanaTracks: () => Promise.resolve(o.kana ?? []),
    play: (cue: ClipCue, opts: ClipPlayOptions): ClipPlayback => {
      let resolve!: (r: { source: 'clips' | 'none'; seconds: number }) => void;
      const done = new Promise<{ source: 'clips' | 'none'; seconds: number }>((r) => {
        resolve = r;
      });
      const p: Play = {
        cue,
        o: {
          ...opts,
          onPlayed: (s) => {
            p.pos = s;
            opts.onPlayed?.(s);
          },
        },
        stopped: false,
        paused: 0,
        resumed: 0,
        pos: 0,
        finish(seconds) {
          p.pos = seconds;
          opts.onPlayed?.(seconds);
          resolve({ source: 'clips', seconds });
        },
      };
      plays.push(p);
      const pb: ClipPlayback = {
        done,
        stop() {
          p.stopped = true;
          resolve({ source: 'clips', seconds: 0 });
        },
      };
      if (o.inPlace) {
        pb.pause = () => {
          p.paused++;
        };
        pb.resume = () => {
          p.resumed++;
        };
        pb.position = () => p.pos;
      }
      return pb;
    },
    unlock: () => {
      self.unlocked++;
    },
    dispose: () => undefined,
    cacheUsage: () => Promise.resolve({ bytes: 0, files: 0 }),
    download: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  };
  return self;
}

function fakeNav(): { mediaSession: MediaSessionLike & { handlers: Map<string, (() => void) | null> } } {
  const handlers = new Map<string, (() => void) | null>();
  return {
    mediaSession: {
      metadata: null,
      playbackState: 'none',
      handlers,
      setActionHandler(action, handler) {
        handlers.set(action, handler);
      },
    },
  };
}

class FakeMetadata {
  title: string;
  artist: string;
  album: string;
  constructor(init: MediaMetadataInit = {}) {
    this.title = init.title ?? '';
    this.artist = init.artist ?? '';
    this.album = init.album ?? '';
  }
}

/* ── harness ─────────────────────────────────────────────────────────────── */

let root: HTMLDivElement;
let hidden = false;
const g = globalThis as { MediaMetadata?: unknown; requestAnimationFrame?: unknown };
let savedCtor: unknown;
let savedRaf: unknown;
let rafCalls = 0;

beforeEach(async () => {
  await makeTestStore({ save: { settings: { furigana: 'off', speedTier: 3, sound: 1, audioSource: 'pack' }, progress: { station: 4 } } });
  bus.reset();
  installServices({ audio: fakeAudio() });
  root = document.createElement('div');
  document.body.appendChild(root);
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  savedCtor = g.MediaMetadata;
  g.MediaMetadata = FakeMetadata;
  savedRaf = g.requestAnimationFrame;
  rafCalls = 0;
  g.requestAnimationFrame = (): number => {
    rafCalls++;
    return 0;
  };
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
  delete (document as { hidden?: boolean }).hidden;
  if (savedCtor === undefined) delete g.MediaMetadata;
  else g.MediaMetadata = savedCtor;
  if (savedRaf === undefined) delete g.requestAnimationFrame;
  else g.requestAnimationFrame = savedRaf;
});

async function flush(n = 3): Promise<void> {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === text || (b.textContent ?? '').includes(text));
  if (!btn) throw new Error(`no button "${text}"`);
  return btn;
}
function key(k: string): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}
const played = (cap: { events: [string, unknown][] }): Record<string, unknown>[] => cap.events.filter(([n]) => n === 'listen:played').map(([, p]) => p as Record<string, unknown>);
const chip = (): string => root.querySelector('.radio__chip-source')?.textContent ?? '';
const headerText = (): string => root.querySelector('.radio__head')?.textContent ?? '';

function mount(inputs: RadioInputs, o: { clips?: ClipPlayer | null; nav?: ReturnType<typeof fakeNav> | null } = {}): void {
  act(() => render(<Radio loader={loader} clips={o.clips ?? null} inputs={inputs} nav={o.nav ?? null} />, root));
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

describe('Radio helpers', () => {
  it('levelOfStation follows the belt table', () => {
    expect(levelOfStation(1)).toBe('kana');
    expect(levelOfStation(4)).toBe('n5');
    expect(levelOfStation(16)).toBe('n4');
    expect(levelOfStation(53)).toBe('n1');
  });

  it('refSurface resolves example and line refs from loaded items, null otherwise', () => {
    expect(refSurface('v-n5-0007#ex0', loader)).toEqual({ ja: '{毎朝|まいあさ}コーヒーを{飲|の}みます。', en: 'I drink coffee every morning.' });
    expect(refSurface('s-04-1#L1', loader)).toEqual({ ja: STORY.lines[1]!.ja, en: STORY.lines[1]!.en });
    expect(refSurface('g-n5-001#ex0', loader)).not.toBeNull();
    expect(refSurface('v-n5-0007#ex9', loader)).toBeNull();
    expect(refSurface('v-n5-9999#ex0', loader)).toBeNull();
    expect(refSurface('nonsense', loader)).toBeNull();
  });

  it('loadRadioInputs gathers the fixture’s Station 4 texts, treats missing stations and pools as empty, and asks for kana tracks only at Stations 1–3', async () => {
    const clips = fakeClips({ kana: [{ key: 'track:a-row', file: 'k.webm', start: 0, end: 30, voice: 'v', rate: 1, title: 'a-row' }] });
    const at4 = await loadRadioInputs(loader, { station: 4, listened: [], clips });
    expect(at4.stories.map((s) => s.id)).toEqual([DIALOGUE.id]); // the diary s-04-1 is reading material from Station 4
    expect(at4.pools).toEqual([]);
    expect(at4.kanaTracks).toEqual([]);
    const at1 = await loadRadioInputs(loader, { station: 1, listened: [], clips });
    expect(at1.stories).toEqual([]);
    expect(at1.kanaTracks).toHaveLength(1);
    const noPack = await loadRadioInputs(loader, { station: 1, listened: [], clips: null });
    expect(noPack.kanaTracks).toEqual([]);
  });

  it('loadRadioInputs walks past the nearest unheard diaries to an older unheard dialogue, so “nothing new” is never said while a piece or dialogue waits', async () => {
    // Stations 5–10: two unheard diaries and one heard dialogue each (12 unheard ids that Radio may not play); Station 4: the unheard fixture dialogue.
    const pad = (n: number): string => String(n).padStart(2, '0');
    const items: Record<string, StoryItem> = {};
    const stations: StationBundle[] = [];
    const heard: string[] = [];
    for (let n = 5; n <= 10; n++) {
      const d1: StoryItem = { ...STORY, id: `s-${pad(n)}-1`, stationId: `st-${pad(n)}` };
      const d3: StoryItem = { ...STORY, id: `s-${pad(n)}-3`, stationId: `st-${pad(n)}` };
      const dlg: StoryItem = { ...DIALOGUE, id: `s-${pad(n)}-2`, stationId: `st-${pad(n)}` };
      for (const x of [d1, dlg, d3]) items[x.id] = x;
      heard.push(dlg.id);
      stations.push({ ...STATION_4, number: n, storyIds: [d1.id, dlg.id, d3.id] });
    }
    const deep = createFakeLoader({ ...FIXTURE, stations: [...FIXTURE.stations, ...stations], items: { ...FIXTURE.items, ...items } });
    const inp = await loadRadioInputs(deep, { station: 10, listened: heard, clips: null });
    const ids = inp.stories.map((s) => s.id);
    expect(ids[0]).toBe(DIALOGUE.id); // the cold candidate the old nearest-12-ids cut would have missed
    expect(ids.filter((id) => /-(1|3)$/.test(id))).toEqual([]); // no diary is loaded as a candidate
    expect(ids.slice(1)).toEqual(heard); // the heard dialogues follow, least recently heard first
    // the player built from these inputs has a cold track and no “nothing new” notice
    await makeTestStore({ save: { settings: { furigana: 'off', speedTier: 3, sound: 1, audioSource: 'pack' }, progress: { station: 10, listened: heard } } });
    mount(inp, { clips: null });
    expect(root.querySelector('.radio__playlist-notice')).toBeNull();
    expect(root.querySelector('.radio__track-title')?.textContent).toContain(DIALOGUE.titleEn);
    expect(root.querySelector('.chip--accent')?.textContent).toBe(S.coldLabel);
  });

  it('loadRadioInputs fetches a text the Arena passed recently ahead of the least-recently-heard cut (13 heard dialogues, the Arena text LAST in listened): it is in the inputs, leads the re-hearings, is loaded once and not cold even when the capped heard-set forgot it, and the live <Radio> (no injected inputs) opens on it', async () => {
    const pad = (n: number): string => String(n).padStart(2, '0');
    const items: Record<string, StoryItem> = {};
    const stations: StationBundle[] = [];
    const heard: string[] = [];
    for (let n = 5; n <= 17; n++) {
      const dlg: StoryItem = { ...DIALOGUE, id: `s-${pad(n)}-2`, stationId: `st-${pad(n)}`, titleEn: `Dialogue ${n}` };
      items[dlg.id] = dlg;
      heard.push(dlg.id);
      stations.push({ ...STATION_4, number: n, storyIds: [dlg.id] });
    }
    const arena = heard[heard.length - 1]!; // s-17-2: a first Arena pass appends its id at the END of `listened`
    const deep = createFakeLoader({ ...FIXTURE, stations: [...FIXTURE.stations, ...stations], items: { ...FIXTURE.items, ...items } });
    expect(heard.length).toBe(REHEAR_LOAD_MAX + 1);

    // without the set the LRU cut drops the newest heard id — the gap the rule must not fall into
    const plain = await loadRadioInputs(deep, { station: 17, listened: heard, clips: null });
    expect(plain.stories.map((s) => s.id)).not.toContain(arena);

    const recent = new Set([arena]);
    const inp = await loadRadioInputs(deep, { station: 17, listened: heard, arenaRecent: recent, clips: null });
    const ids = inp.stories.map((s) => s.id);
    expect(ids).toEqual([DIALOGUE.id, arena, ...heard.slice(0, REHEAR_LOAD_MAX)]); // cold candidate, then the Arena text, then the LRU cut
    const base = { seed: '0123456789abcdef', day: store.today(), station: 17, known: new Set<string>(), cards: store.cards, pools: [], tier: 3 as const };
    const pl = buildPlaylist({ ...base, listened: heard, stories: inp.stories, arenaRecent: recent });
    expect(pl.tracks.filter((t) => t.rehearing)[0]!.id).toBe(arena);
    expect(pl.tracks.find((t) => t.id === arena)).toMatchObject({ cold: false, rehearing: true });

    // the store's cap forgot the id: the cold walk skips it, the re-hearing load fetches it once, and the builder keeps it off the cold list
    const forgot = await loadRadioInputs(deep, { station: 17, listened: heard.slice(0, -1), arenaRecent: recent, clips: null });
    const fids = forgot.stories.map((s) => s.id);
    expect(fids.filter((id) => id === arena)).toHaveLength(1);
    expect(fids[1]).toBe(arena);
    const plF = buildPlaylist({ ...base, listened: heard.slice(0, -1), stories: forgot.stories, arenaRecent: recent });
    expect(plF.tracks.find((t) => t.id === arena)).toMatchObject({ cold: false, rehearing: true });
    expect(plF.tracks.filter((t) => t.rehearing)[0]!.id).toBe(arena);

    // the live path: no injected inputs, `arenaAt` from the store, every text heard → the first track is the Arena text at one tier up
    const all = [DIALOGUE.id, ...heard];
    await makeTestStore({ save: { settings: { furigana: 'off', speedTier: 3, sound: 1, audioSource: 'pack' }, progress: { station: 17, listened: all, arenaAt: { [arena]: store.today() - 1 } } } });
    const clips = fakeClips({ texts: Object.values(items) });
    await act(async () => {
      render(<Radio loader={deep} clips={clips} nav={null} />, root);
    });
    await flush();
    expect(root.querySelector('.radio')?.getAttribute('data-status')).toBe('idle');
    expect(root.querySelector('.radio__track-title')?.textContent).toContain('Dialogue 17');
    expect(root.querySelector('.radio__again')?.textContent).toBe(fill(S.againAt, { rate: SPEED_TIER_RATES[4] }));
    expect(root.querySelector('.chip--accent')).toBeNull();
    act(() => buttonByText(S.play).click());
    await flush();
    expect(clips.plays[0]!.cue.key).toBe(arena);
  });
});

/* ── pack mode ───────────────────────────────────────────────────────────── */

describe('<Radio> with the pack', () => {
  it('plays a whole-text track edge to edge; listen:played seconds equal the player’s timeupdate-derived count with the screen off and no rAF (600 s → 600 s); listened grows; zero XP, no session', async () => {
    const clips = fakeClips({ texts: [PIECE] });
    const nav = fakeNav();
    const cap = captureEvents();
    mount(inputsOf([PIECE]), { clips, nav });
    expect(chip()).toBe(S.chipSynthetic);
    expect(headerText()).not.toMatch(/recorded/i);
    expect(root.querySelector('.radio__notice')?.textContent).toBe(S.noticePack);
    expect(root.querySelector('.radio__track-title')?.textContent).toContain('At the counter');

    act(() => buttonByText(S.play).click());
    await flush();
    expect(clips.unlocked).toBe(1);
    expect(clips.loaded).toEqual([4]);
    expect(clips.plays).toHaveLength(1);
    const play = clips.plays[0]!;
    expect(play.cue.key).toBe(PIECE.id);
    expect(play.o.wholeTrack).toBe(true);
    expect(play.o.rate).toBe(SPEED_TIER_RATES[3]);
    expect(play.o.volume).toBe(1);
    expect(root.querySelector('.radio')?.getAttribute('data-status')).toBe('playing');
    // the lock-screen card names the voice honestly
    const meta = nav.mediaSession.metadata as unknown as FakeMetadata;
    expect(meta.title).toBe(PIECE.titleJa);
    expect(meta.artist).toBe('ケン · synthetic · VOICEVOX:九州そら');
    expect(meta.album).toContain('Station 4');
    expect([...nav.mediaSession.handlers.keys()].sort()).toEqual(['nexttrack', 'pause', 'play', 'previoustrack', 'seekbackward']);

    hidden = true;
    act(() => play.finish(600));
    await flush();
    const rows = played(cap);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ source: 'radio', refs: [PIECE.id], seconds: 600, rate: 1, cold: true, authentic: false, gistCorrect: null });
    expect(rafCalls).toBe(0);
    expect(store.progress.value.listened).toEqual([PIECE.id]);
    expect(cap.events.some(([n]) => n === 'xp:gained' || n === 'session:started' || n === 'session:finished' || n === 'story:read')).toBe(false);
    // one track → the playlist is done; the ledger line says no XP
    expect(root.querySelector('.radio')?.getAttribute('data-status')).toBe('done');
    expect(root.querySelector('.radio__done')?.textContent).toContain(fill(S.doneLine, { n: 10 }));
    cap.stop();
  });

  it('authentic only after a correct gist answer: on a cold track and on a re-hearing alike; wrong → false; the re-hearing says “Here it is again at 1.1×”', async () => {
    // cold bridge dialogue at tier 3 (1.0×)
    let clips = fakeClips({ texts: [BRIDGE] });
    let cap = captureEvents();
    mount(inputsOf([BRIDGE]), { clips });
    act(() => buttonByText(S.play).click());
    await flush();
    act(() => clips.plays[0]!.finish(120));
    await flush();
    expect(root.querySelector('.radio')?.getAttribute('data-status')).toBe('question');
    expect(played(cap)).toHaveLength(0); // the row waits for the answer
    const q = BRIDGE.comprehension[0]!;
    expect(root.querySelector('.radio__gist-q')?.textContent).toBe(q.q);
    act(() => (root.querySelector(`.radio__choice[aria-keyshortcuts="${q.answer + 1}"]`) as HTMLButtonElement).click());
    await flush();
    expect(played(cap)[0]).toMatchObject({ refs: [BRIDGE.id], seconds: 120, rate: 1, cold: true, authentic: true, gistCorrect: true });
    expect(root.querySelector('.radio__done')).not.toBeNull();
    cap.stop();
    render(null, root);

    // re-hearing of the same text at tier 4 (1.1×)
    await makeTestStore({ save: { settings: { furigana: 'off', speedTier: 3, sound: 1, audioSource: 'pack' }, progress: { station: 4, listened: [BRIDGE.id] } } });
    clips = fakeClips({ texts: [BRIDGE] });
    cap = captureEvents();
    mount(inputsOf([BRIDGE]), { clips });
    expect(root.querySelector('.radio__again')?.textContent).toBe(fill(S.againAt, { rate: SPEED_TIER_RATES[4] }));
    act(() => buttonByText(S.play).click());
    await flush();
    expect(clips.plays[0]!.o.rate).toBe(SPEED_TIER_RATES[4]);
    act(() => clips.plays[0]!.finish(100));
    await flush();
    expect(root.querySelector('.radio')?.getAttribute('data-status')).toBe('question');
    act(() => (root.querySelector(`.radio__choice[aria-keyshortcuts="${q.answer + 1}"]`) as HTMLButtonElement).click());
    await flush();
    expect(played(cap)[0]).toMatchObject({ cold: false, authentic: true, gistCorrect: true, rate: SPEED_TIER_RATES[4] });
    expect(store.progress.value.listened).toEqual([BRIDGE.id]); // appended once
    cap.stop();
    render(null, root);

    // a wrong answer: understood = false, so no authentic minutes
    await makeTestStore({ save: { settings: { furigana: 'off', speedTier: 3, sound: 1, audioSource: 'pack' }, progress: { station: 4 } } });
    clips = fakeClips({ texts: [BRIDGE] });
    cap = captureEvents();
    mount(inputsOf([BRIDGE]), { clips });
    act(() => buttonByText(S.play).click());
    await flush();
    act(() => clips.plays[0]!.finish(90));
    await flush();
    const wrong = (q.answer + 1) % 4;
    act(() => (root.querySelector(`.radio__choice[aria-keyshortcuts="${wrong + 1}"]`) as HTMLButtonElement).click());
    await flush();
    expect(played(cap)[0]).toMatchObject({ cold: true, authentic: false, gistCorrect: false });
    expect(root.querySelector('.radio__note')?.textContent).toBe(fill(S.gistWrong, { answer: q.choices[q.answer] }));
    cap.stop();
  });

  it('gistCorrect is null when the question is skipped, by the button or by Space', async () => {
    const clips = fakeClips({ texts: [BRIDGE, PIECE] });
    const cap = captureEvents();
    mount(inputsOf([BRIDGE, PIECE]), { clips });
    act(() => buttonByText(S.play).click());
    await flush();
    act(() => clips.plays[0]!.finish(60));
    await flush();
    act(() => buttonByText(S.gistSkip).click());
    await flush();
    // the cold order within a station is the day's shuffle: read it off the player
    const first = clips.plays[0]!.cue.key;
    const second = first === BRIDGE.id ? PIECE.id : BRIDGE.id;
    expect(played(cap)[0]).toMatchObject({ refs: [first], gistCorrect: null, authentic: false, cold: true });
    expect(root.querySelector('.radio__note')?.textContent).toBe(S.gistSkipped);
    // the next track started on its own
    expect(clips.plays).toHaveLength(2);
    expect(clips.plays[1]!.cue.key).toBe(second);
    act(() => clips.plays[1]!.finish(60));
    await flush();
    key(' ');
    await flush();
    expect(played(cap)[1]).toMatchObject({ refs: [second], gistCorrect: null });
    cap.stop();
  });

  it('a track that ends while the screen is off skips its question; a skipped track (→) logs only what played and is not marked heard', async () => {
    const clips = fakeClips({ texts: [BRIDGE, PIECE] });
    const cap = captureEvents();
    mount(inputsOf([BRIDGE, PIECE]), { clips });
    act(() => buttonByText(S.play).click());
    await flush();
    const first = clips.plays[0]!.cue.key;
    const second = first === BRIDGE.id ? PIECE.id : BRIDGE.id;
    act(() => clips.plays[0]!.o.onPlayed?.(30));
    key('ArrowRight');
    await flush();
    expect(clips.plays[0]!.stopped).toBe(true);
    expect(played(cap)[0]).toMatchObject({ refs: [first], seconds: 30, gistCorrect: null });
    expect(store.progress.value.listened ?? []).toEqual([]);
    expect(clips.plays).toHaveLength(2);
    expect(clips.plays[1]!.cue.key).toBe(second);
    hidden = true;
    act(() => clips.plays[1]!.finish(200));
    await flush();
    expect(played(cap)[1]).toEqual({ source: 'radio', refs: [second], seconds: 200, rate: 1, cold: true, authentic: false, gistCorrect: null });
    expect(store.progress.value.listened).toEqual([second]);
    cap.stop();
  });

  it('[ and ] change the speed for this sitting only (the preset is untouched); pause logs the partial seconds', async () => {
    const clips = fakeClips({ texts: [PIECE] });
    const cap = captureEvents();
    mount(inputsOf([PIECE]), { clips });
    expect(root.querySelector('.radio__meta')?.textContent).toContain('1×');
    key(']');
    expect(root.querySelector('.radio__meta')?.textContent).toContain(fill(S.chipSpeed, { rate: SPEED_TIER_RATES[4] }));
    expect(root.querySelector('.radio__note')?.textContent).toBe(S.speedNote);
    key('[');
    key('[');
    expect(root.querySelector('.radio__meta')?.textContent).toContain(fill(S.chipSpeed, { rate: SPEED_TIER_RATES[2] }));
    expect(store.settings.value.speedTier).toBe(3);
    act(() => buttonByText(S.play).click());
    await flush();
    expect(clips.plays[0]!.o.rate).toBe(SPEED_TIER_RATES[2]);
    act(() => clips.plays[0]!.o.onPlayed?.(45));
    act(() => buttonByText(S.pause).click());
    await flush();
    expect(played(cap)[0]).toMatchObject({ seconds: 45, rate: SPEED_TIER_RATES[2], gistCorrect: null });
    expect(root.querySelector('.radio')?.getAttribute('data-status')).toBe('paused');
    expect(root.querySelector('.radio__note')?.textContent).toBe(S.pauseNote);
    cap.stop();
  });

  it('a playback with pause / resume pauses in place: Space logs the seconds so far from position(), resume continues the same playback, and the completed row is done.seconds minus what was logged (no second twice)', async () => {
    const clips = fakeClips({ texts: [PIECE], inPlace: true });
    const nav = fakeNav();
    const cap = captureEvents();
    mount(inputsOf([PIECE]), { clips, nav });
    act(() => buttonByText(S.play).click());
    await flush();
    expect(clips.plays).toHaveLength(1);
    act(() => clips.plays[0]!.o.onPlayed?.(45));
    key(' ');
    await flush();
    const play = clips.plays[0]!;
    expect(play.paused).toBe(1);
    expect(play.stopped).toBe(false);
    expect(root.querySelector('.radio')?.getAttribute('data-status')).toBe('paused');
    expect(root.querySelector('.radio__note')?.textContent).toBe(S.pauseNoteInPlace);
    expect(nav.mediaSession.playbackState).toBe('paused');
    expect(played(cap)).toHaveLength(1);
    expect(played(cap)[0]).toMatchObject({ refs: [PIECE.id], seconds: 45, rate: 1, cold: true, gistCorrect: null });
    expect(store.progress.value.listened ?? []).toEqual([]);
    // a second pause press while paused changes nothing
    act(() => nav.mediaSession.handlers.get('pause')?.());
    expect(play.paused).toBe(1);
    expect(played(cap)).toHaveLength(1);
    act(() => buttonByText(S.resume).click());
    await flush();
    expect(play.resumed).toBe(1);
    expect(clips.plays).toHaveLength(1); // the same playback, not a restart
    expect(root.querySelector('.radio')?.getAttribute('data-status')).toBe('playing');
    expect(root.querySelector('.radio__note')).toBeNull(); // the "Paused…" line is gone while it plays
    expect(nav.mediaSession.playbackState).toBe('playing');
    act(() => play.finish(600));
    await flush();
    if (root.querySelector('.radio')?.getAttribute('data-status') === 'question') {
      act(() => buttonByText(S.gistSkip).click());
      await flush();
    }
    const rows = played(cap);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ refs: [PIECE.id], seconds: 555, rate: 1, cold: true, gistCorrect: null });
    expect(rows.reduce((s, r) => s + (r.seconds as number), 0)).toBe(600);
    expect(store.progress.value.listened).toEqual([PIECE.id]);
    expect(root.querySelector('.radio__done')?.textContent).toContain(fill(S.doneLine, { n: 10 }));
    cap.stop();
  });

  it('a speed change while paused in place drops the position: play starts the track over at the new speed with nothing logged twice; leaving the page while paused in place logs nothing more', async () => {
    const clips = fakeClips({ texts: [PIECE], inPlace: true });
    const cap = captureEvents();
    mount(inputsOf([PIECE]), { clips });
    act(() => buttonByText(S.play).click());
    await flush();
    act(() => clips.plays[0]!.o.onPlayed?.(100));
    act(() => buttonByText(S.pause).click());
    await flush();
    expect(played(cap)).toHaveLength(1);
    expect(played(cap)[0]).toMatchObject({ seconds: 100, rate: 1 });
    key(']');
    await flush();
    expect(clips.plays[0]!.stopped).toBe(true);
    expect(root.querySelector('.radio')?.getAttribute('data-status')).toBe('paused');
    expect(played(cap)).toHaveLength(1);
    act(() => buttonByText(S.resume).click());
    await flush();
    expect(clips.plays).toHaveLength(2);
    expect(clips.plays[1]!.o.rate).toBe(SPEED_TIER_RATES[4]);
    expect(clips.plays[0]!.resumed).toBe(0);
    act(() => clips.plays[1]!.o.onPlayed?.(30));
    act(() => buttonByText(S.pause).click());
    await flush();
    expect(clips.plays[1]!.paused).toBe(1);
    expect(played(cap)).toHaveLength(2);
    expect(played(cap)[1]).toMatchObject({ seconds: 30, rate: SPEED_TIER_RATES[4], gistCorrect: null });
    act(() => render(null, root));
    expect(played(cap)).toHaveLength(2); // paused in place at unmount: its seconds were logged at the pause
    expect(clips.plays[1]!.stopped).toBe(true);
    cap.stop();
  });

  it('a text the Arena passed 3 days ago (progress.arenaAt) leads the re-hearings; one passed 20 days ago keeps its least-recently-heard place', async () => {
    const today = store.today();
    const base = { settings: { furigana: 'off' as const, speedTier: 3 as const, sound: 1, audioSource: 'pack' as const } };
    await makeTestStore({ save: { ...base, progress: { station: 4, listened: [PIECE.id, BRIDGE.id], arenaAt: { [BRIDGE.id]: today - 3 } } } });
    let clips = fakeClips({ texts: [BRIDGE, PIECE] });
    mount(inputsOf([BRIDGE, PIECE]), { clips });
    act(() => buttonByText(S.play).click());
    await flush();
    expect(clips.plays[0]!.cue.key).toBe(BRIDGE.id); // worked on recently: ahead of the least recently heard PIECE
    expect(root.querySelector('.radio__again')?.textContent).toBe(fill(S.againAt, { rate: SPEED_TIER_RATES[4] }));
    render(null, root);

    await makeTestStore({ save: { ...base, progress: { station: 4, listened: [PIECE.id, BRIDGE.id], arenaAt: { [BRIDGE.id]: today - 20 } } } });
    clips = fakeClips({ texts: [BRIDGE, PIECE] });
    mount(inputsOf([BRIDGE, PIECE]), { clips });
    act(() => buttonByText(S.play).click());
    await flush();
    expect(clips.plays[0]!.cue.key).toBe(PIECE.id); // 20 days is not recent: least recently heard first, as before
  });

  it('play prefetches the station’s sprites unless data saver is on — the learner’s toggle or the browser’s saveData (dataSaverOn, design 08 §13)', async () => {
    let clips = fakeClips({ texts: [PIECE] });
    mount(inputsOf([PIECE]), { clips });
    act(() => buttonByText(S.play).click());
    await flush();
    expect(clips.prefetched).toEqual([4]);
    render(null, root);

    await makeTestStore({ save: { settings: { furigana: 'off', speedTier: 3, sound: 1, audioSource: 'pack', dataSaver: true }, progress: { station: 4 } } });
    clips = fakeClips({ texts: [PIECE] });
    mount(inputsOf([PIECE]), { clips });
    act(() => buttonByText(S.play).click());
    await flush();
    expect(clips.prefetched).toEqual([]);
    expect(clips.plays).toHaveLength(1); // the current track still plays
    render(null, root);

    await makeTestStore({ save: { settings: { furigana: 'off', speedTier: 3, sound: 1, audioSource: 'pack', dataSaver: false }, progress: { station: 4 } } });
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
    try {
      clips = fakeClips({ texts: [PIECE] });
      mount(inputsOf([PIECE]), { clips });
      act(() => buttonByText(S.play).click());
      await flush();
      expect(clips.prefetched).toEqual([]);
    } finally {
      delete (navigator as { connection?: unknown }).connection;
    }
  });

  it('a Station-2 learner sees the “no pieces yet” notice and plays the kana tracks as whole tracks', async () => {
    await makeTestStore({ save: { settings: { furigana: 'off', speedTier: 1, sound: 1, audioSource: 'pack' }, progress: { station: 2 } } });
    const cue: TrackCue = { key: 'track:a-row', file: 'audio/sprites/kana/a-row-abcdef12.webm', start: 0, end: 30, voice: 'VOICEVOX:九州そら', rate: 1, title: 'あいうえお', titleEn: 'a-row' };
    const clips = fakeClips({ kana: [cue] });
    const cap = captureEvents();
    mount(inputsOf([], { kanaTracks: [cue] }), { clips });
    expect(root.querySelector('.radio__playlist-notice')?.textContent).toBe(S.noticeNoPieces);
    expect(root.querySelector('.radio__track-title')?.textContent).toContain('a-row');
    act(() => buttonByText(S.play).click());
    await flush();
    expect(clips.plays[0]!.cue).toBe(cue);
    expect(clips.plays[0]!.o.wholeTrack).toBe(true);
    act(() => clips.plays[0]!.finish(30));
    await flush();
    expect(played(cap)[0]).toMatchObject({ refs: ['track:a-row'], seconds: 30, cold: false, authentic: false, gistCorrect: null });
    expect(store.progress.value.listened ?? []).toEqual([]); // a kana track is not a text
    cap.stop();
  });

  it('a pack that is not ready, or Settings preferring the device voice, means device mode', () => {
    mount(inputsOf([PIECE]), { clips: fakeClips({ ready: 'absent', texts: [PIECE] }) });
    expect(chip()).toBe(S.chipDevice);
    render(null, root);
    store.patch('settings', (s) => ({ ...s, audioSource: 'device' }));
    mount(inputsOf([PIECE]), { clips: fakeClips({ texts: [PIECE] }) });
    expect(chip()).toBe(S.chipDevice);
    expect(root.querySelector('.radio__notice')?.textContent).toBe(S.noticeDeviceChosen);
  });
});

describe('<Radio> with the pack: partial rows, open questions, karaoke, foreground tracks', () => {
  it('→ (or the lock screen’s next) during an open question logs the track with gistCorrect null; so does leaving the page', async () => {
    const clips = fakeClips({ texts: [BRIDGE, PIECE] });
    const nav = fakeNav();
    const cap = captureEvents();
    mount(inputsOf([BRIDGE, PIECE]), { clips, nav });
    act(() => buttonByText(S.play).click());
    await flush();
    const first = clips.plays[0]!.cue.key;
    const second = first === BRIDGE.id ? PIECE.id : BRIDGE.id;
    act(() => clips.plays[0]!.finish(180));
    await flush();
    expect(root.querySelector('.radio')?.getAttribute('data-status')).toBe('question');
    expect(played(cap)).toHaveLength(0);
    act(() => nav.mediaSession.handlers.get('nexttrack')!!());
    await flush();
    expect(played(cap)).toHaveLength(1);
    expect(played(cap)[0]).toEqual({ source: 'radio', refs: [first], seconds: 180, rate: 1, cold: true, authentic: false, gistCorrect: null });
    expect(store.progress.value.listened).toEqual([first]);
    expect(clips.plays).toHaveLength(2);
    expect(clips.plays[1]!.cue.key).toBe(second);
    // the second track ends, its question opens, and the learner leaves the page
    act(() => clips.plays[1]!.finish(240));
    await flush();
    expect(root.querySelector('.radio')?.getAttribute('data-status')).toBe('question');
    act(() => render(null, root));
    expect(played(cap)).toHaveLength(2);
    expect(played(cap)[1]).toMatchObject({ refs: [second], seconds: 240, gistCorrect: null, cold: true });
    expect(store.progress.value.listened).toEqual([first, second]);
    expect(cap.events.some(([n]) => n === 'xp:gained' || n === 'session:started' || n === 'session:finished')).toBe(false);
    cap.stop();
  });

  it('[ ] mid-track logs the seconds played so far at the old rate before restarting; leaving the page mid-track logs them too', async () => {
    const clips = fakeClips({ texts: [PIECE] });
    const cap = captureEvents();
    mount(inputsOf([PIECE]), { clips });
    act(() => buttonByText(S.play).click());
    await flush();
    act(() => clips.plays[0]!.o.onPlayed?.(300));
    key(']');
    await flush();
    expect(clips.plays[0]!.stopped).toBe(true);
    expect(played(cap)).toHaveLength(1);
    expect(played(cap)[0]).toMatchObject({ refs: [PIECE.id], seconds: 300, rate: 1, cold: true, gistCorrect: null });
    expect(clips.plays).toHaveLength(2);
    expect(clips.plays[1]!.o.rate).toBe(SPEED_TIER_RATES[4]);
    expect(store.progress.value.listened ?? []).toEqual([]); // not heard to the end
    act(() => clips.plays[1]!.o.onPlayed?.(20));
    act(() => render(null, root));
    expect(played(cap)).toHaveLength(2);
    expect(played(cap)[1]).toMatchObject({ refs: [PIECE.id], seconds: 20, rate: SPEED_TIER_RATES[4], gistCorrect: null });
    cap.stop();
  });

  it('the transcript is karaoke-timed: the player’s onProgress over the per-line cues lights the line; the component itself never touches rAF', async () => {
    const clips = fakeClips({ texts: [PIECE] });
    mount(inputsOf([PIECE]), { clips });
    key('t');
    act(() => buttonByText(S.play).click());
    await flush();
    const pl = clips.plays[0]!;
    expect(typeof pl.o.onProgress).toBe('function');
    expect(root.querySelector('.radio__line[data-speaking="true"]')).toBeNull();
    act(() => pl.o.onProgress!(75, 0, 0)); // per-line cues sit at i × 50 s in the fixture sprite → line 2
    const lit = root.querySelectorAll('.radio__line[data-speaking="true"]');
    expect(lit).toHaveLength(1);
    expect(lit[0]!.textContent).toContain(PIECE.lines[1]!.en);
    expect(lit[0]!.getAttribute('aria-current')).toBe('true');
    expect(root.querySelector('.radio__status')?.textContent).toBe(fill(S.lineOf, { i: 2, n: PIECE.lines.length }));
    act(() => pl.o.onProgress!(10, 0, 0));
    expect(root.querySelector('.radio__line[data-speaking="true"]')?.textContent).toContain(PIECE.lines[0]!.en);
    expect(rafCalls).toBe(0);
  });

  it('a sentence track in pack mode stays on speak(), updates the lock-screen card, and logs the clip’s length scaled to the rate it played at', async () => {
    const today = store.today();
    // both words known (rec R ≥ 0.85), so the sentence is i+0 and on the playlist
    const known = {
      [cardKey(V.飲む, 'rec')]: card({ due: today + 10, s: 20, state: 2, reps: 4, last: today - 2 }),
      [cardKey(V.コーヒー, 'rec')]: card({ due: today + 10, s: 20, state: 2, reps: 4, last: today - 2 }),
    };
    await makeTestStore({ save: { settings: { furigana: 'off', speedTier: 5, sound: 1, audioSource: 'pack' }, progress: { station: 4 } }, cards: known });
    const audio = fakeAudio({ deferred: true });
    audio.clipFor = (key) => (key === REF.ref ? { key, file: 'audio/sprites/n5/vocab-abcdef12.webm', start: 100, end: 110, voice: 'VOICEVOX:九州そら', rate: 1 } : undefined);
    installServices({ audio });
    const clips = fakeClips();
    const nav = fakeNav();
    const cap = captureEvents();
    mount(inputsOf([], { pools: [REF] }), { clips, nav });
    act(() => buttonByText(S.play).click());
    await flush();
    expect(clips.plays).toHaveLength(0);
    expect(audio.spoken).toHaveLength(1);
    expect(audio.spoken[0]!.o).toMatchObject({ clip: REF.ref, rate: SPEED_TIER_RATES[5] });
    const meta = nav.mediaSession.metadata as unknown as FakeMetadata;
    expect(meta.title).toBe(REF.kana);
    expect(meta.artist).toBe('ハナ · synthetic · VOICEVOX:九州そら');
    expect(nav.mediaSession.playbackState).toBe('playing');
    act(() => audio.spoken[0]!.resolve());
    await flush();
    // a 10 s clip at 1.25× is 8 s of hearing, not 10
    expect(played(cap)[0]).toMatchObject({ refs: [REF.ref], seconds: 8, rate: SPEED_TIER_RATES[5], cold: false, gistCorrect: null });
    cap.stop();
    render(null, root);

    // a natural-slow take (0.85) requested at tier 1 (0.75×) plays longer than its native length
    await makeTestStore({ save: { settings: { furigana: 'off', speedTier: 1, sound: 1, audioSource: 'pack' }, progress: { station: 4 } }, cards: known });
    const slow = fakeAudio();
    slow.clipFor = (key) => (key === REF.ref ? { key, file: 'audio/sprites/n5/vocab-abcdef12.webm', start: 0, end: 10, voice: 'VOICEVOX:九州そら', rate: 0.85 } : undefined);
    installServices({ audio: slow });
    const cap2 = captureEvents();
    mount(inputsOf([], { pools: [REF] }), { clips: fakeClips() });
    act(() => buttonByText(S.play).click());
    await flush();
    expect(played(cap2)[0]!.seconds).toBe(Math.round((10 * 0.85) / 0.75 * 10) / 10);
    cap2.stop();
  });

  it('a pack without a whole track for the text plays its lines in the foreground, says so on the card, and names it on the lock screen without a made-up credit', async () => {
    const audio = fakeAudio({ deferred: true });
    installServices({ audio });
    const clips = fakeClips(); // ready, but no cues at all
    const nav = fakeNav();
    mount(inputsOf([PIECE]), { clips, nav });
    expect(chip()).toBe(S.chipSynthetic);
    expect(root.querySelector('.radio__track-notice')).toBeNull();
    act(() => buttonByText(S.play).click());
    await flush();
    expect(clips.loaded).toEqual([4]);
    expect(clips.plays).toHaveLength(0);
    expect(audio.spoken).toHaveLength(1);
    expect(audio.spoken[0]!.o).toMatchObject({ clip: `${PIECE.id}#L0` });
    expect(root.querySelector('.radio__track-notice')?.textContent).toBe(S.noticeNoWholeTrack);
    const meta = nav.mediaSession.metadata as unknown as FakeMetadata;
    expect(meta.title).toBe(PIECE.titleJa);
    expect(meta.artist).toBe('ケン · synthetic');
    expect(root.textContent).not.toMatch(/recorded/i);
  });

  it('Space on a focused gist choice answers it (the button’s own activation) instead of skipping the question', async () => {
    const clips = fakeClips({ texts: [BRIDGE] });
    const cap = captureEvents();
    mount(inputsOf([BRIDGE]), { clips });
    act(() => buttonByText(S.play).click());
    await flush();
    act(() => clips.plays[0]!.finish(60));
    await flush();
    const q = BRIDGE.comprehension[0]!;
    const choice = root.querySelector(`.radio__choice[aria-keyshortcuts="${q.answer + 1}"]`) as HTMLButtonElement;
    choice.focus();
    act(() => {
      choice.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    });
    await flush();
    expect(root.querySelector('.radio')?.getAttribute('data-status')).toBe('question');
    expect(played(cap)).toHaveLength(0);
    act(() => choice.click());
    await flush();
    expect(played(cap)[0]).toMatchObject({ gistCorrect: true, authentic: true });
    cap.stop();
  });

  it('a completed re-hearing moves its id to the back of progress.listened (least recently heard first stays true)', async () => {
    await makeTestStore({ save: { settings: { furigana: 'off', speedTier: 3, sound: 1, audioSource: 'pack' }, progress: { station: 4, listened: [PIECE.id, BRIDGE.id] } } });
    const clips = fakeClips({ texts: [BRIDGE, PIECE] });
    mount(inputsOf([BRIDGE, PIECE]), { clips });
    act(() => buttonByText(S.play).click());
    await flush();
    expect(clips.plays[0]!.cue.key).toBe(PIECE.id); // the least recently heard text comes first
    act(() => clips.plays[0]!.finish(100));
    await flush();
    if (root.querySelector('.radio')?.getAttribute('data-status') === 'question') {
      act(() => buttonByText(S.gistSkip).click());
      await flush();
    }
    expect(store.progress.value.listened).toEqual([BRIDGE.id, PIECE.id]);
    expect(clips.plays[1]!.cue.key).toBe(BRIDGE.id);
  });
});

/* ── device mode ─────────────────────────────────────────────────────────── */

describe('<Radio> without the pack (device voice)', () => {
  it('says “device voice” and why background play is unavailable; plays line by line through speak() with clip keys; no Media Session; header never says recorded', async () => {
    const audio = fakeAudio();
    installServices({ audio });
    const nav = fakeNav();
    const cap = captureEvents();
    mount(inputsOf([PIECE]), { clips: null, nav });
    expect(chip()).toBe(S.chipDevice);
    expect(root.querySelector('.radio__notice')?.textContent).toBe(S.noticeDevice);
    expect(headerText()).not.toMatch(/recorded/i);
    expect(root.textContent).not.toMatch(/recorded/i);
    act(() => buttonByText(S.play).click());
    await flush(6);
    expect(audio.spoken).toHaveLength(PIECE.lines.length);
    expect(audio.spoken[0]!.o).toMatchObject({ clip: `${PIECE.id}#L0`, speaker: 'ケン', rate: SPEED_TIER_RATES[3], interrupt: true });
    expect(audio.spoken[1]!.o).toMatchObject({ clip: `${PIECE.id}#L1`, speaker: 'ハナ', interrupt: false });
    expect(audio.spoken[0]!.text).toBe('おはよう、ハナ。');
    expect(nav.mediaSession.handlers.size).toBe(0);
    expect(nav.mediaSession.metadata).toBeNull();
    const rows = played(cap);
    expect(rows).toHaveLength(0); // cold track: the gist question is up
    expect(root.querySelector('.radio')?.getAttribute('data-status')).toBe('question');
    act(() => buttonByText(S.gistSkip).click());
    await flush();
    expect(played(cap)[0]).toMatchObject({ refs: [PIECE.id], cold: true, gistCorrect: null, authentic: false, rate: 1 });
    expect(played(cap)[0]!.seconds as number).toBeGreaterThan(PIECE.lines.length * 0.5);
    expect(store.progress.value.listened).toEqual([PIECE.id]);
    expect(cap.events.some(([n]) => n === 'xp:gained' || n === 'session:started')).toBe(false);
    cap.stop();
  });

  it('a line-by-line track waits at the line boundary while the screen is off and resumes on visibilitychange', async () => {
    const audio = fakeAudio({ deferred: true });
    installServices({ audio });
    mount(inputsOf([PIECE]), { clips: null });
    act(() => buttonByText(S.play).click());
    await flush();
    expect(audio.spoken).toHaveLength(1);
    hidden = true;
    act(() => audio.spoken[0]!.resolve());
    await flush();
    expect(audio.spoken).toHaveLength(1); // line 2 waits
    hidden = false;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(audio.spoken).toHaveLength(2);
  });

  it('pause mid-text logs the lines heard so far and resume picks up at the line; [ ] restarts the line at the new speed; → logs the lines since', async () => {
    const audio = fakeAudio({ deferred: true });
    installServices({ audio });
    const cap = captureEvents();
    mount(inputsOf([PIECE]), { clips: null });
    act(() => buttonByText(S.play).click());
    await flush();
    act(() => audio.spoken[0]!.resolve());
    await flush();
    act(() => audio.spoken[1]!.resolve());
    await flush();
    expect(audio.spoken).toHaveLength(3); // L2 is speaking
    act(() => buttonByText(S.pause).click());
    await flush();
    const rows = played(cap);
    expect(rows).toHaveLength(1);
    const twoLines = speechSeconds(lineMorae(PIECE.lines[0]!), 1) + speechSeconds(lineMorae(PIECE.lines[1]!), 1);
    expect(rows[0]).toMatchObject({ refs: [PIECE.id], rate: 1, cold: true, gistCorrect: null, seconds: Math.round(twoLines * 10) / 10 });
    expect(root.querySelector('.radio__note')?.textContent).toBe(S.pauseNoteLines);
    expect(store.progress.value.listened ?? []).toEqual([]);
    act(() => buttonByText(S.resume).click());
    await flush();
    expect(audio.spoken).toHaveLength(4);
    expect(audio.spoken[3]!.o).toMatchObject({ clip: `${PIECE.id}#L2`, interrupt: true, rate: 1 });
    // a speed change mid-line restarts that line at the new rate (nothing new to log: the line had not finished)
    key(']');
    await flush();
    expect(played(cap)).toHaveLength(1);
    expect(audio.spoken).toHaveLength(5);
    expect(audio.spoken[4]!.o).toMatchObject({ clip: `${PIECE.id}#L2`, interrupt: true, rate: SPEED_TIER_RATES[4] });
    act(() => audio.spoken[4]!.resolve());
    await flush();
    key('ArrowRight');
    await flush();
    expect(played(cap)).toHaveLength(2);
    expect(played(cap)[1]).toMatchObject({ refs: [PIECE.id], rate: SPEED_TIER_RATES[4], seconds: Math.round(speechSeconds(lineMorae(PIECE.lines[2]!), SPEED_TIER_RATES[4]) * 10) / 10 });
    cap.stop();
  });

  it('“?” writes Hard (2) on the sentence’s listen cards due within 3 days and flashes the transcript', async () => {
    const today = store.today();
    await makeTestStore({
      save: { settings: { furigana: 'off', speedTier: 3, sound: 1, audioSource: 'pack' }, progress: { station: 4 } },
      cards: {
        [cardKey(V.飲む, 'rec')]: card({ due: today + 10, s: 20, state: 2, reps: 4, last: today - 2 }),
        [cardKey(V.飲む, 'listen')]: card({ due: today + 1, s: 4, state: 2, reps: 2, last: today - 3 }),
        [cardKey(V.コーヒー, 'rec')]: card({ due: today + 10, s: 20, state: 2, reps: 4, last: today - 2 }),
        [cardKey(V.コーヒー, 'listen')]: card({ due: today + 30, s: 90, state: 2, reps: 6, last: today - 1 }), // not due within 3 days
      },
    });
    const audio = fakeAudio({ deferred: true });
    installServices({ audio });
    mount(inputsOf([], { pools: [REF] }), { clips: null });
    expect(root.querySelector('.radio__track-title')?.textContent).toContain('I drink coffee every morning.');
    act(() => buttonByText(S.play).click());
    await flush();
    expect(audio.spoken[0]!.o).toMatchObject({ clip: REF.ref, kana: REF.kana, rate: 1 });
    expect(audio.spoken[0]!.text).toBe('毎朝コーヒーを飲みます。');
    expect(root.querySelector('.radio__transcript')).toBeNull();
    const before = store.cards.get(cardKey(V.飲む, 'listen'))!;
    const untouched = store.cards.get(cardKey(V.コーヒー, 'listen'))!;
    key('?');
    await flush();
    const after = store.cards.get(cardKey(V.飲む, 'listen'))!;
    expect(after[3]).toBe(before[3] + 1);
    expect(store.cards.get(cardKey(V.コーヒー, 'listen'))).toEqual(untouched);
    const log = store.log.recent(5).filter(([, k]) => k === cardKey(V.飲む, 'listen'));
    expect(log).toHaveLength(1);
    expect(log[0]![2]).toBe(2);
    expect(root.querySelector('.radio__note')?.textContent).toBe(fill(S.didntCatchNote, { n: 1 }));
    expect(root.querySelector('.radio__transcript')).not.toBeNull();
    expect(root.querySelector('.radio__transcript')?.getAttribute('data-flash')).toBe('true');
    expect(root.querySelector('.radio__line-ja')?.textContent).toContain('コーヒー');
  });

  it('G glosses the weakest word of a sentence with its kana and English; T toggles the transcript', async () => {
    const today = store.today();
    await makeTestStore({
      save: { settings: { furigana: 'off', speedTier: 3, sound: 1, audioSource: 'pack' }, progress: { station: 4 } },
      cards: {
        // both words known (rec R ≥ 0.85) so the sentence is i+0; only 飲む has a listen card, and a weak one
        [cardKey(V.飲む, 'rec')]: card({ due: today + 10, s: 20, state: 2, reps: 4, last: today - 2 }),
        [cardKey(V.コーヒー, 'rec')]: card({ due: today + 10, s: 20, state: 2, reps: 4, last: today - 2 }),
        [cardKey(V.飲む, 'listen')]: card({ due: today - 2, s: 2, state: 2, reps: 2, last: today - 9 }),
      },
    });
    mount(inputsOf([], { pools: [REF] }), { clips: null });
    expect(root.querySelector('.radio__track-title')?.textContent).toContain('I drink coffee every morning.');
    key('g');
    expect(root.querySelector('.radio__note')?.textContent).toBe(fill(S.glossLine, { word: '飲む', kana: 'のむ', en: 'to drink' }));
    key('t');
    expect(root.querySelector('.radio__transcript')).not.toBeNull();
    expect(root.querySelector('.radio__transcript')?.getAttribute('data-flash')).toBeNull();
    key('T');
    expect(root.querySelector('.radio__transcript')).toBeNull();
  });

  it('volume 0 is text only: nothing plays, the transcript shows, the chip says so', () => {
    store.patch('settings', (s) => ({ ...s, sound: 0 }));
    mount(inputsOf([PIECE]), { clips: fakeClips({ texts: [PIECE] }) });
    expect(chip()).toBe(S.chipTextOnly);
    expect(root.querySelector('.radio__notice')?.textContent).toBe(S.noticeVolumeOff);
    expect((root.querySelector('.radio__play') as HTMLButtonElement).disabled).toBe(true);
    expect(root.querySelector('.radio__transcript')).not.toBeNull();
    expect(root.querySelectorAll('.radio__line')).toHaveLength(PIECE.lines.length);
  });
});

/* ── teach card, notices, empty ──────────────────────────────────────────── */

describe('<Radio> teach card and notices', () => {
  it('shows the “radio-first” TeachOnce card once and writes progress.teachSeen on dismiss', async () => {
    mount(inputsOf([PIECE]), { clips: null });
    const card = root.querySelector(`[data-teach-id="${RADIO_TEACH_ID}"]`);
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain(S.teachTitle);
    act(() => (card!.querySelector('.teach-once__dismiss') as HTMLButtonElement).click());
    // design 09 §6.3: the card leaves (kasure) before onDismiss fires — on animationend, or TeachOnce's EXIT_FALLBACK_MS fallback where jsdom sends none
    await act(async () => {
      await new Promise((r) => setTimeout(r, EXIT_FALLBACK_MS + 60));
    });
    expect(store.progress.value.teachSeen).toContain(RADIO_TEACH_ID);
    expect(root.querySelector(`[data-teach-id="${RADIO_TEACH_ID}"]`)).toBeNull();
  });

  it('says “nothing new” when every piece is heard, and “nothing to play” when the playlist is empty', async () => {
    await makeTestStore({ save: { settings: { furigana: 'off', speedTier: 3, sound: 1, audioSource: 'pack' }, progress: { station: 4, listened: [PIECE.id] } } });
    mount(inputsOf([PIECE]), { clips: null });
    expect(root.querySelector('.radio__playlist-notice')?.textContent).toBe(fill(S.noticeNothingNew, { n: 4 }));
    expect(root.querySelector('.radio__again')).not.toBeNull();
    render(null, root);
    mount(inputsOf([]), { clips: null });
    expect(root.querySelector('.radio__playlist-notice')?.textContent).toBe(S.noticeEmpty);
    expect((root.querySelector('.radio__play') as HTMLButtonElement).disabled).toBe(true);
  });

  it('loads its inputs from the loader when none are given', async () => {
    act(() => render(<Radio loader={loader} clips={null} nav={null} />, root));
    expect(root.querySelector('.radio__state')?.textContent).toBe(S.loading);
    await flush();
    expect(root.querySelector('.radio__state')).toBeNull();
    // the fixture's Station 4 dialogue is the one Radio text (the diary story is reading material)
    expect(root.querySelector('.radio__track-title')?.textContent).toContain(DIALOGUE.titleEn);
  });
});

/* ── design 09 (C4): the --ai-dye band on the player ─────────────────────────── */
describe('design 09 (C4): the indigo band on <Radio>', () => {
  it('one static band tops the header; its title names the source (synthetic with the pack, device without) and it is aria-hidden — the chip is the one accessible source', () => {
    mount(inputsOf([PIECE]), { clips: fakeClips({ texts: [PIECE] }), nav: fakeNav() });
    let bands = root.querySelectorAll('.radio__head > .radio__band');
    expect(bands).toHaveLength(1);
    expect(bands[0]!.getAttribute('title')).toBe(S.chipSynthetic);
    // the band explains itself once: a pointer tooltip; screen readers hear the source from the chip, not twice
    expect(bands[0]!.getAttribute('aria-hidden')).toBe('true');
    expect(bands[0]!.hasAttribute('aria-label')).toBe(false);
    expect(bands[0]!.hasAttribute('role')).toBe(false);
    expect(chip()).toBe(S.chipSynthetic);
    render(null, root);
    mount(inputsOf([PIECE]), { clips: null });
    bands = root.querySelectorAll('.radio__head > .radio__band');
    expect(bands).toHaveLength(1);
    expect(bands[0]!.getAttribute('title')).toBe(S.chipDevice);
  });

  it('the track, gist and done panels are .sheet paper, never the cartouche; no .status-window remains under src/input (design 09 §2.5, §12.1 d53)', () => {
    mount(inputsOf([PIECE]), { clips: fakeClips({ texts: [PIECE] }), nav: fakeNav() });
    const track = root.querySelector('.radio__track')!;
    expect(track.classList.contains('sheet')).toBe(true);
    expect(track.classList.contains('status-window')).toBe(false);
    // (the TeachOnce card is contract-tier chrome, not one of the ten; the panels themselves carry no cartouche)
    expect(root.querySelector('.radio__track.status-window, .radio__gist.status-window, .radio__done.status-window')).toBeNull();
    // the cartouche is reserved for character-sheet surfaces: every .tsx under src/input is clean
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (p.endsWith('.tsx') && !p.endsWith('.test.tsx')) out.push(p);
      }
      return out;
    };
    const offenders = walk(resolve(process.cwd(), 'src/input')).filter((p) => /status-window/.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
    for (const cls of ['radio__track', 'radio__gist', 'radio__done']) {
      expect(readFileSync(resolve(process.cwd(), 'src/input/listening/Radio.tsx'), 'utf8')).toContain(`class="${cls} sheet"`);
    }
  });

  it('Radio.css: the band is --ai-dye and static; the file tweens nothing and keeps no reduced-motion block', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/input/listening/Radio.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const band = /\.radio__band\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(band).toMatch(/background:\s*var\(--ai-dye\)/);
    expect(band).not.toMatch(/transition|animation/);
    expect(css).not.toMatch(/transition|@keyframes|prefers-reduced-motion|\.reduced-motion/);
    expect(/\.radio__title-ja\s*\{[^}]*line-height:\s*1\.1/.test(css)).toBe(true);
    // the sheets carry their own paper, padding and shading: no local padding on the three panels, the playing ring is an outline (the box-shadow is the sheet's)
    for (const cls of ['radio__track', 'radio__gist', 'radio__done']) expect(new RegExp(`\\.${cls}\\s*\\{[^}]*\\b(padding|background|border|box-shadow)\\s*:`).test(css), cls).toBe(false);
    expect(css).not.toMatch(/status-window/);
    expect(/\.radio\[data-status='playing'\] \.radio__track\s*\{[^}]*outline:/.test(css)).toBe(true);
  });
});
