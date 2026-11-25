'use client'

import { useMemo, useRef, useState } from 'react'
import { createTranslator } from 'next-intl'
import { SearchField } from '@/components/blog/ListingToolbar'
import type { ListingTranslator } from '@/components/blog/HelpfulCounts'
import { Link } from '@/i18n/navigation'
import { filterTags } from '@/lib/blog/tagOrder'

/** One tag on the all-topics page, worded on the server ("#save-tabs", "3 articles"). */
export interface DirectoryTag {
  tag: string
  label: string
  /** "3 articles" in the page's language. */
  countLabel: string
  href: string
}

/** The raw ICU messages the page formats in the browser (the search field and the result line). */
export type DirectoryMessages = Record<'searchLabel' | 'searchPlaceholder' | 'clearSearch' | 'results' | 'noResults', string>

/**
 * The all-topics page's searchable list: a search field filtering the tags by label (case and
 * accents ignored, as the guide search does), a polite live line with the number of matches, an
 * empty state, and every tag as a card linking to its page with its article count. The tags come
 * ordered by relevance from the server; filtering keeps that order.
 */
export function TagDirectory({ locale, tags, messages }: { locale: string; tags: readonly DirectoryTag[]; messages: DirectoryMessages }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const t = useMemo(
    () => createTranslator({ locale: locale as never, messages: { topics: messages }, namespace: 'topics' as never }) as unknown as ListingTranslator,
    [locale, messages]
  )
  const shown = filterTags(tags, query, locale)
  const searching = query.trim() !== ''

  return (
    <div className="mt-8 flex flex-col gap-5">
      <SearchField value={query} onChange={setQuery} inputRef={inputRef} t={t} className="w-full sm:max-w-[24rem]" />
      <p aria-live="polite" className="m-0 text-sm text-text2">
        {searching && shown.length === 0 ? t('noResults', { query: query.trim() }) : t('results', { count: shown.length })}
      </p>
      {shown.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((entry) => (
            <li key={entry.tag} className="min-w-0">
              <Link
                href={entry.href}
                className="flex min-h-14 min-w-0 items-center justify-between gap-3 border border-border bg-surface px-4 py-3 no-underline transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span dir="auto" className="min-w-0 break-words font-mono text-[0.9375rem] text-foreground">
                  {'#'}
                  {entry.label}
                </span>
                <span className="shrink-0 text-sm text-text3">{entry.countLabel}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
