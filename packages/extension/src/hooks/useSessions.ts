import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trackEvent } from '@/lib/analytics';
import { nanoid } from 'nanoid';
import { encryptBlob } from '@tabmerger/shared';
import type { Session } from '@/lib/types';
import { getSessions, saveSession, deleteSession } from '@/lib/localDb';
import { supabase } from '@/lib/supabase';
import { hasEncryptionKey, getDataKey } from '@/lib/encryptionKey';
import { useGroups } from './useGroups';

export const SESSIONS_QUERY_KEY = ['sessions'] as const;
const FREE_SESSION_LIMIT = 3;

export function useSessions() {
  return useQuery({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: getSessions,
    staleTime: Infinity,
  });
}

/**
 * Saves the current non-permanent groups as a named session snapshot.
 * Local-first: writes to IndexedDB first, then best-effort syncs to Supabase.
 * Enforces `FREE_SESSION_LIMIT` for users without the `hasSessions` entitlement.
 * Throws `'SESSION_LIMIT'` (checked by the caller to show an upgrade prompt).
 */
export function useSaveSession() {
  const qc = useQueryClient();
  const { data: groupsState } = useGroups();

  return useMutation({
    mutationFn: async ({ name, sessionCount, hasSessions }: { name: string; sessionCount: number; hasSessions: boolean }) => {
      // ponytail: free tier gets 3 sessions; pro+ unlimited (hasSessions = entitlement)
      if (!hasSessions && sessionCount >= FREE_SESSION_LIMIT) {
        throw new Error('SESSION_LIMIT');
      }
      if (!groupsState) throw new Error('No groups state');
      const groups = groupsState.available.filter((g) => !g.permanent);
      const session: Session = {
        id: nanoid(10),
        name,
        groups,
        createdAt: Date.now(),
      };
      await saveSession(session);
      // ponytail: best-effort Supabase sync — local save already succeeded
      try {
        const { data: { session: authSession } } = await supabase.auth.getSession();
        if (authSession) {
          let name: string = session.name;
          let groupsField: Session['groups'] | { v: 1; iv: string; ct: string } = session.groups;

          if (await hasEncryptionKey()) {
            const dataKey = await getDataKey();
            if (!dataKey) {
              // ponytail: locked — never push plaintext session content. Local save already
              // succeeded above; the remote copy is simply skipped until unlocked (same as pushGroup).
              console.warn('[TabMerger] Encryption enabled but key is locked — skipping session sync for', session.id);
              return session;
            }
            const { iv, ct } = await encryptBlob(dataKey, { name: session.name, groups: session.groups });
            groupsField = { v: 1, iv, ct };
            name = '';
          }

          await supabase.from('sessions').upsert({
            id: session.id,
            user_id: authSession.user.id,
            name,
            groups: groupsField,
            created_at: new Date(session.createdAt).toISOString(),
          });
        }
      } catch (e) {
        console.warn('[TabMerger] Session sync to Supabase failed', e);
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
          const newWin = await chrome.windows.create({ url: first.url });
          if (newWin && rest.length > 0 && newWin.id) {
            await Promise.all(rest.map((t) => chrome.tabs.create({ windowId: newWin.id!, url: t.url })));
          }
        }
      }
    },
  });
}
