import { encryptBlob } from '@tabmerger/shared';
import type { Session } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { getContentUploadKey, UPLOAD_BLOCKED_MESSAGE } from '@/lib/contentUploadKey';
import { canUploadOnFirefox } from '@/lib/syncEngine';
import { syncRequestSignal } from '@/lib/syncRequest';
import { validSessionColor } from '@/lib/sessionColor';
import { commitSessions, getSession, markSessionUploaded, wasSessionDeletedHere } from '@/lib/localDb';
import { AUTO_BACKUP_PENDING_DELETES_KEY } from '@/lib/syncSettingKeys';

/** Whether the client's CURRENT session belongs to `userId`. A failed read counts as "no". */
export async function isSignedInAs(userId: string): Promise<boolean> {
  return (await signedInToken(userId)) !== null;
}

/**
 * The access token of the client's CURRENT session if it belongs to `userId`, else `null` (signed
 * out, someone else, or the read failed). Comparing it before and after a request tells whether the
 * request ran under ONE sign-in: a sign-out and sign-in as the same user in between swaps the token,
 * and a read made while signed out sees no row at all (RLS).
 */
async function signedInToken(userId: string): Promise<string | null> {
  if (!userId) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const current = data.session;
    if (current?.user.id !== userId) return null;
    return typeof current.access_token === 'string' ? current.access_token : '';
  } catch {
    return null;
  }
}

/**
 * What goes inside a session's ciphertext. Only the literal `true` is ever written for `auto`; a
 * manual session's blob has no `auto` key at all. `color` goes in only when it is one of the
 * palette's (never a plaintext column: the server cannot see a session's colour either).
 */
export const sessionContent = (session: Session) => {
  const color = validSessionColor(session.color);
  return {
    name: session.name,
    groups: session.groups,
    description: session.description,
    ...(session.auto === true ? { auto: true } : {}),
    ...(color ? { color } : {})
  };
};

/**
 * Upserts a single local session to Supabase with `{name, groups, description, auto, color}` ENCRYPTED
 * into the `groups` column (the plaintext `name`/`description` columns are sent blank, and the
 * automatic-backup marker exists only inside the ciphertext: the server cannot tell a backup from
 * a session the user saved). There is no plaintext branch: without an unlocked key (setup not
 * finished, status unknown, locked) nothing is sent. Resolves `true` only when the server accepted
 * the row; `false` when the upload was skipped or rejected, so callers can retry later. Shared by
 * `useSaveSession`'s explicit save action, `useSync`'s session self-heal and the background
 * worker's automatic backups, since sessions have no `pendingSync` flag or push loop of their own.
 *
 * `expectedUserId` is the account the caller read the session FOR (captured before its first
 * await). The signed-in account can change while a caller is running (the web app hands the
 * worker a new session, the popup signs out), and this function reads the session again: without
 * the check, account A's content would be encrypted with, and stored under, whoever is signed in
 * now. So nothing is sent unless the client's session is still that user, both before and after
 * the encryption key is read; the key lookup itself is told whose key is wanted and answers
 * "none" for anyone else (see `getContentUploadKey`); and the row is written with
 * `user_id: expectedUserId`: if the session changes after the last check, the request carries the
 * other account's token and RLS (`auth.uid() = user_id`) rejects it.
 *
 * The request is bounded by the sync request timeout, so a network that never answers cannot
 * hold up a sync cycle or a backup run.
 *
 * No React here: the background worker imports this module.
 */
export async function pushSessionToSupabase(session: Session, expectedUserId: string): Promise<boolean> {
  return (await uploadSessionRow(session, expectedUserId)).ok;
}

/**
 * What an upload wrote: on success, which key row it encrypted with (`Session.uploadedKey`), when
 * known. `rejected`: the server refused this row only (see {@link isRowRejection}).
 */
export type SessionRowWrite = { ok: true; keyFingerprint?: string } | { ok: false; rejected?: true };

/** {@link pushSessionToSupabase}, also telling which key the row was encrypted with. */
export async function uploadSessionRow(session: Session, expectedUserId: string): Promise<SessionRowWrite> {
  if (!(await isSignedInAs(expectedUserId))) return { ok: false };
  if (!(await canUploadOnFirefox())) return { ok: false }; // see syncEngine.ts's canUploadOnFirefox doc comment

  const gate = await getContentUploadKey(expectedUserId);
  if (!gate.key) {
    console.warn(`[TabMerger] Session ${session.id} not uploaded: ${UPLOAD_BLOCKED_MESSAGE[gate.reason]}`);
    return { ok: false };
  }
  // Checked again after the lookup: everything from here to the request is for the expected account.
  if (!(await isSignedInAs(expectedUserId))) return { ok: false };
  const written = await upsertSessionRow(session, expectedUserId, gate.key);
  if (written !== 'ok') return written === 'rejected' ? { ok: false, rejected: true } : { ok: false };
  return gate.keyFingerprint ? { ok: true, keyFingerprint: gate.keyFingerprint } : { ok: true };
}

