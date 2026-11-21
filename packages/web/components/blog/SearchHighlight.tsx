'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { matchRanges } from '@/lib/blog/listing'

/** The listing's current title search, for highlighting it in the (server-rendered) rows. */
export const ListingSearchContext = createContext<{ q: string; locale: string } | null>(null)

/**
 * A post title with the current search marked (`<mark>` in the accent colours), matched like the
 * search itself: case and accents ignored. Plain text outside a search or outside the listing.
 */
export function SearchHighlight({ text }: { text: string }) {
  const search = useContext(ListingSearchContext)
  const ranges = search?.q ? matchRanges(text, search.q, search.locale) : []
  if (ranges.length === 0) return text
  const parts: ReactNode[] = []
  let last = 0
  for (const [start, end] of ranges) {
    if (start > last) parts.push(text.slice(last, start))
    parts.push(
      <mark key={start} className="bg-accent px-px text-accent-foreground">
        {text.slice(start, end)}
      </mark>
    )
    last = end
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}
