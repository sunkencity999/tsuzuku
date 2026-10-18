/**
 * TSUZUKU — `#/station/:n` (design 02 §1, §6.3, 04 §11, 06 §6).
 *
 *  Header (name, keeper, belt, JLPT), the station's quotas from `STATIONS`,
 *  progress bars (introduced / Green) from `stationProgress`, the Scrolls with
 *  their introduced counts, items by kind with item belts, the texts with links
 *  to the reader / listening / role-play, the Michikusa collected count, the
 *  Gatekeeper button with its readiness copy (disabled with the reason until
 *  the station is ready) and the Shinsa link on belt-final stations. From the
 *  Plateau Arc the week's outside-input target stands in once the texts run out.
 *
 *  耳 Ear panel (design 08 §10.1), above the texts: 聴解 Set (`#/listen/:id`,
 *  an unheard audio-first piece first — `earTextFor`), 読み聞かせ Read-along
 *  (`#/story/:id/listen`, never an unheard piece: a plain text or a piece
 *  already heard — `earReadAlongFor`; the row is absent while nothing may be
 *  read along yet) and 茶屋ラジオ Radio from here
 *  (`#/radio`), each with a status chip — `synthetic voice (VOICEVOX)` when
 *  the audio slot's `source` is the pack, `device voice` when the device
 *  speaks, `text only` when nothing is audible (`audioSourceOf` +
 *  `voiceAudible`; no chip ever claims a human voice) — and the live line
 *  "N min you can follow today" from `poolMinutes(selectPool(…, 'i+0'))` over
 *  the pools ≤ station at the learner's known set (hidden without pools: the
 *  loader rejects `missing-pool` and nothing is guessed). Audio-first pieces
 *  are listed with their genre and "Listen first"; their Read link opens once
 *  the text is in `progress.listened`, and Role-play only for a dialogue the
 *  learner has a part in (`isSpeakable`). A first-contact `<TeachOnce>` card
 *  (`ear-panel`) explains the three doors once.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { content, type ContentLoader } from '../../content/loader';
import { STATIONS, type ContentItem, type ListeningPool, type StationBundle, type StationDef, type StoryItem } from '../../content/types';
import { toPlain } from '../../content/ruby';
import { audioSourceOf, services, voiceAudible } from '../../shared/audio';
import { href, type Route } from '../../shared/routes';
import type { ItemBelt, ItemKind } from '../../shared/store-types';
import { BELT_LABEL } from '../../shared/ui/strings';
import { TeachOnce, markTeachSeen } from '../../shared/ui/TeachOnce';
import { store, weeklyTargetHours } from '../../store';
import { SHINSA_STATIONS, itemBeltOf, kindOfItem, stationProgress } from '../../store/derived';
import { knownSet, poolMinutes, scrollsForStation, selectPool } from '../../learn';
import { BELT_NAME, fill } from '../engine-strings';
import { gateAvailable, rematchAllowed } from '../gatekeeper';
import { itemHead } from '../GateView';
import { isSpeakable, loadPools } from '../params';
import { GENRE_LABEL, ITEM_KIND_GLYPH, ITEM_KIND_LABEL, S, SCROLL_KIND_LABEL } from './strings';
import './pages.css';

/** The `<TeachOnce>` id of the panel's first-contact card (lowercase ASCII, `TEACH_ID_RE`). */
export const EAR_PANEL_TEACH_ID = 'ear-panel';

export type EarChip = 'synthetic' | 'device' | 'text';

/**
 * The status chip of an Ear row (design 08 §10.1): `synthetic` when the audio
 * slot's `source` is the pack, `device` when the device voice speaks, `text`
 * when nothing is audible — read from `audioSourceOf()` plus `voiceAudible()`,
 * so a pack at volume 0 says "text only", never a voice it will not produce.
 */
export function earChip(a = services.audio): EarChip {
  const src = audioSourceOf(a);
  if (!voiceAudible(a) || src === 'none') return 'text';
  return src === 'clips' ? 'synthetic' : 'device';
}

