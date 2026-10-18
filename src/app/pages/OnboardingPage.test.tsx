import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { installServices, nullAudio, resetServices } from '@/shared/audio';
import { bus } from '@/shared/events';
import { route, syncRouteFromLocation } from '@/shared/routes';
import { INTENSITY_PRESETS, NAME_MAX_GLYPHS, newPerDayFor, resetStoreForTests, store } from '@/store';
import { DEFAULT_TEST_NOW, makeTestStore } from '@/store/testing';
import { onboardingEstimate } from '@/store/derived';
import OnboardingPage, { BASIC_HIRAGANA, KANA_TOTAL, ROAD_DAYS, TILE_COUNT, beltAfterDays, hoursInApp, kanaMatches, roadDays, roadEstimateFor, roadMonths, steadyReviewsInAYear } from './OnboardingPage';
import { S, fmt, num } from './strings';

const markKnownSpy = vi.fn();
vi.mock('@/learn/apply', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/learn/apply')>();
  return {
    ...mod,
    markKnown: (itemId: string, kind: 'kana') => {
      markKnownSpy(itemId, kind);
      return mod.markKnown(itemId, kind);
    },
  };
});

// The names dictionary is another agent's data (its tables may be empty here): the page's lookup runs over a fixture table.
vi.mock('../names', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../names')>();
  const FIXTURE: import('../names').NameTable = [
    ['hana', 'ハナ', 'hana'],
    ['christopher', 'クリストファー', 'kurisutofa-'],
  ];
  return { ...mod, suggestName: (input: string) => mod.lookupName(FIXTURE, input) };
});

const ROUTE = { name: 'onboarding' } as const;

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  location.hash = '#/onboarding';
  syncRouteFromLocation();
  markKnownSpy.mockClear();
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  resetServices();
  bus.reset();
});

function mount(): void {
  act(() => render(<OnboardingPage route={ROUTE} />, root));
}

