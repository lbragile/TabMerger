import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { Window as SavedWindow } from '@/lib/types';
import { isOpenableUrl } from '@/lib/safeOpen';
import { getDisplayTitle } from '@/lib/tabTitle';
import { FALLBACK_FAVICON, getUrlDisplay, openSavedTab } from '@/lib/savedTab';
import { READ_ONLY_TAB_ATTR, READ_ONLY_TAB_KEYS, handleReadOnlyListKeyDown } from '@/lib/readOnlyListKeys';

interface ReadOnlyWindowsProps {
  windows: readonly SavedWindow[];
  /** Heading level of each window's title: 3 under a view's h2, 4 under a session group's h3. */
  headingLevel?: 3 | 4;
  /**
   * Whether this list handles the arrow keys itself. Off when an ancestor does it for several
   * lists at once (the session view: one list across all its groups).
   */
  ownArrowKeys?: boolean;
}

/**
 * Windows and their tabs, read-only: the look of the windows panel's cards without any of its
 * editing (no drag and drop, keyboard move, selection, rename, notes or menus, and no drop
 * targets). Each window is a `role="group"` named by its heading (not a landmark). A tab is a
 * button that opens it the way a saved tab opens (`openSavedTab`); Up/Down/Home/End move between
 * them (`handleReadOnlyListKeyDown`). Used by the archived-group and session views. Rows carry
 * none of the `data-group-index` / `data-window-index` / `data-tab-index` attributes the popup's
 * keyboard shortcuts act on, so Delete, F2 and N do nothing here.
 */
export function ReadOnlyWindows({ windows, headingLevel = 3, ownArrowKeys = true }: ReadOnlyWindowsProps) {
  const { t } = useTranslation();
  const baseId = useId();
  if (windows.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">{t('windows.noWindows')}</p>;
  }
  const Heading = headingLevel === 4 ? 'h4' : 'h3';
  return (
    <div className="min-w-0" onKeyDown={ownArrowKeys ? handleReadOnlyListKeyDown : undefined}>
      {windows.map((win, windowIndex) => {
        const title = win.name ?? t('window.numbered', { number: windowIndex + 1 });
        const tabs = win.tabs.filter(Boolean);
        const headingId = `${baseId}-w${windowIndex}`;
        return (
          <div key={windowIndex} role="group" aria-labelledby={headingId} className="mb-2 min-w-0 overflow-hidden border border-border bg-card p-1">
            <div className="flex min-w-0 items-center gap-1.5 border-b border-border/50 px-1.5 py-1">
              <Heading id={headingId} dir="auto" className="min-w-0 truncate text-xs font-medium text-ui-start">{title}</Heading>
              <span className="shrink-0 text-[10px] text-muted-foreground">{t('common.tabCountTitle', { count: tabs.length })}</span>
            </div>
            <ul className="min-w-0">
              {tabs.map((tab, tabIndex) => {
                const shown = getDisplayTitle(tab) || tab.url || t('tab.fallbackTitle');
                const address = getUrlDisplay(tab.url);
                return (
                  <li key={tabIndex} className="min-w-0">
                    <button
                      type="button"
                      {...{ [READ_ONLY_TAB_ATTR]: '' }}
                      aria-keyshortcuts={READ_ONLY_TAB_KEYS}
                      className="flex w-full min-w-0 items-center gap-1 px-1.5 py-0.5 text-start hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!isOpenableUrl(tab.url)}
                      title={tab.url}
                      onClick={() => void openSavedTab(tab)}
                    >
                      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-white dark:border-white/15 dark:bg-zinc-700">
                        <img src={tab.favIconUrl || FALLBACK_FAVICON} alt="" className="h-3.5 w-3.5" onError={(e) => { e.currentTarget.src = FALLBACK_FAVICON; }} />
                      </span>
                      {/* The same two columns as a saved tab row: title, then the address */}
                      <span className="me-2 grid min-w-0 flex-1 grid-cols-[12.5rem_minmax(0,1fr)] items-center gap-x-1.5 overflow-hidden">
                        <span dir="auto" className="block min-w-0 truncate text-xs leading-5 text-ui-start">{shown}</span>
                        <span dir="ltr" className="min-w-0 max-w-full truncate justify-self-start text-[10px] text-muted-foreground text-ui-start">{address}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
