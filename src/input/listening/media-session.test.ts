import { MEDIA_ACTIONS, artistLine, characterOf, mediaSessionOf, setHandlers, setMetadata, setPlaybackState, type MediaSessionLike } from './media-session';

interface FakeSession extends MediaSessionLike {
  handlers: Map<string, (() => void) | null>;
  metadata: MediaMetadata | null;
  playbackState: 'none' | 'paused' | 'playing';
}

function fakeSession(o: { reject?: string[] } = {}): FakeSession {
  const handlers = new Map<string, (() => void) | null>();
  return {
    metadata: null,
    playbackState: 'none',
    handlers,
    setActionHandler(action, handler) {
      if (o.reject?.includes(action)) throw new TypeError(`unsupported action ${action}`);
      handlers.set(action, handler);
    },
  };
}

class FakeMetadata {
  title: string;
  artist: string;
  album: string;
  artwork: { src: string }[];
  constructor(init: MediaMetadataInit = {}) {
    this.title = init.title ?? '';
    this.artist = init.artist ?? '';
    this.album = init.album ?? '';
    this.artwork = (init.artwork ?? []).map((a) => ({ src: a.src }));
  }
}

const g = globalThis as { MediaMetadata?: unknown };
let savedCtor: unknown;
beforeEach(() => {
  savedCtor = g.MediaMetadata;
  g.MediaMetadata = FakeMetadata;
});
afterEach(() => {
  if (savedCtor === undefined) delete g.MediaMetadata;
  else g.MediaMetadata = savedCtor;
});

describe('media-session: feature detection', () => {
  it('jsdom has no navigator.mediaSession, so every call is a no-op that returns false', () => {
    expect(mediaSessionOf()).toBeNull();
    expect(setMetadata({ title: 'x', speaker: 'ハナ', voice: 'VOICEVOX:test', station: 4 })).toBe(false);
    expect(setPlaybackState('playing')).toBe(false);
    const h = setHandlers({ play() {}, pause() {}, previoustrack() {}, nexttrack() {}, seekbackward() {} });
    expect(h.wired).toBe(false);
    expect(() => h.clear()).not.toThrow();
  });

  it('a navigator without the API, or a session without setActionHandler, reads as absent', () => {
    expect(mediaSessionOf(null)).toBeNull();
    expect(mediaSessionOf({})).toBeNull();
    expect(mediaSessionOf({ mediaSession: { metadata: null } as unknown as MediaSessionLike })).toBeNull();
    const s = fakeSession();
    expect(mediaSessionOf({ mediaSession: s })).toBe(s);
  });

  it('without a MediaMetadata constructor setMetadata returns false and leaves the session alone', () => {
    delete g.MediaMetadata;
    const s = fakeSession();
    expect(setMetadata({ title: 'x', speaker: 'ハナ', voice: 'VOICEVOX:test', station: 4 }, { nav: { mediaSession: s } })).toBe(false);
    expect(s.metadata).toBeNull();
  });
});

describe('media-session: metadata', () => {
  it('artist is “{speaker} · synthetic · VOICEVOX:{character}”; the prefix is never doubled; no speaker → ハナ', () => {
    expect(artistLine('ハナ', 'VOICEVOX:九州そら')).toBe('ハナ · synthetic · VOICEVOX:九州そら');
    expect(artistLine('ハナ', '九州そら')).toBe('ハナ · synthetic · VOICEVOX:九州そら');
    expect(artistLine(null, 'voicevox: 九州そら')).toBe('ハナ · synthetic · VOICEVOX:九州そら');
    expect(artistLine('  ', '九州そら')).toBe('ハナ · synthetic · VOICEVOX:九州そら');
    expect(characterOf(' VOICEVOX:玄野武宏 ')).toBe('玄野武宏');
    expect(artistLine('ケン', 'VOICEVOX:玄野武宏')).not.toMatch(/recorded/i);
    // a cue without a character credit: no invented "VOICEVOX:VOICEVOX", the line stops at synthetic
    expect(artistLine('ハナ', '')).toBe('ハナ · synthetic');
    expect(artistLine('ケン', 'VOICEVOX:')).toBe('ケン · synthetic');
    expect(artistLine(null, '  ')).toBe('ハナ · synthetic');
  });

  it('sets title, artist, album (茶屋ラジオ · Station N) and optional artwork when a session is present', () => {
    const s = fakeSession();
    const ok = setMetadata({ title: 'コーヒーとパン', speaker: 'ハナ', voice: 'VOICEVOX:九州そら', station: 4, artwork: './art/st-04.png' }, { nav: { mediaSession: s } });
    expect(ok).toBe(true);
    const m = s.metadata as unknown as FakeMetadata;
    expect(m.title).toBe('コーヒーとパン');
    expect(m.artist).toBe('ハナ · synthetic · VOICEVOX:九州そら');
    expect(m.album).toBe('茶屋ラジオ Teahouse Radio · Station 4');
    expect(m.artwork).toEqual([{ src: './art/st-04.png' }]);
    expect(m.artist).not.toMatch(/recorded/i);
    // no station → an em dash, no artwork → none
    setMetadata({ title: 'あ', speaker: null, voice: '九州そら', station: null }, { nav: { mediaSession: s } });
    const m2 = s.metadata as unknown as FakeMetadata;
    expect(m2.album).toBe('茶屋ラジオ Teahouse Radio · Station —');
    expect(m2.artwork).toEqual([]);
  });

  it('mirrors the playback state', () => {
    const s = fakeSession();
    expect(setPlaybackState('playing', { nav: { mediaSession: s } })).toBe(true);
    expect(s.playbackState).toBe('playing');
    setPlaybackState('paused', { nav: { mediaSession: s } });
    expect(s.playbackState).toBe('paused');
  });
});

describe('media-session: handlers', () => {
  it('wires play / pause / previoustrack / nexttrack / seekbackward and clears them again', () => {
    const s = fakeSession();
    const calls: string[] = [];
    const h = setHandlers(
      {
        play: () => calls.push('play'),
        pause: () => calls.push('pause'),
        previoustrack: () => calls.push('prev'),
        nexttrack: () => calls.push('next'),
        seekbackward: () => calls.push('back'),
      },
      { nav: { mediaSession: s } },
    );
    expect(h.wired).toBe(true);
    expect([...s.handlers.keys()].sort()).toEqual([...MEDIA_ACTIONS].sort());
    for (const a of MEDIA_ACTIONS) s.handlers.get(a)!();
    expect(calls).toEqual(['play', 'pause', 'prev', 'next', 'back']);
    s.metadata = new FakeMetadata({ title: 'x' }) as unknown as MediaMetadata;
    h.clear();
    for (const a of MEDIA_ACTIONS) expect(s.handlers.get(a)).toBeNull();
    expect(s.metadata).toBeNull();
  });

  it('an action the browser rejects is skipped; the rest still wire', () => {
    const s = fakeSession({ reject: ['seekbackward'] });
    const h = setHandlers({ play() {}, pause() {}, previoustrack() {}, nexttrack() {}, seekbackward() {} }, { nav: { mediaSession: s } });
    expect(h.wired).toBe(true);
    expect(s.handlers.has('seekbackward')).toBe(false);
    expect(s.handlers.size).toBe(4);
    expect(() => h.clear()).not.toThrow();
  });
});
