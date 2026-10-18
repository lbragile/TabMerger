import { useCallback, useEffect, useState } from 'react';
import { UPDATE_AVAILABLE_STORAGE_KEY, UPDATE_BANNER_DISMISSED_STORAGE_KEY } from '@tabmerger/shared';
import { dismissPendingUpdate, getVisiblePendingUpdate, type PendingUpdate } from '@/lib/extensionUpdate';

interface PendingUpdateState {
  /** The downloaded update the banner should offer, or null. */
  update: PendingUpdate | null;
  /** Hides the banner for this version only (remembered across popup opens). */
  dismiss: () => Promise<void>;
}

/**
 * The update the browser downloaded and is waiting to apply (lib/extensionUpdate.ts), unless the
 * user dismissed it. Re-read whenever either storage key changes, so an update found by Settings →
 * "Check for updates" (or by the worker while the popup is open) shows up right away.
 */
export function usePendingUpdate(): PendingUpdateState {
  const [update, setUpdate] = useState<PendingUpdate | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      void getVisiblePendingUpdate()
        .then((next) => {
          if (active) setUpdate(next);
        })
        .catch(() => {});
    };
    load();
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area !== 'local') return;
      if (UPDATE_AVAILABLE_STORAGE_KEY in changes || UPDATE_BANNER_DISMISSED_STORAGE_KEY in changes) load();
    };
    const events = globalThis.chrome?.storage?.onChanged;
    events?.addListener(onChanged);
    return () => {
      active = false;
      events?.removeListener(onChanged);
    };
  }, []);

  const dismiss = useCallback(async () => {
    if (!update) return;
    setUpdate(null);
    await dismissPendingUpdate(update.version);
  }, [update]);

  return { update, dismiss };
}
