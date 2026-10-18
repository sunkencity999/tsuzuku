/**
 * TSUZUKU — `<KanaInput>`: controlled romaji → kana field (ARCHITECTURE §4, design 04 §0).
 *
 * The field shows `kana + pending romaji` (unresolved trailing letters stay
 * visible); a raw romaji buffer is kept behind it so multi-key spellings
 * (kan·n·a → かんな) resolve as they are typed. `value` is that display string;
 * when the parent sets a different `value` (clear after submit, a preset
 * answer) the buffer re-bases on it.
 *
 *  · Enter      → `onChange(final)` if the trailing romaji resolves (hon → ほん),
 *                 then `onSubmit(final)`. Shift+Enter is left to the frame (Guard).
 *  · Space      → cycles `candidates` (kanji homophones) when provided.
 *  · Caps Lock  → toggles katakana mode, as does the カナ button; `katakana`
 *                 prop sets the initial mode (and re-syncs when it changes).
 *  · Native IME composition is passed through untouched; the converter is
 *                 idempotent on kana, so composed text is never double-converted.
 *  · `maxLength` caps the RESOLVED kana at that many code points in the IME
 *                 path — typed, pasted and natively composed text alike, and
 *                 the Enter finalisation. Pending romaji may run past the cap
 *                 while a syllable is being spelled (the glyph it resolves to
 *                 is then dropped), which is why the native `maxlength`
 *                 attribute is deliberately NOT set: it counts UTF-16 units of
 *                 kana + pending letters and would block `shi` at the boundary.
 *  · Focus        → the field's wrapper (`.kana-input__ink`) takes `.ink-hiku`
 *                 `[data-axis="x"]` and an indigo rule (the focus border's ink,
 *                 lifted 4 px above it so the draw reads) draws under the kana
 *                 over `--dur-2` (design 09 §12.1 d58; a scaled pseudo-element,
 *                 never width); under reduced motion the class is never set and
 *                 the line simply stands. The caret stays vermilion either way.
 */
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { clampGlyphs } from '../jp';
import { finalizeIme, imeStep } from '../kana-ime';
import { S } from './strings';
import { prefersReducedMotion } from './use-reveal';
import './ui.css';

export interface KanaInputProps {
  /** Display value: resolved kana plus pending romaji. */
  value: string;
  onChange(v: string): void;
  /** Receives the finalized value (callers typed `onSubmit(): void` are fine). */
  onSubmit(v: string): void;
  katakana?: boolean;
  /** Kanji candidates Space cycles through (production-forge). */
  candidates?: string[];
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Accessible name; default "Answer". */
  label?: string;
  id?: string;
  /** Cap on the resolved value in code points, applied in the IME path (composition and paste bypass a native attribute). */
  maxLength?: number;
}

function isComposingEvent(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
}

