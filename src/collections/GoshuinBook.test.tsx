import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { ExportOptions } from '../art/png';
import { STATIONS } from '../content/types';
import { civilToDay, formatEraDate } from '../shared/time';
import { resetStoreForTests } from '../store/store';
import { makeTestStore } from '../store/testing';
import { GoshuinBook, PAGE_TURN_CLASS, bookFilename, bookStamps, buildPages, initialSpread, spreadOfPage, spreadsOf } from './GoshuinBook';
import { eraGloss, markOpened, newSince, resetOpenedForTests } from './reveal';

const DAY = civilToDay({ year: 2026, month: 10, day: 17 });

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  resetOpenedForTests();
});

const STAMPS = {
  1: { at: DAY - 30, perfect: false, assisted: false },
  2: { at: DAY - 20, perfect: true, assisted: false },
  4: { at: DAY - 2, perfect: false, assisted: true },
};

interface Recorder {
  calls: ExportOptions[];
  saved: string[];
  exporter(o: ExportOptions): Promise<Blob | null>;
  saver(blob: Blob, filename: string): 'download';
}

function recorder(result: 'blob' | 'null' = 'blob'): Recorder {
  const r: Recorder = {
    calls: [],
    saved: [],
    async exporter(o) {
      r.calls.push(o);
      o.onProgress?.(0.5);
      o.onProgress?.(1);
      return result === 'blob' ? new Blob(['png'], { type: 'image/png' }) : null;
    },
    saver(_blob, filename) {
      r.saved.push(filename);
      return 'download';
    },
  };
  return r;
}

async function mount(rec: Recorder, save: Record<string, unknown> = {}): Promise<void> {
  await makeTestStore({
    save: {
      collections: { stamps: STAMPS, badges: { 'belt-yellow': DAY - 1 } },
      progress: { station: 5, shinsaPassed: ['yellow'] },
      ...save,
    },
  });
  await act(async () => {
    render(<GoshuinBook exporter={rec.exporter} saver={rec.saver} />, root);
  });
}

