/**
 * TSUZUKU — `<NameField>`: the onboarding name step for a learner who has no
 * Japanese yet (design 02, Station 0 "What should the dojo call you?").
 *
 * Default mode is **English**: a plain text input, never the drill IME, so
 * "Christopher" stays Christopher instead of becoming chリsトpヘr. While the
 * text holds Latin letters the field looks the first word up in the names
 * dictionary (`suggestName`) and shows a suggestion card — the katakana,
 * a sound-it-out guide cut from the row's romaji (`soundGuide`), one sentence,
 * and a "Use クリストファー" button; Enter accepts a shown suggestion and
 * otherwise means Next. Accepting puts the katakana into the field (kana is
 * accepted as-is, pasted or typed), with a confirmation line and Change.
 *
 * With no dictionary row the field says so and offers two ways on: **Type it
 * by sound** switches to kana mode (`<KanaInput katakana>` plus a compact
 * guide that also explains any romaji still waiting for a vowel — the IME's
 * own lone pending letter is hidden here, see NameField.css), or **Keep … in
 * English**, which accepts the Latin spelling as the display name.
 *
 * The field is fully controlled through a `NameDraft` (text, mode, the Latin
 * spelling to restore, what was accepted), so the page keeps it across Back.
 * `resolveName(draft)` is the one place the draft becomes the display name:
 * kana mode is finalised through the IME, both are trimmed and cut to the
 * shared cap; `isKanaName` decides whether that name may also be
 * `profile.nameKana` (Latin letters are never saved there).
 */
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { S, fmt } from '@/i18n/strings';
import { clampGlyphs } from '@/shared/jp';
import { finalizeIme, imeStep } from '@/shared/kana-ime';
import { KanaInput } from '@/shared/ui/KanaInput';
import { NAME_MAX_GLYPHS } from '@/store';
import { soundGuideText, suggestName, type NameEntry } from './index';
import './NameField.css';

export type NameMode = 'english' | 'kana';
export type NameAccepted = 'suggestion' | 'latin' | null;

export interface NameDraft {
  /** The field's text: Latin letters or kana in English mode; kana plus pending romaji in kana mode. */
  text: string;
  mode: NameMode;
  /** The Latin spelling typed before a suggestion was accepted or kana mode was entered; Change / Back to English restore it. */
  latin: string;
  /** How the current text was accepted: a dictionary suggestion, the Latin spelling kept, or nothing yet. */
  accepted: NameAccepted;
}

export const EMPTY_NAME_DRAFT: NameDraft = { text: '', mode: 'english', latin: '', accepted: null };

/** Hiragana, katakana, ー, ・ and spaces only (the `shared/jp` kana classes plus spaces). */
const RE_KANA_NAME = /^[ぁ-ゖゝゞァ-ヺ・ーヽヾ\s　]+$/;
const RE_LATIN = /\p{Script=Latin}/u;

/** True when `s` is a non-blank name made only of kana (so it may be saved as `profile.nameKana`). */
export function isKanaName(s: string): boolean {
  return s.trim().length > 0 && RE_KANA_NAME.test(s);
}

/** True when `s` holds any Latin letter (accented ones included). */
export function hasLatin(s: string): boolean {
  return RE_LATIN.test(s);
}

/** The draft's display name: kana mode finalised through the IME, trimmed, cut to `max` glyphs; '' when blank. */
export function resolveName(d: NameDraft, max: number = NAME_MAX_GLYPHS): string {
  const raw = d.mode === 'kana' ? finalizeIme(d.text, { katakana: true }) : d.text;
  return clampGlyphs(raw.trim(), max);
}

/** The first word as the learner wrote it, first letter capitalised ("christopher bradford" → Christopher). */
export function shownWord(text: string): string {
  const first = text.trim().split(/\s+/)[0] ?? '';
  const glyphs = Array.from(first);
  if (glyphs.length === 0) return '';
  return glyphs[0]!.toLocaleUpperCase() + glyphs.slice(1).join('');
}

