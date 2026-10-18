/**
 * TSUZUKU — `<Recorder>`: the MediaRecorder fallback for Shadow Strike
 * (design 04 §6 "Fallback", 05 §4 self-graded).
 *
 *  · Records up to `maxMs` (8 s) through `getUserMedia` + `MediaRecorder`,
 *    then lets the learner play the model (`speak()` with the line's `clip`
 *    key and `speaker`, design 08 §8, so the pack serves the same clip the
 *    drill played) and their own take side by side.
 *  · A three-item checklist (mora count, long vowels, pitch shape — hints
 *    from `scoring.checklistHints`) → `onSelfGrade(checklist)`, fired once.
 *    The caller maps it to a rating (`checklistToRating`) and samples the
 *    perception Judge.
 *  · Degrades honestly: without `mediaDevices` / `MediaRecorder` (or when
 *    the microphone is denied or missing) the checklist stands alone with a
 *    timer-only note. No AudioContext is touched (audio lives in src/audio):
 *    the level meter is CSS-only and animates while recording.
 *  · Keyboard: every control is a button or a checkbox; Space/Enter on the
 *    focused record button start and stop it.
 *  · The take's blob URL is revoked when a new take replaces it and on
 *    unmount (one effect keyed on the URL), so a Shadow set leaks nothing.
 */
import type { JSX } from 'preact';
import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { SHADOW_MAX_MS } from '@/audio';
import { toPlain } from '@/content/ruby';
import { speak } from '@/shared/audio';
import { S, fill } from '../strings';
import { checklistHints, type Checklist } from './scoring';
import './speaking.css';

export type RecorderState = 'unsupported' | 'idle' | 'requesting' | 'recording' | 'recorded' | 'denied' | 'no-mic' | 'error';

/** The slice of the media APIs the recorder uses; injectable for tests. */
export interface MediaApis {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  Recorder: typeof MediaRecorder;
}

export interface RecorderProps {
  /** Kana reading of the model line (drives the checklist hints). */
  modelKana: string;
  onSelfGrade(c: Checklist): void;
  /** Japanese (ruby or plain) of the model; default: the kana. */
  modelJa?: string;
  /** Pitch nucleus when the model is one word with pitch data. */
  pitch?: number;
  /** Recording cap in ms (default 8 000). */
  maxMs?: number;
  /** Plays the model; default `speak(toPlain(modelJa), { kana, clip, speaker })`. */
  onPlayModel?(): Promise<void> | void;
  /** Clip key of the model line (design 08 §8), passed to the default `speak()`. */
  clip?: string;
  /** Speaker label of the model line (cast voice on the clip path). */
  speaker?: string;
  disabled?: boolean;
  /** Media APIs (default: detected from `navigator` / `globalThis`). */
  media?: MediaApis | null;
}

