import {
  KDF_ITERATIONS,
  deriveWrappingKey,
  generateDataKey,
  wrapDataKey,
  unwrapDataKey,
  exportKeyToBase64,
  importKeyFromBase64
} from '@tabmerger/shared';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { setSetting, markAllGroupsPendingSync } from './localDb';
import { syncRequestSignal } from './syncRequest';
import { ENCRYPTION_MIGRATION_DONE_KEY, SESSIONS_MIGRATION_DONE_KEY } from './syncSettingKeys';

export { ENCRYPTION_MIGRATION_DONE_KEY };
// ponytail: separate flag from ENCRYPTION_MIGRATION_DONE_KEY — an account could have
// already flipped that flag before sessions existed/were touched, which would skip this
// self-heal if it piggybacked on the same key. Defined in syncSettingKeys.ts (see its doc).
export { SESSIONS_MIGRATION_DONE_KEY };

// Module-scope fast path for the lifetime of this JS context (background worker
// or popup). Also persisted to `chrome.storage.local` (disk, survives popup teardown
// AND full browser restart) scoped per-user-id below so unlock is truly one-time —
// deliberate product/security tradeoff, see learnings_persistent_unlock_local_storage.md
// (supersedes the earlier chrome.storage.session-based approach in
// learnings_encryption_locked_sync_silent_gap.md). `chrome.storage.local` JSON-serializes
// values, so it CANNOT hold a live CryptoKey object the way `chrome.storage.session` could
// (confirmed: storage.session uses structured clone, storage.local does not) — the key is
// exported to raw base64 (requires `extractable: true`, see unlockEncryption below) before
// storing, then re-imported non-extractable on read.
// The cache remembers WHOSE key it holds: a popup or service worker can outlive a sign-out, and the
// next account must never be handed (and encrypt its uploads with) the previous account's key.
// It also remembers WHICH persisted value it was built from (`stored`): the cache is per JS context,
// while the persisted entry is shared by all of them. Another context can drop or replace that
// entry (stale key, reset, re-unlock), so `getDataKey` hands the cached key out only while storage
// still holds that same value.
let cachedDataKey: { userId: string; key: CryptoKey; stored: string } | null = null;

function localKeyFor(userId: string): string {
  return `dataKey_${userId}`;
}

/**
 * What the persisted data key is BOUND to, stored beside it (`dataKeyRow_<userId>`).
 *
 * A data key is only valid for the `encryption_keys` row it was unwrapped from. A passphrase reset
 * on another device replaces that row (new key), and this device's persisted key then encrypts
 * uploads nobody else can read and fails to decrypt everything written since. So the key carries
 * the fingerprint of its row, and every key-state check compares it with the row the server has now.
 *  - `verified`: the key came out of a setup/unlock against that row on this device;
 *  - not verified: a key persisted by a version without bindings ADOPTED the current row on its
 *    first check (no re-unlock forced). It may still be a stale key, so a row that fails to
 *    decrypt drops it (see {@link reportUndecryptableRows}); a verified key is never dropped for that.
 *  - `repush`: the key was dropped as stale; the next successful unlock re-uploads this device's
 *    copies under the current key.
 */
interface KeyBinding {
  fingerprint?: string;
  verified?: boolean;
  repush?: boolean;
}

function bindingKeyFor(userId: string): string {
  return `dataKeyRow_${userId}`;
}

/** Identifies one `encryption_keys` row: salt and wrap IV are random per setup. Undefined if the row lacks them. */
function keyRowFingerprint(row: { salt?: unknown; wrap_iv?: unknown } | null | undefined): string | undefined {
  return typeof row?.salt === 'string' && typeof row?.wrap_iv === 'string' ? `${row.salt}.${row.wrap_iv}` : undefined;
}

async function readStored<T>(key: string): Promise<T | undefined> {
  return ((await chrome.storage.local.get(key)) as Record<string, T | undefined>)[key];
}

