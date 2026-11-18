import { getSetting, setSetting } from '@/lib/localDb';
import { supabase } from '@/lib/supabase';
import { fetchTier } from '@/lib/entitlementTier';
import { parseTierSeen } from '@/lib/autoSave';
import { recentlyFree } from '@/lib/autoSaveRun';
import { AUTO_SAVE_TIER_SEEN_KEY, LAST_USER_ID_KEY } from '@/lib/syncSettingKeys';
import { limitsForPlan, type RecentlyClosedPlan } from '@/lib/recentlyClosed';
import { notifyRecentlyClosedChanged, pruneRecentlyClosed } from '@/lib/recentlyClosedDb';

/**
 * The plan "Recently closed" is pruned for, shared by the background worker (recorder sweep and
 * trim) and the popup (the one prune after it confirms Free). Worker-safe: no React, no catalog.
 */

export interface ResolvePlanOptions {
  /**
   * Ask the server even when an answer is remembered (signed in, store owned by this account). The
   * popup sets it once it shows Free, so a remembered paid answer from before a downgrade can't
   * keep the Pro limits forever. The fresh answer is remembered for the worker.
   */
  fresh?: boolean;
}

/**
 * The plan to prune for, without a network request when one was remembered: nobody signed in on a
 * store no account owns is Free; otherwise the server's last answer (`AUTO_SAVE_TIER_SEEN_KEY`,
 * which auto-save keeps current), asking the server only when there is none, when it is a "free"
 * older than `AUTO_SAVE_FREE_RECHECK_MS`, or when `fresh` is set (the answer is remembered). A
 * failed check, an account mismatch, or a signed-out store that still holds an account's data with
 * no usable remembered answer is `unknown` (Pro limits).
 */
export async function resolveRecentlyClosedPlan(now: number = Date.now(), { fresh = false }: ResolvePlanOptions = {}): Promise<RecentlyClosedPlan> {
  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    userId = data.session?.user.id ?? null;
  } catch {
    userId = null;
  }
  const owner = await getSetting<string | null>(LAST_USER_ID_KEY, null);
  const rawSeen = await getSetting<unknown>(AUTO_SAVE_TIER_SEEN_KEY, null);
  // A remembered "free" is trusted only while it is recent (`AUTO_SAVE_FREE_RECHECK_MS`): pruning
  // DELETES entries, so a user who upgraded since must not keep being trimmed to the Free limits.
  // A remembered paid answer is always trusted (keeping too much is the safe side).
  const seen = parseTierSeen(rawSeen);
  const remembered = seen === 'free' && !recentlyFree(rawSeen, now) ? null : seen;
  const asPlan = (tier: string | null): RecentlyClosedPlan => (tier === 'free' ? 'free' : tier ? 'pro' : 'unknown');
  if (!userId) return owner ? asPlan(remembered) : 'free';
  if (owner && owner !== userId) return 'unknown';
  if (remembered && !fresh) return asPlan(remembered);
  const tier = await fetchTier(userId);
  if (tier === null) return 'unknown';
  await setSetting(AUTO_SAVE_TIER_SEEN_KEY, { tier, at: now }).catch(() => {});
  return asPlan(tier);
}

/**
 * The popup's catch-up prune: once it shows the Free list, storage is trimmed to the Free limits
 * too, so it holds no more than "Free keeps your last 2 days" says. Only when the plan is CONFIRMED
 * Free here (a fresh server answer, or nobody signed in on a store no account owns): the popup's
 * own `useEntitlements` also says Free when the subscription read failed, which must never delete
 * a Pro user's entries. Resolves how many entries were deleted (0: not Free, or nothing to trim);
 * other extension pages are told when something was.
 */
export async function trimRecentlyClosedIfFree(now: number = Date.now()): Promise<number> {
  if ((await resolveRecentlyClosedPlan(now, { fresh: true })) !== 'free') return 0;
  const { deleted } = await pruneRecentlyClosed(limitsForPlan('free'), now);
  if (deleted > 0) notifyRecentlyClosedChanged();
  return deleted;
}
