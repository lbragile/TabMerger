'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
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
import { Link } from '@/i18n/navigation'

interface SessionListProps {
  /**
   * The raw rows, for a list rendered on its own. Inside a `SavedSessionsProvider` (the dashboard
   * page) the rows come from it instead, so they are decrypted once for every section.
   */
  sessions?: RawSessionRow[]
  isPro: boolean
  /**
   * The account has no cloud sync (free, or a paid plan that is not active): its existing rows are
   * listed so they can still be opened or deleted, with a note that saving new ones needs Pro.
   * Nothing here writes rows, so read-only only changes the note.
   */
  readOnly?: boolean
}

/**
 * The sessions the user saved. Automatic backups (decrypted `auto === true`) are not listed here:
 * they have their own section (`BackupList`). A row that cannot be read stays in this list, as a
 * locked item, because its kind is unknown.
 */
export function SessionList({ sessions, isPro, readOnly = false }: SessionListProps) {
  const shared = useSavedSessionsOptional()
  if (shared) return <SessionListView isPro={isPro} readOnly={readOnly} />
  return (
    <SavedSessionsProvider sessions={sessions}>
      <SessionListView isPro={isPro} readOnly={readOnly} />
    </SavedSessionsProvider>
  )
}

function SessionListView({ isPro, readOnly }: { isPro: boolean; readOnly: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { status, sessions } = useSavedSessions()
  const t = useTranslations('dashboard.sessions')
  const passphrase = useTranslations('dashboard.passphrase')

  function handleRestore(session: SavedItem) {
    // Second guard behind the card's disabled control: an unreadable session has no readable tabs.
    if (session.locked || session.damaged) {
      toast.error(t('cantRestore'))
      return
    }
    // Only http(s) addresses are opened; a tab with any other kind of URL is skipped.
    const urls = session.groups
      .flatMap((g) => g.windows.flatMap((w) => w.tabs.map((t) => toHttpUrl(t.url))))
      .filter((url): url is string => url !== undefined)
    urls.forEach((url) => window.open(url, '_blank', 'noopener'))
    toast.success(t('restored', { count: urls.length, name: session.name }))
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`,{ method: 'DELETE' })
    if (res.ok) {
      toast.success(t('deleted'))
      startTransition(() => {
        router.refresh()
      })
    } else {
      toast.error(t('deleteFailed'))
    }
  }

  if (status === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <p>{t('loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => startTransition(() => router.refresh())} loading={isPending}>
          {t('tryAgain')}
        </Button>
      </div>
    )
  }

  if (status === 'checking' || status === 'locked') {
    return <PassphrasePrompt label={passphrase('sessionsLabel')} />
  }

  if (status === 'loading') {
    return (
      <div role="status" aria-label={t('loading')}>
        <Skeleton className="h-28 w-full max-w-sm" />
      </div>
    )
  }

  if (sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>
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
      {readOnly ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {t('readOnlyNote')}{' '}
          <Link href="/pricing" className="underline underline-offset-2 hover:no-underline">
            {t('upgrade')}
          </Link>
        </p>
      ) : !isPro && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t.rich('freeLimit', {
            count: FREE_TIER_LIMITS.sessions,
            link: (chunks) => (
              <Link href="/pricing" className="underline underline-offset-2 hover:no-underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}
    </div>
  )
}
