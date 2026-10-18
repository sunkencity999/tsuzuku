import { render, type JSX } from 'preact';
import { act } from 'preact/test-utils';
import { STATIONS } from '../../content/types';
import { installServices, nullAudio, resetServices } from '../../shared/audio';
import { formatEraDate } from '../../shared/time';
import { makeTestStore } from '../../store/testing';
import { PRESS_AT, PRESS_DONE_MS, StampPress, fallbackStampSvg, stationDef } from './StampPress';
import { S } from './strings';
import { EXIT_FALLBACK_MS, eraGloss, setLazyArtForTests, type GoshuinStampProps } from './support';

let root: HTMLDivElement;
let sfx: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  await makeTestStore();
  root = document.createElement('div');
  document.body.appendChild(root);
  sfx = vi.fn();
  installServices({ audio: { ...nullAudio, sfx } });
  setLazyArtForTests({ GoshuinStamp: null });
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
  setLazyArtForTests(null);
  vi.useRealTimers();
});

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};
/** A fresh ceremony each time (the host keys its ceremonies, so a second one is a new instance with its own exit). */
const mount = (p: Partial<Parameters<typeof StampPress>[0]> = {}): void => {
  act(() => render(null, root));
  act(() => render(<StampPress station={7} perfect={false} assisted={false} onDone={() => {}} reduced {...p} />, root));
};

