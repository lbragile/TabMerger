'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { subscribeWithUserToken } from '@/lib/supabase/realtimeAuth'
import { cn } from '@/lib/utils'
import { getCachedExtensionId, sendToExtension, sendToKnownExtension } from '@/lib/extensionMessaging'
import { useSyncExtensionAuth } from '@/lib/hooks/useSyncExtensionAuth'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { EXTENSION_MESSAGE } from '@tabmerger/shared'

/**
 * The extension's answer to SYNC_NOW (`handleSyncNow` in its background worker).
 * `skipped: true` means another sync held the lock, so this request ran nothing. Older builds
 * answer `{ ok: true }` with no `skipped`, which is a completed sync.
 */
type SyncNowResponse = { ok: true; skipped?: boolean } | { ok: false; reason?: string; message?: string }

const SYNC_NOW_REASON_MESSAGES = new Map<string, string>([
  ['locked', 'Open the extension and unlock encryption to sync.'],
  ['no-session', 'Sign in to the extension to sync.'],
  ['error', 'Sync failed. Try again from the extension.'],
])
const SYNC_FAILED_FALLBACK_MESSAGE = 'Sync failed.'

/**
 * localStorage key prefix (one entry per user: `<prefix>:<userId>`, epoch milliseconds) for the
 * newest sync this browser has witnessed. The server only stores when a group's content last
 * changed, so without this a reload would move the label back to that older time.
 */
export const LAST_SYNC_SEEN_STORAGE_KEY = 'tm_last_sync_seen'

/** How often the relative time ("5m ago") is recomputed with no other event. */
const LABEL_REFRESH_MS = 30_000
/** How long "Syncing..." stays up after a realtime row event. */
const EVENT_PULSE_MS = 2_000
/** How long the check mark stays up after a plain re-read. */
const CHECKED_FLASH_MS = 2_000
/** After the extension reports "another sync is already running": wait, then re-read. */
const BUSY_REREAD_DELAY_MS = 3_000
/** A full push and pull can take a while (cold service worker, many groups, slow network). */
const SYNC_NOW_TIMEOUT_MS = 30_000
/** A remembered time further ahead than this is a clock that was wrong once: ignore it. */
const FUTURE_TOLERANCE_MS = 60_000

type SyncStatus =
  | { kind: 'idle' }
  /** `manual`: started by the button and still waiting for the extension's answer. */
  | { kind: 'syncing'; manual: boolean }
  /** The extension is already running another sync; this request ran nothing. */
  | { kind: 'busy' }
  /** A plain re-read finished (extension not reachable). */
  | { kind: 'checked' }
  | { kind: 'failed'; message: string }

const IDLE: SyncStatus = { kind: 'idle' }

/** For `error` the extension's own message says what went wrong, so it wins over the generic text. */
function failureMessage(result: { reason?: string; message?: string }): string {
  const extensionMessage = typeof result.message === 'string' ? result.message.trim() : ''
  if (result.reason === 'error' && extensionMessage) return extensionMessage
  const mapped = typeof result.reason === 'string' ? SYNC_NOW_REASON_MESSAGES.get(result.reason) : undefined
  return mapped ?? (extensionMessage || SYNC_FAILED_FALLBACK_MESSAGE)
}

/**
 * Asks the extension's background worker (externally_connectable, or the Firefox relay) to run a
 * real push and pull, and waits for its result. Resolves `null`, not a rejection, when the
 * extension is not installed or reachable in this browser, does not answer in time, or answers
 * with something unexpected, so the caller can fall back to a plain Supabase re-read.
 *
 * The extension is found with a quick PING first (unless it already answered this session).
 * SYNC_NOW then goes to that one responder with a long timeout: with the short probe timeout a
 * sync slower than 1.5 s was treated as "no answer" and sent again.
 */
async function requestExtensionSyncNow(): Promise<SyncNowResponse | null> {
  if (!getCachedExtensionId()) {
    const found = await sendToExtension({ type: EXTENSION_MESSAGE.PING })
    if (!found) return null
  }
  const result = await sendToKnownExtension<unknown>(
    { type: EXTENSION_MESSAGE.SYNC_NOW },
    { timeoutMs: SYNC_NOW_TIMEOUT_MS }
  )
  const response = result?.response
  if (!response || typeof response !== 'object') return null
  if (typeof (response as { ok?: unknown }).ok !== 'boolean') return null
  return response as SyncNowResponse
}

