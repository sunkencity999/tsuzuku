/**
 * TSUZUKU — `<MichikusaStep>`: the 10-second roadside card inside a session
 * (design 04 §10, 06 §6).
 *
 * Not an exercise: nothing is graded. The card shows the fragment (title, a
 * short English body, an optional Japanese quote with ruby and a Listen
 * button) and one Continue. On Continue a fragment that is not yet in the
 * Library is added to `collections.michikusa` and `michikusa:read` is emitted
 * exactly once (B grants the 5 XP); a fragment already collected is shown
 * flagged "again" and emits nothing (no XP, design 04 §10). The builder picks
 * the fragment (`builder.michikusaFor`); this component only reads it, loading
 * the file on demand when it is not in memory yet. The ten-second read line is
 * a `.meter` whose fill hiku-draws (scale, never width — design 09 §6.7); it is
 * decorative pacing, never a gate.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { content as appContent, type ContentLoader } from '../content/loader';
import { toPlain } from '../content/ruby';
import type { MichikusaItem } from '../content/types';
import { speak } from '../shared/audio';
import { bus } from '../shared/events';
import { Ruby } from '../shared/ui/Ruby';
import { store } from '../store';
import { S } from './strings';
import './MichikusaStep.css';

export interface MichikusaStepProps {
  id: string;
  onDone(): void;
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
}

function isMichikusa(x: unknown): x is MichikusaItem {
  return !!x && typeof x === 'object' && 'bodyEn' in x && 'titleEn' in x && 'kind' in x;
}

/** Adds `id` to the Library once and emits `michikusa:read`; a collected id is a no-op and returns false. */
export function collectMichikusa(id: string): boolean {
  if (store.collections.value.michikusa.includes(id)) return false;
  store.patch('collections', (c) => (c.michikusa.includes(id) ? c : { ...c, michikusa: [...c.michikusa, id] }));
  bus.emit('michikusa:read', { id });
  return true;
}

export function MichikusaStep(p: MichikusaStepProps): JSX.Element {
  const loader = p.loader ?? appContent;
  const [item, setItem] = useState<MichikusaItem | null>(() => {
    const got = loader.get(p.id);
    return isMichikusa(got) ? got : null;
  });
  const [missing, setMissing] = useState(false);
  // Frozen at mount: the card is "again" when it was already in the Library before this rep.
  const again = useMemo(() => store.collections.value.michikusa.includes(p.id), [p.id]);
  const done = useRef(false);
  const continueRef = useRef<HTMLButtonElement>(null);

  // `autofocus` only applies on page load; a card that appears mid-session focuses its one control itself.
  useEffect(() => {
    continueRef.current?.focus();
  }, [p.id]);

  useEffect(() => {
    done.current = false;
    if (item && item.id === p.id) return;
    let alive = true;
    const got = loader.get(p.id);
    if (isMichikusa(got)) {
      setItem(got);
      setMissing(false);
      return;
    }
    loader
      .getAsync(p.id)
      .then((x) => {
        if (!alive) return;
        if (isMichikusa(x)) setItem(x);
        else setMissing(true);
      })
      .catch(() => {
        if (alive) setMissing(true);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id, loader]);

  const finish = (): void => {
    if (done.current) return;
    done.current = true;
    if (item && !again) collectMichikusa(p.id);
    p.onDone();
  };

  const listen = (): void => {
    if (!item?.ja) return;
    const o = item.kana ? { kana: item.kana } : undefined;
    void speak(toPlain(item.ja), o);
  };

  const feel = store.settings.value.feel;
  const reduced = store.settings.value.reducedMotion;
  const kindLabel = item ? S.michikusaKind[item.kind] : '';

  return (
    <section
      class={`michikusa scroll-card${reduced ? ' reduced-motion' : ''}`}
      data-feel={feel}
      data-again={again ? 'true' : undefined}
      data-kind={item?.kind}
      aria-label={S.michikusaAria}
    >
      <header class="michikusa__head">
        <span class="michikusa__glyph" lang="ja" aria-hidden="true">
          道
        </span>
        <span class="michikusa__label">
          <span lang="ja">{S.michikusaJa}</span> {S.michikusaLabel}
        </span>
        {item ? <span class="chip chip--tag michikusa__kind">{kindLabel}</span> : null}
        <span class={`chip michikusa__state${again ? '' : ' chip--accent'}`}>{again ? S.michikusaAgain : S.michikusaNew}</span>
      </header>

      {item ? (
        <article class="michikusa__body">
          <h2 class="michikusa__title scroll-card__title">{item.titleEn}</h2>
          {item.ja ? (
            <div class="michikusa__quote">
              <p class="michikusa__ja">
                <Ruby ja={item.ja} mode="always" />
              </p>
              {item.kana ? (
                <p class="michikusa__kana" lang="ja">
                  {item.kana}
                </p>
              ) : null}
              <button type="button" class="btn btn--ghost btn--sm michikusa__listen" onClick={listen} aria-label={S.michikusaListen}>
                {S.michikusaListen}
              </button>
            </div>
          ) : null}
          <p class="michikusa__text">{item.bodyEn}</p>
          {item.sourceNote ? (
            <p class="michikusa__source muted">
              <span class="michikusa__source-label">{S.michikusaSource}</span> {item.sourceNote}
            </p>
          ) : null}
        </article>
      ) : (
        <article class="michikusa__body">
          <p class="michikusa__text muted" role={missing ? 'status' : undefined}>
            {missing ? S.michikusaMissing : S.settingUp}
          </p>
        </article>
      )}

      <footer class="michikusa__foot">
        <div class="meter michikusa__read" style="--value:1" aria-hidden="true">
          <div class="meter__fill michikusa__read-fill" />
        </div>
        <span class="sr-only">{S.michikusaReadTime}</span>
        <button type="button" class="hanko michikusa__continue" onClick={finish} ref={continueRef} aria-keyshortcuts="Enter">
          {S.michikusaContinue}
          <kbd aria-hidden="true">↵</kbd>
        </button>
      </footer>
    </section>
  );
}
