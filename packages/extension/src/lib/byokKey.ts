import { AI_PROVIDERS, byokKeyProvider, type AiProvider } from '@tabmerger/shared';

/**
 * A Pro AI "own key" (BYOK) user's API key — Anthropic, OpenAI or Google, one at a time — kept on
 * this device only.
 *
 * Stored in `chrome.storage.local` under its own key, deliberately NOT in `appSettings`: that
 * lives in IndexedDB, which exports, backups and sync read from. Nothing that copies data off
 * the device (export, automatic backups, sync, analytics, error reports) reads this storage key,
 * and the only place the key leaves the device is the `X-AI-Key` header of a request to
 * TabMerger's own `/api/ai/*` routes (see useAI.ts), which pass it to the provider that issued it.
 *
 * The stored value records which account saved it, so a different account signing in on this
 * device never uses it, and which provider issued it. Signing out removes it (useAuth's signOut).
 */
export const AI_BYOK_KEY_STORAGE_KEY = 'aiByokKey';

/** A saved own key and the provider that issued it. */
export interface ByokKey {
  key: string;
  provider: AiProvider;
}

interface StoredByokKey extends ByokKey {
  userId: string;
}

/** A stored value is used only when the recorded provider is the one the key's shape says. */
function isStoredByokKey(value: unknown): value is StoredByokKey {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.userId === 'string' && v.userId.length > 0 && byokKeyProvider(v.key) !== null && byokKeyProvider(v.key) === v.provider;
}

/** Thrown by {@link saveByokKey} when the text isn't shaped like a supported provider's API key. */
export class InvalidByokKeyError extends Error {
  constructor() {
    super('Not a supported API key');
    this.name = 'InvalidByokKeyError';
  }
}

/** A pasted key with surrounding whitespace removed: what is checked and saved. */
export function normalizeByokKey(text: string): string {
  return text.trim();
}

/**
 * The key saved by `userId` on this device with its provider, or null when there is none (or it
 * belongs to another account, or the stored value is malformed). Never throws: no storage reads
 * as "no key".
 */
export async function getByokKey(userId: string | null | undefined): Promise<ByokKey | null> {
  if (!userId) return null;
  try {
    const stored = (await chrome.storage.local.get(AI_BYOK_KEY_STORAGE_KEY))[AI_BYOK_KEY_STORAGE_KEY];
    return isStoredByokKey(stored) && stored.userId === userId ? { key: stored.key, provider: stored.provider } : null;
  } catch {
    return null;
  }
}

/**
 * Saves `key` for `userId`, replacing any saved key (of any provider), and returns it with its
 * provider. Throws {@link InvalidByokKeyError} for a key no supported provider issues.
 */
export async function saveByokKey(userId: string, key: string): Promise<ByokKey> {
  const normalized = normalizeByokKey(key);
  const provider = byokKeyProvider(normalized);
  if (!userId || !provider) throw new InvalidByokKeyError();
  const stored: StoredByokKey = { userId, key: normalized, provider };
  await chrome.storage.local.set({ [AI_BYOK_KEY_STORAGE_KEY]: stored });
  return { key: normalized, provider };
}

/**
 * Removes the saved key, whoever saved it, and any provider picked in Settings without a key
 * ({@link AI_BYOK_PROVIDER_STORAGE_KEY}). Best effort: never throws.
 */
export async function clearByokKey(): Promise<void> {
  try {
    // One key per call: some storage shims (and the test stub) take a single key only
    await chrome.storage.local.remove(AI_BYOK_KEY_STORAGE_KEY);
    await chrome.storage.local.remove(AI_BYOK_PROVIDER_STORAGE_KEY);
  } catch {
    // no extension storage (tests, a non-extension page): nothing to remove
  }
}

/**
 * The provider picked in Settings → AI whose key isn't saved yet (none saved, or switching away
 * from the saved key's provider), kept on this device so reopening Settings shows the same
 * choice. Not a secret: only a provider name and the account that picked it.
 */
export const AI_BYOK_PROVIDER_STORAGE_KEY = 'aiByokProvider';

/** The provider `userId` picked on this device without saving a key for it, or null. Never throws. */
export async function getPickedByokProvider(userId: string | null | undefined): Promise<AiProvider | null> {
  if (!userId) return null;
  try {
    const stored = (await chrome.storage.local.get(AI_BYOK_PROVIDER_STORAGE_KEY))[AI_BYOK_PROVIDER_STORAGE_KEY] as unknown;
    if (!stored || typeof stored !== 'object') return null;
    const { userId: owner, provider } = stored as Record<string, unknown>;
    return owner === userId && (AI_PROVIDERS as readonly unknown[]).includes(provider) ? (provider as AiProvider) : null;
  } catch {
    return null;
  }
}

/** Records (or with null, forgets) the provider `userId` picked without a key. Best effort: never throws. */
export async function setPickedByokProvider(userId: string, provider: AiProvider | null): Promise<void> {
  try {
    if (provider) await chrome.storage.local.set({ [AI_BYOK_PROVIDER_STORAGE_KEY]: { userId, provider } });
    else await chrome.storage.local.remove(AI_BYOK_PROVIDER_STORAGE_KEY);
  } catch {
    // no extension storage: the pick lasts until Settings closes
  }
}
