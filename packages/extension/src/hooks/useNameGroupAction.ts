import { useTranslation } from 'react-i18next';
import { useNameGroup } from '@/hooks/useAI';
import { useUpdateGroupName } from '@/hooks/useGroups';
import { useUIStore } from '@/stores/uiStore';
import { QuotaExceededError, isFixedInAiSettings } from '@/lib/aiErrors';
import { toast } from '@/lib/toast';
import { cleanSuggestedName } from '@/lib/aiGroupName';
import type { Group } from '@/lib/types';

/**
 * Why a group can't be named with AI right now: `notSaved` for "Now Open" (it mirrors the
 * browser and is never renamed) or no group at all, `noTabs` when the group has nothing to name
 * it from.
 */
export type NameGroupBlock = 'notSaved' | 'noTabs';

/**
 * "Name group with AI" for one saved group, shared by the sidebar group menu and the header's AI
 * menu (which targets the active group) so both behave the same: it sends the group's tabs to
 * `/api/ai/name-group` and renames the group at `groupIndex` (positional, never by tab id) through
 * `useUpdateGroupName`, which is one undo step and marks the group for sync.
 *
 * Errors are toasts: out of credits offers "Buy more"; an error fixed in Settings → AI (the own
 * key, the model) offers "Open Settings" on the AI tab; anything else shows its message.
 *
 * @returns `run` to start it, `isPending` while the request runs, and `block`, why the group
 *   can't be named (null when it can). `run` re-checks: it does nothing for "Now Open" and toasts
 *   when the group has no tabs.
 */
export function useNameGroupAction(group: Group | undefined, groupIndex: number) {
  const { t } = useTranslation();
  const { mutateAsync: nameGroup, isPending } = useNameGroup();
  const { mutate: updateGroupName } = useUpdateGroupName();
  const openModal = useUIStore((s) => s.openModal);

  const tabs = group?.windows.flatMap((w) => w.tabs) ?? [];
  const block: NameGroupBlock | null = !group || group.permanent ? 'notSaved' : tabs.length === 0 ? 'noTabs' : null;

  const run = async () => {
    if (block === 'notSaved') return;
    if (block === 'noTabs') {
      toast.error(t('groupMenu.toast.noTabsToName'));
      return;
    }
    try {
      const { name: suggested } = await nameGroup(tabs);
      const name = cleanSuggestedName(suggested);
      if (!name) {
        toast.error(t('groupMenu.toast.aiRenameFailed'));
        return;
      }
      updateGroupName({ groupIndex, name });
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
