/**
 * StationPage.tsx — quotas from STATIONS, progress bars, scrolls, texts, Michikusa count, gate button disabled with its reason until ready, Shinsa link.
 */
import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CardKey, ListeningPool, StoryItem } from '../../content/types';
import { DIALOGUE, FIXTURE, STATION_1, STATION_4, STORY, V, G, createFakeLoader, type Fixture } from '../../content/fixtures';
import { installServices, nullAudio, resetServices, type AudioService } from '../../shared/audio';
import { bus } from '../../shared/events';
import { moraCount } from '../../shared/jp';
import { epochDay } from '../../shared/time';
import type { CardTuple } from '../../shared/store-types';
import { TEACH_ID_RE } from '../../shared/ui/TeachOnce';
import { resetStoreForTests, store } from '../../store';
import { knownIds } from '../../store/derived';
import { DEFAULT_TEST_NOW, card, makeTestStore } from '../../store/testing';
import { poolMinutes, selectPool } from '../../learn';
import { loadRoadArt } from '../RoadNav';
import StationPage, { EAR_PANEL_TEACH_ID, earChip, earMinutes, earReadAlongFor, earTextFor, groupItems } from './StationPage';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const loader = createFakeLoader();

function live(s: number): CardTuple {
  return card({ due: TODAY + 3, s, d: 5, reps: 8, lapses: 0, state: 2, last: TODAY - 1 });
}

function stationCards(o: { greenCount?: number; only?: number } = {}): Record<CardKey, CardTuple> {
  const out: Record<CardKey, CardTuple> = {};
  let ids = [...STATION_4.vocabIds, ...STATION_4.kanjiIds, ...STATION_4.grammarIds];
  if (o.only !== undefined) ids = ids.slice(0, o.only);
  const greenCount = o.greenCount ?? ids.length;
  ids.forEach((id, i) => {
    const s = i < greenCount ? 8 : 2;
    if (id.startsWith('v-')) out[`${id}#rec`] = live(s);
    else if (id.startsWith('j-')) out[`${id}#comp`] = live(s);
    else out[`${id}#cloze`] = live(s);
  });
  return out;
}

let root: HTMLDivElement;
// the headpiece is art-tier, loaded lazily (~0.6 s on its first load here): resolve it once so the header renders whole
beforeAll(async () => {
  expect(await loadRoadArt()).not.toBeNull();
});
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  bus.reset();
});

const settle = async (rounds = 5): Promise<void> => {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};

async function mount(n: number): Promise<void> {
  act(() => render(<StationPage route={{ name: 'station', n }} loader={loader} />, root));
  await settle();
}
const text = (): string => root.textContent ?? '';

