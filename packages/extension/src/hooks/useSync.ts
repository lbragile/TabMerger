import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { pushPendingChanges, pullRemoteChanges, subscribeToRemoteChanges } from '@/lib/syncEngine';
import { getGroupsState, saveGroupsState } from '@/lib/localDb';
import { useAuth } from './useAuth';
import { useEntitlements } from './useEntitlements';
import { GROUPS_QUERY_KEY } from './useGroups';
import { APP_SETTINGS_QUERY_KEY } from './useAppSettings';

export function useSync() {
  const { session } = useAuth();
  const { cloudSync } = useEntitlements();
  const qc = useQueryClient();

  const doSync = useCallback(async () => {
    if (!session || !cloudSync) return;

    try {
      const state = await getGroupsState();
      await pushPendingChanges(session);
      const merged = await pullRemoteChanges(session, state.available);

      // Re-apply local drag order: pull returns groups sorted by updatedAt which
      // stomps the user's drag order. Re-sort merged using the locally-saved order;
      // any groups new from remote land at the end.
      const localOrder = state.available.map((g) => g.id);
      const posMap = new Map(localOrder.map((id, i) => [id, i]));
      const reordered = [...merged].sort((a, b) => {
        if (a.permanent && !b.permanent) return -1;
        if (!a.permanent && b.permanent) return 1;
        return (posMap.get(a.id) ?? Infinity) - (posMap.get(b.id) ?? Infinity);
      });

      const next = { ...state, available: reordered };
      await saveGroupsState(next);
      qc.setQueryData(GROUPS_QUERY_KEY, next);
    } catch (err) {
      console.error('[useSync] sync error', err);
    }
  }, [session, cloudSync, qc]);

  // Sync on mount + when online
  useEffect(() => {
    if (!session || !cloudSync) return;

    void doSync();

    const handleOnline = () => void doSync();
    globalThis.addEventListener('online', handleOnline);
    return () => globalThis.removeEventListener('online', handleOnline);
  }, [session, cloudSync, doSync]);

  // Settings live in local IndexedDB only (never synced to Supabase), so login itself
  // never changes their value — but the Settings query may have been cached (e.g. by
  // useTheme/useCleanupSuggestions/the Settings modal) before this session existed.
  // Invalidate on every session change so all subscribers re-read the authoritative
  // IndexedDB value immediately, without requiring the popup to be reopened.
  useEffect(() => {
    if (!session) return;
    void qc.invalidateQueries({ queryKey: APP_SETTINGS_QUERY_KEY });
  }, [session, qc]);

  // Subscribe to real-time changes
  useEffect(() => {
    if (!session || !cloudSync) return;

    let unsubscribe: (() => void) | undefined;

    subscribeToRemoteChanges(session, async (updatedGroup) => {
      const state = await getGroupsState();
      const idx = state.available.findIndex((g) => g.id === updatedGroup.id);
      if (idx === -1) {
        state.available.push(updatedGroup);
      } else {
        // ponytail: last-write-wins — prevents remote stale data from clearing local
        // archived/starred state that was set after the last push (e.g. NULL column on remote)
        const local = state.available[idx];
        state.available[idx] = updatedGroup.updatedAt >= local.updatedAt ? updatedGroup : local;
      }
      await saveGroupsState(state);
      qc.setQueryData(GROUPS_QUERY_KEY, state);
    }).then((fn) => {
      unsubscribe = fn;
    });

    return () => unsubscribe?.();
  }, [session, cloudSync, qc]);
}
