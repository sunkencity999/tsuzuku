/**
 * `<TeachCard>` under design 09 (owner C4): the card's `--i` feeds the capped
 * stagger (§6.3, motion.css's math with a local 60 ms `--stagger`), the section
 * heads and the pitch caption are `.eyebrow` (§3.1), and TeachCard.css keeps no
 * local keyframes, no ms literal and no per-file reduced-motion block (§6.6).
 * jsdom applies no stylesheet, so the CSS contract is read from the file text.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { V, createFakeLoader } from '../content/fixtures';
import type { VocabItem } from '../content/types';
import { makeTestStore } from '../store/testing';
import { teachModel } from './scroll';
import { TeachCard } from './TeachCard';

const loader = createFakeLoader();
const css = readFileSync(resolve(process.cwd(), 'src/session/TeachCard.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
let root: HTMLDivElement;

beforeEach(async () => {
  await makeTestStore();
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

function mount(index: number, withContrast = false): void {
  const item = loader.get<VocabItem>(V.飲む)!;
  const model = teachModel(item)!;
  const contrast = withContrast ? teachModel(loader.get(V.食べる)!) : null;
  act(() => render(<TeachCard item={item} model={model} index={index} total={12} furigana="always" known={false} onKnown={() => undefined} contrast={contrast} />, root));
}

describe('<TeachCard> stagger (design 09 §6.3)', () => {
  it('carries its index as --i; the CSS delays by min(var(--i, 0), 7) × a local 60 ms --stagger, with no literal, keyframe or reduced block', () => {
    mount(11);
    const card = root.querySelector<HTMLElement>('.teach-card');
    expect(card).not.toBeNull();
    expect(card!.style.getPropertyValue('--i')).toBe('11');
    const rule = /\.teach-card\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/--stagger:\s*calc\(var\(--dur-1\) \/ 2\)/);
    expect(rule).toMatch(/animation-delay:\s*calc\(min\(var\(--i, 0\), 7\) \* var\(--stagger\)\)/);
    expect(css).not.toMatch(/\b\d+(\.\d+)?m?s\b/);
    expect(css).not.toMatch(/@keyframes|prefers-reduced-motion|\.reduced-motion/);
  });
});

describe('<TeachCard> labels (design 09 §3.1)', () => {
  it('every section head and the pitch caption is an .eyebrow; no __label class or rule remains', () => {
    mount(0, true);
    const heads = Array.from(root.querySelectorAll('h4'));
    expect(heads.length).toBeGreaterThanOrEqual(3);
    for (const h of heads) expect(h.classList.contains('eyebrow'), h.textContent ?? '').toBe(true);
    expect(root.querySelector('.pitch-mark .eyebrow')?.textContent).toContain('Pitch');
    expect(root.querySelector('[class*="__label"]')).toBeNull();
    expect(css).not.toMatch(/__label|__eyebrow/);
    expect(css).toMatch(/\.teach-card h4\s*\{/);
  });
});
