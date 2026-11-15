import { t } from '@/lib/i18n';
import type { ClosedTab, RecentlyClosedEntry } from '@/lib/recentlyClosed';
import { dayLabel, formatClosedTime, localDayBounds } from '@/lib/recentlyClosedDays';
import { MATCH_RANK, bestRank, matchRank, sortByRank, textMatches, type MatchRank, type SearchFilters } from '@/lib/searchMatch';

/**
 * The search overlay's "Recently closed" results (Ctrl/Cmd+K). Pure apart from the catalog read in
 * {@link closedWhenLabel}: popup only, never imported by the worker.
 */

/** How many closed matches the overlay lists under the saved results. */
export const CLOSED_RESULTS_UNDER_SAVED = 3;

/** One "Recently closed" result. */
export interface ClosedSearchResult {
  entry: RecentlyClosedEntry;
  /**
   * The tab the row shows and Enter reopens: its position in `entry.tabs`. `undefined` for a whole
   * window (a window entry listed by `closed:` with no words, Enter restores the window).
   */
  tabIndex?: number;
  /** The tab shown (the matching one); for a whole window, its first tab. */
  tab: ClosedTab;
  /** The tab came out of a closed window (the row says so). */
  fromWindow: boolean;
}

/** How well one closed tab matches: the plain words (title or address), else the `tag:` filter. */
function tabRank(tab: ClosedTab, f: Pick<SearchFilters, 'tabQuery' | 'tagFilter'>): MatchRank {
  return f.tabQuery ? bestRank(matchRank(tab.title, f.tabQuery), matchRank(tab.url, f.tabQuery)) : matchRank(tab.tabGroup?.title, f.tagFilter);
}

/** Whether one closed tab matches every filter that applies to it (the words and `tag:`). */
function tabMatches(tab: ClosedTab, f: Pick<SearchFilters, 'tabQuery' | 'tagFilter'>): boolean {
  if (f.tabQuery && !(textMatches(tab.title, f.tabQuery) || textMatches(tab.url, f.tabQuery))) return false;
  if (f.tagFilter && !(tab.tabGroup && textMatches(tab.tabGroup.title, f.tagFilter))) return false;
  return true;
}

/**
 * The closed entries that match, best match first (newest first within a rank), at most `limit`.
 *
 * - Under the saved results (`closedOnly` false) the list only searches words or `tag:`; a
 *   `group:` or `window:` filter scopes the search to saved data, so nothing closed matches.
 * - With `closed:` (`closedOnly`) `group:` and `window:` are ignored, and with no words or tag at
 *   all every entry is listed, newest first (window entries as whole windows).
 * - A window entry is one result: its best-matching tab (the first one on a tie).
 *
 * Uses the same contiguous matcher and ranks as the saved results (`textMatches` / `matchRank`).
 */
export function searchRecentlyClosed(entries: readonly RecentlyClosedEntry[], f: SearchFilters, limit: number): ClosedSearchResult[] {
  const narrows = !!(f.tabQuery || f.tagFilter);
  if (!f.closedOnly && (!narrows || f.groupFilter || f.windowFilter)) return [];
  const newestFirst = entries.filter((e) => e.clearedAt === undefined && e.tabs.length > 0).sort((a, b) => b.closedAt - a.closedAt);
  const ranked: Array<{ result: ClosedSearchResult; rank: MatchRank }> = [];
  for (const entry of newestFirst) {
    const fromWindow = entry.kind === 'window';
    if (!narrows) {
      ranked.push({ result: { entry, tab: entry.tabs[0], fromWindow, tabIndex: fromWindow ? undefined : 0 }, rank: MATCH_RANK.NONE });
      continue;
    }
    let best: { tabIndex: number; rank: MatchRank } | undefined;
    entry.tabs.forEach((tab, tabIndex) => {
      if (!tabMatches(tab, f)) return;
      const rank = tabRank(tab, f);
      if (!best || rank < best.rank) best = { tabIndex, rank };
    });
    if (best) ranked.push({ result: { entry, tab: entry.tabs[best.tabIndex], tabIndex: best.tabIndex, fromWindow }, rank: best.rank });
  }
  return sortByRank(ranked, (r) => r.rank).slice(0, limit).map((r) => r.result);
}

/**
 * When an entry was closed, for its result row: "closed today 10:11", "closed yesterday 18:02",
 * else "closed Mon, Nov 9" (the day labels and clock times of the recently-closed list).
 */
export function closedWhenLabel(closedAt: number, now: number = Date.now(), locale?: string): string {
  const { kind, label } = dayLabel(localDayBounds(closedAt).start, now, locale);
  if (kind === 'today') return t('search.closedToday', { time: formatClosedTime(closedAt, locale) });
  if (kind === 'yesterday') return t('search.closedYesterday', { time: formatClosedTime(closedAt, locale) });
  return t('search.closedOn', { day: label });
}
