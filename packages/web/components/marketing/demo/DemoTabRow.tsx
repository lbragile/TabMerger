'use client'

import { X, GripVertical } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Tab } from '@tabmerger/shared'
import { faviconUrl } from './seedData'
import { SIDEBAR_TEXT_ACTIVE, SIDEBAR_TEXT_MUTED } from './tokens'

function domainOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export function DemoTabRow({
  tab,
  sortableId,
  onDelete,
}: {
  tab: Tab
  sortableId: string
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="group flex items-center gap-1.5 px-2 py-1.5 cursor-default transition-colors hover:bg-accent/50"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="opacity-0 group-hover:opacity-100 cursor-grab flex-shrink-0 transition-opacity"
        style={{ color: SIDEBAR_TEXT_MUTED }}
        title="Drag to reorder"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-700 overflow-hidden flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img role="img" src={faviconUrl(domainOf(tab.url))} alt="" className="h-3.5 w-3.5" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs truncate leading-tight" style={{ color: SIDEBAR_TEXT_ACTIVE }}>
          {tab.title}
        </p>
        <p className="text-[10px] truncate leading-tight" style={{ color: SIDEBAR_TEXT_MUTED }}>
          {tab.url}
        </p>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        className="opacity-0 group-hover:opacity-100 ml-auto transition-all flex-shrink-0 hover:text-red-500"
        style={{ color: SIDEBAR_TEXT_MUTED }}
        title="Close tab"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
