import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { isOpenableUrl } from '@/lib/safeOpen';
import { closeWindows } from '@/lib/closeLiveTabs';
import { trackEvent } from '@/lib/analytics';
import { nanoid } from 'nanoid';
import { FREE_TIER_LIMITS, isTourDemoGroup } from '@tabmerger/shared';
import type { Session } from '@/lib/types';
import { getSessions, saveSession, deleteSession, getSetting, updateSessionColor } from '@/lib/localDb';
import { validSessionColor } from '@/lib/sessionColor';
import { supabase } from '@/lib/supabase';
import { resolveIncognito } from '@/lib/incognito';
import { LAST_USER_ID_KEY } from '@/lib/syncSettingKeys';
import { pushSessionToSupabase, deleteRemoteSessionsQueued, noteSessionDeletedHere, uploadStoredSession } from '@/lib/sessionUpload';
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
 * Who a session upload is for: the signed-in account, but only while the store's recorded owner is
 * that account (or nobody yet). Read BEFORE anything is written: if the store still holds another
 * account's data (the account wipe has not run yet), nothing is uploaded under the signed-in one.
 */
async function sessionUploadOwner(): Promise<string | undefined> {
  try {
    const signedInId = (await supabase.auth.getSession()).data.session?.user.id;
    const storeOwner = await getSetting<string | null>(LAST_USER_ID_KEY, null);
    if (signedInId && (!storeOwner || storeOwner === signedInId)) return signedInId;
  } catch (e) {
    console.warn('[TabMerger] Session sync to Supabase failed', e);
  }
  return undefined;
}

/**
 * Best-effort upload of a session just written locally (marked `uploadPending` in that same
 * write): the STORED copy, one upload per session at a time (`uploadStoredSession`). Not on the
 * server (no key yet / locked / offline / rejected / no owner / the popup closed meanwhile): the
 * mark stays and the sync's sessions pass retries this session alone (see useSync), without a
 * full pass of every session.
 */
async function uploadMarkedSession(id: string, ownerId: string | undefined): Promise<void> {
  if (!ownerId) return;
  await uploadStoredSession(id, ownerId);
}

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
    mutationFn: async ({ name, description, color, sessionCount, hasSessions, cloudSync }: { name: string; description?: string; color?: string; sessionCount: number; hasSessions: boolean; cloudSync: boolean }) => {
      // ponytail: free tier gets 3 sessions; pro+ unlimited (hasSessions = entitlement)
      if (!hasSessions && sessionCount >= FREE_SESSION_LIMIT) {
        throw new Error('SESSION_LIMIT');
      }
      if (!groupsState) throw new Error('No groups state');
      // Saved groups only: never "Now Open", never the guided tour's practice groups
      const groups = groupsState.available.filter((g) => !g.permanent && !isTourDemoGroup(g));
      const createdAt = Date.now();
      const session: Session = {
        id: nanoid(10),
        name,
        description,
        groups,
        createdAt,
        // only a palette colour is ever stored (see lib/sessionColor.ts)
        ...(validSessionColor(color) ? { color } : {}),
        // not on the server yet: retried by the sync if this popup closes before the upload ends
        ...(cloudSync ? { uploadPending: createdAt } : {}),
      };
      // Whose session this is, captured BEFORE anything is written: the upload below is refused
      // if the signed-in account is no longer this one (see pushSessionToSupabase). Free users
      // never upload, so the session is not even read for them.
      // The groups being saved are the STORE's, so its recorded owner decides, not only who is
      // signed in right now: if the store still holds another account's data (the account wipe
      // has not run yet), nothing is uploaded under the signed-in account.
      const ownerId = cloudSync ? await sessionUploadOwner() : undefined;
      await saveSession(session);
      // ponytail: best-effort Supabase sync — local save already succeeded. Only for
      // users with the cloud-sync entitlement; free users stay local-only.
      if (cloudSync) await uploadMarkedSession(session.id, ownerId);
      return session;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY }),
  });
}

/**
 * "Change colour…" on a saved session: stores the new colour (only a palette colour, only if the
 * session still exists and is not an automatic backup: one IndexedDB transaction, which also marks
 * it `uploadPending` for accounts with cloud sync) and uploads the stored session again, encrypted,
 * update-only once the server has it: a session deleted in the dashboard is never re-created.
 * Resolves the updated session, or `null` when it was deleted meanwhile (or is a backup).
 */
export function useUpdateSessionColor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, color, cloudSync }: { id: string; color: string; cloudSync: boolean }) => {
      if (!validSessionColor(color)) throw new Error('INVALID_SESSION_COLOR');
      const ownerId = cloudSync ? await sessionUploadOwner() : undefined;
      const updated = await updateSessionColor(id, color, cloudSync ? Date.now() : undefined);
      if (updated && cloudSync) await uploadMarkedSession(id, ownerId);
      return updated;
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
      // an upload of it still in flight deletes the row it re-creates (see uploadStoredSession)
      noteSessionDeletedHere(id);
      await deleteSession(id);
      // ponytail: best-effort Supabase sync (never throws), sent after any upload of this session
      if (ownerId) await deleteRemoteSessionsQueued([id], ownerId);
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
      // Restoring replaces the open windows WITHOUT saving them: "Recently closed" remembers them
      await closeWindows(windows.map((w) => w.id!), { record: true });
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
