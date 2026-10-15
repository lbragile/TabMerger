import { createContext, useContext, useMemo } from 'react';
import { SEARCH_NON_MATCHING, normalizeSearchNonMatching, type SearchNonMatching } from '@tabmerger/shared';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useUIStore, type SelectedItem } from '@/stores/uiStore';
import { parseSearchQuery } from '@/lib/utils';
import { NO_FILTERS, isSearchActive, type GroupSearchState, type SearchFilters } from '@/lib/searchMatch';

/**
 * What to do with rows that do not match a search: the saved preference, checked on read.
 * While the guided tour runs it is always "dim": the tour points at rows by position and
 * drags them, so nothing it may need is taken off the screen.
 */
export function useSearchMode(): SearchNonMatching {
  const { data } = useAppSettings();
  const tourActive = useUIStore((s) => s.tourActive);
  if (tourActive) return SEARCH_NON_MATCHING.DIM;
  return normalizeSearchNonMatching(data?.searchNonMatching);
}

/** The search box's text split into its `group:` / `window:` / `tag:` filters and plain words. */
export function useSearchFilters(): SearchFilters {
  const raw = useUIStore((s) => s.searchFilter);
  return useMemo(() => (raw ? parseSearchQuery(raw) : NO_FILTERS), [raw]);
}

/** The search as the windows panel applies it to the group it is showing. */
export interface PanelSearchView {
  active: boolean;
  /** Non-matching rows are not drawn (and reordering is off, see `reorderLocked`). */
  hide: boolean;
  /**
   * Dragging and keyboard move are off: with rows hidden, "between these two" does not say
   * where an item lands among the hidden ones. Opening, removing, selecting and the menus
   * keep working, on the rows' real positions.
   */
  reorderLocked: boolean;
  filters: SearchFilters;
  /** Per-window, per-tab matches for the shown group, by real index; null while no search is active. */
  state: GroupSearchState | null;
}

export const INACTIVE_PANEL_SEARCH: PanelSearchView = {
  active: false,
  hide: false,
  reorderLocked: false,
  filters: NO_FILTERS,
  state: null
};

export const PanelSearchContext = createContext<PanelSearchView>(INACTIVE_PANEL_SEARCH);

/** Inactive when rendered outside the windows panel (a row on its own in a test). */
export function usePanelSearch(): PanelSearchView {
  return useContext(PanelSearchContext);
}

export function buildPanelSearchView(filters: SearchFilters, mode: SearchNonMatching, state: GroupSearchState | null): PanelSearchView {
  const active = isSearchActive(filters) && state !== null;
  if (!active) return INACTIVE_PANEL_SEARCH;
  const hide = mode === SEARCH_NON_MATCHING.HIDE;
  return { active, hide, reorderLocked: hide, filters, state };
}

const TAB_ID = /^tab-\d+-(\d+)-(\d+)$/;
const WINDOW_ID = /^window-\d+-(\d+)$/;

/**
 * Drops from a selection range what a search has filtered out, so Shift+click (and Shift+Space)
 * never picks up rows the user cannot see or that are faded: tabs that do not match in either
 * mode, and windows that are not drawn in "hide" mode.
 */
export function withoutFilteredOut(view: PanelSearchView, items: SelectedItem[]): SelectedItem[] {
  const state = view.state;
  if (!view.active || !state) return items;
  return items.filter((item) => {
    const tab = TAB_ID.exec(item.id);
    if (tab) return state.windows[Number(tab[1])]?.tabMatches[Number(tab[2])] !== false;
    const win = WINDOW_ID.exec(item.id);
    if (win && view.hide) return state.windows[Number(win[1])]?.visible !== false;
    return true;
  });
}
