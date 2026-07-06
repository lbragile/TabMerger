'use client'

import { useState } from 'react'
import Image from 'next/image'

interface DemoTab {
  title: string
  url: string
  initial: string
  color: string
}

interface DemoWindow {
  name: string
  starred?: boolean
  tabs: DemoTab[]
}

interface DemoGroup {
  id: number
  name: string
  dotColor: string
  windows: DemoWindow[]
}

const GROUPS: DemoGroup[] = [
  {
    id: 1,
    name: 'Work',
    dotColor: '#00B4CC',
    windows: [
      {
        name: 'Main',
        starred: true,
        tabs: [
          { title: 'Linear — Project Board', url: 'linear.app', initial: 'L', color: '#5E6AD2' },
          { title: 'Notion — Design Docs', url: 'notion.so', initial: 'N', color: '#000000' },
          { title: 'GitHub — Pull Requests', url: 'github.com', initial: 'G', color: '#24292F' },
        ],
      },
      {
        name: 'Design',
        tabs: [
          { title: 'Figma — UI Kit v2', url: 'figma.com', initial: 'F', color: '#A259FF' },
        ],
      },
    ],
  },
  {
    id: 2,
    name: 'Research',
    dotColor: '#F5921E',
    windows: [
      {
        name: 'Docs',
        tabs: [
          { title: 'MDN — CSS Grid Guide', url: 'developer.mozilla.org', initial: 'M', color: '#E66000' },
          { title: 'Next.js Documentation', url: 'nextjs.org', initial: 'N', color: '#000000' },
        ],
      },
      {
        name: 'Tools',
        tabs: [
          { title: 'Tailwind CSS — Docs', url: 'tailwindcss.com', initial: 'T', color: '#38BDF8' },
          { title: 'Supabase — Auth Guide', url: 'supabase.com', initial: 'S', color: '#3ECF8E' },
        ],
      },
    ],
  },
  {
    id: 3,
    name: 'Shopping',
    dotColor: '#8B5CF6',
    windows: [
      {
        name: 'Window',
        tabs: [
          { title: 'Amazon — Cart (3 items)', url: 'amazon.com', initial: 'A', color: '#FF9900' },
          { title: 'Notion — Wishlist 2025', url: 'notion.so', initial: 'N', color: '#000000' },
        ],
      },
    ],
  },
  {
    id: 4,
    name: 'Entertainment',
    dotColor: '#EF4444',
    windows: [
      {
        name: 'Window',
        tabs: [
          { title: 'YouTube — Watch Later', url: 'youtube.com', initial: 'Y', color: '#FF0000' },
          { title: 'Spotify — New Music Friday', url: 'spotify.com', initial: 'S', color: '#1DB954' },
          { title: 'Netflix — Continue Watching', url: 'netflix.com', initial: 'N', color: '#E50914' },
        ],
      },
    ],
  },
]

const totalTabs = GROUPS.reduce((acc, g) => acc + g.windows.reduce((a, w) => a + w.tabs.length, 0), 0)

function groupTabCount(group: DemoGroup) {
  return group.windows.reduce((acc, w) => acc + w.tabs.length, 0)
}

function parseSearch(raw: string): { inGroupQuery: string | null; tabQuery: string } {
  const inMatch = raw.match(/in:(\S+)/i)
  const inGroupQuery = inMatch ? inMatch[1].toLowerCase() : null
  const tabQuery = raw.replace(/in:\S+/i, '').trim().toLowerCase()
  return { inGroupQuery, tabQuery }
}

