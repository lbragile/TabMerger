import { useTranslation } from 'react-i18next';
import type { Group } from '@/lib/types';
import { formatTimeAgo } from '@/lib/i18n';
import { formatGroupCounts, getGroupTabCount } from '@/lib/utils';
import { useUIStore } from '@/stores/uiStore';
import { useDeleteGroup, useRestoreGroup } from '@/hooks/useGroups';
import { SectionViewHeader } from './SectionViewHeader';
import { ReadOnlyWindows } from './ReadOnlyWindows';

/**
 * An archived group, read-only, in the main panel (`mainView` `archived`). Restore brings it back
 * and shows it as a normal group; Delete (⋯) removes it, and the panel falls back to the group
 * shown before (`MainPanel`). Tabs open on click; nothing else is editable here.
 */
export function ArchivedGroupView({ group, groupIndex, groups }: { group: Group; groupIndex: number; groups: readonly Group[] }) {
  const { t } = useTranslation();
  const setActiveGroupIndex = useUIStore((s) => s.setActiveGroupIndex);
  const closeMainView = useUIStore((s) => s.closeMainView);
  const { mutate: restoreGroup, isPending: restoring } = useRestoreGroup();
  const { mutate: deleteGroup } = useDeleteGroup();

  const restore = () =>
    restoreGroup(groupIndex, {
      onSuccess: (next) => {
        // Show the restored group (found by id: positions can move while the write runs)
        const at = next?.available.findIndex((g) => g.id === group.id) ?? -1;
        if (at >= 0) setActiveGroupIndex(at);
      }
    });

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden" data-testid="archived-view">
      <SectionViewHeader
        color={group.color}
        title={group.name}
        meta={t('sidePanel.view.archivedMeta', { counts: formatGroupCounts(group.windows.length, getGroupTabCount(group)) })}
        primaryLabel={t('sidePanel.view.restore')}
        onPrimary={restore}
        primaryDisabled={restoring}
        deleteLabel={t('sidePanel.deleteGroup')}
        onDelete={() => deleteGroup(groupIndex)}
        onClose={() => closeMainView(groups)}
        banner={t('sidePanel.view.archivedBanner', { time: formatTimeAgo(group.updatedAt) })}
      />
      <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
        <ReadOnlyWindows windows={group.windows} />
      </div>
    </div>
  );
}
