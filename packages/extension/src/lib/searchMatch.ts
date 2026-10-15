import { isHiddenFromSearch } from '@/lib/tourSandbox';
import type { Group, Tab, Window } from '@/lib/types';
import { parseSearchQuery } from '@/lib/utils';
import { getDisplayTitle } from '@/lib/tabTitle';

/** A highlighted run of characters: `[start, end)` offsets into the text. */
export type MatchRange = [start: number, end: number];

export type SearchFilters = ReturnType<typeof parseSearchQuery>;

export const NO_FILTERS: SearchFilters = { groupFilter: '', windowFilter: '', tagFilter: '', tabQuery: '' };

const DEFAULT_WINDOW_NAME = 'Window';

/** The query as it is compared: surrounding whitespace is not part of what the user is looking for. */
export function normalizeQuery(query: string | undefined | null): string {
  return (query ?? '').trim();
}

/**
 * Whether `query` occurs in `text` exactly as typed: one contiguous, case-insensitive run of
 * characters (never letters picked out one by one). The query is trimmed first; an empty query
 * matches everything. Plain `indexOf` on lowercased strings: the query is never a RegExp.
 *
 * Every search filter goes through this, and {@link matchRanges} marks the same occurrence, so a
 * row that is shown as a result always has a highlight and a row with a highlight is a result.
 */
export function textMatches(text: string | undefined | null, query: string | undefined | null): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;
  return !!text && text.toLowerCase().includes(q.toLowerCase());
}

/**
 * Where `query` matched in `text`, for highlighting: the first contiguous case-insensitive
 * occurrence of the trimmed query as one `[start, end)` range, or none. Non-empty exactly when
 * {@link textMatches} is true for a non-empty query.
 */
export function matchRanges(text: string | undefined | null, query: string | undefined | null): MatchRange[] {
  const q = normalizeQuery(query);
  if (!text || !q) return [];
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  return at < 0 ? [] : [[at, at + q.length]];
}

/** How well a text matched, for ordering results: lower is better. */
export const MATCH_RANK = { EXACT: 0, PREFIX: 1, WORD_START: 2, ANYWHERE: 3, NONE: 4 } as const;
export type MatchRank = (typeof MATCH_RANK)[keyof typeof MATCH_RANK];

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Ranks a contiguous match of `query` in `text`: the whole text, its start, the start of a word
 * in it (the character before is not a letter or digit), or anywhere. `NONE` when it does not
 * match at all (and for an empty query, which says nothing about relevance).
 */
export function matchRank(text: string | undefined | null, query: string | undefined | null): MatchRank {
  const q = normalizeQuery(query).toLowerCase();
  if (!text || !q) return MATCH_RANK.NONE;
  const t = text.toLowerCase();
  if (t === q) return MATCH_RANK.EXACT;
  let at = t.indexOf(q);
  if (at < 0) return MATCH_RANK.NONE;
  if (at === 0) return MATCH_RANK.PREFIX;
  for (; at >= 0; at = t.indexOf(q, at + 1)) {
    if (!WORD_CHAR.test(t[at - 1])) return MATCH_RANK.WORD_START;
  }
  return MATCH_RANK.ANYWHERE;
}

/** The best (lowest) of several ranks. */
export function bestRank(...ranks: MatchRank[]): MatchRank {
  return ranks.reduce<MatchRank>((a, b) => (b < a ? b : a), MATCH_RANK.NONE);
}

/**
 * `items` ordered best match first by `rankOf`. Stable: equal ranks keep their order.
 */