/** Every read is wrapped: storage can be blocked or throw, and the pill must work without it. */
function readLastSyncSeen(userId: string): Date | null {
  try {
    const raw = window.localStorage.getItem(`${LAST_SYNC_SEEN_STORAGE_KEY}:${userId}`)
    if (!raw) return null
    const ms = Number(raw)
    if (!Number.isFinite(ms) || ms <= 0 || ms > Date.now() + FUTURE_TOLERANCE_MS) return null
    return new Date(ms)
  } catch {
    return null
  }
}

function writeLastSyncSeen(userId: string, date: Date): void {
  try {
    window.localStorage.setItem(`${LAST_SYNC_SEEN_STORAGE_KEY}:${userId}`, String(date.getTime()))
  } catch {
    // Storage unavailable: the label still works, it just is not remembered across reloads.
  }
}

interface SyncIndicatorProps {
  userId: string
}

/**
 * Live sync status pill shown in the (app) header.
 *
 * Where the time comes from, newest wins and it never moves backwards:
 * - the most recent `groups.updated_at` for the user (last content change, read on mount);
 * - the arrival of a Realtime row event on `groups` (the extension just pushed something);
 * - a completed manual sync reported by the extension (covers a sync that changed no row, and
 *   deletes, which do not reach a user-filtered Realtime subscription);
 * - the newest of those this browser has seen before, remembered in localStorage.
 *
 * Status: idle (synced at T / no sync yet), syncing (manual round trip, or just after a row
 * event), busy (the extension was already syncing), failed (stays until the next successful
 * sync or row event).
 *
 * ponytail: relies on Supabase Realtime being enabled for the `groups` table's publication. If
 * it isn't, this falls back to the fetched time plus manual syncs; enabling replication is a
 * `database` agent change, not something to route around here.
 */
