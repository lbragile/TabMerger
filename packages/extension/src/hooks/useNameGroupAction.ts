import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useNameGroup } from '@/hooks/useAI';
import { GROUPS_QUERY_KEY } from '@/hooks/useGroups';
import { useUIStore } from '@/stores/uiStore';
import { QuotaExceededError, isFixedInAiSettings } from '@/lib/aiErrors';
import { toast } from '@/lib/toast';
import { isSameGroupName, suggestedGroupNames } from '@/lib/aiGroupName';
import type { Group, GroupsState } from '@/lib/types';

/**
 * Why a group can't be named with AI right now: `notSaved` for "Now Open" (it mirrors the
 * browser and is never renamed) or no group at all, `noTabs` when the group has nothing to name
 * it from.
 */
export type NameGroupBlock = 'notSaved' | 'noTabs';

/**
 * "Name group with AI" for one saved group, shared by the sidebar group menu and the header's AI
 * menu (which targets the active group) so both behave the same: it sends the group's tabs to
 * `/api/ai/name-group` and opens the `nameGroupPicker` modal with the suggestions (1 to 3, best
 * first; an older server's single `name` works too), where the user picks one or types their own.
 *
 * The suggestions are cleaned and deduped (`suggestedGroupNames`), and the ones equal to the
 * group's current name are dropped. The group is looked up again BY ID once the reply is in (the
 * request takes seconds: the group may have moved, been renamed or deleted meanwhile). When the
 * current name is all that is left, a toast says it already fits and nothing opens.
 *
 * Errors are toasts: out of credits offers "Buy more"; an error fixed in Settings → AI (the own
 * key, the model) offers "Open Settings" on the AI tab; anything else shows its message.
 *
 * @returns `run` to start it, `isPending` while the request runs, and `block`, why the group
 *   can't be named (null when it can). `run` re-checks: it does nothing for "Now Open" and toasts
 *   when the group has no tabs.
 */
export function useNameGroupAction(group: Group | undefined) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { mutateAsync: nameGroup, isPending } = useNameGroup();
  const openModal = useUIStore((s) => s.openModal);

  const tabs = group?.windows.flatMap((w) => w.tabs) ?? [];
  const block: NameGroupBlock | null = !group || group.permanent ? 'notSaved' : tabs.length === 0 ? 'noTabs' : null;

  const run = async () => {
    if (!group || block === 'notSaved') return;
    if (block === 'noTabs') {
      toast.error(t('groupMenu.toast.noTabsToName'));
      return;
    }
    const groupId = group.id;
    try {
      const suggestions = suggestedGroupNames(await nameGroup(tabs));
      if (suggestions.length === 0) {
        toast.error(t('groupMenu.toast.aiRenameFailed'));
        return;
      }
      const current = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)?.available.find((g) => g.id === groupId);
      if (!current) {
        toast.info(t('errors.groupsChangedElsewhere'), { id: 'groups-changed-elsewhere' });
        return;
      }
      const offered = suggestions.filter((name) => !isSameGroupName(name, current.name.trim()));
      if (offered.length === 0) {
        toast.info(t('groupMenu.toast.nameAlreadyFits', { name: current.name }));
        return;
      }
      openModal('nameGroupPicker', { groupId, suggestions: offered });
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

  return { run, isPending, block };
}
