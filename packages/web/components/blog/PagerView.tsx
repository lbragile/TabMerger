import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'

/** The pager's words; the server page and the client listing each build them. */
export interface PagerLabels {
  nav: string
  newer: string
  older: string
  pageOf: (page: number, total: number) => string
  pageNumber: (page: number) => string
}

/**
 * "← Newer", the page numbers ("Page X of Y" on phones) and "Older →". An end with nowhere to go
 * is shown but unavailable (a span with `aria-disabled`, not a link). Hidden with a single page.
 */
export function PagerView({ page, total, hrefFor, labels }: { page: number; total: number; hrefFor: (page: number) => string; labels: PagerLabels }) {
  if (total <= 1) return null
  const end = 'inline-flex min-h-11 items-center gap-2 px-1 text-[0.9375rem] sm:px-4'
  const newer = (
    <>
      <ArrowLeft aria-hidden="true" className="size-4 rtl:-scale-x-100" />
      {labels.newer}
    </>
  )
  const older = (
    <>
      {labels.older}
      <ArrowRight aria-hidden="true" className="size-4 rtl:-scale-x-100" />
    </>
  )
  const link = 'border border-border2 font-semibold text-foreground no-underline hover:bg-surface3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
  return (
    <nav aria-label={labels.nav} className="mt-10 flex flex-wrap items-center justify-between gap-2 sm:mt-14 sm:gap-4">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} rel="prev" className={cn(end, link, 'px-4')}>
          {newer}
        </Link>
      ) : (
        <span aria-disabled="true" className={cn(end, 'text-text3 opacity-60')}>
          {newer}
        </span>
      )}
      <ol className="m-0 hidden list-none gap-1 p-0 sm:flex">
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
          <li key={n}>
            <Link
              href={hrefFor(n)}
              aria-current={n === page ? 'page' : undefined}
              aria-label={labels.pageNumber(n)}
              className={cn(
                'flex size-11 items-center justify-center tabular-nums no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                n === page ? 'bg-accent font-semibold text-accent-foreground' : 'text-text2 hover:bg-surface3 hover:text-foreground'
              )}
            >
              {n}
            </Link>
          </li>
        ))}
      </ol>
      <span className="text-sm text-text3 sm:hidden">{labels.pageOf(page, total)}</span>
      {page < total ? (
        <Link href={hrefFor(page + 1)} rel="next" className={cn(end, link, 'px-4')}>
          {older}
        </Link>
      ) : (
        <span aria-disabled="true" className={cn(end, 'text-text3 opacity-60')}>
          {older}
        </span>
      )}
    </nav>
  )
}

