import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppWindow, Eraser, Trash2 } from 'lucide-react';
import { SEARCH_NON_MATCHING } from '@tabmerger/shared';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import type { Group } from '@/lib/types';
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed';
import type { RecentlyClosedDay } from '@/lib/recentlyClosedDays';
import { RECENTLY_CLOSED_LIMITS } from '@tabmerger/shared';
import { textMatches } from '@/lib/searchMatch';
import { handleReadOnlyListKeyDown } from '@/lib/readOnlyListKeys';
import { useUIStore } from '@/stores/uiStore';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useSearchFilters, useSearchMode } from '@/hooks/useSearchView';
import { useRecentlyClosedActions } from '@/hooks/useRecentlyClosedActions';
import { useFocusAfterRowRemoval } from '@/hooks/useFocusAfterRowRemoval';
import { openPricingPage } from '@/lib/pricingLink';
import { SECTION_VIEW_TITLE_ATTR, SectionViewHeader } from './SectionViewHeader';
import { SaveToGroupMenu } from './SaveToGroupMenu';
import { CLOSED_ENTRY_ATTR, ClosedEntryRow, type ClosedEntryActions } from './ClosedEntryRow';

/** How many entries of a day show at first, and how many more each "Show more" adds. */
export const CLOSED_DAY_PAGE_SIZE = 100;

/** Whether a closed entry matches the search box's plain words (title or URL of any of its tabs). */
export function closedEntryMatches(entry: RecentlyClosedEntry, query: string): boolean {
  return entry.tabs.some((tab) => textMatches(tab.title, query) || textMatches(tab.url, query));
}

interface ClosedDayViewProps {
  day: RecentlyClosedDay;
  /** Every recently-closed day (for "Clear all … (N)" and the Free note under the oldest day). */
  days: readonly RecentlyClosedDay[];
  groups: readonly Group[];
}

/**
 * One local day of the recently-closed list in the main panel (`mainView` `closedDay`): header
 * with the day's colour dot, its label, "Recently closed ◆ 8 closed", the day's ⋯ menu and ✕; then
 * the day's entries, newest first, as one arrow-key list (`ClosedEntryRow`). The header search
 * box filters the entries by title and URL while the day shows. Reopening or removing an entry
 * moves focus to the next row (else the previous, else the title). The first 100 entries show,
 * then "Show more". On Free, the oldest day ends with a note on how long each plan keeps them.
 */
export function ClosedDayView({ day, days, groups }: ClosedDayViewProps) {
  const { t } = useTranslation();
  const closeMainView = useUIStore((s) => s.closeMainView);
  const { tier, loading: planLoading } = useEntitlements();
  const filters = useSearchFilters();
  const searchMode = useSearchMode();
  const actions = useRecentlyClosedActions();
  const [limit, setLimit] = useState(CLOSED_DAY_PAGE_SIZE);
  const rootRef = useRef<HTMLDivElement>(null);

  const query = filters.tabQuery;
  const matching = query ? day.entries.filter((e) => closedEntryMatches(e, query)) : day.entries;
  const hide = !!query && searchMode === SEARCH_NON_MATCHING.HIDE;
  const listed = (hide ? matching : day.entries).slice(0, limit);
  const more = (hide ? matching : day.entries).length - listed.length;
  const focus = useFocusAfterRowRemoval(rootRef, listed.map((e) => e.id), CLOSED_ENTRY_ATTR, `[${SECTION_VIEW_TITLE_ATTR}]`);
  const matchingIds = new Set(matching.map((e) => e.id));
  const totalEntries = days.reduce((n, d) => n + d.entries.length, 0);
  const oldestFree = !planLoading && tier === 'free' && days[days.length - 1]?.key === day.key;

  /** Runs an action that takes `entry` off the list, moving focus once it has gone. */
  const leaving = async (entry: RecentlyClosedEntry, run: () => Promise<boolean>) => {
    focus.prepare(entry.id);
    if (!(await run())) focus.cancel();
  };

  const rowActions: ClosedEntryActions = {
    reopen: (entry, opts) => {
      // one tab out of a window keeps the row (same id: the rest of the window, or its last tab)
      if (opts?.tabIndex !== undefined) void actions.reopen(entry, opts);
      else void leaving(entry, () => actions.reopen(entry, opts));
    },
    remove: (entry) => void leaving(entry, () => actions.remove(entry)),
    save: (entry, target, groupName) => void actions.saveToGroup([entry], target, entry.kind, groupName),
    copyLink: (url) => void actions.copyLink(url)
  };

  return (
    <div ref={rootRef} className="flex h-full min-w-0 flex-col overflow-hidden" data-testid="closed-day-view">
      <SectionViewHeader
        color={day.color}
        title={day.label}
        meta={t('recentlyClosed.view.meta', { count: day.entries.length })}
        menuItems={
          <>
            <DropdownMenuItem className="text-xs" onClick={() => void actions.reopenAll(day)}>
              <AppWindow className="me-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {t('recentlyClosed.view.reopenAll')}
            </DropdownMenuItem>
            <SaveToGroupMenu
              groups={groups}
              entries={day.entries}
              label={t('recentlyClosed.view.saveAll')}
              onSave={(target, groupName) => void actions.saveToGroup(day.entries, target, 'day', groupName)}
            />
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-xs text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive" onClick={() => void actions.removeDay(day)}>
              <Trash2 className="me-2 h-3.5 w-3.5 shrink-0" />
              {t('recentlyClosed.view.removeDay')}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-xs text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive" onClick={() => void actions.clearAll()}>
              <Eraser className="me-2 h-3.5 w-3.5 shrink-0" />
              {t('recentlyClosed.view.clearAll', { n: totalEntries })}
            </DropdownMenuItem>
          </>
        }
        onClose={() => closeMainView(groups)}
      />
      <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
        {query && matching.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">{t('recentlyClosed.view.noMatches')}</p>
        )}
        <ul aria-label={t('recentlyClosed.view.listLabel')} className="min-w-0" onKeyDown={handleReadOnlyListKeyDown}>
          {listed.map((entry) => (
            <ClosedEntryRow key={entry.id} entry={entry} groups={groups} actions={rowActions} dimmed={!!query && !hide && !matchingIds.has(entry.id)} />
          ))}
        </ul>
        {more > 0 && (
          <div className="flex justify-center py-2">
            <Button variant="outline" size="sm" className="h-7 rounded-none text-xs" onClick={() => setLimit((n) => n + CLOSED_DAY_PAGE_SIZE)}>
              {t('recentlyClosed.view.showMore')}
            </Button>
          </div>
        )}
        {oldestFree && (
          <p className="px-1.5 py-2 text-[11px] text-muted-foreground" data-testid="closed-day-free-note">
            {t('recentlyClosed.section.freeNote', { free: RECENTLY_CLOSED_LIMITS.free.days, pro: RECENTLY_CLOSED_LIMITS.pro.days })}{' '}
            <Button variant="link" size="sm" className="inline h-auto whitespace-normal p-0 text-start align-baseline text-[11px]" onClick={() => openPricingPage('recently_closed_day')}>
              {t('recentlyClosed.section.seePro')}
            </Button>
          </p>
        )}
      </div>
    </div>
  );
}
