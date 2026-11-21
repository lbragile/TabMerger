'use client'

import { Suspense, useRef, useState, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useHelpfulCounts, type ListingTranslator } from '@/components/blog/HelpfulCounts'
import { ListingToolbar } from '@/components/blog/ListingToolbar'
import { PagerView } from '@/components/blog/PagerView'
import { ListingSearchContext } from '@/components/blog/SearchHighlight'
import {
  DEFAULT_LISTING_QUERY,
  filterByTitle,
  isDefaultListing,
  listingQueryString,
  parseListingQuery,
  sortEntries,
  type ListingEntry,
  type ListingQuery,
} from '@/lib/blog/listing'
import { cn } from '@/lib/utils'

export interface ListingClientProps {
  /** Every live post in this listing's scope, newest first. */
  entries: readonly ListingEntry[]
  /** Each post's row, rendered on the server, by slug. */
  rows: Readonly<Record<string, ReactNode>>
  /** The static page's own content: the featured panel (index page 1), the rows and the pager. */
  featured: ReactNode
  defaultList: ReactNode
  defaultPager: ReactNode
  /** How many posts "More guides" holds across all pages of the static listing (the featured one left out). */
  moreCount: number
  /** A few topic links offered when a search finds nothing. */
  emptyTopics: ReactNode
  /** The listing's first page (`/blog`, `/blog/tags/<tag>`), where `?sort=…&q=…&page=N` applies. */
  basePath: string
  pageSize: number
  locale: string
}

/** Keys only, for rendering outside the provider (tests of single pieces). */
const keyEcho = Object.assign((key: string) => key, {
  rich: (key: string) => key,
  markup: (key: string) => key,
}) as ListingTranslator

const collapse = (value: string) => value.replace(/\s+/g, ' ').trim()

/**
 * The blog listing's sort and title search. With no `sort`/`q` in the URL it shows the static page
 * as the server rendered it (works without JavaScript). Otherwise it sorts and filters every live
 * post in scope in the browser, `pageSize` per page, the featured panel folded into the list.
 * State lives in the URL (`history.replaceState`, scroll kept), so a sorted or searched view can be
 * shared; the canonical stays the base page.
 */
export function ListingClient(props: ListingClientProps) {
  return (
    // useSearchParams needs a Suspense boundary; its fallback is the static page itself.
    <Suspense fallback={<ListingShell {...props} query={DEFAULT_LISTING_QUERY} />}>
      <ListingFromUrl {...props} />
    </Suspense>
  )
}

function ListingFromUrl(props: ListingClientProps) {
  const params = useSearchParams()
  return <ListingShell {...props} query={parseListingQuery(params)} />
}

export function ListingShell({
  entries,
  rows,
  featured,
  defaultList,
  defaultPager,
  moreCount,
  emptyTopics,
  basePath,
  pageSize,
  locale,
  query,
}: ListingClientProps & { query: ListingQuery }) {
  const state = useHelpfulCounts()
  const t = state?.t ?? keyEcho
  const pathname = usePathname()
  const searchRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(query.q)
  // Follow the URL when it changes from outside the field (Back, a shared link).
  const [seenQ, setSeenQ] = useState(query.q)
  if (seenQ !== query.q) {
    setSeenQ(query.q)
    if (collapse(text) !== query.q) setText(query.q)
  }

  // The native history API: Next syncs useSearchParams with it, with no server round trip per
  // keystroke (router.replace would re-render this dynamic page on the server each time).
  const update = (next: Partial<ListingQuery>) => {
    const qs = listingQueryString({ ...query, page: 1, ...next })
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname)
  }
  const setSearch = (value: string) => {
    setText(value)
    update({ q: collapse(value) })
  }
  const clearSearch = () => {
    setSearch('')
    searchRef.current?.focus()
  }

  const custom = !isDefaultListing(query)
  const searching = query.q !== ''
  const matches = custom ? sortEntries(filterByTitle(entries, query.q, locale), query.sort, state?.counts ?? {}) : []
  const totalPages = Math.max(1, Math.ceil(matches.length / pageSize))
  const page = Math.min(query.page, totalPages)
  const shown = matches.slice((page - 1) * pageSize, page * pageSize)
  // The static page's "More guides" leaves out the featured post; a sorted list folds it in.
  const listed = custom ? entries.length : moreCount

  // Nothing listed beside the featured post: the static page as it is.
  if (!custom && !defaultList) {
    return (
      <>
        {featured}
        {defaultPager}
      </>
    )
  }

  const heading = (
    <h2
      id="more-guides"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        'm-0 min-w-0',
        searching
          ? 'text-base font-medium text-foreground'
          : 'whitespace-nowrap font-mono text-xs font-medium uppercase tracking-[0.08em] text-text3 sm:text-[0.8125rem]'
      )}
    >
      {searching ? (
        t.rich('resultsMatch', {
          count: matches.length,
          query: query.q,
          q: (chunks) => (
            <span dir="auto" className="text-accent-foreground">
              {chunks}
            </span>
          ),
        })
      ) : (
        <>
          {t('moreGuides')}
          <span className="ms-2 tabular-nums text-text3 dark:text-text3/80">{listed}</span>
        </>
      )}
    </h2>
  )

  return (
    <ListingSearchContext.Provider value={{ q: query.q, locale }}>
      {/* The same element slots in every mode, so the search field keeps focus while typing. */}
      {custom ? null : featured}
      <section aria-labelledby="more-guides" className={custom ? 'mt-8 sm:mt-12' : 'mt-10 sm:mt-14'}>
        <div className={searching ? 'pb-2' : 'pb-4'}>
          <ListingToolbar
            heading={heading}
            search={text}
            onSearch={setSearch}
            searchRef={searchRef}
            sort={query.sort}
            onSort={(sort) => update({ sort })}
            t={t}
          />
        </div>
        {searching && (
          <p className="m-0 mb-4 text-sm text-text3">
            {t('searchingAll', { count: entries.length })}
            <span aria-hidden="true">{' · '}</span>
            <button
              type="button"
              onClick={clearSearch}
              className="text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {t('clearSearch')}
            </button>
          </p>
        )}
        {!custom ? (
          defaultList
        ) : shown.length > 0 ? (
          <div className="flex flex-col gap-8 sm:gap-3">
            {shown.map((entry) => (
              <div key={entry.slug}>{rows[entry.slug]}</div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-4 bg-surface px-6 py-10 sm:px-8 sm:py-12">
            <p className="m-0 text-lg font-semibold">{t('noResults', { query: query.q })}</p>
            <p className="m-0 text-text2">{t('emptyHint')}</p>
            {emptyTopics}
            <button
              type="button"
              onClick={clearSearch}
              className="mt-2 inline-flex min-h-11 items-center border border-border2 px-4 font-semibold text-foreground transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {t('clearSearch')}
            </button>
          </div>
        )}
      </section>
      {custom ? (
        <PagerView
          page={page}
          total={totalPages}
          hrefFor={(n) => {
            const qs = listingQueryString({ ...query, page: n })
            return qs ? `${basePath}?${qs}` : basePath
          }}
          labels={{
            nav: t('pagerLabel'),
            newer: t('newer'),
            older: t('older'),
            pageOf: (p, total) => t('pageOf', { page: p, total }),
            pageNumber: (p) => t('pageNumber', { page: p }),
          }}
        />
      ) : (
        defaultPager
      )}
    </ListingSearchContext.Provider>
  )
}
