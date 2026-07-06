import type { Session } from '@supabase/supabase-js';
import type { Group } from './types';
import { supabase } from './supabase';
import { getPendingSyncGroups, markGroupSynced, saveGroup } from './localDb';

export async function pushPendingChanges(session: Session): Promise<void> {
  // ponytail: explicit permanent guard — Now Open should already have pendingSync:false, but belt-and-suspenders
  const pending = (await getPendingSyncGroups()).filter((g) => !g.permanent);
  if (pending.length === 0) return;

  const userId = session.user.id;

  for (const group of pending) {
    const { error } = await supabase.from('groups').upsert({
      id: group.id,
      user_id: userId,
      name: group.name,
      color: group.color,
      updated_at: new Date(group.updatedAt).toISOString(),
      windows: group.windows,
      permanent: group.permanent ?? false,
      info: group.info ?? ''
    });

    if (!error) {
      await markGroupSynced(group.id);
    } else {
      console.error('[SyncEngine] Failed to push group', group.id, error.message);
    }
  }
}

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

  const remoteMap = new Map(
    data.map((row) => [
      row.id as string,
      {
        id: row.id as string,
        name: row.name as string,
        color: row.color as string,
        updatedAt: new Date(row.updated_at as string).getTime(),
        windows: row.windows as Group['windows'],
        permanent: row.permanent as boolean,
        info: row.info as string,
        pendingSync: false
      } satisfies Group
    ])
  );

  const localMap = new Map(localGroups.map((g) => [g.id, g]));

  let merged: Group[] = [];

  // Merge: last-write-wins by updatedAt
  const allIds = new Set([...remoteMap.keys(), ...localMap.keys()]);
  for (const id of allIds) {
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
      merged.push(local);
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
        if (payload.eventType === 'DELETE') return;
        const row = payload.new as Record<string, unknown>;
        const group: Group = {
          id: row.id as string,
          name: row.name as string,
          color: row.color as string,
          updatedAt: new Date(row.updated_at as string).getTime(),
          windows: row.windows as Group['windows'],
          permanent: row.permanent as boolean,
          info: row.info as string,
          pendingSync: false
        };
        await saveGroup(group);
        onUpdate(group);
      }
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
