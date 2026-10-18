/**
 * TSUZUKU — <MonGrid>: all 68 Mon crests grouped by strand (design 06 §2).
 *
 * Earned crests carry their day (the era date with its Latin gloss, §3.3);
 * unearned ones are grey stone with the condition in plain text, visible from
 * day one (06 §7 #2). Stone is an `<img>` data URL with the glyph set over it
 * in the page's brush face (`MonCrest stoneImg`): one rasterised emboss per
 * crest, so the grid holds no live SVG filter (design 09 §6.7 rule 2). A crest
 * earned since the shelf was last opened (`reveal.ts newSince`) renders as
 * stone until it is half on screen, then plays moment E inline at quarter
 * scale (09 §7 E): the stone dries out over the colour (kasure), osu on the
 * spring, the wet ink dries, and the era date appears in Mincho exactly as
 * `formatEraDate` prints it with its Latin gloss beneath, then leaves by
 * kasure. The shelf records what it showed; a crest never scrolled to stays
 * new for the next open (`markSeen`). Tapping a crest opens a detail sheet
 * (name, tier, condition, earned day) as a modal dialog with focus trapped on
 * its close button and restored on close. Names and conditions come from
 * `BADGE_DEFS` (store contract tier); the crest art is `<MonCrest>`.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { MonCrest, monCrestText } from '../art/MonCrest';
import type { BadgeId } from '../shared/catalog';
import type { EpochDay } from '../shared/store-types';
import { formatEraDate, isoDate } from '../shared/time';
import { BADGE_DEFS, store } from '../store';
import type { BadgeDef } from '../store/badge-defs';
import { eraGloss, markOpened, markSeen, newSince, useMomentE } from './reveal';
import { S, fill } from './strings';
import './MonGrid.css';

export type MonFilter = 'all' | 'earned' | 'locked';

/** Dojo shelf order (design 06 §5 "one slot per category"); unknown categories follow, in first-seen order. */
export const CATEGORY_ORDER: readonly string[] = ['kana', 'streak', 'training', 'road', 'belt', 'input', 'output', 'mastery', 'spirit'];

export interface MonGroup {
  category: string;
  label: string;
  defs: BadgeDef[];
  earned: number;
}

/** Badges by category in shelf order, with the earned count per group. */
export function groupBadges(defs: readonly BadgeDef[], badges: Partial<Record<BadgeId, EpochDay>>): MonGroup[] {
  const by = new Map<string, BadgeDef[]>();
  for (const d of defs) {
    const list = by.get(d.category) ?? [];
    list.push(d);
    by.set(d.category, list);
  }
  const order = [...CATEGORY_ORDER, ...Array.from(by.keys()).filter((c) => !CATEGORY_ORDER.includes(c))];
  const out: MonGroup[] = [];
  for (const category of order) {
    const list = by.get(category);
    if (!list || list.length === 0) continue;
    out.push({
      category,
      label: S.categories[category] ?? category,
      defs: list,
      earned: list.filter((d) => badges[d.id] !== undefined).length,
    });
  }
  return out;
}

const TIER_LABEL: Record<BadgeDef['tier'], string> = { bronze: S.tierBronze, silver: S.tierSilver, gold: S.tierGold };

