import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useNameGroup } from '@/hooks/useAI';
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups';
import { useUIStore } from '@/stores/uiStore';
import { QuotaExceededError, isFixedInAiSettings } from '@/lib/aiErrors';
import { toast } from '@/lib/toast';
import type { MessageKey } from '@/lib/i18n';
import { isSameGroupName, suggestedGroupNames } from '@/lib/aiGroupName';
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

/**
 * Why a group can't be named with AI right now: `notSaved` for "Now Open" (it mirrors the
 * browser and is never renamed) or no group at all, `noTabs` when the group has nothing to name
 * it from.
 */
export type NameGroupBlock = AiSubjectBlock;

/** The toasts that name what is named ("this group" / "this window"). */
const NAME_COPY: Record<AiTarget['kind'], { noTabs: MessageKey; fits: MessageKey }> = {
  group: { noTabs: 'groupMenu.toast.noTabsToName', fits: 'groupMenu.toast.nameAlreadyFits' },
  window: { noTabs: 'window.toast.noTabsToName', fits: 'window.toast.nameAlreadyFits' }
};

/**
 * "Name with AI" for any saved group or window (`AiSubject`): sends its tabs to
 * `/api/ai/name-group` and opens the `nameGroupPicker` modal with the suggestions (1 to 3, best
 * first; an older server's single `name` works too), where the user picks one or types their own.
 *
 * The suggestions are cleaned and deduped (`suggestedGroupNames`), and the ones equal to the
 * CURRENT name are dropped. The target is looked up again once the reply is in
 * (`resolveAiTarget`: a group by id, a window by position and the tabs that were sent): gone or
 * changed toasts "changed elsewhere". When the current name is all that is left, a toast says it
 * already fits and nothing opens.
 *
 * Errors are toasts: out of credits offers "Buy more"; an error fixed in Settings → AI (the own
 * key, the model) offers "Open Settings" on the AI tab; anything else shows its message.
 *
 * @returns `run(subject)`, which does nothing for Now Open and toasts when there are no tabs, and
 *   `isPending` while a request runs.
 */
export function useNameAction() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { mutateAsync: nameGroup, isPending } = useNameGroup();
  const openModal = useUIStore((s) => s.openModal);

  const run = async (subject: AiSubject | undefined) => {
    const block = subjectBlock(subject);
    if (!subject || block === 'notSaved') return;
    const copy = NAME_COPY[subject.target.kind];
    if (block === 'noTabs') {
      toast.error(t(copy.noTabs));
      return;
    }
    const { target } = subject;
    try {
      const suggestions = suggestedGroupNames(await nameGroup(subject.tabs));
      if (suggestions.length === 0) {
        toast.error(t('groupMenu.toast.aiRenameFailed'));
        return;
      }
      const current = resolveAiTarget(qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY), target);
      if (!current) {
        toast.info(t('errors.groupsChangedElsewhere'), { id: 'groups-changed-elsewhere' });
        return;
      }
      const currentName = current.name.trim();
      const offered = suggestions.filter((name) => !isSameGroupName(name, currentName));
      if (offered.length === 0) {
        toast.info(t(copy.fits, { name: current.name }));
        return;
      }
      openModal('nameGroupPicker', aiTargetModalData(target, { suggestions: offered }));
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        toast.error(t('common.aiQuotaUsed'), {
          action: { label: t('common.buyMore'), onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` }) }
        });
        return;
      }
      const message = err instanceof Error ? err.message : t('groupMenu.toast.aiRenameFailed');
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
 * "Name group with AI" for one saved group, shared by the sidebar group menu and the header's AI
 * menu (which targets the active group) so both behave the same: `useNameAction` for that group.
 *
 * @returns `run` to start it, `isPending` while the request runs, and `block`, why the group
 *   can't be named (null when it can). `run` re-checks: it does nothing for "Now Open" and toasts
 *   when the group has no tabs.
 */
export function useNameGroupAction(group: Group | undefined) {
  const { run, isPending } = useNameAction();
  const subject = groupSubject(group);
  return { run: () => run(subject), isPending, block: subjectBlock(subject) as NameGroupBlock | null };
}
