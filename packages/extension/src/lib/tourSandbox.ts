/**
 * The guided tour's "save a tab" step, as the drag engine sees it.
 *
 * While that step is up exactly ONE move out of "Now Open" exists: the spare browser tab the
 * tour opened (`lib/tourPracticeTab.ts`) may be dropped on the tour's practice groups. Every
 * other drag is refused by `canDrop` (`lib/dndMove.ts`), whatever the lock on the page lets
 * through, so no tab of the user's can be saved, moved or closed from that step.
 *
 * A tiny store of its own, with no imports: the drag model (`hooks/useDndModel.ts`) reads it
 * and must stay free of the UI store.
 */
export interface TourTabSandbox {
  /** Browser tab id of the practice tab, or `null` while there is none (then nothing can be dragged at all). */
  tabId: number | null;
}

let current: TourTabSandbox | null = null;
const listeners = new Set<() => void>();

/** `null` = the step is not up (the normal rules apply). */
export function getTourTabSandbox(): TourTabSandbox | null {
  return current;
}

export function setTourTabSandbox(next: TourTabSandbox | null): void {
  if (current === next || (current !== null && next !== null && current.tabId === next.tabId)) return;
  current = next;
  listeners.forEach((listener) => listener());
}

let springOpenBlocked = false;

/**
 * True while a tour step asks for a drop INSIDE the group shown in the main panel: hovering
 * another group in the list must then not switch the panel (the destination would vanish).
 */
export function isTourSpringOpenBlocked(): boolean {
  return springOpenBlocked;
}

export function setTourSpringOpenBlocked(blocked: boolean): void {
  springOpenBlocked = blocked;
}

let searchShowsDemo = false;

/**
 * True for a group that search must leave out: the tour's practice ("Tour demo") groups are not
 * the user's, so they are never a search result, a `group:` / `window:` / `tag:` suggestion or a
 * match. One exception: while the tour's own search steps are up, which ask the user to search
 * the sample tabs ({@link setTourSearchShowsDemo}).
 */
export function isHiddenFromSearch(group: { tourDemo?: unknown } | null | undefined): boolean {
  return group?.tourDemo === true && !searchShowsDemo;
}

const searchListeners = new Set<() => void>();

/** Switched on by the tour while one of its search steps is on screen, off again when it leaves. */
export function setTourSearchShowsDemo(on: boolean): void {
  if (searchShowsDemo === on) return;
  searchShowsDemo = on;
  searchListeners.forEach((listener) => listener());
}

/**
 * The current value behind {@link isHiddenFromSearch}, for `useSyncExternalStore` (see
 * `hooks/useTourSearchShowsDemo.ts`): a component that filters with `isHiddenFromSearch` reads
 * it, and lists it as a dependency of whatever it memoizes, so it draws again when the tour
 * enters or leaves a search step.
 */
export function getTourSearchShowsDemo(): boolean {
  return searchShowsDemo;
}

export function subscribeTourSearchShowsDemo(listener: () => void): () => void {
  searchListeners.add(listener);
  return () => {
    searchListeners.delete(listener);
  };
}

let openBlocked = false;

/**
 * True while a tour step asks the user to try "Open in browser" on the practice data. The sample
 * tabs are not real pages, so nothing is opened then: the request is counted for the step
 * instead (`hooks/useGroups.ts`, `useOpenWindow`).
 */
export function isTourOpenBlocked(): boolean {
  return openBlocked;
}

export function setTourOpenBlocked(blocked: boolean): void {
  openBlocked = blocked;
}

export function subscribeTourTabSandbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Names of the things a tour step can wait for that leave no trace in the saved data
 * (`uiStore.signalTour` counts them, `lib/tourTasks.ts` reads the counts).
 */
export const TOUR_SIGNALS = {
  /** "Open in browser" was chosen on practice data (and nothing was opened: {@link isTourOpenBlocked}). */
  openWindow: 'open-window',
  undo: 'undo',
  redo: 'redo',
  /** A search was narrowed to a practice group with `group:` (the halfway point of that step). */
  searchNarrowed: 'search-narrowed'
} as const;
