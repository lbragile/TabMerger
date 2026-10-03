import { useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { performSync, subscribeToRemoteChanges, canUploadOnFirefox } from '@/lib/syncEngine';
import {
  getGroupsState,
  getSetting,
  setSetting,
  markAllGroupsPendingSync,
  getSessions
} from '@/lib/localDb';
import { getEncryptionKeyState, getDataKey, ENCRYPTION_MIGRATION_DONE_KEY } from '@/lib/encryptionKey';
import { useUIStore } from '@/stores/uiStore';
import { ensureAccountScope } from '@/lib/accountScope';
import { onForeignGroupsChange, onSyncConflict } from '@/lib/foreignChange';
import { toast } from '@/lib/toast';
import { CLOUD_SYNC_ACTIVE_KEY, SESSIONS_MIGRATION_DONE_KEY } from '@/lib/syncSettingKeys';
import { useAuth } from './useAuth';
import { useEntitlements } from './useEntitlements';
import { GROUPS_QUERY_KEY } from './useGroups';
import { APP_SETTINGS_QUERY_KEY } from './useAppSettings';
import { SESSIONS_QUERY_KEY, pushSessionToSupabase } from './useSessions';

// ponytail: matches useEntitlements' POLL_MS — push-only sync had no re-trigger once the
// popup stayed mounted past its initial sync (e.g. pinned open via DevTools during a long
// session), so edits made after mount silently never reached Supabase until the popup was
// closed and reopened. Periodic re-sync closes that gap without needing a pendingSync watcher.
const SYNC_POLL_MS = 1000 * 30;

/** After a sessions self-heal in which a push failed, this popup waits this long before the next attempt. */
const SESSIONS_RETRY_MS = 1000 * 60 * 5;

export function useSync() {
  const { session } = useAuth();
  const { cloudSync, loading: entitlementsLoading } = useEntitlements();
  const qc = useQueryClient();
  const modal = useUIStore((s) => s.modal);
  const openModal = useUIStore((s) => s.openModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const setSyncPausedReason = useUIStore((s) => s.setSyncPausedReason);
  const sessionsRetryAt = useRef(0);

  const doSync = useCallback(async () => {
    if (!session || !cloudSync) return;

    // Never sync against the previous account's groups: the account-switch wipe (also run by the
    // sign-in effect below) must have finished before the first sync touches the store.
    await ensureAccountScope(session.user.id);

    // Encryption is on by default for everyone — a signed-in Pro user with no
    // `encryption_keys` row yet has never completed setup. Block push/pull (never fall
    // back to plaintext) and prompt for a one-time passphrase instead. Only steal focus
    // from an unrelated open modal if nothing else is already showing.
    const keyState = await getEncryptionKeyState();
    // The check itself failed (offline, timeout, 401, 5xx): that is NOT "no key yet". Offering
    // first-time setup here would cover the popup with a dialog on every flaky connection and
    // invite a user who already has a key to create another. Nothing is synced; the next poll /
    // `online` event tries again.
    if (keyState === 'unknown') return;
    if (keyState === 'absent') {
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

    // Firefox-only: don't even attempt the self-heal/push paths below while browsingActivity
    // consent isn't granted — pulling still runs further down via performSync (reading remote
    // changes isn't gated, see canUploadOnFirefox's doc comment), but nothing local should be
    // uploaded. Surfaced in Settings' Cloud sync row rather than failing silently.
    const canUpload = await canUploadOnFirefox();
    setSyncPausedReason(canUpload ? null : 'Sync paused: allow in Firefox');

    // Self-heal accounts that completed encryption setup before markAllGroupsPendingSync
    // was added to setupEncryption() — those groups have a data key but were never
    // re-marked dirty, so they're permanently stuck plaintext on the server. Runs once
    // per account (flag), then pushPendingChanges below picks up the now-dirty groups.
    if (!(await getSetting(ENCRYPTION_MIGRATION_DONE_KEY, false))) {
      await markAllGroupsPendingSync();
      await setSetting(ENCRYPTION_MIGRATION_DONE_KEY, true);
    }

    // Same self-heal as above, but for sessions — those have no pendingSync flag or push
    // loop (useSaveSession only uploads on explicit save), so a session that is not on the
    // server encrypted (saved before setup / while locked / while offline, or still plaintext
    // from before encryption existed) is only fixed by re-uploading it directly. The flag is set
    // ONLY when every push succeeded; otherwise it stays unset and a later sync retries (not
    // before SESSIONS_RETRY_MS, so one permanently rejected session cannot make every 30 s poll
    // re-upload them all). Skipped entirely while uploads are not allowed (Firefox consent).
    if (canUpload && Date.now() >= sessionsRetryAt.current && !(await getSetting(SESSIONS_MIGRATION_DONE_KEY, false))) {
      const sessions = await getSessions();
      let allUploaded = true;
      for (const s of sessions) {
        try {
          if (!(await pushSessionToSupabase(s))) allUploaded = false;
        } catch (e) {
          allUploaded = false;
          console.warn('[useSync] session self-heal push failed', s.id, e);
        }
      }
      if (allUploaded) await setSetting(SESSIONS_MIGRATION_DONE_KEY, true);
      else sessionsRetryAt.current = Date.now() + SESSIONS_RETRY_MS;
    }

    try {
      await performSync(session);
      qc.setQueryData(GROUPS_QUERY_KEY, await getGroupsState());
    } catch (err) {
      console.error('[useSync] sync error', err);
    }
  }, [session, cloudSync, qc, modal.type, openModal, closeModal, setSyncPausedReason]);

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

  // Detects a genuinely different Supabase account signing in on this device (e.g. two
  // test accounts sharing a browser profile) and wipes local groups/sessions before that
  // account's data can be treated as "mine, push these" — which previously caused an
  // upsert to a DIFFERENT account's row (same locally-generated id) to be rejected by RLS.
  // Deliberately conservative: only fires when a PREVIOUSLY RECORDED non-null user id
  // differs from the CURRENT non-null user id. A null->user transition (first-ever sign-in)
  // and a same-user token refresh both leave lastUserId unchanged from the current id, so
  // neither triggers a clear. Runs independent of the cloudSync entitlement gate above —
  // the local-storage collision risk exists even for a free-tier signed-in user.
  const userId = session?.user.id;
  useEffect(() => {
    // Signed out: an undo snapshot of that account must not be restorable into the next one.
    if (!userId) {
      useUIStore.getState().clearHistory();
      return;
    }
    void (async () => {
      // shared with doSync (memoised per user), so a sync can never start before the wipe is done
      if (await ensureAccountScope(userId)) {
        useUIStore.getState().clearHistory(); // the wiped account's snapshots are gone with it
        qc.setQueryData(GROUPS_QUERY_KEY, await getGroupsState());
        qc.setQueryData(SESSIONS_QUERY_KEY, []);
      }
    })();
  }, [userId, qc]);

  // Tells the groups store whether local deletes must be remembered for a remote DELETE
  // (only a signed-in cloud-sync user has anything on the server to delete).
  // Not written until entitlements are KNOWN: before they load `cloudSync` is false for everyone, and
  // writing that would switch recording off at every popup open until the query resolved.
  const syncActive = !!session && cloudSync;
  useEffect(() => {
    if (entitlementsLoading) return;
    void setSetting(CLOUD_SYNC_ACTIVE_KEY, syncActive);
  }, [syncActive, entitlementsLoading]);

  // A pull / realtime event that applied foreign changes makes older undo snapshots unsafe to
  // restore (they would prune or revert those changes), so drop the history.
  useEffect(() => onForeignGroupsChange(() => useUIStore.getState().clearHistory()), []);

  // Two devices edited the same group: the server copy stayed and this device's edit was saved as a
  // "(conflict copy)". Say so (stable id, so repeated syncs replace the toast instead of stacking).
  useEffect(
    () =>
      onSyncConflict((names) => {
        const list = names.map((n) => `"${n}"`).join(', ');
        toast.info(`${list} was also changed on another device. Your version was saved as a copy.`, { id: 'sync-conflict-copy' });
      }),
    []
  );

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

    subscribeToRemoteChanges(session, async () => {
      // ponytail: subscribeToRemoteChanges already applied the update to IDB with last-write-wins
      // checked BEFORE the write (so remote stale data cannot clear newer local archived/starred
      // state); it only calls us for an applied update, so just refresh the cache from IDB.
      qc.setQueryData(GROUPS_QUERY_KEY, await getGroupsState());
    }).then((fn) => {
      unsubscribe = fn;
    });

    return () => unsubscribe?.();
  }, [session, cloudSync, qc]);
}