const q = <T extends Element = HTMLElement>(sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const click = (sel: string): void => {
  act(() => {
    q<HTMLButtonElement>(sel).click();
  });
};
const setInput = (input: HTMLInputElement, v: string): void => {
  act(() => {
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
/** Types (or pastes) into the English name field. */
const typeName = (v: string): void => setInput(q<HTMLInputElement>('[data-name-input]'), v);
/** Types into the kana-mode IME one key at a time (after "Type it by sound"). */
const typeBySound = (keys: string): void => {
  const input = q<HTMLInputElement>('.kana-input__field');
  for (const ch of keys) setInput(input, input.value + ch);
};
const nameValue = (): string => q<HTMLInputElement>('[data-name-input]').value;
const stepIs = (name: string): void => expect(root.querySelector('.onb')?.getAttribute('data-step')).toBe(name);

/** Answer the current kana card: correctly, wrongly, or with "Not yet". */
function answerCurrent(how: 'right' | 'wrong' | 'skip'): string {
  const id = q('[data-kana-id]').getAttribute('data-kana-id') ?? '';
  if (how === 'skip') {
    click('[data-kana-skip]');
    return id;
  }
  const card = BASIC_HIRAGANA.find((c) => c.id === id);
  if (!card) throw new Error(`unknown kana ${id}`);
  setInput(q<HTMLInputElement>('[data-kana-input]'), how === 'right' ? card.romaji : 'xx');
  click('[data-kana-check]');
  return id;
}

describe('<OnboardingPage>', () => {
  it('completing the flow patches profile and settings and navigates to the dojo', async () => {
    await makeTestStore();
    expect(store.profile.value.onboardedAt).toBeUndefined();
    mount();
    stepIs('name');
    // English by default: a plain field, the dictionary suggests the katakana, Use accepts it.
    expect(root.querySelector('.kana-input')).toBeNull();
    typeName('Hana');
    expect(q('[data-name-kana]').textContent).toBe('ハナ');
    click('[data-name-accept]');
    expect(nameValue()).toBe('ハナ');
    click('[data-next]');

    stepIs('kana');
    expect(q<HTMLButtonElement>('[data-next]').disabled).toBe(true);
    click('[data-choice="kana-none"]');
    expect(root.querySelector('[data-kana-result]')?.textContent).toContain(fmt(S.onbKanaResult, { known: 0, n: KANA_TOTAL }));
    click('[data-next]');

    stepIs('pace');
    expect(q('[data-choice="pace-standard"]').getAttribute('aria-pressed')).toBe('true');
    click('[data-next]');

    stepIs('voice');
    click('[data-theme-choice="dark"]');
    expect(store.settings.value.theme).toBe('dark');
    click('[data-next]');

    stepIs('done');
    expect(root.textContent).toContain(fmt(S.onbNameSummary, { name: 'ハナ' }));
    click('[data-finish]');

    const profile = store.profile.value;
    expect(profile.name).toBe('ハナ');
    expect(profile.nameKana).toBe('ハナ');
    expect(profile.goals.length).toBeGreaterThan(0);
    // The store's clock, so the stamp agrees with createdAt / the ledger (never Date.now in a page).
    expect(profile.onboardedAt).toBe(DEFAULT_TEST_NOW);
    const s = store.settings.value;
    expect(s.intensity).toBe('standard');
    expect(s.newPerDay).toEqual(newPerDayFor('white', 'standard'));
    expect(s.maxReviews).toBe(INTENSITY_PRESETS.standard.maxReviews);
    expect(s.retention).toBe(INTENSITY_PRESETS.standard.retention);
    expect(s.speaking).toBe('self');
    expect(s.theme).toBe('dark');
    expect(store.progress.value.station).toBe(1);
    expect(route.value.name).toBe('dojo');
    expect(markKnownSpy).not.toHaveBeenCalled();
  });

  it('finish() lifts progress.station to 1 (Nihonbashi is onboarding only) and never lowers it', async () => {
    await makeTestStore({ save: { progress: { station: 4 } } });
    mount();
    click('[data-next]');
    click('[data-choice="kana-none"]');
    click('[data-next]');
    click('[data-next]');
    click('[data-next]');
    click('[data-finish]');
    expect(store.progress.value.station).toBe(4);
    expect(store.profile.value.onboardedAt).toBe(DEFAULT_TEST_NOW);
  });

  it('a pasted 100-glyph name is cut to NAME_MAX_GLYPHS (the shared cap, in the field\'s input path) as typed and in the save', async () => {
    await makeTestStore();
    mount();
    const field = q<HTMLInputElement>('[data-name-input]');
    // The cap rides the input path, not a native attribute (code points, the same count the art tier uses).
    expect(field.getAttribute('maxlength')).toBeNull();
    const long = 'あいうえおかきくけこ'.repeat(10);
    expect(Array.from(long).length).toBe(100);
    setInput(field, long);
    expect(Array.from(nameValue()).length).toBe(NAME_MAX_GLYPHS);
    click('[data-next]');
    click('[data-choice="kana-none"]');
    click('[data-next]');
    click('[data-next]');
    click('[data-next]');
    expect(root.textContent).toContain(fmt(S.onbNameSummary, { name: long.slice(0, NAME_MAX_GLYPHS) }));
    click('[data-finish]');
    expect(Array.from(store.profile.value.nameKana).length).toBe(NAME_MAX_GLYPHS);
    expect(store.profile.value.nameKana).toBe(long.slice(0, NAME_MAX_GLYPHS));
    expect(store.profile.value.name).toBe(long.slice(0, NAME_MAX_GLYPHS));
  });

  it('a blank name trains as 無名 / むめい', async () => {
    await makeTestStore();
    mount();
    click('[data-next]');
    click('[data-choice="kana-none"]');
    click('[data-next]');
    click('[data-next]');
    click('[data-next]');
    click('[data-finish]');
    expect(store.profile.value.name).toBe('無名');
    expect(store.profile.value.nameKana).toBe('むめい');
  });

  /** Blank-name steps from the kana check to the summary. */
  const walkToSummary = (): void => {
    click('[data-choice="kana-none"]');
    click('[data-next]');
    click('[data-next]');
    click('[data-next]');
    stepIs('done');
  };

  it('a Latin name with no katakana spelling saves as the display name with nameKana empty (Latin letters never reach nameKana)', async () => {
    await makeTestStore();
    mount();
    typeName('Xylophone');
    expect(root.querySelector('[data-name-suggest]')).toBeNull();
    expect(q('[data-name-nomatch]').textContent).toContain(fmt(S.onbNameNoMatch, { name: 'Xylophone' }));
    click('[data-name-keep]');
    expect(q('[data-name-kept]').textContent).toContain(fmt(S.onbNameKeptNote, { name: 'Xylophone' }));
    click('[data-next]');
    walkToSummary();
    expect(root.textContent).toContain(fmt(S.onbNameSummary, { name: 'Xylophone' }));
    click('[data-finish]');
    expect(store.profile.value.name).toBe('Xylophone');
    expect(store.profile.value.nameKana).toBe('');
  });

  it('a Latin name left as typed (Next without choosing) saves the same way', async () => {
    await makeTestStore();
    mount();
    typeName('Christopher Bradford');
    expect(q('[data-name-kana]').textContent).toBe('クリストファー');
    // Enter with a suggestion shown accepts it; Enter again is Next.
    act(() => {
      q('[data-name-input]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(nameValue()).toBe('クリストファー');
    stepIs('name');
    click('[data-name-change]');
    expect(nameValue()).toBe('Christopher Bradford');
    typeName('Bradford');
    act(() => {
      q('[data-name-input]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    stepIs('kana');
    walkToSummary();
    click('[data-finish]');
    expect(store.profile.value.name).toBe('Bradford');
    expect(store.profile.value.nameKana).toBe('');
  });

  it('a name typed by sound saves as kana: name = nameKana = the katakana (a trailing n finalises to ン)', async () => {
    await makeTestStore();
    mount();
    typeName('Jon');
    click('[data-name-sound]');
    expect(q('.kana-input').getAttribute('data-katakana')).toBe('true');
    typeBySound('jon');
    expect(q<HTMLInputElement>('.kana-input__field').value).toBe('ジョn');
    expect(root.querySelector('[data-name-pending]')).toBeNull();
    click('[data-next]');
    walkToSummary();
    expect(root.textContent).toContain(fmt(S.onbNameSummary, { name: 'ジョン' }));
    click('[data-finish]');
    expect(store.profile.value.name).toBe('ジョン');
    expect(store.profile.value.nameKana).toBe('ジョン');
  });

  it('an English word typed into the IME (chリsトpヘr) is no longer saved as kana: name keeps the text, nameKana is empty', async () => {
    await makeTestStore();
    mount();
    typeName('Christopher');
    click('[data-name-accept]');
    click('[data-name-change]');
    typeName('Xylophone');
    click('[data-name-sound]');
    typeBySound('christopher');
    expect(q<HTMLInputElement>('.kana-input__field').value).toBe('chリsトpヘr');
    expect(q('[data-name-pending]').textContent).toBe(fmt(S.onbNamePending, { letters: 'r' }));
    click('[data-next]');
    walkToSummary();
    click('[data-finish]');
    expect(store.profile.value.name).toBe('chリsトpヘr');
    expect(store.profile.value.nameKana).toBe('');
  });

  it('Back from the kana check brings the whole name draft back (mode, accepted katakana, Change)', async () => {
    await makeTestStore();
    mount();
    typeName('Christopher');
    click('[data-name-accept]');
    click('[data-next]');
    stepIs('kana');
    click('[data-back]');
    stepIs('name');
    expect(nameValue()).toBe('クリストファー');
    expect(q('[data-name-confirm]').textContent).toContain(fmt(S.onbNameConfirm, { ja: 'クリストファー' }));
    click('[data-name-change]');
    expect(nameValue()).toBe('Christopher');
  });

  it('shows the install guide when no Japanese voice exists, and hides it when one does', async () => {
    await makeTestStore();
    mount();
    click('[data-next]');
    click('[data-choice="kana-none"]');
    click('[data-next]');
    click('[data-next]');
    stepIs('voice');
    expect(root.querySelector('[data-voice-guide]')?.textContent).toContain(S.onbVoiceNone);
    expect(root.querySelector('[data-voice-guide]')?.textContent).toContain(S.onbVoiceGuideMac);

    render(null, root);
    const speak = vi.fn(() => Promise.resolve());
    installServices({ audio: { ...nullAudio, hasJaVoice: signal(true), speak } });
    mount();
    click('[data-next]');
    click('[data-choice="kana-none"]');
    click('[data-next]');
    click('[data-next]');
    expect(root.querySelector('[data-voice-guide]')).toBeNull();
    click('[data-voice-test]');
    expect(speak).toHaveBeenCalledWith('こんにちは', { kana: 'こんにちは' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(root.textContent).toContain(S.onbVoiceHeard);
  });

  it('opting into recognition writes settings.speaking', async () => {
    await makeTestStore();
    mount();
    click('[data-next]');
    click('[data-choice="kana-none"]');
    click('[data-next]');
    click('[data-next]');
    click('[data-speech="recognition"]');
    expect(q('[data-speech="recognition"]').getAttribute('aria-checked')).toBe('true');
    click('[data-next]');
    click('[data-finish]');
    expect(store.settings.value.speaking).toBe('recognition');
  });

  it('intense shows the steady-state warning before it applies', async () => {
    await makeTestStore();
    mount();
    click('[data-next]');
    click('[data-choice="kana-none"]');
    click('[data-next]');
    stepIs('pace');
    click('[data-choice="pace-intense"]');
    const warn = q('[data-intense-warning]');
    expect(warn.textContent).toContain(fmt(S.onbPaceIntenseWarn, { n: String(steadyReviewsInAYear('intense')) }));
    expect(q('[data-choice="pace-intense"]').getAttribute('aria-pressed')).toBe('false');
    click('[data-intense-no]');
    expect(root.querySelector('[data-intense-warning]')).toBeNull();
    expect(q('[data-choice="pace-standard"]').getAttribute('aria-pressed')).toBe('true');
    click('[data-choice="pace-intense"]');
    click('[data-intense-yes]');
    expect(q('[data-choice="pace-intense"]').getAttribute('aria-pressed')).toBe('true');
    click('[data-next]');
    click('[data-next]');
    click('[data-finish]');
    expect(store.settings.value.intensity).toBe('intense');
    expect(store.settings.value.maxReviews).toBe(INTENSITY_PRESETS.intense.maxReviews);
    expect(store.settings.value.newPerDay).toEqual(newPerDayFor('white', 'intense'));
  });

  it('markKnown is called only for the kana answered correctly', async () => {
    await makeTestStore();
    mount();
    click('[data-next]');
    click('[data-choice="kana-full"]');
    expect(root.textContent).toContain(fmt(S.onbKanaProgress, { i: 1, n: KANA_TOTAL }));
    const right = [answerCurrent('right'), answerCurrent('right'), answerCurrent('right')];
    expect(root.querySelector('.onb__kana-verdict')?.getAttribute('data-ok')).toBe('true');
    answerCurrent('wrong');
    expect(root.querySelector('.onb__kana-verdict')?.getAttribute('data-ok')).toBe('false');
    answerCurrent('wrong');
    for (let i = 0; i < KANA_TOTAL - 5; i++) answerCurrent('skip');
    expect(root.querySelector('[data-kana-result]')?.textContent).toContain(fmt(S.onbKanaResult, { known: 3, n: KANA_TOTAL }));
    click('[data-next]');
    click('[data-next]');
    click('[data-next]');
    click('[data-finish]');
    expect(markKnownSpy).toHaveBeenCalledTimes(3);
    expect(markKnownSpy.mock.calls.map((c) => c[0]).sort()).toEqual([...right].sort());
    expect([...store.profile.value.kanaKnown].sort()).toEqual([...right].sort());
    expect(store.cards.count()).toBeGreaterThan(0);
  });

  it('"I read all kana" confirms with twelve tiles and sends only the misses back', async () => {
    await makeTestStore();
    mount();
    click('[data-next]');
    click('[data-choice="kana-tiles"]');
    expect(root.textContent).toContain(fmt(S.onbKanaProgress, { i: 1, n: TILE_COUNT }));
    const missedId = answerCurrent('wrong');
    for (let i = 1; i < TILE_COUNT; i++) answerCurrent('right');
    const result = q('[data-kana-result]');
    expect(result.textContent).toContain(fmt(S.onbKanaResult, { known: KANA_TOTAL - 1, n: KANA_TOTAL }));
    const missedKana = BASIC_HIRAGANA.find((c) => c.id === missedId)?.kana ?? '';
    expect(q('[data-sent-back]').textContent).toContain(missedKana);
    click('[data-next]');
    click('[data-next]');
    click('[data-next]');
    click('[data-finish]');
    expect(markKnownSpy).toHaveBeenCalledTimes(KANA_TOTAL - 1);
    expect(store.profile.value.kanaKnown).not.toContain(missedId);
  });

  it('Enter in the kana field checks the answer', async () => {
    await makeTestStore();
    mount();
    click('[data-next]');
    click('[data-choice="kana-full"]');
    const id = q('[data-kana-id]').getAttribute('data-kana-id');
    const card = BASIC_HIRAGANA.find((c) => c.id === id)!;
    const input = q<HTMLInputElement>('[data-kana-input]');
    setInput(input, card.romaji);
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(root.textContent).toContain(fmt(S.onbKanaProgress, { i: 2, n: KANA_TOTAL }));
    expect(root.querySelector('.onb__kana-verdict')?.getAttribute('data-ok')).toBe('true');
  });

  it('without an estimate the ROAD_DAYS table is the fallback: hours and months differ per preset', () => {
    const casual = hoursInApp('casual');
    const standard = hoursInApp('standard');
    const intense = hoursInApp('intense');
    expect(casual).toBeLessThan(standard);
    expect(standard).toBeLessThan(intense);
    expect(standard).toBeGreaterThan(380);
    expect(standard).toBeLessThan(480);
    expect(casual).toBeGreaterThan(250);
    expect(intense).toBeLessThan(760);
    expect(roadMonths('standard').full).toBe(22);
    expect(roadMonths('standard').partial).toBe(31);
    expect(roadMonths('casual').full).toBeGreaterThan(roadMonths('standard').full);
    expect(roadMonths('intense').full).toBeLessThan(roadMonths('standard').full);
    expect(beltAfterDays('intense', 365)).toBe('black');
    expect(steadyReviewsInAYear('intense')).toBe(400);
    expect(roadDays('standard', null)).toEqual(ROAD_DAYS);
    expect(roadDays('casual', undefined).white).toBeGreaterThan(ROAD_DAYS.white);
  });

  it('the road derives from the store estimate for every belt: the White duration follows it, not ROAD_DAYS.white', async () => {
    await makeTestStore();
    const est = roadEstimateFor('standard');
    expect(est).not.toBeNull();
    // Same basis as the Records projection: the live settings with the preset's intensity and White mix.
    const settings = { ...store.settings.value, intensity: 'standard' as const, newPerDay: newPerDayFor('white', 'standard') };
    expect(est).toEqual(onboardingEstimate(settings, store.today(), 1));
    const white = est!.byBelt.find((b) => b.belt === 'white')!;
    expect(white.days).toBe(Math.ceil(80 / 4 + 3));
    expect(white.days).not.toBe(ROAD_DAYS.white);
    // Every belt's days come from the estimate.
    const days = roadDays('standard', est);
    for (const b of est!.byBelt) expect(days[b.belt]).toBe(b.days);
    expect(beltAfterDays('standard', white.days - 1, est)).toBe('white');
    expect(beltAfterDays('standard', white.days, est)).toBe('yellow');
    // Months and hours are the estimate's, per preset.
    expect(roadMonths('standard', est)).toEqual({ full: Math.round(est!.days100 / 30.44), partial: Math.round(est!.days70 / 30.44) });
    expect(hoursInApp('standard', est)).toBe(est!.hoursInApp);
    const casual = roadEstimateFor('casual')!;
    const intense = roadEstimateFor('intense')!;
    expect(roadMonths('casual', casual).full).toBeGreaterThan(roadMonths('standard', est).full);
    expect(roadMonths('intense', intense).full).toBeLessThan(roadMonths('standard', est).full);
    expect(roadDays('casual', casual).white).toBeGreaterThan(white.days);

    mount();
    click('[data-next]');
    click('[data-choice="kana-none"]');
    click('[data-next]');
    expect(q('[data-hours]').textContent).toContain(String(est!.hoursInApp));
    expect(q('[data-months]').textContent).toBe(fmt(S.onbMonthsValue, roadMonths('standard', est)));
    click('[data-choice="pace-casual"]');
    expect(q('[data-hours]').textContent).toContain(String(casual.hoursInApp));
    expect(q('[data-months]').textContent).toBe(fmt(S.onbMonthsValue, roadMonths('casual', casual)));
    expect(root.textContent).toContain(fmt(S.onbPaceReviews, { n: num(steadyReviewsInAYear('casual', casual)) }));
  });

  it('kanaMatches accepts Hepburn, kunrei, lone n, wo and typed kana', () => {
    expect(kanaMatches('shi', 'し')).toBe(true);
    expect(kanaMatches('si', 'し')).toBe(true);
    expect(kanaMatches('TSU', 'つ')).toBe(true);
    expect(kanaMatches('tu', 'つ')).toBe(true);
    expect(kanaMatches('n', 'ん')).toBe(true);
    expect(kanaMatches('wo', 'を')).toBe(true);
    expect(kanaMatches('fu', 'ふ')).toBe(true);
    expect(kanaMatches('hu', 'ふ')).toBe(true);
    expect(kanaMatches('ふ', 'ふ')).toBe(true);
    expect(kanaMatches('ka', 'き')).toBe(false);
    expect(kanaMatches('', 'あ')).toBe(false);
    expect(kanaMatches('   ', 'あ')).toBe(false);
  });

  it('the inventory is the 46 basic hiragana with IME-safe ids', () => {
    expect(BASIC_HIRAGANA.length).toBe(46);
    expect(new Set(BASIC_HIRAGANA.map((c) => c.id)).size).toBe(46);
    expect(new Set(BASIC_HIRAGANA.map((c) => c.kana)).size).toBe(46);
    expect(BASIC_HIRAGANA.find((c) => c.kana === 'を')?.id).toBe('k-h-wo');
    expect(BASIC_HIRAGANA.find((c) => c.kana === 'ん')?.id).toBe('k-h-n');
    for (const c of BASIC_HIRAGANA) expect(kanaMatches(c.romaji, c.kana), c.id).toBe(true);
  });

  it('Back returns to the previous step and keeps the kana result', async () => {
    await makeTestStore();
    mount();
    click('[data-next]');
    click('[data-choice="kana-none"]');
    click('[data-next]');
    stepIs('pace');
    click('[data-back]');
    stepIs('kana');
    expect(root.querySelector('[data-kana-result]')).not.toBeNull();
    expect(q<HTMLButtonElement>('[data-next]').disabled).toBe(false);
  });
});
