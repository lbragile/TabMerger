'use client'

import { useState, useRef, useEffect } from 'react'
import { Star, Trash2, GripVertical, Check, X } from 'lucide-react'
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ExtWindow } from '@tabmerger/shared'
import { DemoTabRow } from './DemoTabRow'
import { SIDEBAR_TEXT_INACTIVE, SIDEBAR_TEXT_MUTED, SIDEBAR_TEXT_SUBTLE, BORDER } from './tokens'

export function DemoWindowCard({
  window,
  groupColor,
  sortableId,
  onStarToggle,
  onDelete,
  onRename,
  onTabDelete,
  canDelete,
}: {
  window: ExtWindow
  groupColor: string
  sortableId: string
  onStarToggle: () => void
  onDelete: () => void
  onRename: (name: string) => void
  onTabDelete: (tabId: number) => void
  canDelete: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
  })
  const [renaming, setRenaming] = useState(false)
  const [value, setValue] = useState(window.name ?? 'Window')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) inputRef.current?.focus()
  }, [renaming])

  function commit() {
    const trimmed = value.trim()
    if (trimmed) onRename(trimmed)
    setRenaming(false)
  }

  const tabSortIds = window.tabs.map((t) => `tab-${window.id}-${t.id}`)

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        border: `1px solid ${BORDER}`,
        borderLeft: window.starred ? `2px solid ${groupColor}` : `1px solid ${BORDER}`,
      }}
      className="group/win overflow-hidden bg-white dark:bg-zinc-900"
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="opacity-0 group-hover/win:opacity-100 cursor-grab flex-shrink-0 transition-opacity"
          style={{ color: SIDEBAR_TEXT_MUTED }}
          title="Drag to reorder"
        >
          <GripVertical className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onStarToggle}
          className="flex-shrink-0 transition-colors"
          title={window.starred ? 'Unstar window' : 'Star window'}
        >
          <Star
            className="h-3.5 w-3.5"
            fill={window.starred ? groupColor : 'none'}
            style={{ color: window.starred ? groupColor : SIDEBAR_TEXT_SUBTLE }}
          />
        </button>

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
              style={{ color: SIDEBAR_TEXT_INACTIVE, borderColor: BORDER }}
            />
            <button type="button" onClick={commit} title="Confirm rename">
              <Check className="h-3 w-3" style={{ color: SIDEBAR_TEXT_MUTED }} />
            </button>
            <button type="button" onClick={() => setRenaming(false)} title="Cancel rename">
              <X className="h-3 w-3" style={{ color: SIDEBAR_TEXT_MUTED }} />
            </button>
          </div>
        ) : (
          <span
            className="flex-1 text-xs font-medium cursor-text"
            style={{ color: SIDEBAR_TEXT_INACTIVE }}
            onDoubleClick={() => {
              setValue(window.name ?? 'Window')
              setRenaming(true)
            }}
          >
            {window.name ?? 'Window'}
          </span>
        )}

        <span className="text-[10px]" style={{ color: SIDEBAR_TEXT_MUTED }}>
          {window.tabs.length} {window.tabs.length === 1 ? 'tab' : 'tabs'}
        </span>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="flex-shrink-0 h-5 w-5 flex items-center justify-center opacity-0 group-hover/win:opacity-100 transition-all hover:bg-red-50"
            style={{ color: SIDEBAR_TEXT_MUTED }}
            title="Remove window"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="px-1 py-0.5">
        {window.tabs.length === 0 && (
          <p className="text-[10px] px-2 py-1.5 italic" style={{ color: SIDEBAR_TEXT_SUBTLE }}>
            Empty window
          </p>
        )}
        <SortableContext items={tabSortIds} strategy={verticalListSortingStrategy}>
          {window.tabs.map((tab) => (
            <DemoTabRow
              key={tab.id}
              tab={tab}
              sortableId={`tab-${window.id}-${tab.id}`}
              onDelete={() => onTabDelete(tab.id)}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  )
}
