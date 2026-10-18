import { render } from 'preact';
import { act } from 'preact/test-utils';
import { href, route } from '../../shared/routes';
import { resetStoreForTests } from '../../store/store';
import { makeTestStore } from '../../store/testing';
import CollectionsPage, { TABS, tabOf } from './CollectionsPage';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  location.hash = '';
});

async function mount(tab: 'mon' | 'kakejiku' | 'goshuin'): Promise<void> {
  await makeTestStore();
  await act(async () => {
    render(<CollectionsPage route={{ name: 'collections', tab }} />, root);
  });
}

const tabs = (): HTMLAnchorElement[] => Array.from(root.querySelectorAll<HTMLAnchorElement>('[role="tab"]'));

describe('tabOf', () => {
  it('reads the tab from the route and falls back to mon', () => {
    expect(tabOf({ name: 'collections', tab: 'goshuin' })).toBe('goshuin');
    expect(tabOf({ name: 'collections', tab: 'kakejiku' })).toBe('kakejiku');
    expect(tabOf({ name: 'dojo' })).toBe('mon');
    expect(TABS.map((t) => t.id)).toEqual(['mon', 'kakejiku', 'goshuin']);
  });
});

describe('<CollectionsPage>', () => {
  it('renders the Mon grid for collections/mon with a tablist whose links come from href()', async () => {
    await mount('mon');
    expect(root.querySelector('.collections')?.getAttribute('data-tab')).toBe('mon');
    expect(root.querySelector('.mon-grid')).not.toBeNull();
    expect(root.querySelector('.kakejiku-gallery')).toBeNull();
    expect(root.querySelector('.goshuin-book')).toBeNull();
    const t = tabs();
    expect(t).toHaveLength(3);
    expect(t.map((a) => a.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(t.map((a) => a.getAttribute('href'))).toEqual([
      href({ name: 'collections', tab: 'mon' }),
      href({ name: 'collections', tab: 'kakejiku' }),
      href({ name: 'collections', tab: 'goshuin' }),
    ]);
    expect(t.map((a) => a.tabIndex)).toEqual([0, -1, -1]);
    const panel = root.querySelector('[role="tabpanel"]')!;
    expect(panel.getAttribute('aria-labelledby')).toBe(t[0]!.id);
    expect(root.querySelector('h1')?.textContent).toContain('Collections');
  });

  it('renders the gallery for kakejiku and the book for goshuin', async () => {
    await mount('kakejiku');
    expect(root.querySelector('.kakejiku-gallery')).not.toBeNull();
    expect(root.querySelector('.mon-grid')).toBeNull();
    expect(tabs()[1]?.getAttribute('aria-selected')).toBe('true');
    render(null, root);
    await mount('goshuin');
    expect(root.querySelector('.goshuin-book')).not.toBeNull();
    expect(root.querySelector('.kakejiku-gallery')).toBeNull();
    expect(tabs()[2]?.getAttribute('aria-selected')).toBe('true');
  });

  it('mounts the one shared #ink-bleed-8 def and never more than two <filter> elements, whichever shelf is open (design 09 §5.3, §6.7 rule 2)', async () => {
    for (const tab of ['mon', 'kakejiku', 'goshuin'] as const) {
      await mount(tab);
      expect(root.querySelectorAll('filter#ink-bleed-8')).toHaveLength(1);
      expect(root.querySelectorAll('filter').length).toBeLessThanOrEqual(2);
      expect(root.querySelectorAll('filter')).toHaveLength(1);
      expect(root.querySelector('.collections__defs')?.getAttribute('aria-hidden')).toBe('true');
      render(null, root);
      resetStoreForTests();
    }
  });

  it('arrow keys on the tablist navigate to the neighbouring shelf', async () => {
    await mount('mon');
    act(() => {
      tabs()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(route.value).toEqual({ name: 'collections', tab: 'kakejiku' });
    expect(location.hash).toBe(href({ name: 'collections', tab: 'kakejiku' }));
    act(() => {
      tabs()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(route.value).toEqual({ name: 'collections', tab: 'goshuin' });
    act(() => {
      tabs()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    expect(route.value).toEqual({ name: 'collections', tab: 'mon' });
  });
});
