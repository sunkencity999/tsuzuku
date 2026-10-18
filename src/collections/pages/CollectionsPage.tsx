/**
 * TSUZUKU — Collections page (group G): `#/collections/:tab` → Mon (紋) |
 * Kakejiku (掛け軸) | Goshuin-chō (御朱印帳). The tab comes from the route so
 * every shelf has a link; the tab strip is a real tablist (arrow keys move,
 * Enter/Space follow the link) and the panel holds the chosen collection.
 * The page mounts the ONE shared wet-ink def (`#ink-bleed-8`, design 09 §5.3)
 * that moment E's `.ink-wet` layer references on both shelves; at most two
 * reveals are live at a time (`reveal.ts`), so the page never holds more than
 * two live SVG filters (§6.7 rule 2).
 */
import type { JSX } from 'preact';
import { inkBleed } from '../../art/brush';
import { COLLECTION_TABS, href, navigate, type CollectionsTab, type Route } from '../../shared/routes';
import { GoshuinBook } from '../GoshuinBook';
import { KakejikuGallery } from '../KakejikuGallery';
import { MonGrid } from '../MonGrid';
import { S } from '../strings';
import './CollectionsPage.css';

export interface CollectionsPageProps {
  route: Route;
}

interface TabDef {
  id: CollectionsTab;
  ja: string;
  en: string;
}

export const TABS: readonly TabDef[] = [
  { id: 'mon', ja: S.tabMonJa, en: S.tabMon },
  { id: 'kakejiku', ja: S.tabKakejikuJa, en: S.tabKakejiku },
  { id: 'goshuin', ja: S.tabGoshuinJa, en: S.tabGoshuin },
];

/** The tab a route names; anything else opens the Mon shelf. */
export function tabOf(route: Route): CollectionsTab {
  return route.name === 'collections' && (COLLECTION_TABS as readonly string[]).includes(route.tab) ? route.tab : 'mon';
}

/** The one shared `#ink-bleed-8` def per page (brush.ts `inkBleed` at scale 8, seed 8 — the Dojo's twin). */
const INK_DEFS = inkBleed('ink-bleed-8', 8, { scale: 8 });

function Panel(p: { tab: CollectionsTab }): JSX.Element {
  switch (p.tab) {
    case 'kakejiku':
      return <KakejikuGallery />;
    case 'goshuin':
      return <GoshuinBook />;
    default:
      return <MonGrid />;
  }
}

export default function CollectionsPage(p: CollectionsPageProps): JSX.Element {
  const tab = tabOf(p.route);
  const index = TABS.findIndex((t) => t.id === tab);

  const onKey = (e: KeyboardEvent): void => {
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % TABS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = TABS[next]!;
    navigate({ name: 'collections', tab: target.id });
    const el = (e.currentTarget as HTMLElement | null)?.closest('.collections__tabs')?.querySelector<HTMLElement>(`#collections-tab-${target.id}`);
    el?.focus();
  };

  return (
    <div class="collections" data-tab={tab}>
      <svg class="collections__defs" width="0" height="0" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: INK_DEFS }} />
      <header class="collections__head">
        <h1 class="title-lockup">
          <span class="title-lockup__ja" lang="ja">
            {S.collectionsJa}
          </span>
          <span class="title-lockup__en">{S.collectionsTitle}</span>
        </h1>
        <p class="collections__lede">{S.collectionsLede}</p>
      </header>
      <nav class="collections__tabs" role="tablist" aria-label={S.tabsLabel}>
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <a
              key={t.id}
              id={`collections-tab-${t.id}`}
              class="collections__tab"
              role="tab"
              href={href({ name: 'collections', tab: t.id })}
              aria-selected={active ? 'true' : 'false'}
              aria-controls="collections-panel"
              tabIndex={active ? 0 : -1}
              onKeyDown={onKey}
            >
              <span class="collections__tab-ja" lang="ja">
                {t.ja}
              </span>
              <span class="collections__tab-en">{t.en}</span>
            </a>
          );
        })}
      </nav>
      <section id="collections-panel" class="collections__panel" role="tabpanel" aria-labelledby={`collections-tab-${tab}`}>
        <Panel tab={tab} />
      </section>
    </div>
  );
}
