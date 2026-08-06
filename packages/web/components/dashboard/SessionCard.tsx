'use client'

import { Button } from '@/components/ui/button'

// ponytail: inline datetime format — no need for full Intl config overhead
const formatDateTime = (date: string) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(date))

const p = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

interface SessionTab {
  url: string
  title?: string
}

interface SessionWindow {
  tabs?: SessionTab[]
}

interface SessionGroup {
  name?: string
  color?: string
  windows?: SessionWindow[]
}

interface SessionCardProps {
  id: string
  name: string
  description?: string | null
  groups?: SessionGroup[]
  groupCount: number
  windowCount: number
  tabCount: number
  createdAt: string
  onDelete?: (id: string) => void
  onRestore?: (id: string) => void
}

export function SessionCard({
  id,
  name,
  description,
  groups,
  groupCount,
  windowCount,
  tabCount,
  createdAt,
  onDelete,
  onRestore,
}: SessionCardProps) {
  return (
    <div className="border border-border rounded-lg overflow-hidden bg-surface flex flex-col md:flex-row transition-shadow duration-200 hover:shadow-sh2">
      {/* Left panel */}
      <div className="flex-1 p-4">
        <h3 className="font-bold mb-2" style={{ fontSize: '17px' }}>{name}</h3>
        <div className="flex gap-2 mb-2">
          <span className="text-[12px] bg-surface3 px-2 py-0.5 rounded-md">{p(groupCount, 'group')}</span>
          <span className="text-[12px] bg-surface3 px-2 py-0.5 rounded-md">{p(windowCount ?? 0, 'window')}</span>
          <span className="text-[12px] bg-surface3 px-2 py-0.5 rounded-md">{p(tabCount, 'tab')}</span>
        </div>
        {groups && groups.length > 0 && tabCount > 0 && (
          <div className="flex h-1.5 w-full rounded-full overflow-hidden mb-2">
            {groups.map((group, i) => {
              const groupTabs = (group.windows ?? []).reduce((s, w) => s + (w.tabs?.length ?? 0), 0)
              return (
                <div
                  key={i}
                  data-testid="progress-segment"
                  style={{
                    width: `${(groupTabs / tabCount) * 100}%`,
                    background: group.color ?? 'var(--color-divider)',
                  }}
                />
              )
            })}
          </div>
        )}
        <p className="text-[12px] text-muted-foreground mb-3">{formatDateTime(createdAt)}</p>
        {description && (
          <p className="text-[12px] italic text-muted-foreground mb-3">{description}</p>
        )}
        <div className="flex gap-2">
          {onRestore && (
            <Button size="sm" onClick={() => onRestore(id)}>Restore session</Button>
          )}
          {onDelete && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(id)}
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Right panel — contents */}
      {groups && groups.length > 0 && (
        <div className="w-full md:w-[280px] border-t-2 md:border-t-0 md:border-l-2 border-border p-4 shrink-0">
          <h6 className="text-[11px] uppercase font-semibold text-muted-foreground mb-3">Contents</h6>
          {groups.slice(0, 3).map((group, i) => {
            const allTabs = (group.windows ?? []).flatMap((w) => w.tabs ?? [])
            return (
              <div key={i} className="mb-3">
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="rounded-sm shrink-0"
                    style={{ width: '56px', height: '14px', background: group.color ?? 'var(--color-divider)' }}
                  />
                  <span className="font-bold text-[12px] truncate flex-1">{group.name ?? `Group ${i + 1}`}</span>
                  <span className="text-[11px] text-muted-foreground ml-auto shrink-0">{allTabs.length} tabs</span>
                </div>
                {allTabs.slice(0, 2).map((tab, j) => (
                  <p key={j} className="text-[11px] text-muted-foreground truncate pl-2">{tab.title || tab.url}</p>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
