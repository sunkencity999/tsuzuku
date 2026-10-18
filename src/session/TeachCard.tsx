/**
 * TSUZUKU — `<TeachCard>` and `<PitchMark>`: the Scroll's teach card (design 05 §12).
 *
 *  One card per new item: word / pattern / character / glyph with its reading
 *  (spoken on tap), meaning, Tokyo pitch contour for vocab, the teaching lines
 *  (formation, explanation, mnemonic, hint), examples with TTS, collocations or
 *  components, the contrast item, and 既知 "I know this one". Shared by
 *  `<ScrollView>` (the standalone Scroll) and `<SessionView>` (a Scroll block
 *  inside a Kumite / Shugyō), so a new item is never checked before it is taught.
 *  Every speak button passes its clip key (design 08 §8): the headword plays
 *  `item.id` (words and kana), an example `${item.id}#ex${k}`; the pack voices
 *  what it has and the device voice covers the rest.
 */
import type { JSX } from 'preact';
import { toPlain } from '../content/ruby';
import type { ContentItem } from '../content/types';
import { speak } from '../shared/audio';
import { containsJapanese, moraSplit } from '../shared/jp';
import type { FuriganaMode, ItemKind } from '../shared/store-types';
import { Ruby } from '../shared/ui/Ruby';
import type { TeachModel } from './scroll';
import { S, fill } from './pages/strings';
import './TeachCard.css';

/* ────────────────────────────────────────────────────────────────────────── */
/* Pitch mark                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

/** Tokyo pitch: nucleus 0 = low then high (particle high); 1 = high then low; n = low, high up to mora n, then low. */
export function pitchHighs(moraCount: number, nucleus: number): { high: boolean[]; particleHigh: boolean } {
  const high: boolean[] = [];
  for (let i = 0; i < moraCount; i++) {
    if (nucleus === 0) high.push(i >= 1);
    else if (nucleus === 1) high.push(i === 0);
    else high.push(i >= 1 && i < nucleus);
  }
  return { high, particleHigh: nucleus === 0 };
}

