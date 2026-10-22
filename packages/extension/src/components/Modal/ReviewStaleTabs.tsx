import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const staleTabs = data.staleTabs as Tab[]
  const onRemoveAll = data.onRemoveAll as () => void | Promise<void>

  const handleRemoveAll = () => {
    void onRemoveAll()
    onClose()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('modals.staleTabs.title')}</DialogTitle>
        <DialogDescription>
          {t('modals.staleTabs.description', { count: staleTabs.length })}
        </DialogDescription>
      </DialogHeader>

      <ScrollArea className="max-h-48 mt-3 border border-border">
        <ul className="p-2 space-y-1">
          {staleTabs.map((tab) => (
            <li key={`${tab.id}-${tab.url}`} dir={tab.title ? 'auto' : 'ltr'} className="text-xs text-muted-foreground truncate text-ui-start px-1">
              {tab.title || tab.url}
            </li>
          ))}
        </ul>
      </ScrollArea>

      <div className="flex gap-2 mt-4">
        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={onClose}>
          {t('modals.staleTabs.close')}
        </Button>
        <Button variant="destructive" size="sm" className="flex-1 text-xs" onClick={handleRemoveAll}>
          {t('modals.staleTabs.removeAll', { count: staleTabs.length })}
        </Button>
      </div>
    </>
  )
}
