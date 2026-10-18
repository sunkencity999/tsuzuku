/**
 * TSUZUKU — `#/radio` 茶屋ラジオ Teahouse Radio page (design 08 §10.2).
 *
 * Wraps `<Radio>` with a way back (the dojo, the learner's station) and the
 * honesty line: every voice is synthetic, the minutes go to the ledger as
 * dojo listening, nothing here earns XP or lights the flame. The page itself
 * never writes the store or emits an event; the player emits `listen:played`
 * and B's reducers turn it into the ledger row and the counters.
 */
import type { JSX } from 'preact';
import type { ContentLoader } from '@/content/loader';
import type { ClipPlayer } from '@/shared/audio';
import { href, type Route } from '@/shared/routes';
import { store } from '@/store';
import { Radio, type RadioInputs } from '../listening/Radio';
import { S, fill } from '../listening/radio-strings';
import './RadioPage.css';

export interface RadioPageProps {
  route: Route;
  /** Content access (default: the live loader); tests pass `createFakeLoader()`. */
  loader?: ContentLoader;
  /** The pack player; `undefined` → `services.audio.clips`, `null` → none. */
  clips?: ClipPlayer | null;
  /** Ready-made playlist inputs (tests). */
  inputs?: RadioInputs;
}

export default function RadioPage(p: RadioPageProps): JSX.Element {
  const station = store.progress.value.station;
  return (
    <section class="radio-page" aria-label={S.title}>
      <nav class="radio-page__nav" aria-label={S.pageNav}>
        <a class="btn btn--ghost btn--sm" href={href({ name: 'dojo' })}>
          {S.pageBack}
        </a>
        {station >= 1 ? (
          <a class="btn btn--ghost btn--sm" href={href({ name: 'station', n: station })}>
            {fill(S.pageStation, { n: station })}
          </a>
        ) : null}
        <span class="radio-page__hint">{S.pageSettings}</span>
      </nav>
      <Radio loader={p.loader} clips={p.clips} inputs={p.inputs} />
      <p class="radio-page__note">{S.pageHonesty}</p>
    </section>
  );
}
