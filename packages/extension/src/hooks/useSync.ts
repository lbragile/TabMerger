import { formatList, t } from '@/lib/i18n';
import { useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { performSync, subscribeToRemoteChanges, canUploadOnFirefox } from '@/lib/syncEngine';
import {
  getGroupsState,
  getSetting,
  setSetting,
  markAllGroupsPendingSync,
  getSessions,
  markSessionUploaded,
  compareAndSetSetting
} from '@/lib/localDb';
import { refreshUploadedSession, deleteRemoteSessions } from '@/lib/sessionUpload';
import { cycleDeadline } from '@/lib/syncRequest';
import { getEncryptionKeyState, getDataKey, ENCRYPTION_MIGRATION_DONE_KEY } from '@/lib/encryptionKey';
import { useUIStore } from '@/stores/uiStore';
import { ensureAccountScope } from '@/lib/accountScope';
import { onForeignGroupsChange, onSyncConflict } from '@/lib/foreignChange';
import { toast } from '@/lib/toast';
import { CLOUD_SYNC_ACTIVE_KEY, SESSIONS_HEAL_IN_PROGRESS, SESSIONS_MIGRATION_DONE_KEY } from '@/lib/syncSettingKeys';
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
  const sessionsHealRunning = useRef(false);

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
    setSyncPausedReason(canUpload ? null : t('errors.syncPaused'));

    // Self-heal accounts that completed encryption setup before markAllGroupsPendingSync
    // was added to setupEncryption() — those groups have a data key but were never
    // re-marked dirty, so they're permanently stuck plaintext on the server. Runs once
    // per account (flag), then pushPendingChanges below picks up the now-dirty groups.
    if (!(await getSetting(ENCRYPTION_MIGRATION_DONE_KEY, false))) {
      await markAllGroupsPendingSync();
      await setSetting(ENCRYPTION_MIGRATION_DONE_KEY, true);
    }

    // The groups come FIRST: the sessions pass below can be many requests, and the user's groups
    // must not wait behind it.
    try {
      await performSync(session);
      qc.setQueryData(GROUPS_QUERY_KEY, await getGroupsState());
    } catch (err) {
      console.error('[useSync] sync error', err);
    }

    // Same self-heal as above, but for sessions — those have no pendingSync flag or push
    // loop (useSaveSession only uploads on explicit save), so a session that is not on the
    // server encrypted (saved before setup / while locked / while offline, or still plaintext
    // from before encryption existed) is only fixed by re-uploading it directly. The flag is set
    // ONLY when every push succeeded; otherwise it stays unset and a later sync retries (not
    // before SESSIONS_RETRY_MS, so one permanently rejected session cannot make every 30 s poll
    // re-upload them all). Skipped entirely while uploads are not allowed (Firefox consent).
    // One pass at a time: doSync runs on a 30 s poll and a pass can outlast it.
    if (canUpload && !sessionsHealRunning.current && Date.now() >= sessionsRetryAt.current && !(await getSetting(SESSIONS_MIGRATION_DONE_KEY, false))) {
      sessionsHealRunning.current = true;
      try {
        // Every request below has its own timeout (see sessionUpload.ts); the pass as a whole
        // stops starting new ones after one cycle budget, and what is left waits for the retry.
        const deadline = cycleDeadline();
        // Re-armed BEFORE the sessions are read: a session saved while this pass runs re-arms the
        // flag itself, and must not have that undone when the pass finishes.
        await setSetting(SESSIONS_MIGRATION_DONE_KEY, SESSIONS_HEAL_IN_PROGRESS);
        // Never-uploaded sessions FIRST: a pass that runs out of time must have spent it on what
        // the server does not have yet, not on refreshing backups it already holds (stable sort).
        const isUploadedBackup = (s: { auto?: boolean; uploadedAt?: number }) => s.auto === true && typeof s.uploadedAt === 'number';
        const sessions = [...(await getSessions())].sort((a, b) => Number(isUploadedBackup(a)) - Number(isUploadedBackup(b)));
        let allUploaded = true;
        /** ids this pass upserted: each was a copy read above, see the check after the loop */
        const pushedIds: string[] = [];
        for (const s of sessions) {
          if (Date.now() > deadline) {
            allUploaded = false;
            break;
          }
          try {
            // An automatic backup the server already confirmed is never INSERTED again. If the
            // server no longer has it (`gone`), it was deleted in the web dashboard: that removes
            // the cloud copy only, so there is nothing to do and the local backup STAYS. One never
            // uploaded (taken offline) uploads below.
            if (isUploadedBackup(s)) {
              if ((await refreshUploadedSession(s, session.user.id)) === 'failed') allUploaded = false;
              continue;
            }
            // for THIS cycle's account only: refused if the client's session changed meanwhile
            if (!(await pushSessionToSupabase(s, session.user.id))) {
              allUploaded = false;
              continue;
            }
            pushedIds.push(s.id);
            // stamped on the session as stored NOW (if it still is), never by saving back the
            // copy read above: that would re-create a backup deleted while the upload ran
            if (s.auto === true) await markSessionUploaded(s.id, Date.now());
          } catch (e) {
            allUploaded = false;
            console.warn('[useSync] session self-heal push failed', s.id, e);
          }
        }
        // What was upserted was a copy read before the requests. A session deleted on this device
        // meanwhile had its server row deleted too, possibly BEFORE the upsert above landed, which
        // then re-created a row nothing here tracks. So: whatever was pushed and is no longer
        // stored has its row deleted again. (A delete made after this read sends its own request
        // after every upsert of this pass, so it needs nothing.) Best-effort, never throws.
        // NOT after a wipe: "Clear all data" and an account switch empty the local store too, and
        // must never delete anything in the account. They remove this flag with the sessions (one
        // transaction), so the cleanup only runs while the pass's own marker is still stored,
        // read AFTER the sessions. A re-arm made meanwhile skips it as well: the safe side.
        if (pushedIds.length > 0) {
          try {
            const stored = new Set((await getSessions()).map((s) => s.id));
            const orphaned = pushedIds.filter((id) => !stored.has(id));
            if (orphaned.length > 0 && (await getSetting<unknown>(SESSIONS_MIGRATION_DONE_KEY, false)) === SESSIONS_HEAL_IN_PROGRESS) {
              await deleteRemoteSessions(orphaned, session.user.id);
            }
          } catch (e) {
            console.warn('[useSync] session self-heal cleanup failed', e);
          }
        }
        if (!allUploaded) sessionsRetryAt.current = Date.now() + SESSIONS_RETRY_MS;
        // Done only if nothing re-armed the flag since this pass started (`false` written by a
        // save, a backup run, an encryption reset): those sessions were not in the list above.
        // (A backup run's own marker, REARMED_BY_BACKUP, is falsy too: it starts a pass like `false`.)
        else await compareAndSetSetting(SESSIONS_MIGRATION_DONE_KEY, SESSIONS_HEAL_IN_PROGRESS, true);
      } finally {
        sessionsHealRunning.current = false;
      }
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
        // the wipe switched the backup file copy off (see clearLocalAccountData): show that
        void qc.invalidateQueries({ queryKey: APP_SETTINGS_QUERY_KEY });
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
        const list = formatList(names.map((name) => t('errors.quotedName', { name })));
        toast.info(t('errors.conflictCopy', { names: list }), { id: 'sync-conflict-copy' });
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
