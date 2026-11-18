import { useCallback, useMemo, type ComponentProps } from 'react';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useRecentlyClosed } from '@/hooks/useRecentlyClosed';
import { useReopenClosedEntry } from '@/hooks/useRecentlyClosedActions';
import { readRememberClosedTabs } from '@/lib/recentlyClosed';
import type { ClosedSearchResult } from '@/lib/recentlyClosedSearch';
import { useUIStore } from '@/stores/uiStore';
import { SearchOverlay } from './SearchOverlay';

type Props = Omit<ComponentProps<typeof SearchOverlay>, 'closed' | 'onReopenClosed'>;

/**
 * The search overlay with its "Recently closed" source: the list, the "Remember closed tabs"
 * setting, and reopening a picked result through the list's own `useReopenClosedEntry('search')`
 * (toast with Undo, error toast when the browser refuses the address and the entry stays,
 * analytics). Nothing closed is listed during the guided tour, which works on practice data only.
 *
 * The reopen runs through `mutateAsync`: the overlay closes (and this unmounts) as soon as a result
 * is picked, and a per-call `mutate` callback never fires once its component is gone.
 */
export function SearchOverlayWithClosed(props: Props) {
  const { entries } = useRecentlyClosed();
  const { data: settings } = useAppSettings();
  const tourActive = useUIStore((s) => s.tourActive);
  const reopen = useReopenClosedEntry('search');
  const remember = readRememberClosedTabs(settings);

  const closed = useMemo(() => ({ entries: tourActive ? [] : entries, remember }), [entries, remember, tourActive]);

  // the list's own reopen: same toast with Undo, error toast and analytics (`from: 'search'`)
  const onReopenClosed = useCallback(
    (result: ClosedSearchResult, { background }: { background: boolean }) => {
      void reopen(result.entry, { tabIndex: result.tabIndex, background });
    },
    [reopen]
  );

  return <SearchOverlay {...props} closed={closed} onReopenClosed={onReopenClosed} />;
}
