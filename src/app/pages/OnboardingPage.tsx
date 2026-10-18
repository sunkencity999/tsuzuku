/**
 * TSUZUKU — 日本橋 Station 0, onboarding (group A, design 01 §2, 02 §1/§6.1, 03 §4, 06 §7 #10).
 *
 * Under two minutes: name (`<NameField>`, src/app/names) → Meet ハナ (design 08
 * §10.5: the dojo's voice says あ・い・う・え・お, each lit as it is spoken, then
 * こんにちは with the gloss "hello" and no romaji; speech-recognition and theme
 * choices sit under it) → kana check (46 Kana Flash, a 12-tile confirmation for
 * "I read all kana", or none; every glyph is spoken as it appears — sound before
 * symbol) → pace with the honest road (months at 100 % / 70 %, in-app hours
 * COMPUTED from the preset, the ≈ 1,200 external hours, the honest share of
 * design 08 §12) → summary.
 *
 * Voice honesty (design 08 §8): the install guide reads `voiceAudible` + the
 * `source` signal (`voiceInstallNeeded`), never `hasJaVoice` alone, so a device
 * with the voice pack and no Japanese system voice is never nagged; the source
 * line names "synthetic voice (VOICEVOX)", "device voice" or "text only".
 *
 * The road numbers come from the store's pacing estimate
 * (`store/derived.onboardingEstimate`: station quotas ÷ the preset's rates,
 * one day per Gatekeeper, two per Shinsa — the same basis as the Records
 * projection and the Road page), evaluated per preset with the live settings
 * (`roadEstimateFor`). The design-table `ROAD_DAYS` is only the fallback
 * when no estimate can be computed; every helper below takes the estimate
 * as an optional second argument and falls back to the table without it.
 * notice + theme → one write to the store and the Dojo. `finish()` also
 * stamps `profile.onboardedAt = store.now()` and moves `progress.station`
 * from 0 (Nihonbashi is onboarding only) to 1, so the daily quests and the
 * builder draw from Shinagawa at once.
 *
 * `markKnown` runs only for the kana the learner actually read; the rest are
 * taught at Shinagawa. `settings.speaking` stays `'self'` unless the learner
 * opts into recognition after the network notice.
 *
 * The name step is beginner-first (design 02, Station 0): a plain English
 * input with a katakana suggestion from the names dictionary, kana mode only
 * on request — see `src/app/names/NameField.tsx`. The page keeps the whole
 * `NameDraft` so Back restores it, and `finish()` writes `profile.name` =
 * `resolveName(draft)` (the katakana, the Latin spelling, or 無名 when blank)
 * and `profile.nameKana` = that name ONLY when it is pure kana (`isKanaName`),
 * else '' — Latin letters are never saved as kana; a blank name keeps the
 * むめい placeholder. Every art reader falls back to `name` when `nameKana`
 * is empty.
 *
 * The name is capped at `NAME_MAX_GLYPHS` code points (`@/store`: the one
 * constant onboarding, `fillMeta` and the art tier share) both as it is typed
 * (the field clamps in its input path, since IME composition and paste bypass
 * a native maxlength) and once more in `resolveName` with
 * `shared/jp.clampGlyphs`: every piece of art lays the name out glyph by glyph
 * inside a fixed plate (06 §3 safe zones).
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BELT_IDS, type Belt } from '@/content/types';
import { markKnown } from '@/learn/apply';
import { PRESET_RETENTION, presetRate, steadyStateReviews } from '@/learn';
import { audioSourceOf, packWillSpeak, services, speak, voiceAudible, type AudioService } from '@/shared/audio';
import { rngFor, shuffle } from '@/shared/hash';
import { containsJapanese, equivalentJa } from '@/shared/jp';
import { romajiToKana } from '@/shared/kana-ime';
import { navigate, type Route } from '@/shared/routes';
import type { Intensity, SpeakingMode, Theme } from '@/shared/store-types';
import { INTENSITY_PRESETS, INTENSITY_SCALE, NAME_MAX_GLYPHS, newPerDayFor, store } from '@/store';
import { onboardingEstimate, type OnboardingEstimate } from '@/store/derived';
import { useAudioService } from '../hooks';
import { EMPTY_NAME_DRAFT, NameField, isKanaName, resolveName, type NameDraft } from '../names/NameField';
import { S as SS } from './settings-strings';
import { S, fmt, num } from './strings';
import './pages.css';

/* ────────────────────────────────────────────────────────────────────────── */
/* Kana inventory: the 46 basic hiragana (ids per CONTENT_GUIDE §3)           */
/* ────────────────────────────────────────────────────────────────────────── */

