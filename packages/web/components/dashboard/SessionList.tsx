'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { toHttpUrl, FREE_TIER_LIMITS } from '@tabmerger/shared'
import { PassphrasePrompt } from '@/components/dashboard/PassphrasePrompt'
import {
  SavedSessionsProvider,
  useSavedSessions,
  useSavedSessionsOptional,
  type RawSessionRow,
} from '@/components/dashboard/SavedSessionsProvider'
import { countTabs, countWindows, type SavedItem } from '@/lib/savedSessions'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SessionCard } from './SessionCard'
import Link from 'next/link'

interface SessionListProps {
  /**
   * The raw rows, for a list rendered on its own. Inside a `SavedSessionsProvider` (the dashboard
   * page) the rows come from it instead, so they are decrypted once for every section.
   */
  sessions?: RawSessionRow[]
  isPro: boolean
}

/**
 * The sessions the user saved. Automatic backups (decrypted `auto === true`) are not listed here:
 * they have their own section (`BackupList`). A row that cannot be read stays in this list, as a
 * locked item, because its kind is unknown.
 */
export function SessionList({ sessions, isPro }: SessionListProps) {
  const shared = useSavedSessionsOptional()
  if (shared) return <SessionListView isPro={isPro} />
  return (
    <SavedSessionsProvider sessions={sessions}>
      <SessionListView isPro={isPro} />
    </SavedSessionsProvider>
  )
}

function SessionListView({ isPro }: { isPro: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { status, sessions } = useSavedSessions()

  function handleRestore(session: SavedItem) {
    // Second guard behind the card's disabled control: an unreadable session has no readable tabs.
    if (session.locked || session.damaged) {
      toast.error("This session can't be read, so it can't be restored.")
      return
    }
    // Only http(s) addresses are opened; a tab with any other kind of URL is skipped.
    const urls = session.groups
      .flatMap((g) => g.windows.flatMap((w) => w.tabs.map((t) => toHttpUrl(t.url))))
      .filter((url): url is string => url !== undefined)
    urls.forEach((url) => window.open(url, '_blank', 'noopener'))
    toast.success(`Restored ${urls.length} tab${urls.length === 1 ? '' : 's'} from "${session.name}"`)
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`,{ method: 'DELETE' })
    if (res.ok) {
      toast.success('Session deleted')
      startTransition(() => {
        router.refresh()
      })
    } else {
      toast.error('Failed to delete session')
    }
  }

  if (status === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <p>Your sessions could not be loaded.</p>
        <Button variant="outline" size="sm" onClick={() => startTransition(() => router.refresh())} loading={isPending}>
          Try again
        </Button>
      </div>
    )
  }

  if (status === 'checking' || status === 'locked') {
    return <PassphrasePrompt label="Your sessions are end-to-end encrypted. Enter your passphrase to view them here." />
  }

  if (status === 'loading') {
    return (
      <div role="status" aria-label="Loading sessions">
        <Skeleton className="h-28 w-full max-w-sm" />
      </div>
    )
  }

  if (sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">No saved sessions yet.</p>
  }

  return (
    <div className={isPending ? 'opacity-70 pointer-events-none' : ''}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 min-w-0">
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            id={session.id}
            name={session.name}
            description={session.description}
            groups={session.groups}
            groupCount={session.groups.length}
            windowCount={countWindows(session.groups)}
            tabCount={countTabs(session.groups)}
            createdAt={session.created_at}
            locked={session.locked}
            damaged={session.damaged}
            onRestore={() => handleRestore(session)}
            onDelete={handleDelete}
          />
        ))}
      </div>
      {!isPro && (
        <p className="mt-3 text-xs text-muted-foreground">
          Free plan: up to {FREE_TIER_LIMITS.sessions} sessions.{' '}
          <Link href="/pricing" className="underline underline-offset-2 hover:no-underline">
            Upgrade to Pro
          </Link>{' '}
          for unlimited.
        </p>
      )}
    </div>
  )
}
