import { searchKey } from '@/lib/blog/listing'
import type { BlogTag } from '@/lib/blog/tags'

/** A tag as the topic chips and the all-topics page show it: its label and how many posts carry it. */
export interface TagEntry {
  tag: BlogTag
  /** The translated label (`blog.tags.<key>`), shown after a "#". */
  label: string
  /** Posts carrying it (`listedTagCounts`). */
  count: number
}

/** How many topic chips the blog index and tag pages show before "See all topics". */
export const TOPIC_CHIP_LIMIT = 8

/**
 * By relevance: most posts first, then alphabetically by label in the page's language
 * (`Intl.Collator`, so accents and scripts sort the way readers expect; case and accents only
 * break exact ties).
 */
export function byRelevance(entries: readonly TagEntry[], locale: string): TagEntry[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  return [...entries].sort((a, b) => b.count - a.count || collator.compare(a.label, b.label) || a.tag.localeCompare(b.tag))
}

/**
 * The chips a listing shows: the first `limit` tags, plus the current tag page's own tag when it
 * falls outside them (so the highlighted chip is always visible), and whether any are hidden
 * (then the row ends with "See all topics").
 */
export function visibleChips(ordered: readonly BlogTag[], current?: BlogTag, limit = TOPIC_CHIP_LIMIT): { shown: BlogTag[]; hidden: number } {
  const shown = ordered.slice(0, limit)
  if (current && ordered.includes(current) && !shown.includes(current)) shown.push(current)
  return { shown, hidden: ordered.length - shown.length }
}

/** The entries whose label contains the query, ignoring case and accents (all of them for an empty query). */
export function filterTags<T extends Pick<TagEntry, 'label'>>(entries: readonly T[], query: string, locale?: string): T[] {
  // Labels are hashtag-style ("save-tabs"): hyphens and spaces match each other.
  const key = (text: string) => searchKey(text.replace(/-/g, ' ').replace(/\s+/g, ' '), locale)
  const needle = key(query.trim().replace(/^#/, ''))
  if (!needle.trim()) return [...entries]
  return entries.filter((entry) => key(entry.label).includes(needle))
}
