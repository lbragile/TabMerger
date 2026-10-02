'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { sendToExtension } from '@/lib/extensionMessaging'
import { useSyncExtensionAuth } from '@/lib/hooks/useSyncExtensionAuth'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { EXTENSION_MESSAGE } from '@tabmerger/shared'

type SyncNowResponse = { ok: boolean; reason?: string; message?: string }

const SYNC_NOW_REASON_MESSAGES: Record<string, string> = {
  locked: 'Open the extension and unlock encryption to sync.',
  'no-session': 'Sign in to the extension to sync.',
  error: 'Sync failed — try again from the extension.',
}

// Sends { type: 'SYNC_NOW' } to the extension's background worker via externally_connectable
// (tries every known store ID — same helper useExtensionInstalled's PING probe uses) and waits
// for its real push+pull result. Resolves `null` — not a rejection — when the extension isn't
// installed/reachable in this browser, so callers can fall back to a plain Supabase re-read
// instead of hard-failing.
async function requestExtensionSyncNow(): Promise<SyncNowResponse | null> {
  const result = await sendToExtension<SyncNowResponse>({ type: EXTENSION_MESSAGE.SYNC_NOW })
  return result?.response ?? null
}

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
  const router = useRouter()
  useSyncExtensionAuth()
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [justSynced, setJustSynced] = useState(false)
  const [justChecked, setJustChecked] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Initial load / manual refresh only: ordering by `updated_at` ignores position-only reorders
  // (migration 020 keeps `updated_at` unchanged for them). Acceptable, since reorders surface
  // live through the realtime handler below and the extension's own sync status.
  const fetchLatestSync = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('groups')
      .select('updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
    if (error) console.error('[SyncIndicator] Failed to fetch latest sync', error.message)
    if (!data?.[0]?.updated_at) return null
    const date = new Date(data[0].updated_at as string)
    setLastSyncedAt(date)
    return date
  }, [userId])

  const handleRefreshClick = useCallback(async () => {
    setRefreshing(true)
    const before = lastSyncedAt?.getTime()
    try {
      const syncResult = await requestExtensionSyncNow()
      // null = extension not installed/reachable in this browser — fall back to just
      // re-reading Supabase (the old behavior) rather than blocking the button on it.
      if (syncResult && !syncResult.ok) {
        toast.error(
          syncResult.reason && SYNC_NOW_REASON_MESSAGES[syncResult.reason]
            ? SYNC_NOW_REASON_MESSAGES[syncResult.reason]
            : (syncResult.message ?? 'Sync failed.')
        )
      }

      const after = await fetchLatestSync()
      if (after && after.getTime() !== before) {
        setJustSynced(true)
        setTimeout(() => setJustSynced(false), 2000)
      } else {
        setJustChecked(true)
        setTimeout(() => setJustChecked(false), 2000)
      }
    } finally {
      setRefreshing(false)
    }
    router.refresh()
  }, [fetchLatestSync, lastSyncedAt, router])

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    // `fetchLatestSync` itself sets state (after its internal Supabase await), so calling
    // it directly here — a useCallback-wrapped reference — reads to the lint rule as an
    // effect that "calls setState synchronously". Wrapping the call in its own async scope
    // keeps the fire-and-forget behavior (effects can't be async) while making it clear to
    // both the rule and the reader that the state update only ever happens post-await.
    ;(async () => {
      if (!cancelled) await fetchLatestSync()
    })()

    const channel = supabase
      .channel(`groups-sync-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'groups', filter: `user_id=eq.${userId}` },
        (payload) => {
          // Position-only (reorder) and view_count updates leave `updated_at` unchanged (migration
          // 020), so the row's value can be OLD. The event itself proves a sync just happened:
          // use its arrival time, keep `updated_at` only if newer, and never move the label back.
          const updatedAt = (payload.new as { updated_at?: string })?.updated_at
          const eventTime = latestOf(new Date(), updatedAt ? new Date(updatedAt) : null)
          setLastSyncedAt((prev) => latestOf(prev, eventTime))
          setJustSynced(true)
          setTimeout(() => setJustSynced(false), 2000)
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [userId, fetchLatestSync])

  const label = justSynced
    ? 'Syncing...'
    : lastSyncedAt
      ? `Synced ${relativeTime(lastSyncedAt)}`
      : 'No sync yet'

  return (
    <div
      className={cn(
        'hidden items-center gap-1.5 rounded-md border py-1 pl-2.5 pr-1 text-xs font-medium sm:flex',
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
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={refreshing}
              aria-label="Refresh sync status"
              className="cursor-pointer rounded-md p-1 text-current/70 transition-colors hover:bg-black/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
            >
              {justChecked ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Re-sync now</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}

function latestOf(a: Date | null, b: Date | null): Date {
  if (!a) return b ?? new Date()
  return b && b > a ? b : a
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
