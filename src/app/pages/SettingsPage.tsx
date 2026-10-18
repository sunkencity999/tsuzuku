/**
 * TSUZUKU — 設定 Settings (group A, design 01 §6, 03 §4/§7, 06 §7 #10).
 *
 * Every field of `Settings`, grouped: study (pace / custom rates / cap /
 * retention / grading toggles), display (theme, feel, furigana, vertical,
 * motion, CRT), audio (voices from `services.audio.voices()`, speed tier,
 * volume, speaking mode with the network notice), reminders and rest (rest
 * day, neutral `.ics`), privacy and data (storage meter, slot, backup and
 * the dojo's rules) and the danger zone (reset after typing つづく, which
 * delegates to the store's `resetSave()`: header, slices, cards, log and
 * session back to fresh in one batched write, shard keys removed; the page
 * only confirms, flushes and goes to Nihonbashi). Every change is
 * `store.patch` immediately; Intense asks first (03 §4). Both confirms share
 * `useDialogFocus` (initial focus, Escape, Tab trap, opener restore), like
 * the Backup page's Replace dialog.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { BELTS, BELT_IDS, type Belt } from '@/content/types';
import { packWillSpeak, saveDataRequested, services, speak, type AudioPackInfo, type AudioService, type ClipPlayer, type VoiceInfo } from '@/shared/audio';
import { equivalentJa } from '@/shared/jp';
import { href, navigate, type Route } from '@/shared/routes';
import type { Feel, FuriganaMode, Intensity, Retention, Settings, SpeakingMode, SpeedTier, Theme } from '@/shared/store-types';
import { KanaInput } from '@/shared/ui/KanaInput';
import { CEILING_BYTES, INTENSITY_PRESETS, newPerDayFor, resetSave, store } from '@/store';
import { currentBelt } from '@/store/derived';
import { useAudioService, useClipPlayer } from '../hooks';
import { ICS_FILENAME, buildIcs, downloadIcs } from '../ics';
import { useDialogFocus } from '../use-dialog-focus';
import { steadyReviewsInAYear } from './OnboardingPage';
import { S as SS } from './settings-strings';
import { BELT_NAME, S, WEEKDAYS, fmt, num } from './strings';
import './pages.css';
import './settings.css';

export interface SettingsPageProps {
  route: Route;
  /** Download hook for the reminder file (tests inject a spy); defaults to `downloadIcs`. */
  download?: (text: string, filename: string) => boolean;
}

type Preset = Exclude<Intensity, 'custom'>;
const PRESETS: readonly Preset[] = ['casual', 'standard', 'intense'];
const PRESET_LABEL: Record<Intensity, string> = { casual: S.setPaceCasual, standard: S.setPaceStandard, intense: S.setPaceIntense, custom: S.setCustom };
/** Hint under the pace radios: the preset's own description (custom gets its own line). */
const PACE_HINT: Record<Intensity, string> = { casual: S.onbPaceCasualDesc, standard: S.onbPaceStandardDesc, intense: S.onbPaceIntenseDesc, custom: S.setCustomHint };
const FEELS: readonly { id: Feel; name: string; ja: string; desc: string }[] = [
  { id: 'zen', name: S.setFeelZen, ja: S.setFeelZenJa, desc: S.setFeelZenDesc },
  { id: 'dojo', name: S.setFeelDojo, ja: S.setFeelDojoJa, desc: S.setFeelDojoDesc },
  { id: 'arcade', name: S.setFeelArcade, ja: S.setFeelArcadeJa, desc: S.setFeelArcadeDesc },
];
/** Each theme radio carries a live 48 px swatch (design 09 §7 G): washi, lacquer, both halves, or the sky painted from `--sky-*`. */
export type SwatchKind = 'auto' | 'light' | 'dark' | 'sky';
const THEMES: readonly { id: Theme; name: string; swatch: SwatchKind }[] = [
  { id: 'auto', name: S.setThemeAuto, swatch: 'auto' },
  { id: 'light', name: S.setThemeLight, swatch: 'light' },
  { id: 'dark', name: S.setThemeDark, swatch: 'dark' },
  { id: 'sky', name: SS.setThemeSky, swatch: 'sky' },
];
const FURIGANA: readonly { id: FuriganaMode; name: string }[] = [
  { id: 'always', name: S.setFuriganaAlways },
  { id: 'fog', name: S.setFuriganaFog },
  { id: 'tap', name: S.setFuriganaTap },
  { id: 'off', name: S.setFuriganaOff },
];
const SPEAKING: readonly { id: SpeakingMode; name: string }[] = [
  { id: 'self', name: S.setSpeakingSelf },
  { id: 'recognition', name: S.setSpeakingRecognition },
  { id: 'off', name: S.setSpeakingOff },
];
/** `Settings.audioSource` (design 08 §13): the pack's VOICEVOX clips first, or the device voice for everything. */
const AUDIO_SOURCES: readonly { id: Settings['audioSource']; name: string; ja?: string }[] = [
  { id: 'pack', name: S.setAudioSourcePack, ja: S.setPackTitleJa },
  { id: 'device', name: S.setAudioSourceDevice },
];
const RETENTIONS: readonly Retention[] = [0.85, 0.9, 0.95];
const TIERS: readonly SpeedTier[] = [1, 2, 3, 4, 5];
const RESET_WORD = 'つづく';
const HELLO = 'こんにちは';
const DEFAULT_REMINDER = '19:00';

