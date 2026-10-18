/**
 * TSUZUKU — tap-gloss popover (design 04 §7, 05 §13).
 *
 * Opened by a token tap in the reader. The host resolves the item behind the
 * token (`StoryLine.tokenIds[i]` → `content.get` / `getAsync`) and passes it
 * here; this component only shows and offers:
 *   - word with ruby, kana reading, pitch line (as text: type + a high/low
 *     mora strip) whenever `pitch` is present (never claims TTS proves it);
 *   - J-E meanings through Green; from Purple (`jj`) the J-J `definitionJa`
 *     with English behind a tap (04 §2, 05 §13 "English-first reveal past Purple");
 *   - 1–3 collocations and the writer's note;
 *   - grammar points (pattern · meaning · formation) and kanji (meanings ·
 *     readings) when the token resolved to one;
 *   - a token the corpus does not carry: the surface, its reading from the
 *     line's ruby, and a Bookmark;
 *   - TTS of the word (`speak(word, {kana})`, isolated word → kana reading);
 *   - 「捕まえる」Capture for an unintroduced WORD (the host writes
 *     `store.captured` through `capture.ts`), "In training" for one with cards;
 *     grammar and kanji are never captured (`intro-policy` routes only vocab
 *     captures into Scrolls): they get the `station` line instead.
 * Esc, the backdrop and the close button all close it. Focus management is
 * `useDialogFocus` (01 §7): Close takes focus on open, Tab / Shift+Tab wrap
 * inside the sheet, Escape is consumed, and focus returns to the tapped token
 * when the sheet unmounts. Copy lives in `./strings.ts`.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { hasKanji, toPlain } from '@/content/ruby';
import type { ContentItem, GrammarItem, KanjiItem, VocabItem } from '@/content/types';
import { speak } from '@/shared/audio';
import { moraSplit } from '@/shared/jp';
import { Ruby } from '@/shared/ui/Ruby';
import { useDialogFocus } from '@/shared/ui/use-dialog-focus';
import { S } from './strings';
import './reader.css';

/** What the action button means for this token. */
/** `station`: a grammar point / kanji that comes with its station Scroll (not capturable). */
export type CaptureState = 'capture' | 'captured' | 'bookmark' | 'bookmarked' | 'introduced' | 'station' | 'none';

export interface GlossProps {
  /** Item behind the token; `null` when the corpus has none (or while loading). */
  item: ContentItem | null;
  /** Plain token surface as it appears in the line. */
  token: string;
  /** Kana reading of the token span taken from the line's ruby (fallback display). */
  reading?: string;
  /** J-J reveal: `definitionJa` first, English behind a tap. */
  jj: boolean;
  /** The item is still being fetched (`getAsync`). */
  loading?: boolean;
  capture?: CaptureState;
  onCapture(): void;
  onClose(): void;
}

export function isVocabItem(i: ContentItem | null | undefined): i is VocabItem {
  return !!i && 'word' in i && 'meanings' in i && 'kana' in i && 'jlpt' in i;
}
export function isGrammarItem(i: ContentItem | null | undefined): i is GrammarItem {
  return !!i && 'pattern' in i && 'clozeHints' in i;
}
export function isKanjiItem(i: ContentItem | null | undefined): i is KanjiItem {
  return !!i && 'char' in i && 'strokes' in i && 'meanings' in i;
}

export type PitchType = 'heiban' | 'atamadaka' | 'nakadaka' | 'odaka';

/** Standard-Japanese accent type from the nucleus (0 = flat; n = drop after mora n). */
export function pitchType(pitch: number, kana: string): PitchType {
  const n = moraSplit(kana).length;
  if (pitch <= 0) return 'heiban';
  if (pitch === 1) return 'atamadaka';
  if (pitch >= n) return 'odaka';
  return 'nakadaka';
}

