import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useDescribeGroup } from '@/hooks/useAI';
import { GROUPS_QUERY_KEY, useUpdateGroupNote } from '@/hooks/useGroups';
import { undoHistoryEntry } from '@/hooks/useUndoRedo';
import type { NameGroupBlock } from '@/hooks/useNameGroupAction';
import { useUIStore } from '@/stores/uiStore';
import { QuotaExceededError, isFixedInAiSettings } from '@/lib/aiErrors';
import { toast } from '@/lib/toast';
import type { Group, GroupsState } from '@/lib/types';

/** Why a group can't be described right now: the same reasons as "Name group" (`NameGroupBlock`). */
export type DescribeGroupBlock = NameGroupBlock;

/**
 * Writes `note` as the note of the group with id `groupId`, as one undo step, and toasts `message`
 * with an "Undo" that takes back exactly that step. The group is found by id in the current list
 * (an AI request takes a while: the groups may have been reordered meanwhile). Used by "Describe
 * group" for an empty note and by the review modal's Replace / Add below.
 *
 * @returns `save(groupId, note, message)`, resolving `false` when the group is gone.
 */
export function useSaveGroupNote() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { mutateAsync: updateGroupNote } = useUpdateGroupNote();

  return async (groupId: string, note: string, message: string): Promise<boolean> => {
    const groupIndex = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)?.available.findIndex((g) => g.id === groupId) ?? -1;
    if (groupIndex < 0) {
      toast.info(t('errors.groupsChangedElsewhere'), { id: 'groups-changed-elsewhere' });
      return false;
    }
    const before = useUIStore.getState().undoStack[0];
    await updateGroupNote({ groupIndex, note });
    // The step this write pushed (none when it changed nothing, or the group was gone by then)
    const entry = useUIStore.getState().undoStack[0];
    const step = entry && entry !== before ? entry : undefined;
    toast.success(
      message,
      step
        ? {
            action: {
              label: t('header.undo'),
              onClick: () => {
                if (useUIStore.getState().undoStack[0] !== step) {
                  toast.info(t('groupMenu.toast.undoNoteLater'));
                  return;
                }
                void undoHistoryEntry(qc, step);
              }
            }
          }
        : undefined
    );
    return true;
  };
}

/**
 * "Describe group with AI" for one saved group, shared by the header's AI menu (active group) and
 * the sidebar group menu: sends the group's decrypted name and tabs to `/api/ai/describe-group` and
 * puts the cleaned reply in the group's note. An empty note gets it directly (one undo step, a
 * "Note added" toast with Undo); a note with text opens the `describeGroupReview` modal (Replace
 * note, Add below, Cancel). The note is read again once the reply is in, by group id.
 *
 * Errors are toasts, as for "Name group": out of credits offers "Buy more"; an error fixed in
 * Settings → AI offers "Open Settings" on the AI tab; anything else shows its message.
 *
 * @returns `run`, `isPending` while the request runs, and `block` (null when it can run). `run`
 *   does nothing for "Now Open" and toasts when the group has no tabs.
 */
export function useDescribeGroupAction(group: Group | undefined) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { mutateAsync: describeGroup, isPending } = useDescribeGroup();
  const saveNote = useSaveGroupNote();
  const openModal = useUIStore((s) => s.openModal);

  const tabs = group?.windows.flatMap((w) => w.tabs) ?? [];
  const block: DescribeGroupBlock | null = !group || group.permanent ? 'notSaved' : tabs.length === 0 ? 'noTabs' : null;

  const run = async () => {
    if (!group || block === 'notSaved') return;
    if (block === 'noTabs') {
      toast.error(t('groupMenu.toast.noTabsToDescribe'));
      return;
    }
    const groupId = group.id;
    try {
      const { description } = await describeGroup({ groupName: group.name, tabs });
      if (!description) {
        toast.error(t('groupMenu.toast.aiDescribeFailed'));
        return;
      }
      const current = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)?.available.find((g) => g.id === groupId);
      if (current?.note?.trim()) {
        openModal('describeGroupReview', { groupId, description });
        return;
      }
      await saveNote(groupId, description, t('groupMenu.toast.noteAdded'));
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        toast.error(t('common.aiQuotaUsed'), {
          action: { label: t('common.buyMore'), onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` }) }
        });
        return;
      }
      const message = err instanceof Error ? err.message : t('groupMenu.toast.aiDescribeFailed');
      // The own key is missing or rejected, or the model is unavailable: fixed in Settings → AI
      if (isFixedInAiSettings(err)) {
        toast.error(message, { action: { label: t('common.openSettings'), onClick: () => openModal('settings', { tab: 'ai' }) } });
      } else {
        toast.error(message);
      }
    }
  };

  return { run, isPending, block };
}
