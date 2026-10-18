import { effect, signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { Belt } from '@/content/types';
import { installServices, nullAudio, resetServices, servicesVersion, type AudioPackInfo, type AudioSource, type ClipPlayer, type ClipReady, type VoiceInfo } from '@/shared/audio';
import { bus } from '@/shared/events';
import { route, syncRouteFromLocation } from '@/shared/routes';
import type { Settings } from '@/shared/store-types';
import { INTENSITY_PRESETS, newPerDayFor, resetStoreForTests, store } from '@/store';
import { DEFAULT_TEST_NOW, makeTestStore, card } from '@/store/testing';
import SettingsPage, { applyFeel, dataSaverEffective, formatBytes, japaneseVoices, kbOf, packInfo, packSpeaks, parseTime, resetDataSaverAutoForTests, saveDataRequested } from './SettingsPage';
import { S as SS } from './settings-strings';
import { S, fmt } from './strings';

/** Counts the store's `resetSave` calls: the danger zone must delegate to it, not run a wipe of its own. */
const resetSpy = vi.hoisted(() => vi.fn());
vi.mock('@/store', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/store')>();
  return {
    ...mod,
    resetSave: () => {
      resetSpy();
      mod.resetSave();
    },
  };
});

const ROUTE = { name: 'settings' } as const;

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  location.hash = '#/settings';
  syncRouteFromLocation();
  resetSpy.mockClear();
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  resetServices();
  resetDataSaverAutoForTests();
  vi.useRealTimers();
  bus.reset();
});

function mount(download?: (text: string, filename: string) => boolean): void {
  act(() => render(<SettingsPage route={ROUTE} download={download} />, root));
}

