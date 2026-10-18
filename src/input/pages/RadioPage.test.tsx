import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { DIALOGUE, createFakeLoader } from '@/content/fixtures';
import { installServices, nullAudio, resetServices, type AudioService } from '@/shared/audio';
import { bus } from '@/shared/events';
import { href } from '@/shared/routes';
import { store } from '@/store';
import { captureEvents, makeTestStore } from '@/store/testing';
import { S } from '../listening/radio-strings';
import RadioPage from './RadioPage';

const loader = createFakeLoader();

function deviceAudio(): AudioService {
  return { ...nullAudio, muted: signal(false), hasJaVoice: signal(true), speak: () => Promise.resolve() };
}

let root: HTMLDivElement;
beforeEach(async () => {
  await makeTestStore({ save: { settings: { furigana: 'off', speedTier: 2 }, progress: { station: 4 } } });
  bus.reset();
  installServices({ audio: deviceAudio() });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

function links(): string[] {
  return Array.from(root.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
}

describe('<RadioPage>', () => {
  it('is the default export (pages convention) and wraps the player with a way back and the honesty line', () => {
    expect(typeof RadioPage).toBe('function');
    act(() => render(<RadioPage route={{ name: 'radio' }} loader={loader} clips={null} inputs={{ stories: [DIALOGUE], pools: [], kanaTracks: [] }} />, root));
    expect(root.querySelector('.radio-page')).not.toBeNull();
    expect(links()).toEqual([href({ name: 'dojo' }), href({ name: 'station', n: 4 })]);
    expect(root.textContent).toContain('Station 4');
    expect(root.querySelector('.radio-page__note')?.textContent).toBe(S.pageHonesty);
    expect(root.querySelector('.radio-page__hint')?.textContent).toBe(S.pageSettings);
    // the player is inside, in device mode without a pack
    expect(root.querySelector('.radio__chip-source')?.textContent).toBe(S.chipDevice);
    expect(root.querySelector('.radio__title')?.textContent).toContain(S.title);
    expect(root.querySelector('.radio__title [lang="ja"]')?.textContent).toBe(S.titleJa);
    expect(root.textContent).not.toMatch(/recorded/i);
  });

  it('a Station-0 save (not yet onboarded) gets only the dojo link', () => {
    store.patch('progress', (p) => ({ ...p, station: 0 }));
    act(() => render(<RadioPage route={{ name: 'radio' }} loader={loader} clips={null} inputs={{ stories: [], pools: [], kanaTracks: [] }} />, root));
    expect(links()).toEqual([href({ name: 'dojo' })]);
  });

  it('mounting the page emits nothing: no session, no XP, no ledger row', async () => {
    const cap = captureEvents();
    act(() => render(<RadioPage route={{ name: 'radio' }} loader={loader} clips={null} inputs={{ stories: [DIALOGUE], pools: [], kanaTracks: [] }} />, root));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(cap.events).toEqual([]);
    expect(store.ledger.value.entries).toEqual([]);
    cap.stop();
  });
});