/* ────────────────────────────────────────────────────────────────────────── */
/* Store writers (exported for tests)                                         */
/* ────────────────────────────────────────────────────────────────────────── */

export function patchSettings(fn: (s: Settings) => Settings): void {
  store.patch('settings', fn);
}

export function setField<K extends keyof Settings>(key: K, value: Settings[K]): void {
  patchSettings((s) => (Object.is(s[key], value) ? s : { ...s, [key]: value }));
}

/** Apply a named preset: rates for the current belt, cap and retention (design 03 §4). */
export function applyPreset(preset: Preset): void {
  const p = INTENSITY_PRESETS[preset];
  const belt = currentBelt();
  patchSettings((s) => ({ ...s, intensity: preset, newPerDay: newPerDayFor(belt, preset), maxReviews: p.maxReviews, retention: p.retention }));
}

/** Feel change: speed grading defaults off in Zen, on otherwise (ARCHITECTURE §1). */
export function applyFeel(feel: Feel): void {
  patchSettings((s) => (s.feel === feel ? s : { ...s, feel, speedGrading: feel !== 'zen' }));
}

export function japaneseVoices(voices: readonly VoiceInfo[]): VoiceInfo[] {
  return voices.filter((v) => /^ja\b/i.test(v.lang));
}

export function parseTime(v: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return { hour: 19, minute: 0 };
  return { hour: Math.min(23, Math.max(0, Number(m[1]))), minute: Math.min(59, Math.max(0, Number(m[2]))) };
}

export function kbOf(bytes: number): number {
  return Math.round(bytes / 1024);
}

/**
 * Bytes as a learner reads them (design 08 §13 "38 MB · 490 MB"): KB under a
 * megabyte, MB with one decimal under ten, whole MB to a gigabyte, GB beyond.
 */
export function formatBytes(bytes: number): string {
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (!Number.isFinite(bytes) || bytes <= 0) return fmt(S.mb, { n: 0 });
  if (bytes < MB) return fmt(S.kb, { n: Math.max(1, Math.round(bytes / KB)) });
  if (bytes < GB) {
    const mb = bytes / MB;
    return fmt(S.mb, { n: mb < 10 ? String(Math.round(mb * 10) / 10) : num(mb) });
  }
  return fmt(S.gb, { n: String(Math.round((bytes / GB) * 10) / 10) });
}

/** `navigator.connection.saveData` where the browser exposes it (design 08 §13: data saver auto-on) — the contract-tier body in `@/shared/audio`, re-exported for the page's tests. */
export { saveDataRequested };

/** The manifest summary once the pack is ready, else null (absent, loading or no player installed). */
export function packInfo(clips: ClipPlayer | undefined): AudioPackInfo | null {
  if (!clips || clips.ready.value !== 'ready') return null;
  return clips.info.value;
}

/**
 * A pack voice is a voice (design 08 §8): the pack will speak — the contract-tier
 * `packWillSpeak(a, packChosen)` with the store's choice as the default. `source`
 * is capability-correct from mount (before any `speak()` it holds the idle
 * default), so `'clips'` says so while the pack is chosen — a ready pack under
 * `settings.audioSource === 'device'` is the device voice whatever `source` reads.
 * A ready pack the learner chose counts too while the master volume is 0 (the
 * idle `source` then reads `'none'`): the remedy is the volume, not an OS voice.
 */
