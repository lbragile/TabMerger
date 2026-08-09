import {
  KDF_ITERATIONS,
  deriveWrappingKey,
  generateDataKey,
  wrapDataKey,
  unwrapDataKey
} from '@tabmerger/shared';
import { supabase } from './supabase';
import { setSetting, markAllGroupsPendingSync } from './localDb';

export const ENCRYPTION_MIGRATION_DONE_KEY = 'encryptionMigrationDone';

// Module-scope fast path for the lifetime of this JS context (background worker
// or popup). Also mirrored into chrome.storage.session (memory-only, cleared on
// browser restart, never written to disk) scoped per-user-id below so a torn-down
// popup can re-read it without forcing the user to re-enter their passphrase —
// `chrome.storage.session` supports storing live CryptoKey objects directly via
// structured clone (confirmed against Chrome's own extension samples), so the
// non-extractable key itself is cached, never an exported/leakable form of it.
let cachedDataKey: CryptoKey | null = null;

function sessionKeyFor(userId: string): string {
  return `dataKey_${userId}`;
}

async function cacheDataKey(dataKey: CryptoKey, userId: string): Promise<void> {
  cachedDataKey = dataKey;
  await chrome.storage.session.set({ [sessionKeyFor(userId)]: dataKey });
}

/** Clears the cached data key (module + session storage) for a specific user — call on sign-out. */
export async function clearCachedDataKey(userId: string): Promise<void> {
  cachedDataKey = null;
  await chrome.storage.session.remove(sessionKeyFor(userId));
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
    const dataKey = await unwrapDataKey(row.wrapped_key as string, row.wrap_iv as string, wrappingKey);
    await cacheDataKey(dataKey, session.user.id);
    return true;
  } catch {
    // wrong passphrase — unwrap's GCM auth tag check fails
    return false;
  }
}

/**
 * Returns the cached unwrapped data key, or null if never unlocked / locked.
 * Checks the module-scope fast path first, then falls back to `chrome.storage.session`
 * (survives popup teardown within the same browser session — see cacheDataKey above).
 * Async because the storage.session read and the session-user lookup are both async.
 */
export async function getDataKey(): Promise<CryptoKey | null> {
  if (cachedDataKey) return cachedDataKey;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const key = sessionKeyFor(session.user.id);
  const stored = (await chrome.storage.session.get(key)) as Record<string, CryptoKey | undefined>;
  const dataKey = stored[key] ?? null;
  if (dataKey) cachedDataKey = dataKey;
  return dataKey;
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
