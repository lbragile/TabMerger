import type { Session } from '@supabase/supabase-js';
import { encryptBlob, decryptBlob, isEncryptedBlob, SYNC_DATA_CONSENT_CATEGORIES, type EncryptedBlob } from '@tabmerger/shared';
import type { Group } from './types';
import { emitForeignGroupsChange, emitSyncConflict } from './foreignChange';
import { groupContentEqual, makeConflictCopy } from './syncConflict';
import { compareStamps } from './stamp';
import { withSyncLock } from './syncLock';
import { syncRequestSignal, cycleDeadline } from './syncRequest';
import { LAST_USER_ID_KEY, REMOTE_BASE_SEEDED_KEY, DELETE_BACKOFF_KEY } from './syncSettingKeys';
import { supabase } from './supabase';
import {
  getGroupsState, updateGroupsState, getPendingSyncGroups, markGroupSynced, markPositionSynced, saveGroup, deleteGroup,
  getPendingGroupDeletes, addPendingGroupDeletes, removePendingGroupDeletes, getSetting, setSetting
} from './localDb';
import { getDataKey, reportUndecryptableRows } from './encryptionKey';
import { getContentUploadKey, UPLOAD_BLOCKED_MESSAGE } from './contentUploadKey';
import { hasDataConsent } from './dataConsent';

/**
 * Firefox-only gate: uploading groups is `browsingActivity` data collection (tab URLs/titles
 * leave the browser even though the payload is end-to-end encrypted — Firefox's consent model
 * is about what leaves the device, not whether the destination can read it). No-op (always
 * true) on Chrome/Edge. Pulling/merging remote changes is NOT gated — reading data already in
 * Supabase back down isn't new collection, and gating it too would strand a Firefox user's other
 * devices' changes for no consent-model reason.
 */
export async function canUploadOnFirefox(): Promise<boolean> {
  return hasDataConsent(SYNC_DATA_CONSENT_CATEGORIES);
}

interface EncryptedContent {
  name: string;
  windows: Group['windows'];
  note: string | null | undefined;
  info: string | undefined;
}

const UNIQUE_VIOLATION = '23505';

/**
 * The server's current `updated_at` for one row (legacy detection): `stamp: null` when the server
 * ANSWERED that the row does not exist, `ok: false` when the lookup itself failed. A failed lookup
 * is never read as "no row".
 */
async function probeRemoteStamp(userId: string, id: string): Promise<{ ok: true; stamp: string | null } | { ok: false }> {
  const { data, error } = await supabase.from('groups').select('updated_at').eq('id', id).eq('user_id', userId).abortSignal(syncRequestSignal()).maybeSingle();
  if (error) return { ok: false };
  return { ok: true, stamp: (data as { updated_at?: string } | null)?.updated_at ?? null };
}

/** Why a cycle (or a push) must not run for `session`; `ok` when it may. */
type CycleIdentity = 'ok' | 'account-mismatch' | 'identity-changed';

/**
 * Two identities must match the cycle's `session` before anything is sent or merged:
 *  - the OWNER of the local store (`LAST_USER_ID_KEY`, set by `ensureAccountScope`): the service worker
 *    can be handed another account's session (web bridge) before the popup has switched the store,
 *    and that account must never receive the previous owner's groups (`account-mismatch`);
 *  - the client's CURRENT session: after a sign-out or a failed token refresh, requests go out as
 *    anon and RLS answers "zero rows" successfully. Such an answer says nothing about the account,
 *    and merging it would read as "everything was deleted" (`identity-changed`).
 */
async function checkCycleIdentity(session: Session): Promise<CycleIdentity> {
  const owner = await getSetting<string | null>(LAST_USER_ID_KEY, null);
  if (owner && owner !== session.user.id) return 'account-mismatch';
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id === session.user.id ? 'ok' : 'identity-changed';
  } catch {
    return 'identity-changed';
  }
}

/**
 * Pushes a single group with compare-and-swap and marks it synced locally on success.
 *  - base known: `update … eq('updated_at', base)`; zero rows back = someone else changed the row since
 *    this device last saw it. Nothing is overwritten; the group stays pending and the pull's merge
 *    resolves it (adopt if the content is equal, otherwise keep both as a conflict copy).
 *  - no base: a new group is a plain insert (a unique violation = id collision, resolved by the merge);
 *    `legacy` (first sync after the upgrade) first probes whether the row exists and, if so, adopts its
 *    stamp as the base so an upgrade never creates conflict copies.
 * On success the stamp the server returned becomes the new base.
 *
 * Known limitation (accepted): if the response of a SUCCESSFUL update is lost (offline right after the
 * write), this device keeps the old base, so its next push fails the compare-and-swap. If the user did
 * not edit again, the merge sees equal content and adopts the stamp silently; if they did, their newer
 * edit is saved as a "(conflict copy)" of their own older one. Nothing is lost; the cheap fix (re-reading
 * the row after every write) would double the requests for a rare case.
 */
