import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { History, Pin } from 'lucide-react';
import { AUTO_SAVE_FREE_KEEP_COUNT } from '@tabmerger/shared';
import { Button } from '@/components/ui/button';
import type { Group, GroupsState } from '@/lib/types';
import { GROUPS_QUERY_KEY, useKeepAutoSave } from '@/hooks/useGroups';
import { showAutoSaveKeptToast } from '@/hooks/useAutoSaveToasts';
import { useUIStore } from '@/stores/uiStore';
import { toast } from '@/lib/toast';

/**
 * The banner (and the button that had focus) goes away with the marker: focus the group's row in
 * the main group list instead, once it has rendered there (a few frames at most).
 */
function focusKeptGroup(index: number, framesLeft = 10): void {
  if (index < 0 || framesLeft <= 0) return;
  const row = document.querySelector<HTMLElement>(`[data-sidebar-group-index="${index}"]`);
  if (row) {
    row.focus();
    return;
  }
  requestAnimationFrame(() => focusKeptGroup(index, framesLeft - 1));
}

/**
 * Shown above an auto-saved group in the main panel: what it is and how long it stays, with
 * "Keep as group". A rolling one (made on Free) explains the newest-2 rule; any other auto-save is
 * kept until the user deletes it. Only mounted for an auto-saved group.
 */
export function AutoSaveBanner({ group }: { group: Group }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { mutateAsync: keep, isPending } = useKeepAutoSave();
  const rolling = group.autoSave?.rolling === true;

  const handleKeep = async () => {
    const before = useUIStore.getState().undoStack[0];
    try {
      await keep(group.id);
      showAutoSaveKeptToast(qc, before);
      focusKeptGroup(qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)?.available.findIndex((g) => g.id === group.id) ?? -1);
    } catch {
      toast.error(t('autoSave.toast.keptFailed'));
    }
  };

  return (
    <div
      role="note"
      data-testid="auto-save-banner"
      className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/40 shrink-0 min-w-0"
    >
      <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
        {rolling ? t('autoSave.banner.rolling', { count: AUTO_SAVE_FREE_KEEP_COUNT }) : t('autoSave.banner.kept')}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-6 gap-1 px-2 text-[11px] shrink-0 rounded-none"
        aria-disabled={isPending}
        onClick={() => {
          if (!isPending) void handleKeep();
        }}
      >
        <Pin className="h-3 w-3" />
        {t('autoSave.banner.keep')}
      </Button>
    </div>
  );
}
