import type { Group } from '@/lib/types';

/**
 * Replicates `SidePanel/index.tsx`'s derivation of the sidebar's visible group order:
 * Now Open (permanent, always first) + non-archived saved groups, starred groups before
 * unstarred ones, relative order preserved within each zone. Archived groups are excluded
 * entirely (they render in their own collapsible section, not this list).
 *
 * Used anywhere that needs to reason about "what's above/below X in the sidebar" outside
 * of `SidePanel` itself (e.g. `useArchiveGroup`'s "activate the group above" rule) — keep
 * this in sync with `SidePanel/index.tsx`'s inline derivation if that ever changes.
 */
export function getSidebarDisplayOrder(available: Group[]): { group: Group; realIndex: number }[] {
  const activeRaw = available.filter((g) => g.permanent || !g.archived);
  const ordered = [
    activeRaw[0],
    ...activeRaw.slice(1).filter((g) => g.starred),
    ...activeRaw.slice(1).filter((g) => !g.starred),
  ].filter((g): g is Group => Boolean(g));
  return ordered.map((group) => ({ group, realIndex: available.indexOf(group) }));
}
