import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { ContentLoader } from '@/content/loader';
import { FIXTURE, FIXTURE_DIALOGUE_ID, FIXTURE_STORY_ID, createFakeLoader } from '@/content/fixtures';
import type { StoryItem } from '@/content/types';
import { bus } from '@/shared/events';
import { installServices, nullAudio, resetServices, type AudioService } from '@/shared/audio';
import type { Route } from '@/shared/routes';
import { KIND_INDEX, addLedgerEntry, playedMinutes, store } from '@/store';
import { captureEvents, makeTestStore } from '@/store/testing';
import { S } from '../reader/strings';
import StoryPage, { listenMinutes, listenMinutesLine, minutesLine, previousEpisodeIds } from './StoryPage';

const STORY = FIXTURE.items[FIXTURE_STORY_ID] as StoryItem;
const DIALOGUE = FIXTURE.items[FIXTURE_DIALOGUE_ID] as StoryItem;
const ANSWERS = STORY.comprehension.map((qq) => qq.choices[qq.answer]);

let root: HTMLDivElement;
let clock = 2_000_000;
let loader: ContentLoader;

beforeEach(async () => {
  clock = 2_000_000;
  loader = createFakeLoader();
  installServices({ audio: nullAudio });
  await makeTestStore({ now: () => clock, save: { progress: { station: 4 } } });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
  bus.reset();
});

const q = (sel: string): HTMLElement | null => root.querySelector(sel);
const qa = (sel: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(sel));
const click = (el: Element | null | undefined): void => {
  act(() => (el as HTMLElement | null)?.click());
};
const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
/** Lets a chain of instantly-resolving utterances run to the end. */
const drain = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

/** A device-voice double: audible, no pack; every utterance takes `ms` of the store clock. */
function synthAudio(ms: number): AudioService {
  return {
    ...nullAudio,
    hasJaVoice: signal(true),
    speak: () => {
      clock += ms;
      return Promise.resolve();
    },
  };
}

function mount(route: Route = { name: 'story', id: FIXTURE_STORY_ID }, l: ContentLoader = loader): void {
  act(() => render(<StoryPage route={route} loader={l} />, root));
}

function finishRead(): void {
  click(q('[data-action="show-rest"]'));
  click(q('[data-action="next"]'));
  for (let i = 0; i < STORY.comprehension.length; i++) {
    const want = ANSWERS[i] as string;
    click(qa('[data-choice]').find((b) => b.textContent?.includes(want)));
    click(q('[data-action="advance"]'));
  }
}

const LISTEN: Route = { name: 'story', id: FIXTURE_STORY_ID, mode: 'listen' };

describe('StoryPage helpers', () => {
  it('previousEpisodeIds: same station first, else the previous station 3 → 1, none for the first', () => {
    expect(previousEpisodeIds('s-04-2')).toEqual(['s-04-1']);
    expect(previousEpisodeIds('s-04-1')).toEqual(['s-03-3', 's-03-2', 's-03-1']);
    expect(previousEpisodeIds('s-01-1')).toEqual([]);
    expect(previousEpisodeIds('v-n5-0001')).toEqual([]);
  });

  it('minutesLine says what reached the ledger', () => {
    const base = { minutes: 3 } as Parameters<typeof minutesLine>[0];
    expect(minutesLine(base)).toBe('3 minutes to your ledger');
    expect(minutesLine({ ...base, minutes: 0 })).toBe(S.resultMinutesNone);
  });

  it("listenMinutes is the store's playedMinutes (a tenth, the listen:played reducer's rounding); under three seconds or nothing heard logs nothing", () => {
    for (const s of [150, 24, 2, 61, 3599]) expect(listenMinutes({ seconds: s, heard: true })).toBe(playedMinutes(s));
    expect(listenMinutes({ seconds: 150, heard: true })).toBe(2.5);
    expect(listenMinutes({ seconds: 24, heard: true })).toBe(0.4);
    expect(listenMinutes({ seconds: 2, heard: true })).toBe(0);
    expect(listenMinutes({ seconds: 150, heard: false })).toBe(0);
    expect(listenMinutesLine({ seconds: 150, heard: true })).toBe('2.5 min to your ledger');
    expect(listenMinutesLine({ seconds: 180, heard: true })).toBe('3 min to your ledger');
    expect(listenMinutesLine({ seconds: 2, heard: true })).toBe(S.resultListenMinutesNone);
    expect(listenMinutesLine({ seconds: 0, heard: false })).toBe(S.heardNone);
  });
});

