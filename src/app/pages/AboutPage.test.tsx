import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { loadArtManifest, makeFixtureManifest, resetArtForTests, type ArtManifest } from '@/art/prints';
import { installServices, nullAudio, resetServices, servicesVersion, type AudioPackInfo, type ClipPlayer, type ClipReady } from '@/shared/audio';
import { bus } from '@/shared/events';
import { href } from '@/shared/routes';
import { resetStoreForTests } from '@/store';
import { makeTestStore } from '@/store/testing';
import AboutPage, { APP_VERSION, RULES, contentVersionLine, printCredits, voiceCredits } from './AboutPage';
import { S, fmt } from './strings';

const ROUTE = { name: 'about' } as const;

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  resetArtForTests();
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  resetServices();
  resetArtForTests();
  vi.useRealTimers();
  bus.reset();
});

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
const asFetch = (f: FetchFn): typeof fetch => f as unknown as typeof fetch;
/** Settles the print manifest before a mount: a pack with this document, or none on a 404. */
const settleArt = (m: ArtManifest | null): Promise<ArtManifest | null> =>
  loadArtManifest(asFetch(async () => (m ? ({ ok: true, json: async () => JSON.parse(JSON.stringify(m)) as unknown } as unknown as Response) : ({ ok: false, status: 404 } as unknown as Response))));

/** The fixture pack with a second artist and series on two of its four prints (fixtures carry no Japanese glyph). */
function twoArtistPack(): ArtManifest {
  const m = makeFixtureManifest();
  const second = { ja: 'Niban Eshi', reading: 'Niban Eshi', en: 'Second Artist' };
  const seriesTwo = { id: 'fx2', ja: 'Niban no uchi', reading: 'Nibanme no uchi', en: 'The second series' };
  m.prints[2]!.artist = second;
  m.prints[2]!.series = seriesTwo;
  m.prints[3]!.series = seriesTwo;
  return m;
}

/** A `ClipPlayer` double with only what About reads: `ready` and `info.credits`. */
function clipsWith(ready: ClipReady, credits: string[]): ClipPlayer {
  const info: AudioPackInfo | null = ready === 'ready' ? { audioVersion: 'a-0123456789', contentVersion: 'c-0', engine: 'VOICEVOX 0.25.2', belts: {}, totals: { bytes: 0, seconds: 0, files: 0 }, credits } : null;
  return {
    ready: signal(ready),
    info: signal(info),
    loadLevel: () => Promise.resolve(),
    loadStation: () => Promise.resolve(),
    prefetchStation() {},
    cueFor: () => undefined,
    cueForText: () => undefined,
    kanaTracks: () => Promise.resolve([]),
    play: () => ({ done: Promise.resolve({ source: 'none' as const, seconds: 0 }), stop() {} }),
    unlock() {},
    dispose() {},
    cacheUsage: () => Promise.resolve({ bytes: 0, files: 0 }),
    download: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  };
}

function mount(): void {
  act(() => render(<AboutPage route={ROUTE} />, root));
}

