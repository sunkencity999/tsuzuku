import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { installServices, nullAudio, resetServices, type SpeakOptions } from '@/shared/audio';
import { makeTestStore } from '@/store/testing';
import { Recorder, detectMedia, stateForMediaError, type MediaApis } from './Recorder';
import { S } from '../strings';

let root: HTMLDivElement;
let spoken: { text: string; o?: SpeakOptions }[];

beforeEach(async () => {
  await makeTestStore();
  spoken = [];
  installServices({
    audio: {
      ...nullAudio,
      speak: (text, o) => {
        spoken.push({ text, o });
        return Promise.resolve();
      },
    },
  });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

const q = <T extends Element = HTMLElement>(sel: string): T | null => root.querySelector<T>(sel);
const click = (sel: string): void => {
  const el = q<HTMLButtonElement>(sel);
  expect(el, sel).not.toBeNull();
  act(() => el!.click());
};
const tick = (sel: string): void => {
  const el = q<HTMLInputElement>(sel);
  expect(el, sel).not.toBeNull();
  act(() => {
    el!.click();
  });
};

describe('Recorder helpers', () => {
  it('detectMedia is null without mediaDevices or MediaRecorder', () => {
    expect(detectMedia(undefined, {} as typeof globalThis)).toBeNull();
    expect(detectMedia({ mediaDevices: { getUserMedia: () => Promise.reject(new Error('x')) } } as unknown as Navigator, {} as typeof globalThis)).toBeNull();
    const nav = { mediaDevices: { getUserMedia: () => Promise.reject(new Error('x')) } } as unknown as Navigator;
    const g = { MediaRecorder: class {} } as unknown as typeof globalThis;
    expect(detectMedia(nav, g)).not.toBeNull();
  });

  it('stateForMediaError maps permission and device errors', () => {
    expect(stateForMediaError(new DOMException('no', 'NotAllowedError'))).toBe('denied');
    expect(stateForMediaError(new DOMException('no', 'NotFoundError'))).toBe('no-mic');
    expect(stateForMediaError(new Error('boom'))).toBe('error');
    expect(stateForMediaError(null)).toBe('error');
  });
});

describe('<Recorder> without media devices', () => {
  it('renders the checklist only, with the timer-only note, and no record button', () => {
    const onSelfGrade = vi.fn();
    act(() => render(<Recorder modelKana="おはようございます" onSelfGrade={onSelfGrade} media={null} />, root));
    expect(q('.recorder')?.getAttribute('data-state')).toBe('unsupported');
    expect(q('.recorder__rec')).toBeNull();
    expect(q('.recorder__note')?.textContent).toContain(S.recorderUnsupported);
    expect(q('.recorder__note')?.textContent).toContain('8 seconds');
    expect(root.querySelectorAll('.recorder__check input').length).toBe(3);
    // hints: 9 morae, the one long vowel (よう) listed
    expect(q('[data-check="mora"]')?.parentElement?.textContent).toContain('9');
    expect(q('[data-check="longVowels"]')?.parentElement?.textContent).toContain('よう');
    expect(q('[data-check="pitch"]')?.parentElement?.textContent).toContain(S.checkPitchNone);
    expect(onSelfGrade).not.toHaveBeenCalled();
  });

  it('onSelfGrade is called once with the ticked checks; the button then locks', () => {
    const onSelfGrade = vi.fn();
    act(() => render(<Recorder modelKana="のむ" pitch={1} onSelfGrade={onSelfGrade} media={null} />, root));
    expect(q('[data-check="pitch"]')?.parentElement?.textContent).toContain(S.pitchShape.atamadaka);
    tick('[data-check="mora"]');
    tick('[data-check="pitch"]');
    click('[data-action="grade"]');
    expect(onSelfGrade).toHaveBeenCalledTimes(1);
    expect(onSelfGrade).toHaveBeenCalledWith({ mora: true, longVowels: false, pitch: true });
    expect(q<HTMLButtonElement>('[data-action="grade"]')?.disabled).toBe(true);
    expect(q<HTMLFieldSetElement>('.recorder__checklist')?.disabled).toBe(true);
    expect(q('.recorder__checklist legend')?.classList.contains('eyebrow')).toBe(true);
    click('[data-action="grade"]');
    expect(onSelfGrade).toHaveBeenCalledTimes(1);
    expect(q('.recorder__actions .recorder__note')?.textContent).toBe(S.gradedLine);
  });

  it('plays the model through speak() with the plain surface and the kana', async () => {
    act(() => render(<Recorder modelKana="のむ" modelJa="{飲|の}む" onSelfGrade={() => undefined} media={null} />, root));
    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === S.playModel);
    expect(btn).toBeDefined();
    await act(async () => {
      btn!.click();
      await Promise.resolve();
    });
    expect(spoken).toEqual([{ text: '飲む', o: { kana: 'のむ' } }]);
  });

  it('a custom onPlayModel replaces speak()', async () => {
    const onPlayModel = vi.fn(() => Promise.resolve());
    act(() => render(<Recorder modelKana="のむ" onSelfGrade={() => undefined} media={null} onPlayModel={onPlayModel} />, root));
    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === S.playModel);
    await act(async () => {
      btn!.click();
      await Promise.resolve();
    });
    expect(onPlayModel).toHaveBeenCalledTimes(1);
    expect(spoken).toEqual([]);
  });
});

