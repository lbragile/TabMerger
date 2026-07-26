'use client'

import { useState, useRef, useEffect } from 'react'
import { GripVertical, Check, X } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Group } from '@tabmerger/shared'
import { groupTabCount } from './seedData'
import { SIDEBAR_TEXT_ACTIVE, SIDEBAR_TEXT_INACTIVE, SIDEBAR_TEXT_MUTED, SIDEBAR_BADGE_BG, SIDEBAR_HOVER_BG } from './tokens'

export function DemoGroupRow({
  group,
  sortableId,
  isActive,
  onClick,
  onRename,
  autoRename = false,
}: {
  group: Group
  sortableId: string
  isActive: boolean
  onClick: () => void
  onRename: (name: string) => void
  // ponytail: only newly-added groups pass true, so a fresh component instance opens
  // straight into rename mode — matches the real popup's handleNewGroup UX
  autoRename?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    disabled: group.permanent,
  })
  const [renaming, setRenaming] = useState(autoRename && !group.permanent)
  const [value, setValue] = useState(group.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) inputRef.current?.focus()
  }, [renaming])

  function commit() {
    const trimmed = value.trim()
    if (trimmed) onRename(trimmed)
    setRenaming(false)
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="group flex items-center gap-2 px-2.5 py-2 transition-colors"
    >
      {!group.permanent && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="opacity-0 group-hover:opacity-100 cursor-grab flex-shrink-0 transition-opacity"
          style={{ color: SIDEBAR_TEXT_MUTED }}
        >
          <GripVertical className="h-3 w-3" />
        </button>
      )}
      <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: group.color }} />

      {renaming ? (
        <div className="flex-1 flex items-center gap-1">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setRenaming(false)
            }}
            className="flex-1 text-xs bg-transparent border-b outline-none"
            style={{ color: SIDEBAR_TEXT_ACTIVE }}
          />
          <button type="button" onClick={commit} title="Confirm rename">
            <Check className="h-3 w-3" style={{ color: SIDEBAR_TEXT_MUTED }} />
          </button>
          <button type="button" onClick={() => setRenaming(false)} title="Cancel rename">
            <X className="h-3 w-3" style={{ color: SIDEBAR_TEXT_MUTED }} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onClick}
          onDoubleClick={() => {
            if (group.permanent) return
            setValue(group.name)
            setRenaming(true)
          }}
          className="flex-1 flex items-center gap-2 text-left min-w-0"
          style={{
            background: isActive ? 'rgba(255,255,255,0.5)' : 'transparent',
            borderLeft: isActive ? `3px solid ${group.color}` : '3px solid transparent',
          }}
          onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = SIDEBAR_HOVER_BG }}
          onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >
          <span className="flex-1 truncate text-xs font-medium" style={{ color: isActive ? SIDEBAR_TEXT_ACTIVE : SIDEBAR_TEXT_INACTIVE }}>
            {group.name}
          </span>
        </button>
      )}

      <span className="text-[10px] px-1.5 py-0.5 flex-shrink-0" style={{ background: SIDEBAR_BADGE_BG, color: SIDEBAR_TEXT_MUTED }}>
        {groupTabCount(group)}
      </span>
    </div>
  )
}