function matches(filter: MonFilter, earned: boolean): boolean {
  return filter === 'all' || (filter === 'earned') === earned;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Detail sheet                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function MonDetail(p: { def: BadgeDef; earnedOn: EpochDay | undefined; onClose(): void }): JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  const earned = p.earnedOn !== undefined;
  const text = monCrestText({ id: p.def.id, earned, earnedOn: p.earnedOn });
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        p.onClose();
      } else if (e.key === 'Tab') {
        // one focusable control: keep focus on it
        e.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [p.def.id]);
  return (
    <div class="modal mon-detail" data-badge={p.def.id} onClick={(e) => e.target === e.currentTarget && p.onClose()}>
      <div class="modal__card mon-detail__card" role="dialog" aria-modal="true" aria-labelledby="mon-detail-title" aria-describedby="mon-detail-condition">
        <MonCrest id={p.def.id} earned={earned} size={160} caption={false} stoneImg class="mon-detail__crest" />
        <h3 id="mon-detail-title" class="mon-detail__title">
          <span class="mon-detail__en">{p.def.nameEn}</span>
          <span class="mon-detail__ja" lang="ja">
            {p.def.nameJa}
          </span>
        </h3>
        <p class="mon-detail__meta">
          <span class={`chip mon-detail__tier mon-detail__tier--${p.def.tier}`}>{TIER_LABEL[p.def.tier]}</span>
          <span class="chip">{S.categories[p.def.category] ?? p.def.category}</span>
        </p>
        <p id="mon-detail-condition" class="mon-detail__condition">
          <span class="eyebrow">{S.conditionLabel}</span> {p.def.describe}
        </p>
        <p class="mon-detail__state">
          {earned && p.earnedOn !== undefined ? (
            <>
              {fill(S.earnedOn, { date: '' }).trim()}{' '}
              <time dateTime={isoDate(p.earnedOn)} lang="ja">
                {text.date}
              </time>{' '}
              · {eraGloss(p.earnedOn)}
            </>
          ) : (
            S.notYetEarned
          )}
        </p>
        <div class="modal__actions">
          <button type="button" class="btn" ref={closeRef} onClick={p.onClose}>
            {S.close}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* One cell: stone until seen, then moment E (design 09 §7 E)                 */
/* ────────────────────────────────────────────────────────────────────────── */

export const MON_CELL_SIZE = 72;

function MonCell(p: { def: BadgeDef; at: EpochDay | undefined; fresh: boolean; onSeen(id: BadgeId): void; onOpen(el: HTMLElement, id: BadgeId): void }): JSX.Element {
  const ref = useRef<HTMLLIElement>(null);
  const earned = p.at !== undefined;
  const m = useMomentE(ref, p.fresh && earned, () => p.onSeen(p.def.id));
  const stone = m.phase === 'wait';
  return (
    <li ref={ref} class="mon-grid__cell" data-badge={p.def.id} data-earned={earned ? 'true' : 'false'} data-reveal={m.reveal ? m.phase : undefined}>
      <button type="button" class="mon-grid__button" aria-haspopup="dialog" aria-label={fill(S.monOpen, { name: `${p.def.nameEn} ${p.def.nameJa}` })} onClick={(e) => p.onOpen(e.currentTarget, p.def.id)}>
        <MonCrest id={p.def.id} earned={earned} earnedOn={p.at} dateGloss={p.at !== undefined ? eraGloss(p.at) : undefined} size={MON_CELL_SIZE} stone={stone} stoneImg stoneLeaving={m.phase === 'in'} svgClass={m.artClass} />
        {m.reveal && p.at !== undefined ? (
          <span class="seal-date collections__seal ink-nijimi" data-leaving={m.phase === 'leaving' ? '' : undefined} onAnimationEnd={m.onLeaveEnd}>
            <span class="collections__era" lang="ja">
              {formatEraDate(p.at)}
            </span>
            <span class="seal-date__label">{eraGloss(p.at)}</span>
          </span>
        ) : null}
      </button>
    </li>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Grid                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

const FILTERS: readonly { id: MonFilter; label: string }[] = [
  { id: 'all', label: S.filterAll },
  { id: 'earned', label: S.filterEarned },
  { id: 'locked', label: S.filterLocked },
];

export function MonGrid(): JSX.Element {
  const badges = store.collections.value.badges;
  const [filter, setFilter] = useState<MonFilter>('all');
  const [open, setOpen] = useState<BadgeId | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const groups = useMemo(() => groupBadges(BADGE_DEFS, badges), [badges]);
  const earnedTotal = groups.reduce((n, g) => n + g.earned, 0);
  const total = BADGE_DEFS.length;
  const openDef = open ? BADGE_DEFS.find((d) => d.id === open) : undefined;
  // earned since the shelf was last opened — read once at mount; a crest leaves the set the moment its reveal plays
  const fresh = useRef<Set<string> | null>(null);
  if (fresh.current === null) {
    const earned = Object.entries(badges).flatMap(([id, at]) => (at === undefined ? [] : [{ id, at }]));
    fresh.current = newSince('mon', earned, store.today());
  }
  useEffect(() => {
    // the record holds what the shelf showed settled; the fresh ones join it one by one as they are seen
    markOpened(
      'mon',
      Object.entries(badges)
        .filter(([id, at]) => at !== undefined && !fresh.current?.has(id))
        .map(([id]) => id),
    );
  }, []);

  const close = (): void => {
    setOpen(null);
    const t = triggerRef.current;
    triggerRef.current = null;
    t?.focus();
  };

  return (
    <section class="mon-grid" aria-label={S.tabMon} data-earned={earnedTotal} data-total={total}>
      <p class="mon-grid__lede">{fill(S.monLede, { earned: earnedTotal, total })}</p>
      <div class="mon-grid__filters" role="group" aria-label={S.monFilterLabel}>
        {FILTERS.map((f) => (
          <button key={f.id} type="button" class="btn btn--sm" aria-pressed={filter === f.id ? 'true' : 'false'} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {groups.map((g) => {
        const visible = g.defs.filter((d) => matches(filter, badges[d.id] !== undefined));
        return (
          <section key={g.category} class="mon-grid__group sheet" data-category={g.category} aria-labelledby={`mon-group-${g.category}`}>
            <h3 id={`mon-group-${g.category}`} class="mon-grid__h3">
              <span>{g.label}</span>
              <span class="mon-grid__count tag">{fill(S.monGroupCount, { earned: g.earned, total: g.defs.length })}</span>
            </h3>
            {visible.length === 0 ? (
              <p class="mon-grid__empty muted">{S.monEmptyFilter}</p>
            ) : (
              <ul class="mon-grid__cells">
                {visible.map((d) => (
                  <MonCell
                    key={d.id}
                    def={d}
                    at={badges[d.id]}
                    fresh={fresh.current?.has(d.id) ?? false}
                    onSeen={(id) => {
                      fresh.current?.delete(id);
                      markSeen('mon', id);
                    }}
                    onOpen={(el, id) => {
                      triggerRef.current = el;
                      setOpen(id);
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {openDef ? <MonDetail def={openDef} earnedOn={badges[openDef.id]} onClose={close} /> : null}
    </section>
  );
}
