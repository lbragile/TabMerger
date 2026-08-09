import { useState } from 'react'
import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Group } from '@/lib/types'

const FALLBACK_FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='2' fill='%23e5e7eb'/%3E%3Cpath d='M4 6h8M4 10h6' stroke='%239ca3af' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E"

interface ReviewStaleGroupModalProps {
  data: Record<string, unknown>
  onClose: () => void
}

function tabCountOf(group: Group) {
  return group.windows.reduce((sum, w) => sum + w.tabs.length, 0)
}

/** Read-only preview of every stale group flagged by the AI suggestion banner's "Review"
 * button — lets the user expand each group to see its actual tabs before trusting the AI's
 * staleness judgment, and archive individual groups right from the list. Replaces the
 * earlier single-group version now that the banner has one "Review" CTA for all stale
 * groups instead of a per-row button. */
export function ReviewStaleGroupModal({ data, onClose }: ReviewStaleGroupModalProps) {
  const groups = data.groups as Group[]
  const onArchive = data.onArchive as (groupId: string) => void | Promise<void>
  const [expandedId, setExpandedId] = useState<string | null>(groups.length === 1 ? groups[0].id : null)

  return (
    <>
      <DialogHeader>
        <DialogTitle>Review stale groups</DialogTitle>
        <DialogDescription>
          {groups.length} group{groups.length === 1 ? '' : 's'} untouched for a while — expand to preview, or archive directly.
        </DialogDescription>
      </DialogHeader>

      <ScrollArea className="max-h-80 mt-3 border border-border">
        <div className="p-2 space-y-2">
          {groups.map((group) => {
            const expanded = expandedId === group.id
            const tabCount = tabCountOf(group)
            return (
              <div key={group.id} className="border border-border">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                  <button
                    className="flex-1 min-w-0 text-left"
                    onClick={() => setExpandedId(expanded ? null : group.id)}
                  >
                    <p className="text-xs font-medium truncate">{group.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {group.windows.length} window{group.windows.length === 1 ? '' : 's'} · {tabCount} tab{tabCount === 1 ? '' : 's'}
                    </p>
                  </button>
                  <Button variant="outline" size="sm" className="text-xs shrink-0" onClick={() => setExpandedId(expanded ? null : group.id)}>
                    {expanded ? 'Hide' : 'Preview'}
                  </Button>
                  <Button variant="destructive" size="sm" className="text-xs shrink-0" onClick={() => void onArchive(group.id)}>
                    Archive
                  </Button>
                </div>
                {expanded && (
                  <div className="px-2 pb-2 space-y-2">
                    {group.windows.map((w, wi) => (
                      <div key={w.id ?? wi}>
                        <p className="text-[10px] font-medium text-muted-foreground px-1 mb-1">
                          {w.name || `Window ${wi + 1}`}
                        </p>
                        <ul className="space-y-1">
                          {w.tabs.map((tab, ti) => (
                            <li key={`${tab.id}-${ti}`} className="flex items-center gap-1.5 px-1 min-w-0">
                              <img
                                src={tab.favIconUrl || FALLBACK_FAVICON}
                                alt=""
                                className="h-3.5 w-3.5 shrink-0 rounded-full"
                                onError={(e) => { e.currentTarget.src = FALLBACK_FAVICON }}
                              />
                              <span className="truncate text-xs">{tab.title || tab.url}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {group.windows.length === 0 && (
                      <p className="text-xs text-muted-foreground px-1">This group is empty.</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </ScrollArea>

      <div className="flex gap-2 mt-4">
        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={onClose}>
          Close
        </Button>
      </div>
    </>
  )
}
