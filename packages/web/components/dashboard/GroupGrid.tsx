'use client'

import { useState, useEffect, useMemo } from 'react'
import { LayoutGrid, List, Cloud, Share2, X, CheckSquare, Square, Star, ExternalLink, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { isEncryptedBlob, decryptBlob, type EncryptedBlob } from '@tabmerger/shared'
import { useEncryptionKey } from '@/lib/encryption/context'
import { PassphrasePrompt } from '@/components/dashboard/PassphrasePrompt'

interface Tab { title?: string; url?: string; favIconUrl?: string }
interface ExtWindow { tabs: Tab[] }

interface DashboardGroup {
  id: string
  name: string
  color: string
  windows: ExtWindow[]
  updated_at: string
  public_slug?: string | null
  starred?: boolean
}

/** Raw row shape from Supabase — `windows` (and `name`, when encrypted) is ciphertext until decrypted client-side. */
interface RawDashboardGroup extends Omit<DashboardGroup, 'windows'> {
  windows: ExtWindow[] | EncryptedBlob
}

interface EncryptedGroupContent {
  name: string
  windows: ExtWindow[]
  note?: string | null
  info?: string
}

interface GroupGridProps {
  groups: RawDashboardGroup[]
  isPro: boolean
}

/** Decrypts every encrypted-blob group with the session's data key. Groups that are
 * already plaintext (legacy rows, or before encryption setup completes) pass through. */
function useDecryptedGroups(groups: RawDashboardGroup[]) {
  const { dataKey } = useEncryptionKey()
  const [decrypted, setDecrypted] = useState<DashboardGroup[]>([])
  const hasEncrypted = useMemo(() => groups.some((g) => isEncryptedBlob(g.windows)), [groups])

  useEffect(() => {
    if (!hasEncrypted) {
      setDecrypted(groups as DashboardGroup[])
      return
    }
    if (!dataKey) return
    let cancelled = false
    ;(async () => {
      const results = await Promise.all(
        groups.map(async (g) => {
          if (!isEncryptedBlob(g.windows)) return g as DashboardGroup
          try {
            const content = await decryptBlob<EncryptedGroupContent>(dataKey, g.windows)
            return { ...g, name: content.name, windows: content.windows }
          } catch {
            // wrong/rotated key — fall back to a visibly-locked placeholder rather than crashing
            return { ...g, name: '(locked)', windows: [] }
          }
        })
      )
      if (!cancelled) setDecrypted(results)
    })()
    return () => {
      cancelled = true
    }
  }, [groups, hasEncrypted, dataKey])

  return { groups: decrypted, needsUnlock: hasEncrypted && !dataKey }
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
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={unpublish}
                disabled={busy}
                aria-label="Unpublish"
                className="text-muted-foreground hover:text-destructive rounded-md p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Unpublish — make this group private again</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    )
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={publish}
            disabled={busy}
            aria-label="Share group"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md border border-transparent hover:border-border transition-colors"
          >
            <Share2 className="w-3 h-3" />
            {busy ? '…' : 'Share'}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Make this group public and get a shareable link</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function openAllTabs(group: DashboardGroup) {
  group.windows.flatMap((w) => w.tabs).forEach((tab) => {
    if (tab.url) window.open(tab.url, '_blank', 'noopener')
  })
}

const STALE_MS = 30 * 24 * 60 * 60 * 1000
// ponytail: proxy for "tabs over 30 days old" — we only track updated_at per group, not
// per-tab age, so a recently-touched group with old tabs won't trigger this. Good enough for now.
function isStale(updatedAt: string) {
  return Date.now() - new Date(updatedAt).getTime() > STALE_MS
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
  const firstThree = tabs.slice(0, 3)
  const overflow = tabs.length - firstThree.length

  return (
    <div
      className={`rounded-lg border border-border overflow-hidden relative transition-shadow duration-200 hover:shadow-sh2 ${selecting ? 'cursor-pointer' : ''} ${selected ? 'ring-2 ring-primary' : ''}`}
      style={{
        borderLeft: `4px solid ${group.color}`,
        background: `linear-gradient(to right, ${group.color}14, transparent 40%), hsl(var(--surface))`,
      }}
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

      <div className="px-4 pt-3.5 pb-3">
        {/* Name + star */}
        <div className="flex items-center gap-1.5 mb-1">
          <span className="font-bold text-[15px] truncate flex-1">{group.name}</span>
          {group.starred && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />}
        </div>

        {/* Meta */}
        <p className="text-xs text-muted-foreground mb-3">
          {group.windows.length} {group.windows.length === 1 ? 'window' : 'windows'} ·{' '}
          {tabs.length} {tabs.length === 1 ? 'tab' : 'tabs'}
          {isPro && ` · synced ${relativeTime(group.updated_at)}`}
          {!isPro && ` · ${relativeTime(group.updated_at)}`}
        </p>

        {isStale(group.updated_at) && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 mb-3">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            Tabs may be stale — last synced over 30 days ago
          </div>
        )}

        {/* Expanded tabs — CSS grid-rows trick for a smooth height animation without measuring content */}
        {tabs.length > 0 && (
          <div
            className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'grid-rows-[1fr] mb-3' : 'grid-rows-[0fr]'}`}
          >
            <ul className="overflow-hidden space-y-1">
              {firstThree.map((tab, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground truncate">
                  <span className="w-4 h-4 shrink-0 rounded-sm bg-muted flex items-center justify-center text-[9px] font-bold uppercase">
                    {(tab.title ?? tab.url ?? '?').charAt(0)}
                  </span>
                  <span className="truncate">{tab.title || tab.url}</span>
                </li>
              ))}
              {overflow > 0 && (
                <li className="text-xs text-muted-foreground pl-6">+{overflow} more</li>
              )}
            </ul>
          </div>
        )}

        {/* Action row */}
        {!selecting && (
          <div className="flex items-center gap-1">
            {isPro && <ShareButton groupId={group.id} initialSlug={group.public_slug} />}
            {tabs.length > 0 && (
              <button
                onClick={() => openAllTabs(group)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md border border-transparent hover:border-border transition-colors"
                title="Open all tabs in this group"
              >
                <ExternalLink className="w-3 h-3" />
                Open all
              </button>
            )}
            {tabs.length > 0 && (
              <button
                onClick={() => setOpen((v) => !v)}
                className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md border border-transparent hover:border-border transition-colors"
              >
                {open ? 'Hide tabs' : 'Show tabs'}
              </button>
            )}
            {isPro && <Cloud className="w-3 h-3 text-primary/60 ml-auto" />}
          </div>
        )}
      </div>
    </div>
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
    <div className={`rounded-lg border border-border ${selected ? 'ring-2 ring-primary' : ''}`}>
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
        <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
          <span>{group.windows.length}w · {tabs.length}t</span>
          {isPro && <Cloud className="w-3 h-3" />}
          {isPro && !selecting && <ShareButton groupId={group.id} initialSlug={group.public_slug} />}
          {!selecting && tabs.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); openAllTabs(group) }}
              className="flex items-center gap-1 hover:text-foreground"
              title="Open all tabs in this group"
            >
              <ExternalLink className="w-3 h-3" />
              Open all
            </button>
          )}
          <span>{relativeTime(group.updated_at)}</span>
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

export function GroupGrid({ groups: rawGroups, isPro }: GroupGridProps) {
  const { groups, needsUnlock } = useDecryptedGroups(rawGroups)
  // SSR-safe: localStorage is not available on the server. Must start with a consistent
  // default and sync after mount — calling localStorage in useState initializer crashes SSR.
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sharing, setSharing] = useState(false)
  const [sort, setSort] = useState<'recent' | 'name' | 'tabCount'>('recent')

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
      const { slug, key } = await res.json()
      // Key lives only in the URL fragment — never sent to any server (fragments
      // aren't transmitted over HTTP), so the share link itself is the only place it exists.
      const url = `${window.location.origin}/share/${slug}#key=${key}`
      await navigator.clipboard.writeText(url)
      toast.success('Link copied! Share page is live.')
      exitSelecting()
    } catch {
      toast.error('Could not create share link. Please try again.')
    } finally {
      setSharing(false)
    }
  }

  // Total tab count across all groups
  const totalTabs = groups.reduce(
    (sum, g) => sum + g.windows.reduce((ws, w) => ws + w.tabs.length, 0),
    0
  )

  const tabCountOf = (g: DashboardGroup) => g.windows.reduce((ws, w) => ws + w.tabs.length, 0)
  const sortedGroups = [...groups].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name)
    if (sort === 'tabCount') return tabCountOf(b) - tabCountOf(a)
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  })

  if (needsUnlock) {
    return <PassphrasePrompt label="Your groups are end-to-end encrypted. Enter your passphrase to view them here." />
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
      {/* Page header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="font-bold" style={{ fontSize: '24px' }}>Groups</h3>
          <span className="text-sm text-muted-foreground">
            {groups.length} {groups.length === 1 ? 'group' : 'groups'} · {totalTabs} tabs
          </span>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Sort
            <select
              aria-label="Sort groups"
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
            >
              <option value="recent">Recent</option>
              <option value="name">Name</option>
              <option value="tabCount">Tab count</option>
            </select>
          </label>
        </div>
        <div className="flex items-center gap-1">
          {isPro && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => selecting ? exitSelecting() : setSelecting(true)}
            >
              {selecting ? 'Cancel' : 'Select'}
            </Button>
          )}
          {/* Grid/List segmented toggle */}
          <div className="flex rounded-sm border border-border overflow-hidden ml-1">
            <button
              onClick={() => toggle('grid')}
              className={`p-1.5 ${view === 'grid' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}
              aria-label="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => toggle('list')}
              className={`p-1.5 ${view === 'list' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}
              aria-label="List view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {view === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedGroups.map((g) => (
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
          {sortedGroups.map((g) => (
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
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-popover border shadow-lg rounded-none px-4 py-2 z-50">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" className="rounded-none" onClick={shareBundle} disabled={sharing}>
            <Share2 className="w-4 h-4 mr-1" />
            {sharing ? 'Creating…' : 'Share selected'}
          </Button>
          <button onClick={exitSelecting} className="text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Cancel selection">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