/**
 * Whether a server error is about THIS row only (its content: too large, invalid, a constraint), so
 * the next session may well go through: HTTP 413, or a Postgres data / integrity / size class
 * (`22…`, `23…`, `54…`). Everything else (no network, a timeout, auth, RLS refusing the account, a
 * 5xx) would hit every row the same way. Unknown is "every row": the safe side for the retry delay.
 */
export function isRowRejection(error: { code?: unknown } | null | undefined, status?: number): boolean {
  if (!error) return false;
  if (status === 413) return true;
  const code = typeof error.code === 'string' ? error.code : '';
  return /^(22|23|54)/.test(code);
}

/** What one write of a row ended as: `rejected` = the server refused THIS row (see {@link isRowRejection}). */
type RowWrite = 'ok' | 'rejected' | 'failed';

/** The upsert itself (callers checked the account and the key). */
async function upsertSessionRow(session: Session, expectedUserId: string, key: CryptoKey): Promise<RowWrite> {
  const { iv, ct } = await encryptBlob(key, sessionContent(session));
  const { error, status } = await supabase
    .from('sessions')
    .upsert({
      id: session.id,
      user_id: expectedUserId,
      name: '',
      description: null,
      groups: { v: 1, iv, ct },
      created_at: new Date(session.createdAt).toISOString()
    })
    .abortSignal(syncRequestSignal());
  if (error) {
    console.warn('[TabMerger] Session sync to Supabase failed', session.id, error.message);
    return isRowRejection(error, status) ? 'rejected' : 'failed';
  }
  return 'ok';
}

/** What {@link refreshSessionRow} did. */
export type SessionRefreshOutcome =
  /** the server's row was updated */
  | 'updated'
  /** the row was gone, but the server's copy had been written under an older key: uploaded again */
  | 'reinserted'
  /** the row was deleted elsewhere (the dashboard, another device): nothing re-created */
  | 'gone'
  /** the server refused this row only (too large, invalid): other sessions may still go through */
  | 'rejected'
  /** not sent or not confirmed: try later */
  | 'failed';

/**
 * For a session this device already confirmed on the server (`uploadedAt`): writes its content
 * again, but NEVER creates the row, with one exception below. If the server no longer has it, it was
 * deleted somewhere else (the web dashboard), which removes the CLOUD copy only: this answers `gone`,
 * nothing is uploaded, and the caller keeps the local session.
 *
 * The exception (a saved session, never an automatic backup): the server's copy was written under
 * an OLDER key than this device's (`uploadedKey` differs from the current key's fingerprint). After
 * an encryption reset, the user sees those old-key rows as unreadable in the dashboard and may delete
 * them; that deleted the unreadable copy, not this readable one, so the session is uploaded again
 * (`reinserted`). An unknown upload key (sessions uploaded before it was recorded) is not a
 * difference: `gone`.
 *
 * `gone` is only answered when a read of the row succeeded, returned nothing, AND the client was
 * signed in as `expectedUserId` with the SAME access token before and after the read: a signed-out
 * client sees "no row" too (RLS), and so does a sign-out and sign-in as the same user that straddles
 * the read. `updated` is only answered when the server reports exactly ONE row written: an UPDATE
 * that matched nothing (the row was deleted after the read, or the server refused the write without
 * an error) is not a success. Everything else is `failed` (try later). On success, `keyFingerprint`
 * is the key the row is now under.
 */
