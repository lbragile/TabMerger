import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import type { Tab } from '@/lib/types';
import { isOpenableUrl } from '@/lib/safeOpen';
import { getDisplayTitle } from '@/lib/tabTitle';
import { FALLBACK_FAVICON, getSiteDisplay, openSavedTab } from '@/lib/savedTab';
import { READ_ONLY_TAB_ATTR, READ_ONLY_TAB_KEYS } from '@/lib/readOnlyListKeys';

/**
 * One tab of a read-only window: a button that opens it the way a saved tab opens
 * (`openSavedTab`), disabled for a URL that may not be opened from stored data. Favicon, title,
 * then the site on the end side; an "opens in a tab" icon shows on hover and keyboard focus.
 * Takes part in the view's one arrow-key list (`READ_ONLY_TAB_ATTR`), never a Tab stop of its own
 * beyond being a button.
 */
export function ReadOnlyTabRow({ tab }: { tab: Tab }) {
  const { t } = useTranslation();
  const shown = getDisplayTitle(tab) || tab.url || t('tab.fallbackTitle');
  const site = getSiteDisplay(tab.url);
  return (
    <li className="min-w-0">
      <button
        type="button"
        {...{ [READ_ONLY_TAB_ATTR]: '' }}
        aria-keyshortcuts={READ_ONLY_TAB_KEYS}
        className="group/row flex h-[1.875rem] w-full min-w-0 items-center gap-2.5 px-2 text-start hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        disabled={!isOpenableUrl(tab.url)}
        title={tab.url}
        onClick={() => void openSavedTab(tab)}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-black/10 dark:bg-zinc-700 dark:ring-white/15">
          <img src={tab.favIconUrl || FALLBACK_FAVICON} alt="" className="h-4 w-4" onError={(e) => { e.currentTarget.src = FALLBACK_FAVICON; }} />
        </span>
        <span dir="auto" className="min-w-0 flex-1 truncate text-xs leading-5 text-ui-start">{shown}</span>
        {/* a space for the accessible name ("Docs docs.test"); a flex container drops it visually */}
        {' '}
        {site && <span dir="ltr" className="max-w-[8.75rem] shrink-0 truncate text-[0.6875rem] text-muted-foreground">{site}</span>}
        <ExternalLink
          aria-hidden="true"
          data-opens-tab-icon=""
          className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100 group-disabled/row:invisible"
        />
      </button>
    </li>
  );
}
