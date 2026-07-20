'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { SessionCard } from './SessionCard'
import { Button } from '@/components/ui/button'
import { PlusCircle } from 'lucide-react'
import Link from 'next/link'

interface SessionTab {
  url: string
  title?: string
}

interface SessionWindow {
  tabs?: SessionTab[]
}

interface SessionGroup {
  name?: string
  windows?: SessionWindow[]
}

interface Session {
  id: string
  name: string
  description?: string | null
  groups: SessionGroup[]
  created_at: string
}

interface SessionListProps {
  sessions: Session[]
  isPro: boolean
}

export function SessionList({ sessions, isPro }: SessionListProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleRestore(session: Session) {
    const urls = session.groups.flatMap((g) =>
      (g.windows ?? []).flatMap((w) => (w.tabs ?? []).map((t) => t.url))
    )
    urls.forEach((url) => window.open(url, '_blank', 'noopener'))
    toast.success(`Restored ${urls.length} tab${urls.length === 1 ? '' : 's'} from "${session.name}"`)
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Session deleted')
      startTransition(() => {
        router.refresh()
      })
    } else {
      toast.error('Failed to delete session')
    }
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <PlusCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm font-medium mb-1">No sessions yet</p>
        <p className="text-xs text-muted-foreground">
          Open the extension and click &quot;Save session&quot; to capture your
          current tab groups.
        </p>
      </div>
    )
  }

  return (
    <div className={isPending ? 'opacity-70 pointer-events-none' : ''}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            id={session.id}
            name={session.name}
            description={session.description}
            groups={session.groups}
            groupCount={Array.isArray(session.groups) ? session.groups.length : 0}
            windowCount={session.groups.reduce((s, g) => s + (g.windows?.length ?? 0), 0)}
            tabCount={session.groups.reduce(
              (s, g) =>
                s +
                (g.windows?.reduce((ws, w) => ws + (w.tabs?.length ?? 0), 0) ?? 0),
              0
            )}
            createdAt={session.created_at}
            onRestore={() => handleRestore(session)}
            onDelete={handleDelete}
          />
        ))}
      </div>
      {!isPro && (
        <p className="mt-3 text-xs text-muted-foreground">
          Free plan: up to 3 sessions.{' '}
          <Link href="/pricing" className="underline underline-offset-2 hover:no-underline">
            Upgrade to Pro
          </Link>{' '}
          for unlimited.
        </p>
      )}
    </div>
  )
}