export async function refreshSessionRow(session: Session, expectedUserId: string): Promise<{ outcome: SessionRefreshOutcome; keyFingerprint?: string }> {
  const failed = { outcome: 'failed' as const };
  try {
    if (!(await isSignedInAs(expectedUserId))) return failed;
    if (!(await canUploadOnFirefox())) return failed;
    const gate = await getContentUploadKey(expectedUserId);
    if (!gate.key) return failed;
    const tokenBefore = await signedInToken(expectedUserId);
    if (tokenBefore === null) return failed;
    const { data: row, error: readError } = await supabase
      .from('sessions')
      .select('id')
      .eq('id', session.id)
      .eq('user_id', expectedUserId)
      .abortSignal(syncRequestSignal())
      .maybeSingle();
    if (readError) return failed;
    // one sign-in for the whole read: a swapped token may have read nothing because of RLS
    if ((await signedInToken(expectedUserId)) !== tokenBefore) return failed;
    const keyFingerprint = gate.keyFingerprint;
    const withKey = <T extends SessionRefreshOutcome>(outcome: T) => (keyFingerprint ? { outcome, keyFingerprint } : { outcome });
    if (!row) {
      // Never after this device itself saw the row gone (`remoteGone`): that was a delete, whatever
      // key changed since. Known trade-off: a dashboard delete made BEFORE a reset that this device
      // never observed looks exactly like "cleared the unreadable old-key rows" and is re-inserted.
      const olderKey =
        session.auto !== true && session.remoteGone !== true && !!session.uploadedKey && !!keyFingerprint && session.uploadedKey !== keyFingerprint;
      // `keyFingerprint` comes with `gone` only when the current key was KNOWN at the read: only then
      // can the caller remember the row as deleted for good (Session.remoteGone)
      if (!olderKey) return withKey('gone');
      const reinserted = await upsertSessionRow(session, expectedUserId, gate.key);
      return reinserted === 'ok' ? withKey('reinserted') : reinserted === 'rejected' ? { outcome: 'rejected' } : failed;
    }
    const { iv, ct } = await encryptBlob(gate.key, sessionContent(session));
    // UPDATE, not upsert: a row deleted between the read above and here stays deleted.
    const { data: written, error, status } = await supabase
      .from('sessions')
      .update({ groups: { v: 1, iv, ct } })
      .eq('id', session.id)
      .eq('user_id', expectedUserId)
      .select('id')
      .abortSignal(syncRequestSignal());
    if (error && isRowRejection(error, status)) return { outcome: 'rejected' };
    if (error || !Array.isArray(written) || written.length !== 1) return failed;
    return withKey('updated');
  } catch (e) {
    console.warn('[TabMerger] Session refresh failed', session.id, e);
    return failed;
  }
}

/** {@link refreshSessionRow}'s outcome alone. */
export async function refreshUploadedSession(session: Session, expectedUserId: string): Promise<SessionRefreshOutcome> {
  return (await refreshSessionRow(session, expectedUserId)).outcome;
}

/**
 * Best-effort removal of sessions' server rows (the local rows are the caller's job). Only for
 * `expectedUserId` (see {@link pushSessionToSupabase}): if the client is signed out or signed in
 * as someone else, nothing is sent, and the request is scoped to that user id either way. Never
 * throws: a failed remote delete must not undo or block the local one. Resolves `false` when
 * something was not confirmed deleted.
 */