describe('<StationPage>', () => {
  it('renders the header, keeper and quotas from STATIONS', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    await mount(4);
    expect(text()).toContain('保土ヶ谷');
    expect(text()).toContain('Hodogaya');
    expect(text()).toContain('坂の関守');
    expect(text()).toContain('Hill Keeper keeps this gate.');
    expect(text()).toContain('Yellow belt · JLPT N5');
    const chips = Array.from(root.querySelectorAll('.station-quotas .chip')).map((c) => c.textContent);
    expect(chips).toEqual(['60 words', '8 kanji', '8 patterns', '3 texts']);
    expect(root.querySelector('.station-head')?.getAttribute('data-belt')).toBe('yellow');
  });

  it('the headpiece (design 09 §7 D): a 160 px picture over the .sign--head plate — the station-seal hero lands on `.station-head .sign` — with the Mincho ordinal, one sumi filter, the road in --road and the keeper lift', async () => {
    await makeTestStore({ save: { progress: { station: 13, stationsCleared: Array.from({ length: 12 }, (_, i) => i + 1) }, profile: { belt: 'orange' } } });
    await mount(13);
    const head = root.querySelector('.station-head')!;
    const piece = head.querySelector('.headpiece')!;
    expect(piece).not.toBeNull();
    const svg = piece.querySelector('svg.headpiece__svg')!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('viewBox')).toBe('0 0 720 160'); // unmeasured in jsdom → the widest composition
    expect(svg.querySelectorAll('*').length).toBeLessThanOrEqual(120);
    expect(svg.querySelectorAll('filter').length).toBe(1);
    expect(svg.querySelectorAll('[filter]').length).toBe(1);
    expect(svg.innerHTML).toContain('var(--road)');
    expect(svg.querySelector('.headpiece__tone')).not.toBeNull();
    expect(piece.getAttribute('role')).toBe('img');
    expect(piece.getAttribute('aria-label')).toBe('Fuji view. Fuji at its tallest over the Hara marshes.');
    // the sign: the hero's landing, with number, ordinal, brush name, romaji (Orange belt) and the state word
    const sign = head.querySelector('.sign')!;
    expect(sign.classList.contains('sign--head')).toBe(true);
    expect(sign.tagName).toBe('H2');
    expect(sign.querySelector('.sign__number')?.textContent).toBe('Station 13');
    expect(sign.querySelector('.sign__ordinal')?.textContent).toBe('第十三宿');
    expect(sign.querySelector('.sign__ordinal')?.getAttribute('aria-hidden')).toBe('true');
    expect(sign.querySelector('.sign__ja')?.textContent).toBe('原');
    expect(sign.querySelector('.sign__reading')?.textContent).toBe('Hara');
    expect(sign.querySelector('.sign__en')?.textContent).toBe('you are here');
    expect(root.querySelector('.station-head__number')).toBeNull();
    // never under the sign: the plate is its own element beside the picture
    expect(sign.querySelector('.headpiece')).toBeNull();
  });

  it('the romaji line follows the kana rule: shown below Green, removed (kana ruby instead) at and after Green (design 09 §3.3)', async () => {
    await makeTestStore({ save: { progress: { station: 16 }, profile: { belt: 'orange' } } });
    await mount(16);
    expect(root.querySelector('.station-head .sign__reading')?.textContent).toBe('Yui');
    expect(root.querySelector('.station-head .sign__ja ruby')).toBeNull();
    await makeTestStore({ save: { progress: { station: 16 }, profile: { belt: 'green' }, settings: { furigana: 'always' } } });
    await mount(16);
    expect(root.querySelector('.station-head .sign__reading')).toBeNull();
    expect(root.querySelector('.station-head .sign__ja rt')?.textContent).toBe('ゆい');
    expect(root.querySelector('.station-head .sign__ja')?.textContent).toContain('由比');
    // `tap` furigana: signage shows the reading outright, never a tap-to-reveal ruby
    await makeTestStore({ save: { progress: { station: 53 }, profile: { belt: 'green' }, settings: { furigana: 'tap' } } });
    await mount(53);
    expect(root.querySelector('.station-head .sign__ja rt')?.textContent).toBe('おおつ');
    expect(root.querySelectorAll('.station-head [role="button"], .station-head .ruby__seg--fog').length).toBe(0);
    await makeTestStore({ save: { progress: { station: 40 }, profile: { belt: 'brown' }, settings: { furigana: 'off' } } });
    await mount(40);
    expect(root.querySelector('.station-head .sign__reading')).toBeNull();
    expect(root.querySelector('.station-head .sign__ja')?.textContent).toBe('鳴海');
    expect(root.querySelector('.station-head .sign__en')?.textContent).toBe('you are here');
  });

  it('reduced motion: the headpiece carries no lifting class and marks itself; a cleared station says cleared', async () => {
    await makeTestStore({ save: { settings: { reducedMotion: true }, progress: { station: 5, stationsCleared: [1, 2, 3, 4] } } });
    await mount(4);
    const svg = root.querySelector('.headpiece svg')!;
    expect(svg.hasAttribute('data-reduced')).toBe(true);
    expect(svg.querySelector('.headpiece__tone')).toBeNull();
    expect(root.querySelectorAll('.station-head [class*="ink-"]').length).toBe(0);
    expect(root.querySelector('.station-head .sign__en')?.textContent).toBe('cleared');
  });

  it('kana stations say "the kana" and no kanji / patterns', async () => {
    await makeTestStore({ save: { progress: { station: 1 } } });
    await mount(1);
    const chips = Array.from(root.querySelectorAll('.station-quotas .chip')).map((c) => c.textContent);
    expect(chips).toEqual(['the kana', '20 words', '3 texts']);
    expect(text()).toContain('Tide Keeper');
  });

  it('gate button is disabled with the reason until every item is introduced and 80 % are Green', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards({ only: 10 }) });
    await mount(4);
    const btn = root.querySelector('.hanko') as HTMLButtonElement;
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-describedby')).toBe('station-gate-reason');
    expect(root.querySelector('#station-gate-reason')?.textContent).toContain('10 of 14 introduced, 10 Green');
    // progress bars read the same numbers
    const bars = root.querySelectorAll('.station-bar');
    expect(bars).toHaveLength(2);
    expect(bars[0]?.getAttribute('aria-valuenow')).toBe('10');
    expect(bars[0]?.getAttribute('aria-valuemax')).toBe('14');
    expect(text()).toContain('10 of 14 introduced');
  });

  it('gate button becomes a link when ready; scrolls, texts and Michikusa are listed', async () => {
    await makeTestStore({ save: { progress: { station: 4 }, collections: { michikusa: ['m-04-1'] } }, cards: stationCards() });
    await mount(4);
    const gate = root.querySelector('.hanko') as HTMLAnchorElement;
    expect(gate.tagName).toBe('A');
    expect(gate.getAttribute('href')).toBe('#/gate/4');
    expect(text()).toContain('The gate is open. 坂の関守 Hill Keeper waits.');
    // scrolls with links
    const scrolls = root.querySelectorAll('.station-scroll');
    expect(scrolls.length).toBeGreaterThan(0);
    expect(scrolls[0]?.querySelector('a')?.getAttribute('href')).toMatch(/^#\/scroll\/4-\d+$/);
    expect(scrolls[0]?.textContent).toContain('Scroll 1');
    // texts: the story and the dialogue, dialogue gets a role-play link
    const stories = Array.from(root.querySelectorAll('.station-story'));
    expect(stories).toHaveLength(2);
    expect(stories[0]?.textContent).toContain('水と犬');
    expect(stories[0]?.querySelector('a')?.getAttribute('href')).toBe('#/story/s-04-1');
    expect(stories[1]?.textContent).toContain('Role-play');
    expect(stories[1]?.querySelectorAll('a')[2]?.getAttribute('href')).toBe('#/taiwa/s-04-2');
    // michikusa count
    expect(text()).toContain('1 of 2 collected');
    expect(text()).toContain('1 more at Hodogaya');
    // items by kind with item belts
    expect(root.querySelector('.station-items[data-kind="vocab"]')).not.toBeNull();
    expect(root.querySelector('.station-items[data-kind="chunk"]')).toBeNull();
    const item = root.querySelector(`.station-item[data-item="${V.飲む}"]`);
    expect(item?.className).toContain('belt--green');
    expect(item?.textContent).toBe('飲む');
    expect(root.querySelector('.station-items[data-kind="component"]')).not.toBeNull();
  });

  it('a cleared station shows the stamp line; belt-final stations link to the Shinsa', async () => {
    await makeTestStore({ save: { progress: { station: 10, stationsCleared: [1, 2, 3, 4, 5, 6, 7, 8, 9] } } });
    await mount(9);
    expect(text()).toContain('The Yellow belt exam is taken here, after the gate.');
    expect(root.querySelector('a[href="#/shinsa/yellow"]')).not.toBeNull();
    // station 9 has no fixture bundle → honest content note, no gate button offered
    expect(text()).toContain('not on the road yet');
    await mount(4);
    expect(text()).toContain('Cleared. The stamp is in your book.');
    expect(root.querySelector('.hanko')).toBeNull();
  });

  it('station 0 is Nihonbashi (onboarding) and unknown stations show a calm not-found', async () => {
    await makeTestStore();
    await mount(0);
    expect(text()).toContain('Nihonbashi');
    expect(root.querySelector('a[href="#/onboarding"]')).not.toBeNull();
    await mount(77);
    expect(text()).toContain('Not on this road.');
    expect(root.querySelector('a[href="#/road"]')).not.toBeNull();
  });

  it('groupItems separates chunks from words and keeps kinds in order', () => {
    const groups = groupItems({ ...STATION_4, kanaIds: ['k-h-a'], vocabIds: [V.飲む, V.おはよう, V.はい] }, (id) => loader.get(id));
    expect(groups.map((g) => g.kind)).toEqual(['kana', 'vocab', 'chunk', 'kanji', 'component', 'grammar']);
    expect(groups[1]?.ids).toEqual([V.飲む]);
    expect(groups[2]?.ids).toEqual([V.おはよう, V.はい]);
  });
});

