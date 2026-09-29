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

const NAME_BY_LIMIT: Record<LimitName, string> = {
  maxGroups: 'groups',
  maxTabs: 'tabs',
  maxUrlRules: 'URL rules'
};

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

/**
 * Counts groups/tabs the way every existing Free-tier gate in the UI does (SidePanel,
 * Header, GroupContextMenu, CreateGroupMenuItem, UpgradeCTA): every non-permanent group
 * counts, INCLUDING archived ones — archiving a group doesn't free up a slot. Only the
 * permanent "Now Open" group (index 0) is excluded.
 */
export function countSavedGroupsAndTabs(groups: Group[]): { groups: number; tabs: number } {
  const saved = groups.filter((g) => !g.permanent);
  // ponytail: `?? []` guards malformed/partial group objects (e.g. a test fixture or a
  // hand-edited import file missing `windows`) — counting should never throw.
  const tabs = saved.reduce((sum, g) => sum + (g.windows ?? []).reduce((ws, w) => ws + (w.tabs?.length ?? 0), 0), 0);
  return { groups: saved.length, tabs };
}

/**
 * Shared upgrade-toast for every Free-limit gate, so the wording and Upgrade action are
 * identical everywhere it fires. `detail` appends a second line (e.g. "This file contains
 * N groups.") for gates that want to say why the block happened, not just what the limit is.
 */
export function showFreeLimitToast(limit: LimitName, maxAllowed: number, detail?: string): void {
  trackEvent('entitlement_limit_hit', { limit });
  toast.error(`Free plan allows up to ${maxAllowed} ${NAME_BY_LIMIT[limit]}.`, {
    ...(detail ? { description: detail } : {}),
    action: {
      label: 'Upgrade',
      onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` })
    }
  });
}

/**
 * One shared gate for every group-import path (`ImportExportModal`'s JSON/Bookmarks/OneTab
 * imports, `SettingsModal`'s Data-tab import). Computes the resulting group/tab counts,
 * checks them against `caps`, and — if blocked — fires the same upgrade toast every other
 * limit gate uses (with a "this file contains N groups, M tabs" detail line) before
 * returning `true` so the caller can bail without writing anything.
 *
 * `mode` controls how "resulting" is computed:
 * - `'append'` — the import is additive (goes through `useImportGroups`, which appends to
 *   the existing `available`): resulting = current + imported.
 * - `'replace'` — the import REPLACES the entire `available` array (`ImportExportModal`'s
 *   own JSON round-trip, via `setGroupsState`): resulting = the imported file's own counts;
 *   there's no surviving "current" to add.
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
    `This file contains ${imported.groups} group${imported.groups !== 1 ? 's' : ''}, ${imported.tabs} tab${imported.tabs !== 1 ? 's' : ''}.`
  );
  return true;
}