async function cacheDataKey(dataKey: CryptoKey, userId: string, fingerprint: string | undefined): Promise<void> {
  const b64 = await exportKeyToBase64(dataKey);
  await chrome.storage.local.set({
    [localKeyFor(userId)]: b64,
    [bindingKeyFor(userId)]: { fingerprint, verified: true } satisfies KeyBinding
  });
  cachedDataKey = { userId, key: dataKey, stored: b64 };
}

/** Clears the cached data key (module + persisted local storage) for a specific user — call on sign-out. */
export async function clearCachedDataKey(userId: string): Promise<void> {
  cachedDataKey = null;
  await chrome.storage.local.remove(localKeyFor(userId));
  await chrome.storage.local.remove(bindingKeyFor(userId));
}

/**
 * Drops a key that no longer belongs to the account's key row. The device is then `locked`: nothing
 * is uploaded, the unlock prompt appears, and the re-unlock re-uploads this device's copies.
 */
async function dropStaleDataKey(userId: string): Promise<void> {
  if (cachedDataKey?.userId === userId) cachedDataKey = null;
  await chrome.storage.local.remove(localKeyFor(userId));
  await chrome.storage.local.set({ [bindingKeyFor(userId)]: { repush: true } satisfies KeyBinding });
}

/** Compares the persisted key's binding with the key row the server has NOW (see {@link KeyBinding}). */
async function reconcileKeyBinding(userId: string, fingerprint: string | undefined): Promise<void> {
  if (!fingerprint) return; // nothing to compare with: never drop a key on missing information
  if (!(await readStored<string>(localKeyFor(userId)))) return; // no key on this device
  const binding = await readStored<KeyBinding>(bindingKeyFor(userId));
  if (!binding?.fingerprint) {
    await chrome.storage.local.set({ [bindingKeyFor(userId)]: { fingerprint, verified: false } satisfies KeyBinding });
  } else if (binding.fingerprint !== fingerprint) {
    console.warn('[TabMerger] The account encryption key was replaced on another device; this device must unlock again');
    await dropStaleDataKey(userId);
  }
}

/**
 * Called by a reader that met rows it could not decrypt. Rows left over from an OLDER key are normal
 * after a reset and are simply skipped; but if this device's key was never verified against the
 * server's key row (see {@link KeyBinding}), the key itself may be the stale one, so it is dropped
 * and the user is asked for the passphrase once.
 */
export async function reportUndecryptableRows(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const userId = session.user.id;
    if (!(await readStored<string>(localKeyFor(userId)))) return;
    const binding = await readStored<KeyBinding>(bindingKeyFor(userId));
    if (binding?.verified !== true) await dropStaleDataKey(userId);
  } catch {
    // best effort: the rows stay skipped either way
  }
}

