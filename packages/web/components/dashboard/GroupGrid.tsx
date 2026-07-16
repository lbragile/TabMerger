'use client'

import { useState } from 'react'
import { LayoutGrid, List, Cloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
// ponytail: inline minimal types — web doesn't depend on @tabmerger/shared
interface Tab { title?: string; url?: string; favIconUrl?: string }
interface ExtWindow { tabs: Tab[] }

interface DashboardGroup {
  id: string
  name: string
  color: string
  windows: ExtWindow[]
  updated_at: string
}

interface GroupGridProps {
  groups: DashboardGroup[]
  isPro: boolean
}


function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function GroupCard({ group, isPro }: { group: DashboardGroup; isPro: boolean }) {
  const [open, setOpen] = useState(false)
  const tabs = group.windows.flatMap((w) => w.tabs)

  return (
    <Card className="overflow-hidden">
      {/* color accent bar */}
      <div className="h-1" style={{ background: group.color }} />
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full shrink-0"
            style={{ background: group.color }}
          />
          <span className="font-medium text-sm truncate">{group.name}</span>
        </div>
        <div className="flex gap-2 mt-1">
          <Badge variant="secondary" className="text-xs">
            {group.windows.length} {group.windows.length === 1 ? 'window' : 'windows'}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {tabs.length} {tabs.length === 1 ? 'tab' : 'tabs'}
          </Badge>
        </div>
      </CardHeader>

      {open && tabs.length > 0 && (
        <CardContent className="px-4 pb-2">
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {tabs.map((tab, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground truncate">
                {tab.favIconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tab.favIconUrl} alt="" className="w-3 h-3 shrink-0" />
                ) : (
                  <span className="w-3 h-3 shrink-0 rounded-sm bg-muted" />
                )}
                <span className="truncate">{tab.title || tab.url}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      )}

      <CardFooter className="px-4 pb-3 pt-1 flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {isPro && <Cloud className="w-3 h-3" />}
          {isPro ? `Synced ${relativeTime(group.updated_at)}` : relativeTime(group.updated_at)}
        </div>
        {tabs.length > 0 && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-xs text-primary hover:underline"
          >
            {open ? 'Hide tabs' : 'Show tabs'}
          </button>
        )}
      </CardFooter>
    </Card>
  )
}

function GroupRow({ group, isPro }: { group: DashboardGroup; isPro: boolean }) {
  const [open, setOpen] = useState(false)
  const tabs = group.windows.flatMap((w) => w.tabs)

  return (
    <div className="rounded-lg border">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: group.color }} />
        <span className="font-medium text-sm flex-1 truncate">{group.name}</span>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="secondary" className="text-xs">
            {group.windows.length}w · {tabs.length}t
          </Badge>
          {isPro && <Cloud className="w-3 h-3 text-muted-foreground" />}
          <span className="text-xs text-muted-foreground">{relativeTime(group.updated_at)}</span>
        </div>
      </div>
      {open && tabs.length > 0 && (
        <div className="border-t px-4 py-2">
          <ul className="space-y-1">
            {tabs.map((tab, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground truncate">
                {tab.favIconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tab.favIconUrl} alt="" className="w-3 h-3 shrink-0" />
                ) : (
                  <span className="w-3 h-3 shrink-0 rounded-sm bg-muted" />
                )}
                <span className="truncate">{tab.title || tab.url}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

const STORAGE_KEY = 'tm-dashboard-view'

export function GroupGrid({ groups, isPro }: GroupGridProps) {
  const [view, setView] = useState<'grid' | 'list'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem(STORAGE_KEY) as 'grid' | 'list') ?? 'grid'
    }
    return 'grid'
  })

  function toggle(next: 'grid' | 'list') {
    setView(next)
    localStorage.setItem(STORAGE_KEY, next)
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No synced groups yet. Open the extension to create tab groups.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">{groups.length} groups</span>
        <div className="flex gap-1">
          <Button
            variant={view === 'grid' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-8 w-8"
            onClick={() => toggle('grid')}
            aria-label="Grid view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={view === 'list' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-8 w-8"
            onClick={() => toggle('list')}
            aria-label="List view"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {view === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((g) => (
            <GroupCard key={g.id} group={g} isPro={isPro} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map((g) => (
            <GroupRow key={g.id} group={g} isPro={isPro} />
          ))}
        </div>
      )}
    </div>
  )
}
