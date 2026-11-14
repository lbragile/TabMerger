import { useTranslation } from 'react-i18next';
import type { Window as SavedWindow } from '@/lib/types';
import { isOpenableUrl } from '@/lib/safeOpen';
import { getDisplayTitle } from '@/lib/tabTitle';
import { FALLBACK_FAVICON, getUrlDisplay, openSavedTab } from '@/lib/savedTab';

/** Marks the tab buttons of a read-only list, for the Up/Down arrow keys. */
const READ_ONLY_TAB_ATTR = 'data-read-only-tab';

/**
 * Up/Down move between the list's tab buttons (Home/End to the first and last). The key is
 * consumed, so the popup-wide arrow-key group switching (`useKeyboardNav`) leaves it alone.
 */
function handleListKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(`button[${READ_ONLY_TAB_ATTR}]`)];
  const at = buttons.indexOf(e.target as HTMLButtonElement);
  if (at < 0) return;
  e.preventDefault();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : Math.min(Math.max(at + (e.key === 'ArrowDown' ? 1 : -1), 0), buttons.length - 1);
  buttons[next]?.focus();
}

/**
 * Windows and their tabs, read-only: the look of the windows panel's cards without any of its
 * editing (no drag and drop, keyboard move, selection, rename, notes or menus, and no drop
 * targets). A tab is a button that opens it the way a saved tab opens (`openSavedTab`). Used by
 * the archived-group and session views. Rows carry none of the `data-group-index` /
 * `data-window-index` / `data-tab-index` attributes the popup's keyboard shortcuts act on, so
 * Delete, F2 and N do nothing here.
 */
export function ReadOnlyWindows({ windows }: { windows: readonly SavedWindow[] }) {
  const { t } = useTranslation();
  if (windows.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">{t('windows.noWindows')}</p>;
  }
  return (
    <div className="min-w-0" onKeyDown={handleListKeyDown}>
      {windows.map((win, windowIndex) => {
        const title = win.name ?? t('window.numbered', { number: windowIndex + 1 });
        const tabs = win.tabs.filter(Boolean);
        return (
          <section key={windowIndex} aria-label={title} className="mb-2 min-w-0 overflow-hidden border border-border bg-card p-1">
            <div className="flex min-w-0 items-center gap-1.5 border-b border-border/50 px-1.5 py-1">
              <span dir="auto" className="min-w-0 truncate text-xs font-medium text-ui-start">{title}</span>
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
          </section>
        );
      })}
    </div>
  );
}
