import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { BADGE_IDS } from '../shared/catalog';
import { civilToDay, formatEraDate } from '../shared/time';
import { BADGE_DEFS } from '../store';
import { MON_DEFAULT_SIZE, MON_SLAM_CLASS, MonCrest, monCrestText } from './MonCrest';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const KYOTO = BADGE_DEFS.find((d) => d.id === 'kyoto')!;
const ZEN = BADGE_DEFS.find((d) => d.id === 'zen')!;
const DAY = civilToDay({ year: 2026, month: 10, day: 17 });

function figure(): HTMLElement {
  return root.querySelector('figure.mon') as HTMLElement;
}
function host(): HTMLElement {
  return root.querySelector('.mon__svg') as HTMLElement;
}

describe('<MonCrest>', () => {
  it('aria-label includes the English and Japanese name; the svg is decorative inside the labelled host', () => {
    act(() => render(<MonCrest id="kyoto" earned />, root));
    const h = host();
    expect(h.getAttribute('role')).toBe('img');
    const label = h.getAttribute('aria-label') ?? '';
    expect(label).toContain(KYOTO.nameEn);
    expect(label).toContain(KYOTO.nameJa);
    expect(label).toContain('earned');
    const svg = h.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.classList.contains('mon-svg--earned')).toBe(true);
    expect(svg.getAttribute('width')).toBe(String(MON_DEFAULT_SIZE));
    expect(figure().dataset.tier).toBe('gold');
    expect(figure().dataset.earned).toBe('true');
  });

  it('unearned shows the condition in the caption, the label and the tooltip, as grey stone', () => {
    act(() => render(<MonCrest id="zen" earned={false} />, root));
    const f = figure();
    expect(f.classList.contains('mon--locked')).toBe(true);
    expect(f.querySelector('.mon__condition')?.textContent).toBe(ZEN.describe);
    expect(f.getAttribute('title')).toBe(ZEN.describe);
    expect(host().getAttribute('aria-label')).toContain(ZEN.describe);
    expect(host().getAttribute('aria-label')).toContain('not yet earned');
    expect(f.querySelector('svg')?.classList.contains('mon-svg--locked')).toBe(true);
    expect(f.querySelector('.mon__date')).toBeNull();
    // no accent colour in stone
    expect((host().innerHTML.match(/#c9302c|#4e8a3c|#b8860b/i) ?? []).length).toBe(0);
  });

  it('a describe prop overrides the catalog condition', () => {
    act(() => render(<MonCrest id="zen" earned={false} describe="Thirty quiet sessions." />, root));
    expect(figure().querySelector('.mon__condition')?.textContent).toBe('Thirty quiet sessions.');
    expect(figure().getAttribute('title')).toBe('Thirty quiet sessions.');
    expect(host().getAttribute('aria-label')).toContain('Thirty quiet sessions.');
  });

  it('earned with a day shows the era date as <time> and in the tooltip', () => {
    act(() => render(<MonCrest id="seven" earned earnedOn={DAY} />, root));
    const time = figure().querySelector('time.mon__date') as HTMLTimeElement;
    expect(time).not.toBeNull();
    expect(time.getAttribute('dateTime')).toBe('2026-10-17');
    expect(time.textContent).toBe(formatEraDate(DAY));
    expect(time.getAttribute('lang')).toBe('ja');
    expect(figure().getAttribute('title')).toBe(`Earned ${formatEraDate(DAY)}`);
    expect(host().getAttribute('aria-label')).toContain(formatEraDate(DAY));
    expect(figure().querySelector('.mon__condition')).toBeNull();
  });

  it('earned without a day falls back to the name as tooltip', () => {
    act(() => render(<MonCrest id="seven" earned />, root));
    expect(figure().getAttribute('title')).toBe('Seven Days');
    expect(figure().querySelector('.mon__date')).toBeNull();
  });

  it('Japanese name carries lang="ja" and the caption can be hidden', () => {
    act(() => render(<MonCrest id="kyoto" earned />, root));
    const ja = figure().querySelector('.mon__ja')!;
    expect(ja.getAttribute('lang')).toBe('ja');
    expect(ja.textContent).toBe('京');
    expect(figure().querySelector('.mon__name')?.textContent).toBe('Kyoto');

    act(() => render(<MonCrest id="kyoto" earned caption={false} />, root));
    expect(figure().querySelector('figcaption')).toBeNull();
    expect(host().getAttribute('aria-label')).toContain('Kyoto');
  });

  it('size sets the svg and the host box; slam and class pass through', () => {
    act(() => render(<MonCrest id="ippon" earned size={48} slam class="shelf__crest" />, root));
    const f = figure();
    expect(f.querySelector('svg')?.getAttribute('width')).toBe('48');
    expect(host().style.width).toBe('48px');
    expect(f.classList.contains(MON_SLAM_CLASS)).toBe(true);
    expect(f.classList.contains('shelf__crest')).toBe(true);
    expect(f.classList.contains('mon--bronze')).toBe(true);
  });

  it('follows the page theme through inline var() styles with hex fallbacks', () => {
    act(() => render(<MonCrest id="kyoto" earned />, root));
    expect(host().innerHTML).toContain('var(--kin,');
    expect(host().innerHTML).toContain('var(--kon,');
  });

  it('is deterministic across renders and distinct across ids', () => {
    act(() => render(<MonCrest id="kyoto" earned />, root));
    const a = host().innerHTML;
    act(() => render(null, root));
    act(() => render(<MonCrest id="kyoto" earned />, root));
    expect(host().innerHTML).toBe(a);
    act(() => render(null, root));
    act(() => render(<MonCrest id="zen" earned />, root));
    expect(host().innerHTML).not.toBe(a);
  });

  it('renders every badge id, earned and locked', () => {
    for (const id of BADGE_IDS) {
      act(() => render(<MonCrest id={id} earned size={48} />, root));
      expect(host().querySelector('svg')).not.toBeNull();
      act(() => render(<MonCrest id={id} earned={false} size={48} />, root));
      expect(figure().querySelector('.mon__condition')?.textContent?.length).toBeGreaterThan(0);
      act(() => render(null, root));
    }
  });
});

describe('<MonCrest> stone (design 09 §7 E, §6.7 rule 2)', () => {
  it('stoneImg renders a locked crest as an <img> data URL of the stone art with the glyph set over it as inline text in the brush face — no filter element in the DOM', () => {
    act(() => render(<MonCrest id="zen" earned={false} stoneImg />, root));
    const img = host().querySelector<HTMLImageElement>('img.mon__img');
    expect(img).not.toBeNull();
    const src = img!.getAttribute('src')!;
    expect(src.startsWith('data:image/svg+xml')).toBe(true);
    const image = decodeURIComponent(src);
    expect(image).toContain('mon__art--locked');
    expect(image).toContain('feSpecularLighting');
    // webfonts never resolve inside an image: the glyph is not in the data URL …
    expect(image).not.toContain('<text');
    expect(image).not.toContain(ZEN.nameJa);
    // … it is inline <text> over the image, in the page's Yuji face, with no filter
    const overlay = host().querySelector('svg.mon__text')!;
    expect(overlay).not.toBeNull();
    expect(overlay.getAttribute('viewBox')).toBe('0 0 256 256');
    const text = overlay.querySelector('text')!;
    expect(text.textContent).toBe(ZEN.nameJa);
    expect(text.getAttribute('font-family')).toContain('Yuji Syuku');
    expect(overlay.querySelector('filter')).toBeNull();
    expect(host().querySelectorAll('svg')).toHaveLength(1);
    expect(root.querySelectorAll('filter')).toHaveLength(0);
    expect(figure().hasAttribute('data-stone')).toBe(true);
    expect(figure().classList.contains('mon--locked')).toBe(true);
    expect(host().getAttribute('aria-label')).toContain(ZEN.describe);
    expect(img!.getAttribute('alt')).toBe('');
  });

  it('stone draws the stone art for an earned crest while the caption and label stay true; svgClass reaches the art box', () => {
    act(() => render(<MonCrest id="seven" earned earnedOn={DAY} stone stoneImg svgClass="ink-osu ink-wet is-dry" />, root));
    expect(figure().classList.contains('mon--earned')).toBe(true);
    expect(figure().hasAttribute('data-stone')).toBe(true);
    expect(host().querySelector('img.mon__img')).not.toBeNull();
    expect(host().classList.contains('ink-osu')).toBe(true);
    expect(host().classList.contains('ink-wet')).toBe(true);
    expect(host().getAttribute('aria-label')).toContain(`earned ${formatEraDate(DAY)}`);
    expect(figure().querySelector('time.mon__date')?.textContent).toBe(formatEraDate(DAY));
    expect(figure().querySelector('.mon__condition')).toBeNull();
    // colour: inline svg, no stone attribute, no stone layer
    act(() => render(<MonCrest id="seven" earned earnedOn={DAY} stoneImg />, root));
    expect(figure().hasAttribute('data-stone')).toBe(false);
    expect(host().querySelector('svg.mon-svg--earned')).not.toBeNull();
    expect(host().querySelector('img')).toBeNull();
    expect(host().querySelector('.mon__stone')).toBeNull();
  });

  it('stoneLeaving keeps the stone layer over the colour art under kasure (in place: --to 0 0), so the reveal reads as stone turning to colour', () => {
    act(() => render(<MonCrest id="seven" earned earnedOn={DAY} stoneImg stoneLeaving svgClass="ink-osu ink-wet is-dry" />, root));
    expect(figure().hasAttribute('data-stone')).toBe(false);
    expect(host().querySelector('.mon__colour svg.mon-svg--earned')).not.toBeNull();
    const stone = host().querySelector('.mon__stone')!;
    expect(stone.classList.contains('ink-kasure')).toBe(true);
    expect(stone.hasAttribute('data-leaving')).toBe(true);
    expect(stone.querySelector('img.mon__img')).not.toBeNull();
    expect(stone.querySelector('svg.mon__text text')?.textContent).toBe('七');
    expect(root.querySelectorAll('filter')).toHaveLength(0);
    const css = readFileSync(resolve(process.cwd(), 'src/art/MonCrest.css'), 'utf8');
    expect(/\.mon__stone\.ink-kasure\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/--to:\s*0 0/);
    expect(/\.mon__stone\.ink-kasure\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/animation-duration:\s*var\(--dur-3\)/);
    // without stoneLeaving the colour art stands alone
    act(() => render(<MonCrest id="seven" earned earnedOn={DAY} stoneImg />, root));
    expect(host().querySelector('.mon__stone')).toBeNull();
  });

  it('dateGloss sets the Latin reading under the era date, in the label and in the tooltip (design 09 §3.3: never an unglossed 令和)', () => {
    act(() => render(<MonCrest id="seven" earned earnedOn={DAY} dateGloss="Reiwa 8 · Oct 17" />, root));
    const gloss = figure().querySelector('.mon__gloss')!;
    expect(gloss.textContent).toBe('Reiwa 8 · Oct 17');
    expect(gloss.previousElementSibling?.classList.contains('mon__date')).toBe(true);
    expect(figure().getAttribute('title')).toBe(`Earned ${formatEraDate(DAY)} · Reiwa 8 · Oct 17`);
    expect(host().getAttribute('aria-label')).toContain(`${formatEraDate(DAY)} · Reiwa 8 · Oct 17`);
    expect(monCrestText({ id: 'seven', earned: true, earnedOn: DAY, dateGloss: 'Reiwa 8 · Oct 17' }).tooltip).toBe(`Earned ${formatEraDate(DAY)} · Reiwa 8 · Oct 17`);
    // the gloss never prints without a date, and a locked crest ignores it
    act(() => render(<MonCrest id="seven" earned dateGloss="Reiwa 8 · Oct 17" />, root));
    expect(figure().querySelector('.mon__gloss')).toBeNull();
    act(() => render(<MonCrest id="zen" earned={false} dateGloss="Reiwa 8 · Oct 17" />, root));
    expect(figure().querySelector('.mon__gloss')).toBeNull();
    const css = readFileSync(resolve(process.cwd(), 'src/art/MonCrest.css'), 'utf8');
    expect(/\}\n\.mon__gloss\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/font-family:\s*var\(--font-pixel\)/);
  });
});

describe('monCrestText', () => {
  it('builds the label, tooltip and condition from the catalog', () => {
    const locked = monCrestText({ id: 'zen', earned: false });
    expect(locked.nameEn).toBe('Zen');
    expect(locked.nameJa).toBe('禅');
    expect(locked.condition).toBe(ZEN.describe);
    expect(locked.date).toBeNull();
    expect(locked.label).toBe(`Zen 禅 crest, not yet earned. ${ZEN.describe}`);
    const earned = monCrestText({ id: 'zen', earned: true, earnedOn: DAY });
    expect(earned.date).toBe(formatEraDate(DAY));
    expect(earned.label).toBe(`Zen 禅 crest, earned ${formatEraDate(DAY)}.`);
    expect(earned.tooltip).toBe(`Earned ${formatEraDate(DAY)}`);
  });
});
