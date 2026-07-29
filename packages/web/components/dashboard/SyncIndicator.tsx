'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface SyncIndicatorProps {
  userId: string
}

/**
 * Live sync status pill shown in the (app) header. Reads the most recent
 * `groups.updated_at` for the signed-in user, then subscribes to Realtime
 * postgres_changes on `groups` (filtered to that user) so it updates the
 * instant the extension's syncEngine pushes a change — no page refresh.
 *
 * ponytail: relies on Supabase Realtime being enabled for the `groups`
 * table's publication. If it isn't, this silently falls back to "static"
 * last-synced display (still correct on mount, just not live) — enabling
 * replication is a `database` agent change, not something to route around here.
 */
export function SyncIndicator({ userId }: SyncIndicatorProps) {
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [justSynced, setJustSynced] = useState(false)

  useEffect(() => {
    const supabase = createClient()

    supabase
      .from('groups')
      .select('updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]?.updated_at) setLastSyncedAt(new Date(data[0].updated_at as string))
      })

    const channel = supabase
      .channel(`groups-sync-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'groups', filter: `user_id=eq.${userId}` },
        (payload) => {
          const updatedAt = (payload.new as { updated_at?: string })?.updated_at
          setLastSyncedAt(updatedAt ? new Date(updatedAt) : new Date())
          setJustSynced(true)
          setTimeout(() => setJustSynced(false), 2000)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  const label = justSynced
    ? 'Syncing...'
    : lastSyncedAt
      ? `Synced ${relativeTime(lastSyncedAt)}`
      : 'No sync yet'

  return (
    <div
      className={cn(
        'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium sm:flex',
        justSynced
          ? 'border-amber-600/30 bg-amber-500/20 text-amber-700 dark:text-amber-400'
          : lastSyncedAt
            ? 'border-green-600/30 bg-green-500/20 text-green-700 dark:text-green-400'
            : 'border-border text-muted-foreground'
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          justSynced ? 'bg-amber-500 animate-pulse' : lastSyncedAt ? 'bg-green-500' : 'bg-muted-foreground/40'
        )}
      />
      {label}
    </div>
  )
}

function relativeTime(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