const q = <T extends Element = HTMLElement>(sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const settings = (): Settings => store.settings.value;

function radio(name: string, value: string): void {
  act(() => {
    q<HTMLInputElement>(`input[data-setting="${name}"][value="${value}"]`).click();
  });
}
function toggle(name: string): void {
  act(() => {
    q<HTMLInputElement>(`input[data-setting="${name}"]`).click();
  });
}
function select(name: string, value: string): void {
  act(() => {
    const el = q<HTMLSelectElement>(`select[data-setting="${name}"]`);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function numberInput(name: string, value: string): void {
  act(() => {
    const el = q<HTMLInputElement>(`input[data-setting="${name}"]`);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function rangeInput(name: string, value: string): void {
  act(() => {
    const el = q<HTMLInputElement>(`input[data-setting="${name}"]`);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('<SettingsPage>', () => {
  it('each radio and switch patches the matching settings key', async () => {
    await makeTestStore();
    mount();
    radio('theme', 'dark');
    expect(settings().theme).toBe('dark');
    radio('feel', 'arcade');
    expect(settings().feel).toBe('arcade');
    radio('speaking', 'recognition');
    expect(settings().speaking).toBe('recognition');
    radio('speaking', 'off');
    expect(settings().speaking).toBe('off');
    toggle('classicGrading');
    expect(settings().classicGrading).toBe(true);
    toggle('jj');
    expect(settings().jj).toBe(true);
    toggle('writing');
    expect(settings().writing).toBe(true);
    toggle('verticalText');
    expect(settings().verticalText).toBe(true);
    toggle('reducedMotion');
    expect(settings().reducedMotion).toBe(true);
    toggle('crt');
    expect(settings().crt).toBe(true);
    toggle('speedGrading');
    expect(settings().speedGrading).toBe(false);
  });

  it('selects, numbers and the range patch their keys', async () => {
    await makeTestStore();
    const setVolume = vi.fn();
    installServices({ audio: { ...nullAudio, setVolume } });
    mount();
    select('furigana', 'tap');
    expect(settings().furigana).toBe('tap');
    select('retention', '0.95');
    expect(settings().retention).toBe(0.95);
    select('speedTier', '4');
    expect(settings().speedTier).toBe(4);
    select('restDay', '0');
    expect(settings().restDay).toBe(0);
    select('restDay', '');
    expect(settings().restDay).toBeNull();
    rangeInput('sound', '40');
    expect(settings().sound).toBeCloseTo(0.4);
    expect(setVolume).toHaveBeenCalledWith(0.4);
    numberInput('newPerDay.vocab', '9.5');
    expect(settings().newPerDay.vocab).toBe(9.5);
    expect(settings().intensity).toBe('custom');
    numberInput('maxReviews', '220');
    expect(settings().maxReviews).toBe(220);
    numberInput('maxReviews', '3');
    expect(settings().maxReviews).toBe(220);
  });

  it('theme radios (design 09 §7 G, §8): four options each with a live swatch holding a tiny status window, washi and lacquer among them; Follow the sky patches theme: sky and is explained once', async () => {
    await makeTestStore();
    mount();
    const swatches = root.querySelectorAll('.theme-swatch');
    expect(swatches.length).toBe(4);
    expect(Array.from(swatches, (el) => el.getAttribute('data-swatch'))).toEqual(['auto', 'light', 'dark', 'sky']);
    for (const el of Array.from(swatches)) {
      expect(el.getAttribute('aria-hidden')).toBe('true');
      expect(el.querySelector('.status-window.theme-swatch__frame')).not.toBeNull();
    }
    expect(q('.theme-swatch[data-swatch="light"]').closest('label')?.querySelector('input')?.value).toBe('light');
    expect(q('.theme-swatch[data-swatch="dark"]').closest('label')?.querySelector('input')?.value).toBe('dark');
    expect(q<HTMLInputElement>('input[data-setting="theme"][value="sky"]').checked).toBe(false);
    expect(q('[data-theme-hint]').textContent).toBe(SS.setThemeSkyHint);
    expect(root.querySelectorAll('[data-theme-hint]').length).toBe(1);
    // the hint is read to the radiogroup, not only shown beside it
    expect(q('#theme-hint').hasAttribute('data-theme-hint')).toBe(true);
    expect(q('[role="radiogroup"][aria-label="' + S.setTheme + '"]').getAttribute('aria-describedby')).toBe('theme-hint');
    expect(q('[role="radiogroup"][aria-label="' + S.setFeel + '"]').hasAttribute('aria-describedby')).toBe(false);
    expect(SS.setThemeSkyHint.split(/[.!?](\s|$)/).filter((x) => x.trim()).length).toBe(1); // one sentence (09 §8: explained once, one line)
    radio('theme', 'sky');
    expect(settings().theme).toBe('sky');
    expect(q<HTMLInputElement>('input[data-setting="theme"][value="sky"]').checked).toBe(true);
    radio('theme', 'auto');
    expect(settings().theme).toBe('auto');
  });

  it('CRT is disabled outside the Arcade feel', async () => {
    await makeTestStore();
    mount();
    expect(q<HTMLInputElement>('input[data-setting="crt"]').disabled).toBe(true);
    radio('feel', 'arcade');
    expect(q<HTMLInputElement>('input[data-setting="crt"]').disabled).toBe(false);
  });

  it('feel change applies the speed-grading default: off in Zen, on otherwise', async () => {
    await makeTestStore();
    mount();
    radio('feel', 'zen');
    expect(settings().feel).toBe('zen');
    expect(settings().speedGrading).toBe(false);
    radio('feel', 'dojo');
    expect(settings().speedGrading).toBe(true);
    applyFeel('dojo');
    expect(settings().speedGrading).toBe(true);
  });

  it('a preset applies rates for the current belt, the cap and retention', async () => {
    await makeTestStore({ save: { profile: { belt: 'green' } } });
    mount();
    radio('intensity', 'casual');
    expect(settings().intensity).toBe('casual');
    expect(settings().newPerDay).toEqual(newPerDayFor('green', 'casual'));
    expect(settings().maxReviews).toBe(INTENSITY_PRESETS.casual.maxReviews);
    expect(settings().retention).toBe(INTENSITY_PRESETS.casual.retention);
    radio('intensity', 'custom');
    expect(settings().intensity).toBe('custom');
    expect(settings().newPerDay).toEqual(newPerDayFor('green', 'casual'));
  });

  it('intense confirms before applying', async () => {
    await makeTestStore();
    mount();
    radio('intensity', 'intense');
    expect(settings().intensity).toBe('standard');
    const dialog = q('[data-confirm="intense"]');
    expect(dialog.textContent).toContain('reviews a day in a year');
    act(() => {
      q<HTMLButtonElement>('[data-confirm-no]').click();
    });
    expect(root.querySelector('[data-confirm="intense"]')).toBeNull();
    expect(settings().intensity).toBe('standard');
    expect(q<HTMLInputElement>('input[data-setting="intensity"][value="standard"]').checked).toBe(true);
    radio('intensity', 'intense');
    act(() => {
      q<HTMLButtonElement>('[data-confirm-yes]').click();
    });
    expect(settings().intensity).toBe('intense');
    expect(settings().maxReviews).toBe(INTENSITY_PRESETS.intense.maxReviews);
  });

  it('Escape closes the confirm dialog without applying', async () => {
    await makeTestStore();
    mount();
    radio('intensity', 'intense');
    act(() => {
      q('[data-confirm="intense"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(root.querySelector('[data-confirm="intense"]')).toBeNull();
    expect(settings().intensity).toBe('standard');
  });

  it('the Intense confirm manages focus: Cancel first, Tab wraps, Escape returns focus to the opener radio', async () => {
    await makeTestStore();
    mount();
    const opener = q<HTMLInputElement>('input[data-setting="intensity"][value="intense"]');
    act(() => opener.focus());
    radio('intensity', 'intense');
    const dialog = q('[data-confirm="intense"]');
    const yes = q<HTMLButtonElement>('[data-confirm-yes]');
    const no = q<HTMLButtonElement>('[data-confirm-no]');
    expect(dialog.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(no);
    act(() => {
      no.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(yes);
    act(() => {
      yes.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(no);
    act(() => {
      no.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(root.querySelector('[data-confirm="intense"]')).toBeNull();
    expect(settings().intensity).toBe('standard');
    expect(document.activeElement).toBe(opener);
  });

  it('the Reset confirm opens with focus on Cancel and hands focus back to the Reset button when cancelled', async () => {
    await makeTestStore();
    mount();
    const input = q<HTMLInputElement>('.set__danger .kana-input__field');
    for (const ch of 'tsuduku') {
      act(() => {
        input.value = input.value + ch;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    const button = q<HTMLButtonElement>('[data-reset]');
    act(() => button.focus());
    act(() => button.click());
    const dialog = q('[data-confirm="reset"]');
    expect(document.activeElement).toBe(q('[data-confirm-no]'));
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(root.querySelector('[data-confirm="reset"]')).toBeNull();
    expect(store.profile.value.xp).toBe(0);
    expect(document.activeElement).toBe(q('[data-reset]'));
  });

  it('storage meter shows bytes and level', async () => {
    await makeTestStore();
    mount();
    const bytes = store.storage.value.bytes;
    expect(bytes).toBeGreaterThan(0);
    expect(q('[data-storage]').getAttribute('data-level')).toBe('ok');
    expect(q('[data-storage-text]').textContent).toContain(`${kbOf(bytes).toLocaleString('en-US')} KB`);
    expect(q('[data-storage-text]').textContent).toContain(S.setStorageLevelOk);
    act(() => {
      store.storage.value = { bytes: 4 * 1024 * 1024, level: 'warn' };
    });
    expect(q('[data-storage]').getAttribute('data-level')).toBe('warn');
    expect(q('[data-storage-text]').textContent).toContain('4,096 KB');
    expect(q('[data-storage-text]').textContent).toContain(S.setStorageLevelWarn);
    act(() => {
      store.storage.value = { bytes: 4.6 * 1024 * 1024, level: 'ceiling' };
    });
    expect(q('[data-storage-text]').textContent).toContain(S.setStorageLevelCeiling);
    expect(q('[data-slot]').textContent?.trim()).toBe(S.setSlotHint);
    expect(q('[data-slot]').textContent).not.toMatch(/slot 0|Three slots/i);
  });

  it('voice picker lists Japanese voices with their network mark and patches ttsVoiceURI', async () => {
    await makeTestStore();
    const voices: VoiceInfo[] = [
      { uri: 'v-local', name: 'Kyoko', lang: 'ja-JP', local: true, network: false },
      { uri: 'v-net', name: 'Cloud', lang: 'ja-JP', local: false, network: true },
      { uri: 'v-en', name: 'Samantha', lang: 'en-US', local: true, network: false },
    ];
    const speak = vi.fn(() => Promise.resolve());
    installServices({ audio: { ...nullAudio, voices: () => voices, hasJaVoice: signal(true), speak } });
    expect(japaneseVoices(voices).map((v) => v.uri)).toEqual(['v-local', 'v-net']);
    mount();
    const options = Array.from(q<HTMLSelectElement>('select[data-setting="ttsVoiceURI"]').options).map((o) => o.textContent);
    expect(options).toEqual([S.setVoiceDefault, `Kyoko · ${S.setVoiceLocal}`, `Cloud · ${S.setVoiceNetwork}`]);
    select('ttsVoiceURI', 'v-net');
    expect(settings().ttsVoiceURI).toBe('v-net');
    select('ttsVoiceURI2', 'v-local');
    expect(settings().ttsVoiceURI2).toBe('v-local');
    act(() => {
      q<HTMLButtonElement>('[data-voice-test]').click();
    });
    expect(speak).toHaveBeenCalledWith('こんにちは', { kana: 'こんにちは', voiceURI: 'v-net' });
    select('ttsVoiceURI', '');
    expect(settings().ttsVoiceURI).toBeUndefined();
  });

  it('voices that arrive after mount (voiceschanged) fill the pickers once hasJaVoice flips', async () => {
    await makeTestStore();
    let list: VoiceInfo[] = [];
    const hasJaVoice = signal(false);
    installServices({ audio: { ...nullAudio, voices: () => list, hasJaVoice } });
    mount();
    expect(Array.from(q<HTMLSelectElement>('select[data-setting="ttsVoiceURI"]').options).map((o) => o.textContent)).toEqual([S.setVoiceNone]);
    act(() => {
      list = [{ uri: 'v-local', name: 'Kyoko', lang: 'ja-JP', local: true, network: false }];
      hasJaVoice.value = true;
    });
    const options = Array.from(q<HTMLSelectElement>('select[data-setting="ttsVoiceURI"]').options).map((o) => o.textContent);
    expect(options).toEqual([S.setVoiceDefault, `Kyoko · ${S.setVoiceLocal}`]);
  });

  it('the pace hint describes the chosen preset; the review-cap hint appears only under the cap', async () => {
    await makeTestStore({ save: { settings: { intensity: 'standard' } } });
    mount();
    expect(q('[data-pace-hint]').textContent).toBe(S.onbPaceStandardDesc);
    expect(root.textContent!.split(S.setMaxReviewsHint).length - 1).toBe(1);
    radio('intensity', 'casual');
    expect(q('[data-pace-hint]').textContent).toBe(S.onbPaceCasualDesc);
    radio('intensity', 'custom');
    expect(q('[data-pace-hint]').textContent).toBe(S.setCustomHint);
  });

  it('with no Japanese voice the picker says so', async () => {
    await makeTestStore();
    mount();
    expect(Array.from(q<HTMLSelectElement>('select[data-setting="ttsVoiceURI"]').options).map((o) => o.textContent)).toEqual([S.setVoiceNone]);
  });

  it('reminder download builds a neutral daily .ics at the chosen time', async () => {
    await makeTestStore({ save: { profile: { tz: 'Asia/Tokyo' } } });
    const download = vi.fn(() => true);
    mount(download);
    act(() => {
      const t = q<HTMLInputElement>('[data-reminder-time]');
      t.value = '07:30';
      t.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      q<HTMLButtonElement>('[data-ics-download]').click();
    });
    expect(download).toHaveBeenCalledTimes(1);
    const [text, filename] = download.mock.calls[0] as unknown as [string, string];
    expect(filename).toBe('tsuzuku-reminder.ics');
    expect(text).toContain('SUMMARY:The dojo is open.');
    expect(text).toContain('RRULE:FREQ=DAILY');
    expect(text).toContain('DTSTART;TZID=Asia/Tokyo:20260115T073000');
    expect(root.textContent).toContain(S.setReminderDownloaded);
  });

  it('shows the calendar text when a download is not possible', async () => {
    await makeTestStore();
    mount(() => false);
    act(() => {
      q<HTMLButtonElement>('[data-ics-download]').click();
    });
    expect(root.textContent).toContain(S.setReminderFailed);
    expect(q('[data-ics-text]').textContent).toContain('BEGIN:VCALENDAR');
  });

  it('parseTime clamps and falls back', () => {
    expect(parseTime('07:30')).toEqual({ hour: 7, minute: 30 });
    expect(parseTime('25:99')).toEqual({ hour: 23, minute: 59 });
    expect(parseTime('nonsense')).toEqual({ hour: 19, minute: 0 });
  });

  it('reset requires typing つづく, confirms, then replaces the save and goes to onboarding', async () => {
    await makeTestStore({
      save: { profile: { name: 'はな', xp: 900, tz: 'Asia/Tokyo' }, streak: { totalDays: 30, current: 4 }, stats: { sessions: 12 } },
      cards: { 'v-n5-0001#rec': card({ due: 1, s: 3, state: 2 }) },
    });
    store.session.save({
      schema: 'tsuzuku.session/1',
      plan: { id: 'p', mode: 'kata', day: 1, createdAt: 0, station: 1, steps: [], blocks: [], meta: { dueTotal: 0, dueTaken: 0, backlog: false, newCount: 0, scrollIds: [] } },
      cursor: 0,
      results: [],
      kiai: { ki: 0, combo: 0, bestCombo: 0, kiaiLeft: 0, ippon: 0, recoveryQueue: [] },
    });
    mount();
    const button = q<HTMLButtonElement>('[data-reset]');
    expect(button.disabled).toBe(true);
    const input = q<HTMLInputElement>('.set__danger .kana-input__field');
    for (const ch of 'tsudu') {
      act(() => {
        input.value = input.value + ch;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    expect(root.textContent).toContain(S.setResetMismatch);
    expect(q<HTMLButtonElement>('[data-reset]').disabled).toBe(true);
    for (const ch of 'ku') {
      act(() => {
        input.value = input.value + ch;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    expect(input.value).toBe('つづく');
    expect(q<HTMLButtonElement>('[data-reset]').disabled).toBe(false);
    act(() => {
      q<HTMLButtonElement>('[data-reset]').click();
    });
    expect(q('[data-confirm="reset"]')).toBeDefined();
    expect(resetSpy).not.toHaveBeenCalled();
    // One batched write: an effect over three slices and the card version runs once for the whole wipe.
    let runs = 0;
    const dispose = effect(() => {
      void store.profile.value;
      void store.streak.value;
      void store.stats.value;
      void store.cards.version.value;
      runs++;
    });
    expect(runs).toBe(1);
    act(() => {
      q<HTMLButtonElement>('[data-confirm-yes]').click();
    });
    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(runs).toBe(2);
    dispose();
    expect(store.profile.value.name).toBe('無名');
    expect(store.profile.value.xp).toBe(0);
    expect(store.profile.value.tz).toBe('Asia/Tokyo');
    expect(store.streak.value.totalDays).toBe(0);
    expect(store.stats.value.sessions).toBe(0);
    expect(store.cards.count()).toBe(0);
    expect(store.session.load()).toBeNull();
    expect(route.value.name).toBe('onboarding');
  });

  it('the confirmed reset keeps the time zone and clears cards, the log ring and the seed/createdAt header (the store wipe, through the page)', async () => {
    let t = DEFAULT_TEST_NOW;
    await makeTestStore({ now: () => t, save: { profile: { tz: 'Europe/Paris', xp: 5 } }, cards: { 'k-h-a#rec': card({ due: 1 }) } });
    store.log.push([1000, 'k-h-a#rec', 3, 900, 0, 0]);
    const oldSeed = store.seed();
    const oldCreated = store.meta().createdAt;
    expect(store.log.recent(10).length).toBe(1);
    t += 60_000;
    mount();
    const input = q<HTMLInputElement>('.set__danger .kana-input__field');
    for (const ch of 'tsuduku') {
      act(() => {
        input.value = input.value + ch;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    act(() => {
      q<HTMLButtonElement>('[data-reset]').click();
    });
    act(() => {
      q<HTMLButtonElement>('[data-confirm-yes]').click();
    });
    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain(S.setResetDone);
    expect(store.profile.value.tz).toBe('Europe/Paris');
    expect(store.profile.value.xp).toBe(0);
    expect(store.cards.count()).toBe(0);
    expect(store.log.recent(10)).toEqual([]);
    // A fresh save is a different learner: seeded art must not reproduce the previous one.
    expect(store.seed()).not.toBe(oldSeed);
    expect(store.seed()).toMatch(/^[0-9a-f]{16}$/);
    expect(store.meta().createdAt).toBe(t);
    expect(store.meta().createdAt).not.toBe(oldCreated);
  });
});

/* ── 音声パック voice pack card (design 08 §13) ────────────────────────────── */

const MB = 1024 * 1024;
const INFO: AudioPackInfo = {
  audioVersion: 'a-0123456789',
  contentVersion: 'c-031e32624e',
  engine: 'VOICEVOX 0.25.2',
  belts: { white: { bytes: 12 * MB, seconds: 540, files: 4 }, yellow: { bytes: 38 * MB, seconds: 3000, files: 20 } },
  totals: { bytes: 490 * MB, seconds: 80_000, files: 400 },
  credits: ['VOICEVOX:九州そら', 'VOICEVOX:玄野武宏'],
};

/** A `ClipPlayer` double: `download` reports 19 of 38 MB synchronously, then resolves. */
function fakeClips(ready: ClipReady, info: AudioPackInfo | null, usageBytes = 0) {
  const download = vi.fn((_belt: Belt, onProgress?: (done: number, total: number) => void): Promise<void> => {
    onProgress?.(19 * MB, 38 * MB);
    return Promise.resolve();
  });
  const remove = vi.fn((): Promise<void> => Promise.resolve());
  const cacheUsage = vi.fn(() => Promise.resolve({ bytes: usageBytes, files: 3 }));
  const clips: ClipPlayer = {
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
    cacheUsage,
    download,
    remove,
  };
  return { clips, download, remove, cacheUsage };
}

const flush = (): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

describe('<SettingsPage> 音声パック voice pack (design 08 §13)', () => {
  it('renders real sizes from the manifest and the cache usage, one row per belt, and says synthetic — never "recorded voice"', async () => {
    await makeTestStore({ save: { profile: { belt: 'yellow' } } });
    const { clips, cacheUsage } = fakeClips('ready', INFO, 7.5 * MB);
    installServices({ audio: { ...nullAudio, clips } });
    mount();
    await flush();
    const cardEl = q('[data-voice-pack]');
    expect(cardEl.getAttribute('data-pack-state')).toBe('ready');
    expect(cacheUsage).toHaveBeenCalled();
    expect(q('[data-pack-sizes]').textContent).toBe(fmt(S.setPackSizes, { belt: '38 MB', all: '490 MB', device: '7.5 MB' }));
    expect(Array.from(root.querySelectorAll('[data-pack-belt]')).map((li) => li.getAttribute('data-pack-belt'))).toEqual(['white', 'yellow']);
    const yellow = q('[data-pack-belt="yellow"]');
    expect(yellow.querySelector('[lang="ja"]')?.textContent).toBe('黄帯');
    expect(yellow.textContent).toContain('Yellow');
    expect(yellow.textContent).toContain('38 MB');
    expect(yellow.textContent).toContain('50 min');
    expect(cardEl.querySelector('h3 [lang="ja"]')?.textContent).toBe(S.setPackTitleJa);
    expect(cardEl.textContent).toContain(S.setPackTitle);
    expect(cardEl.textContent).toMatch(/synthetic/i);
    expect(cardEl.textContent).toContain('VOICEVOX');
    expect(cardEl.textContent).not.toMatch(/recorded/i);
    expect(cardEl.textContent).toContain(S.setPackSafari);
    expect(root.querySelector('[data-pack-none]')).toBeNull();
    expect(packInfo(clips)).toBe(INFO);
  });

  it('Download calls clips.download(belt) with a progress callback, shows the bar, then re-reads the cache usage', async () => {
    await makeTestStore({ save: { profile: { belt: 'yellow' } } });
    const { clips, download, cacheUsage } = fakeClips('ready', INFO, 0);
    installServices({ audio: { ...nullAudio, clips } });
    mount();
    await flush();
    const before = cacheUsage.mock.calls.length;
    act(() => {
      q<HTMLButtonElement>('[data-pack-download="yellow"]').click();
    });
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0]![0]).toBe('yellow');
    expect(typeof download.mock.calls[0]![1]).toBe('function');
    // 19 of 38 MB reported synchronously: the bar reads 50 % and every other button waits.
    const bar = q('[data-pack-belt="yellow"] [data-pack-progress]');
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect(bar.classList.contains('progress--ai')).toBe(true); // a download is indigo (components.css .progress--ai), not XP gold
    expect(q('[data-pack-belt="yellow"]').getAttribute('data-busy')).toBe('true');
    expect(q<HTMLButtonElement>('[data-pack-download="white"]').disabled).toBe(true);
    expect(q('[data-pack-note]').textContent).toBe(fmt(S.setPackDownloading, { belt: 'Yellow', pct: 50 }));
    await flush();
    expect(root.querySelector('[data-pack-progress]')).toBeNull();
    expect(q('[data-pack-note]').textContent).toBe(fmt(S.setPackDownloaded, { belt: 'Yellow' }));
    expect(cacheUsage.mock.calls.length).toBeGreaterThan(before);
    expect(q<HTMLButtonElement>('[data-pack-download="white"]').disabled).toBe(false);
  });

  it('Remove calls clips.remove(belt) and says so; a failed download leaves the card usable and says so', async () => {
    await makeTestStore({ save: { profile: { belt: 'yellow' } } });
    const { clips, download, remove } = fakeClips('ready', INFO, 0);
    installServices({ audio: { ...nullAudio, clips } });
    mount();
    await flush();
    act(() => {
      q<HTMLButtonElement>('[data-pack-remove="white"]').click();
    });
    expect(remove).toHaveBeenCalledWith('white');
    await flush();
    expect(q('[data-pack-note]').textContent).toBe(fmt(S.setPackRemoved, { belt: 'White' }));

    download.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    act(() => {
      q<HTMLButtonElement>('[data-pack-download="white"]').click();
    });
    await flush();
    expect(q('[data-pack-note]').textContent).toBe(S.setPackFailed);
    expect(root.querySelector('[data-pack-progress]')).toBeNull();
    expect(q<HTMLButtonElement>('[data-pack-download="white"]').disabled).toBe(false);
  });

  it('without a pack the card says the device voice speaks: the probe found none, or the real service came without a player; while a probe runs it only says it is looking (then the sizes arrive live)', async () => {
    await makeTestStore();
    const absent = fakeClips('absent', null);
    installServices({ audio: { ...nullAudio, clips: absent.clips } });
    mount();
    expect(q('[data-voice-pack]').getAttribute('data-pack-state')).toBe('absent');
    expect(q('[data-pack-none]').textContent).toBe(S.setPackNone);
    expect(root.querySelector('[data-pack-sizes]')).toBeNull();
    expect(root.querySelector('[data-pack-loading]')).toBeNull();
    expect(absent.cacheUsage).not.toHaveBeenCalled();
    expect(packInfo(undefined)).toBeNull();

    // The real audio service installed without a player: a build with no pack, settled at once.
    render(null, root);
    installServices({ audio: { ...nullAudio, setVolume: vi.fn() } });
    mount();
    expect(q('[data-voice-pack]').getAttribute('data-pack-state')).toBe('absent');
    expect(q('[data-pack-none]').textContent).toBe(S.setPackNone);

    render(null, root);
    const probing = fakeClips('loading', null, 3 * MB);
    installServices({ audio: { ...nullAudio, clips: probing.clips } });
    mount();
    expect(q('[data-voice-pack]').getAttribute('data-pack-state')).toBe('probing');
    expect(q('[data-pack-loading]').textContent).toBe(S.setPackLoading);
    expect(root.querySelector('[data-pack-none]')).toBeNull();
    expect(probing.cacheUsage).not.toHaveBeenCalled();
    act(() => {
      probing.clips.info.value = INFO;
      probing.clips.ready.value = 'ready';
    });
    await flush();
    expect(q('[data-voice-pack]').getAttribute('data-pack-state')).toBe('ready');
    expect(q('[data-pack-sizes]').textContent).toBe(fmt(S.setPackSizes, { belt: '12 MB', all: '490 MB', device: '3 MB' }));
  });

  it('a cold load (audio services not installed yet) says it is looking, then shows the sizes the moment the service lands: the slot’s version signal re-renders the page — no poll, no interval', async () => {
    await makeTestStore({ save: { profile: { belt: 'yellow' } } });
    const intervals = vi.spyOn(globalThis, 'setInterval');
    servicesVersion.value = 0; // nullAudio: main.tsx has not installed the audio barrel yet
    mount();
    expect(q('[data-voice-pack]').getAttribute('data-pack-state')).toBe('probing');
    expect(q('[data-pack-loading]').textContent).toBe(S.setPackLoading);
    expect(root.querySelector('[data-pack-none]')).toBeNull();
    const { clips, cacheUsage } = fakeClips('ready', INFO, 7.5 * MB);
    act(() => {
      installServices({ audio: { ...nullAudio, clips } });
    });
    await flush();
    expect(q('[data-voice-pack]').getAttribute('data-pack-state')).toBe('ready');
    expect(q('[data-pack-sizes]').textContent).toBe(fmt(S.setPackSizes, { belt: '38 MB', all: '490 MB', device: '7.5 MB' }));
    expect(cacheUsage).toHaveBeenCalled();
    expect(intervals).not.toHaveBeenCalled();
    intervals.mockRestore();

    // Once anything has been installed or reset the question is settled: an empty slot is a build with no pack.
    render(null, root);
    resetServices();
    expect(servicesVersion.value).toBeGreaterThan(0);
    mount();
    expect(q('[data-voice-pack]').getAttribute('data-pack-state')).toBe('absent');
    expect(q('[data-pack-none]').textContent).toBe(S.setPackNone);
    expect(root.querySelector('[data-pack-loading]')).toBeNull();
  });

  it('a pack that carries nothing for the learner’s belt says so instead of a false 0 MB', async () => {
    await makeTestStore({ save: { profile: { belt: 'green' } } });
    const { clips } = fakeClips('ready', INFO, 3 * MB);
    installServices({ audio: { ...nullAudio, clips } });
    mount();
    await flush();
    expect(q('[data-pack-sizes]').textContent).toBe(fmt(S.setPackSizesNoBelt, { all: '490 MB', device: '3 MB' }));
    expect(q('[data-pack-sizes]').textContent).not.toMatch(/Your belt: 0 MB/);
    expect(Array.from(root.querySelectorAll('[data-pack-belt]')).map((li) => li.getAttribute('data-pack-belt'))).toEqual(['white', 'yellow']);
  });

  it('the device-voice picker reads the pack too: no device voice but a speaking pack (source clips) says the pack speaks, never a bare "no voice"; a ready pack the learner has not chosen is the device voice; neither present says no voice', async () => {
    await makeTestStore();
    installServices({ audio: { ...nullAudio, hasJaVoice: signal(false), packReady: signal(true), source: signal<AudioSource>('clips') } });
    mount();
    expect(packSpeaks({ ...nullAudio, source: signal<AudioSource>('clips') }, true)).toBe(true);
    expect(packSpeaks({ ...nullAudio, source: signal<AudioSource>('clips') })).toBe(true); // the default reads the store: 'pack'
    // the learner's choice wins (the contract-tier `packWillSpeak`): a 'clips' source left over under 'device' is not the pack speaking
    expect(packSpeaks({ ...nullAudio, source: signal<AudioSource>('clips') }, false)).toBe(false);
    // `source` is capability-correct from mount (the idle default): a ready pack under settings.audioSource 'device' reads 'synth' and is the device voice, not the pack.
    expect(packSpeaks({ ...nullAudio, hasJaVoice: signal(true), packReady: signal(true), source: signal<AudioSource>('synth') }, false)).toBe(false);
    // A ready pack the learner chose speaks even while the master volume is 0 (the idle `source` reads 'none'); under 'device' it does not.
    expect(packSpeaks({ ...nullAudio, packReady: signal(true) }, true)).toBe(true);
    expect(packSpeaks({ ...nullAudio, packReady: signal(true) }, false)).toBe(false);
    expect(packSpeaks({ ...nullAudio, packReady: signal(true) })).toBe(true); // the default reads the store: 'pack'
    expect(packSpeaks(nullAudio, true)).toBe(false);
    expect(packSpeaks(nullAudio)).toBe(false);
    const placeholder = q<HTMLSelectElement>('select[data-setting="ttsVoiceURI"]').options[0]?.textContent;
    expect(placeholder).toBe(S.setVoiceNonePack);
    expect(placeholder).not.toBe(S.setVoiceNone);
    expect(S.setVoiceNonePack).not.toMatch(/recorded/i);

    // Muted pack (source idles at 'none'), chosen: still the pack line; switch to the device voice and no voice is left to name.
    render(null, root);
    installServices({ audio: { ...nullAudio, hasJaVoice: signal(false), packReady: signal(true), source: signal<AudioSource>('none') } });
    mount();
    const option = (): string | undefined => q<HTMLSelectElement>('select[data-setting="ttsVoiceURI"]').options[0]?.textContent;
    expect(option()).toBe(S.setVoiceNonePack);
    radio('audioSource', 'device');
    expect(option()).toBe(S.setVoiceNone);

    // No pack at all (no `packReady`): no voice.
    render(null, root);
    installServices({ audio: { ...nullAudio, hasJaVoice: signal(false), source: signal<AudioSource>('none') } });
    mount();
    radio('audioSource', 'pack');
    expect(option()).toBe(S.setVoiceNone);
  });

  it('the device-voice picker and speed hints re-render when the audio barrel lands after first paint (servicesVersion), with no other interaction', async () => {
    await makeTestStore();
    servicesVersion.value = 0;
    mount();
    const option = (): string | undefined => q<HTMLSelectElement>('select[data-setting="ttsVoiceURI"]').options[0]?.textContent;
    expect(option()).toBe(S.setVoiceNone);
    act(() => {
      installServices({ audio: { ...nullAudio, hasJaVoice: signal(false), packReady: signal(true), source: signal<AudioSource>('clips') } });
    });
    expect(option()).toBe(S.setVoiceNonePack);
  });

  it('audioSource and dataSaver persist through the store, with the hint naming what each source serves and the speed-tier note', async () => {
    await makeTestStore();
    mount();
    expect(settings().audioSource).toBe('pack');
    expect(q<HTMLInputElement>('input[data-setting="audioSource"][value="pack"]').checked).toBe(true);
    radio('audioSource', 'device');
    expect(settings().audioSource).toBe('device');
    radio('audioSource', 'pack');
    expect(settings().audioSource).toBe('pack');
    expect(settings().dataSaver).toBe(false);
    toggle('dataSaver');
    expect(settings().dataSaver).toBe(true);
    toggle('dataSaver');
    expect(settings().dataSaver).toBe(false);
    expect(root.textContent).toContain(S.setAudioSourceHint);
    expect(S.setAudioSourceHint).toMatch(/Pitch Ear/);
    expect(root.textContent).toContain(S.setDataSaverHint);
    expect(root.textContent).not.toContain(S.setDataSaverForced);
    expect(q<HTMLInputElement>('input[data-setting="dataSaver"]').checked).toBe(false);
    expect(q('[data-speed-note]').textContent).toBe(S.setSpeedTierNote);
    expect(S.setSpeedTierNote).toBe('Slow is spoken slowly through Station 17; faster speeds keep the pitch.');
  });

  it('data saver switches itself on when the browser asks to save data (navigator.connection.saveData) — once per boot — and the switch is read-only while the browser forces it: the effective state shows, the hint says why, a tap writes nothing', async () => {
    await makeTestStore();
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
    const sw = (): HTMLInputElement => q<HTMLInputElement>('input[data-setting="dataSaver"]');
    try {
      expect(saveDataRequested()).toBe(true);
      mount();
      expect(settings().dataSaver).toBe(true);
      // The switch shows the EFFECTIVE state (design 08 §13) and is disabled: the browser forces data saving, idle downloads stay off and the hint says so.
      expect(sw().checked).toBe(true);
      expect(sw().disabled).toBe(true);
      expect(root.textContent).toContain(S.setDataSaverForced);
      expect(S.setDataSaverForced).toBe('Your browser asks for data saving — idle downloads are off.');
      toggle('dataSaver');
      toggle('dataSaver');
      expect(settings().dataSaver).toBe(true); // no invisible write, no flip-flop
      expect(sw().checked).toBe(true);
      expect(sw().disabled).toBe(true);
      // The learner's stored choice is theirs once the browser stops asking: the switch is live again.
      delete (navigator as { connection?: unknown }).connection;
      render(null, root);
      mount();
      expect(sw().disabled).toBe(false);
      expect(sw().checked).toBe(true);
      expect(root.textContent).toContain(S.setDataSaverHint);
      expect(root.textContent).not.toContain(S.setDataSaverForced);
      toggle('dataSaver');
      expect(settings().dataSaver).toBe(false);
      expect(sw().checked).toBe(false);
      // The same boot does not overrule that choice when the browser asks again…
      Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
      render(null, root);
      mount();
      expect(settings().dataSaver).toBe(false);
      expect(sw().checked).toBe(true); // …but the effective state is still "on" while forced.
      expect(sw().disabled).toBe(true);
      // The next boot asks again.
      render(null, root);
      resetDataSaverAutoForTests();
      mount();
      expect(settings().dataSaver).toBe(true);
    } finally {
      delete (navigator as { connection?: unknown }).connection;
    }
    expect(saveDataRequested()).toBe(false);
    expect(saveDataRequested({ connection: { saveData: false } })).toBe(false);
    expect(saveDataRequested({})).toBe(false);
    expect(saveDataRequested(null)).toBe(false);
    expect(dataSaverEffective({ dataSaver: false }, false)).toBe(false);
    expect(dataSaverEffective({ dataSaver: false }, true)).toBe(true);
    expect(dataSaverEffective({ dataSaver: true }, false)).toBe(true);
    expect(dataSaverEffective({ dataSaver: false })).toBe(false); // the live navigator: no connection hint here
  });

  it('formatBytes reads as a learner does', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(500)).toBe('1 KB');
    expect(formatBytes(300 * 1024)).toBe('300 KB');
    expect(formatBytes(1.5 * MB)).toBe('1.5 MB');
    expect(formatBytes(38 * MB)).toBe('38 MB');
    expect(formatBytes(490 * MB)).toBe('490 MB');
    expect(formatBytes(1.25 * 1024 * MB)).toBe('1.3 GB');
    expect(formatBytes(Number.NaN)).toBe('0 MB');
  });
});