export function packSpeaks(a: AudioService, packChosen: boolean = store.settings.value.audioSource !== 'device'): boolean {
  return packWillSpeak(a, packChosen);
}

/** The browser forces data saving (design 08 §13): the switch shows the effective state, `settings.dataSaver || saveDataRequested()`. */
export function dataSaverEffective(s: Pick<Settings, 'dataSaver'>, forced: boolean = saveDataRequested()): boolean {
  return s.dataSaver || forced;
}

/** The data-saver auto-on ran this boot (design 08 §13): once, so a learner who switches it off is not overruled on the next visit. */
let dataSaverAutoApplied = false;
/** Tests: forget that the auto-on ran. */
export function resetDataSaverAutoForTests(): void {
  dataSaverAutoApplied = false;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Small controls                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

/** Decorative (the radio's text names the theme); the sky swatch is live because theme.ts writes `--sky-*` on `<html>`. */
export function ThemeSwatch(p: { kind: SwatchKind }): JSX.Element {
  return (
    <span class="theme-swatch" data-swatch={p.kind} aria-hidden="true">
      <span class="theme-swatch__frame status-window" />
    </span>
  );
}

function Radios<T extends string>(p: { name: string; value: T; options: readonly { id: T; name: string; ja?: string; swatch?: SwatchKind }[]; onChange(v: T): void; label: string; describedBy?: string }): JSX.Element {
  return (
    <div class="set__radios" role="radiogroup" aria-label={p.label} aria-describedby={p.describedBy}>
      {p.options.map((o) => (
        <label key={o.id} class="set__radio">
          <input type="radio" name={p.name} value={o.id} checked={p.value === o.id} onChange={() => p.onChange(o.id)} data-setting={p.name} />
          {o.swatch ? <ThemeSwatch kind={o.swatch} /> : null}
          <span>{o.name}</span>
          {o.ja ? (
            <span class="set__radio-ja" lang="ja">
              {o.ja}
            </span>
          ) : null}
        </label>
      ))}
    </div>
  );
}

function Switch(p: { id: keyof Settings; checked: boolean; label: string; hint?: string; disabled?: boolean; onChange(v: boolean): void }): JSX.Element {
  return (
    <label class="set__switch">
      <input type="checkbox" checked={p.checked} disabled={p.disabled} onChange={(e) => p.onChange(e.currentTarget.checked)} data-setting={p.id} />
      <span class="set__switch-text">
        <span>{p.label}</span>
        {p.hint ? <span class="field__hint">{p.hint}</span> : null}
      </span>
    </label>
  );
}

/** Confirm dialog (Intense, Reset): focus lands on Cancel, Escape closes, Tab stays inside, focus returns to the opener. */
function Confirm(p: { text: string; yes: string; no: string; onYes(): void; onNo(): void; testId: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, { onClose: p.onNo, initial: '[data-confirm-no]' });
  return (
    <div class="modal" role="dialog" aria-modal="true" aria-label={p.text} data-confirm={p.testId} ref={ref} tabIndex={-1}>
      <div class="modal__card">
        <p class="page__modal-text">{p.text}</p>
        <div class="modal__actions page__actions">
          <button type="button" class="hanko" onClick={p.onYes} data-confirm-yes>
            {p.yes}
          </button>
          <button type="button" class="btn btn--ghost" onClick={p.onNo} data-confirm-no>
            {p.no}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 音声パック voice pack card (design 08 §13)                                 */
/* ────────────────────────────────────────────────────────────────────────── */

interface BeltJob {
  belt: Belt;
  done: number;
  total: number;
}

function beltLabel(belt: Belt): string {
  return BELT_NAME[belt] ?? belt;
}

/**
 * Sizes come from the runtime manifest (`clips.info`) and the Cache API
 * (`clips.cacheUsage()`), never guessed; Download / Remove go through the
 * player. While the player is still being installed or its manifest probe runs
 * the card says it is looking (a transient line, never the definitive no-pack
 * sentence for a build that has one); a settled `undefined` player or
 * `ready === 'absent'` is the no-pack sentence: the device voice speaks.
 */
function VoicePackCard(p: { belt: Belt }): JSX.Element {
  const { clips, settled } = useClipPlayer();
  const ready = clips ? clips.ready.value : settled ? 'absent' : 'unknown';
  const info = packInfo(clips);
  const state: 'probing' | 'absent' | 'ready' = !clips ? (settled ? 'absent' : 'probing') : ready === 'absent' ? 'absent' : ready === 'ready' && info ? 'ready' : 'probing';
  const mine = info?.belts[p.belt];
  const [usage, setUsage] = useState<number | null>(null);
  const [job, setJob] = useState<BeltJob | null>(null);
  const [note, setNote] = useState('');
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refreshUsage = (): void => {
    if (!clips || ready !== 'ready') return;
    clips.cacheUsage().then(
      (u) => {
        if (alive.current) setUsage(u.bytes);
      },
      () => {
        if (alive.current) setUsage(null);
      },
    );
  };
  useEffect(refreshUsage, [clips, ready]);

  const download = (belt: Belt): void => {
    if (!clips || job) return;
    setNote('');
    setJob({ belt, done: 0, total: info?.belts[belt]?.bytes ?? 0 });
    clips
      .download(belt, (done, total) => {
        if (alive.current) setJob({ belt, done, total });
      })
      .then(
        () => {
          if (!alive.current) return;
          setJob(null);
          setNote(fmt(S.setPackDownloaded, { belt: beltLabel(belt) }));
          refreshUsage();
        },
        () => {
          if (!alive.current) return;
          setJob(null);
          setNote(S.setPackFailed);
          refreshUsage();
        },
      );
  };

  const remove = (belt: Belt): void => {
    if (!clips || job) return;
    clips.remove(belt).then(
      () => {
        if (!alive.current) return;
        setNote(fmt(S.setPackRemoved, { belt: beltLabel(belt) }));
        refreshUsage();
      },
      () => {
        if (alive.current) setNote(S.setPackRemoveFailed);
      },
    );
  };

  const pct = job && job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;

  return (
    <div class="set__pack status-window" data-voice-pack data-pack-state={state}>
      <h3 class="set__pack-title">
        <span lang="ja">{S.setPackTitleJa}</span>
        <span>{S.setPackTitle}</span>
      </h3>
      <p class="set__pack-explain">{S.setPackExplain}</p>
      {state === 'probing' ? (
        <p class="muted" data-pack-loading>
          {S.setPackLoading}
        </p>
      ) : state === 'absent' || !info ? (
        <p class="muted" data-pack-none>
          {S.setPackNone}
        </p>
      ) : (
        <>
          <p data-pack-sizes>
            {mine
              ? fmt(S.setPackSizes, {
                  belt: formatBytes(mine.bytes),
                  all: formatBytes(info.totals.bytes),
                  device: usage === null ? S.setPackCounting : formatBytes(usage),
                })
              : fmt(S.setPackSizesNoBelt, {
                  all: formatBytes(info.totals.bytes),
                  device: usage === null ? S.setPackCounting : formatBytes(usage),
                })}
          </p>
          <h4 class="set__pack-h4">{S.setPackBeltsTitle}</h4>
          <p class="field__hint">{S.setPackBeltsHint}</p>
          <ul class="set__pack-belts">
            {BELT_IDS.map((belt) => {
              const b = info.belts[belt];
              if (!b) return null;
              const def = BELTS.find((x) => x.id === belt);
              const busy = job?.belt === belt;
              return (
                <li key={belt} class="set__pack-belt" data-pack-belt={belt} data-busy={busy ? 'true' : 'false'}>
                  <span class="set__pack-belt-name">
                    {def ? (
                      <span lang="ja" aria-hidden="true">
                        {def.nameJa}
                      </span>
                    ) : null}
                    <span>{beltLabel(belt)}</span>
                  </span>
                  <span class="set__pack-belt-size pixel">
                    {formatBytes(b.bytes)}
                    {S.separator}
                    {fmt(S.minutesShort, { n: num(b.seconds / 60) })}
                  </span>
                  {busy ? (
                    <div class="progress progress--ai" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={fmt(S.setPackDownloading, { belt: beltLabel(belt), pct })} data-pack-progress>
                      <div class="progress__fill" style={{ width: `${Math.max(1, pct)}%` }} />
                    </div>
                  ) : null}
                  <span class="set__pack-belt-actions">
                    <button type="button" class="btn btn--sm" disabled={job !== null} onClick={() => download(belt)} data-pack-download={belt}>
                      {S.setPackDownload}
                    </button>
                    <button type="button" class="btn btn--sm btn--ghost" disabled={job !== null} onClick={() => remove(belt)} data-pack-remove={belt}>
                      {S.setPackRemove}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          <p class="page__status" role="status" data-pack-note>
            {job ? fmt(S.setPackDownloading, { belt: beltLabel(job.belt), pct }) : note}
          </p>
          <p class="field__hint">{S.setPackSafari}</p>
        </>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Page                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export default function SettingsPage(p: SettingsPageProps): JSX.Element {
  const s = store.settings.value;
  const profile = store.profile.value;
  const storage = store.storage.value;
  const [intenseAsk, setIntenseAsk] = useState(false);
  const [reminderTime, setReminderTime] = useState(DEFAULT_REMINDER);
  const [icsStatus, setIcsStatus] = useState<'idle' | 'saved' | 'fallback'>('idle');
  const [icsText, setIcsText] = useState('');
  const [resetTyped, setResetTyped] = useState('');
  const [resetAsk, setResetAsk] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  // Subscribed to the slot (the real audio lands behind first paint) and read the signal first:
  // voices arrive asynchronously (voiceschanged / poll), and the list is recomputed on every
  // render so a late batch fills the pickers.
  const audio = useAudioService();
  const hasJaVoice = audio.hasJaVoice.value;
  const voices = japaneseVoices(audio.voices());
  const download = p.download ?? downloadIcs;

  // Data saver follows the browser's own request (design 08 §13), once per boot: the store
  // default stays pure, and a learner who switches it off afterwards keeps that choice.
  // The switch itself shows the EFFECTIVE state and is read-only while the browser asks for
  // data saving — idle downloads are off whatever the setting says, the hint says so, and a tap
  // that could change nothing visible writes nothing (the learner's stored choice stays theirs).
  const saverForced = saveDataRequested();
  useEffect(() => {
    if (dataSaverAutoApplied || !saverForced) return;
    dataSaverAutoApplied = true;
    if (!store.settings.value.dataSaver) setField('dataSaver', true);
  }, []);

  const choosePace = (v: Intensity): void => {
    if (v === 'intense') {
      setIntenseAsk(true);
      return;
    }
    if (v === 'custom') setField('intensity', 'custom');
    else applyPreset(v);
  };

  const numberField = (key: 'vocab' | 'kanji' | 'grammar', e: JSX.TargetedEvent<HTMLInputElement>): void => {
    const n = Number(e.currentTarget.value);
    if (!Number.isFinite(n) || n < 0) return;
    patchSettings((st) => ({ ...st, intensity: 'custom', newPerDay: { ...st.newPerDay, [key]: Math.round(n * 100) / 100 } }));
  };

  const makeIcs = (): void => {
    const { hour, minute } = parseTime(reminderTime);
    const text = buildIcs({ hour, minute, tz: profile.tz, startDay: store.today(), stampMs: store.now() });
    if (download(text, ICS_FILENAME)) {
      setIcsStatus('saved');
      setIcsText('');
    } else {
      setIcsStatus('fallback');
      setIcsText(text);
    }
  };

  const resetReady = equivalentJa(resetTyped.trim(), RESET_WORD);
  const doReset = (): void => {
    setResetAsk(false);
    // The store's wipe (one batched write, shard keys removed); flush so the fresh save is on disk before Nihonbashi.
    resetSave();
    void store.flush();
    setResetDone(true);
    setResetTyped('');
    navigate({ name: 'onboarding' }, { replace: true });
  };

  const level = storage.level;
  const ratio = Math.min(1, storage.bytes / CEILING_BYTES);
  const levelText = level === 'ceiling' ? S.setStorageLevelCeiling : level === 'warn' ? S.setStorageLevelWarn : S.setStorageLevelOk;

  return (
    <div class="page settings">
      <h1 class="page__title">
        <span class="page__title-ja brush" lang="ja">
          {S.setTitleJa}
        </span>
        <span>{S.setTitle}</span>
      </h1>

      {/* ── Study ─────────────────────────────────────────────────────── */}
      <section class="panel page__section" aria-labelledby="set-study">
        <h2 id="set-study">{S.setStudy}</h2>
        <div class="field">
          <span class="field__label">{S.setIntensity}</span>
          <Radios
            name="intensity"
            label={S.setIntensity}
            value={s.intensity}
            options={[...PRESETS.map((id) => ({ id, name: PRESET_LABEL[id] })), { id: 'custom' as Intensity, name: S.setCustom }]}
            onChange={choosePace}
          />
          <span class="field__hint" data-pace-hint>{PACE_HINT[s.intensity]}</span>
        </div>
        {intenseAsk ? (
          <Confirm
            text={fmt(S.onbPaceIntenseWarn, { n: num(steadyReviewsInAYear('intense')) })}
            yes={S.onbPaceIntenseYes}
            no={S.cancel}
            testId="intense"
            onYes={() => {
              applyPreset('intense');
              setIntenseAsk(false);
            }}
            onNo={() => setIntenseAsk(false)}
          />
        ) : null}
        <div class="set__grid set__grid--2">
          <fieldset class="field" data-custom-rates>
            <legend class="field__label">{S.setNewPerDay}</legend>
            <label class="field">
              <span class="field__hint">{S.setNewVocab}</span>
              <input class="input" type="number" min="0" step="0.25" value={s.newPerDay.vocab} onChange={(e) => numberField('vocab', e)} data-setting="newPerDay.vocab" />
            </label>
            <label class="field">
              <span class="field__hint">{S.setNewKanji}</span>
              <input class="input" type="number" min="0" step="0.25" value={s.newPerDay.kanji} onChange={(e) => numberField('kanji', e)} data-setting="newPerDay.kanji" />
            </label>
            <label class="field">
              <span class="field__hint">{S.setNewGrammar}</span>
              <input class="input" type="number" min="0" step="0.25" value={s.newPerDay.grammar} onChange={(e) => numberField('grammar', e)} data-setting="newPerDay.grammar" />
            </label>
          </fieldset>
          <div class="field">
            <label class="field">
              <span class="field__label">{S.setMaxReviews}</span>
              <input
                class="input"
                type="number"
                min="10"
                step="10"
                value={s.maxReviews}
                onChange={(e) => {
                  const n = Math.round(Number(e.currentTarget.value));
                  if (Number.isFinite(n) && n >= 10) patchSettings((st) => ({ ...st, intensity: 'custom', maxReviews: n }));
                }}
                data-setting="maxReviews"
              />
              <span class="field__hint">{S.setMaxReviewsHint}</span>
            </label>
            <label class="field">
              <span class="field__label">{S.setRetention}</span>
              <select class="select" value={String(s.retention)} onChange={(e) => setField('retention', Number(e.currentTarget.value) as Retention)} data-setting="retention">
                {RETENTIONS.map((r) => (
                  <option key={r} value={String(r)}>
                    {fmt(S.percent, { n: Math.round(r * 100) })}
                  </option>
                ))}
              </select>
              <span class="field__hint">{S.setRetentionHint}</span>
            </label>
          </div>
        </div>
        <div class="set__switches">
          <Switch id="classicGrading" checked={s.classicGrading} label={S.setClassicGrading} hint={S.setClassicHint} onChange={(v) => setField('classicGrading', v)} />
          <Switch id="speedGrading" checked={s.speedGrading} label={S.setSpeedGrading} hint={S.setSpeedGradingHint} onChange={(v) => setField('speedGrading', v)} />
          <Switch id="jj" checked={s.jj} label={S.setJj} hint={S.setJjHint} onChange={(v) => setField('jj', v)} />
          <Switch id="writing" checked={s.writing} label={S.setWriting} hint={S.setWritingHint} onChange={(v) => setField('writing', v)} />
        </div>
      </section>

      {/* ── Display ───────────────────────────────────────────────────── */}
      <section class="panel page__section" aria-labelledby="set-display">
        <h2 id="set-display">{S.setDisplay}</h2>
        <div class="field">
          <span class="field__label">{S.setTheme}</span>
          <Radios name="theme" label={S.setTheme} value={s.theme} options={THEMES} onChange={(v) => setField('theme', v)} describedBy="theme-hint" />
          {/* the one-line Follow-the-sky explanation (09 §8), read to the radiogroup as well as shown */}
          <span class="field__hint" id="theme-hint" data-theme-hint>
            {SS.setThemeSkyHint}
          </span>
        </div>
        <div class="field">
          <span class="field__label">{S.setFeel}</span>
          <Radios name="feel" label={S.setFeel} value={s.feel} options={FEELS} onChange={applyFeel} />
          <span class="field__hint">{FEELS.find((f) => f.id === s.feel)?.desc}</span>
        </div>
        <label class="field">
          <span class="field__label">{S.setFurigana}</span>
          <select class="select" value={s.furigana} onChange={(e) => setField('furigana', e.currentTarget.value as FuriganaMode)} data-setting="furigana">
            {FURIGANA.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <div class="set__switches">
          <Switch id="verticalText" checked={s.verticalText} label={S.setVerticalText} hint={S.setVerticalHint} onChange={(v) => setField('verticalText', v)} />
          <Switch id="reducedMotion" checked={s.reducedMotion} label={S.setReducedMotion} onChange={(v) => setField('reducedMotion', v)} />
          <Switch id="crt" checked={s.crt} disabled={s.feel !== 'arcade'} label={S.setCrt} hint={S.setCrtHint} onChange={(v) => setField('crt', v)} />
        </div>
      </section>

      {/* ── Audio ─────────────────────────────────────────────────────── */}
      <section class="panel page__section" aria-labelledby="set-audio">
        <h2 id="set-audio">{S.setAudio}</h2>
        <VoicePackCard belt={profile.belt} />
        <div class="field">
          <span class="field__label">{S.setAudioSource}</span>
          <Radios name="audioSource" label={S.setAudioSource} value={s.audioSource} options={AUDIO_SOURCES} onChange={(v) => setField('audioSource', v)} />
          <span class="field__hint">{S.setAudioSourceHint}</span>
        </div>
        <div class="set__grid set__grid--2">
          <label class="field">
            <span class="field__label">{S.setVoice}</span>
            <select class="select" value={s.ttsVoiceURI ?? ''} onChange={(e) => setField('ttsVoiceURI', e.currentTarget.value || undefined)} data-setting="ttsVoiceURI">
              <option value="">{voices.length === 0 && !hasJaVoice ? (packSpeaks(audio, s.audioSource !== 'device') ? S.setVoiceNonePack : S.setVoiceNone) : S.setVoiceDefault}</option>
              {voices.map((v) => (
                <option key={v.uri} value={v.uri}>
                  {v.name} · {v.network ? S.setVoiceNetwork : S.setVoiceLocal}
                </option>
              ))}
            </select>
            <span class="field__hint">{S.setVoiceHint}</span>
          </label>
          <label class="field">
            <span class="field__label">{S.setVoice2}</span>
            <select class="select" value={s.ttsVoiceURI2 ?? ''} onChange={(e) => setField('ttsVoiceURI2', e.currentTarget.value || undefined)} data-setting="ttsVoiceURI2">
              <option value="">{S.setVoiceDefault}</option>
              {voices.map((v) => (
                <option key={v.uri} value={v.uri}>
                  {v.name} · {v.network ? S.setVoiceNetwork : S.setVoiceLocal}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div class="page__actions">
          <button type="button" class="btn" onClick={() => void speak(HELLO, { kana: HELLO, voiceURI: s.ttsVoiceURI })} data-voice-test>
            {S.setVoiceTest}
            {S.separator}
            <span lang="ja">{HELLO}</span>
          </button>
        </div>
        <label class="field">
          <span class="field__label">{S.setSpeedTier}</span>
          <select class="select" value={String(s.speedTier)} onChange={(e) => setField('speedTier', Number(e.currentTarget.value) as SpeedTier)} data-setting="speedTier">
            {TIERS.map((t) => (
              <option key={t} value={String(t)}>
                {t}
                {S.separator}
                {fmt(S.setSpeedTierHint, { rate: audio.rateForTier(t) })}
              </option>
            ))}
          </select>
          <span class="field__hint" data-speed-note>
            {S.setSpeedTierNote}
          </span>
        </label>
        <label class="field">
          <span class="field__label">{S.setSound}</span>
          <span class="set__range">
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={Math.round(s.sound * 100)}
              onInput={(e) => {
                const v = Math.min(1, Math.max(0, Number(e.currentTarget.value) / 100));
                setField('sound', v);
                services.audio.setVolume(v);
              }}
              aria-label={S.setSound}
              data-setting="sound"
            />
            <span class="set__range-value pixel">{fmt(S.percent, { n: Math.round(s.sound * 100) })}</span>
          </span>
          <span class="field__hint">{S.setSoundHint}</span>
        </label>
        <div class="set__switches">
          <Switch id="dataSaver" checked={dataSaverEffective(s, saverForced)} disabled={saverForced} label={S.setDataSaver} hint={saverForced ? S.setDataSaverForced : S.setDataSaverHint} onChange={(v) => setField('dataSaver', v)} />
        </div>
        <div class="field">
          <span class="field__label">{S.setSpeaking}</span>
          <Radios name="speaking" label={S.setSpeaking} value={s.speaking} options={SPEAKING} onChange={(v) => setField('speaking', v)} />
          <span class="field__hint">{S.setSpeakingNetwork}</span>
        </div>
      </section>

      {/* ── Reminders and rest ────────────────────────────────────────── */}
      <section class="panel page__section" aria-labelledby="set-reminders">
        <h2 id="set-reminders">{S.setReminders}</h2>
        <label class="field">
          <span class="field__label">{S.setRestDay}</span>
          <select class="select" value={s.restDay === null ? '' : String(s.restDay)} onChange={(e) => setField('restDay', e.currentTarget.value === '' ? null : Number(e.currentTarget.value))} data-setting="restDay">
            <option value="">{S.setRestDayNone}</option>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={String(i)}>
                {d}
              </option>
            ))}
          </select>
          <span class="field__hint">{S.setRestDayHint}</span>
        </label>
        <div class="field">
          <span class="field__label">{S.setReminder}</span>
          <span class="field__hint">{S.setReminderHint}</span>
          <div class="page__actions">
            <label class="field">
              <span class="visually-hidden">{S.setReminderTime}</span>
              <input class="input" type="time" value={reminderTime} onInput={(e) => setReminderTime(e.currentTarget.value)} aria-label={S.setReminderTime} data-reminder-time />
            </label>
            <button type="button" class="btn" onClick={makeIcs} data-ics-download>
              {S.setReminderDownload}
            </button>
          </div>
          <p class="page__status" role="status">
            {icsStatus === 'saved' ? S.setReminderDownloaded : icsStatus === 'fallback' ? S.setReminderFailed : ''}
          </p>
          {icsStatus === 'fallback' ? <pre class="set__ics" data-ics-text>{icsText}</pre> : null}
        </div>
      </section>

      {/* ── Privacy and data ──────────────────────────────────────────── */}
      <section class="panel page__section" aria-labelledby="set-privacy">
        <h2 id="set-privacy">{S.setPrivacy}</h2>
        <div class="set__meter" data-level={level} data-storage>
          <span class="field__label">{S.setStorage}</span>
          <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label={S.setStorage}>
            <div class="progress__fill" style={{ width: `${Math.max(1, ratio * 100)}%` }} />
          </div>
          <span class="muted" data-storage-text>
            {fmt(S.setStorageOf, { kb: num(kbOf(storage.bytes)), mb: (CEILING_BYTES / (1024 * 1024)).toFixed(1) })}
            {S.separator}
            {levelText}
          </span>
          <span class="field__hint">{S.setStorageHint}</span>
        </div>
        <div class="field">
          <span class="field__label">{S.setSlot}</span>
          <span class="field__hint" data-slot>
            {S.setSlotHint}
          </span>
        </div>
        <p class="muted">{S.onbPrivacy}</p>
        <div class="page__actions">
          <a class="btn" href={href({ name: 'backup' })}>
            {S.setBackup}
          </a>
          <a class="btn btn--ghost" href={href({ name: 'about' })}>
            {S.setRules}
            <span lang="ja"> {S.setRulesJa}</span>
          </a>
          <a class="btn btn--ghost" href={href({ name: 'about' })}>
            {S.setAbout}
          </a>
        </div>
      </section>

      {/* ── Danger zone ───────────────────────────────────────────────── */}
      <section class="panel page__section set__danger" aria-labelledby="set-danger">
        <h2 id="set-danger">{S.setDanger}</h2>
        <h3>{S.setResetTitle}</h3>
        <p>{S.setResetBody}</p>
        <label class="field">
          <span class="field__label">{S.setResetType}</span>
          <KanaInput value={resetTyped} onChange={setResetTyped} onSubmit={() => resetReady && setResetAsk(true)} label={S.setResetType} />
          {resetTyped.length > 0 && !resetReady ? <span class="field__hint">{S.setResetMismatch}</span> : null}
        </label>
        <div class="page__actions">
          <button type="button" class="btn btn--danger" disabled={!resetReady} onClick={() => setResetAsk(true)} data-reset>
            {S.setResetButton}
          </button>
          <span class="page__status" role="status">
            {resetDone ? S.setResetDone : ''}
          </span>
        </div>
        {resetAsk ? <Confirm text={S.setResetBody} yes={S.setResetButton} no={S.cancel} testId="reset" onYes={doReset} onNo={() => setResetAsk(false)} /> : null}
      </section>
    </div>
  );
}
