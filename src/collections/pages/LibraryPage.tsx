/**
 * TSUZUKU — Library (group G): `#/library` (design 06 §6 + group notes).
 *
 * Two shelves. ITEMS: every introduced item grouped by the station that
 * taught it (station bundles via the content loader, cumulative), with its
 * item belt, kind and archive state; filters by kind and belt; search by
 * kana, romaji or meaning; a detail sheet with Listen (`speak()`), "Already
 * know this" (`markKnown`) and Retire / Restore (`retireItem`) through
 * `@/learn/apply`; the sheet is a `useDialogFocus` dialog (Close focused
 * first, Escape, Tab wrap, focus back to the row). MICHIKUSA: the roadside fragments by station with the
 * un-collected count ("3 more at Totsuka") and the reserved Yojijukugo shelf
 * (empty state until the 五段 pack). Items load per station on expand (or all
 * at once when a search starts), so a late-road save never fetches the whole
 * corpus to open the page.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { markKnown, retireItem } from '@/learn/apply';
import { content, type ContentLoader } from '../../content/loader';
import type { ContentItem, Facet, MichikusaItem } from '../../content/types';
import { packWillSpeak, services, speak, voiceAudible, type AudioService } from '../../shared/audio';
import type { Route } from '../../shared/routes';
import type { ItemBelt, ItemKind } from '../../shared/store-types';
import { formatEraDate } from '../../shared/time';
import { Ruby } from '../../shared/ui/Ruby';
import { useDialogFocus } from '../../shared/ui/use-dialog-focus';
import { store } from '../../store';
import {
  BELT_ORDER,
  KIND_ORDER,
  UNPLACED,
  filterItems,
  groupByStation,
  hasActiveFilter,
  introducedItems,
  isMichikusa,
  michikusaGroups,
  placeItems,
  stationIndex,
  surfaceOf,
  type ItemFilter,
  type LibraryItem,
  type StationGroup,
  type StationIndex,
  type Surface,
} from '../library-model';
import { S, fill } from '../strings';
import './LibraryPage.css';

export interface LibraryPageProps {
  route: Route;
  /** Injectable for tests; defaults to the app loader. */
  loader?: ContentLoader;
}

export type LibraryView = 'items' | 'michikusa';

const FACET_JA: Record<Facet, string> = { rec: '認', listen: '聴', prod: '産', pitch: '高', read: '読', comp: '部', cloze: '穴' };

/**
 * Nothing will be heard and no pack voice is coming (design 08 §8): the
 * "no voice" status reads the contract-tier `packWillSpeak(a, packChosen)` for
 * the pack (`source` / `packReady` only together with the setting: a ready pack
 * under the device-voice setting is the device voice; a ready pack the learner
 * chose is a voice even while the master volume is 0 and the idle `source`
 * reads `'none'`) and `voiceAudible` + `hasJaVoice` for the device, never
 * `hasJaVoice` alone — so a chosen pack without a device voice shows no notice,
 * and a learner who merely muted a voice is not told to install one.
 */
export function voiceMissing(a: AudioService, packChosen: boolean = store.settings.value.audioSource !== 'device'): boolean {
  if (packWillSpeak(a, packChosen)) return false;
  return !voiceAudible(a) && !a.hasJaVoice.value;
}