describe('<AboutPage>', () => {
  it('renders all 10 rules in order', async () => {
    await makeTestStore();
    mount();
    const rules = Array.from(root.querySelectorAll('[data-rule]'));
    expect(rules.length).toBe(10);
    expect(RULES.length).toBe(10);
    rules.forEach((li, i) => {
      expect(li.getAttribute('data-rule')).toBe(String(i + 1));
      expect(li.querySelector('p')?.textContent).toBe(RULES[i]);
    });
    expect(root.textContent).toContain(S.aboutRule1);
    expect(root.textContent).toContain(S.aboutRule10);
    expect(root.textContent).toContain('XP cannot buy a belt');
  });

  it('shows the content version from the save and the app version', async () => {
    await makeTestStore({ save: { contentVersion: '2026.10.1' } });
    mount();
    expect(root.querySelector('[data-content-version]')?.textContent).toBe(fmt(S.aboutContentVersion, { v: '2026.10.1' }));
    expect(contentVersionLine()).toBe('Content 2026.10.1');
    expect(root.querySelector('[data-app-version]')?.textContent).toBe(fmt(S.aboutAppVersion, { v: APP_VERSION }));
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('says when content has not loaded yet', async () => {
    await makeTestStore({ save: { contentVersion: '' } });
    mount();
    expect(root.querySelector('[data-content-version]')?.textContent).toBe(S.aboutContentNone);
  });

  it('lists how it teaches, the licences and privacy with links to backup and settings', async () => {
    await makeTestStore();
    mount();
    expect(root.textContent).toContain(S.aboutFsrs);
    expect(root.textContent).toContain(S.aboutGrading);
    expect(root.textContent).toContain(S.aboutKi);
    expect(root.textContent).toContain(S.aboutJudge);
    expect(root.textContent).toContain(S.aboutGovernor);
    const licences = Array.from(root.querySelectorAll('[data-licenses] li')).map((li) => li.textContent);
    expect(licences).toContain(S.aboutLicenseCode);
    expect(licences).toContain(S.aboutLicenseContent);
    expect(licences).toContain(S.aboutLicenseFonts);
    expect(licences).toContain(S.aboutLicenseWanakana);
    expect(root.textContent).toContain(S.onbPrivacy);
    const hrefs = Array.from(root.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(href({ name: 'backup' }));
    expect(hrefs).toContain(href({ name: 'settings' }));
  });

  it('the licence copy is backed by the repository: LICENSE (MIT), CONTENT_LICENSE.md (CC BY-SA 4.0, fonts OFL) and package.json "license"', () => {
    const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');
    expect(S.aboutLicenseCode).toContain('LICENSE');
    expect(S.aboutLicenseContent).toContain('CONTENT_LICENSE.md');
    const code = read('LICENSE');
    expect(code).toMatch(/^MIT License/);
    expect(code).toContain('Copyright (c) 2026 Christopher Bradford');
    const content = read('CONTENT_LICENSE.md');
    expect(content).toMatch(/Attribution-ShareAlike 4\.0/);
    expect(content).toContain('public/content/');
    expect(content).toContain('docs/allowlists/');
    expect(content).toMatch(/SIL Open Font License/);
    expect(content).toContain('public/fonts/OFL-');
    expect((JSON.parse(read('package.json')) as { license?: string }).license).toBe('MIT');
  });

  it('debug panel: no load errors and the recent bus events, newest first', async () => {
    await makeTestStore();
    bus.emit('xp:gained', { amount: 5, reason: 'review', total: 5 });
    bus.emit('level:up', { level: 2 });
    mount();
    expect(root.querySelector('[data-no-load-errors]')?.textContent).toBe(S.aboutNoLoadErrors);
    const events = Array.from(root.querySelectorAll('[data-events] li')).map((li) => li.textContent ?? '');
    expect(events.length).toBe(2);
    expect(events[0]).toContain('level:up');
    expect(events[1]).toContain('xp:gained');
    expect(events[1]).toContain('"amount":5');
  });

  it('with no events the panel says nothing yet', async () => {
    await makeTestStore();
    mount();
    expect(root.textContent).toContain(S.aboutNoEvents);
  });

  it('never mentions a franchise', async () => {
    await makeTestStore();
    mount();
    expect(root.textContent).not.toMatch(/pok[eé]mon|nintendo|duolingo|street fighter|dragon ball|naruto/i);
  });
});

describe('<AboutPage> voices (design 08 §6 / §12)', () => {
  it('lists VOICEVOX:<character> credits from the runtime manifest under the licences, with the voice-terms line', async () => {
    await makeTestStore();
    const credits = ['VOICEVOX:九州そら', 'VOICEVOX:玄野武宏'];
    installServices({ audio: { ...nullAudio, clips: clipsWith('ready', credits) } });
    mount();
    expect(voiceCredits()).toEqual(credits);
    const rows = Array.from(root.querySelectorAll('[data-licenses] [data-credit]'));
    expect(rows.map((li) => li.getAttribute('data-credit'))).toEqual(credits);
    expect(rows[0]?.querySelector('[lang="ja"]')?.textContent).toBe('VOICEVOX:九州そら');
    expect(rows[0]?.textContent).toContain(S.aboutVoiceCreditNote);
    expect(root.querySelector('[data-no-pack]')).toBeNull();
    const licences = Array.from(root.querySelectorAll('[data-licenses] li')).map((li) => li.textContent);
    expect(licences).toContain(S.aboutLicenseVoices);
    expect(S.aboutLicenseVoices).toMatch(/not CC BY-SA/);
  });

  it('without a pack (the real service came without a player, or the probe found none) the licences say the device voice speaks', async () => {
    await makeTestStore();
    installServices({ audio: { ...nullAudio, setVolume: vi.fn() } });
    mount();
    expect(voiceCredits()).toBeNull();
    expect(root.querySelector('[data-licenses] [data-no-pack]')?.textContent).toBe(S.aboutVoicesNone);
    expect(root.querySelectorAll('[data-credit]')).toHaveLength(0);
    expect(root.querySelector('[data-pack-loading]')).toBeNull();

    render(null, root);
    installServices({ audio: { ...nullAudio, clips: clipsWith('absent', []) } });
    mount();
    expect(voiceCredits()).toBeNull();
    expect(root.querySelector('[data-no-pack]')?.textContent).toBe(S.aboutVoicesNone);

    render(null, root);
    installServices({ audio: { ...nullAudio, clips: clipsWith('ready', []) } });
    mount();
    // A manifest with no credits is treated like no pack: nothing to credit, the sentence stands.
    expect(root.querySelector('[data-no-pack]')?.textContent).toBe(S.aboutVoicesNone);
  });

  it('a cold load (audio services not installed yet) says it is looking, then lists the credits the moment the service lands (the slot’s version signal, no interval); a player still probing keeps the looking line until it settles', async () => {
    await makeTestStore();
    const intervals = vi.spyOn(globalThis, 'setInterval');
    servicesVersion.value = 0; // nullAudio: main.tsx has not installed the audio barrel yet
    mount();
    expect(root.querySelector('[data-licenses] [data-pack-loading]')?.textContent).toBe(S.setPackLoading);
    expect(root.querySelector('[data-no-pack]')).toBeNull();
    expect(root.querySelectorAll('[data-credit]')).toHaveLength(0);
    const credits = ['VOICEVOX:九州そら'];
    act(() => {
      installServices({ audio: { ...nullAudio, clips: clipsWith('ready', credits) } });
    });
    expect(Array.from(root.querySelectorAll('[data-credit]')).map((li) => li.getAttribute('data-credit'))).toEqual(credits);
    expect(root.querySelector('[data-pack-loading]')).toBeNull();
    expect(root.querySelector('[data-no-pack]')).toBeNull();
    expect(intervals).not.toHaveBeenCalled();
    intervals.mockRestore();

    // A probe that is still running when the player lands keeps the looking line until it settles.
    render(null, root);
    resetServices();
    servicesVersion.value = 0;
    mount();
    const late = clipsWith('loading', []);
    act(() => {
      installServices({ audio: { ...nullAudio, clips: late } });
    });
    expect(root.querySelector('[data-pack-loading]')?.textContent).toBe(S.setPackLoading);
    act(() => {
      late.ready.value = 'absent';
    });
    expect(root.querySelector('[data-no-pack]')?.textContent).toBe(S.aboutVoicesNone);

    // Once anything was installed or reset, an empty slot is settled: a build with no pack.
    render(null, root);
    resetServices();
    expect(servicesVersion.value).toBeGreaterThan(0);
    mount();
    expect(root.querySelector('[data-pack-loading]')).toBeNull();
    expect(root.querySelector('[data-no-pack]')?.textContent).toBe(S.aboutVoicesNone);
  });

  it('the honest-share paragraph names the 39 hours of texts, the 7 hours of drill clips and the 75–95 hours over the road (re-pinned from the published three-tier pack); the heading is glossed', async () => {
    await makeTestStore();
    mount();
    const p = root.querySelector('[data-honest-share]')?.textContent ?? '';
    expect(p).toBe(S.honestShare);
    expect(p).toMatch(/39 hours/);
    expect(p).toMatch(/7 hours/);
    expect(p).toMatch(/75–95 hours/);
    expect(p).toMatch(/synthetic/i);
    expect(p).toContain('VOICEVOX');
    expect(p).not.toMatch(/recorded/i);
    expect(p).not.toContain('!');
    const h2 = root.querySelector('#about-voices');
    expect(h2?.textContent).toContain(S.aboutVoicesTitle);
    expect(h2?.querySelector('[lang="ja"]')?.textContent).toBe('声');
  });
});

describe('<AboutPage> prints (design 09 §12.1 d77–d78)', () => {
  it('lists every artist of the pack with the series they contribute — Japanese, reading, gloss — and the count, then the museum line with its open-access link; the licences carry the prints line', async () => {
    await makeTestStore();
    const pack = twoArtistPack();
    await settleArt(pack);
    mount();
    const h2 = root.querySelector('#about-prints');
    expect(h2?.textContent).toContain(S.aboutPrintsTitle);
    expect(h2?.querySelector('[lang="ja"]')?.textContent).toBe(S.aboutPrintsTitleJa);
    expect(root.textContent).toContain(S.aboutPrintsIntro);
    // the pure grouping: manifest order, distinct series per artist, counts summing to the pack
    const credits = printCredits(pack);
    expect(credits.map((c) => [c.artist.en, c.series.map((s) => s.id), c.count])).toEqual([
      ['Fixture Artist', ['fx', 'fx2'], 3],
      ['Second Artist', ['fx2'], 1],
    ]);
    expect(credits.reduce((n, c) => n + c.count, 0)).toBe(pack.prints.length);
    expect(printCredits(null)).toEqual([]);
    expect(credits[0]!.series[0]).toEqual({ id: 'fx', ja: 'Fixture no uchi', reading: 'Fikusucha no uchi', en: 'The fixture series' });
    const rows = Array.from(root.querySelectorAll('[data-print-artists] [data-print-artist]'));
    expect(rows.map((li) => li.getAttribute('data-print-artist'))).toEqual(['Fixture Artist', 'Second Artist']);
    const first = rows[0]!;
    expect(first.querySelector('[lang="ja"]')?.textContent).toBe('Fixture Eshi');
    expect(first.textContent).toContain('Fixture Artist');
    expect(Array.from(first.querySelectorAll('[data-print-series]')).map((s) => s.getAttribute('data-print-series'))).toEqual(['fx', 'fx2']);
    expect(first.textContent).toContain('Fixture no uchi');
    expect(first.textContent).toContain('The fixture series');
    expect(first.textContent).toContain('Niban no uchi');
    // every series span: the Japanese, its reading, the English gloss (the house rule for every Japanese string the learner meets)
    const fx = first.querySelector('[data-print-series="fx"]');
    expect(fx?.textContent).toBe(`Fixture no uchi Fikusucha no uchi${S.separator}The fixture series`);
    expect(fx?.querySelector('[lang="ja"]')?.textContent).toBe('Fixture no uchi');
    expect(first.querySelector('[data-print-series="fx2"]')?.textContent).toBe(`${S.separator}Niban no uchi Nibanme no uchi${S.separator}The second series`);
    expect(first.textContent).toContain(fmt(S.aboutPrintCount, { n: 3 }));
    expect(rows[1]!.textContent).toContain(S.aboutPrintCountOne);
    expect(rows[1]!.textContent).toContain('Niban Eshi');
    // the museum line: "<museum> · <license>", the museum linked to its open-access page
    const sources = root.querySelector('[data-print-sources]');
    expect(sources?.textContent).toBe(`Fixture Museum${S.separator}CC0 1.0`);
    const link = sources?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.invalid/open-access');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(root.querySelector('[data-no-prints]')).toBeNull();
    expect(root.querySelector('[data-prints-loading]')).toBeNull();
    const licences = Array.from(root.querySelectorAll('[data-licenses] li')).map((li) => li.textContent);
    expect(licences).toContain(S.aboutLicensePrints);
    expect(S.aboutLicensePrints).toMatch(/not CC BY-SA/);
  });

  it('without a pack (404, a build without the release) the section says the drawn room stands and lists nothing', async () => {
    await makeTestStore();
    await settleArt(null);
    mount();
    expect(root.querySelector('[data-no-prints]')?.textContent).toBe(S.aboutPrintsNone);
    expect(root.querySelectorAll('[data-print-artist]')).toHaveLength(0);
    expect(root.querySelector('[data-print-sources]')).toBeNull();
    expect(root.querySelector('[data-prints-loading]')).toBeNull();
    // the licences line stands whether or not a pack is built: the terms do not change with the release
    expect(Array.from(root.querySelectorAll('[data-licenses] li')).map((li) => li.textContent)).toContain(S.aboutLicensePrints);
  });

  it('a cold About says it is looking until the manifest lands, then lists the artists without a remount (signals, no interval)', async () => {
    await makeTestStore();
    const intervals = vi.spyOn(globalThis, 'setInterval');
    let land: ((r: Response) => void) | null = null;
    const pending = loadArtManifest(
      asFetch(
        () =>
          new Promise<Response>((resolve) => {
            land = resolve;
          }),
      ),
    );
    mount();
    expect(root.querySelector('[data-prints-loading]')?.textContent).toBe(S.aboutPrintsLoading);
    expect(root.querySelector('[data-no-prints]')).toBeNull();
    expect(root.querySelectorAll('[data-print-artist]')).toHaveLength(0);
    await act(async () => {
      land!({ ok: true, json: async () => JSON.parse(JSON.stringify(makeFixtureManifest())) as unknown } as unknown as Response);
      await pending;
    });
    expect(root.querySelector('[data-prints-loading]')).toBeNull();
    expect(Array.from(root.querySelectorAll('[data-print-artist]')).map((li) => li.getAttribute('data-print-artist'))).toEqual(['Fixture Artist']);
    expect(root.querySelector('[data-print-artist]')?.textContent).toContain(fmt(S.aboutPrintCount, { n: 4 }));
    expect(intervals).not.toHaveBeenCalled();
    intervals.mockRestore();
  });
});
