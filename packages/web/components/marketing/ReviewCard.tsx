import { STORE_LABEL } from '@/lib/stores'
// Type only: `lib/storeReviews.ts` is server-only (it builds a profanity matcher at load).
import type { StoreReview } from '@/lib/storeReviews'
import { STORE_ICON } from './BrowserIcons'
import { CARD_BOX_CLASS } from './reviewsLayout'

/**
 * The card's width and the stride contract, in one place: `./reviewsLayout`.
 *
 * - The card is 20rem wide, or as wide as the strip when the strip is narrower (CARD_BOX_CLASS),
 *   so its width is not a constant any more.
 * - The carousel therefore measures the stride (card width + the track's gap) from the DOM,
 *   and re-measures when the track resizes. It uses that for stepping, swiping and wrapping.
 * - `buildMarqueeTrack` runs on the server, where nothing can be measured. It sizes the loop
 *   with MIN_CARD_STRIDE_PX, the narrowest stride, so the loop is long enough at any width.
 *
 * Re-exported because it is the nominal (full-size) stride tests and callers know it by.
 */
export { CARD_STRIDE_PX } from './reviewsLayout'

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
 * full review stays in the DOM (screen readers read all of it) and the link opens it on
 * the store. The card has a fixed height so every card in the rotating track lines up.
 *
 * Top line: the stars, the date, and the store the review comes from, written out. The
 * browser icon on the bottom line repeats the store for the eye and is hidden from
 * assistive tech, so the store is never conveyed by an icon or a colour alone.
 *
 * Bottom line: icon, author, and the link at the right edge. It never wraps (a second line
 * would push against the fixed height): the author's name is the part that gives way, cut
 * with an ellipsis, while the link keeps its full width. The whole name stays in the DOM
 * and in the `title`. The date sits on the top line because, with the icon, the bottom one
 * had room for only about 16 characters of name — less than "Anonymous reviewer".
 *
 * The link is always underlined: inside a card it is the only thing that can be clicked, and
 * colour alone must not be what says so. Its visible words are the same on every card, so
 * a screen reader also gets the reviewer and the store after them: eighteen links all
 * reading "Read full review" can't be told apart in a list of links.
 *
 * Decision: the link reads "Read full review" for every store, including one whose reviews
 * have no page of their own, where it opens the store's listing instead.
 *
 * Decision: the quote carries no `lang` attribute, even when it is not in English. The only
 * signal a store gives (a locale) describes the reviewer's market, not the language they
 * wrote in, and a wrong `lang` is worse than none.
 */
export function ReviewCard({ review, hidden = false }: { review: StoreReview; hidden?: boolean }) {
  const StoreIcon = STORE_ICON[review.store]
  const storeLabel = STORE_LABEL[review.store]
  return (
    <div
      className={`${CARD_BOX_CLASS} flex flex-col`}
      // Repeats exist only to fill the loop. Screen readers get each review once, as one
      // item of the list the track is.
      role={hidden ? undefined : 'listitem'}
      aria-hidden={hidden || undefined}
    >
      <div className="flex items-center gap-2 mb-2.5 text-xs text-text3">
        {/* Not `text-primary`: the light theme's brand cyan is under 3:1 on a white card. */}
        <div className="shrink-0 text-[hsl(var(--star))]" role="img" aria-label={`${review.score} out of 5 stars`}>
          {'★'.repeat(review.score)}
          {'☆'.repeat(5 - review.score)}
        </div>
        {/* The date is deliberate: these reviews may predate the current version,
            and a reader should be able to see that rather than assume otherwise. */}
        <time dateTime={review.date} className="shrink-0 whitespace-nowrap">
          {formatMonth(review.date)}
        </time>
        <span className="ml-auto min-w-0 truncate">{storeLabel}</span>
      </div>
      <p className="text-[0.84375rem] leading-relaxed line-clamp-5 whitespace-pre-line">&ldquo;{review.quote}&rdquo;</p>
      <p className="text-[0.75rem] text-text3 mt-auto pt-2 flex items-center gap-1.5 min-w-0">
        <span aria-hidden="true" className="shrink-0 [&>svg]:block [&>svg]:h-3.5 [&>svg]:w-3.5">
          <StoreIcon />
        </span>
        <span className="min-w-0 truncate" title={review.author}>
          {review.author}
        </span>
        <a
          href={review.url}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={hidden ? -1 : undefined}
          className="ml-auto shrink-0 whitespace-nowrap pl-1.5 underline underline-offset-2 hover:text-foreground"
        >
          Read full review
          <span className="sr-only">
            {' '}
            by {review.author} on {storeLabel}
          </span>
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>
    </div>
  )
}
