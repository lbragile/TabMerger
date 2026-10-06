import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trackEvent } from '@/lib/analytics';
import { nanoid } from 'nanoid';
import { encryptBlob, FREE_TIER_LIMITS } from '@tabmerger/shared';
import type { Session } from '@/lib/types';
import { getSessions, saveSession, deleteSession, setSetting } from '@/lib/localDb';
import { supabase } from '@/lib/supabase';
import { resolveIncognito } from '@/lib/incognito';
import { getContentUploadKey, UPLOAD_BLOCKED_MESSAGE } from '@/lib/contentUploadKey';
import { SESSIONS_MIGRATION_DONE_KEY } from '@/lib/syncSettingKeys';
import { canUploadOnFirefox } from '@/lib/syncEngine';
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

/**
 * Upserts a single local session to Supabase with `{name, groups, description}` ENCRYPTED into
 * the `groups` column (the plaintext `name`/`description` columns are sent blank). There is no
 * plaintext branch: without an unlocked key (setup not finished, status unknown, locked) nothing
 * is sent. Resolves `true` only when the server accepted the row; `false` when the upload was
 * skipped or rejected, so callers can retry later. Shared by `useSaveSession`'s explicit save
 * action and `useSync`'s session self-heal, since sessions have no `pendingSync` flag or push
 * loop of their own.
 */
export async function pushSessionToSupabase(session: Session): Promise<boolean> {
  const { data: { session: authSession } } = await supabase.auth.getSession();
  if (!authSession) return false;
  if (!(await canUploadOnFirefox())) return false; // see syncEngine.ts's canUploadOnFirefox doc comment

  const gate = await getContentUploadKey();
  if (!gate.key) {
    console.warn(`[TabMerger] Session ${session.id} not uploaded: ${UPLOAD_BLOCKED_MESSAGE[gate.reason]}`);
    return false;
  }
  const { iv, ct } = await encryptBlob(gate.key, { name: session.name, groups: session.groups, description: session.description });

  const { error } = await supabase.from('sessions').upsert({
    id: session.id,
    user_id: authSession.user.id,
    name: '',
    description: null,
    groups: { v: 1, iv, ct },
    created_at: new Date(session.createdAt).toISOString(),
  });
  if (error) {
    console.warn('[TabMerger] Session sync to Supabase failed', session.id, error.message);
    return false;
  }
  return true;
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
      await saveSession(session);
      // ponytail: best-effort Supabase sync — local save already succeeded. Only for
      // users with the cloud-sync entitlement; free users stay local-only.
      if (cloudSync) {
        let uploaded = false;
        try {
          uploaded = await pushSessionToSupabase(session);
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
      await deleteSession(id);
      // ponytail: best-effort Supabase sync
      try {
        const { data: { session: authSession } } = await supabase.auth.getSession();
        if (authSession) {
          await supabase.from('sessions').delete().eq('id', id).eq('user_id', authSession.user.id);
        }
      } catch (e) {
        console.warn('[TabMerger] Session delete sync to Supabase failed', e);
      }
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
          if (win.tabs.length === 0) continue;
          const [first, ...rest] = win.tabs;
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
