import { t } from '@/lib/i18n';
import type { Group } from '@/lib/types';
import { toast } from '@/lib/toast';
import { trackEvent } from '@/lib/analytics';

/**
 * The subset of `Entitlements` that free-tier limit checks care about. Kept as its own
 * shape (rather than `Pick<Entitlements, ...>`) so callers that only have one limit handy
 * (e.g. `useUrlRules`, which doesn't want to depend on `useEntitlements`/`useAuth`/Supabase
 * just to gate a save) can pass a partial object without importing the full Entitlements type.
 */
export interface TierCaps {
  maxGroups?: number;
  maxTabs?: number;
  maxUrlRules?: number;
}

export type LimitName = 'maxGroups' | 'maxTabs' | 'maxUrlRules';

export interface LimitCounts {
  groups?: number;
  tabs?: number;
  urlRules?: number;
}

/**
 * Discriminated union so callers narrow on `exceeded` instead of null-checking `limit`
 * (`check.limit!`) — once `exceeded` is `true`, TypeScript knows `limit`/`maxAllowed` exist.
 */
export type LimitCheckResult =
  | { exceeded: true; limit: LimitName; maxAllowed: number }
  | { exceeded: false };

/**
 * Thrown by the data-layer backstops after they have already shown the upgrade toast, so
 * callers can tell "blocked by plan" (nothing more to say) apart from a real failure.
 */
export class FreeLimitExceededError extends Error {
  constructor(readonly limit: LimitName) {
    super('free_limit_exceeded');
    this.name = 'FreeLimitExceededError';
  }
}


/**
 * Single source of truth for "would this take a Free user over their limit?" Paid tiers
 * pass `maxGroups`/`maxTabs`/`maxUrlRules` as `Infinity` (see `UNLIMITED_TIER_LIMITS`), so
 * this is always `exceeded: false` for them — callers do NOT need a separate `tier === 'free'`
 * pre-check before calling this.
 *
 * Checks groups, then tabs, then urlRules and returns the FIRST one that would be exceeded
 * — callers that care about all three should inspect the result and, if they need every
 * violated limit (not just the first), call this multiple times with narrowed `counts`.
 *
 * Only a cap that's actually provided AND has a matching count is checked — this lets a
 * caller pass a single-field `TierCaps` (e.g. `{ maxUrlRules }`) without tripping unrelated
 * checks it has no data for.
 */
export function exceedsFreeLimits(caps: TierCaps, counts: LimitCounts): LimitCheckResult {
  if (counts.groups !== undefined && caps.maxGroups !== undefined && counts.groups > caps.maxGroups) {
    return { exceeded: true, limit: 'maxGroups', maxAllowed: caps.maxGroups };
  }
  if (counts.tabs !== undefined && caps.maxTabs !== undefined && counts.tabs > caps.maxTabs) {
    return { exceeded: true, limit: 'maxTabs', maxAllowed: caps.maxTabs };
  }
  if (counts.urlRules !== undefined && caps.maxUrlRules !== undefined && counts.urlRules > caps.maxUrlRules) {
    return { exceeded: true, limit: 'maxUrlRules', maxAllowed: caps.maxUrlRules };
  }
  return { exceeded: false };
}

// Store-free (the background worker's auto-save counts with them too): see lib/groupCounts.ts
import { countedGroups, countSavedGroupsAndTabs } from '@/lib/groupCounts';
export { countedGroups, countSavedGroupsAndTabs };

/**
 * Shared upgrade-toast for every Free-limit gate, so the wording and Upgrade action are
 * identical everywhere it fires. `detail` appends a second line (e.g. "This file contains
 * N groups.") for gates that want to say why the block happened, not just what the limit is.
 */
export function showFreeLimitToast(limit: LimitName, maxAllowed: number, detail?: string): void {
  trackEvent('entitlement_limit_hit', { limit });
  toast.error(t(`errors.freeLimit.${limit}`, { max: maxAllowed }), {
    ...(detail ? { description: detail } : {}),
    action: {
      label: t('common.upgrade'),
      onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` })
    }
  });
}

/**
 * One shared gate for every group-import path (`SettingsModal`'s Data-tab import of a JSON
 * backup, bookmarks HTML or OneTab text file, and `AutoBackups`' restore). Computes the resulting group/tab counts,
 * checks them against `caps`, and — if blocked — fires the same upgrade toast every other
 * limit gate uses (with a "this file contains N groups, M tabs" detail line) before
 * returning `true` so the caller can bail without writing anything.
 *
 * `mode` controls how "resulting" is computed:
 * - `'append'` — the import is additive (goes through `useImportGroups`, which appends to
 *   the existing `available`): the Data-tab import and an auto-backup "add" restore.
 *   resulting = current + imported.
 * - `'replace'` — the import REPLACES the saved groups (an auto-backup "replace" restore, via
 *   `useReplaceSavedGroups`): resulting = the imported groups' own counts; there's no surviving
 *   "current" to add.
 *
 * Paid tiers (caps at `Infinity`) always pass — `exceedsFreeLimits` handles that, no
 * `tier === 'free'` pre-check needed here.
 */
export function blockImportOverFreeLimit(
  caps: TierCaps,
  currentGroups: Group[],
  importedGroups: Group[],
  mode: 'append' | 'replace'
): boolean {
  const imported = countSavedGroupsAndTabs(importedGroups);
  const resulting =
    mode === 'append'
      ? (() => {
          const current = countSavedGroupsAndTabs(currentGroups);
          return { groups: current.groups + imported.groups, tabs: current.tabs + imported.tabs };
        })()
      : imported;

  const check = exceedsFreeLimits(caps, { groups: resulting.groups, tabs: resulting.tabs });
  if (!check.exceeded) return false;

  showFreeLimitToast(
    check.limit,
    check.maxAllowed,
    t('errors.fileContains', { groups: t('common.groupCount', { count: imported.groups }), tabs: t('common.tabCount', { count: imported.tabs }) })
  );
  return true;
}
