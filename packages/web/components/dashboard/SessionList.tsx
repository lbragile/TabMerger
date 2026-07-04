'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SessionCard } from './SessionCard'
import { Button } from '@/components/ui/button'
import { PlusCircle } from 'lucide-react'
import Link from 'next/link'

interface Session {
  id: string
  name: string
  description?: string | null
  groups: unknown[]
  created_at: string
}

interface SessionListProps {
  sessions: Session[]
  isPro: boolean
}

export function SessionList({ sessions, isPro }: SessionListProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  async function handleDelete(id: string) {
    const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
    if (res.ok) {
      startTransition(() => {
        router.refresh()
      })
    }
  }

  if (!isPro) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground mb-4">
          Session save &amp; restore is a Pro feature. Upgrade to save your
          browsing sessions and restore them later.
        </p>
        <Button size="sm" asChild>
          <Link href="/pricing">Upgrade to Pro</Link>
        </Button>
      </div>
    )
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
    <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 ${isPending ? 'opacity-70 pointer-events-none' : ''}`}>
      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          id={session.id}
          name={session.name}
          description={session.description}
          groupCount={Array.isArray(session.groups) ? session.groups.length : 0}
          createdAt={session.created_at}
          onDelete={handleDelete}
        />
      ))}
    </div>
  )
}
