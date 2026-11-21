/**
 * Sorting, searching and paging the blog listing in the browser (`?sort=…&q=…&page=N`). Pure
 * functions shared by the client listing and the tests. Without any of these params the server's
 * static page is shown unchanged.
 */

export const LISTING_SORTS = ['newest', 'oldest', 'helpful', 'shortest'] as const
export type ListingSort = (typeof LISTING_SORTS)[number]

/** What sorting and searching need to know about a post. */
export interface ListingEntry {
  slug: string
  /** The title as the reader sees it (the page locale's file, else English). */
  title: string
  /** YYYY-MM-DD. */
  published: string
  readMinutes: number
}

export interface ListingQuery {
  sort: ListingSort
  q: string
  page: number
}

export const DEFAULT_LISTING_QUERY: ListingQuery = { sort: 'newest', q: '', page: 1 }

/** Longest search kept from the URL (a title search needs no more). */
const MAX_QUERY_LENGTH = 100

export function isListingSort(value: unknown): value is ListingSort {
  return typeof value === 'string' && (LISTING_SORTS as readonly string[]).includes(value)
}

/** The listing state from the URL; anything unknown or malformed falls back to the default. */
export function parseListingQuery(params: { get(name: string): string | null }): ListingQuery {
  const sort = params.get('sort')
  const q = (params.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH)
  const rawPage = params.get('page') ?? ''
  const page = /^[1-9]\d{0,4}$/.test(rawPage) ? Number(rawPage) : 1
  return { sort: isListingSort(sort) ? sort : 'newest', q, page }
}

/** True when the URL asks for nothing beyond the static page. */
export function isDefaultListing(query: Pick<ListingQuery, 'sort' | 'q'>): boolean {
  return query.sort === 'newest' && query.q === ''
}

/** `sort=…&q=…&page=N` with only the non-default parts ('' for the default listing). */
export function listingQueryString(query: ListingQuery): string {
  const params = new URLSearchParams()
  if (query.sort !== 'newest') params.set('sort', query.sort)
  if (query.q) params.set('q', query.q)
  if (query.page > 1 && !isDefaultListing(query)) params.set('page', String(query.page))
  return params.toString()
}

/** Case- and accent-insensitive form of a text for matching ("Café" and "cafe" match). */
export function searchKey(text: string, locale?: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase(locale)
}

/** The entries whose title contains the query (all of them for an empty query). */
export function filterByTitle<T extends ListingEntry>(entries: readonly T[], q: string, locale?: string): T[] {
  const needle = searchKey(q.trim(), locale)
  if (!needle) return [...entries]
  return entries.filter((entry) => searchKey(entry.title, locale).includes(needle))
}

/**
 * Where the query occurs in `text`, as `[start, end)` ranges of the original string, matched the
 * same way as the search (case and accents ignored), so "cafe" marks the "Café" in a title. A range
 * never splits a letter from its combining accent.
 */
export function matchRanges(text: string, q: string, locale?: string): Array<[number, number]> {
  const needle = searchKey(q.trim(), locale)
  if (!needle) return []
  let key = ''
  // For each character of `key`, where its source character starts and ends in `text`.
  const from: number[] = []
  const to: number[] = []
  let index = 0
  for (const char of text) {
    const part = searchKey(char, locale)
    for (let i = 0; i < part.length; i++) {
      from.push(index)
      to.push(index + char.length)
    }
    key += part
    index += char.length
  }
  const ranges: Array<[number, number]> = []
  for (let at = key.indexOf(needle); at !== -1; at = key.indexOf(needle, at + needle.length)) {
    let end = to[at + needle.length - 1]
    while (end < text.length && /\p{M}/u.test(text[end])) end++
    ranges.push([from[at], end])
  }
  return ranges
}

/** Newest first: by published date, then slug (the tie-break for every sort). */
const newestFirst = (a: ListingEntry, b: ListingEntry) => b.published.localeCompare(a.published) || a.slug.localeCompare(b.slug)

/**
 * The entries in `sort` order; ties go to the newer post. "Most helpful" uses `counts` (a post
 * without a count counts as 0).
 */
export function sortEntries<T extends ListingEntry>(entries: readonly T[], sort: ListingSort, counts: Readonly<Record<string, number>> = {}): T[] {
  const list = [...entries]
  switch (sort) {
    case 'oldest':
      return list.sort((a, b) => a.published.localeCompare(b.published) || newestFirst(a, b))
    case 'helpful':
      return list.sort((a, b) => (counts[b.slug] ?? 0) - (counts[a.slug] ?? 0) || newestFirst(a, b))
    case 'shortest':
      return list.sort((a, b) => a.readMinutes - b.readMinutes || newestFirst(a, b))
    default:
      return list.sort(newestFirst)
  }
}
