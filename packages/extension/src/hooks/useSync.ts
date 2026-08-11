import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { performSync, subscribeToRemoteChanges } from '@/lib/syncEngine';
import { getGroupsState, saveGroupsState, getSetting, setSetting, markAllGroupsPendingSync, getSessions } from '@/lib/localDb';
import { hasEncryptionKey, getDataKey, ENCRYPTION_MIGRATION_DONE_KEY, SESSIONS_MIGRATION_DONE_KEY } from '@/lib/encryptionKey';
import { useUIStore } from '@/stores/uiStore';
import { useAuth } from './useAuth';
import { useEntitlements } from './useEntitlements';
import { GROUPS_QUERY_KEY } from './useGroups';
import { APP_SETTINGS_QUERY_KEY } from './useAppSettings';
import { pushSessionToSupabase } from './useSessions';

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

    // Key exists but this profile has never unlocked it (brand-new browser profile/device,
    // or right after an explicit sign-out) — once unlocked, `chrome.storage.local` persists
    // the data key forever (see encryptionKey.ts), so this is a one-time-per-device prompt,
    // not a recurring nuisance. Reuses the same modal as first-time setup (it self-detects
    // which mode to show) rather than a dismissible toast, since there's no longer an inline
    // unlock affordance in Settings to point the user at.
    if (!(await getDataKey())) {
      if (!modal.type || modal.type === 'encryptionSetup') openModal('encryptionSetup');
      return;
    }
    if (modal.type === 'encryptionSetup') closeModal();

    // Self-heal accounts that completed encryption setup before markAllGroupsPendingSync
    // was added to setupEncryption() — those groups have a data key but were never
    // re-marked dirty, so they're permanently stuck plaintext on the server. Runs once
    // per account (flag), then pushPendingChanges below picks up the now-dirty groups.
    if (!(await getSetting(ENCRYPTION_MIGRATION_DONE_KEY, false))) {
      await markAllGroupsPendingSync();
      await setSetting(ENCRYPTION_MIGRATION_DONE_KEY, true);
    }

    // Same self-heal as above, but for sessions — those have no pendingSync flag or push
    // loop (useSaveSession only uploads on explicit save), so any session saved before
    // encryption was set up is stuck plaintext on the server forever unless re-uploaded
    // directly. Separate flag from ENCRYPTION_MIGRATION_DONE_KEY (see its definition).
    if (!(await getSetting(SESSIONS_MIGRATION_DONE_KEY, false))) {
      const sessions = await getSessions();
      for (const s of sessions) {
        try {
          await pushSessionToSupabase(s);
        } catch (e) {
          console.warn('[useSync] session self-heal push failed', s.id, e);
        }
      }
      await setSetting(SESSIONS_MIGRATION_DONE_KEY, true);
    }

    try {
      await performSync(session);
      qc.setQueryData(GROUPS_QUERY_KEY, await getGroupsState());
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
