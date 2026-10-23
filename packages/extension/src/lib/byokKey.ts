import { isAnthropicApiKey } from '@tabmerger/shared';

/**
 * A Pro AI "own key" (BYOK) user's Anthropic API key, kept on this device only.
 *
 * Stored in `chrome.storage.local` under its own key, deliberately NOT in `appSettings`: that
 * lives in IndexedDB, which exports, backups and sync read from. Nothing that copies data off
 * the device (export, automatic backups, sync, analytics, error reports) reads this storage key,
 * and the only place the key leaves the device is the `X-Anthropic-Key` header of a request to
 * TabMerger's own `/api/ai/*` routes (see useAI.ts).
 *
 * The stored value records which account saved it, so a different account signing in on this
 * device never uses it. Signing out removes it (useAuth's signOut).
 */
export const AI_BYOK_KEY_STORAGE_KEY = 'aiByokKey';

interface StoredByokKey {
  userId: string;
  key: string;
}

function isStoredByokKey(value: unknown): value is StoredByokKey {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.userId === 'string' && v.userId.length > 0 && isAnthropicApiKey(v.key);
}

/** Thrown by {@link saveByokKey} when the text isn't shaped like an Anthropic API key. */
export class InvalidByokKeyError extends Error {
  constructor() {
    super('Not an Anthropic API key');
    this.name = 'InvalidByokKeyError';
  }
}

/** A pasted key with surrounding whitespace removed: what is checked and saved. */
export function normalizeByokKey(text: string): string {
  return text.trim();
}

/**
 * The key saved by `userId` on this device, or null when there is none (or it belongs to another
 * account, or the stored value is malformed). Never throws: no storage reads as "no key".
 */
export async function getByokKey(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  try {
    const stored = (await chrome.storage.local.get(AI_BYOK_KEY_STORAGE_KEY))[AI_BYOK_KEY_STORAGE_KEY];
    return isStoredByokKey(stored) && stored.userId === userId ? stored.key : null;
  } catch {
    return null;
  }
}

/** Saves `key` for `userId`, replacing any saved key. Throws {@link InvalidByokKeyError} for a malformed key. */
export async function saveByokKey(userId: string, key: string): Promise<void> {
  const normalized = normalizeByokKey(key);
  if (!userId || !isAnthropicApiKey(normalized)) throw new InvalidByokKeyError();
  await chrome.storage.local.set({ [AI_BYOK_KEY_STORAGE_KEY]: { userId, key: normalized } satisfies StoredByokKey });
}

/** Removes the saved key, whoever saved it. Best effort: never throws. */
export async function clearByokKey(): Promise<void> {
  try {
    await chrome.storage.local.remove(AI_BYOK_KEY_STORAGE_KEY);
  } catch {
    // no extension storage (tests, a non-extension page): nothing to remove
  }
}