export interface KanaCard {
  id: string;
  kana: string;
  romaji: string;
}

const k = (romaji: string, kana: string): KanaCard => ({ id: `k-h-${romaji}`, kana, romaji });

export const BASIC_HIRAGANA: readonly KanaCard[] = [
  k('a', 'あ'), k('i', 'い'), k('u', 'う'), k('e', 'え'), k('o', 'お'),
  k('ka', 'か'), k('ki', 'き'), k('ku', 'く'), k('ke', 'け'), k('ko', 'こ'),
  k('sa', 'さ'), k('shi', 'し'), k('su', 'す'), k('se', 'せ'), k('so', 'そ'),
  k('ta', 'た'), k('chi', 'ち'), k('tsu', 'つ'), k('te', 'て'), k('to', 'と'),
  k('na', 'な'), k('ni', 'に'), k('nu', 'ぬ'), k('ne', 'ね'), k('no', 'の'),
  k('ha', 'は'), k('hi', 'ひ'), k('fu', 'ふ'), k('he', 'へ'), k('ho', 'ほ'),
  k('ma', 'ま'), k('mi', 'み'), k('mu', 'む'), k('me', 'め'), k('mo', 'も'),
  k('ya', 'や'), k('yu', 'ゆ'), k('yo', 'よ'),
  k('ra', 'ら'), k('ri', 'り'), k('ru', 'る'), k('re', 'れ'), k('ro', 'ろ'),
  k('wa', 'わ'), k('wo', 'を'), k('n', 'ん'),
];

export const KANA_TOTAL = BASIC_HIRAGANA.length;
export const TILE_COUNT = 12;
/** The five vowels ハナ says first (design 08 §10.5), in gojūon order; their kana ids are the clip keys. */
export const MEET_VOWELS: readonly KanaCard[] = BASIC_HIRAGANA.slice(0, 5);
/** こんにちは — glossed "hello" on the Meet ハナ step, never romanised (05 §13). */
export const HELLO = 'こんにちは';
/** On the pack path a vowel lights at its clip's first progress tick; a clip that misses (no ticks) lights after this many ms, so no glyph stays dark. */
export const MEET_LIGHT_FALLBACK_MS = 150;

/* ────────────────────────────────────────────────────────────────────────── */
/* Voice honesty (design 08 §8): what the learner is told about the voice    */
/* ────────────────────────────────────────────────────────────────────────── */

/** The pack counts as a voice only while chosen (`settings.audioSource !== 'device'`, design 08 §13). */
const packChosenNow = (): boolean => store.settings.value.audioSource !== 'device';

/**
 * Whether the install guide should show: a pack voice is a voice, so never
 * while the pack speaks (`source === 'clips'` — capability-correct from mount,
 * the idle default before any `speak()`), nor while a ready pack is chosen but
 * the master volume is 0 (the idle `source` then reads `'none'`: the remedy is
 * the volume, not an OS voice); otherwise only when the device has no Japanese
 * voice at all. The pack half is the contract-tier `packWillSpeak(a, packChosen)`
 * (`source` / `packReady` read only together with the setting — a ready pack
 * the learner has not chosen is the device voice); the device half reads
 * `voiceAudible` + `hasJaVoice` (never `hasJaVoice` alone), so a learner who
 * merely muted a device voice is not nagged either.
 */
export function voiceInstallNeeded(a: AudioService, packChosen: boolean = packChosenNow()): boolean {
  if (packWillSpeak(a, packChosen)) return false;
  return !voiceAudible(a) && !a.hasJaVoice.value;
}

/** The honesty word for the voice this device will use: pack clips, the device voice, or text only. */
export function voiceSourceLabel(a: AudioService): string {
  if (audioSourceOf(a) === 'clips') return S.sourcePack;
  return voiceAudible(a) ? S.sourceDevice : S.sourceNone;
}

