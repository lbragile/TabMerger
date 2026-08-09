import { useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { pushPendingChanges, pullRemoteChanges, subscribeToRemoteChanges } from '@/lib/syncEngine';
import { getGroupsState, saveGroupsState, getSetting, setSetting, markAllGroupsPendingSync } from '@/lib/localDb';
import { hasEncryptionKey, getDataKey, ENCRYPTION_MIGRATION_DONE_KEY } from '@/lib/encryptionKey';
import { useUIStore } from '@/stores/uiStore';
import { useAuth } from './useAuth';
import { useEntitlements } from './useEntitlements';
import { GROUPS_QUERY_KEY } from './useGroups';
import { APP_SETTINGS_QUERY_KEY } from './useAppSettings';

// ponytail: matches useEntitlements' POLL_MS — push-only sync had no re-trigger once the
// popup stayed mounted past its initial sync (e.g. pinned open via DevTools during a long
// session), so edits made after mount silently never reached Supabase until the popup was
// closed and reopened. Periodic re-sync closes that gap without needing a pendingSync watcher.
const SYNC_POLL_MS = 1000 * 30;

export function useSync() {
  const { session } = useAuth();
  const { cloudSync } = useEntitlements();
  const qc = useQueryClient();
  const modal = useUIStore((s) => s.modal);
  const openModal = useUIStore((s) => s.openModal);
  const closeModal = useUIStore((s) => s.closeModal);
  // Tracks whether the "unlock to sync" toast has already been shown this popup session —
  // the data key is in-memory only and resets on every popup close, so doSync's poll would
  // otherwise re-toast every 30s forever. One nudge per session is enough; the user can
  // always unlock via Settings > Account.
  const lockedToastShownRef = useRef(false);

  const doSync = useCallback(async () => {
    if (!session || !cloudSync) return;

    // Encryption is on by default for everyone — a signed-in Pro user with no
    // `encryption_keys` row yet has never completed setup. Block push/pull (never fall
    // back to plaintext) and prompt for a one-time passphrase instead. Only steal focus
    // from an unrelated open modal if nothing else is already showing.
    if (!(await hasEncryptionKey())) {
      if (!modal.type || modal.type === 'encryptionSetup') openModal('encryptionSetup');
      return;
    }
    if (modal.type === 'encryptionSetup') closeModal();

    // Key exists but wasn't unlocked this session (MV3 popups are fully torn down on close,
    // so the in-memory data key resets every time) — push/pull would silently skip every
    // group (see syncEngine's locked-skip warnings), so bail out here instead of burning a
    // request, and surface a *dismissible* nudge rather than the blocking setup modal —
    // the risk here is "stays unsynced," not "no key exists at all," so it doesn't warrant
    // stealing focus on every popup open.
    if (!(await getDataKey())) {
      if (!lockedToastShownRef.current) {
        lockedToastShownRef.current = true;
        toast.info('Sync is locked', {
          description: 'Unlock encryption in Settings > Account to resume syncing.',
          action: { label: 'Settings', onClick: () => openModal('settings') }
        });
      }
      return;
    }

    // Self-heal accounts that completed encryption setup before markAllGroupsPendingSync
    // was added to setupEncryption() — those groups have a data key but were never
    // re-marked dirty, so they're permanently stuck plaintext on the server. Runs once
    // per account (flag), then pushPendingChanges below picks up the now-dirty groups.
    if (!(await getSetting(ENCRYPTION_MIGRATION_DONE_KEY, false))) {
      await markAllGroupsPendingSync();
      await setSetting(ENCRYPTION_MIGRATION_DONE_KEY, true);
    }

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
  }, [session, cloudSync, qc, modal.type, openModal, closeModal]);

  // Sync on mount + when online
  useEffect(() => {
    if (!session || !cloudSync) return;

    void doSync();

    const handleOnline = () => void doSync();
    globalThis.addEventListener('online', handleOnline);

    const interval = setInterval(() => void doSync(), SYNC_POLL_MS);

    return () => {
      globalThis.removeEventListener('online', handleOnline);
      clearInterval(interval);
    };
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
