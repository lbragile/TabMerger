import { useCallback, useMemo, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppSettings } from '@/hooks/useAppSettings';
import {
  RECENTLY_CLOSED_UNDO_TOAST_MS,
  RecentlyClosedOpenError,
  useRecentlyClosed,
  useReopenRecentlyClosed,
  useUndoRecentlyClosed
} from '@/hooks/useRecentlyClosed';
import { readRememberClosedTabs } from '@/lib/recentlyClosed';
import type { ClosedSearchResult } from '@/lib/recentlyClosedSearch';
import { trackEvent } from '@/lib/analytics';
import { toast } from '@/lib/toast';
import { useUIStore } from '@/stores/uiStore';
import { SearchOverlay } from './SearchOverlay';

type Props = Omit<ComponentProps<typeof SearchOverlay>, 'closed' | 'onReopenClosed'>;

/**
 * The search overlay with its "Recently closed" source: the list, the "Remember closed tabs"
 * setting, and reopening a picked result with a toast that has Undo (an error toast when the
 * browser refuses the address; the entry stays then). Nothing closed is listed during the guided
 * tour, which works on practice data only.
 *
 * Everything runs through `mutateAsync`: the overlay closes (and this unmounts) as soon as a result
 * is picked, and a per-call `mutate` callback never fires once its component is gone.
 */
export function SearchOverlayWithClosed(props: Props) {
  const { t } = useTranslation();
  const { entries } = useRecentlyClosed();
  const { data: settings } = useAppSettings();
  const tourActive = useUIStore((s) => s.tourActive);
  const { mutateAsync: reopen } = useReopenRecentlyClosed();
  const { mutateAsync: undo } = useUndoRecentlyClosed();
  const remember = readRememberClosedTabs(settings);

  const closed = useMemo(() => ({ entries: tourActive ? [] : entries, remember }), [entries, remember, tourActive]);

  const onReopenClosed = useCallback((result: ClosedSearchResult, { background }: { background: boolean }) => {
    const { entry, tabIndex, tab } = result;
    const wholeWindow = entry.kind === 'window' && tabIndex === undefined;
    void (async () => {
      try {
        const token = await reopen({ entry, tabIndex: entry.kind === 'window' ? tabIndex : undefined, active: !background });
        trackEvent('recently_closed_reopened', { kind: wholeWindow ? 'window' : 'tab', from: 'search' });
        const message = wholeWindow
          ? t('search.closedRestoredWindow', { tabs: t('common.tabCount', { count: entry.tabs.length }) })
          : t('search.closedReopened', { title: tab.title || tab.url });
        toast.success(message, {
          id: 'recently-closed-reopened',
          duration: RECENTLY_CLOSED_UNDO_TOAST_MS,
          action: {
            label: t('header.undo'),
            onClick: () => { undo(token).catch(() => toast.error(t('recentlyClosed.errors.changeFailed'))); }
          }
        });
      } catch (err) {
        toast.error(t(err instanceof RecentlyClosedOpenError ? 'recentlyClosed.errors.openFailed' : 'recentlyClosed.errors.changeFailed'));
      }
    })();
  }, [reopen, undo, t]);

  return <SearchOverlay {...props} closed={closed} onReopenClosed={onReopenClosed} />;
}