async function pushGroup(session: Session, group: Group, position: number, legacy: boolean, dataKey: CryptoKey): Promise<void> {
  // NOTE: a full-row push (re-encrypted with a fresh IV) always counts as a CONTENT change on the
  // server. Reorders must never come through here; they use pushPosition.
  // ponytail: whole body wrapped — a throw here (e.g. encryptBlob choking on a malformed/
  // oversized field for one specific group) must not propagate out to the caller's for-loop,
  // which would silently abort every group after it in the same push batch.
  try {
    // Content ALWAYS goes up encrypted (the caller holds the key, see pushPendingChanges): the
    // plaintext columns are sent blank and everything lives in the `windows` blob.
    const { iv, ct } = await encryptBlob(dataKey, {
      name: group.name,
      windows: group.windows,
      note: group.note,
      info: group.info
    } satisfies EncryptedContent);
    const windowsField: EncryptedBlob = { v: 1, iv, ct };
    const name = '';
    const note = null;
    const info = '';

    let base = group.remoteUpdatedAt;
    if (!base && legacy) {
      const probe = await probeRemoteStamp(session.user.id, group.id);
      if (!probe.ok) {
        console.warn('[SyncEngine] Could not look up the server row; the push waits for the next cycle:', group.id);
        return;
      }
      base = probe.stamp ?? undefined;
    }

    const row = {
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
      position,
      // Denormalized plaintext counts so SSR pages can show stats without holding the
      // decryption key — always computed from the real (pre-encryption) content.
      window_count: group.windows.length,
      tab_count: group.windows.reduce((sum, w) => sum + w.tabs.length, 0)
    };
    const table = supabase.from('groups');
    const { data, error } = base
      ? await table.update(row).eq('id', group.id).eq('user_id', session.user.id).eq('updated_at', base).select('updated_at').abortSignal(syncRequestSignal())
      : await table.insert(row).select('updated_at').abortSignal(syncRequestSignal());

    if (error) {
      if (!base && (error as { code?: string }).code === UNIQUE_VIOLATION) {
        console.warn('[SyncEngine] Row already exists on the server; the merge will resolve it:', group.id);
      } else {
        console.error('[SyncEngine] Failed to push group', group.id, error.message);
      }
      return;
    }
    const stamp = (data as Array<{ updated_at?: string }> | null)?.[0]?.updated_at;
    if (!stamp) {
      console.warn('[SyncEngine] Row changed on the server since it was last seen; the merge will resolve it:', group.id);
      return;
    }
    // version-checked: an edit made while this write was in flight keeps its pendingSync flag
    await markGroupSynced(group.id, group.updatedAt, position, stamp, group);
  } catch (err) {
    console.error('[SyncEngine] Unexpected error pushing group', group.id, err);
  }
}

/**
 * Decrypts an encrypted row's `windows` blob back into `{name, windows, note, info}`. Returns null
 * when the row cannot be read on this device right now: the key is locked, or the row was written
 * under ANOTHER key (left over from before a passphrase reset, or this device's key is the stale
 * one) and `decryptBlob` threw; `onUndecryptable` is called in that second case.
 */
async function decryptRow(row: Record<string, unknown>, onUndecryptable?: () => void): Promise<EncryptedContent | null> {
  const dataKey = await getDataKey();
  if (!dataKey) return null;
  try {
    return await decryptBlob<EncryptedContent>(dataKey, row.windows as EncryptedBlob);
  } catch {
    onUndecryptable?.();
    return null;
  }
}

/**
 * Builds a `Group` from a raw Supabase row, decrypting it first if it's in the encrypted shape.
 * Returns null if it's encrypted and cannot be read (locked, or written under another key): the
 * caller skips the row, and one unreadable row never fails the rest.
 */
async function rowToGroup(row: Record<string, unknown>, onUndecryptable?: () => void): Promise<Group | null> {
  const encrypted = isEncryptedBlob(row.windows);
  let name = row.name as string;
  let windows = row.windows as Group['windows'];
  let note = (row.note as string | null) ?? undefined;
  let info = row.info as string;

  if (encrypted) {
    const content = await decryptRow(row, onUndecryptable);
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
    pendingSync: false,
    remoteUpdatedAt: row.updated_at as string
  };
}

/**
 * Pushes all locally-modified groups (pendingSync=true) to Supabase, ENCRYPTED, then clears the flag.
 * Without an unlocked encryption key no content is sent at all and the groups stay pending.
 * Permanent groups (Now Open) are explicitly excluded — they are device-local by design.
 * Runs sequentially per group so a single failure doesn't block the rest.
 * Each row carries `position` = the group's index in the local sidebar order (Now Open is
 * index 0 and never pushed, so synced groups start at 1; a pending group that is not in the
 * local order, or sits at index 0, is skipped rather than pushed at position 0).
 *
 * Reorders push ONLY the plaintext `position` (`pushPosition`) for groups flagged
 * `positionDirty` and not already pending: re-sending their full content would let this
 * device's possibly stale copy win last-write-wins over another device's newer edit.
 */