describe('耳 Ear panel (design 08 §10.1)', () => {
  const { learnerSpeaker: _noPart, ...DIALOGUE_NO_PART } = DIALOGUE;
  void _noPart;
  const PIECE: StoryItem = { ...DIALOGUE_NO_PART, id: 's-04-4', titleJa: 'カウンターで', titleEn: 'At the counter', audioFirst: true, genre: 'exchange' };
  const lineRefs = (story: StoryItem) => story.lines.map((l, i) => ({ ref: `${story.id}#L${i}`, ids: (l.tokenIds ?? []).filter((x): x is string => x !== null), kana: l.kana, morae: moraCount(l.kana) })).filter((r) => r.ids.length > 0);
  const POOL: ListeningPool = {
    schema: 'tsuzuku.pool/1',
    station: 4,
    refs: [
      { ref: `${V.人}#ex0`, ids: [V.人, G.は, G.です], kana: 'あのひとはケンです。', morae: 10 },
      { ref: `${V.おいしい}#ex0`, ids: [V.水, G.は, V.おいしい, G.です], kana: 'このみずはおいしいです。', morae: 12 },
      { ref: `${G.です}#ex1`, ids: [G.は, V.水, G.です], kana: 'これはみずです。', morae: 8 },
      { ref: `${V.飲む}#ex0`, ids: [V.コーヒー, V.飲む], kana: 'まいあさコーヒーをのみます。', morae: 14 },
      ...lineRefs(STORY),
      ...lineRefs(DIALOGUE),
    ],
  };
  const LISTENING: Fixture = { ...FIXTURE, items: { ...FIXTURE.items, [PIECE.id]: PIECE }, stations: [STATION_1, { ...STATION_4, storyIds: [...STATION_4.storyIds, PIECE.id] }], pools: { 4: POOL } };
  const withAudio = (a: Partial<AudioService>): void => installServices({ audio: { ...nullAudio, ...a } });
  const chips = (): (string | null)[] => Array.from(root.querySelectorAll('.station-ear__chip')).map((c) => c.textContent);
  const remount = async (n: number, l = loader): Promise<void> => {
    render(null, root);
    act(() => render(<StationPage route={{ name: 'station', n }} loader={l} />, root));
    await settle();
  };
  const click = (sel: string): void => {
    const el = root.querySelector(sel) as HTMLButtonElement | null;
    if (!el) throw new Error(`no element ${sel}`);
    act(() => el.click());
  };
  afterEach(() => resetServices());

  it('renders three rows whose chips follow the audio slot — synthetic voice (VOICEVOX) / device voice / text only — and never says "recorded"', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards() });
    withAudio({ hasJaVoice: signal(true), source: signal('clips') });
    await mount(4);
    expect(root.querySelector('.station-ear')?.getAttribute('aria-label')).toBe('Ear: listening at this station');
    expect(Array.from(root.querySelectorAll('.station-ear__row')).map((r) => r.getAttribute('data-row'))).toEqual(['set', 'readalong', 'radio']);
    expect(chips()).toEqual(['synthetic voice (VOICEVOX)', 'synthetic voice (VOICEVOX)', 'synthetic voice (VOICEVOX)']);
    expect(text().toLowerCase()).not.toContain('recorded');
    expect(Array.from(root.querySelectorAll('.station-ear__row a')).map((a) => a.getAttribute('href'))).toEqual(['#/listen/s-04-1', '#/story/s-04-1/listen', '#/radio']);
    expect(text()).toContain('聴解 Set');
    expect(text()).toContain('読み聞かせ Read-along');
    expect(text()).toContain('茶屋ラジオ Radio from here');
    for (const el of Array.from(root.querySelectorAll('.station-ear__label'))) expect(el.getAttribute('lang')).toBe('ja');
    // the device voice when the device speaks
    withAudio({ hasJaVoice: signal(true), source: signal('synth') });
    await remount(4);
    expect(chips()).toEqual(['device voice', 'device voice', 'device voice']);
    // text only when nothing is audible: no voice at all, or a pack whose master volume is 0
    withAudio({ hasJaVoice: signal(false) });
    await remount(4);
    expect(chips()).toEqual(['text only', 'text only', 'text only']);
    withAudio({ hasJaVoice: signal(true), source: signal('clips'), canSpeak: signal(false) });
    await remount(4);
    expect(chips()[0]).toBe('text only');
    // no pack and no pools (the default fixture): device voice, and no minutes line is guessed
    withAudio({ hasJaVoice: signal(true) });
    await remount(4);
    expect(chips()[0]).toBe('device voice');
    expect(root.querySelector('.station-ear__minutes')).toBeNull();
    expect(earChip(nullAudio)).toBe('text');
    expect(earChip({ ...nullAudio, hasJaVoice: signal(true) })).toBe('device');
    expect(earChip({ ...nullAudio, hasJaVoice: signal(true), source: signal('clips') })).toBe('synthetic');
    // a missing station has no panel
    await remount(9);
    expect(root.querySelector('.station-ear')).toBeNull();
  });

  it('the minutes line equals poolMinutes of the i+0 selection over the fixture pool at the live known set', async () => {
    const cards = stationCards();
    for (const id of [V.私, V.犬, V.水]) cards[`${id}#rec`] = live(8);
    await makeTestStore({ save: { progress: { station: 4 } }, cards });
    withAudio({ hasJaVoice: signal(true), source: signal('clips') });
    const L = createFakeLoader(LISTENING);
    await remount(4, L);
    const known = knownIds(TODAY);
    expect(known.has(V.おはよう)).toBe(false);
    const selected = selectPool(POOL.refs, known, store.cards, TODAY, { mode: 'i+0' });
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThan(POOL.refs.length);
    const expected = Math.round(poolMinutes(selected));
    expect(earMinutes([POOL], known)).toBe(expected);
    expect(root.querySelector('.station-ear__minutes')?.textContent).toBe(expected >= 1 ? `${expected} min you can follow today` : 'Nothing to follow yet today; the pool grows as your words take root.');
    expect(earMinutes([], known)).toBeNull();
  });

  it('audio-first pieces show their genre and "Listen first"; Read opens once heard; the Set opens the unheard piece; the TeachOnce card shows once', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards() });
    withAudio({ hasJaVoice: signal(true), source: signal('clips') });
    const L = createFakeLoader(LISTENING);
    await remount(4, L);
    const piece = root.querySelector('.station-story[data-audio-first="true"]')!;
    expect(piece).not.toBeNull();
    expect(piece.querySelector('.station-story__genre')?.textContent).toContain('exchange');
    expect(piece.querySelector('.station-story__first')?.textContent).toContain('Listen first');
    expect(Array.from(piece.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(['#/listen/s-04-4']);
    // a plain text keeps Read first, and the dialogue with a part keeps its Role-play
    const first = root.querySelector('.station-story')!;
    expect(first.querySelector('.station-story__first')).toBeNull();
    expect(first.querySelector('a')?.getAttribute('href')).toBe('#/story/s-04-1');
    expect(root.querySelector('a[href="#/taiwa/s-04-2"]')).not.toBeNull();
    expect(root.querySelector('a[href="#/taiwa/s-04-4"]')).toBeNull();
    // the panel's Set opens the unheard piece first; the Read-along never opens an unheard piece (its transcript comes after the first hearing)
    expect(root.querySelector('.station-ear__row[data-row="set"] a')?.getAttribute('href')).toBe('#/listen/s-04-4');
    expect(root.querySelector('.station-ear__row[data-row="readalong"] a')?.getAttribute('href')).toBe('#/story/s-04-1/listen');
    expect(earTextFor([STORY, DIALOGUE, PIECE], [])?.id).toBe(PIECE.id);
    expect(earTextFor([STORY, DIALOGUE, PIECE], [PIECE.id])?.id).toBe(STORY.id);
    expect(earTextFor([STORY, DIALOGUE, PIECE], [PIECE.id, STORY.id, DIALOGUE.id])?.id).toBe(STORY.id);
    expect(earTextFor([], [])).toBeUndefined();
    expect(earReadAlongFor([PIECE, STORY, DIALOGUE], [])?.id).toBe(STORY.id);
    expect(earReadAlongFor([PIECE, STORY, DIALOGUE], [STORY.id])?.id).toBe(DIALOGUE.id);
    expect(earReadAlongFor([PIECE, STORY, DIALOGUE], [STORY.id, DIALOGUE.id])?.id).toBe(STORY.id);
    expect(earReadAlongFor([PIECE, STORY, DIALOGUE], [STORY.id, DIALOGUE.id, PIECE.id])?.id).toBe(PIECE.id); // all heard: the first readable in station order
    expect(earReadAlongFor([PIECE], [])).toBeUndefined();
    expect(earReadAlongFor([PIECE], [PIECE.id])?.id).toBe(PIECE.id);
    // heard → Read opens; the Set moves on to the next unheard text; the Read-along keeps to the unheard plain text
    act(() => {
      store.patch('progress', (p) => ({ ...p, listened: ['s-04-4'] }));
    });
    await settle();
    expect(Array.from(root.querySelector('.station-story[data-audio-first="true"]')!.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(['#/listen/s-04-4', '#/story/s-04-4']);
    expect(root.querySelector('.station-ear__row[data-row="set"] a')?.getAttribute('href')).toBe('#/listen/s-04-1');
    expect(root.querySelector('.station-ear__row[data-row="readalong"] a')?.getAttribute('href')).toBe('#/story/s-04-1/listen');
    // the first-contact card: lowercase ASCII id, shown once, dismissal written to progress.teachSeen
    expect(TEACH_ID_RE.test(EAR_PANEL_TEACH_ID)).toBe(true);
    expect(root.querySelector(`[data-teach-id="${EAR_PANEL_TEACH_ID}"]`)).not.toBeNull();
    expect(text()).toContain('hearing comes first');
    click('.teach-once__dismiss');
    expect(store.progress.value.teachSeen).toEqual([EAR_PANEL_TEACH_ID]);
    expect(root.querySelector(`[data-teach-id="${EAR_PANEL_TEACH_ID}"]`)).toBeNull();
    expect(text().toLowerCase()).not.toContain('recorded');
  });

  it('a station whose only text is an unheard piece has no Read-along row until the piece is heard', async () => {
    await makeTestStore({ save: { progress: { station: 4 } }, cards: stationCards() });
    withAudio({ hasJaVoice: signal(true), source: signal('clips') });
    const L = createFakeLoader({ ...LISTENING, stations: [STATION_1, { ...STATION_4, storyIds: [PIECE.id] }] });
    await remount(4, L);
    expect(Array.from(root.querySelectorAll('.station-ear__row')).map((r) => r.getAttribute('data-row'))).toEqual(['set', 'radio']);
    expect(root.querySelector('.station-ear__row[data-row="set"] a')?.getAttribute('href')).toBe('#/listen/s-04-4');
    act(() => {
      store.patch('progress', (p) => ({ ...p, listened: ['s-04-4'] }));
    });
    await settle();
    expect(Array.from(root.querySelectorAll('.station-ear__row')).map((r) => r.getAttribute('data-row'))).toEqual(['set', 'readalong', 'radio']);
    expect(root.querySelector('.station-ear__row[data-row="readalong"] a')?.getAttribute('href')).toBe('#/story/s-04-4/listen');
  });
});