describe('<StoryPage>', () => {
  it('loads the fixture story: header, station link, kind chip and the reader', async () => {
    mount();
    await settle();
    expect(q('[data-state="reading"]')).not.toBeNull();
    expect(q('.story-page')?.getAttribute('data-mode')).toBe('read');
    expect(q('.story-page__title')?.getAttribute('lang')).toBe('ja');
    expect(q('.story-page__title rt')?.textContent).toBe('みず');
    expect(q('.story-page__title-en')?.textContent).toBe(STORY.titleEn);
    const station = q('.story-page__chips [data-link="station"]') as HTMLAnchorElement;
    expect(station.getAttribute('href')).toBe('#/station/4');
    expect(station.textContent).toContain('Station 4');
    expect(station.textContent).toContain('保土ヶ谷');
    expect(root.textContent).toContain(S.episodeLabel);
    expect(q('.eyebrow')?.textContent).toBe(S.pageTitle);
    expect(q('[data-field="standalone-note"]')?.textContent).toBe(S.standaloneNote);
    expect(q('.reader')).not.toBeNull();
    expect(q('.reader')?.getAttribute('data-mode')).toBe('read');
    expect(q('[data-field="previously"]')).toBeNull(); // no Station 3 texts in the fixture
    expect(q('[data-field="result"]')).toBeNull();
  });

  it('shows the previous episode recap when it exists', async () => {
    mount({ name: 'story', id: FIXTURE_DIALOGUE_ID });
    await settle();
    expect(q('.story-page__title-en')?.textContent).toBe(DIALOGUE.titleEn);
    expect(root.textContent).toContain(S.dialogueLabel);
    const prev = q('[data-field="previously"]');
    expect(prev).not.toBeNull();
    expect(prev?.textContent).toContain(STORY.titleEn);
    expect(prev?.textContent).toContain(STORY.recapEn);
  });

  it('not found: a calm empty state with the station, road and dojo links', async () => {
    mount({ name: 'story', id: 's-09-9' });
    await settle();
    expect(q('[data-state="missing"]')).not.toBeNull();
    expect(root.textContent).toContain(S.storyMissing);
    expect(root.textContent).toContain(S.storyMissingHint);
    expect((q('[data-link="station"]') as HTMLAnchorElement).getAttribute('href')).toBe('#/station/9');
    expect((q('[data-link="road"]') as HTMLAnchorElement).getAttribute('href')).toBe('#/road');
    expect((q('[data-link="dojo"]') as HTMLAnchorElement).getAttribute('href')).toBe('#/');
    expect(root.querySelector('.reader')).toBeNull();
  });

  it('a non-story route is treated as missing without a station link', async () => {
    mount({ name: 'dojo' });
    await settle();
    expect(q('[data-state="missing"]')).not.toBeNull();
    expect(q('[data-link="station"]')).toBeNull();
  });

  it('loads a story that is not in memory through getAsync', async () => {
    const lazy: ContentLoader = { ...loader, get: () => undefined };
    mount({ name: 'story', id: FIXTURE_STORY_ID }, lazy);
    expect(q('[data-state="loading"]')).not.toBeNull();
    await settle();
    expect(q('[data-state="reading"]')).not.toBeNull();
  });

  it('finishing shows the result, logs the minutes once and offers Read again', async () => {
    mount();
    await settle();
    clock += 120_000;
    finishRead();
    const result = q('[data-field="result"]');
    expect(result).not.toBeNull();
    expect(result?.getAttribute('data-passed')).toBe('true');
    expect(q('.story-page__score')?.textContent).toBe('3/3');
    expect(root.textContent).toContain(S.questionsPassed);
    expect(q('[data-field="cpm"]')?.textContent).toContain('characters per minute');
    expect(q('[data-field="taps"]')?.textContent).toBe(S.resultTapsNone);
    expect(q('[data-field="minutes"]')?.textContent).toBe('2 minutes to your ledger');
    expect(q('[data-field="recap"]')?.textContent).toContain(STORY.recapEn);
    expect(q('.reader')).toBeNull();
    // the page logged the minutes itself (no reducers in this store), exactly one row
    expect(store.ledger.value.entries.length).toBe(1);
    expect(store.ledger.value.entries[0]?.[1]).toBe(2);
    expect(store.ledger.value.entries[0]?.[2]).toBe(1); // read
    expect(store.ledger.value.entries[0]?.[3]).toBe(0); // app
    expect((q('[data-link="ledger"]') as HTMLAnchorElement).getAttribute('href')).toBe('#/ledger');
    expect((q('.story-page__actions [data-link="station"]') as HTMLAnchorElement).getAttribute('href')).toBe('#/station/4');

    click(q('[data-action="read-again"]'));
    expect(q('[data-field="result"]')).toBeNull();
    expect(q('.reader')).not.toBeNull();
    expect(qa('li[data-line]').length).toBe(1);
  });

  it('with B reducers wired the ledger still holds exactly one row', async () => {
    await makeTestStore({ now: () => clock, save: { progress: { station: 4 } }, reducers: true });
    mount();
    await settle();
    clock += 180_000;
    finishRead();
    expect(store.ledger.value.entries.length).toBe(1);
    expect(store.ledger.value.entries[0]?.[1]).toBe(3);
    expect(q('[data-field="minutes"]')?.textContent).toBe('3 minutes to your ledger');
  });

  it('under a minute logs nothing and says so', async () => {
    mount();
    await settle();
    clock += 20_000;
    finishRead();
    expect(store.ledger.value.entries.length).toBe(0);
    expect(q('[data-field="minutes"]')?.textContent).toBe(S.resultMinutesNone);
  });

  it('switching the route loads the other episode', async () => {
    mount();
    await settle();
    expect(q('.story-page__title-en')?.textContent).toBe(STORY.titleEn);
    mount({ name: 'story', id: FIXTURE_DIALOGUE_ID });
    await settle();
    expect(q('.story-page__title-en')?.textContent).toBe(DIALOGUE.titleEn);
  });
});