export async function pushPendingChanges(session: Session, deadline = cycleDeadline()): Promise<void> {
  // Never push for a user who does not own the local store, or whose session the client no longer holds.
  if ((await checkCycleIdentity(session)) !== 'ok') return;
  await pushPending(session, deadline);
}

/** {@link pushPendingChanges} without the identity check (the cycle has already done it). */
async function pushPending(session: Session, deadline: number): Promise<void> {
  if (!(await canUploadOnFirefox())) return; // consent not granted — see canUploadOnFirefox's doc comment
  // ponytail: explicit permanent guard — Now Open should already have pendingSync:false, but belt-and-suspenders
  const pending = (await getPendingSyncGroups()).filter((g) => !g.permanent);

  // One gate per cycle for every content push: without an unlocked key NOTHING is sent (there is no
  // plaintext fallback, see getContentUploadKey) and the groups keep `pendingSync` until setup /
  // unlock completes. Position-only pushes below are plaintext metadata and still go.
  const gate = pending.length > 0 ? await getContentUploadKey() : null;
  if (gate && !gate.key) {
    console.warn(`[SyncEngine] ${pending.length} group(s) not uploaded: ${UPLOAD_BLOCKED_MESSAGE[gate.reason]}`);
  }

  const legacy = !(await getSetting(REMOTE_BASE_SEEDED_KEY, false));
  const { available } = await getGroupsState();
  const positions = new Map(available.map((g, i) => [g.id, i]));
  const contentKey = gate?.key;
  // Past the cycle deadline nothing more is started: the rest stays pending for the next cycle.
  const outOfTime = () => Date.now() > deadline;
  if (contentKey) {
    for (const group of pending) {
      if (outOfTime()) break;
      const position = positions.get(group.id);
      if (position === undefined || position < 1) {
        console.warn('[SyncEngine] Skipping push of a group that is not in the local order:', group.id);
        continue;
      }
      await pushGroup(session, group, position, legacy, contentKey);
    }
  }
  for (const group of available) {
    const position = positions.get(group.id) ?? 0;
    if (group.permanent || group.pendingSync || !group.positionDirty || position < 1) continue;
    if (outOfTime()) break;
    await pushPosition(session, group, position);
  }
}

/**
 * Sends ONLY `position` for a group whose content is already on the server (works while the key is
 * locked). With a base it is guarded by the same stamp: before migration 020 the server bumps
 * `updated_at` on this write, so the returned stamp becomes the new base, and if another device
 * changed the row meanwhile the write is skipped (the group stays dirty and goes out after the pull
 * has adopted that change) instead of hiding the change behind a fresh stamp.
 */
async function pushPosition(session: Session, group: Group, position: number): Promise<void> {
  const id = group.id;
  try {
    let query = supabase.from('groups').update({ position }).eq('id', id).eq('user_id', session.user.id);
    if (group.remoteUpdatedAt) query = query.eq('updated_at', group.remoteUpdatedAt);
    const { data, error } = await query.select('updated_at').abortSignal(syncRequestSignal());
    if (error) {
      console.error('[SyncEngine] Failed to push position', id, error.message);
      return;
    }
    const stamp = (data as Array<{ updated_at?: string }> | null)?.[0]?.updated_at;
    if (stamp) await markPositionSynced(id, position, group.remoteUpdatedAt ? stamp : undefined);
  } catch (err) {
    console.error('[SyncEngine] Unexpected error pushing position', id, err);
  }
}

/**
 * How a batch of remote deletes ended: every chunk accepted (`sent`), at least one refused by the
 * server or the network (`failed`), or stopped by the cycle deadline with nothing refused (`out-of-time`).
 */
type DeleteSendResult = 'sent' | 'failed' | 'out-of-time';

/**
 * Sends the remote DELETE for `ids`. A failure only logs: the ids stay in the persisted
 * pending-delete set (see `PENDING_DELETE_KEY`) and the next `performSync` sends them again.
 */
async function sendRemoteDeletes(userId: string, ids: string[], deadline = Infinity): Promise<DeleteSendResult> {
  let failed = false;
  // chunked: one `in()` with hundreds of ids exceeds the request URL limit and would fail forever
  for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
    // out of cycle time: the rest is sent next cycle
    if (Date.now() > deadline) return failed ? 'failed' : 'out-of-time';
    const { error } = await supabase
      .from('groups')
      .delete()
      .in('id', ids.slice(i, i + DELETE_CHUNK))
      .eq('user_id', userId)
      .abortSignal(syncRequestSignal());
    if (error) {
      console.error('[SyncEngine] Failed to delete remote groups', error.message);
      failed = true;
    }
  }
  return failed ? 'failed' : 'sent';
}

const DELETE_CHUNK = 100;
const DELETE_BACKOFF_BASE_MS = 30_000;
const DELETE_BACKOFF_MAX_MS = 60 * 60 * 1000;

