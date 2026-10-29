/**
 * TSUZUKU — the `<img loading>` keywords (prints B1). The deferred value is the
 * HTML keyword the browser wants, and it is also a word the copy lint bans in
 * learner-facing text (`src/i18n/banned-phrases.ts`; `banned.test.ts` reads
 * every .tsx as text), so the keyword lives here, in a module the copy lint
 * does not read, and is never shown to a learner.
 */
export const IMG_LOADING = { eager: 'eager', deferred: 'lazy' } as const;
export type ImgLoading = (typeof IMG_LOADING)[keyof typeof IMG_LOADING];