/** Typed romaji (any Hepburn / kunrei spelling) or kana matches the glyph. */
export function kanaMatches(typed: string, kana: string): boolean {
  const t = typed.trim();
  if (t.length === 0) return false;
  if (containsJapanese(t)) return equivalentJa(t, kana);
  return equivalentJa(romajiToKana(t.toLowerCase()), kana);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* The honest road (design 02 §6.1, 03 §4) — computed from the preset         */
/* ────────────────────────────────────────────────────────────────────────── */

export type Preset = Exclude<Intensity, 'custom'>;
export const PRESETS: readonly Preset[] = ['casual', 'standard', 'intense'];

/** Study days per belt at Standard, 100 % adherence (02 §6.1; Yellow+Orange 120, Blue+Purple 142 split evenly). FALLBACK only — see `roadEstimateFor`. */
export const ROAD_DAYS: Record<Belt, number> = { white: 15, yellow: 60, orange: 60, green: 90, blue: 71, purple: 71, brown: 121, black: 107 };
/** Steady-state reviews/day per belt at Standard (02 §6.1). */
export const STEADY_REVIEWS: Record<Belt, number> = { white: 60, yellow: 130, orange: 130, green: 180, blue: 220, purple: 220, brown: 290, black: 270 };
/** Expected in-app minutes/day per belt at Standard (02 §6.1). */
export const EXPECTED_MINUTES: Record<Belt, number> = { white: 15, yellow: 25, orange: 25, green: 32, blue: 45, purple: 45, brown: 58, black: 55 };
/** Budget per rep (02 §6.1). */
export const REP_SECONDS = 8;
/** One day per Gatekeeper, two per Shinsa (02 §6.1 "~65 days"). */
export const EXAM_DAYS = 65;
const DAYS_PER_MONTH = 30.44;
/** Design 01 §2: what remains outside the app. */
export const EXTERNAL_HOURS = 1200;

/**
 * The store's pacing estimate for `preset` from Station 1 (the whole road),
 * over the live settings with the preset's intensity and White mix swapped
 * in — exactly what `finish()` writes. Null when the estimate cannot be
 * computed (the callers then fall back to the `ROAD_DAYS` table).
 */
export function roadEstimateFor(preset: Preset): OnboardingEstimate | null {
  try {
    const s = store.settings.value;
    return onboardingEstimate({ ...s, intensity: preset, newPerDay: newPerDayFor('white', preset) }, store.today(), 1);
  } catch {
    return null;
  }
}

/**
 * Days per belt at 100 % adherence for `preset`: the estimate's own days
 * (gates and Shinsa included), or the design table scaled by the preset.
 */
export function roadDays(preset: Preset, est?: OnboardingEstimate | null): Record<Belt, number> {
  const out = {} as Record<Belt, number>;
  for (const b of BELT_IDS) {
    const fromEst = est?.byBelt.find((e) => e.belt === b)?.days;
    out[b] = fromEst ?? ROAD_DAYS[b] / INTENSITY_SCALE[preset];
  }
  return out;
}

/** Reviews scale with the preset's new-item rate; the Scroll/input/output blocks do not. */
export function expectedMinutes(belt: Belt, preset: Preset): number {
  const reviewMin = (STEADY_REVIEWS[belt] * REP_SECONDS) / 60;
  const fixed = EXPECTED_MINUTES[belt] - reviewMin;
  return reviewMin * INTENSITY_SCALE[preset] + fixed;
}

/** The estimate's in-app hours, else `Σ_belt expectedMinutes(belt, preset) × days(belt) / 60` (design 01 §2). */
export function hoursInApp(preset: Preset, est?: OnboardingEstimate | null): number {
  if (est) return est.hoursInApp;
  let minutes = 0;
  for (const b of BELT_IDS) minutes += expectedMinutes(b, preset) * ROAD_DAYS[b];
  return Math.round(minutes / 60);
}

/** Months to Sanjō Ōhashi at 100 % and at 70 % adherence (the estimate's `days100` / `days70`, else the table + `EXAM_DAYS`). */
export function roadMonths(preset: Preset, est?: OnboardingEstimate | null): { full: number; partial: number } {
  if (est) return { full: Math.round(est.days100 / DAYS_PER_MONTH), partial: Math.round(est.days70 / DAYS_PER_MONTH) };
  let study = 0;
  for (const b of BELT_IDS) study += ROAD_DAYS[b];
  const days = study / INTENSITY_SCALE[preset] + EXAM_DAYS;
  return { full: Math.round(days / DAYS_PER_MONTH), partial: Math.round(days / 0.7 / DAYS_PER_MONTH) };
}

/** The belt a learner at `preset` is training after `days` of daily practice. */
export function beltAfterDays(preset: Preset, days: number, est?: OnboardingEstimate | null): Belt {
  const per = roadDays(preset, est);
  let cum = 0;
  for (const b of BELT_IDS) {
    cum += per[b];
    if (days < cum) return b;
  }
  return 'black';
}

/** "≈ N reviews/day in a year" for the Intense warning (03 §4), rounded to tens. */
export function steadyReviewsInAYear(preset: Preset, est?: OnboardingEstimate | null): number {
  const belt = beltAfterDays(preset, 365, est);
  return Math.round(steadyStateReviews(presetRate(preset, belt), PRESET_RETENTION[preset]) / 10) * 10;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Steps                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

type StepName = 'name' | 'voice' | 'kana' | 'pace' | 'done';
/** Meet ハナ (`voice`) comes BEFORE the kana check: sound before symbol (design 08 §10.5). */
const STEPS: readonly StepName[] = ['name', 'voice', 'kana', 'pace', 'done'];
type KanaMode = 'ask' | 'full' | 'tiles' | 'result';

const PACE_COPY: Record<Preset, { name: string; ja: string; desc: string }> = {
  casual: { name: S.onbPaceCasual, ja: S.onbPaceCasualJa, desc: S.onbPaceCasualDesc },
  standard: { name: S.onbPaceStandard, ja: S.onbPaceStandardJa, desc: S.onbPaceStandardDesc },
  intense: { name: S.onbPaceIntense, ja: S.onbPaceIntenseJa, desc: S.onbPaceIntenseDesc },
};
const THEME_COPY: Record<Theme, string> = { auto: S.onbThemeAuto, light: S.onbThemeLight, dark: S.onbThemeDark, sky: SS.setThemeSky };
const SPEECH_COPY: Record<'self' | 'recognition', string> = { self: S.onbSpeechSelf, recognition: S.onbSpeechRecognition };
const VOICE_GUIDE = [S.onbVoiceGuideWindows, S.onbVoiceGuideMac, S.onbVoiceGuideAndroid, S.onbVoiceGuideIos];

function Choice(p: { pressed: boolean; onClick(): void; title: string; ja?: string; desc?: string; testId?: string }): JSX.Element {
  return (
    <button type="button" class="onb__choice" aria-pressed={p.pressed} onClick={p.onClick} data-choice={p.testId}>
      <span class="onb__choice-title">
        {p.ja ? (
          <span class="onb__choice-ja" lang="ja">
            {p.ja}
          </span>
        ) : null}
        <span>{p.title}</span>
      </span>
      {p.desc ? <span class="onb__choice-desc">{p.desc}</span> : null}
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Page                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export default function OnboardingPage(_p: { route: Route }): JSX.Element {
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx] ?? 'name';

  // name (the whole draft, so Back brings mode and acceptance back with it)
  const [name, setName] = useState<NameDraft>(EMPTY_NAME_DRAFT);

  // kana check
  const [kanaMode, setKanaMode] = useState<KanaMode>('ask');
  const [queue, setQueue] = useState<readonly KanaCard[]>([]);
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState('');
  const [known, setKnown] = useState<ReadonlySet<string>>(() => new Set());
  const [missed, setMissed] = useState<readonly KanaCard[]>([]);
  const [verdict, setVerdict] = useState<'ok' | 'miss' | null>(null);
  const shuffled = useMemo(() => shuffle(rngFor(store.seed(), 'onboarding', 'kana'), BASIC_HIRAGANA), []);

  // pace — one store estimate per preset (the preset is all that changes the road)
  const [pace, setPace] = useState<Preset>('standard');
  const [intenseAsk, setIntenseAsk] = useState(false);
  const estimates = useMemo(() => ({ casual: roadEstimateFor('casual'), standard: roadEstimateFor('standard'), intense: roadEstimateFor('intense') }), []);

  // Meet ハナ (voice), speech, theme
  const [voiceState, setVoiceState] = useState<'idle' | 'speaking' | 'done'>('idle');
  /** Index of the vowel being spoken; every earlier one stays lit; `MEET_VOWELS.length` = all five. */
  const [lit, setLit] = useState(-1);
  const [greeted, setGreeted] = useState(false);
  const meetRun = useRef(0);
  /** A Meet ハナ run is speaking right now (a ref, so the unmount cleanup can read it). */
  const meetLive = useRef(false);
  // Subscribed to the slot: the voice step re-renders when main.tsx installs the real audio behind first paint.
  const audio = useAudioService();
  const installNag = voiceInstallNeeded(audio);
  const [speaking, setSpeaking] = useState<'self' | 'recognition'>('self');
  const theme = store.settings.value.theme;
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.getElementById('onb-step')?.focus();
  }, [stepIdx]);

  /**
   * Stops a Meet ハナ run: the loop's later speak() calls never fire and the
   * current one is cut, so the sequence never speaks into the kana check (where
   * every glyph is spoken on reveal) and never touches state after unmount.
   */
  const stopMeet = (): void => {
    meetRun.current++;
    if (!meetLive.current) return;
    meetLive.current = false;
    services.audio.cancel();
  };
  useEffect(() => stopMeet, []);
  const leaveStep = (): void => {
    if (step !== 'voice') return;
    stopMeet();
    setVoiceState((s) => (s === 'speaking' ? 'idle' : s));
  };
  const next = (): void => {
    leaveStep();
    setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
  };
  const back = (): void => {
    leaveStep();
    setStepIdx((i) => Math.max(0, i - 1));
  };

  /* ── kana check ──────────────────────────────────────────────────── */
  const startCheck = (mode: 'full' | 'tiles'): void => {
    setQueue(mode === 'full' ? shuffled : shuffled.slice(0, TILE_COUNT));
    setIdx(0);
    setTyped('');
    setKnown(new Set());
    setMissed([]);
    setVerdict(null);
    setKanaMode(mode);
  };
  const noneKnown = (): void => {
    setKnown(new Set());
    setMissed([]);
    setKanaMode('result');
  };
  const finishCheck = (ok: ReadonlySet<string>, miss: readonly KanaCard[], mode: KanaMode): void => {
    if (mode === 'tiles') {
      const missIds = new Set(miss.map((c) => c.id));
      setKnown(new Set(BASIC_HIRAGANA.filter((c) => !missIds.has(c.id)).map((c) => c.id)));
    } else {
      setKnown(ok);
    }
    setKanaMode('result');
  };
  const answer = (correct: boolean): void => {
    const current = queue[idx];
    if (!current) return;
    const ok = new Set(known);
    const miss = [...missed];
    if (correct) ok.add(current.id);
    else miss.push(current);
    setKnown(ok);
    setMissed(miss);
    setVerdict(correct ? 'ok' : 'miss');
    setTyped('');
    if (idx + 1 >= queue.length) finishCheck(ok, miss, kanaMode);
    else setIdx(idx + 1);
  };
  const submitKana = (): void => {
    const current = queue[idx];
    if (!current) return;
    answer(kanaMatches(typed, current.kana));
  };
  /** Sound before symbol (design 08 §10.5): every glyph is spoken as it appears; the kana id is its clip key. */
  const hearKana = (c: KanaCard): void => {
    void speak(c.kana, { kana: c.kana, clip: c.id }).catch(() => undefined);
  };
  const shownKanaId = step === 'kana' && (kanaMode === 'full' || kanaMode === 'tiles') ? queue[idx]?.id : undefined;
  useEffect(() => {
    // Re-speaks only when a new glyph is revealed, never on every keystroke of the answer.
    if (!shownKanaId) return;
    const c = queue[idx];
    if (c) hearKana(c);
  }, [shownKanaId]);

  /* ── pace ────────────────────────────────────────────────────────── */
  const choosePace = (p: Preset): void => {
    if (p === 'intense') {
      setIntenseAsk(true);
      return;
    }
    setIntenseAsk(false);
    setPace(p);
  };

  /* ── theme (applied live so the learner sees it) ─────────────────── */
  const chooseTheme = (t: Theme): void => store.patch('settings', (s) => (s.theme === t ? s : { ...s, theme: t }));

  /* ── Meet ハナ (design 08 §10.5) ─────────────────────────────────── */
  /**
   * あ・い・う・え・お one by one, then こんにちは. With the pack each glyph is
   * lit in time: its clip's first `onProgress` tick lights it, and a clip that
   * misses (synth fallback, no ticks) is lit after `MEET_LIGHT_FALLBACK_MS` so
   * nothing stays dark; without the pack it lights as its speak() begins. A
   * second tap restarts; a stale or stopped run never touches state again.
   */
  const meetHana = async (): Promise<void> => {
    const run = ++meetRun.current;
    meetLive.current = true;
    const a = services.audio;
    const pack = audioSourceOf(a) === 'clips';
    setVoiceState('speaking');
    setGreeted(false);
    setLit(-1);
    for (let i = 0; i < MEET_VOWELS.length; i++) {
      if (meetRun.current !== run) return;
      const v = MEET_VOWELS[i]!;
      // Progress only ever raises the light: a late tick from an earlier clip never dims the ones after it.
      const light = (): void => {
        if (meetRun.current === run) setLit((cur) => (cur < i ? i : cur));
      };
      if (pack) {
        const fallback = setTimeout(light, MEET_LIGHT_FALLBACK_MS);
        await speak(v.kana, { kana: v.kana, clip: v.id, onProgress: light }).catch(() => undefined);
        clearTimeout(fallback);
        light();
      } else {
        light();
        await speak(v.kana, { kana: v.kana, clip: v.id }).catch(() => undefined);
      }
    }
    if (meetRun.current !== run) return;
    setLit(MEET_VOWELS.length);
    setGreeted(true);
    await speak(HELLO, { kana: HELLO }).catch(() => undefined);
    if (meetRun.current !== run) return;
    meetLive.current = false;
    setVoiceState('done');
  };

  /** The display name: kana mode finalised through the IME, trimmed and cut to the shared cap (the field caps it too; this is the second guard). */
  const finalName = resolveName(name, NAME_MAX_GLYPHS);

  /* ── finish ──────────────────────────────────────────────────────── */
  const finish = (): void => {
    if (saving) return;
    setSaving(true);
    // Kana only: a Latin display name leaves nameKana empty (the art falls back to `name`); blank keeps the placeholder.
    const nameKana = finalName.length > 0 ? (isKanaName(finalName) ? finalName : '') : S.onbNamePlaceholder;
    const display = finalName.length > 0 ? finalName : S.onbNameDefault;
    const preset = INTENSITY_PRESETS[pace];
    const speakingMode: SpeakingMode = speaking;
    store.patch('profile', (p) => ({ ...p, name: display, nameKana, goals: ['road:sanjo-ohashi', `pace:${pace}`], onboardedAt: store.now() }));
    store.patch('settings', (s) => ({
      ...s,
      intensity: pace,
      newPerDay: newPerDayFor('white', pace),
      maxReviews: preset.maxReviews,
      retention: preset.retention,
      speaking: speakingMode,
    }));
    for (const id of known) markKnown(id, 'kana');
    store.patch('progress', (p) => ({ ...p, station: Math.max(1, p.station) }));
    void store.flush();
    navigate({ name: 'dojo' }, { replace: true });
  };

  const months = roadMonths(pace, estimates[pace]);
  const hours = hoursInApp(pace, estimates[pace]);
  const current = queue[idx];
  const sentBack = missed.map((c) => c.kana).join('・');

  return (
    <div class="page onb" data-step={step}>
      <h1 class="page__title">
        <span class="page__title-ja brush" lang="ja">
          {S.onbTitleJa}
        </span>
        <span>{S.onbTitle}</span>
      </h1>
      <div class="onb__progress" aria-hidden="true">
        <span>{fmt(S.stepOf, { i: stepIdx + 1, n: STEPS.length })}</span>
        <div class="progress">
          <div class="progress__fill" style={{ width: `${((stepIdx + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>
      <span class="visually-hidden" role="status">
        {fmt(S.stepOf, { i: stepIdx + 1, n: STEPS.length })}
      </span>

      <section class="panel onb__step" id="onb-step" tabIndex={-1} aria-live="polite">
        {step === 'name' ? (
          <>
            <h2>{S.onbNameLabel}</h2>
            <p class="page__lead">{S.onbIntro}</p>
            <NameField value={name} onChange={setName} onSubmit={next} maxLength={NAME_MAX_GLYPHS} autoFocus />
            <p class="field__hint" data-name-blank-hint>
              {S.onbNameHint}
            </p>
          </>
        ) : null}

        {step === 'kana' ? (
          <>
            <h2>{S.onbKanaCheckTitle}</h2>
            {kanaMode === 'ask' ? (
              <>
                <p class="page__lead">{S.onbKanaCheckBody}</p>
                <div class="onb__choices">
                  <Choice pressed={false} onClick={() => startCheck('full')} title={S.onbKanaFull} testId="kana-full" />
                  <Choice pressed={false} onClick={() => startCheck('tiles')} title={S.onbKanaSkipAll} desc={S.onbKanaSkipConfirm} testId="kana-tiles" />
                  <Choice pressed={false} onClick={noneKnown} title={S.onbKanaNone} testId="kana-none" />
                </div>
              </>
            ) : null}
            {(kanaMode === 'full' || kanaMode === 'tiles') && current ? (
              <div class="onb__kana status-window" data-kana-id={current.id}>
                <span class="muted pixel">{fmt(S.onbKanaProgress, { i: idx + 1, n: queue.length })}</span>
                <span class="onb__kana-glyph" lang="ja" data-glyph>
                  {current.kana}
                </span>
                <button type="button" class="btn btn--sm btn--ghost" onClick={() => hearKana(current)} data-kana-hear>
                  {S.onbKanaHear}
                </button>
                <span class="field__hint">{S.onbKanaSoundFirst}</span>
                <label class="field">
                  <span class="field__label">{S.onbKanaPrompt}</span>
                  <input
                    class="input onb__kana-input"
                    type="text"
                    value={typed}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellcheck={false}
                    aria-label={S.onbKanaPrompt}
                    data-kana-input
                    onInput={(e) => setTyped(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        submitKana();
                      }
                    }}
                  />
                  <span class="field__hint">{S.onbKanaPromptHint}</span>
                </label>
                <div class="onb__kana-row">
                  <button type="button" class="hanko" onClick={submitKana} data-kana-check>
                    {S.onbKanaCheck}
                  </button>
                  <button type="button" class="btn btn--ghost" onClick={() => answer(false)} data-kana-skip>
                    {S.onbKanaUnsure}
                  </button>
                </div>
                <p class="onb__kana-verdict" data-ok={verdict === 'ok' ? 'true' : verdict === 'miss' ? 'false' : undefined} role="status">
                  {verdict === 'ok' ? S.onbKanaCorrect : verdict === 'miss' ? S.onbKanaMissed : ''}
                </p>
              </div>
            ) : null}
            {kanaMode === 'result' ? (
              <div class="status-window page__section" data-kana-result>
                <p>
                  <strong>{fmt(S.onbKanaResult, { known: known.size, n: KANA_TOTAL })}</strong>
                </p>
                <p class="muted">{known.size === KANA_TOTAL ? S.onbKanaAllKnown : known.size === 0 ? S.onbKanaNoneKnown : S.onbKanaResultHint}</p>
                {missed.length > 0 ? (
                  <p lang="ja" data-sent-back>
                    {fmt(S.onbKanaSentBack, { list: sentBack })}
                  </p>
                ) : null}
                <div class="page__actions">
                  <button type="button" class="btn btn--ghost" onClick={() => setKanaMode('ask')}>
                    {S.onbKanaRedo}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {step === 'pace' ? (
          <>
            <h2>{S.onbPaceTitle}</h2>
            <p class="page__lead">{S.onbPaceHint}</p>
            <div class="onb__choices onb__choices--3" role="group" aria-label={S.onbPaceTitle}>
              {PRESETS.map((p) => (
                <Choice key={p} pressed={pace === p && !intenseAsk} onClick={() => choosePace(p)} title={PACE_COPY[p].name} ja={PACE_COPY[p].ja} desc={PACE_COPY[p].desc} testId={`pace-${p}`} />
              ))}
            </div>
            {intenseAsk ? (
              <div class="notice notice--warn page__section" role="alertdialog" aria-label={S.onbPaceIntense} data-intense-warning>
                <p class="page__modal-text">{fmt(S.onbPaceIntenseWarn, { n: num(steadyReviewsInAYear('intense', estimates.intense)) })}</p>
                <div class="page__actions">
                  <button
                    type="button"
                    class="hanko"
                    onClick={() => {
                      setPace('intense');
                      setIntenseAsk(false);
                    }}
                    data-intense-yes
                  >
                    {S.onbPaceIntenseYes}
                  </button>
                  <button
                    type="button"
                    class="btn"
                    onClick={() => {
                      setPace('standard');
                      setIntenseAsk(false);
                    }}
                    data-intense-no
                  >
                    {S.onbPaceIntenseNo}
                  </button>
                </div>
              </div>
            ) : null}
            <section class="status-window page__section" aria-labelledby="onb-timeline">
              <h3 id="onb-timeline">{S.onbTimelineTitle}</h3>
              <div class="onb__timeline">
                <div class="onb__stat">
                  <span class="onb__stat-label">{S.onbMonthsLabel}</span>
                  <span class="onb__stat-value" data-months>
                    {fmt(S.onbMonthsValue, { full: months.full, partial: months.partial })}
                  </span>
                </div>
                <div class="onb__stat">
                  <span class="onb__stat-label">{S.onbHoursLabel}</span>
                  <span class="onb__stat-value" data-hours>
                    {fmt(S.onbHoursValue, { hours: num(hours) })}
                  </span>
                </div>
              </div>
              <p>{fmt(S.onbTimelineBody, { full: months.full, partial: months.partial })}</p>
              <p>{fmt(S.onbHoursBody, { hours: num(hours) })}</p>
              <p class="muted">{fmt(S.onbPaceReviews, { n: num(steadyReviewsInAYear(pace, estimates[pace])) })}</p>
              <p class="muted">{S.onbTtsNotice}</p>
              <p class="muted">{S.onbLedgerGoal}</p>
            </section>
          </>
        ) : null}

        {step === 'voice' ? (
          <>
            <h2>
              {S.onbMeetTitle} <span lang="ja">{S.onbMeetName}</span> <span class="onb__gloss">{S.onbMeetNameEn}</span>
            </h2>
            <p class="page__lead">{S.onbMeetBody}</p>
            <p class="muted" data-voice-source>
              {fmt(S.onbMeetSource, { source: voiceSourceLabel(audio) })}
            </p>
            <div class="onb__meet status-window" data-meet>
              <ul class="onb__vowels" aria-label={S.onbMeetVowels} data-vowels>
                {MEET_VOWELS.map((v, i) => (
                  <li key={v.id} class="onb__vowel" lang="ja" data-vowel={v.kana} data-lit={i <= lit ? 'true' : 'false'}>
                    {v.kana}
                  </li>
                ))}
              </ul>
              <span class="field__hint">{S.onbMeetVowels}</span>
              {greeted ? (
                <div class="onb__greeting" data-greeting>
                  <span class="onb__greeting-ja" lang="ja">
                    {HELLO}
                  </span>
                  <span class="onb__greeting-en">{S.onbMeetGreetingEn}</span>
                  <span class="field__hint">{S.onbMeetGreetingNote}</span>
                </div>
              ) : null}
            </div>
            <div class="page__actions">
              <button type="button" class="hanko" onClick={() => void meetHana()} disabled={voiceState === 'speaking'} data-voice-test>
                {voiceState === 'done' ? (
                  S.onbMeetAgain
                ) : (
                  <>
                    {S.onbMeetPlay} <span lang="ja">{S.onbMeetName}</span>
                  </>
                )}
              </button>
              <span class="page__status" role="status">
                {voiceState === 'speaking' ? S.onbVoiceSpeaking : voiceState === 'done' && voiceAudible(audio) ? S.onbVoiceHeard : ''}
              </span>
            </div>
            {installNag ? (
              <div class="notice" data-voice-guide>
                <p class="page__modal-text">{S.onbVoiceNone}</p>
                <details>
                  <summary>{S.onbVoiceGuideTitle}</summary>
                  <ul class="onb__guide">
                    {VOICE_GUIDE.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </details>
              </div>
            ) : null}

            <h3>{S.onbSpeechTitle}</h3>
            <p class="muted">{S.onbSpeechBody}</p>
            <div class="onb__choices" role="radiogroup" aria-label={S.onbSpeechTitle}>
              {(['self', 'recognition'] as const).map((m) => (
                <button key={m} type="button" role="radio" class="onb__choice" aria-checked={speaking === m} onClick={() => setSpeaking(m)} data-speech={m}>
                  <span class="onb__choice-title">{SPEECH_COPY[m]}</span>
                </button>
              ))}
            </div>

            <h3>{S.onbThemeTitle}</h3>
            <div class="onb__choices onb__choices--3" role="radiogroup" aria-label={S.onbThemeTitle}>
              {(['auto', 'light', 'dark'] as const).map((t) => (
                <button key={t} type="button" role="radio" class="onb__choice" aria-checked={theme === t} onClick={() => chooseTheme(t)} data-theme-choice={t}>
                  <span class="onb__choice-title">{THEME_COPY[t]}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {step === 'done' ? (
          <>
            <h2>{S.onbSummaryTitle}</h2>
            <ul class="onb__summary">
              <li>{fmt(S.onbNameSummary, { name: finalName || S.onbNameDefault })}</li>
              <li>{fmt(S.onbSummaryPace, { pace: PACE_COPY[pace].name })}</li>
              <li>{fmt(S.onbSummaryKana, { n: known.size })}</li>
              <li>{fmt(S.onbSummaryTheme, { theme: THEME_COPY[theme] })}</li>
              <li>{fmt(S.onbSummarySpeech, { mode: SPEECH_COPY[speaking] })}</li>
            </ul>
            <p class="muted">{S.onbPrivacy}</p>
            <div class="page__actions">
              <button type="button" class="hanko hanko--lg" onClick={finish} disabled={saving} data-finish>
                {saving ? S.onbSaving : S.onbStart}
              </button>
            </div>
          </>
        ) : null}

        <div class="onb__nav">
          <button type="button" class="btn btn--ghost" onClick={back} disabled={stepIdx === 0} data-back>
            {S.onbBack}
          </button>
          {step !== 'done' ? (
            <button type="button" class="btn" onClick={next} disabled={step === 'kana' && kanaMode !== 'result'} data-next>
              {S.onbNext}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
