/**
 * Popup search: what happens to the tabs, windows and groups that do NOT match the query.
 * A display preference stored in the extension's local `appSettings` (per device, not synced).
 */
export const SEARCH_NON_MATCHING = {
  /** Not drawn at all while a search is active (the saved data is untouched). */
  HIDE: 'hide',
  /** Drawn faded; every row stays where it is. */
  DIM: 'dim'
} as const;

export type SearchNonMatching = (typeof SEARCH_NON_MATCHING)[keyof typeof SEARCH_NON_MATCHING];

export const DEFAULT_SEARCH_NON_MATCHING: SearchNonMatching = SEARCH_NON_MATCHING.HIDE;

/** Options in the order the Settings select lists them. */
export const SEARCH_NON_MATCHING_OPTIONS: ReadonlyArray<{ value: SearchNonMatching; label: string }> = [
  { value: SEARCH_NON_MATCHING.HIDE, label: 'Hide' },
  { value: SEARCH_NON_MATCHING.DIM, label: 'Dim' }
];

export const SEARCH_COPY = {
  settingLabel: 'Tabs that do not match a search',
  settingDescription: 'Hide them, or keep them in place but faded',
  clearSearch: 'Clear search',
  /** Accessible name of the header's search opener (followed by the current query when there is one). */
  openSearch: 'Open search',
  currentSearch: 'current search',
  /** Accessible name of the search box in the search list. */
  searchInput: 'Search tabs and groups',
  /** Added to the accessible name of a faded row that does not match the search. */
  noMatchSuffix: ', no match',
  /** The search list's polite result count. */
  resultCount: (n: number) => (n === 0 ? 'No results' : n === 1 ? '1 result' : `${n} results`),
  /** Said when hidden rows took the focused one away and focus went to another. */
  focusMoved: (title: string) => `Focus moved to ${title}`,
  /** Drag and keyboard reordering is off while rows are hidden: the order among hidden rows would be a guess. */
  reorderLocked: 'Clear the search to move items'
} as const;

export function isSearchNonMatching(value: unknown): value is SearchNonMatching {
  return value === SEARCH_NON_MATCHING.HIDE || value === SEARCH_NON_MATCHING.DIM;
}

/** The mode to use for a value from storage or the UI: itself when allow-listed, otherwise the default. */
export function normalizeSearchNonMatching(value: unknown): SearchNonMatching {
  return isSearchNonMatching(value) ? value : DEFAULT_SEARCH_NON_MATCHING;
}