/** Per-mora high/low strip: mora 1 low unless 頭高; high up to the nucleus, low after. */
export function pitchMorae(pitch: number, kana: string): { mora: string; high: boolean }[] {
  const morae = moraSplit(kana);
  return morae.map((mora, i) => {
    const idx = i + 1;
    if (pitch <= 0) return { mora, high: idx > 1 };
    if (pitch === 1) return { mora, high: idx === 1 };
    return { mora, high: idx > 1 && idx <= pitch };
  });
}

/** `{word|kana}` markup for the headword when it carries kanji; the plain word otherwise. */
export function headwordRuby(v: VocabItem): string {
  if (!hasKanji(v.word) || v.word === v.kana) return v.word;
  return `{${v.word}|${v.kana}}`;
}

function defaultCapture(item: ContentItem | null): CaptureState {
  if (!item) return 'bookmark';
  if (isVocabItem(item)) return 'capture';
  return isGrammarItem(item) || isKanjiItem(item) ? 'station' : 'none';
}

export function Gloss(p: GlossProps): JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const [enShown, setEnShown] = useState(false);

  useDialogFocus(ref, { onClose: p.onClose, initial: '[data-action="close"]' });
  useEffect(() => {
    setEnShown(false);
  }, [p.item, p.token]);

  const capture = p.capture ?? defaultCapture(p.item);
  const vocab = isVocabItem(p.item) ? p.item : null;
  const grammar = isGrammarItem(p.item) ? p.item : null;
  const kanji = isKanjiItem(p.item) ? p.item : null;

  const sayIt = (): void => {
    if (vocab) void speak(vocab.word, { kana: vocab.kana });
    else if (kanji) void speak(kanji.char, { kana: kanji.kun[0]?.replace('.', '') ?? kanji.on[0] });
    else void speak(p.token, p.reading ? { kana: p.reading } : undefined);
  };

  const jjDefinition = p.jj && vocab?.definitionJa ? vocab.definitionJa : null;
  const showMeanings = !jjDefinition || enShown;

  const actionButton = ((): JSX.Element | null => {
    switch (capture) {
      case 'capture':
        return (
          <button type="button" class="btn" onClick={() => p.onCapture()} data-action="capture">
            {S.capture}
            <span class="gloss__ja-sub" lang="ja" aria-hidden="true">
              {S.captureJa}
            </span>
          </button>
        );
      case 'captured':
        return (
          <button type="button" class="btn" disabled aria-disabled="true" data-action="captured">
            {S.captured}
          </button>
        );
      case 'bookmark':
        return (
          <button type="button" class="btn" onClick={() => p.onCapture()} data-action="bookmark">
            {S.bookmark}
          </button>
        );
      case 'bookmarked':
        return (
          <button type="button" class="btn" disabled aria-disabled="true" data-action="bookmarked">
            {S.bookmarked}
          </button>
        );
      default:
        return null;
    }
  })();

  return (
    <>
      <div class="gloss-backdrop" data-testid="gloss-backdrop" onClick={() => p.onClose()} />
      <section ref={ref} class="gloss" role="dialog" aria-modal="true" aria-label={S.glossTitle} tabIndex={-1} data-capture={capture}>
        <header class="gloss__head">
          <div>
            <p class="gloss__word" lang="ja">
              {vocab ? <Ruby ja={headwordRuby(vocab)} mode="always" /> : kanji ? kanji.char : grammar ? toPlain(grammar.pattern) : p.token}
            </p>
            {vocab && vocab.kana !== vocab.word ? (
              <span class="gloss__reading" lang="ja" data-field="reading">
                {vocab.kana}
              </span>
            ) : !vocab && p.reading && p.reading !== p.token ? (
              <span class="gloss__reading" lang="ja" data-field="reading">
                {p.reading}
              </span>
            ) : null}
          </div>
          <div class="gloss__actions">
            <button type="button" class="btn btn--ghost btn--sm" onClick={sayIt} aria-label={S.glossSpeak} data-action="speak">
              {S.glossSpeak}
            </button>
            <button type="button" class="btn btn--ghost btn--sm" onClick={() => p.onClose()} aria-label={S.glossClose} data-action="close">
              {S.glossClose}
            </button>
          </div>
        </header>

        {p.loading ? (
          <p class="gloss__status" role="status">
            {S.glossLoading}
          </p>
        ) : null}

        {vocab ? (
          <dl class="gloss__body">
            {vocab.pitch !== undefined ? (
              <>
                <dt class="eyebrow">{S.glossPitch}</dt>
                <dd>
                  <span class="gloss__pitch" data-field="pitch">
                    <span>
                      {S.pitchType[pitchType(vocab.pitch, vocab.kana)]} [{vocab.pitch}]
                    </span>
                    <span class="gloss__pitch-mora" lang="ja" aria-hidden="true">
                      {pitchMorae(vocab.pitch, vocab.kana).map((m, i) => (
                        <span key={i} data-high={m.high ? 'true' : 'false'}>
                          {m.mora}
                        </span>
                      ))}
                    </span>
                  </span>
                </dd>
              </>
            ) : null}
            {jjDefinition ? (
              <>
                <dt class="eyebrow">{S.glossDefinition}</dt>
                <dd lang="ja" data-field="definition">
                  <Ruby ja={jjDefinition.ja} mode="always" />
                </dd>
              </>
            ) : null}
            {showMeanings ? (
              <>
                <dt class="eyebrow">{S.glossMeaning}</dt>
                <dd data-field="meanings">{vocab.meanings.join(' · ')}</dd>
              </>
            ) : (
              <dd>
                <button type="button" class="btn btn--ghost btn--sm" onClick={() => setEnShown(true)} data-action="show-en">
                  {S.glossShowEnglish}
                </button>
              </dd>
            )}
            {vocab.collocations && vocab.collocations.length > 0 ? (
              <>
                <dt class="eyebrow">{S.glossCollocations}</dt>
                <dd>
                  <ul class="gloss__list" lang="ja" data-field="collocations">
                    {vocab.collocations.map((c) => (
                      <li key={c} class="chip">
                        {c}
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            ) : null}
            {vocab.notes ? (
              <>
                <dt class="eyebrow">{S.glossNotes}</dt>
                <dd data-field="notes">{vocab.notes}</dd>
              </>
            ) : null}
          </dl>
        ) : grammar ? (
          <dl class="gloss__body">
            <dt class="eyebrow">{S.glossPattern}</dt>
            <dd lang="ja" data-field="pattern">
              <Ruby ja={grammar.pattern} mode="always" />
            </dd>
            <dt class="eyebrow">{S.glossMeaning}</dt>
            <dd data-field="meanings">{grammar.meaning}</dd>
            {grammar.formation[0] ? (
              <>
                <dt class="eyebrow">{S.glossFormation}</dt>
                <dd lang="ja" data-field="formation">
                  {grammar.formation[0]}
                </dd>
              </>
            ) : null}
          </dl>
        ) : kanji ? (
          <dl class="gloss__body">
            <dt class="eyebrow">{S.glossMeaning}</dt>
            <dd data-field="meanings">{kanji.meanings.join(' · ')}</dd>
            <dt class="eyebrow">{S.glossReading}</dt>
            <dd lang="ja" data-field="readings">
              {[...kanji.on, ...kanji.kun].join('・')}
            </dd>
          </dl>
        ) : !p.loading ? (
          <div class="gloss__body">
            <p class="gloss__status" data-field="no-item">
              {S.glossNoItem}
            </p>
            <p class="gloss__status">{S.glossNoItemHint}</p>
          </div>
        ) : null}

        {capture === 'introduced' ? (
          <p class="gloss__status" data-field="in-training">
            <span class="chip chip--accent">{S.inTraining}</span> {S.inTrainingHint}
          </p>
        ) : null}
        {capture === 'captured' ? <p class="gloss__status">{S.capturedHint}</p> : null}
        {capture === 'station' ? (
          <p class="gloss__status" data-field="station-scroll">
            {S.stationScrollHint}
          </p>
        ) : null}

        {actionButton ? <div class="gloss__actions">{actionButton}</div> : null}
      </section>
    </>
  );
}
