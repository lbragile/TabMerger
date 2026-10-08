// Server-only: the review type and the selection rules every store module shares.
// Import it from server code only. It builds a profanity matcher at module load, so a client
// component that needs a store's name imports `lib/stores.ts` instead.

import {
  RegExpMatcher,
  TextCensor,
  asteriskCensorStrategy,
  englishDataset,
  englishRecommendedTransformers,
  keepStartCensorStrategy,
} from 'obscenity'
import type { StoreId } from '@/lib/stores'

export interface StoreReview {
  quote: string
  author: string
  /** ISO timestamp. Rendered next to the quote so old reviews read as old. */
  date: string
  score: number
  /** The review on its store, linked from the card as "Read full review". */
  url: string
  /** The store the review was left on. The card names it; it is never guessed. */
  store: StoreId
}

/** What one store's module returns: its own figures and the reviews it could supply. */
export interface StoreRatingStats {
  /** As precise as the store publishes it. Rounded only when displayed (`formatRating`). */
  rating: number
  ratingCount: number
  reviews: StoreReview[]
}

/** A review as read from a store, before the rules below decide whether it is shown. */
export interface ReviewCandidate {
  quote: string | null | undefined
  author: string | undefined
  date: string
  score: number
  url: string
  store: StoreId
}

/** How long a store's figures are cached: 6 hours. Store ratings don't change fast. */
export const STORE_STATS_REVALIDATE_SECONDS = 21600

/**
 * Reviews are shown VERBATIM or not at all. The rules below only ever EXCLUDE a
 * review; none of them edit one.
 *
 * Why 4★ and long reviews are allowed: the card shows each review's real score,
 * clamps the text visually (the full text stays in the DOM) and links to the
 * complete review on the store. On these listings the criticism in each mixed
 * review appears within its first couple of lines, so the clamp doesn't turn a
 * mixed review into apparent praise. Showing honest 4★ feedback is less
 * cherry-picked, not more.
 *
 * - 4★ and up. Below that, the review is a complaint, not a testimonial.
 * - Ordered 5★ first, then newest.
 * - At most MAX_REVIEWS per store.
 */
const MIN_SCORE = 4
const MAX_SCORE = 5
const MIN_LEN = 20
const MAX_REVIEWS = 12

/**
 * Stores name their anonymized accounts with a placeholder: "Firefox user 13445065" on
 * Firefox Add-ons, "A Google user" on the Chrome Web Store. That is not a person's name,
 * so replacing it drops nothing true.
 */
const ANONYMOUS = 'Anonymous reviewer'
const PLACEHOLDER_NAME = /^(?:Firefox user\s*\d*|A Google user)$/i

/**
 * Store reviews and display names are written by anyone, so profanity is censored
 * before they reach the marketing page: "f***", keeping the first letter so the
 * sentence still reads naturally. The review stays; only the word is masked.
 * obscenity also catches disguised spellings ("fvck", "sh1t", "fuuuck") — though not
 * letters spaced apart ("f u c k") — and skips innocent words that merely contain a
 * match ("Scunthorpe"). Built once at module load.
 */
const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
})
const profanityCensor = new TextCensor().setStrategy(keepStartCensorStrategy(asteriskCensorStrategy()))

export function censorProfanity(text: string): string {
  const matches = profanityMatcher.getAllMatches(text, true)
  return matches.length ? profanityCensor.applyTo(text, matches) : text
}

export function displayAuthor(name: string | undefined): string {
  const trimmed = name?.trim()
  if (!trimmed || PLACEHOLDER_NAME.test(trimmed)) return ANONYMOUS
  return censorProfanity(trimmed)
}

/**
 * Applies the rules above to one store's reviews. A score that is not a whole number of
 * stars from 4 to 5 is excluded too: the card draws one star per point.
 */
export function selectStoreReviews(candidates: ReviewCandidate[]): StoreReview[] {
  return candidates
    .filter((c) => {
      const body = c.quote?.trim() ?? ''
      return Number.isInteger(c.score) && c.score >= MIN_SCORE && c.score <= MAX_SCORE && body.length >= MIN_LEN
    })
    .sort((a, b) => b.score - a.score || b.date.localeCompare(a.date))
    .slice(0, MAX_REVIEWS)
    .map((c) => ({
      quote: censorProfanity((c.quote ?? '').trim()),
      author: displayAuthor(c.author),
      date: c.date,
      score: c.score,
      url: c.url,
      store: c.store,
    }))
}

/**
 * True for figures a store can really have: a mean above 0 and at most 5, from at least
 * one rating. Anything else is treated as "no data" rather than shown.
 */
export function isUsableRating(rating: unknown, ratingCount: unknown): boolean {
  return (
    typeof rating === 'number' &&
    typeof ratingCount === 'number' &&
    Number.isFinite(rating) &&
    Number.isInteger(ratingCount) &&
    rating > 0 &&
    rating <= MAX_SCORE &&
    ratingCount > 0
  )
}