export async function deleteRemoteSessions(ids: string[], expectedUserId: string): Promise<boolean> {
  if (ids.length === 0) return true;
  try {
    if (!(await isSignedInAs(expectedUserId))) return false;
    const { error } = await supabase.from('sessions').delete().in('id', ids).eq('user_id', expectedUserId).abortSignal(syncRequestSignal());
    if (error) {
      console.warn('[TabMerger] Session delete sync to Supabase failed', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[TabMerger] Session delete sync to Supabase failed', e);
    return false;
  }
}

/**
 * One upload at a time per session id, in the order asked (this context only). Two quick colour
 * picks, or a pick and the sync's sessions pass, can otherwise land on the server in the wrong
 * order, and an upload still in flight can land after a delete of the same row.
 */
const uploadQueues = new Map<string, Promise<unknown>>();

/** Runs `task` after every earlier queued task for session `id` (whether it failed or not). */
export function queueSessionUpload<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = uploadQueues.get(id) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  uploadQueues.set(id, tail);
  void tail.then(() => {
    if (uploadQueues.get(id) === tail) uploadQueues.delete(id);
  });
  return run;
}

/**
 * Sessions the user deleted while this context ran (not a wipe: see uploadStoredSession). The
 * delete itself also records the id in IndexedDB for every OTHER context (`wasSessionDeletedHere`);
 * this set only covers the moment before that transaction commits.
 */
const deletedHere = new Set<string>();

/**
 * Records that the user deleted session `id` here, BEFORE the local delete. An upload of it that
 * was already in flight then deletes the row it re-created (see {@link uploadStoredSession}).
 */
export function noteSessionDeletedHere(id: string): void {
  deletedHere.add(id);
}

/**
 * After an upload that may have CREATED session `id`'s row (a first upload, a re-insert): if the
 * user deleted it meanwhile, here or in another popup (the id is remembered in IndexedDB in the
 * delete's own transaction), and it is not stored any more, its row is deleted again. A wipe
 * records no ids, so it never deletes anything in the account.
 */
export async function deleteRowIfDeletedHere(id: string, expectedUserId: string): Promise<void> {
  try {
    if (!deletedHere.has(id) && !(await wasSessionDeletedHere(id))) return;
    if (await getSession(id)) return;
    if (await deleteRemoteSessions([id], expectedUserId)) return;
    // Not confirmed (offline): remembered with the automatic backups' pending remote deletes, which
    // the next backup run or download sends again (and a download never brings such an id back).
    await commitSessions({ updateSettings: { [AUTO_BACKUP_PENDING_DELETES_KEY]: rememberPendingDelete(id) } });
  } catch (e) {
    console.warn('[TabMerger] Session delete after upload failed', id, e);
  }
}

/** `updateSettings` entry adding `id` to the pending remote deletes (the list is parsed and capped where it is read). */
const rememberPendingDelete =
  (id: string) =>
  (stored: unknown): string[] =>
    [...new Set([...(Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string') : []), id])];

/**
 * {@link deleteRemoteSessions} for sessions the user deleted here, queued behind any upload of
 * the same ids, so the delete always reaches the server after them.
 */
export async function deleteRemoteSessionsQueued(ids: string[], expectedUserId: string): Promise<boolean> {
  const results = await Promise.all(ids.map((id) => queueSessionUpload(id, () => deleteRemoteSessions([id], expectedUserId))));
  return results.every(Boolean);
}

/** What {@link uploadStoredSession} did. */
export type StoredSessionUploadResult =
  /** first upload (the row was inserted); the session is now stamped `uploadedAt` */
  | 'uploaded'
  /** an update of the row the server already had */
  | 'refreshed'
  /** the row was gone but held an older key's copy: uploaded again (see refreshSessionRow) */
  | 'reinserted'
  /** the server no longer has it (deleted in the dashboard or elsewhere): nothing re-inserted, the local copy stays */
  | 'gone-remote'
  /** no longer stored here: nothing sent */
  | 'gone-local'
  /** the server refused THIS row (too large, invalid): the mark stays; other sessions may go through */
  | 'rejected'
  /** not sent or not accepted: the `uploadPending` mark stays for a retry */
  | 'failed';

/**
 * Uploads session `id` AS STORED NOW (never a copy read earlier), queued per id
 * ({@link queueSessionUpload}). A session the server already has (`uploadedAt`) is only UPDATED
 * (`refreshUploadedSession`): one deleted in the dashboard or on another device is never
 * re-created by an edit here. A first upload stamps `uploadedAt`. Success clears the
 * `uploadPending` token the upload read (a later change keeps its own). If the user deleted the
 * session here while the request ran, the row it may have re-created is deleted again; a wipe
 * ("Clear all data", an account switch) also empties the store but must never delete anything in
 * the account, so only deletes recorded by {@link noteSessionDeletedHere} count.
 */
export function uploadStoredSession(id: string, expectedUserId: string): Promise<StoredSessionUploadResult> {
  return queueSessionUpload(id, async (): Promise<StoredSessionUploadResult> => {
    const stored = await getSession(id);
    if (!stored) return 'gone-local';
    let result: StoredSessionUploadResult;
    let keyFingerprint: string | undefined;
    try {
      if (typeof stored.uploadedAt === 'number') {
        const refreshed = await refreshSessionRow(stored, expectedUserId);
        keyFingerprint = refreshed.keyFingerprint;
        const byOutcome = { updated: 'refreshed', reinserted: 'reinserted', gone: 'gone-remote', rejected: 'rejected', failed: 'failed' } as const;
        result = byOutcome[refreshed.outcome];
      } else {
        const written = await uploadSessionRow(stored, expectedUserId);
        if (written.ok) keyFingerprint = written.keyFingerprint;
        result = written.ok ? 'uploaded' : written.rejected ? 'rejected' : 'failed';
      }
    } catch (e) {
      console.warn('[TabMerger] Session upload failed', id, e);
      result = 'failed';
    }
    if (result === 'failed' || result === 'rejected') return result;
    // on the row as stored NOW (if it still is): stamps a first upload, clears this upload's mark,
    // records the key the server's copy is under now (not after `gone`: nothing was written)
    await markSessionUploaded(
      id,
      typeof stored.uploadedAt === 'number' ? stored.uploadedAt : Date.now(),
      stored.uploadPending,
      result === 'gone-remote' ? undefined : keyFingerprint,
      // remembered as deleted for good only when the current key was known at the read; otherwise
      // the old behaviour (a marker set earlier stays, none is added)
      result === 'gone-remote' ? (keyFingerprint ? 'remote-gone' : 'keep') : 'written'
    );
    // a write that could have created the row: deleted again if the user deleted the session meanwhile
    if (result !== 'gone-remote') await deleteRowIfDeletedHere(id, expectedUserId);
    return result;
  });
}
