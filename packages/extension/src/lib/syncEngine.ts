import type { Session } from '@supabase/supabase-js';
import { encryptBlob, decryptBlob, isEncryptedBlob, type EncryptedBlob } from '@tabmerger/shared';
import type { Group } from './types';
import { supabase } from './supabase';
import { getGroupsState, saveGroupsState, getPendingSyncGroups, markGroupSynced, saveGroup, deleteGroup, getSetting, setSetting } from './localDb';
import { hasEncryptionKey, getDataKey } from './encryptionKey';

interface EncryptedContent {
  name: string;
  windows: Group['windows'];
  note: string | null | undefined;
  info: string | undefined;
}

/** Upserts a single group to Supabase and marks it synced locally on success. Shared by push paths. */
async function pushGroup(session: Session, group: Group): Promise<void> {
  // ponytail: whole body wrapped — a throw here (e.g. encryptBlob choking on a malformed/
  // oversized field for one specific group) must not propagate out to the caller's for-loop,
  // which would silently abort every group after it in the same push batch.
  try {
    let windowsField: Group['windows'] | EncryptedBlob = group.windows;
    let name = group.name;
    let note = group.note ?? null;
    let info = group.info ?? '';

    if (await hasEncryptionKey()) {
      const dataKey = await getDataKey();
      if (!dataKey) {
        // ponytail: locked (e.g. worker restarted, passphrase not re-entered this session) —
        // never fall back to plaintext push. Leave pendingSync so this retries once unlocked.
        console.warn('[SyncEngine] Encryption enabled but key is locked — skipping push for', group.id);
        return;
      }
      const { iv, ct } = await encryptBlob(dataKey, {
        name: group.name,
        windows: group.windows,
        note: group.note,
        info: group.info
      } satisfies EncryptedContent);
      windowsField = { v: 1, iv, ct };
      name = '';
      note = null;
      info = '';
    }

    const { error } = await supabase.from('groups').upsert({
      id: group.id,
      user_id: session.user.id,
      name,
      color: group.color,
      updated_at: new Date(group.updatedAt).toISOString(),
      windows: windowsField,
      starred: group.starred ?? false,
      archived: group.archived ?? false,
      note,
      info,
      // Denormalized plaintext counts so SSR pages can show stats without holding the
      // decryption key — always computed from the real (pre-encryption) content.
      window_count: group.windows.length,
      tab_count: group.windows.reduce((sum, w) => sum + w.tabs.length, 0)
    });

    if (!error) {
      await markGroupSynced(group.id);
    } else {
      console.error('[SyncEngine] Failed to push group', group.id, error.message);
    }
  } catch (err) {
    console.error('[SyncEngine] Unexpected error pushing group', group.id, err);
  }
}

/** Decrypts an encrypted row's `windows` blob back into `{name, windows, note, info}`, or returns null if locked. */
async function decryptRow(row: Record<string, unknown>): Promise<EncryptedContent | null> {
  const dataKey = await getDataKey();
  if (!dataKey) return null;
  return decryptBlob<EncryptedContent>(dataKey, row.windows as EncryptedBlob);
}

/** Builds a `Group` from a raw Supabase row, decrypting it first if it's in the encrypted shape. Returns null if it's encrypted but locked (skip — retry once unlocked). */
async function rowToGroup(row: Record<string, unknown>): Promise<Group | null> {
  const encrypted = isEncryptedBlob(row.windows);
  let name = row.name as string;
  let windows = row.windows as Group['windows'];
  let note = (row.note as string | null) ?? undefined;
  let info = row.info as string;

  if (encrypted) {
    const content = await decryptRow(row);
    if (!content) return null;
    name = content.name;
    windows = content.windows;
    note = content.note ?? undefined;
    info = content.info ?? '';
  }

  return {
    id: row.id as string,
    name,
    color: row.color as string,
    updatedAt: new Date(row.updated_at as string).getTime(),
    windows,
    starred: (row.starred as boolean) ?? false,
    archived: (row.archived as boolean) ?? false,
    note,
    info,
    pendingSync: false
  };
}

/**
 * Upserts all locally-modified groups (pendingSync=true) to Supabase, then clears the flag.
 * Permanent groups (Now Open) are explicitly excluded — they are device-local by design.
 * Runs sequentially per group so a single failure doesn't block the rest.
 */
