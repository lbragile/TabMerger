'use client'

import { useState, useEffect } from 'react'
import { LayoutGrid, List, Cloud, Share2, X, CheckSquare, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
// ponytail: inline minimal types — web doesn't depend on @tabmerger/shared
interface Tab { title?: string; url?: string; favIconUrl?: string }
interface ExtWindow { tabs: Tab[] }

interface DashboardGroup {
  id: string
  name: string
  color: string
  windows: ExtWindow[]
  updated_at: string
  public_slug?: string | null
}

interface GroupGridProps {
  groups: DashboardGroup[]
  isPro: boolean
}


function ShareButton({ groupId, initialSlug }: { groupId: string; initialSlug?: string | null }) {
  const [slug, setSlug] = useState(initialSlug ?? null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  async function publish() {
    setBusy(true)
    const res = await fetch(`/api/groups/${groupId}/publish`, { method: 'POST' })
    if (res.ok) {
      const { slug: s } = await res.json()
      setSlug(s)
    }
    setBusy(false)
  }

  async function unpublish() {
    setBusy(true)
    await fetch(`/api/groups/${groupId}/publish`, { method: 'DELETE' })
    setSlug(null)
    setBusy(false)
  }

  async function copyLink() {
    const url = `${window.location.origin}/share/${slug}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (slug) {
    return (
      <div className="flex items-center gap-1">
        <button onClick={copyLink} className="text-xs text-primary hover:underline">
          {copied ? 'Copied!' : 'Copy link'}
        </button>
        <button onClick={unpublish} disabled={busy} className="text-muted-foreground hover:text-destructive" title="Unpublish">
          <X className="w-3 h-3" />
        </button>
      </div>
    )
  }

  return (
    <button onClick={publish} disabled={busy} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary" title="Share group">
      <Share2 className="w-3 h-3" />
      {busy ? '…' : 'Share'}
    </button>
  )
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

function GroupCard({
  group,
  isPro,
  selecting,
  selected,
  onToggle,
}: {
  group: DashboardGroup
  isPro: boolean
  selecting: boolean
  selected: boolean
  onToggle: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const tabs = group.windows.flatMap((w) => w.tabs)

  return (
    <Card
      className={`overflow-hidden relative ${selecting ? 'cursor-pointer' : ''} ${selected ? 'ring-2 ring-primary' : ''}`}
      onClick={selecting ? () => onToggle(group.id) : undefined}
    >
      {selecting && (
        <button
          className="absolute top-2 right-2 z-10 text-muted-foreground hover:text-primary"
          onClick={(e) => { e.stopPropagation(); onToggle(group.id) }}
          aria-label={selected ? 'Deselect' : 'Select'}
        >
          {selected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
        </button>
      )}
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
        {!selecting && (
          <div className="flex items-center gap-3">
            {isPro && <ShareButton groupId={group.id} initialSlug={group.public_slug} />}
            {tabs.length > 0 && (
              <button
                onClick={() => setOpen((v) => !v)}
                className="text-xs text-primary hover:underline"
              >
                {open ? 'Hide tabs' : 'Show tabs'}
              </button>
            )}
          </div>
        )}
      </CardFooter>
    </Card>
  )
}

function GroupRow({
  group,
  isPro,
  selecting,
  selected,
  onToggle,
}: {
  group: DashboardGroup
  isPro: boolean
  selecting: boolean
  selected: boolean
  onToggle: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const tabs = group.windows.flatMap((w) => w.tabs)

  return (
    <div className={`rounded-lg border ${selected ? 'ring-2 ring-primary' : ''}`}>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50"
        onClick={selecting ? () => onToggle(group.id) : () => setOpen((v) => !v)}
      >
        {selecting && (
          <span className="shrink-0 text-muted-foreground">
            {selected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
          </span>
        )}
        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: group.color }} />
        <span className="font-medium text-sm flex-1 truncate">{group.name}</span>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="secondary" className="text-xs">
            {group.windows.length}w · {tabs.length}t
          </Badge>
          {isPro && <Cloud className="w-3 h-3 text-muted-foreground" />}
          {isPro && !selecting && <ShareButton groupId={group.id} initialSlug={group.public_slug} />}
          <span className="text-xs text-muted-foreground">{relativeTime(group.updated_at)}</span>
        </div>
      </div>
      {open && !selecting && tabs.length > 0 && (
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
  // SSR-safe: localStorage is not available on the server. Must start with a consistent
  // default and sync after mount — calling localStorage in useState initializer crashes SSR.
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === 'list') setView('list')
  }, [])

  function toggle(next: 'grid' | 'list') {
    setView(next)
    localStorage.setItem(STORAGE_KEY, next)
  }

  function toggleSelection(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function exitSelecting() {
    setSelecting(false)
    setSelected(new Set())
  }

  async function shareBundle() {
    if (selected.size === 0) return
    setSharing(true)
    try {
      const res = await fetch('/api/share-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupIds: [...selected] }),
      })
      if (!res.ok) throw new Error('Failed to create bundle')
      const { slug } = await res.json()
      const url = `${window.location.origin}/share/${slug}`
      await navigator.clipboard.writeText(url)
      toast.success('Link copied! Share page is live.')
      exitSelecting()
    } catch {
      toast.error('Could not create share link. Please try again.')
    } finally {
      setSharing(false)
    }
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
          {isPro && (
            <Button
              variant={selecting ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 text-xs"
              onClick={() => selecting ? exitSelecting() : setSelecting(true)}
            >
              {selecting ? 'Cancel' : 'Select'}
            </Button>
          )}
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
            <GroupCard
              key={g.id}
              group={g}
              isPro={isPro}
              selecting={selecting}
              selected={selected.has(g.id)}
              onToggle={toggleSelection}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map((g) => (
            <GroupRow
              key={g.id}
              group={g}
              isPro={isPro}
              selecting={selecting}
              selected={selected.has(g.id)}
              onToggle={toggleSelection}
            />
          ))}
        </div>
      )}

      {/* ponytail: floating bar — only rendered when items are selected */}
      {selecting && selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-popover border shadow-lg rounded-full px-4 py-2 z-50">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" onClick={shareBundle} disabled={sharing}>
            <Share2 className="w-4 h-4 mr-1" />
            {sharing ? 'Creating…' : 'Share selected'}
          </Button>
          <button onClick={exitSelecting} className="text-muted-foreground hover:text-foreground" aria-label="Cancel selection">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
