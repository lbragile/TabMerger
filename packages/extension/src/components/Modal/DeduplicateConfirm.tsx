import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
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
        <DialogTitle>Remove duplicates</DialogTitle>
        <DialogDescription>
          {duplicates.length} duplicate {duplicates.length === 1 ? 'tab' : 'tabs'} will be removed.
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
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="flex-1 text-xs"
          onClick={handleConfirm}
          disabled={isPending}
        >
          Remove {duplicates.length} {duplicates.length === 1 ? 'duplicate' : 'duplicates'}
        </Button>
      </div>
    </>
  )
}