/**
 * Hard-deletes groups from Supabase by id. Best-effort / fire-and-forget — callers should
 * `.catch()` this. The ids are recorded as "pending delete" (in IDB settings, not just an
 * in-memory flag) *before* the network call, so `performSync` keeps them out of the merge and
 * retries the DELETE every cycle until a pull confirms the row is gone — covering a failed
 * (offline) request, a worker restart, and an upsert that was in flight when the DELETE ran.
 * (`localDb`'s group write records the same ids atomically with the local removal, so this
 * call is the immediate-delete half; the durable marker does not depend on it.)
 * Does nothing without a session: a signed-out user never pushed the group, so there is nothing
 * to delete remotely and recording ids would only grow the set.
 */
export async function deleteRemoteGroups(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  await addPendingGroupDeletes(ids);
  await sendRemoteDeletes(session.user.id, ids);
}

/**
 * Retries every unconfirmed remote delete (one cycle of the durable retry loop), in chunks,
 * with exponential backoff (30 s doubling up to 1 h, persisted) after a failed cycle so an
 * offline or rejecting server is not hammered every poll. Running out of cycle time is not a
 * failure: nothing was refused, so the stored backoff is left as it was.
 */
async function flushPendingDeletes(session: Session, deadline: number): Promise<void> {
  const ids = await getPendingGroupDeletes();
  if (ids.length === 0) return;
  const backoff = await getSetting<{ failures: number; nextAt: number }>(DELETE_BACKOFF_KEY, { failures: 0, nextAt: 0 });
  if (Date.now() < backoff.nextAt) return;
  const result = await sendRemoteDeletes(session.user.id, ids, deadline);
  if (result === 'out-of-time') return;
  const ok = result === 'sent';
  const failures = ok ? 0 : backoff.failures + 1;
  const delay = Math.min(DELETE_BACKOFF_BASE_MS * 2 ** (failures - 1), DELETE_BACKOFF_MAX_MS);
  await setSetting(DELETE_BACKOFF_KEY, { failures, nextAt: ok ? 0 : Date.now() + delay });
}

const PULL_PAGE_SIZE = 1000;

/** One decoded pull: groups by id (decrypted when unlocked), their remote `position`, and ALL row ids. */
interface RemoteSnapshot {
  groups: Map<string, Group>;
  /** Remote sidebar index per group; absent for rows written before `position` was pushed. */
  positions: Map<string, number>;
  /** Every row id the server returned, including encrypted rows that could not be read and are skipped in `groups`. */
  ids: Set<string>;
  /** Ids of rows whose content is still stored as legacy plaintext (they must be re-uploaded encrypted). */
  plaintextIds: Set<string>;
}

/**
 * Fetches and decodes the user's remote groups. Returns `null` on a fetch error or when the pull
 * ran out of time (callers keep the local state untouched). Encrypted rows that cannot be read
 * (locked, or written under another key) are skipped, never treated as deleted, and never fail the pull.
 */
async function fetchRemoteGroups(session: Session, deadline = Infinity): Promise<RemoteSnapshot | null> {
  // Paginated: PostgREST caps a response at 1000 rows, and a truncated pull would make every clean
  // group beyond the cap look "deleted elsewhere". Any failed page aborts the whole cycle.
  //
  // KEYSET pagination on the immutable primary key (`id > last id of the previous page`), never
  // offsets: with `order by updated_at` + `range()`, a row another device updated between two page
  // requests moved to the front of the order, was in no page, and was then treated as deleted
  // remotely (dropped locally AND queued for a remote DELETE). A delete between pages shifted the
  // offsets the same way. An id never changes, so every row that exists for the whole pull is read
  // exactly once.
  //
  // END OF DATA is decided by the server's exact count of the rows still matching the filter, not
  // by `page.length < PULL_PAGE_SIZE`: a server whose response cap (`max_rows`) is below the page
  // size returns short pages that are NOT the last one, and stopping there would again read as
  // "the rest was deleted". (No count in the answer: fall back to the page-size rule.)
  const data: Array<Record<string, unknown>> = [];
  for (let lastId: string | null = null; ; ) {
    if (Date.now() > deadline) {
      console.warn('[SyncEngine] Pull abandoned: it ran out of time');
      return null;
    }
    let filter = supabase.from('groups').select('*', { count: 'exact' }).eq('user_id', session.user.id);
    if (lastId !== null) filter = filter.gt('id', lastId);
    const { data: page, error, count } = await filter.order('id').limit(PULL_PAGE_SIZE).abortSignal(syncRequestSignal());
    if (error || !page) {
      console.error('[SyncEngine] Failed to pull groups', error?.message);
      return null;
    }
    data.push(...page);
    const last = typeof count === 'number' ? page.length >= count : page.length < PULL_PAGE_SIZE;
    if (last || page.length === 0) break;
    lastId = page[page.length - 1].id as string;
  }

  let unreadable = 0;
  const decoded = await Promise.all(data.map((row) => rowToGroup(row, () => unreadable++)));
  if (unreadable > 0) {
    console.warn(`[SyncEngine] ${unreadable} row(s) could not be decrypted with this device's key and were skipped`);
    await reportUndecryptableRows();
  }
  const positions = new Map<string, number>();
  data.forEach((row) => {
    // Valid positions start at 1 (Now Open is 0 and never pushed). The column default 0 means
    // "never pushed" for every row written before position sync existed: treat it as unknown.
    if (typeof row.position === 'number' && row.position >= 1) positions.set(row.id as string, row.position);
  });
  return {
    groups: new Map(decoded.filter((g): g is Group => g !== null).map((g) => [g.id, g])),
    positions,
    ids: new Set(data.map((row) => row.id as string)),
    plaintextIds: new Set(data.filter((row) => !isEncryptedBlob(row.windows)).map((row) => row.id as string))
  };
}