export function sortByRank<T>(items: T[], rankOf: (item: T) => MatchRank): T[] {
  return items
    .map((item, i) => ({ item, i, rank: rankOf(item) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.item);
}

/**
 * Cuts the start off a long text so its first match is near the beginning, where a row that
 * truncates on the right still shows it. Returns the text to draw and the ranges moved to it.
 *
 * @param skip characters at the start that may always be dropped (a URL's `https://www.`)
 * @param maxLead how far in the first match may sit before the start is cut
 * @param keep characters kept before the first match once the start is cut
 */
export function snippetAroundMatch(
  text: string,
  ranges: MatchRange[],
  { skip = 0, maxLead = 24, keep = 10 }: { skip?: number; maxLead?: number; keep?: number } = {}
): { text: string; ranges: MatchRange[] } {
  if (ranges.length === 0) return { text, ranges };
  const first = ranges[0][0];
  let start = first >= skip ? skip : 0;
  let lead = '';
  if (first - start > maxLead) {
    start = first - keep;
    lead = '…';
  }
  if (start === 0) return { text, ranges };
  const shift = start - lead.length;
  return { text: lead + text.slice(start), ranges: ranges.map(([s, e]) => [s - shift, e - shift]) };
}

/** Length of the scheme and `www.` at the start of a URL (never worth a row's first characters). */
export function urlPrefixLength(url: string): number {
  return /^[a-z][a-z0-9+.-]*:\/\/(www\.)?/i.exec(url)?.[0].length ?? 0;
}

export function isSearchActive(f: SearchFilters): boolean {
  return !!(f.tabQuery || f.tagFilter || f.windowFilter || f.groupFilter);
}

/** The plain words and the `tag:` filter against one tab (the title shown, the page title, the address). */
export function tabMatchesFilters(tab: Tab, f: Pick<SearchFilters, 'tabQuery' | 'tagFilter'>): boolean {
  if (f.tabQuery) {
    const hit =
      textMatches(getDisplayTitle(tab) ?? '', f.tabQuery) ||
      textMatches(tab.title ?? '', f.tabQuery) ||
      textMatches(tab.url ?? '', f.tabQuery);
    if (!hit) return false;
  }
  if (f.tagFilter && !(tab.chromeGroup != null && textMatches(tab.chromeGroup.name, f.tagFilter))) return false;
  return true;
}

export function windowNameMatches(win: Window, windowFilter: string): boolean {
  return !windowFilter || textMatches(win.name ?? DEFAULT_WINDOW_NAME, windowFilter);
}

export function groupNameMatches(group: Group, groupFilter: string): boolean {
  return !groupFilter || textMatches(group.name, groupFilter);
}

export interface WindowSearchState {
  /** One flag per tab, by the tab's real index in the window. */
  tabMatches: boolean[];
  matchCount: number;
  /** The window is itself the result: a `window:` filter matched its name and nothing narrows the tabs further. */
  selfMatch: boolean;
  /** Drawn in "hide" mode: it has a matching tab, or it is itself the result. */
  visible: boolean;
}

export interface GroupSearchState {
  windows: WindowSearchState[];
  matchCount: number;
  tabCount: number;
  /** The group's name is what matched: a `group:` filter, or the plain words when no prefix is used. */
  nameMatch: boolean;
  /** Listed in the sidebar in "hide" mode. */
  visible: boolean;
}

/**
 * What matches in one group. Pure, and positional: every array is indexed like the group's own
 * `windows` / `tabs`, so hiding a row never changes the index an action is sent with.
 */
export function groupSearchState(group: Group, f: SearchFilters): GroupSearchState {
  const groupOk = groupNameMatches(group, f.groupFilter);
  const narrowsTabs = !!(f.tabQuery || f.tagFilter);
  let matchCount = 0;
  let tabCount = 0;
  const windows = group.windows.map<WindowSearchState>((win) => {
    const windowOk = groupOk && windowNameMatches(win, f.windowFilter);
    const tabMatches = win.tabs.map((tab) => !!tab && windowOk && tabMatchesFilters(tab, f));
    const count = tabMatches.filter(Boolean).length;
    const selfMatch = windowOk && !!f.windowFilter && !narrowsTabs;
    matchCount += count;
    tabCount += win.tabs.length;
    return { tabMatches, matchCount: count, selfMatch, visible: count > 0 || selfMatch };
  });
  const plainOnly = !!f.tabQuery && !f.groupFilter && !f.windowFilter && !f.tagFilter;
  const nameMatch =
    (!!f.groupFilter && groupOk && !f.windowFilter && !narrowsTabs) ||
    (plainOnly && textMatches(group.name, f.tabQuery));
  // Found by its name alone (plain words, no tab of its own matches): the group is the result,
  // so its tabs are shown as they are. Otherwise going to it would show an empty panel.
  if (plainOnly && nameMatch && matchCount === 0) {
    const all = group.windows.map<WindowSearchState>((win) => ({
      tabMatches: win.tabs.map((tab) => !!tab),
      matchCount: win.tabs.length,
      selfMatch: true,
      visible: true
    }));
    return { windows: all, matchCount: tabCount, tabCount, nameMatch, visible: true };
  }
  return {
    windows,
    matchCount,
    tabCount,
    nameMatch,
    visible: matchCount > 0 || nameMatch || windows.some((w) => w.selfMatch)
  };
}

export interface SearchSummary {
  /** By the group's real index in `available`. Archived groups and groups hidden from search have no entry. */
  perGroup: Array<GroupSearchState | undefined>;
  matchingTabs: number;
  groupsWithMatches: number;
}

/**
 * Matches across every searchable group. Groups search must leave out (`isHiddenFromSearch`:
 * the guided tour's practice groups, except during the tour's own search steps) have no entry,
 * as in the search results list; nor do archived groups, which the group list never shows.
 */
export function summarizeSearch(groups: Group[], f: SearchFilters): SearchSummary {
  let matchingTabs = 0;
  let groupsWithMatches = 0;
  const perGroup = groups.map((group) => {
    if (group.archived || isHiddenFromSearch(group)) return undefined;
    const state = groupSearchState(group, f);
    matchingTabs += state.matchCount;
    if (state.matchCount > 0) groupsWithMatches++;
    return state;
  });
  return { perGroup, matchingTabs, groupsWithMatches };
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The screen-reader result line: "5 tabs match in 2 groups". */
export function searchResultMessage(summary: Pick<SearchSummary, 'matchingTabs' | 'groupsWithMatches'>): string {
  if (summary.matchingTabs === 0) return 'No tabs match';
  const verb = summary.matchingTabs === 1 ? 'matches' : 'match';
  return `${count(summary.matchingTabs, 'tab')} ${verb} in ${count(summary.groupsWithMatches, 'group')}`;
}