describe('<StoryPage> Read-along (#/story/:id/listen, design 08 §10.3)', () => {
  it('#/story/:id/listen opens the reader in listen mode with the Read-along header; #/story/:id is unchanged', async () => {
    mount(LISTEN);
    await settle();
    expect(q('.story-page')?.getAttribute('data-mode')).toBe('listen');
    expect(q('.story-page')?.getAttribute('data-state')).toBe('listening');
    expect(q('[data-field="mode"]')?.textContent).toContain(S.listenTitle);
    expect(q('[data-field="mode"] [lang="ja"]')?.textContent).toBe(S.listenTitleJa);
    // the kanji in the eyebrow ride --font-ja with no tracking (reader.css .reader__mode [lang='ja']), as inside <StoryReader>
    expect(q('[data-field="mode"]')?.classList.contains('reader__mode')).toBe(true);
    expect(q('[data-field="standalone-note"]')?.textContent).toBe(S.listenStandaloneNote);
    expect(q('.reader')?.getAttribute('data-mode')).toBe('listen');
    expect(q('.reader [data-action="start"]')).not.toBeNull();
    expect(q('.reader [data-action="next"]')).toBeNull();
    expect(q('.reader [data-field="source"]')?.textContent).toBe('text only'); // nullAudio: no voice, no pack
    expect(q('.story-page__title-en')?.textContent).toBe(STORY.titleEn);
    // the plain route keeps the plain reader
    mount({ name: 'story', id: FIXTURE_STORY_ID });
    await settle();
    expect(q('.story-page')?.getAttribute('data-mode')).toBe('read');
    expect(q('.reader')?.getAttribute('data-mode')).toBe('read');
    expect(q('.reader [data-action="next"]')).not.toBeNull();
    expect(q('.eyebrow')?.textContent).toBe(S.pageTitle);
  });

  it('a finished Read-along emits one listen:played, 0 XP, never an episode read, names the minutes and offers the plain reader; without reducers the page writes no row itself', async () => {
    installServices({ audio: synthAudio(10_000) }); // 12 lines × 10 s = 2 min
    const cap = captureEvents();
    mount(LISTEN);
    await settle();
    click(q('[data-action="start"]'));
    await drain();
    expect(q('.reader')?.getAttribute('data-listen-phase')).toBe('ended');
    click(q('[data-action="finish-listen"]'));
    cap.stop();
    expect(cap.events.filter(([n]) => n === 'listen:played')).toHaveLength(1);
    expect(cap.events.some(([n]) => n === 'story:read')).toBe(false);
    const result = q('[data-field="listen-result"]');
    expect(result).not.toBeNull();
    expect(result?.getAttribute('data-heard')).toBe('true');
    expect(q('[data-field="heard"]')?.textContent).toBe('2 min 0 s heard');
    expect(q('[data-field="rate"]')?.textContent).toContain('0.9×');
    expect(q('[data-field="rate"]')?.textContent).toContain('device voice');
    expect(q('[data-field="gist"]')?.textContent).toBe(S.listenGistSkipped);
    expect(q('[data-field="cold"]')?.textContent).toBe(S.listenCold);
    expect(q('[data-field="authentic"]')).toBeNull();
    expect(q('[data-field="minutes"]')?.textContent).toBe('2 min to your ledger');
    expect(q('[data-field="recap"]')?.textContent).toContain(STORY.recapEn);
    expect(q('.reader')).toBeNull();
    // the listen row is the store reducer's alone (it may merge same-day rows): with no reducers wired nothing is logged, and the card still names the minutes
    expect(store.ledger.value.entries.length).toBe(0);
    expect(store.profile.value.xp).toBe(0);
    expect(store.progress.value.storiesRead ?? []).toEqual([]);
    expect(store.progress.value.listened).toEqual([FIXTURE_STORY_ID]);
    expect((q('[data-link="read"]') as HTMLAnchorElement).getAttribute('href')).toBe(`#/story/${FIXTURE_STORY_ID}`);
    expect(q('[data-link="read"]')?.textContent).toBe(S.listenReadIt);
    expect((q('[data-link="ledger"]') as HTMLAnchorElement).getAttribute('href')).toBe('#/ledger');

    click(q('[data-action="listen-again"]'));
    expect(q('[data-field="listen-result"]')).toBeNull();
    expect(q('.reader')?.getAttribute('data-mode')).toBe('listen');
    expect(q('.reader')?.getAttribute('data-listen-phase')).toBe('ready');
  });

  it('with B reducers wired the ledger holds exactly one app listen row of playedMinutes(seconds) and nothing a read would move', async () => {
    await makeTestStore({ now: () => clock, save: { progress: { station: 4 } }, reducers: true });
    installServices({ audio: synthAudio(15_000) }); // 3 min
    const cap = captureEvents();
    mount(LISTEN);
    await settle();
    click(q('[data-action="start"]'));
    await drain();
    click(q('[data-action="finish-listen"]'));
    cap.stop();
    const ev = cap.events.find(([n]) => n === 'listen:played')?.[1] as { seconds: number };
    expect(store.ledger.value.entries.length).toBe(1);
    expect(store.ledger.value.entries[0]?.[1]).toBe(playedMinutes(ev.seconds));
    expect(store.ledger.value.entries[0]?.[1]).toBe(3);
    expect(store.ledger.value.entries[0]?.[2]).toBe(0);
    expect(store.ledger.value.entries[0]?.[3]).toBe(0);
    expect(store.profile.value.xp).toBe(0);
    expect(store.stats.value.episodesRead).toBe(0);
    expect(store.progress.value.storiesRead ?? []).toEqual([]);
    expect(store.quests.value.done).not.toContain('read-episode');
    const badges = store.collections.value.badges;
    expect(badges.bookworm).toBeUndefined();
    expect(badges['dictionary-free']).toBeUndefined();
    expect(badges['speed-reader']).toBeUndefined();
    expect(q('[data-field="minutes"]')?.textContent).toBe('3 min to your ledger');
  });

  it("with B reducers wired a 24-second hearing logs 0.4 min (the reducer's tenth) and the card names that same figure", async () => {
    await makeTestStore({ now: () => clock, save: { progress: { station: 4 } }, reducers: true });
    installServices({ audio: synthAudio(2_000) }); // 12 × 2 s = 24 s
    mount(LISTEN);
    await settle();
    click(q('[data-action="start"]'));
    await drain();
    click(q('[data-action="finish-listen"]'));
    expect(store.ledger.value.entries.length).toBe(1);
    const logged = store.ledger.value.entries[0]?.[1];
    expect(logged).toBe(0.4);
    expect(q('[data-field="minutes"]')?.textContent).toBe(`${logged} min to your ledger`);
  });

  it('with B reducers wired and a same-day app listen row already there (a Radio hearing), one Read-along adds exactly playedMinutes(seconds) to the day: merged into that one row by the coalescing reducer, never a row beside it or a double', async () => {
    await makeTestStore({ now: () => clock, save: { progress: { station: 4 } }, reducers: true });
    addLedgerEntry({ day: store.today(), minutes: 5, kind: KIND_INDEX.listen, source: 0 });
    expect(store.ledger.value.entries.length).toBe(1);
    installServices({ audio: synthAudio(15_000) }); // 3 min
    mount(LISTEN);
    await settle();
    click(q('[data-action="start"]'));
    await drain();
    click(q('[data-action="finish-listen"]'));
    const rows = store.ledger.value.entries.filter((e) => e[0] === store.today() && e[2] === KIND_INDEX.listen && e[3] === 0);
    expect(rows.length).toBe(1); // merged into the Radio row: the store's listen:played reducer coalesces same-day app rows (`withCoalescedEntry`)
    expect(store.ledger.value.entries.length).toBe(1);
    expect(rows.reduce((m, e) => m + e[1], 0)).toBe(5 + 3);
    expect(q('[data-field="minutes"]')?.textContent).toBe('3 min to your ledger');
  });

  it('the self-check shows the gist result and the score; without reducers the card names the 0.4 min and nothing is logged by the page', async () => {
    installServices({ audio: synthAudio(2_000) }); // 24 s
    mount(LISTEN);
    await settle();
    click(q('[data-action="start"]'));
    await drain();
    click(q('[data-action="to-questions"]'));
    for (let i = 0; i < STORY.comprehension.length; i++) {
      const want = ANSWERS[i] as string;
      click(qa('[data-choice]').find((b) => (i === 0 ? !b.textContent?.includes(want) : b.textContent?.includes(want))));
      click(q('[data-action="advance"]'));
    }
    expect(q('[data-field="gist"]')?.textContent).toBe(S.listenGistWrong);
    expect(q('[data-field="score"]')?.textContent).toBe('2 of 3');
    expect(q('[data-field="minutes"]')?.textContent).toBe('0.4 min to your ledger');
    expect(store.ledger.value.entries.length).toBe(0); // the reducer's row, not the page's
  });

  it('text only: nothing heard shows the honest line and logs nothing', async () => {
    mount(LISTEN);
    await settle();
    click(q('[data-action="start"]'));
    await drain();
    for (let i = 0; i < STORY.lines.length; i++) {
      click(q('[data-action="resume"]'));
      await drain();
    }
    click(q('[data-action="finish-listen"]'));
    expect(q('[data-field="listen-result"]')?.getAttribute('data-heard')).toBe('false');
    expect(q('[data-field="heard"]')?.textContent).toBe(S.heardNone);
    expect(q('[data-field="rate"]')).toBeNull();
    expect(q('[data-field="minutes"]')?.textContent).toBe(S.heardNone);
    expect(store.ledger.value.entries.length).toBe(0);
    expect(store.progress.value.listened ?? []).toEqual([]);
  });

  it('a missing id in listen mode shows the calm empty state under the Read-along header', async () => {
    mount({ name: 'story', id: 's-09-9', mode: 'listen' });
    await settle();
    expect(q('[data-state="missing"]')).not.toBeNull();
    expect(q('.story-page')?.getAttribute('data-mode')).toBe('listen');
    expect(q('[data-field="mode"]')?.textContent).toContain(S.listenTitle);
    expect((q('[data-link="station"]') as HTMLAnchorElement).getAttribute('href')).toBe('#/station/9');
  });
});