const EAR_CHIP_LABEL: Record<EarChip, string> = { synthetic: S.earChipSynthetic, device: S.earChipDevice, text: S.earChipText };

/**
 * The text the panel's Set opens: an unheard audio-first piece first (heard
 * before it is read), then any unheard text, then the first text.
 */
export function earTextFor(stories: readonly StoryItem[], listened: readonly string[]): StoryItem | undefined {
  const heard = new Set(listened);
  return stories.find((s) => s.audioFirst && !heard.has(s.id)) ?? stories.find((s) => !heard.has(s.id)) ?? stories[0];
}

/**
 * The text the panel's Read-along opens — a text that may be read: a plain
 * text, or a piece already heard (pieces are heard before they are read,
 * design 08 §3, §10.1) — unheard first; `undefined` while the station holds
 * only unheard pieces, when the row is absent rather than opening a
 * transcript before its first hearing.
 */
export function earReadAlongFor(stories: readonly StoryItem[], listened: readonly string[]): StoryItem | undefined {
  const heard = new Set(listened);
  const readable = stories.filter((s) => !s.audioFirst || heard.has(s.id));
  return readable.find((s) => !heard.has(s.id)) ?? readable[0];
}

/** "N min you can follow today" (design 08 §4): the i+0 minutes over the loaded pools, rounded; `null` without pools. */
export function earMinutes(pools: readonly ListeningPool[], known: ReadonlySet<string>): number | null {
  if (pools.length === 0) return null;
  const refs = pools.flatMap((p) => p.refs);
  return Math.round(poolMinutes(selectPool(refs, known, store.cards, store.today(), { mode: 'i+0' })));
}

export interface StationPageProps {
  route: Route;
  /** Additive: content source (tests pass `createFakeLoader()`). */
  loader?: ContentLoader;
}

const PLATEAU_FROM = 25;
const ITEMS_SHOWN = 12;

export type ItemGroup = { kind: ItemKind; ids: string[] };

/** Items of a bundle grouped by kind in display order (kana first at White, components after kanji). */
export function groupItems(b: StationBundle, get: (id: string) => ContentItem | undefined): ItemGroup[] {
  const groups: ItemGroup[] = [];
  const push = (kind: ItemKind, ids: string[]): void => {
    if (ids.length > 0) groups.push({ kind, ids });
  };
  push('kana', b.kanaIds);
  const chunks: string[] = [];
  const words: string[] = [];
  for (const id of b.vocabIds) {
    const it = get(id);
    const k = it && 'tags' in it && Array.isArray(it.tags) && (it.tags.includes('set-phrase') || it.tags.includes('aizuchi')) ? 'chunk' : 'vocab';
    (k === 'chunk' ? chunks : words).push(id);
  }
  push('vocab', words);
  push('chunk', chunks);
  push('kanji', b.kanjiIds);
  push('component', b.componentIds);
  push('grammar', b.grammarIds);
  return groups;
}