describe('<StampPress>', () => {
  it('renders the station name (lang="ja") with its romaji below Green kana and the Sensei line, on a .sheet', async () => {
    mount();
    await settle();
    const line = root.querySelector('.stamp-press__line')!;
    expect(line.textContent).toContain('Station 7');
    expect(line.querySelector('[lang="ja"]')?.textContent).toBe('平塚');
    expect(line.textContent).toContain('Hiratsuka');
    expect(line.querySelector('ruby')).toBeNull();
    expect(line.textContent).toContain(S.stampBehind);
    expect(root.querySelector('.stamp-press')?.classList.contains('sheet')).toBe(true);
    expect(root.querySelector('.stamp-press__page')?.classList.contains('sheet')).toBe(true);
    expect(root.querySelector('.stamp-press__stamp')?.getAttribute('data-stamp')).toBe('fallback');
    expect(root.querySelector('.stamp-press__stamp svg')).not.toBeNull();
  });

  it('from Green kana the station name reads as a kana <ruby> and the romaji is gone (design 09 §3.3, d49)', async () => {
    await makeTestStore({ save: { profile: { belt: 'green' }, settings: { furigana: 'tap' } } });
    mount();
    await settle();
    const line = root.querySelector('.stamp-press__line')!;
    expect(line.textContent).not.toContain('Hiratsuka');
    const ruby = line.querySelector('ruby');
    expect(ruby).not.toBeNull();
    expect(ruby?.textContent).toContain('平塚');
    expect(ruby?.textContent).toContain('ひらつか');
    // signage never renders a tap-to-reveal ruby: `tap` reads as `always`
    expect(line.querySelector('.ruby__rt--fog')).toBeNull();
  });

  it('the era date lands at `set` exactly as formatEraDate prints it, with the Latin gloss beneath (§7 E)', async () => {
    await makeTestStore({ save: { collections: { stamps: { 7: { at: 20_000, perfect: false, assisted: false } } } } });
    vi.useFakeTimers();
    mount({ reduced: false });
    expect(root.querySelector('.stamp-press__date')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(PRESS_AT[2]!);
    });
    const date = root.querySelector('.stamp-press__date')!;
    expect(date.classList.contains('seal-date')).toBe(true);
    expect(date.querySelector('.ceremony__era')?.textContent).toBe(formatEraDate(20_000));
    expect(date.querySelector('.seal-date__label')?.textContent).toBe(eraGloss(20_000));
    expect(eraGloss(20_000)).toMatch(/^Reiwa \d+ · [A-Z][a-z]{2} \d+$/);
    expect(date.querySelector('.ceremony__era-num')).not.toBeNull();
  });

  it('variants: perfect adds the gold frame and note; assisted adds the grey corner and note', () => {
    mount({ perfect: true });
    let section = root.querySelector('.stamp-press')!;
    expect(section.getAttribute('data-perfect')).toBe('true');
    expect(root.querySelector('.stamp-press__note--gold')?.textContent).toBe(S.stampPerfect);
    expect(section.innerHTML).toContain('#B8860B');
    expect(root.querySelector('.stamp-press svg polygon')).toBeNull();

    mount({ assisted: true });
    section = root.querySelector('.stamp-press')!;
    expect(section.getAttribute('data-assisted')).toBe('true');
    expect(root.querySelector('.stamp-press__note')?.textContent).toBe(S.stampAssisted);
    expect(root.querySelector('.stamp-press svg polygon')).not.toBeNull();
    expect(section.innerHTML).not.toContain('#B8860B');

    mount();
    expect(root.querySelector('.stamp-press__note')).toBeNull();
  });

  it('plays the stamp sfx at the press, not before', () => {
    vi.useFakeTimers();
    mount({ reduced: false });
    expect(sfx).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(PRESS_AT[1]!);
    });
    expect(sfx).toHaveBeenCalledWith('stamp');
    expect(sfx).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(PRESS_AT[2]! - PRESS_AT[1]!);
    });
    expect(root.querySelector('.stamp-press')?.classList.contains('stamp-press--set')).toBe(true);
    expect(sfx).toHaveBeenCalledTimes(1);
  });

  it('completes on its own after the animation, or on skip — each through the kasure exit (data-leaving, then onDone)', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    mount({ onDone, reduced: false });
    act(() => {
      vi.advanceTimersByTime(PRESS_DONE_MS - 1);
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(root.querySelector('.stamp-press')?.hasAttribute('data-leaving')).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(root.querySelector('.stamp-press')?.hasAttribute('data-leaving')).toBe(true);
    expect(onDone).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(EXIT_FALLBACK_MS);
    });
    expect(onDone).toHaveBeenCalledTimes(1);

    const onSkip = vi.fn();
    mount({ onDone: onSkip, reduced: false });
    act(() => {
      (root.querySelector('.stamp-press__continue') as HTMLButtonElement).click();
    });
    expect(onSkip).not.toHaveBeenCalled();
    act(() => {
      root.querySelector('.stamp-press')!.dispatchEvent(new Event('animationend'));
    });
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('reduced motion shows the pressed stamp at once with no ink verb (and still completes, at once)', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    mount({ onDone });
    const section = root.querySelector('.stamp-press')!;
    expect(section.getAttribute('data-phase')).toBe('2');
    expect(section.classList.contains('stamp-press--set')).toBe(true);
    expect(root.querySelector('[class*="ink-"]')).toBeNull();
    expect(root.querySelector('.stamp-press__date')).not.toBeNull();
    expect(sfx).toHaveBeenCalledWith('stamp');
    act(() => {
      vi.advanceTimersByTime(PRESS_DONE_MS);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(section.hasAttribute('data-leaving')).toBe(false);
  });

  it('uses the real <GoshuinStamp> when it is available, with the recorded clear day', async () => {
    await makeTestStore({ save: { collections: { stamps: { 7: { at: 20_000, perfect: true, assisted: false } } } } });
    const seen: GoshuinStampProps[] = [];
    const Fake = (p: GoshuinStampProps): JSX.Element => {
      seen.push(p);
      return <div class="fake-goshuin" />;
    };
    setLazyArtForTests({ GoshuinStamp: Fake });
    mount({ perfect: true });
    await settle();
    expect(root.querySelector('.stamp-press__stamp')?.getAttribute('data-stamp')).toBe('goshuin');
    expect(root.querySelector('.fake-goshuin')).not.toBeNull();
    expect(seen[0]).toMatchObject({ station: 7, at: 20_000, perfect: true, assisted: false, size: 240 });
  });

  it('the fallback stamp carries the clear date in era format', async () => {
    await makeTestStore({ save: { collections: { stamps: { 7: { at: 20_000, perfect: false, assisted: false } } } } });
    mount();
    expect(root.querySelector('.stamp-press')?.innerHTML).toContain(formatEraDate(20_000));
  });

  it('survives an unknown station number', () => {
    mount({ station: 99 });
    expect(root.querySelector('.stamp-press__line')?.textContent).toContain('Station 99');
    expect(root.querySelector('.stamp-press svg')).not.toBeNull();
    expect(stationDef(0)).toBeNull();
    expect(stationDef(53)?.nameRomaji).toBe('Ōtsu');
  });
});

describe('fallbackStampSvg', () => {
  const base = { station: STATIONS[6]!, number: 7, at: 20_468, perfect: false, assisted: false, seed: 11, size: 240 };

  it('is deterministic for a seed and varies the frame by seed', () => {
    const a = fallbackStampSvg(base);
    expect(a).toBe(fallbackStampSvg(base));
    expect(a.startsWith('<svg')).toBe(true);
    expect(a).toContain('平');
    expect(a).toContain(formatEraDate(20_468));
    const variants = new Set(Array.from({ length: 12 }, (_, i) => fallbackStampSvg({ ...base, seed: i }).length));
    expect(variants.size).toBeGreaterThan(1);
  });

  it('long station names split into up to three columns', () => {
    const svg = fallbackStampSvg({ ...base, station: STATIONS[3]! }); // 保土ヶ谷
    const columns = (svg.match(/<g lang="ja">/g) ?? []).length;
    expect(columns).toBeGreaterThanOrEqual(1);
    expect(svg).toContain('保');
    expect(svg).toContain('谷');
  });
});
