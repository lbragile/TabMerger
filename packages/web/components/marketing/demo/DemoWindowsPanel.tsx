'use client'

import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Group } from '@tabmerger/shared'
import { DemoWindowCard } from './DemoWindowCard'
import { groupTabCount } from './seedData'
import { SIDEBAR_TEXT_MUTED, BORDER } from './tokens'

export function DemoWindowsPanel({
  group,
  windowSortableIds,
  onWindowStarToggle,
  onWindowDelete,
  onWindowRename,
  onTabDelete,
}: {
  group: Group
  windowSortableIds: string[]
  onWindowStarToggle: (windowId: number) => void
  onWindowDelete: (windowId: number) => void
  onWindowRename: (windowId: number, name: string) => void
  onTabDelete: (windowId: number, tabId: number) => void
}) {
  return (
    <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-zinc-900">
      <div className="flex items-center px-3 py-2.5 flex-shrink-0" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <span className="text-xs flex-1" style={{ color: SIDEBAR_TEXT_MUTED }}>
          {group.windows.length} {group.windows.length === 1 ? 'window' : 'windows'} · {groupTabCount(group)} tabs
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
        <SortableContext items={windowSortableIds} strategy={verticalListSortingStrategy}>
          {group.windows.map((win) => (
            <DemoWindowCard
              key={win.id}
              window={win}
              groupColor={group.color}
              sortableId={`window-${win.id}`}
              onStarToggle={() => onWindowStarToggle(win.id)}
              onDelete={() => onWindowDelete(win.id)}
              onRename={(name) => onWindowRename(win.id, name)}
              onTabDelete={(tabId) => onTabDelete(win.id, tabId)}
              canDelete={group.windows.length > 1}
            />
          ))}
        </SortableContext>
      </div>
    </main>
  )
}
