import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useDescribeGroup } from '@/hooks/useAI';
import { GROUPS_QUERY_KEY, useUpdateGroupNote, useUpdateWindowNote } from '@/hooks/useGroups';
import { undoHistoryEntry } from '@/hooks/useUndoRedo';
import { useUIStore } from '@/stores/uiStore';
import { QuotaExceededError, isFixedInAiSettings } from '@/lib/aiErrors';
import { toast } from '@/lib/toast';
import type { MessageKey } from '@/lib/i18n';
import {
  aiTargetModalData,
  groupSubject,
  resolveAiTarget,
  subjectBlock,
  type AiSubject,
  type AiSubjectBlock,
  type AiTarget
} from '@/lib/aiTarget';
import type { Group, GroupsState } from '@/lib/types';

/** Why a group can't be described right now: the same reasons as "Name group" (`AiSubjectBlock`). */
export type DescribeGroupBlock = AiSubjectBlock;

/** The toasts that name what is described ("this group" / "this window"). */
const DESCRIBE_COPY: Record<AiTarget['kind'], { noTabs: MessageKey; failed: MessageKey }> = {
  group: { noTabs: 'groupMenu.toast.noTabsToDescribe', failed: 'groupMenu.toast.aiDescribeFailed' },
  window: { noTabs: 'window.toast.noTabsToDescribe', failed: 'window.toast.aiDescribeFailed' }
};

/**
 * Writes `note` as the note of `target` (a group by id, or a window found again by
 * `resolveAiTarget`), as one undo step, and toasts `message` with an "Undo" that takes back exactly
 * that step. The target is found in the CURRENT list (an AI request takes a while: the groups or
 * windows may have moved meanwhile); a target that is gone or changed toasts "changed elsewhere".
 * Used by "Describe" for an empty note and by the review modal's Replace / Add below.
 *
 * @returns `save(target, note, message)`, resolving `false` when the target is gone.
 */
export function useSaveNote() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { mutateAsync: updateGroupNote } = useUpdateGroupNote();
  const { mutateAsync: updateWindowNote } = useUpdateWindowNote();

  return async (target: AiTarget, note: string, message: string): Promise<boolean> => {
    const found = resolveAiTarget(qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY), target);
    if (!found) {
      toast.info(t('errors.groupsChangedElsewhere'), { id: 'groups-changed-elsewhere' });
      return false;
    }
    const before = useUIStore.getState().undoStack[0];
    if (found.windowIndex === null) {
      await updateGroupNote({ groupIndex: found.groupIndex, note });
    } else {
      await updateWindowNote({ groupIndex: found.groupIndex, windowIndex: found.windowIndex, note });
    }
    // The step this write pushed (none when it changed nothing, or the target was gone by then)
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
 * "Describe with AI" for any saved group or window (`AiSubject`): sends its decrypted name ("" for
 * an unnamed window) and tabs to `/api/ai/describe-group` and puts the cleaned reply in its note.
 * An empty note gets it directly (one undo step, a "Note added" toast with Undo); a note with text
 * opens the `describeGroupReview` modal (Replace note, Add below, Cancel). The target is found
 * again once the reply is in (`resolveAiTarget`: a window must still hold the tabs that were sent);
 * gone or changed toasts "changed elsewhere" and writes nothing.
 *
 * Errors are toasts, as for "Name": out of credits offers "Buy more"; an error fixed in
 * Settings → AI offers "Open Settings" on the AI tab; anything else shows its message.
 *
 * @returns `run(subject)`, which does nothing for Now Open and toasts when there are no tabs, and
 *   `isPending` while a request runs.
 */
export function useDescribeAction() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { mutateAsync: describeGroup, isPending } = useDescribeGroup();
  const saveNote = useSaveNote();
  const openModal = useUIStore((s) => s.openModal);

  const run = async (subject: AiSubject | undefined) => {
    const block = subjectBlock(subject);
    if (!subject || block === 'notSaved') return;
    const copy = DESCRIBE_COPY[subject.target.kind];
    if (block === 'noTabs') {
      toast.error(t(copy.noTabs));
      return;
    }
    const { target } = subject;
    try {
      const { description } = await describeGroup({ groupName: subject.name, tabs: subject.tabs });
      if (!description) {
        toast.error(t(copy.failed));
        return;
      }
      const current = resolveAiTarget(qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY), target);
      if (current?.note.trim()) {
        openModal('describeGroupReview', aiTargetModalData(target, { description }));
        return;
      }
      // Gone or changed: `saveNote` finds that again and says so
      await saveNote(target, description, t('groupMenu.toast.noteAdded'));
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        toast.error(t('common.aiQuotaUsed'), {
          action: { label: t('common.buyMore'), onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` }) }
        });
        return;
      }
      const message = err instanceof Error ? err.message : t(copy.failed);
      // The own key is missing or rejected, or the model is unavailable: fixed in Settings → AI
      if (isFixedInAiSettings(err)) {
        toast.error(message, { action: { label: t('common.openSettings'), onClick: () => openModal('settings', { tab: 'ai' }) } });
      } else {
        toast.error(message);
      }
    }
  };

  return { run, isPending };
}

/**
 * "Describe group with AI" for one saved group, shared by the header's AI menu (active group) and
 * the sidebar group menu: `useDescribeAction` for that group.
 *
 * @returns `run`, `isPending` while the request runs, and `block` (null when it can run). `run`
 *   does nothing for "Now Open" and toasts when the group has no tabs.
 */
export function useDescribeGroupAction(group: Group | undefined) {
  const { run, isPending } = useDescribeAction();
  const subject = groupSubject(group);
  return { run: () => run(subject), isPending, block: subjectBlock(subject) as DescribeGroupBlock | null };
}
