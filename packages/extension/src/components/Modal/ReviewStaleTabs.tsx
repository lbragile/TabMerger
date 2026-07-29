import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Tab } from '@/lib/types'

interface ReviewStaleTabsModalProps {
  data: Record<string, unknown>
  onClose: () => void
}

/** Lists stale tabs for review before bulk removal — opened by the "Review" button on
 * CleanupSuggestionBanner. Distinct from the per-group Clock icon in Windows/index.tsx,
 * which removes immediately (with its own confirm gate). */
export function ReviewStaleTabsModal({ data, onClose }: ReviewStaleTabsModalProps) {
  const staleTabs = data.staleTabs as Tab[]
  const onRemoveAll = data.onRemoveAll as () => void | Promise<void>

  const handleRemoveAll = () => {
    void onRemoveAll()
    onClose()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Stale tabs</DialogTitle>
        <DialogDescription>
          {staleTabs.length} {staleTabs.length === 1 ? 'tab has' : 'tabs have'} not been touched in a while.
        </DialogDescription>
      </DialogHeader>

      <ScrollArea className="max-h-48 mt-3 border border-border">
        <ul className="p-2 space-y-1">
          {staleTabs.map((tab) => (
            <li key={`${tab.id}-${tab.url}`} className="text-xs text-muted-foreground truncate px-1">
              {tab.title || tab.url}
            </li>
          ))}
        </ul>
      </ScrollArea>

      <div className="flex gap-2 mt-4">
        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={onClose}>
          Close
        </Button>
        <Button variant="destructive" size="sm" className="flex-1 text-xs" onClick={handleRemoveAll}>
          Remove {staleTabs.length} {staleTabs.length === 1 ? 'tab' : 'tabs'}
        </Button>
      </div>
    </>
  )
}
