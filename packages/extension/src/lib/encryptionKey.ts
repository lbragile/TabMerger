import {
  KDF_ITERATIONS,
  deriveWrappingKey,
  generateDataKey,
  wrapDataKey,
  unwrapDataKey,
  exportKeyToBase64,
  importKeyFromBase64
} from '@tabmerger/shared';
import { supabase } from './supabase';
import { setSetting, markAllGroupsPendingSync } from './localDb';

export const ENCRYPTION_MIGRATION_DONE_KEY = 'encryptionMigrationDone';
// ponytail: separate flag from ENCRYPTION_MIGRATION_DONE_KEY — an account could have
// already flipped that flag before sessions existed/were touched, which would skip this
// self-heal if it piggybacked on the same key.
export const SESSIONS_MIGRATION_DONE_KEY = 'sessionsEncryptionMigrationDone';

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
let cachedDataKey: CryptoKey | null = null;

function localKeyFor(userId: string): string {
  return `dataKey_${userId}`;
}

async function cacheDataKey(dataKey: CryptoKey, userId: string): Promise<void> {
  cachedDataKey = dataKey;
  const b64 = await exportKeyToBase64(dataKey);
  await chrome.storage.local.set({ [localKeyFor(userId)]: b64 });
}

/** Clears the cached data key (module + persisted local storage) for a specific user — call on sign-out. */
export async function clearCachedDataKey(userId: string): Promise<void> {
  cachedDataKey = null;
  await chrome.storage.local.remove(localKeyFor(userId));
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

/** First-time enable: generates a data key, wraps it with a passphrase-derived key, and uploads it. */
export async function setupEncryption(passphrase: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Must be signed in to enable encryption');

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const dataKey = await generateDataKey();
  const wrappingKey = await deriveWrappingKey(passphrase, salt, KDF_ITERATIONS);
  const { wrappedKey, iv } = await wrapDataKey(dataKey, wrappingKey);

  const { error } = await supabase.from('encryption_keys').upsert({
    user_id: session.user.id,
    wrapped_key: wrappedKey,
    salt: bufToBase64(salt),
    kdf_iterations: KDF_ITERATIONS,
    wrap_iv: iv
  });
  if (error) throw new Error(error.message);

  await cacheDataKey(dataKey, session.user.id);
  // Existing groups were already pushed as plaintext before setup — mark them dirty so
  // the next sync pass re-uploads them encrypted instead of leaving old plaintext rows in place.
  await markAllGroupsPendingSync();
  // Mark the self-heal migration done too — otherwise doSync's own migration check would
  // redundantly re-mark everything pending again on the very next sync (harmless, just wasteful).
  await setSetting(ENCRYPTION_MIGRATION_DONE_KEY, true);
}

/** Returning session / new device: re-derives the wrapping key and unwraps the stored data key. Returns false (not a throw) on wrong passphrase — an expected user-facing case. */
export async function unlockEncryption(passphrase: string): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;

  const { data: row, error } = await supabase
    .from('encryption_keys')
    .select('*')
    .eq('user_id', session.user.id)
    .maybeSingle();
  if (error || !row) return false;

  try {
    const salt = base64ToBuf(row.salt as string);
    const wrappingKey = await deriveWrappingKey(passphrase, salt, row.kdf_iterations as number);
    // extractable: true — cacheDataKey needs to export this key to base64 to persist it in
    // chrome.storage.local (see module comment above); it's never exported again after that.
    const dataKey = await unwrapDataKey(row.wrapped_key as string, row.wrap_iv as string, wrappingKey, true);
    await cacheDataKey(dataKey, session.user.id);
    return true;
  } catch {
    // wrong passphrase — unwrap's GCM auth tag check fails
    return false;
  }
}

/**
 * Returns the cached unwrapped data key, or null if never unlocked this profile / signed out.
 * Checks the module-scope fast path first, then falls back to `chrome.storage.local`
 * (persists to disk, survives popup teardown AND full browser restart — see cacheDataKey
 * above). Async because the storage.local read and the session-user lookup are both async.
 */
export async function getDataKey(): Promise<CryptoKey | null> {
  if (cachedDataKey) return cachedDataKey;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const key = localKeyFor(session.user.id);
  const stored = (await chrome.storage.local.get(key)) as Record<string, string | undefined>;
  const b64 = stored[key];
  if (!b64) return null;
  const dataKey = await importKeyFromBase64(b64);
  cachedDataKey = dataKey;
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
 * Whether the currently signed-in account has completed the one-time encryption setup (an
 * `encryption_keys` row exists for THIS user) — distinct from whether the data key is
 * unlocked *this session*, which is `getDataKey() !== null`. Encryption is on-by-default for
 * everyone now (no opt-out), so "enabled or not" is no longer a meaningful question — only
 * "set up yet" and "unlocked".
 *
 * Queries Supabase directly rather than caching a local flag — a per-account boolean stored
 * under an unscoped local settings key previously went stale the moment a second Supabase
 * account signed into the same browser profile (it kept reading the FIRST account's "true"),
 * which made every subsequent account's sync look "locked" instead of "needs setup" forever.
 * See docs: extension-dev learnings on unscoped local flags in multi-account contexts.
 */
export async function hasEncryptionKey(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;

  const { data, error } = await supabase
    .from('encryption_keys')
    .select('user_id')
    .eq('user_id', session.user.id)
    .maybeSingle();
  return !error && !!data;
}
