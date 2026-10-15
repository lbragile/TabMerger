import { encryptBlob } from '@tabmerger/shared';
import type { Session } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { getContentUploadKey, UPLOAD_BLOCKED_MESSAGE } from '@/lib/contentUploadKey';
import { canUploadOnFirefox } from '@/lib/syncEngine';
import { syncRequestSignal } from '@/lib/syncRequest';

/** Whether the client's CURRENT session belongs to `userId`. A failed read counts as "no". */
export async function isSignedInAs(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id === userId;
  } catch {
    return false;
  }
}

/** What goes inside a session's ciphertext. Only the literal `true` is ever written for `auto`; a manual session's blob has no `auto` key at all. */
const sessionContent = (session: Session) => ({
  name: session.name,
  groups: session.groups,
  description: session.description,
  ...(session.auto === true ? { auto: true } : {})
});

/**
 * Upserts a single local session to Supabase with `{name, groups, description, auto}` ENCRYPTED
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
  if (!(await isSignedInAs(expectedUserId))) return false;
  if (!(await canUploadOnFirefox())) return false; // see syncEngine.ts's canUploadOnFirefox doc comment

  const gate = await getContentUploadKey(expectedUserId);
  if (!gate.key) {
    console.warn(`[TabMerger] Session ${session.id} not uploaded: ${UPLOAD_BLOCKED_MESSAGE[gate.reason]}`);
    return false;
  }
  // Checked again after the lookup: everything from here to the request is for the expected account.
  if (!(await isSignedInAs(expectedUserId))) return false;
  const { iv, ct } = await encryptBlob(gate.key, sessionContent(session));

  const { error } = await supabase
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
    return false;
  }
  return true;
}

/**
 * For a session this device already confirmed on the server (an automatic backup with
 * `uploadedAt`): writes its content again, but NEVER creates the row. If the server no longer
 * has it, it was deleted somewhere else (the web dashboard), which removes the CLOUD copy only:
 * this resolves `gone`, nothing is uploaded, and the caller keeps the local backup. Used by the
 * sessions self-heal, which otherwise re-uploads everything after an encryption reset.
 *
 * `gone` is only answered when a read of the row succeeded, returned nothing, AND the client was
 * still signed in as `expectedUserId` afterwards: a signed-out or swapped client also sees "no
 * row" (RLS). `updated` is only answered when the server reports exactly ONE row written: an
 * UPDATE that matched nothing (the row was deleted after the read, or the server refused the
 * write without an error) is not a success. Everything else is `failed` (try later).
 */
export async function refreshUploadedSession(session: Session, expectedUserId: string): Promise<'updated' | 'gone' | 'failed'> {
  try {
    if (!(await isSignedInAs(expectedUserId))) return 'failed';
    if (!(await canUploadOnFirefox())) return 'failed';
    const gate = await getContentUploadKey(expectedUserId);
    if (!gate.key) return 'failed';
    const { data: row, error: readError } = await supabase
      .from('sessions')
      .select('id')
      .eq('id', session.id)
      .eq('user_id', expectedUserId)
      .abortSignal(syncRequestSignal())
      .maybeSingle();
    if (readError) return 'failed';
    if (!(await isSignedInAs(expectedUserId))) return 'failed';
    if (!row) return 'gone';
    const { iv, ct } = await encryptBlob(gate.key, sessionContent(session));
    // UPDATE, not upsert: a row deleted between the read above and here stays deleted.
    const { data: written, error } = await supabase
      .from('sessions')
      .update({ groups: { v: 1, iv, ct } })
      .eq('id', session.id)
      .eq('user_id', expectedUserId)
      .select('id')
      .abortSignal(syncRequestSignal());
    if (error || !Array.isArray(written) || written.length !== 1) return 'failed';
    return 'updated';
  } catch (e) {
    console.warn('[TabMerger] Session refresh failed', session.id, e);
    return 'failed';
  }
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