export function DemoSection() {
  const [activeGroupId, setActiveGroupId] = useState<number>(1)
  const [search, setSearch] = useState('')

  const activeGroup = GROUPS.find((g) => g.id === activeGroupId)!

  const { inGroupQuery, tabQuery } = parseSearch(search)

  // When in:X is present, show only the matched group (auto-selected via onChange).
  // When there is a plain tab query, show all groups so the user sees global dimming.
  // When there is no search, show only the active group.
  const isGlobalSearch = !inGroupQuery && tabQuery.length > 0
  const displayGroups = isGlobalSearch ? GROUPS : [activeGroup]

  return (
    <section className="py-16 overflow-x-auto">
      <div className="container">
        {/* Section label */}
        <div className="text-center mb-8">
          <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            Interactive preview
          </p>
          <h2 className="text-2xl font-bold">
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: 'linear-gradient(90deg, #00B4CC, #F5921E)' }}
            >
              Try it yourself
            </span>
            {' '}
            <span className="text-foreground">→</span>
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Click a group to explore, or search with in:group_name to filter globally.
          </p>
        </div>

        {/* Mock popup shell */}
        <div
          className="mx-auto flex flex-col rounded-2xl border shadow-xl overflow-hidden"
          style={{ maxWidth: 640, width: '100%', minHeight: 440 }}
        >
          {/* ── Top header bar ── */}
          <header
            className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
            style={{ background: '#1A1C21', borderBottom: '1px solid rgba(255,255,255,0.08)' }}
          >
            {/* Logo + title */}
            <div className="flex items-center gap-1.5 shrink-0">
              <Image src="/logo.png" alt="TabMerger" width={20} height={20} className="rounded" />
              <span className="text-sm font-semibold" style={{ background: 'linear-gradient(90deg,#00B4CC,#F5921E)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                TabMerger
              </span>
            </div>
            {/* Search */}
            <div className="relative flex-1">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3" style={{ color: 'rgba(255,255,255,0.35)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder='Search tabs... (try "in:work github")'
                value={search}
                onChange={(e) => {
                  const val = e.target.value
                  setSearch(val)
                  // Auto-select the first group whose name partially matches in:X
                  const { inGroupQuery } = parseSearch(val)
                  if (inGroupQuery) {
                    const matched = GROUPS.find((g) => g.name.toLowerCase().includes(inGroupQuery))
                    if (matched) setActiveGroupId(matched.id)
                  }
                }}
                className="w-full pl-7 pr-2 py-1 text-xs rounded-md outline-none"
                style={{ background: 'rgba(255,255,255,0.08)', color: 'white', border: '1px solid transparent' }}
                onFocus={(e) => { e.currentTarget.style.border = '1px solid rgba(0,180,204,0.6)'; e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}
                onBlur={(e) => { e.currentTarget.style.border = '1px solid transparent'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
              />
            </div>
            {/* Action stubs */}
            {['↩','↪','⚙'].map((icon, i) => (
              <div key={i} className="h-7 w-7 flex items-center justify-center rounded text-xs select-none" style={{ color: 'rgba(255,255,255,0.25)' }}>
                {icon}
              </div>
            ))}
            <div className="h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold ml-0.5" style={{ background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)' }}>
              TM
            </div>
          </header>

          {/* ── Body ── */}
          <div className="flex flex-1 min-h-0">

            {/* ── Sidebar ── */}
            <aside className="flex flex-col flex-shrink-0" style={{ width: 200, background: '#16181D', borderRight: '1px solid rgba(255,255,255,0.08)' }}>
              {/* Sidebar header */}
              <div className="flex items-center gap-2 px-3 py-2.5 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="flex-1 text-xs font-semibold text-white">Groups</span>
                <svg className="h-3.5 w-3.5" style={{ color: 'rgba(255,255,255,0.4)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </div>

              {/* Group list */}
              <nav className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-0.5">
                {GROUPS.map((group) => {
                  const isActive = group.id === activeGroupId
                  return (
                    <button
                      key={group.id}
                      onClick={() => { setActiveGroupId(group.id); setSearch('') }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left"
                      style={{ background: isActive ? 'rgba(255,255,255,0.12)' : 'transparent' }}
                      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
                      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                    >
                      <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: group.dotColor }} />
                      <span className="flex-1 truncate text-xs font-medium" style={{ color: isActive ? '#ffffff' : 'rgba(255,255,255,0.55)' }}>
                        {group.name}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}>
                        {groupTabCount(group)}
                      </span>
                    </button>
                  )
                })}
              </nav>

              {/* Sidebar footer */}
              <div className="px-3 py-2 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>{totalTabs} tabs saved</p>
              </div>
            </aside>

            {/* ── Windows panel ── */}
            <main className="flex-1 flex flex-col min-w-0" style={{ background: '#f9f9f9' }}>
              {/* Windows toolbar — shows active group info unless in global search mode */}
              <div className="flex items-center justify-between px-3 py-1.5 flex-shrink-0" style={{ background: 'white', borderBottom: '1px solid #efefef' }}>
                {isGlobalSearch ? (
                  <span className="text-xs" style={{ color: '#00B4CC' }}>
                    Searching all groups
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">
                    {activeGroup.windows.length} {activeGroup.windows.length === 1 ? 'window' : 'windows'}
                  </span>
                )}
                <div className="flex items-center gap-1">
                  <div className="flex items-center gap-0.5 px-2 py-0.5 rounded text-xs text-gray-500 hover:bg-gray-100 cursor-default select-none">
                    <span className="text-gray-400 mr-0.5">+</span>Window
                  </div>
                  <div className="h-5 w-5 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100 cursor-default text-base leading-none select-none">⋯</div>
                </div>
              </div>

              {/* Window cards — iterate over displayGroups (1 or all, depending on search mode) */}
              <div className="flex-1 overflow-y-auto px-3 py-2.5">
                {displayGroups.map((group) => (
                  <div key={group.id}>
                    {/* Group name separator shown only during global search */}
                    {isGlobalSearch && (
                      <div className="flex items-center gap-1.5 mb-1 mt-1 first:mt-0">
                        <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: group.dotColor }} />
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{group.name}</span>
                      </div>
                    )}
                    {group.windows.map((win, wi) => (
                      <div key={wi} className="rounded-md bg-white mb-2" style={{ border: '1px solid #e5e7eb', ...(win.starred ? { borderLeft: '2px solid #00B4CC' } : {}) }}>
                        {/* Window header */}
                        <div className="flex items-center gap-1 px-2 py-1" style={{ borderBottom: '1px solid #f3f4f6' }}>
                          {/* Grip stub */}
                          <svg className="h-3.5 w-3.5 flex-shrink-0" style={{ color: '#d1d5db' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h16M4 16h16" />
                          </svg>
                          <span className="flex-1 text-xs font-medium text-gray-700">{win.name}</span>
                          <span className="text-[10px] text-gray-400 mr-1">
                            {win.tabs.length} {win.tabs.length === 1 ? 'tab' : 'tabs'}
                          </span>
                          {/* Star */}
                          <svg className="h-3 w-3 flex-shrink-0" style={{ color: win.starred ? '#f59e0b' : '#d1d5db' }} viewBox="0 0 20 20" fill={win.starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.5}>
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                          </svg>
                          {/* More stub */}
                          <svg className="h-3 w-3 flex-shrink-0 ml-0.5" style={{ color: '#d1d5db' }} fill="currentColor" viewBox="0 0 20 20">
                            <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
                          </svg>
                        </div>

                        {/* Tab rows — non-matching tabs are dimmed to 0.3, not hidden,
                            mirroring the real extension's TabItem search behaviour. */}
                        <div className="py-0.5">
                          {win.tabs.map((tab, ti) => {
                            const isMatch = !tabQuery ||
                              tab.title.toLowerCase().includes(tabQuery) ||
                              tab.url.toLowerCase().includes(tabQuery)
                            return (
                              <div
                                key={ti}
                                className="group flex items-center gap-1.5 rounded px-1.5 py-0.5 mx-0.5 cursor-pointer transition-colors hover:bg-gray-50"
                                style={{ opacity: tabQuery && !isMatch ? 0.3 : 1 }}
                              >
                                {/* Favicon placeholder */}
                                <span
                                  className="h-3.5 w-3.5 rounded-sm flex-shrink-0 flex items-center justify-center text-[8px] font-bold text-white"
                                  style={{ background: tab.color }}
                                >
                                  {tab.initial}
                                </span>
                                <span className="flex-1 truncate text-xs text-gray-800 leading-5">
                                  {tab.title}
                                </span>
                                {/* × on hover */}
                                <span className="h-4 w-4 flex-shrink-0 rounded flex items-center justify-center text-gray-300 opacity-0 group-hover:opacity-100 hover:text-gray-500 hover:bg-gray-100 text-xs leading-none select-none">
                                  ×
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </main>

          </div>{/* body */}
        </div>{/* popup shell */}

        {/* Caption */}
        <p className="text-center text-xs text-muted-foreground mt-4">
          An interactive preview — try searching with in:group_name to filter by group.
        </p>
      </div>
    </section>
  )
}
