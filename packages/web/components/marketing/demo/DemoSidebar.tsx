'use client'

import { Plus } from 'lucide-react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Group } from '@tabmerger/shared'
import { DemoGroupRow } from './DemoGroupRow'
import { ZONE_BG, ZONE_BORDER, SIDEBAR_TEXT_MUTED } from './tokens'

export function DemoSidebar({
  groups,
  activeGroupId,
  sortableIds,
  onSelect,
  onRename,
  onAddGroup,
}: {
  groups: Group[]
  activeGroupId: string
  sortableIds: string[]
  onSelect: (id: string) => void
  onRename: (id: string, name: string) => void
  onAddGroup: () => void
}) {
  return (
    <aside className="flex flex-col flex-shrink-0" style={{ width: 210, background: ZONE_BG, borderRight: `1px solid ${ZONE_BORDER}` }}>
      <div className="flex items-center px-3 py-2 flex-shrink-0" style={{ borderBottom: `1px solid ${ZONE_BORDER}` }}>
        <span className="flex-1 text-xs font-semibold uppercase tracking-widest" style={{ color: SIDEBAR_TEXT_MUTED }}>
          Groups
        </span>
        <button
          type="button"
          onClick={onAddGroup}
          title="Add group"
          className="h-6 w-6 flex items-center justify-center transition-colors"
          style={{ color: SIDEBAR_TEXT_MUTED }}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-1.5 flex flex-col gap-0.5">
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          {groups.map((group) => (
            <DemoGroupRow
              key={group.id}
              group={group}
              sortableId={`group-${group.id}`}
              isActive={group.id === activeGroupId}
              onClick={() => onSelect(group.id)}
              onRename={(name) => onRename(group.id, name)}
            />
          ))}
        </SortableContext>
      </nav>
    </aside>
  )
}
