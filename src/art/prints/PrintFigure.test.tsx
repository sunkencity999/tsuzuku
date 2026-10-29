/**
 * PrintFigure.tsx — the three frames, the LQIP under the picture, the image's attributes, data-loaded on load,
 * data-failed on error (the LQIP stays on purpose), the orientation classes, the Road states, data saver (button then image; a decorative figure keeps the
 * preview alone), the caption's four lines (the title in --font-ja, never .mincho; the series with its reading); the CSS budget.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { vi } from 'vitest';
import { FIXTURE_IDS, FIXTURE_LQIP, makeFixtureManifest, makeFixturePrint } from './fixtures';
import { ART_ROOT, PrintFigure, focusPosition, printSrc, type PrintFigureProps, type PrintState } from './PrintFigure';
import { altOf, captionOf } from './select';
import { S } from './strings';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const M = makeFixtureManifest();
const byId = (id: string) => M.prints.find((p) => p.id === id)!;
const river = byId(FIXTURE_IDS.river);
const bridge = byId(FIXTURE_IDS.bridge);
const pine = byId(FIXTURE_IDS.pine);

function mount(p: PrintFigureProps): void {
  act(() => render(<PrintFigure {...p} />, root));
}
const fig = (): HTMLElement => root.querySelector<HTMLElement>('figure.print')!;
const box = (): HTMLElement => root.querySelector<HTMLElement>('.print__box')!;
const img = (): HTMLImageElement | null => root.querySelector<HTMLImageElement>('img.print__img');
const load = (): void => {
  act(() => {
    img()!.dispatchEvent(new Event('load'));
  });
};
const fail = (): void => {
  act(() => {
    img()!.dispatchEvent(new Event('error'));
  });
};

describe('<PrintFigure>', () => {
  it('hero: a mat with the LQIP under the picture and an image with alt, size, lazy loading and async decoding', () => {
    mount({ print: river, variant: 'hero' });
    expect(fig().className).toBe('print print--hero print--landscape');
    expect(fig().hasAttribute('data-state')).toBe(false);
    expect(fig().hasAttribute('data-loaded')).toBe(false);
    expect(box().style.backgroundImage).toContain(FIXTURE_LQIP);
    expect(box().style.aspectRatio).toBe('1400 / 897');
    expect(box().style.backgroundPosition).toBe('');
    const i = img()!;
    expect(i.getAttribute('src')).toBe(printSrc(river));
    expect(printSrc(river)).toBe(`${ART_ROOT}${river.file}`);
    expect(printSrc(river).startsWith('./art/prints/')).toBe(true);
    expect(i.getAttribute('alt')).toBe(altOf(river));
    expect(i.getAttribute('alt')).toBe('Fixture Artist, Morning on the river');
    expect(i.getAttribute('width')).toBe('1400');
    expect(i.getAttribute('height')).toBe('897');
    expect(i.getAttribute('loading')).toBe('lazy');
    expect(i.getAttribute('decoding')).toBe('async');
    expect(i.hasAttribute('fetchpriority')).toBe(false);
    expect(i.style.objectPosition).toBe('');
    expect(root.querySelectorAll('img').length).toBe(1);
  });

  it('marks the figure loaded on the load event, once, and tells the owner once', () => {
    const onLoaded = vi.fn();
    mount({ print: river, variant: 'hero', onLoaded });
    expect(fig().hasAttribute('data-loaded')).toBe(false);
    load();
    expect(fig().getAttribute('data-loaded')).toBe('');
    expect(onLoaded).toHaveBeenCalledTimes(1);
    load();
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it('a print that does not arrive marks the figure failed, not loaded: the LQIP stays as the picture on purpose, the owner is not told, a new print resets it', () => {
    const onLoaded = vi.fn();
    mount({ print: river, variant: 'hero', onLoaded });
    expect(fig().hasAttribute('data-failed')).toBe(false);
    fail();
    expect(fig().getAttribute('data-failed')).toBe('');
    expect(fig().hasAttribute('data-loaded')).toBe(false);
    expect(onLoaded).not.toHaveBeenCalled();
    // the preview is still the picture, and the image keeps its place and its alt (the stylesheet leaves it at opacity 0)
    expect(box().style.backgroundImage).toContain(FIXTURE_LQIP);
    expect(img()!.getAttribute('alt')).toBe(altOf(river));
    fail();
    expect(fig().getAttribute('data-failed')).toBe('');
    expect(onLoaded).not.toHaveBeenCalled();
    // another print starts clean and may load
    mount({ print: pine, variant: 'hero', onLoaded });
    expect(fig().hasAttribute('data-failed')).toBe(false);
    load();
    expect(fig().getAttribute('data-loaded')).toBe('');
    expect(fig().hasAttribute('data-failed')).toBe(false);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    // data saver: the print the learner asked for can fail the same way
    mount({ print: river, variant: 'hero', dataSaver: true });
    act(() => {
      root.querySelector<HTMLButtonElement>('button.print__show')!.click();
    });
    fail();
    expect(fig().getAttribute('data-failed')).toBe('');
    expect(root.querySelector('button.print__show')).toBeNull();
  });

  it('eager: loading eager and fetchpriority high', () => {
    mount({ print: river, variant: 'hero', eager: true });
    expect(img()!.getAttribute('loading')).toBe('eager');
    expect(img()!.getAttribute('fetchpriority')).toBe('high');
  });

  it('portrait hero: the portrait class and no inline ratio (the 3 / 2 box is the stylesheet)', () => {
    mount({ print: pine, variant: 'hero' });
    expect(fig().className).toBe('print print--hero print--portrait');
    expect(box().style.aspectRatio).toBe('');
    expect(img()!.getAttribute('width')).toBe('940');
    expect(img()!.getAttribute('height')).toBe('1400');
  });

  it('band: cover-cropped about the focus on both the image and the preview; no caption unless asked — and without one the figure is presentational', () => {
    mount({ print: bridge, variant: 'band' });
    expect(fig().className).toBe('print print--band print--landscape');
    expect(img()!.style.objectPosition).toBe('40% 50%');
    expect(box().style.backgroundPosition).toBe('40% 50%');
    expect(box().style.aspectRatio).toBe('');
    expect(root.querySelector('figcaption')).toBeNull();
    // an unnamed figure would be announced over the Station's sign plate (ARIA figure takes no name from its img)
    expect(fig().getAttribute('role')).toBe('presentation');
    mount({ print: bridge, variant: 'band', caption: true });
    expect(root.querySelector('figcaption')).not.toBeNull();
    expect(fig().hasAttribute('role')).toBe(false);
    mount({ print: river, variant: 'hero', caption: false });
    expect(root.querySelector('figcaption')).toBeNull();
    expect(fig().getAttribute('role')).toBe('presentation');
    // the captioned hero is a real figure, named by its figcaption
    mount({ print: river, variant: 'hero' });
    expect(root.querySelector('figcaption')).not.toBeNull();
    expect(fig().hasAttribute('role')).toBe(false);
  });

  it('thumb: the Road state rides on data-state, a decorative thumb has an empty alt and a presentational wrapper, and nothing says locked', () => {
    for (const state of ['passed', 'here', 'ahead'] as PrintState[]) {
      mount({ print: river, variant: 'thumb', state, decorative: true });
      expect(fig().className).toBe('print print--thumb print--landscape');
      expect(fig().getAttribute('data-state')).toBe(state);
      expect(fig().getAttribute('role')).toBe('presentation');
      expect(img()!.getAttribute('alt')).toBe('');
      expect(img()!.style.objectPosition).toBe('50% 42%');
    }
    // decorative wins even with a caption asked for: the owner names the picture
    mount({ print: river, variant: 'thumb', decorative: true, caption: true });
    expect(fig().getAttribute('role')).toBe('presentation');
    expect(root.textContent?.toLowerCase()).not.toContain('locked');
  });

  it('data saver: the LQIP and a touch-sized button, then the image, eagerly', () => {
    const onLoaded = vi.fn();
    mount({ print: river, variant: 'hero', dataSaver: true, onLoaded });
    expect(img()).toBeNull();
    expect(box().style.backgroundImage).toContain(FIXTURE_LQIP);
    expect(box().style.aspectRatio).toBe('1400 / 897');
    const btn = root.querySelector<HTMLButtonElement>('button.print__show')!;
    expect(btn.textContent).toBe(S.printShow);
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.classList.contains('btn')).toBe(true);
    act(() => {
      btn.click();
    });
    expect(root.querySelector('button.print__show')).toBeNull();
    expect(img()).not.toBeNull();
    expect(img()!.getAttribute('loading')).toBe('eager');
    expect(img()!.getAttribute('fetchpriority')).toBe('high');
    load();
    expect(fig().getAttribute('data-loaded')).toBe('');
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it('data saver on a decorative figure (a Road thumb): the LQIP alone — no image, no button, nothing to ask with — in its state', () => {
    mount({ print: river, variant: 'thumb', state: 'ahead', decorative: true, dataSaver: true });
    expect(img()).toBeNull();
    expect(root.querySelector('button')).toBeNull();
    expect(box().children).toHaveLength(0);
    expect(box().style.backgroundImage).toContain(FIXTURE_LQIP);
    expect(box().style.backgroundPosition).toBe('50% 42%');
    expect(fig().getAttribute('data-state')).toBe('ahead');
    expect(fig().hasAttribute('data-loaded')).toBe(false);
    // the same figure without the saver carries its picture; a non-decorative figure under the saver keeps its button
    mount({ print: river, variant: 'thumb', state: 'ahead', decorative: true });
    expect(img()).not.toBeNull();
    mount({ print: river, variant: 'band', dataSaver: true });
    expect(img()).toBeNull();
    expect(root.querySelector('button.print__show')).not.toBeNull();
  });

  it('a new print resets the loaded mark and the data-saver answer', () => {
    mount({ print: river, variant: 'hero' });
    load();
    expect(fig().hasAttribute('data-loaded')).toBe(true);
    mount({ print: pine, variant: 'hero' });
    expect(fig().hasAttribute('data-loaded')).toBe(false);
    expect(img()!.getAttribute('src')).toBe(printSrc(pine));
    mount({ print: river, variant: 'hero', dataSaver: true });
    act(() => {
      root.querySelector<HTMLButtonElement>('button.print__show')!.click();
    });
    expect(img()).not.toBeNull();
    mount({ print: pine, variant: 'hero', dataSaver: true });
    expect(img()).toBeNull();
  });

  it('the caption teaches: the Japanese title line, the reading line, the series line, the museum credit', () => {
    mount({ print: river, variant: 'hero' });
    const c = captionOf(river);
    const cap = root.querySelector('figcaption.print__caption')!;
    const title = cap.querySelector<HTMLElement>('.print__title-ja')!;
    expect(title.getAttribute('lang')).toBe('ja');
    // --font-ja through [lang="ja"], never .mincho: the manifest's glyphs are outside every shell slice (09 §3.5; ART_PACK §9)
    expect(title.className).toBe('print__title-ja');
    expect(title.textContent).toBe(`${c.artistJa}《${c.titleJa}》`);
    expect(cap.querySelector('.print__reading')?.textContent).toBe('Fixture Artist · Kawa no asa · Morning on the river');
    const series = cap.querySelector<HTMLElement>('.print__series')!;
    expect(series.textContent).toBe(`${S.printFrom} Fixture no uchi Fikusucha no uchi · The fixture series, c. 1833-34`);
    expect(series.querySelector('[lang="ja"]')?.textContent).toBe('Fixture no uchi');
    // the series carries its reading, distinct from the Japanese and from the gloss
    expect(c.seriesReading).toBe('Fikusucha no uchi');
    expect(c.seriesReading).not.toBe(c.seriesJa);
    expect(series.textContent).toContain(` ${c.seriesReading} · ${c.seriesEn}`);
    expect(cap.querySelector('.print__source')?.textContent).toBe('Fixture Museum, Gift of the fixture 0000.1 · CC0 1.0');
    // every Japanese span in the caption is followed by a Latin reading or gloss in the same caption
    expect(cap.querySelectorAll('[lang="ja"]').length).toBe(2);
  });

  it('leaves the date off the series line when the print has none; drops an empty reading from the reading line and from the series line', () => {
    mount({ print: makeFixturePrint({ id: 'x-01-y', date: '', title: { ja: 'T-JA', reading: '', en: 'Title' } }), variant: 'hero' });
    expect(root.querySelector('.print__series')?.textContent).toBe(`${S.printFrom} Fixture no uchi Fikusucha no uchi · The fixture series`);
    expect(root.querySelector('.print__reading')?.textContent).toBe('Fixture Artist · Title');
    mount({ print: makeFixturePrint({ id: 'x-01-y', date: '', series: { id: 'fx', ja: 'S-JA', reading: '', en: 'Series' } }), variant: 'hero' });
    expect(root.querySelector('.print__series')?.textContent).toBe(`${S.printFrom} S-JA Series`);
  });

  it('appends the owner class and rounds the focus to a tenth of a percent', () => {
    mount({ print: river, variant: 'thumb', class: 'road__stop' });
    expect(fig().className).toBe('print print--thumb print--landscape road__stop');
    expect(focusPosition(makeFixturePrint({ id: 'x-01-y', focus: [0.3333, 0.6667] }))).toBe('33.3% 66.7%');
    expect(focusPosition(makeFixturePrint({ id: 'x-01-y', focus: [0, 1] }))).toBe('0% 100%');
  });
});

describe('PrintFigure.css', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/art/prints/PrintFigure.css'), 'utf8');
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('stays within the 1,600 byte budget', () => {
    expect(Buffer.byteLength(css, 'utf8')).toBeLessThanOrEqual(1600);
  });

  it('uses tokens only: no colour literals, no kanji, no ms literals', () => {
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(/[㐀-䶿一-鿿]/.test(css)).toBe(false);
    expect(body).not.toMatch(/\d+m?s\b/);
  });

  it('transitions opacity only (design 09 §6.7), never animates, and keeps filter and the ring static', () => {
    const transitions = Array.from(body.matchAll(/transition:\s*([^;]+);/g), (m) => m[1]!);
    expect(transitions.length).toBeGreaterThan(0);
    for (const t of transitions) for (const part of t.split(',')) expect(part.trim().split(/\s+/)[0]).toBe('opacity');
    expect(body).not.toMatch(/animation|@keyframes/);
    expect(body).toMatch(/\[data-state="ahead"\][^{]*\{[^}]*filter: grayscale\(1\)/);
    expect(body).toMatch(/\[data-state="here"\][^{]*\{[^}]*var\(--shu\)/);
  });

  it('names the classes and states the component renders', () => {
    for (const s of ['.print--hero', '.print--band', '.print--thumb', '.print--portrait', '.print__box', '.print__img', '.print__caption', '.print__title-ja', '.print__source', '[data-loaded]']) expect(body).toContain(s);
    expect(body).toMatch(/\.print--band \.print__box \{[^}]*aspect-ratio: 4 \/ 1;[^}]*min-height: 160px/);
    expect(body).toMatch(/\.print--thumb \.print__box \{[^}]*aspect-ratio: 4 \/ 3/);
    expect(body).toMatch(/\.print--hero\.print--portrait \.print__box \{[^}]*aspect-ratio: 3 \/ 2/);
  });

  it('sets no Mincho or Neon face, and the component mounts no .mincho: the caption rides --font-ja through [lang="ja"] (09 §3.5 — the title glyphs are outside every shell slice; ART_PACK §9)', () => {
    expect(body).not.toMatch(/--font-(mincho|neon)\b/);
    const tsx = readFileSync(resolve(process.cwd(), 'src/art/prints/PrintFigure.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(tsx).not.toMatch(/class=["'`][^"'`]*\b(mincho|neon)\b/);
  });
});
