import { BELT_IDS } from '../content/types';
import { WALLPAPER_IDS } from './catalog';
import {
  COLLECTION_TABS,
  DEFAULT_ROUTE,
  href,
  navigate,
  parseHash,
  route,
  sameRoute,
  syncRouteFromLocation,
  titleFor,
  type Route,
} from './routes';
import { SESSION_MODES } from './session-types';

const VARIANTS: Route[] = [
  { name: 'dojo' },
  { name: 'onboarding' },
  ...SESSION_MODES.map((mode): Route => ({ name: 'train', mode })),
  { name: 'scroll', id: '7-2' },
  { name: 'road' },
  { name: 'station', n: 7 },
  { name: 'station', n: 0 },
  { name: 'gate', n: 53 },
  ...BELT_IDS.map((belt): Route => ({ name: 'shinsa', belt })),
  { name: 'story', id: 's-07-1' },
  { name: 'story', id: 's-07-1', mode: 'listen' },
  { name: 'listen', id: 's-07-2' },
  { name: 'taiwa', id: 's-07-2' },
  { name: 'radio' },
  { name: 'dan' },
  { name: 'library' },
  ...COLLECTION_TABS.map((tab): Route => ({ name: 'collections', tab })),
  ...WALLPAPER_IDS.map((wallpaperId): Route => ({ name: 'studio', wallpaperId })),
  { name: 'records' },
  { name: 'ledger' },
  { name: 'settings' },
  { name: 'backup' },
  { name: 'about' },
];

describe('href / parseHash', () => {
  it('parseHash(href(r)) deep-equals r for every variant', () => {
    for (const r of VARIANTS) {
      const h = href(r);
      expect(h.startsWith('#/')).toBe(true);
      expect(parseHash(h)).toEqual(r);
      expect(parseHash(h.slice(1))).toEqual(r); // without '#'
      expect(sameRoute(parseHash(h), r)).toBe(true);
    }
  });

  it('dojo is #/ and unknown/empty hashes fall back to dojo', () => {
    expect(href({ name: 'dojo' })).toBe('#/');
    for (const h of ['', '#', '#/', '/', '#/nope', '#/train', '#/train/zumba', '#/station/x', '#/station/-1', '#/gate/0', '#/shinsa/red', '#/collections/other', '#/studio/not-a-wallpaper', '#/story', '#/story/a/b', '#/story/s-07-1/listen/x', '#/listen/s-07-1/listen', '#/radio/x', '#/settings/extra']) {
      expect(parseHash(h)).toEqual(DEFAULT_ROUTE);
    }
  });

  it('design 08 routes: #/radio and the Read-along #/story/:id/listen; a plain story hash still parses without mode', () => {
    expect(href({ name: 'radio' })).toBe('#/radio');
    expect(parseHash('#/radio')).toEqual({ name: 'radio' });
    expect(parseHash('#/radio/')).toEqual({ name: 'radio' });
    expect(href({ name: 'story', id: 's-07-1', mode: 'listen' })).toBe('#/story/s-07-1/listen');
    expect(parseHash('#/story/s-07-1/listen')).toStrictEqual({ name: 'story', id: 's-07-1', mode: 'listen' });
    expect(parseHash('#/story/s-07-1/listen?x=1')).toStrictEqual({ name: 'story', id: 's-07-1', mode: 'listen' });
    expect(href({ name: 'story', id: 's-07-1' })).toBe('#/story/s-07-1');
    expect(parseHash('#/story/s-07-1')).toStrictEqual({ name: 'story', id: 's-07-1' });
    expect(sameRoute(parseHash('#/story/s-07-1'), { name: 'story', id: 's-07-1', mode: 'listen' })).toBe(false);
    expect(titleFor({ name: 'radio' })).toBe('茶屋ラジオ Radio · TSUZUKU');
    expect(titleFor({ name: 'story', id: 's-07-1', mode: 'listen' })).toBe('読み聞かせ Read-along · TSUZUKU');
    expect(titleFor({ name: 'story', id: 's-07-1' })).toBe('旅日記 Story · TSUZUKU');
  });

  it('tolerates trailing slashes, queries and encoded ids', () => {
    expect(parseHash('#/road/')).toEqual({ name: 'road' });
    expect(parseHash('#/station/7?x=1')).toEqual({ name: 'station', n: 7 });
    expect(parseHash(href({ name: 'scroll', id: 'a b/c' }))).toEqual({ name: 'scroll', id: 'a b/c' });
    expect(parseHash('#/story/%E6%97%85')).toEqual({ name: 'story', id: '旅' });
  });

  it('titleFor is non-empty for every route', () => {
    for (const r of VARIANTS) {
      expect(titleFor(r).length).toBeGreaterThan(0);
      expect(titleFor(r)).toContain('TSUZUKU');
    }
    expect(titleFor({ name: 'station', n: 7 })).toContain('7');
  });

  it('titleFor shows display names, never raw route ids', () => {
    expect(titleFor({ name: 'train', mode: 'kata' })).not.toBe('kata · TSUZUKU');
    expect(titleFor({ name: 'train', mode: 'kata' })).toBe('型 Kata · TSUZUKU');
    expect(titleFor({ name: 'collections', tab: 'goshuin' })).toContain('Goshuin-chō');
    expect(titleFor({ name: 'collections', tab: 'mon' })).not.toContain('Collections mon');
    expect(titleFor({ name: 'shinsa', belt: 'orange' })).toContain('Orange');
    expect(titleFor({ name: 'studio', wallpaperId: WALLPAPER_IDS[0] })).not.toContain(WALLPAPER_IDS[0]);
    expect(titleFor({ name: 'story', id: 's-04-1' })).not.toContain('s-04-1');
    expect(titleFor({ name: 'library' })).toContain('書庫');
    for (const mode of SESSION_MODES) expect(titleFor({ name: 'train', mode })).not.toMatch(new RegExp(`^${mode} ·`));
  });
});

describe('navigate', () => {
  beforeEach(() => {
    navigate({ name: 'dojo' }, { replace: true });
  });

  it('push sets location.hash and the signal', () => {
    const replaceSpy = vi.spyOn(history, 'replaceState');
    navigate({ name: 'station', n: 7 });
    expect(location.hash).toBe('#/station/7');
    expect(route.value).toEqual({ name: 'station', n: 7 });
    expect(document.title).toBe(titleFor({ name: 'station', n: 7 }));
    expect(replaceSpy).not.toHaveBeenCalled();
    replaceSpy.mockRestore();
  });

  it('replace uses history.replaceState and still updates the signal', () => {
    const replaceSpy = vi.spyOn(history, 'replaceState');
    navigate({ name: 'records' }, { replace: true });
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe('#/records');
    expect(route.value).toEqual({ name: 'records' });
    replaceSpy.mockRestore();
  });

  it('syncRouteFromLocation re-reads a hand-written hash', () => {
    location.hash = '#/library';
    syncRouteFromLocation();
    expect(route.value).toEqual({ name: 'library' });
  });

  it('does not re-notify when navigating to the current route', () => {
    navigate({ name: 'about' });
    const before = route.value;
    navigate({ name: 'about' });
    expect(route.value).toBe(before);
  });
});