export function SyncIndicator({ userId }: SyncIndicatorProps) {
  const router = useRouter()
  useSyncExtensionAuth()
  const reasonId = useId()
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [status, setStatus] = useState<SyncStatus>(IDLE)
  // "Now" lives in state so the relative time is a pure function of state, and so a timer can
  // move it forward: without that "just now" stayed on screen for hours.
  const [now, setNow] = useState(() => Date.now())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  // One pending status timer at a time: a newer status replaces whatever the older one scheduled.
  const startTimer = useCallback(
    (ms: number, run: () => void) => {
      clearTimer()
      if (!mountedRef.current) return
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        run()
      }, ms)
    },
    [clearTimer]
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimer()
    }
  }, [clearTimer])

  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const interval = setInterval(refresh, LABEL_REFRESH_MS)
    // Background tabs throttle timers and a sleeping machine stops them: catch up on return.
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') refresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  // The single way the displayed time changes: newest of the candidate, what this browser has
  // already seen, and what is on screen. Only called after an await or from an event callback.
  const recordSync = useCallback(
    (candidate: Date | null) => {
      const next = latestOf(candidate, readLastSyncSeen(userId))
      if (!next) return null
      writeLastSyncSeen(userId, next)
      setLastSyncedAt((prev) => latestOf(prev, next))
      setNow(Date.now())
      return next
    },
    [userId]
  )

  // Ordering by `updated_at` ignores position-only reorders, deletes and syncs that changed
  // nothing (migration 020 keeps `updated_at` for a reorder). Those reach the label through the
  // realtime handler, a completed manual sync, or the remembered time instead.
  const fetchLatestSync = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('groups')
      .select('updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
    if (error) console.error('[SyncIndicator] Failed to fetch latest sync', error.message)
    return recordSync(toValidDate(data?.[0]?.updated_at))
  }, [userId, recordSync])

  const handleRefreshClick = useCallback(async () => {
    clearTimer()
    setStatus({ kind: 'syncing', manual: true })

    let next: SyncStatus = IDLE
    try {
      const result = await requestExtensionSyncNow()
      if (!result) {
        // Extension not reachable in this browser: re-read only, and do not claim a sync.
        await fetchLatestSync()
        next = { kind: 'checked' }
      } else if (!result.ok) {
        const message = failureMessage(result)
        toast.error(message)
        await fetchLatestSync()
        next = { kind: 'failed', message }
      } else if (result.skipped) {
        // Another sync holds the lock: this request ran nothing, so its end time is unknown.
        next = { kind: 'busy' }
      } else {
        // A full push and pull completed just now, whether or not any row changed.
        recordSync(new Date())
      }
    } catch (err) {
      console.error('[SyncIndicator] Sync request failed', err)
    }
    if (!mountedRef.current) return

    setStatus(next)
    if (next.kind === 'checked') {
      startTimer(CHECKED_FLASH_MS, () => setStatus((prev) => (prev.kind === 'checked' ? IDLE : prev)))
    } else if (next.kind === 'busy') {
      startTimer(BUSY_REREAD_DELAY_MS, () => {
        void (async () => {
          await fetchLatestSync()
          if (!mountedRef.current) return
          setStatus((prev) => (prev.kind === 'busy' ? IDLE : prev))
          router.refresh()
        })()
      })
    }
    router.refresh()
  }, [clearTimer, fetchLatestSync, recordSync, router, startTimer])

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

    // INSERT and UPDATE (content and position-only) reach this user-filtered subscription.
    // DELETE does not: the table's replica identity is the primary key, so a deleted row carries
    // no `user_id` for the filter to match.
    //
    // Subscribed through `subscribeWithUserToken`: the channel joins only once the realtime
    // client holds the user's token. A join without it is anonymous, and row level security
    // then hides every event.
    const removeSubscription = subscribeWithUserToken(supabase, `groups-sync-${userId}`, (channel) =>
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'groups', filter: `user_id=eq.${userId}` },
        (payload) => {
          // Position-only (reorder) and view_count updates leave `updated_at` unchanged (migration
          // 020), so the row's value can be OLD. The event itself proves a sync just happened:
          // use its arrival time, keep `updated_at` only if newer, and never move the label back.
          const updatedAt = toValidDate((payload.new as { updated_at?: string } | null)?.updated_at)
          recordSync(latestOf(new Date(), updatedAt))
          // A row event also ends a failed or busy state. A manual round trip stays "manual"
          // (button disabled) until the extension answers.
          setStatus((prev) => (prev.kind === 'syncing' && prev.manual ? prev : { kind: 'syncing', manual: false }))
          startTimer(EVENT_PULSE_MS, () =>
            setStatus((prev) => (prev.kind === 'syncing' && !prev.manual ? IDLE : prev))
          )
        }
      )
    )

    return () => {
      cancelled = true
      removeSubscription()
    }
  }, [userId, fetchLatestSync, recordSync, startTimer])

  const failed = status.kind === 'failed'
  const active = status.kind === 'syncing' || status.kind === 'busy'
  const requesting = status.kind === 'syncing' && status.manual

  const statusText =
    status.kind === 'syncing'
      ? 'Syncing...'
      : status.kind === 'busy'
        ? 'Sync already in progress'
        : failed
          ? 'Sync failed'
          : lastSyncedAt
            ? 'Synced'
            : 'No sync yet'
  const timeText = !failed && !active && lastSyncedAt ? relativeTime(lastSyncedAt, now) : null

  return (
    <div
      className={cn(
        'hidden items-center gap-1.5 rounded-md border py-1 pl-2.5 pr-1 text-xs font-medium sm:flex',
        failed
          ? 'border-red-600/30 bg-red-500/20 text-red-700 dark:text-red-400'
          : active
            ? 'border-amber-600/30 bg-amber-500/20 text-amber-700 dark:text-amber-400'
            : lastSyncedAt
              ? 'border-green-600/30 bg-green-500/20 text-green-700 dark:text-green-400'
              : 'border-border text-muted-foreground'
      )}
    >
      {failed ? (
        // The failed state must not rely on colour alone: icon plus the words "Sync failed".
        <AlertTriangle aria-hidden="true" data-sync-failed-icon="" className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            active ? 'bg-amber-500 animate-pulse' : lastSyncedAt ? 'bg-green-500' : 'bg-muted-foreground/40'
          )}
        />
      )}
      <span className="whitespace-nowrap">
        {/* Polite live region for the status only. The relative time stays outside it, or a
            screen reader would read "5m ago", "6m ago"… every time the label ticks. */}
        <span role="status">
          {statusText}
          {failed && (
            <>
              <span className="sr-only">. </span>
              <span id={reasonId} className="sr-only">
                {status.message}
              </span>
            </>
          )}
        </span>
        {timeText && <> {timeText}</>}
      </span>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={requesting}
              aria-label="Refresh sync status"
              // Spread, not `aria-describedby={… : undefined}`: an explicit undefined would
              // override the description the tooltip trigger sets while the tooltip is open.
              {...(failed ? { 'aria-describedby': reasonId } : {})}
              className="cursor-pointer rounded-md p-1 text-current/70 transition-colors hover:bg-black/10 hover:text-current disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
            >
              {status.kind === 'checked' ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <RefreshCw className={cn('h-3.5 w-3.5', requesting && 'animate-spin')} />
              )}
            </button>
          </TooltipTrigger>
          {/* Shown on hover and on keyboard focus, so the reason for a failure is reachable both ways. */}
          <TooltipContent side="top">{failed ? status.message : 'Re-sync now'}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}

function toValidDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function latestOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b
  if (!b) return a
  return b > a ? b : a
}

function relativeTime(date: Date, now: number): string {
  const seconds = Math.max(0, Math.floor((now - date.getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