function Bar(p: { label: string; now: number; total: number; tone?: 'ai' | 'matcha' }): JSX.Element {
  const pct = p.total > 0 ? Math.round((p.now / p.total) * 100) : 0;
  return (
    <div class="station-bar" role="progressbar" aria-label={p.label} aria-valuemin={0} aria-valuemax={Math.max(1, p.total)} aria-valuenow={p.now}>
      <span class="station-bar__label">{p.label}</span>
      <span class={`progress progress--${p.tone ?? 'ai'} station-bar__track`}>
        <span class="progress__fill" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

function NotFound(): JSX.Element {
  return (
    <section class="page page--station" aria-label={S.stationPageAria}>
      <div class="notice">
        <h2>{S.notFoundTitle}</h2>
        <p>{S.notFoundBody}</p>
        <a class="btn" href={href({ name: 'road' })}>
          {S.backToRoad}
        </a>
      </div>
    </section>
  );
}

export default function StationPage(p: StationPageProps): JSX.Element {
  const loader = p.loader ?? content;
  const n = p.route.name === 'station' ? p.route.n : -1;
  const def: StationDef | undefined = STATIONS.find((s) => s.number === n);
  const [bundle, setBundle] = useState<StationBundle | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [loaded, setLoaded] = useState(0);
  /** Listening pools ≤ this station (design 08 §4); `[]` until loaded and on a build without pools. */
  const [pools, setPools] = useState<readonly ListeningPool[]>([]);
  const cardsVersion = store.cards.version.value;
  const progress = store.progress.value;
  const collections = store.collections.value;
  // Read inside render so the chips follow the audio slot's signals (source, canSpeak / hasJaVoice).
  const chip = earChip(services.audio);

  useEffect(() => {
    if (!def) return;
    let alive = true;
    setState('loading');
    setBundle(null);
    setPools([]);
    (async () => {
      let b: StationBundle;
      try {
        b = await loader.station(def.number);
      } catch {
        if (alive) setState('missing');
        return;
      }
      if (!alive) return;
      setBundle(b);
      setState('ready');
      try {
        await loader.preloadStation(def.number);
      } catch {
        /* partial content: ids are shown where names are missing */
      }
      if (alive) setLoaded((x) => x + 1);
      // The pools are small and cached; a station without one (Stations 1–3, a pre-pool build) simply yields none.
      const p = await loadPools(loader, def.number);
      if (alive) setPools(p);
    })();
    return () => {
      alive = false;
    };
  }, [def, loader]);

  const scrolls = useMemo(() => (bundle ? scrollsForStation(bundle, (id) => loader.get(id)) : []), [bundle, loader]);
  const groups = useMemo(() => (bundle ? groupItems(bundle, (id) => loader.get(id)) : []), [bundle, loader, cardsVersion]);
  const stories = useMemo(() => (bundle ? bundle.storyIds.map((id) => loader.get<StoryItem>(id)).filter((s): s is StoryItem => !!s && 'lines' in s) : []), [bundle, loader, loaded]);
  const minutes = useMemo(() => earMinutes(pools, knownSet(store.cards, store.today())), [pools, cardsVersion]);

  if (p.route.name !== 'station') return <NotFound />;
  if (n === 0) {
    return (
      <section class="page page--station" aria-label={S.stationPageAria}>
        <header class="page__head">
          <h2 class="page__title">
            <span lang="ja">日本橋</span> Nihonbashi
          </h2>
          <p class="page__sub">{S.stationZero}</p>
        </header>
        <div class="page__actions">
          <a class="hanko" href={href({ name: 'onboarding' })}>
            {S.stationZeroLink}
          </a>
          <a class="btn btn--ghost" href={href({ name: 'road' })}>
            {S.backToRoad}
          </a>
        </div>
      </section>
    );
  }
  if (!def) return <NotFound />;

  const cleared = progress.stationsCleared.includes(n);
  const assisted = cleared && progress.assisted.includes(n);
  const sp = bundle ? stationProgress(n, bundle) : null;
  const avail = bundle ? gateAvailable(n, bundle, store.cards, store.today()) : null;
  const rm = rematchAllowed(n);
  const introducedOf = (ids: readonly string[]): number => ids.filter((id) => Object.keys(store.cards.byItem(id)).length > 0).length;
  const shinsaHere = SHINSA_STATIONS.includes(n);
  const beltPassed = progress.shinsaPassed.includes(def.belt);
  const michiTotal = bundle?.michikusaIds.length ?? 0;
  const michiDone = bundle ? bundle.michikusaIds.filter((id) => collections.michikusa.includes(id)).length : 0;
  const keeper = `${def.gateJa} ${def.gateEn}`;

  let gateLine: string;
  if (cleared) gateLine = assisted ? S.gateClearedAssistedLine : S.gateClearedLine;
  else if (avail?.ready) gateLine = rm.allowed ? fill(S.gateReadyLine, { name: keeper }) : fill(S.rematchGrudge, { n: rm.grudgeRepsNeeded });
  else if (avail) gateLine = fill(S.gateNotReadyLine, { introduced: avail.introduced, total: avail.total, green: avail.green });
  else gateLine = state === 'missing' ? S.contentMissing : S.loadingStation;
  const gateOpen = !cleared && !!avail?.ready && rm.allowed;

  return (
    <section class="page page--station" aria-label={S.stationPageAria} data-station={n}>
      <header class="page__head station-head" data-belt={def.belt}>
        <p class="station-head__number">{fill(S.stationShort, { n })}</p>
        <h2 class="page__title station-head__name">
          <span lang="ja">{def.nameJa}</span> <span class="station-head__romaji">{def.nameRomaji}</span>
        </h2>
        <p class="page__sub">
          <span class={`belt belt--${def.belt}`}>{fill(S.beltLine, { belt: BELT_NAME[def.belt], jlpt: def.jlpt ? fill(S.jlptLine, { n: def.jlpt }) : S.levelKana })}</span>
        </p>
        <p class="station-head__keeper">
          <span class="station-head__gate-glyph" lang="ja" aria-hidden="true">
            関
          </span>
          {fill(S.keeperIntro, { gateJa: def.gateJa, gateEn: def.gateEn })}
        </p>
      </header>

      <section class="page__section" aria-label={S.quotasTitle}>
        <h3 class="page__label">{S.quotasTitle}</h3>
        <ul class="station-quotas">
          {def.belt === 'white' ? <li class="chip">{S.quotaKana}</li> : null}
          <li class="chip">{fill(S.quotaVocab, { n: def.quota.vocab })}</li>
          {def.quota.kanji > 0 ? <li class="chip">{fill(S.quotaKanji, { n: def.quota.kanji })}</li> : null}
          {def.quota.grammar > 0 ? <li class="chip">{fill(S.quotaGrammar, { n: def.quota.grammar })}</li> : null}
          <li class="chip">{fill(S.quotaStories, { n: def.quota.stories })}</li>
        </ul>
      </section>

      <section class="page__section" aria-label={S.progressTitle}>
        <h3 class="page__label">{S.progressTitle}</h3>
        {sp ? (
          <div class="station-progress">
            <Bar label={fill(S.introducedLine, { n: sp.introduced, total: sp.total })} now={sp.introduced} total={sp.total} />
            <Bar label={fill(S.greenLine, { n: sp.green, total: sp.total })} now={sp.green} total={sp.total} tone="matcha" />
          </div>
        ) : (
          <p class="page__muted">{state === 'missing' ? S.contentMissing : S.loadingStation}</p>
        )}
      </section>

      <section class="page__section" aria-label={S.gateTitle}>
        <h3 class="page__label">{S.gateTitle}</h3>
        <p id="station-gate-reason" class="station-gate__line">
          {gateLine}
        </p>
        <div class="page__actions">
          {cleared ? (
            assisted && rm.allowed ? (
              <a class="hanko" href={href({ name: 'gate', n })}>
                {S.revengeButton}
              </a>
            ) : null
          ) : gateOpen ? (
            <a class="hanko" href={href({ name: 'gate', n })} aria-describedby="station-gate-reason">
              {S.gateButton}
            </a>
          ) : (
            <button type="button" class="hanko" disabled aria-disabled="true" aria-describedby="station-gate-reason">
              {S.gateButton}
            </button>
          )}
          {!cleared && avail?.ready && rm.offerAssisted ? (
            <a class="btn" href={href({ name: 'gate', n })}>
              {S.assistedButton}
            </a>
          ) : null}
        </div>
      </section>

      {shinsaHere && def.belt !== 'white' ? (
        <section class="page__section" aria-label={S.shinsaTitle}>
          <h3 class="page__label">{S.shinsaTitle}</h3>
          <p>{beltPassed ? fill(S.shinsaEarnedLine, { belt: BELT_NAME[def.belt] }) : fill(S.shinsaHereLine, { belt: BELT_NAME[def.belt] })}</p>
          <div class="page__actions">
            <a class="btn" href={href({ name: 'shinsa', belt: def.belt })}>
              {S.shinsaButton}
            </a>
          </div>
        </section>
      ) : null}

      {bundle ? (
        <section class="page__section" aria-label={S.scrollsTitle}>
          <h3 class="page__label">{S.scrollsTitle}</h3>
          {scrolls.length === 0 ? (
            <p class="page__muted">{S.contentMissing}</p>
          ) : (
            <ul class="list station-scrolls">
              {scrolls.map((sc, i) => {
                const done = introducedOf(sc.itemIds);
                return (
                  <li key={sc.id} class="list__item station-scroll" data-done={done === sc.itemIds.length ? 'true' : 'false'}>
                    <span class="station-scroll__text">
                      <span class="station-scroll__name">{fill(S.scrollLine, { n: i + 1, count: sc.itemIds.length, kind: SCROLL_KIND_LABEL[sc.kind] })}</span>
                      <span class="page__muted">{fill(S.scrollIntroduced, { n: done, count: sc.itemIds.length })}</span>
                    </span>
                    <a class="btn btn--sm" href={href({ name: 'scroll', id: sc.id })}>
                      {S.openScroll}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {bundle ? (
        <section class="page__section station-ear" aria-label={S.earAria} data-chip={chip}>
          <h3 class="page__label">{S.earTitle}</h3>
          <TeachOnce id={EAR_PANEL_TEACH_ID} title={S.earTeachTitle} body={S.earTeachBody} seen={progress.teachSeen} onDismiss={(id) => store.patch('progress', (p) => markTeachSeen(p, id))} />
          <p class="page__muted station-ear__intro">{S.earIntro}</p>
          <ul class="list station-ear__rows">
            {(() => {
              const listened = progress.listened ?? [];
              const text = earTextFor(stories, listened);
              const along = earReadAlongFor(stories, listened);
              const rows: { key: string; label: string; en: string; to: Route }[] = [];
              if (text) rows.push({ key: 'set', label: S.earSet, en: S.earSetEn, to: { name: 'listen', id: text.id } });
              if (along) rows.push({ key: 'readalong', label: S.earReadAlong, en: S.earReadAlongEn, to: { name: 'story', id: along.id, mode: 'listen' } });
              rows.push({ key: 'radio', label: S.earRadio, en: S.earRadioEn, to: { name: 'radio' } });
              return rows.map((r) => (
                <li key={r.key} class="list__item station-ear__row" data-row={r.key}>
                  <span class="station-ear__text">
                    <span class="station-ear__label" lang="ja">
                      {r.label}
                    </span>
                    <span class="page__muted">{r.en}</span>
                  </span>
                  <span class="station-ear__side">
                    <span class={`chip station-ear__chip station-ear__chip--${chip}`}>{EAR_CHIP_LABEL[chip]}</span>
                    <a class="btn btn--sm" href={href(r.to)}>
                      {S.earOpen}
                    </a>
                  </span>
                </li>
              ));
            })()}
          </ul>
          {minutes !== null ? <p class="station-ear__minutes">{minutes >= 1 ? fill(S.earMinutes, { n: minutes }) : S.earMinutesNone}</p> : null}
        </section>
      ) : null}

      {bundle && bundle.storyIds.length > 0 ? (
        <section class="page__section" aria-label={S.storiesTitle}>
          <h3 class="page__label">{S.storiesTitle}</h3>
          <ul class="list station-stories">
            {bundle.storyIds.map((id) => {
              const st = loader.get<StoryItem>(id);
              const story = st && 'lines' in st ? st : undefined;
              const piece = story?.audioFirst === true;
              const heard = (progress.listened ?? []).includes(id);
              return (
                <li key={id} class="list__item station-story" data-audio-first={piece ? 'true' : undefined}>
                  <span class="station-story__text">
                    <span class="station-story__title" lang="ja">
                      {story ? toPlain(story.titleJa) : id}
                    </span>
                    {story ? (
                      <span class="page__muted">
                        {story.titleEn}
                        {story.bridge ? ` · ${S.storyBridge}` : ''}
                        {piece && story.genre ? <span class="station-story__genre">{` · ${GENRE_LABEL[story.genre]}`}</span> : null}
                        {piece ? <span class="station-story__first">{` · ${S.storyListenFirst}`}</span> : null}
                      </span>
                    ) : null}
                  </span>
                  <span class="station-story__links">
                    {piece ? (
                      <>
                        <a class="btn btn--sm" href={href({ name: 'listen', id })}>
                          {S.storyListen}
                        </a>
                        {heard ? (
                          <a class="btn btn--sm btn--ghost" href={href({ name: 'story', id })}>
                            {S.storyRead}
                          </a>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <a class="btn btn--sm" href={href({ name: 'story', id })}>
                          {S.storyRead}
                        </a>
                        <a class="btn btn--sm btn--ghost" href={href({ name: 'listen', id })}>
                          {S.storyListen}
                        </a>
                      </>
                    )}
                    {story && isSpeakable(story) ? (
                      <a class="btn btn--sm btn--ghost" href={href({ name: 'taiwa', id })}>
                        {S.storyTalk}
                      </a>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {n >= PLATEAU_FROM ? (
            <div class="notice station-external">
              <h4 class="page__label">{S.externalTitle}</h4>
              <p>{S.externalLine}</p>
              <p>{fill(S.externalTarget, { n: weeklyTargetHours(store.profile.value.belt, store.profile.value.dan) })}</p>
              <a class="btn btn--sm" href={href({ name: 'ledger' })}>
                {S.ledgerLink}
              </a>
            </div>
          ) : null}
        </section>
      ) : null}

      {bundle ? (
        <section class="page__section" aria-label={S.michikusaTitle}>
          <h3 class="page__label">{S.michikusaTitle}</h3>
          <p>
            {fill(S.michikusaCollected, { n: michiDone, total: michiTotal })}
            {michiTotal > michiDone ? ` · ${fill(S.michikusaMore, { n: michiTotal - michiDone, name: def.nameRomaji })}` : michiTotal > 0 ? ` · ${S.michikusaAll}` : ''}
          </p>
          <a class="btn btn--sm btn--ghost" href={href({ name: 'library' })}>
            {S.michikusaLibrary}
          </a>
        </section>
      ) : null}

      {groups.length > 0 ? (
        <section class="page__section" aria-label={S.itemsTitle}>
          <h3 class="page__label">{S.itemsTitle}</h3>
          {groups.map((g) => (
            <div key={g.kind} class="station-items" data-kind={g.kind}>
              <h4 class="station-items__head">
                <span class="station-items__glyph" lang="ja" aria-hidden="true">
                  {ITEM_KIND_GLYPH[g.kind]}
                </span>
                {ITEM_KIND_LABEL[g.kind]} · {fill(S.introducedLine, { n: introducedOf(g.ids), total: g.ids.length })}
              </h4>
              <ul class="station-items__list">
                {g.ids.slice(0, ITEMS_SHOWN).map((id) => {
                  const belt: ItemBelt = itemBeltOf(id, kindOfItem(id) ?? g.kind);
                  return (
                    <li key={id} class={`belt belt--${belt} station-item`} data-item={id} title={BELT_LABEL[belt].en}>
                      <span lang="ja">{itemHead(loader.get(id), id)}</span>
                    </li>
                  );
                })}
                {g.ids.length > ITEMS_SHOWN ? <li class="page__muted">{fill(S.itemsMore, { n: g.ids.length - ITEMS_SHOWN })}</li> : null}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      <div class="page__actions">
        <a class="btn btn--ghost" href={href({ name: 'road' })}>
          {S.backToRoad}
        </a>
      </div>
    </section>
  );
}