/* A tiny MediaRecorder double: start/stop drive onstop with one chunk. */
class FakeRecorder {
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((ev: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  static instances: FakeRecorder[] = [];
  constructor(public stream: MediaStream) {
    FakeRecorder.instances.push(this);
  }
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) } as BlobEvent);
    this.onstop?.();
  }
}

function fakeMedia(o: { reject?: unknown } = {}): MediaApis & { tracks: { stop: ReturnType<typeof vi.fn> }[] } {
  const tracks = [{ stop: vi.fn() }];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  return {
    tracks,
    getUserMedia: () => (o.reject !== undefined ? Promise.reject(o.reject) : Promise.resolve(stream)),
    Recorder: FakeRecorder as unknown as typeof MediaRecorder,
  };
}

describe('<Recorder> with media devices', () => {
  const urls: string[] = [];
  beforeEach(() => {
    FakeRecorder.instances = [];
    urls.length = 0;
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => {
      const u = `blob:take-${urls.length}-${b.size}`;
      urls.push(u);
      return u;
    };
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
  });

  it('revokes the take URL on unmount (and the previous one when a new take replaces it)', async () => {
    vi.useFakeTimers();
    const revoked: string[] = [];
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u) => {
      revoked.push(u);
    };
    const media = fakeMedia();
    act(() => render(<Recorder modelKana="おはよう" onSelfGrade={() => undefined} media={media} maxMs={1000} />, root));
    const take = async (): Promise<void> => {
      await act(async () => {
        q<HTMLButtonElement>('.recorder__rec')!.click();
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
      });
    };
    await take();
    expect(urls).toEqual(['blob:take-0-1']);
    expect(revoked).toEqual([]);
    await take();
    expect(urls.length).toBe(2);
    expect(revoked).toEqual(['blob:take-0-1']);
    act(() => render(null, root));
    expect(revoked).toEqual(['blob:take-0-1', 'blob:take-1-1']);
    vi.useRealTimers();
  });

  it('records, stops (releasing the stream) and offers "Play yours"', async () => {
    vi.useFakeTimers();
    const media = fakeMedia();
    act(() => render(<Recorder modelKana="おはよう" onSelfGrade={() => undefined} media={media} maxMs={5000} />, root));
    expect(q('.recorder')?.getAttribute('data-state')).toBe('idle');
    expect(q('.recorder__rec')?.textContent).toBe(S.record);
    await act(async () => {
      q<HTMLButtonElement>('.recorder__rec')!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(q('.recorder')?.getAttribute('data-state')).toBe('recording');
    expect(q('.recorder__meter')?.getAttribute('data-live')).toBe('true');
    expect(q('.recorder__rec')?.getAttribute('aria-pressed')).toBe('true');
    expect(FakeRecorder.instances.length).toBe(1);
    // the cap stops it
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(q('.recorder')?.getAttribute('data-state')).toBe('recorded');
    expect(media.tracks[0]!.stop).toHaveBeenCalled();
    expect(q('.recorder__meter')?.getAttribute('data-live')).toBeNull();
    expect(urls.length).toBe(1);
    const yours = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === S.playYours);
    expect(yours).toBeDefined();
    expect(q('.recorder__rec')?.textContent).toBe(S.recordAgain);
    vi.useRealTimers();
  });

  it('a denied microphone degrades to the checklist with the denied note', async () => {
    const media = fakeMedia({ reject: new DOMException('no', 'NotAllowedError') });
    act(() => render(<Recorder modelKana="おはよう" onSelfGrade={() => undefined} media={media} />, root));
    await act(async () => {
      q<HTMLButtonElement>('.recorder__rec')!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(q('.recorder')?.getAttribute('data-state')).toBe('denied');
    expect(q('.recorder__note')?.textContent).toContain(S.recorderDenied);
    expect(q('.recorder__rec')).toBeNull();
    expect(root.querySelectorAll('.recorder__check input').length).toBe(3);
  });
});

describe('<Recorder> model clip (design 08 §8)', () => {
  it('the default model playback passes the clip key and speaker when the host gives them', async () => {
    act(() => render(<Recorder modelKana="のむ" modelJa="{飲|の}む" clip="v-n5-0007" speaker="ケン" onSelfGrade={() => undefined} media={null} />, root));
    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === S.playModel);
    await act(async () => {
      btn!.click();
      await Promise.resolve();
    });
    expect(spoken).toEqual([{ text: '飲む', o: { kana: 'のむ', clip: 'v-n5-0007', speaker: 'ケン' } }]);
  });
});

/* ── design 09 (C4): speaking.css tweens no width or height; the level meter rides scaleY ── */
describe('speaking.css (design 09 §6.6, §6.7)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/input/speaking/speaking.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('no transition or keyframe touches width or height; recorder-level animates transform (scaleY) from the bars\' foot', () => {
    expect(css).not.toMatch(/transition:[^;]*\b(width|height)\b/);
    const level = /@keyframes recorder-level\s*\{([\s\S]*?)\}\s*\}/.exec(css)?.[1] ?? '';
    expect(level).toMatch(/transform:\s*scaleY\(/);
    expect(level).not.toMatch(/\bheight\s*:/);
    expect(/\.recorder__bar\s*\{[^}]*transform-origin:\s*bottom/.test(css)).toBe(true);
    expect(css).not.toMatch(/\.monologue__(track|fill)|\.speak__label/);
  });

  it('every duration is a token; the live loop is ≥ 1,400 ms (§6.8); no local reduced-motion block (§6.6)', () => {
    expect(css).not.toMatch(/\b\d+(\.\d+)?m?s\b/);
    expect(css).toMatch(/recorder-level calc\(var\(--dur-4\) \* 5 \/ 3\)/);
    // base.css's reduced rule runs the loop once at 0.01 ms; `both` holds the `to` frame, so live bars stay lit (scaleY(1)), static
    expect(css).toMatch(/recorder-level calc\(var\(--dur-4\) \* 5 \/ 3\) var\(--ease\) infinite alternate both;/);
    expect(css).toMatch(/recorder-blink calc\(var\(--dur-4\) \* 5 \/ 3\)/);
    expect(css).not.toMatch(/prefers-reduced-motion|\.reduced-motion/);
  });
});
