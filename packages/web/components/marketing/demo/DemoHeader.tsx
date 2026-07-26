'use client'

import { Search } from 'lucide-react'
import { ZONE_BG, ZONE_BORDER, SIDEBAR_TEXT_MUTED, SIDEBAR_TEXT_ACTIVE } from './tokens'

export function DemoHeader() {
  return (
    <div
      className="grid items-center flex-shrink-0"
      style={{
        gridTemplateColumns: '210px 1fr',
        background: ZONE_BG,
        borderBottom: `1px solid ${ZONE_BORDER}`,
        padding: '8px 12px',
      }}
    >
      <span className="text-xs font-bold" style={{ color: SIDEBAR_TEXT_ACTIVE }}>
        TabMerger
      </span>
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-sm" style={{ background: 'rgba(0,0,0,0.04)' }}>
        <Search className="h-3 w-3" style={{ color: SIDEBAR_TEXT_MUTED }} />
        <input
          disabled
          placeholder="Search tabs and groups…"
          className="flex-1 bg-transparent text-[11px] outline-none cursor-default"
          style={{ color: SIDEBAR_TEXT_MUTED }}
        />
      </div>
    </div>
  )
}
