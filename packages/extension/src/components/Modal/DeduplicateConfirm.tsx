import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useDeduplicateGroup } from '@/hooks/useGroups'
import type { DuplicateTab } from '@/lib/deduplication'

interface DeduplicateConfirmModalProps {
  data: Record<string, unknown>
  onClose: () => void
}

/**
 * Confirms removing a group's duplicate tabs. `data.duplicates` comes from
 * `findDuplicateTabs`: each entry carries the tab's position in the group, which is what
 * the mutation matches on.
 */
export function DeduplicateConfirmModal({ data, onClose }: DeduplicateConfirmModalProps) {
  const { t } = useTranslation();
  const groupIndex = data.groupIndex as number
  const duplicates = data.duplicates as DuplicateTab[]
  const { mutate: deduplicate, isPending } = useDeduplicateGroup()

  const handleConfirm = () => {
    deduplicate(
      {
        groupIndex,
        duplicates: duplicates.map(({ windowIndex, tabIndex, tab }) => ({ windowIndex, tabIndex, url: tab.url }))
      },
      { onSuccess: onClose }
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('modals.dedup.title')}</DialogTitle>
        <DialogDescription>
          {t('modals.dedup.description', { count: duplicates.length })}
        </DialogDescription>
      </DialogHeader>

      <ScrollArea className="max-h-48 mt-3 border border-border">
        <ul className="p-2 space-y-1">
          {duplicates.map(({ windowIndex, tabIndex, tab }) => (
            <li key={`${windowIndex}-${tabIndex}`} className="text-xs text-muted-foreground truncate px-1">
              {tab.title || tab.url}
            </li>
          ))}
        </ul>
      </ScrollArea>

      <div className="flex gap-2 mt-4">
        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={onClose}>
          {t('modals.dedup.cancel')}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="flex-1 text-xs"
          onClick={handleConfirm}
          disabled={isPending}
        >
          {t('modals.dedup.confirm', { count: duplicates.length })}
        </Button>
      </div>
    </>
  )
}
