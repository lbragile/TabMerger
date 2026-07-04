import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { pushPendingChanges, pullRemoteChanges, subscribeToRemoteChanges } from '@/lib/syncEngine';
import { getGroupsState, saveGroupsState } from '@/lib/localDb';
import { useAuth } from './useAuth';
import { useEntitlements } from './useEntitlements';
import { GROUPS_QUERY_KEY } from './useGroups';

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
      const next = { ...state, available: merged };
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
        state.available[idx] = updatedGroup;
      }
      await saveGroupsState(state);
      qc.setQueryData(GROUPS_QUERY_KEY, state);
    }).then((fn) => {
      unsubscribe = fn;
    });

    return () => unsubscribe?.();
  }, [session, cloudSync, qc]);
}