function bufToBase64(buf: Uint8Array): string {
  let binary = '';
  for (const byte of buf) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBuf(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const UNIQUE_VIOLATION = '23505';

/** Shown when setup is attempted for an account that already has a key (see {@link setupEncryption}). */
export const ENCRYPTION_ALREADY_SET_UP_MESSAGE =
  'Encryption is already set up for this account. Enter your existing passphrase to unlock it.';

/**
 * First-time enable: generates a data key, wraps it with a passphrase-derived key, and uploads it.
 *
 * INSERT, never upsert: `encryption_keys.user_id` is the primary key, so the server refuses a
 * second key for an account that already has one. Replacing the row would make everything
 * already encrypted under the old key unreadable forever, and the only caller that may do that
 * on purpose ({@link resetEncryption}) deletes the row first.
 */
export async function setupEncryption(passphrase: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Must be signed in to enable encryption');

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const dataKey = await generateDataKey();
  const wrappingKey = await deriveWrappingKey(passphrase, salt, KDF_ITERATIONS);
  const { wrappedKey, iv } = await wrapDataKey(dataKey, wrappingKey);

  const { error } = await supabase.from('encryption_keys').insert({
    user_id: session.user.id,
    wrapped_key: wrappedKey,
    salt: bufToBase64(salt),
    kdf_iterations: KDF_ITERATIONS,
    wrap_iv: iv
  });
  if (error) {
    throw new Error((error as { code?: string }).code === UNIQUE_VIOLATION ? ENCRYPTION_ALREADY_SET_UP_MESSAGE : error.message);
  }

  await cacheDataKey(dataKey, session.user.id, keyRowFingerprint({ salt: bufToBase64(salt), wrap_iv: iv }));
  // Existing groups were already pushed as plaintext before setup — mark them dirty so
  // the next sync pass re-uploads them encrypted instead of leaving old plaintext rows in place.
  await markAllGroupsPendingSync();
  // Mark the self-heal migration done too — otherwise doSync's own migration check would
  // redundantly re-mark everything pending again on the very next sync (harmless, just wasteful).
  await setSetting(ENCRYPTION_MIGRATION_DONE_KEY, true);
  // Sessions saved before setup were never uploaded (nothing is sent without a key): re-arm their
  // self-heal so the next sync uploads them all, encrypted.
  await setSetting(SESSIONS_MIGRATION_DONE_KEY, false);
}

/**
 * Outcome of {@link unlockEncryption}:
 *  - `unlocked`: the passphrase unwrapped the key, which is now cached on this device;
 *  - `wrong-passphrase`: the key row was read and the passphrase does not unwrap it;
 *  - `no-key`: the server answered that the account has no key (e.g. reset from another device);
 *  - `unavailable`: the key row could not be read (offline, timeout, 401, 5xx, signed out). This says
 *    NOTHING about the passphrase and must never be shown as "wrong passphrase".
 */
export type UnlockResult = 'unlocked' | 'wrong-passphrase' | 'no-key' | 'unavailable';

/** Returning session / new device: re-derives the wrapping key and unwraps the stored data key. Never throws: a wrong passphrase is an expected user-facing case, see {@link UnlockResult}. */
export async function unlockEncryption(passphrase: string): Promise<UnlockResult> {
  let session: Session | null;
  let row: Record<string, unknown> | null;
  try {
    ({ data: { session } } = await supabase.auth.getSession());
    if (!session) return 'unavailable';

    const { data, error } = await supabase
      .from('encryption_keys')
      .select('*')
      .eq('user_id', session.user.id)
      .abortSignal(syncRequestSignal())
      .maybeSingle();
    if (error) return 'unavailable';
    row = data as Record<string, unknown> | null;
  } catch {
    return 'unavailable';
  }
  if (!row) return 'no-key';

  try {
    const salt = base64ToBuf(row.salt as string);
    const wrappingKey = await deriveWrappingKey(passphrase, salt, row.kdf_iterations as number);
    // extractable: true — cacheDataKey needs to export this key to base64 to persist it in
    // chrome.storage.local (see module comment above); it's never exported again after that.
    const dataKey = await unwrapDataKey(row.wrapped_key as string, row.wrap_iv as string, wrappingKey, true);
    const repush = (await readStored<KeyBinding>(bindingKeyFor(session.user.id)))?.repush === true;
    await cacheDataKey(dataKey, session.user.id, keyRowFingerprint(row));
    if (repush) {
      // This device's previous key was dropped as stale (the account key was replaced elsewhere):
      // what it holds locally may exist on the server only under the dead key, or not at all. Mark
      // everything for upload so it is stored again under the current key.
      await markAllGroupsPendingSync();
      await setSetting(SESSIONS_MIGRATION_DONE_KEY, false);
    }
    return 'unlocked';
  } catch {
    // wrong passphrase — unwrap's GCM auth tag check fails
    return 'wrong-passphrase';
  }
}

/**
 * Returns the SIGNED-IN account's unwrapped data key, or null if never unlocked this profile / signed out.
 * `chrome.storage.local` (persists to disk, survives popup teardown AND full browser restart — see
 * cacheDataKey above) is the truth every context shares, so it is read on every call; the module
 * cache only saves re-importing a value that is still the persisted one. A key another context
 * dropped is therefore null here too, and one it replaced is re-imported.
 * Async because the storage.local read and the session-user lookup are both async.
 */
export async function getDataKey(): Promise<CryptoKey | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const userId = session.user.id;

  const b64 = await readStored<string>(localKeyFor(userId));
  if (cachedDataKey?.userId === userId) {
    if (cachedDataKey.stored === b64) return cachedDataKey.key;
    cachedDataKey = null; // dropped or replaced in another context
  }
  if (!b64) return null;
  const dataKey = await importKeyFromBase64(b64);
  cachedDataKey = { userId, key: dataKey, stored: b64 };
  return dataKey;
}

/**
 * Deletes the current user's `encryption_keys` row and clears the locally cached data key,
 * forcing them back into first-time setup with a brand new passphrase. Used for the
 * self-serve "forgot my passphrase" flow — irreversibly abandons access to anything encrypted
 * under the old key (existing `groups`/`sessions`/`device_sessions` rows are left as-is; they
 * get re-encrypted and re-uploaded once the user completes `setupEncryption` again, same as
 * the plaintext-migration path already inside `setupEncryption`).
 */
export async function resetEncryption(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Must be signed in to reset encryption');

  const { error } = await supabase.from('encryption_keys').delete().eq('user_id', session.user.id);
  if (error) throw new Error(error.message);

  await clearCachedDataKey(session.user.id);
  // Re-arm the sessions self-heal (see useSync.ts) so pre-existing local sessions that were
  // already migrated under the OLD key get re-pushed encrypted under the new one once
  // setupEncryption() completes again — otherwise this flag being already `true` from before
  // the reset would skip that self-heal forever, leaving those sessions stuck local-only.
  await setSetting(SESSIONS_MIGRATION_DONE_KEY, false);
}

/**
 * Whether the signed-in account has an `encryption_keys` row:
 *  - `present`: the server returned the row (setup was completed on some device);
 *  - `absent`: the server ANSWERED that there is none (or nobody is signed in);
 *  - `unknown`: the check itself failed (offline, timeout, 401 from a stale token, 5xx).
 *
 * `unknown` is never "no key". Callers must not offer first-time setup on it (a user who already
 * has a key would be invited to create a second one) and must not upload content (it would go up
 * as plaintext); they skip and try again later.
 */
export type EncryptionKeyState = 'present' | 'absent' | 'unknown';

/**
 * Whether the currently signed-in account has completed the one-time encryption setup (an
 * `encryption_keys` row exists for THIS user) — distinct from whether the data key is
 * unlocked *this session*, which is `getDataKey() !== null`. Encryption is on-by-default for
 * everyone now (no opt-out), so "enabled or not" is no longer a meaningful question — only
 * "set up yet" and "unlocked". See {@link EncryptionKeyState} for the three answers.
 *
 * Side effect on `present`: drops a persisted data key that is bound to a different key row (see
 * `KeyBinding`), so callers must check the state BEFORE asking for the key.
 *
 * Queries Supabase directly rather than caching a local flag — a per-account boolean stored
 * under an unscoped local settings key previously went stale the moment a second Supabase
 * account signed into the same browser profile (it kept reading the FIRST account's "true"),
 * which made every subsequent account's sync look "locked" instead of "needs setup" forever.
 * See docs: extension-dev learnings on unscoped local flags in multi-account contexts.
 */
export async function getEncryptionKeyState(): Promise<EncryptionKeyState> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return 'absent';

    const { data, error } = await supabase
      .from('encryption_keys')
      .select('user_id, salt, wrap_iv')
      .eq('user_id', session.user.id)
      .abortSignal(syncRequestSignal())
      .maybeSingle();
    if (error) return 'unknown';
    if (!data) return 'absent';
    // This is the one place that reads the server's key row, so it is also where a persisted key
    // that belongs to a REPLACED row is detected and dropped. Every gate checks the state first and
    // asks for the key second (getContentUploadKey, useSync's doSync, the worker's SYNC_NOW), so a
    // stale key reads as `locked` there: no upload, unlock prompt.
    await reconcileKeyBinding(session.user.id, keyRowFingerprint(data as { salt?: unknown; wrap_iv?: unknown }));
    return 'present';
  } catch {
    return 'unknown';
  }
}