export async function pushPendingChanges(session: Session): Promise<void> {
  // ponytail: explicit permanent guard — Now Open should already have pendingSync:false, but belt-and-suspenders
  const pending = (await getPendingSyncGroups()).filter((g) => !g.permanent);
  if (pending.length === 0) return;

  for (const group of pending) {
    await pushGroup(session, group);
  }
}

// Persisted (survives popup close / SW restart) set of group ids whose remote delete is in
// flight or hasn't been confirmed gone yet. `pullRemoteChanges` treats any id in here as
// "not present" regardless of what the remote row currently says, closing the race where a
// poll/mount pull lands between the optimistic local removal and the DELETE actually landing
// on Supabase (see deleteRemoteGroups) and would otherwise resurrect the group.
const PENDING_DELETE_KEY = 'pendingDeleteGroupIds';

async function getPendingDeleteIds(): Promise<string[]> {
  return getSetting<string[]>(PENDING_DELETE_KEY, []);
}

/**
 * Hard-deletes groups from Supabase by id. Best-effort / fire-and-forget — callers should
 * `.catch()` this. The ids are recorded as "pending delete" (in IDB settings, not just an
 * in-memory flag) *before* the network call so `pullRemoteChanges` can filter them out of the
 * merge even if a sync pull races ahead of this DELETE actually landing on Supabase.
 * No-op (network-wise) when there's no active session (free/non-synced users never pushed the
 * group anyway) — but the ids are still marked pending so a subsequent sign-in doesn't resurrect
 * a group that was deleted while signed out.
 */
export async function deleteRemoteGroups(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const existing = await getPendingDeleteIds();
  await setSetting(PENDING_DELETE_KEY, Array.from(new Set([...existing, ...ids])));

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const { error } = await supabase.from('groups').delete().in('id', ids).eq('user_id', session.user.id);
  if (error) console.error('[SyncEngine] Failed to delete remote groups', error.message);
  // On success or failure we leave the ids marked pending — `pullRemoteChanges` self-heals by
  // clearing an id once a pull confirms the row is actually gone from Supabase, which also
  // covers the failure case via retry-on-next-pending-sync-push (groups are never re-created
  // with the same id, so there's nothing else to reconcile).
}

/**
 * Fetches all remote groups for the user and merges them with the local set using last-write-wins on `updatedAt`.
 * Remote-only groups are saved to IDB; local-only groups are kept as-is (they will be pushed on the next sync cycle).
 * Returns the merged list sorted: permanent group first, then non-archived by most recently updated.
 */
export async function pullRemoteChanges(session: Session, localGroups: Group[]): Promise<Group[]> {
  const userId = session.user.id;

  const { data, error } = await supabase
    .from('groups')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error || !data) {
    console.error('[SyncEngine] Failed to pull groups', error?.message);
    return localGroups;
  }

  const decoded = await Promise.all(data.map((row) => rowToGroup(row)));
  const remoteMap = new Map(
    decoded
      .filter((g): g is Group => g !== null) // ponytail: encrypted-but-locked rows are skipped, retried once unlocked
      .map((g) => [g.id, g])
  );

  const localMap = new Map(localGroups.map((g) => [g.id, g]));

  // Race guard: ids whose remote delete is in flight/unconfirmed are treated as absent from
  // BOTH sides below, so a pull that lands before the DELETE reaches Supabase can't resurrect
  // them. Self-heal: once a pending id is actually gone from `remoteMap`, drop it from the set.
  const pendingDeletes = await getPendingDeleteIds();
  if (pendingDeletes.length > 0) {
    const stillRemote = pendingDeletes.filter((id) => remoteMap.has(id));
    if (stillRemote.length !== pendingDeletes.length) {
      await setSetting(PENDING_DELETE_KEY, stillRemote);
    }
  }
  const pendingDeleteSet = new Set(pendingDeletes);

  let merged: Group[] = [];

  // Merge: last-write-wins by updatedAt
  const allIds = new Set([...remoteMap.keys(), ...localMap.keys()]);
  for (const id of allIds) {
    if (pendingDeleteSet.has(id)) continue;

    const remote = remoteMap.get(id);
    const local = localMap.get(id);

    if (remote && local) {
      const winner = remote.updatedAt > local.updatedAt ? remote : local;
      merged.push(winner);
      if (winner === remote) {
        await saveGroup(remote);
      }
    } else if (remote) {
      merged.push(remote);
      await saveGroup(remote);
    } else if (local) {
      // Local-only: either genuinely new/unpushed (pendingSync:true — keep, push next cycle)
      // or previously-synced (pendingSync:false) and now missing from remote entirely, which
      // (now that pendingDeleteSet already filtered out this device's own in-flight deletes
      // above) can only mean it was deleted remotely — drop it locally instead of resurrecting it.
      if (local.permanent || local.pendingSync) {
        merged.push(local);
      } else {
        await deleteGroup(local.id);
      }
    }
  }

  // Deduplicate permanent groups: keep oldest (lowest updatedAt) — remote could have stale permanents
  const mergedPermanents = merged.filter((g) => g.permanent).sort((a, b) => a.updatedAt - b.updatedAt);
  if (mergedPermanents.length > 1) {
    const extraIds = new Set(mergedPermanents.slice(1).map((g) => g.id));
    merged = merged.filter((g) => !extraIds.has(g.id));
  }

  // Keep permanent group first
  return [
    ...merged.filter((g) => g.permanent),
    ...merged.filter((g) => !g.permanent).sort((a, b) => b.updatedAt - a.updatedAt)
  ];
}

