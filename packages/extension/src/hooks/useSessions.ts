import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { isOpenableUrl } from '@/lib/safeOpen';
import { trackEvent } from '@/lib/analytics';
import { nanoid } from 'nanoid';
import { FREE_TIER_LIMITS } from '@tabmerger/shared';
import type { Session } from '@/lib/types';
import { getSessions, saveSession, deleteSession, getSetting, setSetting } from '@/lib/localDb';
import { supabase } from '@/lib/supabase';
import { resolveIncognito } from '@/lib/incognito';
import { LAST_USER_ID_KEY, SESSIONS_MIGRATION_DONE_KEY } from '@/lib/syncSettingKeys';
import { pushSessionToSupabase, deleteRemoteSessions } from '@/lib/sessionUpload';
import { useGroups } from './useGroups';

export const SESSIONS_QUERY_KEY = ['sessions'] as const;
const FREE_SESSION_LIMIT = FREE_TIER_LIMITS.sessions;

export function useSessions() {
  return useQuery({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: getSessions,
    staleTime: Infinity,
  });
}

// The upload itself has no React in it and is also used by the background worker (automatic
// backups), so it lives in lib/. Re-exported: existing importers keep working.
export { pushSessionToSupabase };

/**
 * Saves the current non-permanent groups as a named session snapshot.
 * Local-first: writes to IndexedDB first, then best-effort syncs to Supabase.
 * Enforces `FREE_SESSION_LIMIT` for users without the `hasSessions` entitlement.
 * Throws `'SESSION_LIMIT'` (checked by the caller to show an upgrade prompt).
 * Free users (no `cloudSync` entitlement) keep sessions local-only — the Supabase
 * upload is skipped entirely rather than attempted, since RLS rejects it anyway
 * (`sessions` writes require `has_cloud_sync()`, supabase/migrations/019_gate_cloud_sync_rls.sql).
 */
export function useSaveSession() {
  const qc = useQueryClient();
  const { data: groupsState } = useGroups();

  return useMutation({
    mutationFn: async ({ name, description, sessionCount, hasSessions, cloudSync }: { name: string; description?: string; sessionCount: number; hasSessions: boolean; cloudSync: boolean }) => {
      // ponytail: free tier gets 3 sessions; pro+ unlimited (hasSessions = entitlement)
      if (!hasSessions && sessionCount >= FREE_SESSION_LIMIT) {
        throw new Error('SESSION_LIMIT');
      }
      if (!groupsState) throw new Error('No groups state');
      const groups = groupsState.available.filter((g) => !g.permanent);
      const session: Session = {
        id: nanoid(10),
        name,
        description,
        groups,
        createdAt: Date.now(),
      };
      // Whose session this is, captured BEFORE anything is written: the upload below is refused
      // if the signed-in account is no longer this one (see pushSessionToSupabase). Free users
      // never upload, so the session is not even read for them.
      // The groups being saved are the STORE's, so its recorded owner decides, not only who is
      // signed in right now: if the store still holds another account's data (the account wipe
      // has not run yet), nothing is uploaded under the signed-in account.
      let ownerId: string | undefined;
      if (cloudSync) {
        try {
          const signedInId = (await supabase.auth.getSession()).data.session?.user.id;
          const storeOwner = await getSetting<string | null>(LAST_USER_ID_KEY, null);
          if (signedInId && (!storeOwner || storeOwner === signedInId)) ownerId = signedInId;
        } catch (e) {
          console.warn('[TabMerger] Session sync to Supabase failed', e);
        }
      }
      await saveSession(session);
      // ponytail: best-effort Supabase sync — local save already succeeded. Only for
      // users with the cloud-sync entitlement; free users stay local-only.
      if (cloudSync) {
        let uploaded = false;
        try {
          if (ownerId) uploaded = await pushSessionToSupabase(session, ownerId);
        } catch (e) {
          console.warn('[TabMerger] Session sync to Supabase failed', e);
        }
        // Not on the server (no key yet / locked / offline / rejected): sessions have no per-row
        // pending flag, so re-arm the self-heal and the next sync uploads it (see useSync).
        if (!uploaded) await setSetting(SESSIONS_MIGRATION_DONE_KEY, false);
      }
      return session;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY }),
  });
}

/**
 * Deletes a session from IndexedDB and best-effort removes it from Supabase.
 * Failure on the remote delete does not roll back the local delete.
 */
export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Whose session it is, read BEFORE the local delete: the store's recorded owner, or (a store
      // nobody owns yet) whoever is signed in. The request is only sent while the client is still
      // signed in as that account, and is scoped to its user id (see deleteRemoteSessions).
      let ownerId: string | undefined;
      try {
        ownerId = (await getSetting<string | null>(LAST_USER_ID_KEY, null)) ?? (await supabase.auth.getSession()).data.session?.user.id;
      } catch (e) {
        console.warn('[TabMerger] Session delete sync to Supabase failed', e);
      }
      await deleteSession(id);
      // ponytail: best-effort Supabase sync (never throws)
      if (ownerId) await deleteRemoteSessions([id], ownerId);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY }),
  });
}

/**
 * Restores a session by closing ALL current Chrome windows, then reopening the
 * saved groups as new windows with their tabs in order. Destructive — no confirmation
 * guard here; the calling component must confirm before invoking.
 */
export function useRestoreSession() {
  return useMutation({
    onSuccess: () => { trackEvent('session_restored'); },
    mutationFn: async (session: Session) => {
      const windows = await chrome.windows.getAll();
      await Promise.all(windows.map((w) => chrome.windows.remove(w.id!)));
      for (const group of session.groups) {
        for (const win of group.windows) {
          const tabs = win.tabs.filter((t) => isOpenableUrl(t.url));
          if (tabs.length === 0) continue;
          const [first, ...rest] = tabs;
          const incognito = await resolveIncognito(win.incognito);
          const newWin = await chrome.windows.create(incognito ? { url: first.url, incognito: true } : { url: first.url });
          if (newWin && rest.length > 0 && newWin.id) {
            await Promise.all(rest.map((t) => chrome.tabs.create({ windowId: newWin.id!, url: t.url })));
          }
        }
      }
    },
  });
}