export interface NameFieldProps {
  value: NameDraft;
  onChange(next: NameDraft): void;
  /** Enter with no suggestion left to accept: the page's Next. */
  onSubmit(): void;
  /** Cap on the name in code points (default `NAME_MAX_GLYPHS`). */
  maxLength?: number;
  /** Dictionary lookup (default `suggestName`; tests pass a fixture table). */
  lookup?: (input: string) => NameEntry | null;
  autoFocus?: boolean;
  /** Base id for the input, its label and its helper text (default `onb-name`). */
  id?: string;
}

/** A template with one `{ja}` slot, the Japanese part marked `lang="ja"`. */
function Mixed(p: { template: string; ja: string }): JSX.Element {
  const i = p.template.indexOf('{ja}');
  if (i < 0) return <>{p.template}</>;
  return (
    <>
      {p.template.slice(0, i)}
      <span lang="ja">{p.ja}</span>
      {p.template.slice(i + 4)}
    </>
  );
}

export function NameField(p: NameFieldProps): JSX.Element {
  const id = p.id ?? 'onb-name';
  const helpId = `${id}-help`;
  const max = p.maxLength ?? NAME_MAX_GLYPHS;
  const lookup = p.lookup ?? suggestName;
  const d = p.value;
  const inputRef = useRef<HTMLInputElement>(null);

  // Imperative focus (never the `autofocus` attribute, lint rule 5); KanaInput focuses itself in kana mode.
  useEffect(() => {
    if (p.autoFocus && d.mode === 'english') inputRef.current?.focus();
  }, [p.autoFocus, d.mode]);

  const set = (next: Partial<NameDraft>): void => p.onChange({ ...d, ...next });

  /* ── English mode ─────────────────────────────────────────────────── */
  const kana = d.mode === 'english' && isKanaName(d.text);
  const latin = hasLatin(d.text);
  const entry: NameEntry | null = d.mode === 'english' && latin && !kana ? lookup(d.text) : null;
  const word = shownWord(d.text);
  const showNoMatch = d.mode === 'english' && latin && !kana && entry === null && d.accepted !== 'latin';
  const showKept = d.mode === 'english' && latin && !kana && d.accepted === 'latin';

  const onInput = (e: JSX.TargetedEvent<HTMLInputElement, Event>): void => {
    const raw = e.currentTarget.value;
    const v = clampGlyphs(raw, max);
    if (v !== raw) e.currentTarget.value = v;
    set({ text: v, accepted: null });
  };
  const accept = (): void => {
    if (!entry) return;
    set({ text: clampGlyphs(entry.kana, max), latin: d.text, accepted: 'suggestion' });
  };
  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    if (entry) accept();
    else p.onSubmit();
  };
  const keepLatin = (): void => set({ accepted: 'latin' });
  /** Back to editing: the kept Latin spelling just drops its note; an accepted kana name gives way to the Latin it came from. */
  const change = (): void => {
    if (d.accepted === 'latin') set({ accepted: null });
    else p.onChange({ text: d.latin, mode: 'english', latin: '', accepted: null });
  };
  const toKanaMode = (): void => p.onChange({ text: '', mode: 'kana', latin: d.text, accepted: null });

  /* ── Kana mode ────────────────────────────────────────────────────── */
  const fin = d.mode === 'kana' ? finalizeIme(d.text, { katakana: true }).trim() : '';
  const finIsKana = d.mode === 'kana' && isKanaName(fin);
  // Only letters that would still be stuck after Enter (a lone trailing n resolves to ン on its own).
  const unresolved = d.mode === 'kana' && !finIsKana ? imeStep(d.text, { katakana: true }).pending : '';
  const backToEnglish = (): void => p.onChange({ text: finIsKana ? fin : d.latin, mode: 'english', latin: finIsKana ? d.latin : '', accepted: null });

  if (d.mode === 'kana') {
    return (
      <div class="name-field" data-name-mode="kana">
        <div class="field">
          <label class="field__label" htmlFor={id}>
            {S.onbNameKanaLabel}
          </label>
          <KanaInput id={id} katakana value={d.text} onChange={(v) => set({ text: v, accepted: null })} onSubmit={() => p.onSubmit()} label={S.onbNameKanaLabel} maxLength={max} autoFocus={p.autoFocus} />
        </div>
        <div class="name-field__card name-field__card--kana" data-name-kana-guide>
          <div class="name-field__steps">
            <p>{S.onbNameSoundGuide1}</p>
            <p>{S.onbNameSoundGuide2}</p>
            <p>{S.onbNameSoundGuide3}</p>
            <p>{S.onbNameSoundGuide4}</p>
            {unresolved.length > 0 ? (
              <p class="name-field__pending" data-name-pending>
                {fmt(S.onbNamePending, { letters: unresolved })}
              </p>
            ) : null}
          </div>
          {finIsKana ? (
            <p data-name-confirm>
              <Mixed template={S.onbNameConfirm} ja={fin} />
            </p>
          ) : null}
          <button type="button" class="btn btn--ghost" onClick={backToEnglish} data-name-back>
            {S.onbNameBackToEnglish}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="name-field" data-name-mode="english">
      <div class="field">
        <label class="field__label" htmlFor={id}>
          {S.onbNameFieldLabel}
        </label>
        <input
          ref={inputRef}
          id={id}
          class="input name-field__input"
          type="text"
          value={d.text}
          autoComplete="off"
          autoCapitalize="words"
          spellcheck={false}
          enterKeyHint={entry ? 'done' : 'next'}
          aria-describedby={helpId}
          onInput={onInput}
          onKeyDown={onKeyDown}
          data-name-input
        />
        <p id={helpId} class="field__hint name-field__help">
          {S.onbNameHelp}
        </p>
      </div>
      <div class="name-field__live" aria-live="polite" data-name-live>
        {entry ? (
          <div class="name-field__card" data-name-suggest>
            <span class="name-field__kana" lang="ja" data-name-kana>
              {entry.kana}
            </span>
            <p class="name-field__guide">
              <span>{S.onbNameSoundItOut}</span>
              <span class="name-field__guide-text" data-name-guide>
                {soundGuideText(entry.romaji)}
              </span>
            </p>
            <p>{fmt(S.onbNameSuggestWhy, { name: word })}</p>
            <button type="button" class="btn" onClick={accept} data-name-accept>
              <Mixed template={S.onbNameUse} ja={entry.kana} />
            </button>
          </div>
        ) : null}
        {showNoMatch ? (
          <div class="name-field__card" data-name-nomatch>
            <p>{fmt(S.onbNameNoMatch, { name: word })}</p>
            <div class="name-field__row">
              <button type="button" class="btn" onClick={toKanaMode} data-name-sound>
                {S.onbNameTypeBySound}
              </button>
              <button type="button" class="btn btn--ghost" onClick={keepLatin} data-name-keep>
                {fmt(S.onbNameKeepEnglish, { name: word })}
              </button>
            </div>
          </div>
        ) : null}
        {showKept ? (
          <div class="name-field__card" data-name-kept>
            <p>{fmt(S.onbNameKeptNote, { name: word })}</p>
            <div class="name-field__row">
              <button type="button" class="btn btn--ghost" onClick={toKanaMode} data-name-sound>
                {S.onbNameTypeBySound}
              </button>
              <button type="button" class="btn btn--ghost" onClick={change} data-name-change>
                {S.onbNameChange}
              </button>
            </div>
          </div>
        ) : null}
        {kana ? (
          <div class="name-field__card name-field__card--kana" data-name-confirm>
            <p>
              <Mixed template={S.onbNameConfirm} ja={d.text.trim()} />
            </p>
            <button type="button" class="btn btn--ghost" onClick={change} data-name-change>
              {S.onbNameChange}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
