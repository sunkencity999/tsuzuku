import { signal } from '@preact/signals';
import type { JSX } from 'preact';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { installServices, nullAudio, resetServices, services, servicesVersion, type ClipPlayer, type ClipReady } from '@/shared/audio';
import { useAudioService, useClipPlayer } from './hooks';

let root: HTMLDivElement;
let renders = 0;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  renders = 0;
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

/** Only what the hook reads of a player. */
function clipsWith(ready: ClipReady): ClipPlayer {
  return { ready: signal(ready), info: signal(null) } as unknown as ClipPlayer;
}

function Probe(): JSX.Element {
  const { clips, settled } = useClipPlayer();
  renders++;
  return <span data-probe data-settled={String(settled)} data-clips={clips ? clips.ready.value : 'none'} />;
}

const probe = (): HTMLElement => root.querySelector<HTMLElement>('[data-probe]')!;
const mount = (): void => {
  act(() => render(<Probe />, root));
};

describe('useClipPlayer (design 08 §8: the slot’s version signal, no poll)', () => {
  it('a cold slot (nothing installed yet) is unsettled; installServices bumps servicesVersion and the component re-renders with the new player — no interval, no timeout', () => {
    const intervals = vi.spyOn(globalThis, 'setInterval');
    const timeouts = vi.spyOn(globalThis, 'setTimeout');
    servicesVersion.value = 0; // before main.tsx has installed the audio barrel
    mount();
    expect(services.audio).toBe(nullAudio);
    expect(probe().dataset.settled).toBe('false');
    expect(probe().dataset.clips).toBe('none');
    expect(renders).toBe(1);

    const player = clipsWith('ready');
    act(() => {
      installServices({ audio: { ...nullAudio, clips: player } });
    });
    expect(servicesVersion.value).toBe(1);
    expect(renders).toBe(2);
    expect(probe().dataset.settled).toBe('true');
    expect(probe().dataset.clips).toBe('ready');

    // The player's own signals are read live too.
    act(() => {
      player.ready.value = 'absent';
    });
    expect(probe().dataset.clips).toBe('absent');

    expect(intervals).not.toHaveBeenCalled();
    expect(timeouts).not.toHaveBeenCalled();
    intervals.mockRestore();
    timeouts.mockRestore();
  });

  it('a real service without a player is settled at once (a build with no pack), and so is an empty slot after any install or reset', () => {
    servicesVersion.value = 0;
    installServices({ audio: { ...nullAudio, setVolume: vi.fn() } });
    mount();
    expect(probe().dataset.settled).toBe('true');
    expect(probe().dataset.clips).toBe('none');

    render(null, root);
    resetServices(); // back to nullAudio, but the version moved: the question is settled
    expect(servicesVersion.value).toBeGreaterThan(0);
    mount();
    expect(services.audio).toBe(nullAudio);
    expect(probe().dataset.settled).toBe('true');
    expect(probe().dataset.clips).toBe('none');
  });

  it('a reset after a player drops it from a mounted component', () => {
    installServices({ audio: { ...nullAudio, clips: clipsWith('ready') } });
    mount();
    expect(probe().dataset.clips).toBe('ready');
    act(() => {
      resetServices();
    });
    expect(probe().dataset.clips).toBe('none');
    expect(probe().dataset.settled).toBe('true');
  });

  it('a failed audio boot settles to "no pack": installServices({}) bumps the version without touching the slots (what main.tsx must call when the barrel fails to load or createWebAudio throws)', () => {
    servicesVersion.value = 0;
    mount();
    expect(probe().dataset.settled).toBe('false');
    act(() => {
      installServices({});
    });
    expect(services.audio).toBe(nullAudio);
    expect(servicesVersion.value).toBe(1);
    expect(probe().dataset.settled).toBe('true');
    expect(probe().dataset.clips).toBe('none');
  });
});

describe('useAudioService (render-time reads of services.audio re-render when the real audio lands)', () => {
  function VoiceProbe(): JSX.Element {
    const audio = useAudioService();
    renders++;
    return <span data-probe data-ja={String(audio.hasJaVoice.value)} />;
  }

  it('returns the live slot and re-renders on install and reset — no interval, no timeout', () => {
    const intervals = vi.spyOn(globalThis, 'setInterval');
    const timeouts = vi.spyOn(globalThis, 'setTimeout');
    servicesVersion.value = 0;
    act(() => render(<VoiceProbe />, root));
    expect(probe().dataset.ja).toBe('false');
    expect(renders).toBe(1);
    act(() => {
      installServices({ audio: { ...nullAudio, hasJaVoice: signal(true) } });
    });
    expect(renders).toBe(2);
    expect(probe().dataset.ja).toBe('true');
    act(() => {
      resetServices();
    });
    expect(probe().dataset.ja).toBe('false');
    expect(intervals).not.toHaveBeenCalled();
    expect(timeouts).not.toHaveBeenCalled();
    intervals.mockRestore();
    timeouts.mockRestore();
  });
});