/**
 * Pure merge of the remote groups into `localGroups` (no I/O). `toSave` are the remote versions
 * adopted; `toDelete` are local groups removed because the server no longer has them (or whose pending
 * edit was moved to a copy). `merged` has the permanent group first and no further order guarantee.
 * `pendingDeleteSet` ids are treated as absent from BOTH sides, so a pull that lands before
 * the DELETE does cannot resurrect them.
 *
 * The server stamp (`remoteUpdatedAt`) decides, never a comparison of the client `updatedAt` with it:
 *  - local copy with an unpushed edit: the stamp still equals its base -> keep (the push will win its
 *    compare-and-swap); otherwise the row changed on another device: equal content -> adopt the stamp
 *    and drop the pending flag; different content -> the SERVER copy becomes the group and this
 *    device's edit is kept as a pending "<name> (conflict copy)" (`copies`, idempotent: the original is
 *    no longer pending afterwards);
 *  - pending edit whose row is gone (deleted elsewhere): the edit survives as a conflict copy with a
 *    new id, so it never fights the other device's delete;
 *  - clean local copy: adopt the remote row when its stamp differs from the base;
 *  - no base (pre-upgrade data, `legacy`): fall back to last-write-wins on `updatedAt` once and record
 *    the stamp as the base.
 * An encrypted-but-locked row is in `remoteIds` but not `remoteMap`: nothing is resolved for it.
 */
function mergeRemoteGroups(
  remoteMap: Map<string, Group>,
  localGroups: Group[],
  pendingDeleteSet: Set<string>,
  remoteIds: Set<string> = new Set(remoteMap.keys()),
  legacy = false,
  plaintextIds: Set<string> = new Set()
): { merged: Group[]; toSave: Group[]; toDelete: string[]; copies: Array<{ group: Group; afterId: string }>; conflicts: string[] } {
  const localMap = new Map(localGroups.map((g) => [g.id, g]));
  let merged: Group[] = [];
  const toSave: Group[] = [];
  const toDelete: string[] = [];
  const copies: Array<{ group: Group; afterId: string }> = [];
  const conflicts: string[] = [];

  // Merge: last-write-wins by updatedAt
  const allIds = new Set([...remoteMap.keys(), ...localMap.keys()]);
  for (const id of allIds) {
    if (pendingDeleteSet.has(id)) continue;

    const remote = remoteMap.get(id);
    const local = localMap.get(id);

    if (remote && local) {
      const stamp = remote.remoteUpdatedAt;
      if (local.permanent) {
        merged.push(local);
      } else if (local.pendingSync) {
        if (local.remoteUpdatedAt ? compareStamps(stamp!, local.remoteUpdatedAt) <= 0 : legacy) {
          // not newer than our base (or pre-upgrade: adopt the stamp now) -> the push wins
          merged.push(local.remoteUpdatedAt ? local : { ...local, remoteUpdatedAt: stamp });
        } else if (groupContentEqual(local, remote)) {
          // Same content: adopt the stamp. The push is only cancelled when the server copy is already
          // ciphertext; a legacy PLAINTEXT row keeps the group pending so it is re-uploaded encrypted
          // (with the adopted stamp as its base, the next compare-and-swap succeeds).
          merged.push({ ...local, pendingSync: plaintextIds.has(id), remoteUpdatedAt: stamp });
        } else {
          merged.push(remote);
          toSave.push(remote);
          copies.push({ group: makeConflictCopy(local), afterId: id });
          conflicts.push(local.name);
        }
      } else {
        // Adopt only a row NEWER than the base: an older snapshot (an overlapping cycle) must never
        // replace what this device already saw.
        const adopt = local.remoteUpdatedAt ? compareStamps(stamp!, local.remoteUpdatedAt) > 0 : remote.updatedAt > local.updatedAt;
        if (adopt) {
          merged.push(remote);
          toSave.push(remote);
        } else {
          merged.push(local.remoteUpdatedAt ? local : { ...local, remoteUpdatedAt: stamp });
        }
      }
    } else if (remote) {
      merged.push(remote);
      toSave.push(remote);
    } else if (local) {
      // Local-only: either genuinely new/unpushed (pendingSync:true — keep, push next cycle)
      // or previously-synced (pendingSync:false) and now missing from remote entirely, which
      // (now that pendingDeleteSet already filtered out this device's own in-flight deletes
      // above) can only mean it was deleted remotely — drop it locally instead of resurrecting it.
      // An encrypted-but-locked remote row is in `remoteIds` but not in `remoteMap`: the group still
      // exists remotely, it just cannot be read yet, so it must not be mistaken for a remote delete.
      if (local.permanent || remoteIds.has(local.id)) {
        merged.push(local);
      } else if (local.pendingSync) {
        if (local.remoteUpdatedAt) {
          // It was on the server, someone deleted it, and this device has an unpushed edit: keep the
          // edit as a NEW group (new id) rather than fight the delete.
          const at = localGroups.findIndex((g) => g.id === id);
          copies.push({ group: makeConflictCopy(local), afterId: localGroups[at - 1]?.id ?? '' });
          conflicts.push(local.name);
          toDelete.push(id);
        } else {
          merged.push(local); // brand new, not pushed yet
        }
      } else {
        toDelete.push(local.id);
      }
    }
  }

  // Deduplicate permanent groups: keep oldest (lowest updatedAt) — remote could have stale permanents
  const mergedPermanents = merged.filter((g) => g.permanent).sort((a, b) => a.updatedAt - b.updatedAt);
  if (mergedPermanents.length > 1) {
    const extraIds = new Set(mergedPermanents.slice(1).map((g) => g.id));
    merged = merged.filter((g) => !extraIds.has(g.id));
  }

  return { merged, toSave, toDelete, copies, conflicts };
}