/**
 * Runs one push+pull sync cycle and persists the merged result to IDB — the core of
 * `useSync`'s `doSync`, extracted so the background service worker (no React lifecycle,
 * no queryClient) can trigger a real sync too, not just re-read Supabase. Callers are
 * responsible for encryption-lock/session gating before calling this (see `useSync.ts`
 * and background.ts's `SYNC_NOW` handler) — this function assumes the caller already
 * confirmed there's an unlocked data key if encryption is on.
 */
export async function performSync(session: Session): Promise<Group[]> {
  const state = await getGroupsState();
  await pushPendingChanges(session);
  const merged = await pullRemoteChanges(session, state.available);

  // Re-apply local drag order: pull returns groups sorted by updatedAt which stomps the
  // user's drag order. Re-sort merged using the locally-saved order; any groups new from
  // remote land at the end.
  const localOrder = state.available.map((g) => g.id);
  const posMap = new Map(localOrder.map((id, i) => [id, i]));
  const reordered = [...merged].sort((a, b) => {
    if (a.permanent && !b.permanent) return -1;
    if (!a.permanent && b.permanent) return 1;
    return (posMap.get(a.id) ?? Infinity) - (posMap.get(b.id) ?? Infinity);
  });

  const next = { ...state, available: reordered };
  await saveGroupsState(next);
  return reordered;
}

/**
 * Opens a Supabase Realtime channel for the user's groups table and calls `onUpdate` whenever
 * another device pushes a change. Each received row is saved to IDB immediately.
 * Returns an unsubscribe function — callers must invoke it on unmount to avoid channel leaks.
 */
export async function subscribeToRemoteChanges(
  session: Session,
  onUpdate: (group: Group) => void
): Promise<() => void> {
  const userId = session.user.id;

  const channel = supabase
    .channel(`groups:${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'groups', filter: `user_id=eq.${userId}` },
      async (payload) => {
        // Deletes are real hard deletes (see deleteRemoteGroups). Propagate immediately to this
        // device's IDB rather than waiting for the next pull, using the same pendingSync/
        // pendingDeleteGroupIds safety logic as pullRemoteChanges: skip if this device's own
        // delete is already in flight for the id (avoids a redundant/racy second delete), and
        // never touch the permanent "Now Open" group (it never has a matching remote row anyway).
        if (payload.eventType === 'DELETE') {
          const deletedRow = payload.old as Record<string, unknown> | undefined;
          const deletedId = deletedRow?.id as string | undefined;
          if (!deletedId) return;
          const pendingDeletes = await getPendingDeleteIds();
          if (pendingDeletes.includes(deletedId)) return;
          await deleteGroup(deletedId);
          return;
        }
        const row = payload.new as Record<string, unknown>;
        const group = await rowToGroup(row);
        if (!group) return; // encrypted but locked — skip, will be picked up on next pull once unlocked
        await saveGroup(group);
        onUpdate(group);
      }
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
