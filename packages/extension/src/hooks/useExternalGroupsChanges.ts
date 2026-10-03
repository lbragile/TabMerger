import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { GROUPS_CHANGED_MESSAGE } from '@/lib/groupsChangedMessage';
import { useUIStore } from '@/stores/uiStore';
import { GROUPS_QUERY_KEY } from './useGroups';

/**
 * Refetches the groups query when ANOTHER extension context (the service worker's context-menu
 * save, URL rules, SYNC_NOW sync, a second popup/page) wrote the groups store. Each context has
 * its own TanStack cache, so without this an open popup keeps showing the pre-write state and a
 * later cache-derived write (a DnD drop, undo) would overwrite the other context's change.
 * `chrome.runtime.sendMessage` never delivers to the sender's own listeners, so this only fires
 * for foreign writes. Mount once at the popup root.
 */
export function useExternalGroupsChanges() {
  const qc = useQueryClient();

  useEffect(() => {
    const onMessage = (msg: unknown) => {
      if ((msg as { type?: string } | undefined)?.type !== GROUPS_CHANGED_MESSAGE) return;
      // Another context changed the groups: an undo snapshot taken before that would prune or
      // revert the change when restored, so the history is dropped (simplest deterministic rule).
      useUIStore.getState().clearHistory();
      // cancelRefetch:false is mandatory on the groups key (spec C11): the default cancels an
      // in-flight fetch and rejects any mutation that joined it.
      void qc.invalidateQueries({ queryKey: GROUPS_QUERY_KEY }, { cancelRefetch: false });
    };
    chrome.runtime?.onMessage?.addListener(onMessage);
    return () => chrome.runtime?.onMessage?.removeListener(onMessage);
  }, [qc]);
}
