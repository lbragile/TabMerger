import { useSyncExternalStore } from 'react';
import { getTourSearchShowsDemo, subscribeTourSearchShowsDemo } from '@/lib/tourSandbox';

/**
 * True while the guided tour's own search steps are on screen, the only time the tour's
 * practice ("Tour demo") groups may show up in search.
 *
 * `isHiddenFromSearch` (`lib/tourSandbox.ts`) is a plain function and safe to call while
 * rendering, but nothing draws again when its answer changes. A component that filters with it
 * calls this hook too and lists the value as a dependency of whatever it memoizes:
 *
 *   const showsDemo = useTourSearchShowsDemo();
 *   const results = useMemo(() => getResults(query, groupsState), [query, groupsState, showsDemo]);
 */
export function useTourSearchShowsDemo(): boolean {
  return useSyncExternalStore(subscribeTourSearchShowsDemo, getTourSearchShowsDemo, () => false);
}