export function KanaInput(p: KanaInputProps): JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  const raw = useRef<string>(p.value);
  const lastDisplay = useRef<string>(p.value);
  const composing = useRef(false);
  const cycle = useRef<{ base: string; idx: number } | null>(null);
  const [kata, setKata] = useState<boolean>(Boolean(p.katakana));
  const [pending, setPending] = useState<string>('');
  const [focused, setFocused] = useState(false);
  const kataRef = useRef(kata);
  kataRef.current = kata;

  // Parent-driven value changes re-base the raw buffer.
  useLayoutEffect(() => {
    if (p.value !== lastDisplay.current) {
      raw.current = p.value;
      lastDisplay.current = p.value;
      cycle.current = null;
      const st = imeStep(p.value, { katakana: kataRef.current });
      setPending(st.pending);
    }
  }, [p.value]);

  useEffect(() => {
    setKata(Boolean(p.katakana));
  }, [p.katakana]);

  useEffect(() => {
    if (p.autoFocus) ref.current?.focus();
  }, [p.autoFocus]);

  const max = p.maxLength !== undefined && p.maxLength >= 0 ? Math.floor(p.maxLength) : undefined;
  const cap = (s: string): string => (max === undefined ? s : clampGlyphs(s, max));

  const emit = (display: string, pend: string): void => {
    lastDisplay.current = display;
    setPending(pend);
    if (display !== p.value) p.onChange(display);
    // Same value as before (a paste cut back to the cap): the parent will not re-render, so pull the DOM back ourselves.
    else if (ref.current && ref.current.value !== display) ref.current.value = display;
  };

  const convert = (buffer: string, katakana: boolean): void => {
    let st = imeStep(buffer, { katakana });
    if (max !== undefined && Array.from(st.text).length > max) {
      // Over the cap: keep the first `max` resolved glyphs and drop the overflow with any pending romaji
      // (the converter is idempotent on kana, so re-basing the buffer on the cut text is stable).
      buffer = clampGlyphs(st.text, max);
      st = imeStep(buffer, { katakana });
    }
    raw.current = buffer;
    emit(st.text + st.pending, st.pending);
  };

  const toggleKata = (): void => {
    const next = !kataRef.current;
    kataRef.current = next;
    setKata(next);
    convert(raw.current, next);
  };

  const onInput = (e: JSX.TargetedEvent<HTMLInputElement, Event>): void => {
    const v = e.currentTarget.value;
    cycle.current = null;
    if (composing.current) {
      // Mid-composition text is the IME's; it is capped once `compositionend` hands it over.
      raw.current = v;
      emit(v, '');
      return;
    }
    const prev = lastDisplay.current;
    let buffer: string;
    if (v.length > prev.length && v.startsWith(prev)) {
      buffer = raw.current + v.slice(prev.length);
    } else if (v.length < prev.length && prev.startsWith(v)) {
      const removed = prev.length - v.length;
      const pend = imeStep(raw.current, { katakana: kataRef.current }).pending;
      buffer = removed <= pend.length ? raw.current.slice(0, raw.current.length - removed) : v;
    } else {
      buffer = v;
    }
    convert(buffer, kataRef.current);
  };

  // Composition events are attached imperatively: browsers expose no
  // `oncompositionstart` IDL attribute, so a JSX prop would be mis-cased.
  const onCompositionEnd = useRef<(v: string) => void>(() => undefined);
  onCompositionEnd.current = (v: string) => convert(v, kataRef.current);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = (): void => {
      composing.current = true;
    };
    const end = (): void => {
      composing.current = false;
      onCompositionEnd.current(el.value);
    };
    el.addEventListener('compositionstart', start);
    el.addEventListener('compositionend', end);
    return () => {
      el.removeEventListener('compositionstart', start);
      el.removeEventListener('compositionend', end);
    };
  }, []);

  const cycleCandidates = (): void => {
    const cands = p.candidates ?? [];
    if (cands.length === 0) return;
    const current = lastDisplay.current;
    let c = cycle.current;
    if (c === null || (current !== c.base && current !== cands[c.idx])) {
      c = { base: current, idx: -1 };
    }
    const nextIdx = c.idx + 1;
    const next = cap(nextIdx >= cands.length ? c.base : (cands[nextIdx] as string));
    cycle.current = nextIdx >= cands.length ? null : { base: c.base, idx: nextIdx };
    raw.current = next;
    emit(next, '');
  };

  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>): void => {
    if (isComposingEvent(e)) return;
    if (e.key === 'CapsLock') {
      e.preventDefault();
      toggleKata();
      return;
    }
    if (e.key === ' ' && (p.candidates?.length ?? 0) > 0 && lastDisplay.current.length > 0) {
      e.preventDefault();
      cycleCandidates();
      return;
    }
    if (e.key === 'Enter') {
      if (e.shiftKey) return; // Guard belongs to the frame
      e.preventDefault();
      e.stopPropagation();
      const final = cap(finalizeIme(raw.current, { katakana: kataRef.current }));
      if (final !== lastDisplay.current) {
        raw.current = final;
        emit(final, '');
      }
      p.onSubmit(final);
    }
  };

  const hasCandidates = (p.candidates?.length ?? 0) > 0;
  // the hiku underline draws on focus; reduced motion shows it standing (CSS :focus-within), no verb class
  const hiku = focused && !prefersReducedMotion();

  return (
    <div class="kana-input" data-katakana={kata ? 'true' : 'false'} data-pending={pending || undefined}>
      <span class={hiku ? 'kana-input__ink ink-hiku' : 'kana-input__ink'} data-axis={hiku ? 'x' : undefined}>
        <input
          ref={ref}
          id={p.id}
          class="kana-input__field"
          type="text"
          lang="ja"
          value={p.value}
          placeholder={p.placeholder}
          disabled={p.disabled}
          aria-label={p.label ?? S.answerField}
          autoComplete="off"
          autoCapitalize="off"
          autocorrect="off"
          spellcheck={false}
          enterKeyHint="done"
          onInput={onInput}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </span>
      <button
        type="button"
        class="kana-input__kata"
        aria-pressed={kata}
        aria-label={S.katakanaToggle}
        title={S.katakanaToggle}
        disabled={p.disabled}
        onClick={toggleKata}
      >
        <span lang="ja">カナ</span>
      </button>
      <div class="kana-input__meta">
        <span class="kana-input__pending" aria-hidden="true">
          {pending}
        </span>
        {hasCandidates ? <span class="kana-input__hint">{S.candidatesHint}</span> : null}
      </div>
    </div>
  );
}