const spreadEl = (): HTMLElement => root.querySelector<HTMLElement>('.goshuin-book__spread')!;
const stationsShown = (): number[] => Array.from(spreadEl().querySelectorAll<HTMLElement>('.goshuin-book__page[data-station]')).map((e) => Number(e.dataset.station));
/** Click an export button and let the sequential pipeline drain. */
async function clickExport(kind: 'desktop' | 'phone'): Promise<void> {
  await act(async () => {
    root.querySelector<HTMLButtonElement>(`[data-export="${kind}"]`)!.click();
  });
  for (let i = 0; i < 20 && root.querySelector('[data-export="desktop"]')?.hasAttribute('disabled'); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
const key = (k: string): void => {
  act(() => {
    spreadEl().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
};

describe('book helpers', () => {
  it('builds 53 station pages plus a belt page after each Shinsa station', () => {
    const pages = buildPages(STAMPS, ['yellow'], { 'belt-yellow': DAY });
    expect(pages.filter((p) => p.kind === 'station')).toHaveLength(53);
    const belts = pages.filter((p) => p.kind === 'belt');
    expect(belts).toHaveLength(7);
    // Yellow belt page follows station 9
    const nine = pages.findIndex((p) => p.kind === 'station' && p.station.number === 9);
    const after = pages[nine + 1]!;
    expect(after).toMatchObject({ kind: 'belt', passed: true, at: DAY });
    expect(after.kind === 'belt' ? after.belt.id : null).toBe('yellow');
    // Black belt page is last
    expect(pages[pages.length - 1]).toMatchObject({ kind: 'belt', passed: false });
    expect(pages.every((p, i) => p.index === i)).toBe(true);
    expect(spreadsOf(pages)).toHaveLength(30);
    expect(spreadOfPage(3)).toBe(1);
  });

  it('opens on the latest cleared station, else the current station', () => {
    const pages = buildPages(STAMPS, [], {});
    expect(initialSpread(pages, STAMPS, 5)).toBe(spreadOfPage(3)); // station 4 is page index 3
    expect(initialSpread(pages, {}, 12)).toBe(spreadOfPage(pages.findIndex((p) => p.kind === 'station' && p.station.number === 12)));
    expect(initialSpread(pages, {}, 0)).toBe(0);
  });

  it('bookStamps keeps only real stations, sorted; filenames are ASCII and numbered for sets', () => {
    const stamps = bookStamps({ ...STAMPS, 99: { at: DAY, perfect: false, assisted: false } });
    expect(stamps.map((s) => s.station.number)).toEqual([1, 2, 4]);
    expect(stamps[1]?.perfect).toBe(true);
    expect(bookFilename('desktop', 0, 1, DAY)).toBe('tsuzuku-goshuin-cho-desktop-2026-10-17.png');
    expect(bookFilename('phone', 2, 6, DAY)).toBe('tsuzuku-goshuin-cho-phone-2026-10-17-3of6.png');
  });
});

describe('<GoshuinBook>', () => {
  it('lists all 53 pages in the index and opens on the spread with the latest stamp', async () => {
    await mount(recorder());
    const tabs = root.querySelectorAll('.goshuin-book__tab');
    expect(tabs).toHaveLength(53);
    expect(Array.from(tabs).map((t) => t.getAttribute('data-station'))).toEqual(STATIONS.map((s) => String(s.number)));
    expect(root.querySelector('.goshuin-book__lede')?.textContent).toContain('3 of 53');
    expect(stationsShown()).toEqual([3, 4]);
    expect(root.querySelectorAll('.goshuin-book__tab[aria-current="page"]')).toHaveLength(2);
    // cleared page carries the learner's stamp; the uncleared one is grey stone with the Gatekeeper named
    const four = spreadEl().querySelector('[data-station="4"]')!;
    expect(four.getAttribute('data-state')).toBe('cleared');
    expect(four.querySelector('figure.goshuin')).not.toBeNull();
    expect(four.textContent).toContain('Assisted Gate');
    expect(four.textContent).toContain('保土ヶ谷');
    const three = spreadEl().querySelector('[data-station="3"]')!;
    expect(three.getAttribute('data-state')).toBe('locked');
    expect(three.querySelector('.goshuin-book__blank')).not.toBeNull();
    expect(three.textContent).toContain('Not yet cleared');
    expect(three.textContent).toContain('湊の関守');
  });

  it('arrow keys, Home/End and the page index turn the spreads; the belt page sits after its Shinsa station', async () => {
    await mount(recorder());
    key('ArrowRight');
    expect(stationsShown()).toEqual([5, 6]);
    key('ArrowLeft');
    expect(stationsShown()).toEqual([3, 4]);
    key('Home');
    expect(stationsShown()).toEqual([1, 2]);
    expect(spreadEl().querySelector('[data-station="2"]')?.textContent).toContain('Passed at 100 %');
    key('End');
    const lastSpread = spreadEl();
    expect(lastSpread.querySelector('[data-belt="black"]')).not.toBeNull();
    expect(lastSpread.querySelector('[data-belt="black"]')?.getAttribute('data-state')).toBe('locked');
    expect(lastSpread.textContent).toContain('The Shinsa waits');

    act(() => root.querySelector<HTMLButtonElement>('.goshuin-book__tab[data-station="9"]')!.click());
    const belt = spreadEl().querySelector('[data-belt="yellow"]')!;
    expect(belt).not.toBeNull();
    expect(belt.getAttribute('data-state')).toBe('cleared');
    expect(belt.querySelector('.mon--earned')).not.toBeNull();
    expect(belt.textContent).toContain(`Passed ${formatEraDate(DAY - 1)} · ${eraGloss(DAY - 1)}`);
    // the belt title carries its romaji (the only reading a rank has)
    expect(belt.querySelector('.goshuin-book__romaji')?.textContent).toBe('入門 · Nyūmon');
    expect(belt.querySelector('.goshuin-book__romaji [lang="ja"]')?.textContent).toBe('入門');
    expect(root.querySelector('.goshuin-book__spread-label')?.textContent).toBe('Spread 5 of 30');
  });

  it('swiping left turns to the next spread; a short drag does not', async () => {
    await mount(recorder());
    const swipe = (x0: number, x1: number): void => {
      act(() => {
        spreadEl().dispatchEvent(new TouchEvent('touchstart', { changedTouches: [{ clientX: x0 } as Touch], bubbles: true }));
        spreadEl().dispatchEvent(new TouchEvent('touchend', { changedTouches: [{ clientX: x1 } as Touch], bubbles: true }));
      });
    };
    swipe(200, 120);
    expect(stationsShown()).toEqual([5, 6]);
    swipe(200, 190);
    expect(stationsShown()).toEqual([5, 6]);
    swipe(100, 220);
    expect(stationsShown()).toEqual([3, 4]);
  });

  it('exports the desktop strip as one 6480 × 720 image with text layers, and names the file', async () => {
    const rec = recorder();
    await mount(rec);
    await clickExport('desktop');
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]).toMatchObject({ width: 6480, height: 720 });
    expect(rec.calls[0]!.svg).toContain('goshuin-page--cleared');
    expect(rec.calls[0]!.texts.length).toBeGreaterThan(53);
    expect(rec.saved).toEqual(['tsuzuku-goshuin-cho-desktop-2026-01-15.png']);
    expect(root.querySelector('.goshuin-book__status')?.textContent).toBe('Saved 1 image(s).');
  });

  it('exports the phone set as six 1080 × 2340 images', async () => {
    const rec = recorder();
    await mount(rec);
    await clickExport('phone');
    expect(rec.calls).toHaveLength(6);
    for (const c of rec.calls) expect(c).toMatchObject({ width: 1080, height: 2340 });
    expect(rec.saved).toHaveLength(6);
    expect(new Set(rec.saved).size).toBe(6);
    expect(rec.saved[5]).toBe('tsuzuku-goshuin-cho-phone-2026-01-15-6of6.png');
    expect(root.querySelector('.goshuin-book__status')?.textContent).toBe('Saved 6 image(s).');
  });

  it('says so, without a stack trace, when the host cannot rasterise', async () => {
    const rec = recorder('null');
    await mount(rec);
    await clickExport('desktop');
    expect(rec.saved).toEqual([]);
    expect(root.querySelector('.goshuin-book__status')?.textContent).toContain('cannot draw the image');
    expect(root.querySelector<HTMLButtonElement>('[data-export="desktop"]')!.disabled).toBe(false);
  });

  it('holds at most two <filter> elements (none): stamps are <img> data URLs with their text set over them in the page fonts, the belt crest stone is an <img>, the spread is a .sheet--gutter', async () => {
    await mount(recorder());
    expect(root.querySelectorAll('filter').length).toBeLessThanOrEqual(2);
    expect(root.querySelectorAll('filter')).toHaveLength(0);
    const four = spreadEl().querySelector('[data-station="4"]')!;
    const img = four.querySelector<HTMLImageElement>('img.goshuin__img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')!.startsWith('data:image/svg+xml')).toBe(true);
    const image = decodeURIComponent(img!.getAttribute('src')!);
    expect(image).not.toContain('var(');
    // no webfont resolves inside an image: the name is inline <text> over it, not in the data URL
    expect(image).not.toContain('<text');
    expect(four.querySelector('.goshuin__svg svg.goshuin__text text')).not.toBeNull();
    expect(four.querySelector('.goshuin__svg svg.goshuin__text')?.textContent).toContain('保土ヶ谷');
    expect(four.querySelectorAll('.goshuin__svg svg')).toHaveLength(1);
    expect(four.querySelector('.goshuin__svg')?.getAttribute('aria-label')).toContain('保土ヶ谷');
    // the caption's era date carries its Latin gloss (§3.3)
    expect(four.querySelector('.goshuin__date')?.textContent).toBe(formatEraDate(DAY - 2));
    expect(four.querySelector('.goshuin__gloss')?.textContent).toBe(eraGloss(DAY - 2));
    expect(spreadEl().classList.contains('sheet')).toBe(true);
    expect(spreadEl().classList.contains('sheet--gutter')).toBe(true);
    expect(root.querySelector('.goshuin-book__spread-label')?.classList.contains('eyebrow')).toBe(true);
    key('End');
    const black = spreadEl().querySelector('[data-belt="black"]')!;
    expect(black.querySelector('img.mon__img')).not.toBeNull();
    expect(black.querySelector('svg.mon__text text')?.textContent?.length).toBe(1);
    expect(root.querySelectorAll('filter')).toHaveLength(0);
    // the spread label takes its type from .eyebrow alone (no local font-size collision)
    const css = readFileSync(resolve(process.cwd(), 'src/collections/GoshuinBook.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(/\.goshuin-book__spread-label\s*\{([^}]*)\}/.exec(css)?.[1]).not.toMatch(/font-size/);
    expect(css).not.toMatch(/,\s*\.goshuin-book__spread-label\s*\{/);
  });

  it('the newest spread turns its right page in once: not the left page, gone after the spreads turn, never under reducedMotion (both pages stand)', async () => {
    await mount(recorder());
    const pages = spreadEl().querySelectorAll('.goshuin-book__page');
    expect(pages).toHaveLength(2);
    expect(pages[1]!.classList.contains(PAGE_TURN_CLASS)).toBe(true);
    expect(pages[0]!.classList.contains(PAGE_TURN_CLASS)).toBe(false);
    key('ArrowRight');
    expect(root.querySelector(`.${PAGE_TURN_CLASS}`)).toBeNull();
    key('ArrowLeft');
    expect(stationsShown()).toEqual([3, 4]);
    expect(root.querySelector(`.${PAGE_TURN_CLASS}`)).toBeNull();

    render(null, root);
    resetStoreForTests();
    await mount(recorder(), { settings: { reducedMotion: true } });
    expect(stationsShown()).toEqual([3, 4]);
    expect(root.querySelector(`.${PAGE_TURN_CLASS}`)).toBeNull();
  });

  it('station names follow the kana rule (design 09 §3.3, §12.1 d49): romaji below Green; a kana <ruby> in the page head and the stamp caption from Green on, "Station n" beside it; the caption keeps its brush face under the ruby', async () => {
    await mount(recorder(), { profile: { belt: 'yellow' }, settings: { furigana: 'always' } });
    const four = spreadEl().querySelector('[data-station="4"]')!;
    expect(four.querySelector('.goshuin-book__romaji')?.textContent).toBe('4 · Hodogaya');
    expect(four.querySelector('.goshuin-book__name ruby')).toBeNull();
    expect(four.querySelector('.goshuin__romaji')?.textContent).toBe('4 · Hodogaya');
    expect(four.querySelector('.goshuin__caption ruby')).toBeNull();
    render(null, root);
    resetStoreForTests();
    resetOpenedForTests();
    await mount(recorder(), { profile: { belt: 'green' }, settings: { furigana: 'always' } });
    const g4 = spreadEl().querySelector('[data-station="4"]')!;
    expect(g4.querySelector('.goshuin-book__romaji')?.textContent).toBe('Station 4');
    expect(g4.querySelector('.goshuin-book__name ruby rt')?.textContent).toBe('ほどがや');
    expect(g4.querySelector('.goshuin-book__name [lang="ja"] ruby')).not.toBeNull();
    expect(g4.querySelector('.goshuin__romaji')?.textContent).toBe('Station 4');
    expect(g4.querySelector('.goshuin__caption ruby rt')?.textContent).toBe('ほどがや');
    expect(g4.textContent).not.toContain('Hodogaya');
    // the Ruby's own span would set --font-ja (ui.css .ruby, base.css [lang="ja"]): the caption's name inherits the brush back
    const css = readFileSync(resolve(process.cwd(), 'src/collections/GoshuinBook.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.goshuin-book__page \.goshuin__name \.ruby\s*\{\s*font-family:\s*inherit;\s*\}/);
    // the uncleared page's stone name keeps its reading in the head too
    const three = spreadEl().querySelector('[data-station="3"]')!;
    expect(three.querySelector('.goshuin-book__name ruby rt')?.textContent).toBe('かながわ');
    expect(three.textContent).not.toContain('Kanagawa');
  });

  it('moment E inline: a stamp earned since the last open is pressed when its stamp slot is seen (at once without an observer), the print bleeding in while the caption stands, with the era date and its Latin gloss; the export bar is a .meter', async () => {
    const rec = recorder();
    // the book was opened before with stations 1 and 2 only: 4 is new since, whatever the clock says
    markOpened('goshuin', ['1', '2']);
    await mount(rec);
    const four = spreadEl().querySelector('[data-station="4"]')!;
    expect(four.getAttribute('data-reveal')).toBe('in');
    // the entrance rides the print (image + text) inside the art box, never the figure: the caption never blinks
    expect(four.querySelector('figure.goshuin')?.classList.contains('ink-nijimi')).toBe(false);
    expect(four.querySelector('.goshuin__print')?.classList.contains('ink-nijimi')).toBe(true);
    expect(four.querySelector('.goshuin__svg')?.classList.contains('ink-osu')).toBe(true);
    expect(four.querySelector('.goshuin-book__stamp .collections__era')?.textContent).toBe(formatEraDate(DAY - 2));
    expect(four.querySelector('.seal-date__label')?.textContent).toBe(eraGloss(DAY - 2));
    // seen: the book records it, so a page turned away from and back never replays
    expect(newSince('goshuin', [{ id: '4', at: DAY - 2 }], DAY).size).toBe(0);
    // the uncleared page has no reveal
    expect(spreadEl().querySelector('[data-station="3"]')?.hasAttribute('data-reveal')).toBe(false);
    // while a fresh stamp waits, only its art is held back — the caption reads (CSS text)
    const css = readFileSync(resolve(process.cwd(), 'src/collections/GoshuinBook.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\[data-reveal="wait"\] \.goshuin__svg\s*\{\s*opacity:\s*0;\s*\}/);
    expect(css).not.toMatch(/\[data-reveal="wait"\] \.goshuin\s*\{/);
    await act(async () => {
      root.querySelector<HTMLButtonElement>('[data-export="desktop"]')!.click();
    });
    const bar = root.querySelector<HTMLElement>('.goshuin-book__progress');
    if (bar) {
      expect(bar.classList.contains('meter')).toBe(true);
      expect(bar.querySelector('.meter__fill')).not.toBeNull();
    }
  });
});
