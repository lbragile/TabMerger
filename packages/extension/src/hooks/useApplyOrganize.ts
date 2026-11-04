import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { OrganizeAction } from '@tabmerger/shared';
import { getSetting, setSetting, updateGroupsState } from '@/lib/localDb';
import { deleteRemoteGroups } from '@/lib/syncEngine';
import { recordStep } from '@/lib/undoHistory';
import { applyOrganizeActions, retargetUrlRules, type OrganizeResult } from '@/lib/organizeActions';
import { getSidebarDisplayOrder } from '@/lib/sidebarOrder';
import { trackEvent } from '@/lib/analytics';
import { useUIStore } from '@/stores/uiStore';
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups';
import type { GroupsState, UrlRule } from '@/lib/types';

/** `useUrlRules`' query key (not exported there; the rules list re-reads after a merge retargets them). */
const URL_RULES_QUERY_KEY = ['urlRules'] as const;

/**
 * Points the URL rules of merged-away groups at the group that holds their tabs now. Like the
 * banner's Merge and every group delete, this is not part of the undo step (the history only
 * keeps groups): an Undo brings the merged groups back, and their rules stay on the merge target.
 */
async function retargetRules(mergedInto: Record<string, string>, qc: QueryClient): Promise<void> {
  const rules = retargetUrlRules(await getSetting<UrlRule[]>('urlRules', []), mergedInto);
  if (!rules) return;
  await setSetting('urlRules', rules);
  void qc.invalidateQueries({ queryKey: URL_RULES_QUERY_KEY }, { cancelRefetch: false });
}

/**
 * The group to show after Organize: the same group (indexes move with merges and reorders), the
 * group it was merged into, or, when it was archived, the nearest group above it in the sidebar
 * that is still there (Now Open when none), the same rule as archiving.
 */
function viewedIndexAfter(viewedId: string | undefined, before: GroupsState | undefined, next: GroupsState, result: OrganizeResult): number | null {
  if (!viewedId) return null;
  const wanted = result.mergedInto[viewedId] ?? viewedId;
  if (!result.archivedIds.includes(wanted)) {
    const index = next.available.findIndex((g) => g.id === wanted);
    return index >= 0 ? index : null;
  }
  const order = getSidebarDisplayOrder(before?.available ?? []);
  const pos = order.findIndex(({ group }) => group.id === viewedId);
  const above = order
    .slice(0, Math.max(pos, 0))
    .reverse()
    .find(({ group }) => !result.archivedIds.includes(group.id) && !result.mergedInto[group.id]);
  return Math.max(above ? next.available.findIndex((g) => g.id === above.group.id) : 0, 0);
}

/**
 * Applies the Organize actions the user kept in the review modal, all of them in ONE groups write
 * (`applyOrganizeActions` on a fresh read inside the write queue + cross-context lock), so they
 * are one undo step and one sync push. Ids are re-checked on that fresh read: an action whose
 * group is gone by then is skipped. Merged-away groups are deleted remotely (as every group delete,
 * so a sync can't bring them back) and their URL rules follow the merge; archived groups are
 * pushed with `archived: true` like a manual archive.
 *
 * @returns how many actions changed something (0 = nothing written).
 */
export function useApplyOrganize() {
  const qc = useQueryClient();
  const pushUndo = useUIStore((s) => s.pushUndo);

  return useMutation({
    mutationFn: async (actions: OrganizeAction[]): Promise<{ applied: number }> => {
      const before = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
      const viewedId = before?.available[useUIStore.getState().activeGroupIndex]?.id;
      const outcome: { result?: OrganizeResult } = {};
      const next = await updateGroupsState(
        (fresh) => {
          const result = applyOrganizeActions(fresh, actions);
          outcome.result = result;
          return result.applied.length > 0 ? result.state : null; // nothing applies: no write, no step
        },
        { afterWrite: recordStep({ push: pushUndo }) }
      );
      qc.setQueryData(GROUPS_QUERY_KEY, next);

      const result = outcome.result;
      if (!result || result.applied.length === 0) return { applied: 0 };

      const mergedIds = Object.keys(result.mergedInto);
      if (mergedIds.length > 0) {
        // Fire-and-forget, as useDeleteGroup: hard-delete the rows so a pull can't resurrect them
        deleteRemoteGroups(mergedIds).catch(() => {});
        retargetRules(result.mergedInto, qc).catch(() => {});
      }

      const index = viewedIndexAfter(viewedId, before, next, result);
      if (index !== null && index !== useUIStore.getState().activeGroupIndex) useUIStore.getState().setActiveGroupIndex(index);

      trackEvent('ai_organize_applied', { count: result.applied.length });
      return { applied: result.applied.length };
    }
  });
}