function stationLabel(g: { station: number; def: StationGroup['def'] }): JSX.Element {
  if (g.station === UNPLACED || !g.def) return <span>{S.stationUnplaced}</span>;
  return (
    <>
      <span lang="ja">{g.def.nameJa}</span>
      <span class="library__romaji">{fill(S.stationHeading, { n: g.def.number, name: g.def.nameRomaji })}</span>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Detail sheet                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function ItemDetail(p: { item: LibraryItem; surface: Surface; onClose(): void; onChanged(): void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const furigana = store.settings.value.furigana;
  const { item, surface } = p;
  useDialogFocus(ref, { onClose: p.onClose, initial: '[data-action="close"]' });

  const listen = (): void => {
    if (!surface.speak) return;
    void speak(surface.speak.text, { kana: surface.speak.kana }).catch(() => undefined);
    if (voiceMissing(services.audio)) setStatus(S.noVoice);
  };
  const known = (): void => {
    markKnown(item.id, item.kind);
    setStatus(S.markedKnown);
    p.onChanged();
  };
  const toggleRetire = (): void => {
    const retired = !item.archived;
    retireItem(item.id, retired);
    setStatus(retired ? S.retired : S.restored);
    p.onChanged();
  };

  const facets = Object.entries(item.facets) as [Facet, NonNullable<LibraryItem['facets'][Facet]>][];
  return (
    <div class="modal library-detail" data-item={item.id} onClick={(e) => e.target === e.currentTarget && p.onClose()}>
      <div ref={ref} tabIndex={-1} class="modal__card library-detail__card" role="dialog" aria-modal="true" aria-labelledby="library-detail-title">
        <h3 id="library-detail-title" class="library-detail__title">
          <span lang="ja">{surface.text}</span>
          {surface.reading ? (
            <span class="library-detail__reading" lang="ja">
              {surface.reading}
            </span>
          ) : null}
        </h3>
        <div class="library-detail__chips">
          <span class="chip">
            <span lang="ja" aria-hidden="true">
              {S.kindGlyphs[item.kind]}
            </span>{' '}
            {S.kindNames[item.kind] ?? item.kind}
          </span>
          <span class="chip library__belt" data-belt={item.belt}>
            {fill(S.beltItem, { belt: S.beltNames[item.belt] ?? item.belt })}
          </span>
          {item.archived ? <span class="chip chip--tag">{S.retiredChip}</span> : null}
        </div>
        {surface.meanings.length > 0 ? (
          <div>
            <span class="library-detail__label">{S.meaningLabel}</span>
            <ul class="library-detail__meanings">
              {surface.meanings.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {surface.example ? (
          <div>
            <span class="library-detail__label">{S.exampleLabel}</span>
            <p class="library-detail__example">
              <Ruby ja={surface.example.ja} mode={furigana} />
            </p>
            <p class="library-detail__example-en">{surface.example.en}</p>
          </div>
        ) : null}
        {facets.length > 0 ? (
          <div>
            <span class="library-detail__label">{S.facetsLabel}</span>
            <ul class="library-detail__facets">
              {facets.map(([f, t]) => (
                <li key={f}>
                  <span lang="ja" aria-hidden="true">
                    {FACET_JA[f]}
                  </span>{' '}
                  {S.facetLabel[f] ?? f} · {fill(S.stabilityDays, { n: Math.round(t[1]) })} · {fill(S.dueOn, { date: formatEraDate(t[0]) })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div class="modal__actions">
          {surface.speak ? (
            <button type="button" class="btn" data-action="listen" onClick={listen}>
              {S.listen}
            </button>
          ) : null}
          <button type="button" class="btn" data-action="known" onClick={known}>
            {S.markKnown}
          </button>
          <button type="button" class={item.archived ? 'btn' : 'btn btn--danger'} data-action="retire" onClick={toggleRetire}>
            {item.archived ? S.restore : S.retire}
          </button>
          <button type="button" class="btn btn--ghost" data-action="close" onClick={p.onClose}>
            {S.close}
          </button>
        </div>
        <p class="library-detail__status" role="status">
          {status ?? ''}
        </p>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Rows                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

function ItemRow(p: { item: LibraryItem; surface: Surface; onOpen(el: HTMLElement): void }): JSX.Element {
  const { item, surface } = p;
  return (
    <li>
      <button
        type="button"
        class="library__item"
        data-id={item.id}
        data-kind={item.kind}
        data-belt={item.belt}
        data-archived={item.archived ? 'true' : 'false'}
        aria-haspopup="dialog"
        aria-label={fill(S.openItem, { surface: surface.text })}
        onClick={(e) => p.onOpen(e.currentTarget)}
      >
        <span class="library__glyph" lang="ja" aria-hidden="true">
          {S.kindGlyphs[item.kind]}
        </span>
        <span class="library__surface">
          <span lang="ja">{surface.text}</span>
          {surface.reading ? (
            <span class="library__reading" lang="ja">
              {surface.reading}
            </span>
          ) : null}
        </span>
        <span class="library__meaning">{surface.loaded ? surface.meaning : S.loadingItems}</span>
        <span class="library__tags">
          <span class="chip library__belt" data-belt={item.belt}>
            {S.beltNames[item.belt] ?? item.belt}
          </span>
          {item.archived ? <span class="chip chip--tag">{S.retiredChip}</span> : null}
        </span>
      </button>
    </li>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Page                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

export default function LibraryPage(p: LibraryPageProps): JSX.Element {
  const loader = p.loader ?? content;
  const progress = store.progress.value;
  const collections = store.collections.value;
  const cardsVersion = store.cards.version.value;
  const [view, setView] = useState<LibraryView>('items');
  const [index, setIndex] = useState<StationIndex | null>(null);
  const [loadTick, setLoadTick] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<ItemFilter>({ kind: '', belt: '', query: '' });
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set([progress.station]));
  const [openId, setOpenId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const loadedAll = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const byItem = useMemo(() => introducedItems(store.cards), [cardsVersion]);
  const maxStation = useMemo(() => {
    let top = Math.max(1, progress.station);
    for (const id of collections.michikusa) {
      const m = /^m-(\d{2})-/.exec(id);
      if (m) top = Math.max(top, Number(m[1]));
    }
    return top;
  }, [progress.station, collections.michikusa]);

  // Station bundles once per loader / road position.
  useEffect(() => {
    let on = true;
    setIndex(null);
    stationIndex(loader, maxStation).then((idx) => {
      if (on && alive.current) setIndex(idx);
    });
    return () => {
      on = false;
    };
  }, [loader, maxStation]);

  const items = useMemo(() => (index ? placeItems(byItem, store.cards, (id) => index.map.get(id) ?? loader.stationOf(id)) : []), [byItem, index, loader]);
  const groups = useMemo(() => groupByStation(items), [items]);
  const surface = (id: string): Surface => surfaceOf(loader.get(id) as ContentItem | undefined, id);

  const ensureLoaded = async (ids: readonly string[]): Promise<void> => {
    const missing = ids.filter((id) => loader.get(id) === undefined);
    if (missing.length === 0) return;
    try {
      await loader.load(missing);
      if (alive.current) setLoadError(false);
    } catch (err) {
      console.warn('[library] load failed', err);
      if (alive.current) setLoadError(true);
    }
    if (alive.current) setLoadTick((t) => t + 1);
  };

  // The open station's items, then the collected fragments.
  useEffect(() => {
    if (!index) return;
    const ids = groups.filter((g) => expanded.has(g.station)).flatMap((g) => g.items.map((it) => it.id));
    void ensureLoaded([...ids, ...collections.michikusa]);
  }, [index, groups, expanded, collections.michikusa]);

  const active = hasActiveFilter(filter);
  useEffect(() => {
    if (!active || loadedAll.current || !index) return;
    loadedAll.current = true;
    void ensureLoaded(items.map((it) => it.id));
  }, [active, index, items]);

  const toggle = (station: number): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(station)) next.delete(station);
      else next.add(station);
      return next;
    });
  };
  const closeDetail = (): void => {
    setOpenId(null);
    const t = triggerRef.current;
    triggerRef.current = null;
    t?.focus();
  };
  const openItem = openId ? items.find((it) => it.id === openId) : undefined;
  const filtered = useMemo(() => (active ? filterItems(items, filter, surface) : items), [items, filter, active, loadTick]);
  const michikusa = useMemo(() => (index ? michikusaGroups(index.bundles, collections.michikusa, maxStation) : []), [index, collections.michikusa, maxStation]);
  const fragmentsTotal = michikusa.reduce((n, g) => n + g.total, 0);
  const fragmentsCollected = michikusa.reduce((n, g) => n + g.collected.length, 0);

  return (
    <div class="library" data-view={view} data-items={items.length}>
      <header class="library__head">
        <h1 class="library__h1">
          <span lang="ja">{S.libraryJa}</span> <span class="library__h1-en">{S.libraryTitle}</span>
        </h1>
      </header>

      <div class="library__views" role="tablist" aria-label={S.libraryViewLabel}>
        {(
          [
            ['items', S.kindGlyphs.vocab, S.itemsView],
            ['michikusa', S.michikusaJa, S.michikusaView],
          ] as const
        ).map(([id, ja, en]) => (
          <button key={id} type="button" class="library__view" role="tab" id={`library-view-${id}`} aria-selected={view === id ? 'true' : 'false'} aria-controls="library-panel" tabIndex={view === id ? 0 : -1} onClick={() => setView(id)}>
            <span class="library__view-ja" lang="ja">
              {ja}
            </span>
            <span class="library__view-en">{en}</span>
          </button>
        ))}
      </div>

      <section id="library-panel" role="tabpanel" aria-labelledby={`library-view-${view}`} class="library__panel">
        {view === 'items' ? (
          <div class="library__items-view">
            <p class="library__lede">{fill(S.itemsLede, { n: items.length })}</p>
            <div class="library__filters">
              <div class="field">
                <label class="field__label" for="library-search">
                  {S.searchLabel}
                </label>
                <input id="library-search" class="input" type="search" placeholder={S.searchPlaceholder} value={filter.query} onInput={(e) => setFilter({ ...filter, query: (e.currentTarget as HTMLInputElement).value })} />
              </div>
              <div class="field">
                <label class="field__label" for="library-kind">
                  {S.kindFilterLabel}
                </label>
                <select id="library-kind" class="select" value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: (e.currentTarget as HTMLSelectElement).value as ItemKind | '' })}>
                  <option value="">{S.allKinds}</option>
                  {KIND_ORDER.map((k) => (
                    <option key={k} value={k}>
                      {S.kindNames[k] ?? k}
                    </option>
                  ))}
                </select>
              </div>
              <div class="field">
                <label class="field__label" for="library-belt">
                  {S.beltFilterLabel}
                </label>
                <select id="library-belt" class="select" value={filter.belt} onChange={(e) => setFilter({ ...filter, belt: (e.currentTarget as HTMLSelectElement).value as ItemBelt | '' })}>
                  <option value="">{S.allBelts}</option>
                  {BELT_ORDER.map((b) => (
                    <option key={b} value={b}>
                      {S.beltNames[b] ?? b}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {loadError ? (
              <p class="notice notice--warn" role="alert">
                {S.loadFailed}{' '}
                <button type="button" class="btn btn--sm" onClick={() => void ensureLoaded(items.map((it) => it.id))}>
                  {S.retry}
                </button>
              </p>
            ) : null}
            {!index ? (
              <p class="library__muted" role="status">
                {S.loadingItems}
              </p>
            ) : items.length === 0 ? (
              <p class="empty">{S.noItems}</p>
            ) : active ? (
              filtered.length === 0 ? (
                <p class="empty">{S.noMatches}</p>
              ) : (
                <ul class="library__items library__items--flat" aria-label={S.itemsView}>
                  {filtered.map((it) => (
                    <ItemRow
                      key={it.id}
                      item={it}
                      surface={surface(it.id)}
                      onOpen={(el) => {
                        triggerRef.current = el;
                        setOpenId(it.id);
                      }}
                    />
                  ))}
                </ul>
              )
            ) : (
              groups.map((g) => {
                const open = expanded.has(g.station);
                const panelId = `library-station-${g.station}`;
                return (
                  <section key={g.station} class="library__station" data-station={g.station} data-count={g.items.length}>
                    <button type="button" class="library__station-head" aria-expanded={open ? 'true' : 'false'} aria-controls={panelId} onClick={() => toggle(g.station)}>
                      <h3 class="library__h3">
                        {stationLabel(g)}
                        <span class="library__count tag">{fill(S.itemCount, { n: g.items.length })}</span>
                      </h3>
                      <span class="library__chevron" aria-hidden="true">
                        ▸
                      </span>
                    </button>
                    {open ? (
                      <ul id={panelId} class="library__items">
                        {g.items.map((it) => (
                          <ItemRow
                            key={it.id}
                            item={it}
                            surface={surface(it.id)}
                            onOpen={(el) => {
                              triggerRef.current = el;
                              setOpenId(it.id);
                            }}
                          />
                        ))}
                      </ul>
                    ) : null}
                  </section>
                );
              })
            )}
          </div>
        ) : (
          <div class="library__michikusa-view">
            <p class="library__lede">
              {S.michikusaLede} {index ? fill(S.michikusaCount, { n: fragmentsCollected, total: fragmentsTotal }) : S.loadingItems}
            </p>
            {michikusa.map((g) => {
              const name = g.def ? g.def.nameRomaji : String(g.station);
              return (
                <section key={g.station} class="library__station library__station--michikusa" data-station={g.station} data-collected={g.collected.length} data-missing={g.missing}>
                  <h3 class="library__h3">
                    {stationLabel(g)}
                    <span class="library__count tag">{`${g.collected.length} / ${g.total}`}</span>
                  </h3>
                  {g.collected.length > 0 ? (
                    <ul class="library__fragments">
                      {g.collected.map((id) => {
                        const it = loader.get(id) as ContentItem | undefined;
                        if (!it || !isMichikusa(it)) {
                          return (
                            <li key={id} class="library__fragment" data-id={id}>
                              <p class="library__fragment-body library__muted">{S.loadingItems}</p>
                            </li>
                          );
                        }
                        return <FragmentCard key={id} item={it} />;
                      })}
                    </ul>
                  ) : (
                    <p class="library__more">{S.noneHereYet}</p>
                  )}
                  {g.total > 0 ? (
                    <p class="library__more" data-more={g.missing}>
                      {g.missing > 0 ? fill(S.moreAt, { n: g.missing, station: name }) : S.allCollected}
                    </p>
                  ) : null}
                </section>
              );
            })}
            <section class="library__station library__shelf--empty" aria-labelledby="library-yoji">
              <h3 id="library-yoji" class="library__h3">
                <span lang="ja">{S.yojijukugoJa}</span>
                <span class="library__romaji">{S.yojijukugoShelf}</span>
              </h3>
              <p class="empty">{S.yojijukugoEmpty}</p>
            </section>
          </div>
        )}
      </section>

      {openItem ? <ItemDetail item={openItem} surface={surface(openItem.id)} onClose={closeDetail} onChanged={() => setLoadTick((t) => t + 1)} /> : null}
    </div>
  );
}

function FragmentCard(p: { item: MichikusaItem }): JSX.Element {
  const furigana = store.settings.value.furigana;
  return (
    <li class="library__fragment" data-id={p.item.id} data-kind={p.item.kind}>
      <span class="tag">{S.kinds[p.item.kind] ?? p.item.kind}</span>
      <h4 class="library__fragment-title">{p.item.titleEn}</h4>
      {p.item.ja ? (
        <p class="library__fragment-ja">
          <Ruby ja={p.item.ja} mode={furigana} />
        </p>
      ) : null}
      <p class="library__fragment-body">{p.item.bodyEn}</p>
      {p.item.sourceNote ? <p class="library__muted">{fill(S.michikusaSource, { source: p.item.sourceNote })}</p> : null}
    </li>
  );
}
