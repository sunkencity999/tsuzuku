/**
 * TSUZUKU — Settings copy added by design 09 (A3 · calendar-theme): the
 * Follow-the-sky theme radio and its one-line explanation (09 §7 G, §8: the
 * app never switches presets silently; the mode is opt-in and announced once
 * here). Kept apart from `./strings.ts`, which B1 owns this programme; linted
 * by `src/i18n/banned.test.ts` through the `*-strings.ts` glob.
 */
export const S = {
  setThemeSky: 'Follow the sky',
  /** One sentence; "from dusk" because the change is moment G, dusk falling (17:00 in the profile zone). */
  setThemeSkyHint: 'Follow the sky sets the theme by the real hour in your time zone — Dojo Morning by day, Arcade Night from dusk — and only if you choose it here.',
} as const;
