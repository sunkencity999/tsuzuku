/**
 * TSUZUKU — 仕組み About / How this game works (group A, design 06 §7 #9–#10).
 *
 * What TSUZUKU is and how it teaches, the scheduler / grading map / ki /
 * Judge / governors in plain language, the ten rules of the dojo (道場の掟),
 * privacy, credits, licences (code MIT, `LICENSE`; content and art CC BY-SA
 * 4.0, `CONTENT_LICENSE.md`; fonts OFL under `public/fonts/OFL-*.txt`;
 * wanakana and Preact MIT), the app and content versions, and a small
 * debug panel: rooms that did not load (`pages.loadErrors`) and the last bus
 * events. No franchise references anywhere.
 */
import type { JSX } from 'preact';
import { content } from '@/content/loader';
import { services, type ClipPlayer } from '@/shared/audio';
import { bus } from '@/shared/events';
import { href, type Route } from '@/shared/routes';
import { store } from '@/store';
import { useClipPlayer } from '../hooks';
import { loadErrors } from '../pages';
import { S, fmt } from './strings';
import './pages.css';

const env = import.meta.env as Record<string, string | undefined>;
/** `VITE_APP_VERSION` when the build defines it; package.json's version otherwise. */
export const APP_VERSION: string = env.VITE_APP_VERSION ?? '0.1.0';

export const RULES: readonly string[] = [S.aboutRule1, S.aboutRule2, S.aboutRule3, S.aboutRule4, S.aboutRule5, S.aboutRule6, S.aboutRule7, S.aboutRule8, S.aboutRule9, S.aboutRule10];

const HOW: readonly { title: string; body: string }[] = [
  { title: S.aboutFsrsTitle, body: S.aboutFsrs },
  { title: S.aboutGradingTitle, body: S.aboutGrading },
  { title: S.aboutKiTitle, body: S.aboutKi },
  { title: S.aboutJudgeTitle, body: S.aboutJudge },
  { title: S.aboutGovernorTitle, body: S.aboutGovernor },
];

const LICENSES: readonly string[] = [S.aboutLicenseCode, S.aboutLicenseContent, S.aboutLicenseFonts, S.aboutLicenseWanakana, S.aboutLicensePreact, S.aboutLicenseVoices];

/** Content version: the loader's manifest when loaded, else what the save remembers. */
export function contentVersionLine(): string {
  const v = content.version.value ?? store.meta().contentVersion;
  return v ? fmt(S.aboutContentVersion, { v }) : S.aboutContentNone;
}

/**
 * `VOICEVOX:<character>` credits from the runtime manifest (design 08 §6), or
 * null when this build has no pack (no player installed, or `ready` is not
 * `'ready'`): the page then says the device voice speaks. The page passes the
 * player from `useClipPlayer()` (`app/hooks.ts`), which re-renders the page
 * when the audio barrel lands on a cold load.
 */
export function voiceCredits(clips: ClipPlayer | undefined = services.audio.clips): readonly string[] | null {
  if (!clips || clips.ready.value !== 'ready') return null;
  return clips.info.value?.credits ?? null;
}

const EVENTS_SHOWN = 20;

function describe(payload: unknown): string {
  try {
    const s = JSON.stringify(payload) ?? '';
    return s.length > 80 ? `${s.slice(0, 77)}…` : s;
  } catch {
    return '';
  }
}

