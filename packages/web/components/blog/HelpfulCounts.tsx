'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createTranslator } from 'next-intl'
import { ThumbsUp } from 'lucide-react'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'

type Counts = Readonly<Record<string, number>>
type Status = 'loading' | 'ready' | 'unavailable'

/** The client listing's messages: a small subset of `blog`, passed in by the server page. */
export type ListingMessages = Record<string, string>

type Values = Record<string, string | number>

/** Formats one of the listing messages (ICU), e.g. `t('helpfulCount', { count })`. */
export interface ListingTranslator {
  (key: string, values?: Values): string
  /** With tags rendered by the given functions, e.g. `<q>…</q>`. */
  rich(key: string, values: Record<string, string | number | ((chunks: ReactNode) => ReactNode)>): ReactNode
  /** The same as a string (for an aria-label). */
  markup(key: string, values: Record<string, string | number | ((chunks: string) => string)>): string
}

interface HelpfulCountsState {
  counts: Counts
  status: Status
  t: ListingTranslator
}

const HelpfulCountsContext = createContext<HelpfulCountsState | null>(null)

/** A `{ slug, helpful }[]` answer, checked; anything else is treated as unavailable. */
export function toCounts(data: unknown): Counts | null {
  if (!Array.isArray(data)) return null
  const counts: Record<string, number> = {}
  for (const row of data) {
    if (!row || typeof row !== 'object') return null
    const { slug, helpful } = row as { slug?: unknown; helpful?: unknown }
    const n = typeof helpful === 'string' ? Number(helpful) : helpful
    if (typeof slug !== 'string' || typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) return null
    counts[slug] = n
  }
  return counts
}

/**
 * Every post's Helpful count for the blog listing, fetched once in the browser after the page
 * loads (one `blog_helpful_counts()` call), so the listing pages stay static. Until it answers the
 * counts show a fixed-width placeholder; if it fails (or the function doesn't exist yet) the
 * counts are left out, nothing else changes. Also provides the listing's client messages.
 */
export function HelpfulCountsProvider({ locale, messages, children }: { locale: string; messages: ListingMessages; children: ReactNode }) {
  const [counts, setCounts] = useState<Counts>({})
  const [status, setStatus] = useState<Status>(isSupabaseConfigured ? 'loading' : 'unavailable')

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    createClient()
      .rpc('blog_helpful_counts')
      .then(
        ({ data, error }) => {
          if (!active) return
          const parsed = error ? null : toCounts(data)
          if (parsed) {
            setCounts(parsed)
            setStatus('ready')
          } else {
            setStatus('unavailable')
          }
        },
        () => {
          if (active) setStatus('unavailable')
        }
      )
    return () => {
      active = false
    }
  }, [])

  const t = useMemo(
    () => createTranslator({ locale: locale as never, messages: { blog: messages }, namespace: 'blog' as never }) as unknown as ListingTranslator,
    [locale, messages]
  )

  return <HelpfulCountsContext.Provider value={{ counts, status, t }}>{children}</HelpfulCountsContext.Provider>
}

/** The listing state (counts, their status, the client messages); null outside the provider. */
export function useHelpfulCounts(): HelpfulCountsState | null {
  return useContext(HelpfulCountsContext)
}

/**
 * A post's Helpful count beside its date and read time: a thumbs-up and the number, named
 * "12 people found this helpful". A fixed-width placeholder while loading, so nothing shifts;
 * nothing at all when the counts are unavailable. Shown at 0 too, so rows line up.
 */
export function HelpfulCount({ slug }: { slug: string }) {
  const state = useHelpfulCounts()
  if (!state || state.status === 'unavailable') return null
  if (state.status === 'loading') {
    return (
      <>
        <span aria-hidden="true">{' · '}</span>
        <span aria-hidden="true" data-testid="helpful-count-loading" className="inline-flex h-[1em] w-9 animate-pulse bg-surface3 align-middle" />
      </>
    )
  }
  const count = state.counts[slug] ?? 0
  const label = state.t('helpfulCount', { count })
  return (
    <>
      <span aria-hidden="true">{' · '}</span>
      <span role="img" aria-label={label} title={label} className="inline-flex w-9 items-center gap-1 align-middle tabular-nums">
        <ThumbsUp aria-hidden="true" className="size-3.5" />
        {count}
      </span>
    </>
  )
}