/** `getUserMedia` + `MediaRecorder` when the host has both, else `null`. */
export function detectMedia(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator, g: typeof globalThis = globalThis): MediaApis | null {
  const md = nav?.mediaDevices;
  const Rec = (g as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (!md || typeof md.getUserMedia !== 'function' || typeof Rec !== 'function') return null;
  return { getUserMedia: (c) => md.getUserMedia(c), Recorder: Rec };
}

/** Maps a `getUserMedia` rejection onto a recorder state. */
export function stateForMediaError(err: unknown): RecorderState {
  const name = err instanceof Error ? err.name : typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'no-mic';
  return 'error';
}

const METER_BARS = 12;

export function Recorder(p: RecorderProps): JSX.Element {
  const id = useId();
  const media = useMemo<MediaApis | null>(() => (p.media === undefined ? detectMedia() : p.media), [p.media]);
  const maxMs = p.maxMs ?? SHADOW_MAX_MS;
  const [state, setState] = useState<RecorderState>(media ? 'idle' : 'unsupported');
  const [takeUrl, setTakeUrl] = useState<string | null>(null);
  const [checks, setChecks] = useState<Checklist>({ mora: false, longVowels: false, pitch: false });
  const [graded, setGraded] = useState(false);
  const [playingModel, setPlayingModel] = useState(false);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const alive = useRef(true);

  const hints = useMemo(() => checklistHints(p.modelKana, p.pitch), [p.modelKana, p.pitch]);

  const releaseStream = (): void => {
    const s = stream.current;
    if (s) for (const t of s.getTracks()) t.stop();
    stream.current = null;
  };

  const clearStopTimer = (): void => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
  };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearStopTimer();
      try {
        recorder.current?.stop();
      } catch {
        /* already stopped */
      }
      releaseStream();
    };
  }, []);

  // One revocation site: the previous URL goes when a take replaces it, the last one on unmount.
  useEffect(() => {
    if (!takeUrl) return;
    return () => URL.revokeObjectURL(takeUrl);
  }, [takeUrl]);

  const start = async (): Promise<void> => {
    if (!media || p.disabled || state === 'recording' || state === 'requesting') return;
    setState('requesting');
    let s: MediaStream;
    try {
      s = await media.getUserMedia({ audio: true });
    } catch (err) {
      if (alive.current) setState(stateForMediaError(err));
      return;
    }
    if (!alive.current) {
      for (const t of s.getTracks()) t.stop();
      return;
    }
    stream.current = s;
    let rec: MediaRecorder;
    try {
      rec = new media.Recorder(s);
    } catch {
      releaseStream();
      setState('error');
      return;
    }
    chunks.current = [];
    rec.ondataavailable = (ev: BlobEvent) => {
      if (ev.data && ev.data.size > 0) chunks.current.push(ev.data);
    };
    rec.onstop = () => {
      clearStopTimer();
      releaseStream();
      if (!alive.current) return;
      const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
      setTakeUrl(blob.size > 0 ? URL.createObjectURL(blob) : null);
      setState('recorded');
    };
    rec.onerror = () => {
      clearStopTimer();
      releaseStream();
      if (alive.current) setState('error');
    };
    recorder.current = rec;
    try {
      rec.start();
    } catch {
      releaseStream();
      setState('error');
      return;
    }
    setState('recording');
    stopTimer.current = setTimeout(() => stop(), maxMs);
  };

  const stop = (): void => {
    clearStopTimer();
    const rec = recorder.current;
    if (!rec) return;
    try {
      if (rec.state !== 'inactive') rec.stop();
    } catch {
      releaseStream();
      if (alive.current) setState('error');
    }
  };

  const playModel = async (): Promise<void> => {
    if (playingModel) return;
    setPlayingModel(true);
    try {
      if (p.onPlayModel) await p.onPlayModel();
      else {
        const plain = toPlain(p.modelJa ?? p.modelKana);
        await speak(plain, { kana: p.modelKana, ...(p.clip ? { clip: p.clip } : {}), ...(p.speaker ? { speaker: p.speaker } : {}) });
      }
    } finally {
      if (alive.current) setPlayingModel(false);
    }
  };

  const playTake = (): void => {
    const el = audioEl.current;
    if (!el || !takeUrl) return;
    try {
      el.currentTime = 0;
      const r = el.play();
      if (r && typeof r.catch === 'function') r.catch(() => undefined);
    } catch {
      /* jsdom / autoplay policy */
    }
  };

  const grade = (): void => {
    if (graded) return;
    setGraded(true);
    p.onSelfGrade(checks);
  };

  const toggle = (k: keyof Checklist): void => {
    if (graded) return;
    setChecks((c) => ({ ...c, [k]: !c[k] }));
  };

  const recordable = state === 'idle' || state === 'recorded';
  const seconds = Math.round(maxMs / 1000);
  const degradedNote = state === 'unsupported' ? S.recorderUnsupported : state === 'denied' ? S.recorderDenied : state === 'no-mic' ? S.recorderNoMic : state === 'error' ? S.recorderUnsupported : null;
  const longVowelLine = hints.longVowels.length > 0 ? fill(S.checkLongVowels, { list: hints.longVowels.join('・') }) : S.checkLongVowelsNone;
  const pitchLine = hints.pitch ? fill(S.checkPitch, { shape: S.pitchShape[hints.pitch] ?? hints.pitch }) : S.checkPitchNone;

  return (
    <section class="recorder sheet" data-state={state} aria-labelledby={`${id}-t`}>
      <h3 id={`${id}-t`} class="eyebrow">
        {S.recorderTitle}
      </h3>

      {degradedNote ? (
        <p class="recorder__note" role="status">
          {degradedNote} <span class="recorder__timer-note">{fill(S.recorderTimerOnly, { n: seconds })}</span>
        </p>
      ) : (
        <div class="recorder__controls">
          <button
            type="button"
            class={state === 'recording' ? 'btn recorder__rec recorder__rec--live' : 'btn recorder__rec'}
            onClick={() => (state === 'recording' ? stop() : void start())}
            disabled={p.disabled || state === 'requesting'}
            aria-pressed={state === 'recording'}
            aria-label={state === 'recording' ? S.stopRecording : state === 'recorded' ? S.recordAgain : S.record}
          >
            <span class="recorder__dot" aria-hidden="true" />
            {state === 'recording' ? S.stopRecording : state === 'recorded' ? S.recordAgain : S.record}
          </button>
          <div class="recorder__meter" role="img" aria-label={S.levelMeter} data-live={state === 'recording' ? 'true' : undefined}>
            {Array.from({ length: METER_BARS }, (_, i) => (
              <span key={i} class="recorder__bar" style={{ '--i': i } as JSX.CSSProperties} />
            ))}
          </div>
          <span class="recorder__cap" aria-live="polite">
            {state === 'recording' ? S.recording : fill(S.recordingUpTo, { n: seconds })}
          </span>
        </div>
      )}

      <div class="recorder__playback">
        <button type="button" class="btn btn--ghost" onClick={() => void playModel()} disabled={playingModel || !!p.disabled} aria-keyshortcuts="Space">
          {S.playModel}
        </button>
        {recordable && takeUrl ? (
          <button type="button" class="btn btn--ghost" onClick={playTake} disabled={!!p.disabled}>
            {S.playYours}
          </button>
        ) : null}
        {takeUrl ? <audio ref={audioEl} src={takeUrl} preload="auto" class="recorder__audio" /> : null}
      </div>
      {state === 'recorded' ? <p class="recorder__note">{S.recordedLine}</p> : null}

      <fieldset class="recorder__checklist" disabled={graded || !!p.disabled}>
        <legend class="eyebrow">{S.checklistTitle}</legend>
        <label class="recorder__check">
          <input type="checkbox" checked={checks.mora} onChange={() => toggle('mora')} data-check="mora" />
          <span>{fill(S.checkMora, { n: hints.morae })}</span>
        </label>
        <label class="recorder__check">
          <input type="checkbox" checked={checks.longVowels} onChange={() => toggle('longVowels')} data-check="longVowels" />
          <span>{longVowelLine}</span>
        </label>
        <label class="recorder__check">
          <input type="checkbox" checked={checks.pitch} onChange={() => toggle('pitch')} data-check="pitch" />
          <span>{pitchLine}</span>
        </label>
      </fieldset>

      <div class="recorder__actions">
        <button type="button" class="hanko recorder__grade" onClick={grade} disabled={graded || !!p.disabled} data-action="grade">
          {S.gradeMyself}
        </button>
        {graded ? (
          <p class="recorder__note" role="status">
            {S.gradedLine}
          </p>
        ) : null}
      </div>
    </section>
  );
}
