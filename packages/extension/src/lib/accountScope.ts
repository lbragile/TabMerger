import { clearLocalAccountData, getSetting, setSetting } from './localDb';
import { LAST_USER_ID_KEY } from './syncSettingKeys';

let current: { userId: string; done: Promise<boolean> } | null = null;

/** Test seam: forget the memoised scope check (module state outlives a test). */
export function resetAccountScopeForTests(): void {
  current = null;
}

/**
 * Makes the local store belong to `userId`: if a DIFFERENT account's data is in it, wipes it
 * first, then records `userId`. Memoised per user so every caller (the sign-in effect AND the
 * first sync) awaits the SAME wipe: a sync must never start against the previous account's
 * groups (they would be pushed as "mine" and rejected by RLS, or merged into the new account).
 * Resolves true when a wipe happened (callers then refresh their caches).
 */
export function ensureAccountScope(userId: string): Promise<boolean> {
  if (current?.userId === userId) return current.done;
  const done = (async () => {
    const last = await getSetting<string | null>(LAST_USER_ID_KEY, null);
    const switched = !!last && last !== userId;
    if (switched) await clearLocalAccountData();
    await setSetting(LAST_USER_ID_KEY, userId);
    return switched;
  })();
  current = { userId, done };
  return done;
}