export default function AboutPage(_p: { route: Route }): JSX.Element {
  const errors = loadErrors();
  const recent = bus.recent().slice(-EVENTS_SHOWN).reverse();
  // Behind first paint the audio barrel is still installing (main.tsx): say "looking" then, never a false "no pack".
  const { clips, settled } = useClipPlayer();
  const credits = voiceCredits(clips);
  const probing = !clips ? !settled : clips.ready.value === 'unknown' || clips.ready.value === 'loading';
  return (
    <div class="page about">
      <h1 class="page__title">
        <span class="page__title-ja brush" lang="ja">
          {S.aboutTitleJa}
        </span>
        <span>{S.aboutTitle}</span>
      </h1>
      <p class="page__lead">{S.aboutIntro}</p>

      <section class="panel page__section" aria-labelledby="about-what">
        <h2 id="about-what">{S.aboutWhatTitle}</h2>
        <p>{S.aboutWhat}</p>
        <p>{S.tagline}</p>
      </section>

      <section class="panel page__section" aria-labelledby="about-how">
        <h2 id="about-how">{S.aboutHowTitle}</h2>
        <p>{S.aboutHow}</p>
        <dl class="about__dl">
          {HOW.map((h) => (
            <>
              <dt key={`${h.title}-t`}>{h.title}</dt>
              <dd key={`${h.title}-d`}>{h.body}</dd>
            </>
          ))}
        </dl>
        <p class="muted">{S.levelLine}</p>
      </section>

      <section class="panel page__section" aria-labelledby="about-rules">
        <h2 id="about-rules">
          {S.aboutRulesTitle}
          <span class="ja" lang="ja">
            {S.aboutRulesJa}
          </span>
        </h2>
        <ol class="about__rules" data-rules>
          {RULES.map((rule, i) => (
            <li key={rule} class="about__rule" data-rule={i + 1}>
              <span class="about__rule-n" aria-hidden="true">
                {i + 1}
              </span>
              <span class="visually-hidden">{fmt(S.aboutRuleLabel, { n: i + 1 })}</span>
              <p>{rule}</p>
            </li>
          ))}
        </ol>
      </section>

      <section class="panel page__section" aria-labelledby="about-privacy">
        <h2 id="about-privacy">{S.aboutPrivacyTitle}</h2>
        <p>{S.onbPrivacy}</p>
        <p class="muted">{S.setSpeakingNetwork}</p>
        <div class="page__actions">
          <a class="btn" href={href({ name: 'backup' })}>
            {S.setBackup}
          </a>
          <a class="btn btn--ghost" href={href({ name: 'settings' })}>
            {S.navSettings}
          </a>
        </div>
      </section>

      <section class="panel page__section" aria-labelledby="about-voices">
        <h2 id="about-voices">
          {S.aboutVoicesTitle}
          <span class="ja" lang="ja">
            {S.aboutVoicesTitleJa}
          </span>
        </h2>
        <p data-honest-share>{S.honestShare}</p>
      </section>

      <section class="panel page__section" aria-labelledby="about-credits">
        <h2 id="about-credits">{S.aboutCreditsTitle}</h2>
        <p>{S.aboutCredits}</p>
        <h3>{S.aboutLicensesTitle}</h3>
        <ul class="list" data-licenses>
          {LICENSES.map((l) => (
            <li key={l} class="list__item">
              {l}
            </li>
          ))}
          {credits && credits.length > 0 ? (
            credits.map((c) => (
              <li key={c} class="list__item" data-credit={c}>
                <span lang="ja">{c}</span> <span class="muted">{S.aboutVoiceCreditNote}</span>
              </li>
            ))
          ) : probing ? (
            <li class="list__item muted" data-pack-loading>
              {S.setPackLoading}
            </li>
          ) : (
            <li class="list__item" data-no-pack>
              {S.aboutVoicesNone}
            </li>
          )}
        </ul>
      </section>

      <section class="panel page__section" aria-labelledby="about-version">
        <h2 id="about-version">{S.aboutVersionTitle}</h2>
        <dl class="about__dl">
          <dt>{S.appName}</dt>
          <dd data-app-version>{fmt(S.aboutAppVersion, { v: APP_VERSION })}</dd>
          <dt lang="ja">{S.appNameJa}</dt>
          <dd data-content-version>{contentVersionLine()}</dd>
        </dl>
        <details>
          <summary>{S.aboutLoadErrorsTitle}</summary>
          {errors.length === 0 ? (
            <p class="muted" data-no-load-errors>
              {S.aboutNoLoadErrors}
            </p>
          ) : (
            <ul class="about__events" data-load-errors>
              {errors.map((e) => (
                <li key={`${e.module}:${e.message}`}>
                  {e.module}
                  {S.separator}
                  {e.message}
                </li>
              ))}
            </ul>
          )}
        </details>
        <details>
          <summary>{S.aboutDebugTitle}</summary>
          {recent.length === 0 ? (
            <p class="muted">{S.aboutNoEvents}</p>
          ) : (
            <ul class="about__events" data-events>
              {recent.map(([name, payload], i) => (
                <li key={`${name}-${i}`}>
                  {name}
                  {S.separator}
                  {describe(payload)}
                </li>
              ))}
            </ul>
          )}
        </details>
      </section>
    </div>
  );
}