export function PitchMark(p: { kana: string; pitch: number }): JSX.Element {
  const morae = moraSplit(p.kana);
  const { high, particleHigh } = pitchHighs(morae.length, p.pitch);
  const step = 18;
  const w = (morae.length + 1) * step;
  const y = (h: boolean): number => (h ? 7 : 19);
  const pts = [...high.map((h, i) => `${9 + i * step},${y(h)}`), `${9 + morae.length * step},${y(particleHigh)}`].join(' ');
  const label = p.pitch === 0 ? S.pitchFlat : fill(S.pitchDrop, { n: p.pitch });
  return (
    <span class="pitch-mark">
      <svg viewBox={`0 0 ${w} 26`} width={w} height="26" role="img" aria-label={`${S.pitchAria}: ${label}`}>
        <polyline class="pitch-mark__line" points={pts} />
        {high.map((h, i) => (
          <circle key={i} class="pitch-mark__dot" cx={9 + i * step} cy={y(h)} r="3.2" />
        ))}
        <circle class="pitch-mark__dot pitch-mark__dot--particle" cx={9 + morae.length * step} cy={y(particleHigh)} r="3.2" />
      </svg>
      <span class="pitch-mark__morae" lang="ja" aria-hidden="true">
        {morae.map((m, i) => (
          <span key={i} style={{ width: `${step}px` }}>
            {m}
          </span>
        ))}
      </span>
      <span class="pitch-mark__label">
        {S.pitchLabel}: {label}
      </span>
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Teach card                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

const PARTS_LABEL: Partial<Record<ItemKind, string>> = { vocab: S.partsVocab, chunk: S.partsVocab, kanji: S.partsKanji, grammar: S.partsGrammar, component: S.partsComponent };

function Ja(p: { text: string; class?: string }): JSX.Element {
  return containsJapanese(p.text) ? (
    <span lang="ja" class={p.class}>
      {p.text}
    </span>
  ) : (
    <span class={p.class}>{p.text}</span>
  );
}

export interface TeachCardProps {
  item: ContentItem;
  model: TeachModel;
  index: number;
  total: number;
  furigana: FuriganaMode;
  known: boolean;
  onKnown(): void;
  contrast?: TeachModel | null;
}

/** Kinds whose headword has a clip keyed by the item id in the pack (design 08 §8: words and kana; a kanji's lone glyph has no single reading). */
const HEAD_CLIP_KINDS: ReadonlySet<ItemKind> = new Set<ItemKind>(['vocab', 'chunk', 'kana']);

/** Clip key of the card's headword, or `undefined` when the pack holds none for this kind. */
export function headClipKey(item: Pick<ContentItem, 'id'>, kind: ItemKind): string | undefined {
  return HEAD_CLIP_KINDS.has(kind) ? item.id : undefined;
}

/** Clip key of the card's `k`-th example sentence (design 08 §8: `${itemId}#ex${k}` for vocab and grammar examples). */
export function exampleClipKey(item: Pick<ContentItem, 'id'>, k: number): string {
  return `${item.id}#ex${k}`;
}

export function TeachCard(p: TeachCardProps): JSX.Element {
  const m = p.model;
  // Every speak button passes its clip key (design 08 §8), so the pack voices the card and the device voice covers a miss.
  const say = (text: string, kana?: string, clip?: string): void => {
    void speak(text, kana || clip ? { ...(kana ? { kana } : {}), ...(clip ? { clip } : {}) } : undefined);
  };
  const headKana = m.kana && m.kana !== m.head ? m.kana : undefined;
  const parts = PARTS_LABEL[m.kind];
  return (
    <article class="scroll-card teach-card" data-kind={m.kind} style={{ '--i': p.index } as JSX.CSSProperties} aria-label={fill(S.cardOf, { i: p.index + 1, n: p.total })}>
      <header class="teach-card__head">
        <button type="button" class="teach-card__word" lang="ja" onClick={() => say(m.head, m.kana, headClipKey(p.item, m.kind))} title={S.speakButton}>
          {m.head}
        </button>
        {headKana ? (
          <span class="teach-card__kana" lang="ja">
            {headKana}
          </span>
        ) : null}
        <span class="teach-card__meaning">{m.meaning.join(' · ')}</span>
      </header>
      {m.pitch !== undefined && m.kana ? <PitchMark kana={m.kana} pitch={m.pitch} /> : null}
      {m.lines.length > 0 ? (
        <section class="teach-card__lines">
          <h4 class="teach-card__label">{m.kind === 'grammar' ? S.formationTitle : m.kind === 'vocab' || m.kind === 'chunk' ? S.notesTitle : S.mnemonicTitle}</h4>
          {m.lines.map((l, i) => (
            <p key={i} class="teach-card__line">
              <Ja text={l} />
            </p>
          ))}
        </section>
      ) : null}
      {m.examples.length > 0 ? (
        <section class="teach-card__examples">
          <h4 class="teach-card__label">{S.examplesTitle}</h4>
          <ul>
            {m.examples.map((ex, i) => (
              <li key={i} class="teach-card__example">
                <Ruby ja={ex.ja} mode={p.furigana} />
                <span class="teach-card__en">{ex.en}</span>
                <button type="button" class="btn btn--sm btn--ghost" onClick={() => say(toPlain(ex.ja), ex.kana, exampleClipKey(p.item, i))} aria-label={`${S.speakButton}: ${ex.kana}`}>
                  {S.speakButton}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {parts && m.parts.length > 0 ? (
        <section class="teach-card__parts">
          <h4 class="teach-card__label">{parts}</h4>
          <ul class="teach-card__chips">
            {m.parts.map((x, i) => (
              <li key={i} class="chip">
                <Ja text={x} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {p.contrast ? (
        <section class="teach-card__contrast">
          <h4 class="teach-card__label">{S.contrastTitle}</h4>
          <p>
            <span lang="ja">{p.contrast.head}</span>
            {p.contrast.kana && p.contrast.kana !== p.contrast.head ? (
              <span lang="ja" class="teach-card__kana">
                {p.contrast.kana}
              </span>
            ) : null}
            <span class="teach-card__en">{p.contrast.meaning.join(' · ')}</span>
          </p>
        </section>
      ) : null}
      <footer class="teach-card__foot">
        <button type="button" class="btn btn--sm" aria-pressed={p.known} disabled={p.known} onClick={p.onKnown}>
          {S.knownButton}
        </button>
        {p.known ? <span class="teach-card__known">{S.knownMarked}</span> : null}
      </footer>
    </article>
  );
}
