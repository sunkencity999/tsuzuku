/**
 * TSUZUKU — Taiwa debrief (design 04 §8): best / aizuchi counts, the register
 * meter (lines that slipped register) and the explicit corrections — the
 * learner's line against the model line with its error tags — plus the slot
 * verdicts. Pure presentation split out of `RolePlay.tsx` (file-size cap);
 * the host wraps it in the `.taiwa` frame with the header. The register meter
 * is motion.css's `.meter` (design 09 §5.7): `--value` drives the fill by
 * transform, the label is an `.eyebrow`.
 */
import type { JSX } from 'preact';
import type { StoryLine } from '@/content/types';
import type { FuriganaMode } from '@/shared/store-types';
import { Ruby } from '@/shared/ui/Ruby';
import { TAG_LABEL } from '@/shared/ui/strings';
import type { LineOutcome, RolePlayResult, SlotOutcome } from './role-play-logic';
import { S, fill } from './strings';

export interface DebriefProps {
  result: RolePlayResult;
  outcomes: readonly LineOutcome[];
  slots: readonly SlotOutcome[];
  lines: readonly StoryLine[];
  furigana: FuriganaMode;
}

export function Debrief(p: DebriefProps): JSX.Element {
  const r = p.result;
  const slips = p.outcomes.filter((o) => !o.registerOk).length;
  const corrections = p.outcomes.filter((o) => o.kind !== 'best');
  const ratio = r.total > 0 ? (r.total - slips) / r.total : 1;
  return (
    <>
      <div class="taiwa__card status-window" role="status">
        <h3 class="taiwa__subtitle">{S.debriefTitle}</h3>
        <p class="taiwa__result-line">{fill(S.bestLine, { best: r.best, total: r.total })}</p>
        <p class="taiwa__result-line">{r.aizuchiTotal > 0 ? fill(S.aizuchiLine, { hit: r.aizuchiHit, total: r.aizuchiTotal }) : S.noAizuchi}</p>
        <span class="eyebrow">{S.registerMeter}</span>
        <div class="meter" role="meter" aria-label={S.registerMeter} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} style={{ '--value': ratio, '--meter-tone': 'var(--matcha)' } as JSX.CSSProperties}>
          <span class="meter__fill" />
        </div>
        <p class="taiwa__hint">{slips === 0 ? S.registerClean : slips === 1 ? S.registerSlipOne : fill(S.registerSlips, { n: slips })}</p>
      </div>
      <section class="taiwa__corrections" aria-label={S.corrections}>
        <h3 class="taiwa__subtitle">{S.corrections}</h3>
        {corrections.length === 0 ? (
          <p class="taiwa__hint">{S.noCorrections}</p>
        ) : (
          <ul class="taiwa__list">
            {corrections.map((o) => (
              <li key={o.lineIndex} class="taiwa__correction" data-kind={o.kind}>
                <span class="eyebrow">{S.yours}</span>
                <span lang="ja" class="taiwa__given">
                  {o.given}
                </span>
                <span class="eyebrow">{S.modelLine}</span>
                <span class="taiwa__model">
                  <Ruby ja={p.lines[o.lineIndex]?.ja ?? o.recast} mode={p.furigana} />
                </span>
                {o.tags.length > 0 ? (
                  <span class="taiwa__tags">
                    {o.tags.map((t) => (
                      <span key={t} class="chip chip--tag" data-tag={t}>
                        {TAG_LABEL[t]}
                      </span>
                    ))}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {p.slots.length > 0 ? (
          <ul class="taiwa__slots" aria-label={S.aizuchiLabel}>
            {p.slots.map((s) => (
              <li key={s.lineIndex} class="chip" data-hit={s.score.hit ? 'true' : 'false'}>
                <span lang="ja">{s.text ?? '—'}</span>
                <span>{s.score.hit ? S.slotHit : s.score.late ? S.slotLate : S.slotMissed}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <p class="taiwa__hint">{S.closing}</p>
    </>
  );
}
