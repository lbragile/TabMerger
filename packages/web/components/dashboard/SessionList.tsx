'use client'

import { useEffect, useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { isEncryptedBlob, decryptBlob, type EncryptedBlob, FREE_TIER_LIMITS } from '@tabmerger/shared'
import { useEncryptionKey, unreadableRowKey } from '@/lib/encryption/context'
import { PassphrasePrompt } from '@/components/dashboard/PassphrasePrompt'
import { SessionCard } from './SessionCard'
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
  /** Set when this session's encrypted blob couldn't be decrypted with the current data key:
   * `name` and `groups` are placeholders, so it cannot be restored (see SessionCard's `locked`). */
  locked?: boolean
}

/** Raw row shape from Supabase — `groups` (and `name`, when encrypted) is ciphertext until decrypted client-side. */
interface RawSession extends Omit<Session, 'groups'> {
  groups: SessionGroup[] | EncryptedBlob
}

interface EncryptedSessionContent {
  name: string
  groups: SessionGroup[]
  description?: string
}

/** Decrypts every encrypted-blob session with the session's data key — mirrors GroupGrid's useDecryptedGroups. */
function useDecryptedSessions(sessions: RawSession[]) {
  const { dataKey, recheck } = useEncryptionKey()
  const hasEncrypted = useMemo(() => sessions.some((s) => isEncryptedBlob(s.groups)), [sessions])
  // Only the genuinely async decrypt result needs React state — the "nothing encrypted"
  // case is derived straight from props below, with no setState-in-effect needed for it.
  const [asyncDecrypted, setAsyncDecrypted] = useState<Session[] | null>(null)

  useEffect(() => {
    if (!hasEncrypted || !dataKey) return
    let cancelled = false
    ;(async () => {
      const unreadable: string[] = []
      const results = await Promise.all(
        sessions.map(async (s) => {
          if (!isEncryptedBlob(s.groups)) return s as Session
          try {
            const content = await decryptBlob<EncryptedSessionContent>(dataKey, s.groups)
            return { ...s, name: content.name, groups: content.groups, description: content.description }
          } catch {
            unreadable.push(unreadableRowKey('sessions', s.id, s.groups))
            return { ...s, name: '(locked)', groups: [], locked: true }
          }
        })
      )
      if (cancelled) return
      // A stale key is dropped by the provider (the prompt returns); see GroupGrid's useDecryptedGroups.
      if (unreadable.length > 0) void recheck(unreadable)
      setAsyncDecrypted(results)
    })()
    return () => {
      cancelled = true
    }
  }, [sessions, hasEncrypted, dataKey, recheck])

  const decrypted = hasEncrypted ? (asyncDecrypted ?? []) : (sessions as Session[])

  return { sessions: decrypted, needsUnlock: hasEncrypted && !dataKey }
}

interface SessionListProps {
  sessions: RawSession[]
  isPro: boolean
}

export function SessionList({ sessions: rawSessions, isPro }: SessionListProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { sessions, needsUnlock } = useDecryptedSessions(rawSessions)

  function handleRestore(session: Session) {
    // Second guard behind the card's disabled control: a locked session has no readable tabs.
    if (session.locked) {
      toast.error("This session can't be read, so it can't be restored.")
      return
    }
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

  if (needsUnlock) {
    return <PassphrasePrompt label="Your sessions are end-to-end encrypted. Enter your passphrase to view them here." />
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
            groupCount={Array.isArray(session.groups) ? session.groups.length : 0}
            windowCount={session.groups.reduce((s, g) => s + (g.windows?.length ?? 0), 0)}
            tabCount={session.groups.reduce(
              (s, g) =>
                s +
                (g.windows?.reduce((ws, w) => ws + (w.tabs?.length ?? 0), 0) ?? 0),
              0
            )}
            createdAt={session.created_at}
            locked={session.locked}
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
