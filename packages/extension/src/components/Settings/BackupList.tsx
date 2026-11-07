import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getGroupTabCount } from '@/lib/utils';
import type { Session } from '@/lib/types';

interface BackupListProps {
  /** Newest first. Nothing is rendered when it is empty. */
  backups: Session[];
  formatDate: (ms: number) => string;
  /** The backup whose "how do you want it back" choice is open, if any. */
  restoreId: string | null;
  onRestoreIdChange: (id: string | null) => void;
  onRestore: (backup: Session, mode: 'add' | 'replace') => void;
  onDelete: (backup: Session) => void;
}

/**
 * The saved backups under Settings → Data → Backups, folded behind "▸ N saved backups"
 * (collapsed by default). Each row: date, counts, Restore (opens Add / Replace / Cancel) and
 * Delete. Delete buttons carry `data-backup-delete` so the section can move focus after a delete.
 */
export function BackupList({ backups, formatDate, restoreId, onRestoreIdChange, onRestore, onDelete }: BackupListProps) {
  const { t } = useTranslation();
  const listId = useId();
  const [open, setOpen] = useState(false);
  if (backups.length === 0) return null;

  return (
    <div className="min-w-0 space-y-2">
      <Button
        variant="ghost"
        size="sm"
        className="-ms-1 h-6 gap-1 px-1 text-xs rounded-none"
        aria-expanded={open}
        aria-controls={listId}
        data-testid="backup-list-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0 rtl:-scale-x-100" />}
        {t('backups.savedCount', { count: backups.length })}
      </Button>

      <div id={listId} className="min-w-0" hidden={!open}>
        <ul className="min-w-0 border border-border divide-y divide-border" aria-label={t('backups.listLabel')}>
          {backups.map((backup) => {
            const tabCount = backup.groups.reduce((sum, g) => sum + getGroupTabCount(g), 0);
            const when = formatDate(backup.createdAt);
            return (
              <li key={backup.id} className="min-w-0 px-2 py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-xs">{when}</span>
                    <span className="block truncate text-[0.6875rem] text-muted-foreground">
                      {t('backups.counts', { groups: t('common.groupCount', { count: backup.groups.length }), tabs: t('common.tabCount', { count: tabCount }) })}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-xs shrink-0 rounded-none"
                    aria-label={t('backups.restoreFrom', { when })}
                    aria-expanded={restoreId === backup.id}
                    onClick={() => onRestoreIdChange(restoreId === backup.id ? null : backup.id)}
                  >
                    <RotateCcw className="h-3 w-3" />
                    {t('backups.restore')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 shrink-0 rounded-none text-muted-foreground hover:text-destructive"
                    aria-label={t('backups.deleteFrom', { when })}
                    data-backup-delete={backup.id}
                    onClick={() => onDelete(backup)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                {restoreId === backup.id && (
                  <div className="mt-1.5 min-w-0 space-y-1.5" role="group" aria-label={t('backups.howToRestore', { when })}>
                    <p className="text-[0.6875rem] text-muted-foreground">{t('backups.restoreExplainer')}</p>
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <Button variant="outline" size="sm" className="h-7 text-xs rounded-none" onClick={() => onRestore(backup, 'add')}>
                        {t('backups.addToMine')}
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs rounded-none" onClick={() => onRestore(backup, 'replace')}>
                        {t('backups.replaceMine')}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs rounded-none" onClick={() => onRestoreIdChange(null)}>
                        {t('backups.cancel')}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