/** Permanent group first, then non-permanent groups by `compare`. */
function permanentFirst(groups: Group[], compare: (a: Group, b: Group) => number): Group[] {
  return [...groups.filter((g) => g.permanent), ...groups.filter((g) => !g.permanent).sort(compare)];
}

/**
 * Sidebar order after a pull, so two devices converge on one order.
 *
 * Each group sorts by its index (Now Open is 0 locally and never synced, so groups start at 1):
 *  - a group with a remote `position` whose local copy has NO unpushed change adopts the remote
 *    position — the device that last pushed a reorder (it marks every moved group dirty and
 *    pushes the new indices) wins on everyone else;
 *  - a group with an unpushed local change (`pendingSync` / `positionDirty`), or no remote position (legacy row),
 *    keeps its current local index; remote-only rows without a position go last.
 * Ties break by `updatedAt` desc, then id, so the result never depends on arrival order.
 */
function orderByPosition(merged: Group[], localGroups: Group[], snapshot: RemoteSnapshot): Group[] {
  const localIndex = new Map(localGroups.map((g, i) => [g.id, i]));
  const localById = new Map(localGroups.map((g) => [g.id, g]));
  const key = (g: Group): number => {
    const remotePos = snapshot.positions.get(g.id);
    const local = localById.get(g.id);
    if (remotePos !== undefined && !local?.pendingSync && !local?.positionDirty) return remotePos;
    return localIndex.get(g.id) ?? remotePos ?? Infinity;
  };
  return permanentFirst(merged, (a, b) => key(a) - key(b) || b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1));
}

/**
 * Fetches all remote groups for the user and merges them with the `localGroups` snapshot using
 * last-write-wins on `updatedAt`, writing each winning remote group / remote deletion straight
 * to IDB. Remote-only groups are saved; local-only groups are kept as-is (pushed next cycle).
 * Returns the merged list sorted: permanent group first, then by most recently updated.
 *
 * @internal TEST-ONLY: nothing in production calls it (the integration suites now drive
 * `performSync`); it stays for the unit tests of the merge rules.
 *
 * NOT atomic: it merges against the snapshot the caller hands in and writes per group, so a
 * local edit made after that snapshot can be overwritten. `performSync` — the production
 * path — does not use it; it merges inside `updateGroupsState` on a fresh read instead.
 */