/* ── design 09 (C4): .sheet cards, .eyebrow labels, the Mincho fence ───────── */
describe('design 09 (C4): sheets, eyebrows and the Mincho fence', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/input/pages/StoryPage.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('the result and recap cards are .sheet, their heads .eyebrow; the page label is an .eyebrow', async () => {
    mount();
    await settle();
    expect(q('.story-page__head > .eyebrow')?.textContent).toBe(S.pageTitle);
    expect(q('[class*="__eyebrow"], [class*="__label"]')).toBeNull();
    clock += 120_000;
    finishRead();
    const result = q('[data-field="result"]');
    expect(result?.classList.contains('sheet')).toBe(true);
    expect(result?.classList.contains('story-page__result')).toBe(true);
    const recap = q('[data-field="recap"]');
    expect(recap?.classList.contains('sheet')).toBe(true);
    expect(recap?.querySelector('h2')?.classList.contains('eyebrow')).toBe(true);
  });

  it('the previous-episode recap is a .sheet with an .eyebrow head', async () => {
    mount({ name: 'story', id: FIXTURE_DIALOGUE_ID });
    await settle();
    const prev = q('[data-field="previously"]');
    expect(prev?.classList.contains('sheet')).toBe(true);
    expect(prev?.querySelector('h2')?.classList.contains('eyebrow')).toBe(true);
  });

  it('StoryPage.css: no local card paper, no label rule, no Mincho (§3.1: the fence stops at the reader body; the title is chrome), no width/height tween', () => {
    expect(css).not.toMatch(/__eyebrow|__label/);
    expect(css).not.toMatch(/\.story-page__(recap|result)\s*\{[^}]*\b(background|padding|border-radius)\s*:/);
    expect(css).not.toMatch(/^\.sheet\b/m);
    expect(css).not.toMatch(/--font-mincho/);
    expect(/\.story-page__title\s*\{[^}]*font-family/.test(css)).toBe(false); // lang="ja" → base.css --font-ja
    expect(css).not.toMatch(/transition:[^;]*\b(width|height)\b/);
    expect(css).not.toMatch(/prefers-reduced-motion|\.reduced-motion/);
  });
});
