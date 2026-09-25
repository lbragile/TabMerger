import type { StoreReview } from '@/lib/firefoxAddonStats'

/**
 * Formatted in UTC. `toLocaleDateString` otherwise uses the timezone of whatever
 * machine renders it, so a review posted at 2020-12-01T00:00Z reads "Dec 2020" on
 * a UTC server and "Nov 2020" anywhere west of Greenwich.
 */
export function formatMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/**
 * One review in the marquee. Text is clamped to five lines VISUALLY only — the
 * full review stays in the DOM (screen readers read all of it) and "Read full
 * review" opens it on the store. The card has a fixed height so every card in the
 * rotating track lines up.
 */
export function ReviewCard({ review, hidden = false }: { review: StoreReview; hidden?: boolean }) {
  return (
    <div
      className="shrink-0 w-[320px] h-[228px] rounded-xl border border-border bg-surface px-5 py-4 flex flex-col"
      // Repeats exist only to fill the loop. Screen readers get each review once.
      aria-hidden={hidden || undefined}
    >
      <div className="text-primary text-xs mb-2.5" role="img" aria-label={`${review.score} out of 5 stars`}>
        {'★'.repeat(review.score)}
        {'☆'.repeat(5 - review.score)}
      </div>
      <p className="text-[13.5px] leading-relaxed line-clamp-5 whitespace-pre-line">&ldquo;{review.quote}&rdquo;</p>
      {/* The date is deliberate: these reviews may predate the current version,
          and a reader should be able to see that rather than assume otherwise. */}
      <p className="text-[12px] text-text3 mt-auto pt-2">
        {review.author} · {formatMonth(review.date)} ·{' '}
        <a
          href={review.url}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={hidden ? -1 : undefined}
          className="underline-offset-2 hover:underline"
        >
          Read full review
        </a>
      </p>
    </div>
  )
}