export async function pullRemoteChanges(session: Session, localGroups: Group[]): Promise<Group[]> {
  const snapshot = await fetchRemoteGroups(session);
  if (!snapshot) return localGroups;

  const pendingDeletes = await getPendingGroupDeletes();
  await removePendingGroupDeletes(pendingDeletes.filter((id) => !snapshot.ids.has(id)));
  const { merged, toSave, toDelete } = mergeRemoteGroups(snapshot.groups, localGroups, new Set(pendingDeletes), snapshot.ids, true);
  for (const g of toSave) await saveGroup(g);
  for (const id of toDelete) await deleteGroup(id);
  return permanentFirst(merged, (a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Runs one push+pull sync cycle and persists the merged result to IDB — the core of
 * `useSync`'s `doSync`, extracted so the background service worker (no React lifecycle,
 * no queryClient) can trigger a real sync too, not just re-read Supabase. Callers are
 * responsible for encryption-lock/session gating before calling this (see `useSync.ts`
 * and background.ts's `SYNC_NOW` handler) — this function assumes the caller already
 * confirmed there's an unlocked data key if encryption is on.
 *
 * Cycle: push dirty groups, re-send every unconfirmed remote delete, fetch the remote rows
 * (all network work OUTSIDE the groups write queue), then apply the result in one
 * `updateGroupsState` on a FRESH read. Local edits and new groups made while the requests
 * were in flight therefore survive (the merge runs against the current local state), and
 * the pending-delete set is read inside that same locked step, so a delete committed just
 * before it cannot be resurrected from the remote row. An id leaves the pending set only
 * once a pull confirms the server no longer has the row.
 */
export async function performSync(session: Session): Promise<Group[]> {
  return (await performSyncCycle(session)).groups;
}

/**
 * {@link performSync} that also says whether the cycle RAN. One cycle at a time across every context
 * (see `withSyncLock`): a call that finds the lock held is skipped and reports the local state with
 * `skipped: true`. Every request of a cycle is bounded by `SYNC_REQUEST_TIMEOUT_MS`, so a request the
 * network never answers cannot hold the lock (and skip every later cycle) indefinitely.
 */
export async function performSyncCycle(session: Session): Promise<{ groups: Group[]; skipped: boolean; status: SyncCycleStatus }> {
  const run = await withSyncLock(() => runSyncCycle(session));
  if (!run.ran) return { groups: (await getGroupsState()).available, skipped: true, status: 'busy' };
  return { ...run.value, skipped: false };
}

/**
 * How a cycle ended:
 *  - `synced`: pushed, pulled and merged;
 *  - `busy`: another cycle holds the sync lock, this one ran nothing;
 *  - `account-mismatch`: the local store belongs to another account (the popup has not switched it yet);
 *  - `identity-changed`: the client no longer holds this cycle's session (signed out, refresh failed);
 *  - `pull-failed`: the remote rows could not be read (request failed, or the pull ran out of time).
 * In every case but `synced` the local state was left as it was: nothing merged, nothing dropped.
 */
export type SyncCycleStatus = 'synced' | 'busy' | 'account-mismatch' | 'identity-changed' | 'pull-failed';

async function runSyncCycle(session: Session): Promise<{ groups: Group[]; status: SyncCycleStatus }> {
  const untouched = async (status: SyncCycleStatus) => ({ groups: (await getGroupsState()).available, status });
  const sendDeadline = cycleDeadline(); // shared by the push and the delete flush

  const before = await checkCycleIdentity(session);
  if (before !== 'ok') return untouched(before);

  // Ids that were already pending before this cycle's requests: only those can be confirmed
  // gone by this pull. An id added later may belong to an upsert still in flight.
  const pendingBefore = await getPendingGroupDeletes();
  await pushPending(session, sendDeadline);
  await flushPendingDeletes(session, sendDeadline);
  // The pull gets its OWN budget: on a shared one, a push backlog that used it up meant no pull at
  // all, and a backlog only the merge can resolve (compare-and-swap failures after another device
  // re-uploaded everything) would then never be resolved.
  const snapshot = await fetchRemoteGroups(session, cycleDeadline());
  if (!snapshot) return untouched('pull-failed');

  // The pull may have been answered for a DIFFERENT identity than the one this cycle started with
  // (signed out or refresh failed in between = anon = zero rows). Absence in a successful answer
  // only means "deleted" when the answer was given to the expected user: otherwise merge nothing.
  const after = await checkCycleIdentity(session);
  if (after !== 'ok') return untouched(after);

  let merged: Group[] = [];
  let droppedRemotely: string[] = [];
  let foreign = false;
  let conflicts: string[] = [];
  const legacy = !(await getSetting(REMOTE_BASE_SEEDED_KEY, false));
  await updateGroupsState((fresh, { pendingDeletes, signedInUserId }) => {
    // The account may have switched (and the store been wiped) while the requests were in flight:
    // never merge another account's rows into it.
    if (signedInUserId && signedInUserId !== session.user.id) {
      merged = fresh.available;
      return null;
    }
    const result = mergeRemoteGroups(snapshot.groups, fresh.available, pendingDeletes, snapshot.ids, legacy, snapshot.plaintextIds);
    droppedRemotely = result.toDelete;
    conflicts = result.conflicts;
    foreign = result.toSave.length > 0 || result.toDelete.length > 0 || result.copies.length > 0;
    const localIndex = new Map(fresh.available.map((g, i) => [g.id, i]));
    const localById = new Map(fresh.available.map((g) => [g.id, g]));
    // A group that moved to exactly its remote position is already in sync there: claim it so
    // adopting another device's order does not make this device push the same positions back.
    const ordered = orderByPosition(result.merged, fresh.available, snapshot).map((g, i) => {
      const local = localById.get(g.id);
      const claimsSynced = localIndex.get(g.id) !== i && snapshot.positions.get(g.id) === i && !local?.pendingSync && !local?.positionDirty;
      if (claimsSynced) return { ...g, positionDirty: false };
      // A remote row with no valid position (written before position sync existed) must receive
      // this device's order: flag it so the next push sends 1..n instead of leaving the server at 0.
      const needsPosition = !g.permanent && snapshot.ids.has(g.id) && !snapshot.positions.has(g.id) && !local?.pendingSync && !local?.positionDirty;
      return needsPosition ? { ...g, positionDirty: true } : g;
    });
    // Conflict copies go right after the group they came from (the position derivation does the rest).
    let withCopies = ordered;
    for (const { group, afterId } of result.copies) {
      const at = withCopies.findIndex((g) => g.id === afterId);
      withCopies = at === -1 ? [...withCopies, group] : [...withCopies.slice(0, at + 1), group, ...withCopies.slice(at + 1)];
    }
    const changed = withCopies.length !== fresh.available.length || withCopies.some((g, i) => g !== fresh.available[i]);
    merged = changed ? withCopies : fresh.available;
    // Nothing to apply (the usual 30 s poll): no write, no broadcast to the other contexts.
    return changed ? { ...fresh, available: withCopies } : null;
  }, { readPendingDeletes: true, readSignedInUser: true });

  // Confirmed gone on the server -> stop tracking. Groups dropped because the server deleted
  // them are gone remotely too; the write above recorded them as pending, so clear them.
  await removePendingGroupDeletes([...pendingBefore.filter((id) => !snapshot.ids.has(id)), ...droppedRemotely]);
  // From now on a pending group without a base is a new group, not a pre-upgrade one.
  // ...but only once no pending group is left unseeded (e.g. its row is encrypted-but-locked, so
  // it was in the pull's ids but could not be adopted): those must keep probing.
  const unseeded = merged.some((g) => g.pendingSync && !g.permanent && !g.remoteUpdatedAt && snapshot.ids.has(g.id));
  if (legacy && !unseeded) await setSetting(REMOTE_BASE_SEEDED_KEY, true);
  if (foreign) emitForeignGroupsChange();
  if (conflicts.length > 0) emitSyncConflict(conflicts);
  return { groups: merged, status: 'synced' };
}

/**
 * Opens a Supabase Realtime channel for the user's groups table and calls `onUpdate` whenever
 * another device pushes a change that was APPLIED locally. An update is applied through
 * `updateGroupsState`: last-write-wins is checked against the fresh local group BEFORE anything
 * is written, so an older remote row can never overwrite a newer (or unpushed) local edit.
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
        // pending-delete safety logic as performSync: skip if this device's own
        // delete is already in flight for the id (avoids a redundant/racy second delete), and
        // never touch the permanent "Now Open" group (it never has a matching remote row anyway).
        if (payload.eventType === 'DELETE') {
          const deletedRow = payload.old as Record<string, unknown> | undefined;
          const deletedId = deletedRow?.id as string | undefined;
          if (!deletedId) return;
          // Through the queue like every other groups write. Skipped: ids this device is deleting
          // itself, and any local copy with an unpushed change, including one an undo just
          // restored (so a late echo of our own earlier delete cannot remove the restored group).
          let removed: Group | undefined;
          await updateGroupsState((fresh, { pendingDeletes }) => {
            if (pendingDeletes.has(deletedId)) return null;
            const local = fresh.available.find((g) => g.id === deletedId);
            if (!local || local.permanent || local.pendingSync) return null;
            removed = local;
            return { ...fresh, available: fresh.available.filter((g) => g.id !== deletedId) };
          }, { readPendingDeletes: true });
          if (removed) {
            await removePendingGroupDeletes([deletedId]); // gone remotely: nothing to retry
            emitForeignGroupsChange();
            onUpdate(removed); // let the popup refresh its cache
          }
          return;
        }
        const row = payload.new as Record<string, unknown>;
        const group = await rowToGroup(row, () => void reportUndecryptableRows());
        if (!group) return; // encrypted and unreadable here (locked / another key) — skip; a later pull picks it up once readable

        let applied = false;
        await updateGroupsState((fresh, { pendingDeletes }) => {
          if (pendingDeletes.has(group.id)) return null; // this device is deleting it
          const idx = fresh.available.findIndex((g) => g.id === group.id);
          if (idx !== -1) {
            const local = fresh.available[idx];
            // An unpushed local edit is resolved by the next merge, never here. The server stamp decides
            // the rest: the echo of our own push carries the base we just stored, so it is ignored.
            if (local.permanent || local.pendingSync) return null;
            if (local.remoteUpdatedAt ? compareStamps(group.remoteUpdatedAt!, local.remoteUpdatedAt) <= 0 : group.updatedAt <= local.updatedAt) return null;
          }
          applied = true;
          const available = [...fresh.available];
          if (idx === -1) {
            // New from another device: its author position stands, so do not flag the end index
            // this device gave it (that would push it back over the author's position).
            const authored = typeof row.position === 'number' && row.position >= 1;
            available.push(authored ? { ...group, positionDirty: false } : group);
          } else available[idx] = group;
          return { ...fresh, available };
        }, { readPendingDeletes: true });
        if (applied) {
          emitForeignGroupsChange();
          onUpdate(group);
        }
      }
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
