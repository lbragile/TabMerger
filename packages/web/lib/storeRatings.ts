// Server-only: gathers the three stores' figures and reviews for the landing page.

import { getChromeStoreStats } from '@/lib/chromeStoreStats'
import { getEdgeAddonStats } from '@/lib/edgeAddonStats'
import { getFirefoxAddonStats } from '@/lib/firefoxAddonStats'
import { STORE_IDS, type StoreId } from '@/lib/stores'
import type { StoreRatingStats, StoreReview } from '@/lib/storeReviews'

/** One store's figures, tagged with the store they came from. */
export interface StoreRating extends StoreRatingStats {
  store: StoreId
}

export interface StoreRatings {
  /** Only the stores that returned data, in STORE_IDS order. Never empty. */
  stores: StoreRating[]
  /** Mean of every rating given, across `stores`. Unrounded. */
  rating: number
  /** Number of ratings across `stores`. */
  ratingCount: number
  /** Reviews from every store that supplied texts, interleaved. */
  reviews: StoreReview[]
}

const SOURCES: Record<StoreId, () => Promise<StoreRatingStats | null>> = {
  chrome: getChromeStoreStats,
  firefox: getFirefoxAddonStats,
  edge: getEdgeAddonStats,
}

/**
 * Decision: the headline figure is one number across every store that returned data, with
 * each store's own figures listed beside it.
 *
 * The combined rating is the mean of the stores' ratings weighted by their rating counts.
 * That is not an average of averages: a store's mean times its count is the sum of the
 * ratings it received, so the weighted mean is the total of all ratings divided by the
 * number of ratings — the mean of every individual rating given, wherever it was given. A
 * store with a handful of ratings moves it far less than one with many, as it should. It
 * is exact to the precision each store publishes its own mean with.
 */
export function combineRatings(stores: Pick<StoreRatingStats, 'rating' | 'ratingCount'>[]): {
  rating: number
  ratingCount: number
} {
  const ratingCount = stores.reduce((sum, s) => sum + s.ratingCount, 0)
  if (ratingCount === 0) return { rating: 0, ratingCount: 0 }
  const total = stores.reduce((sum, s) => sum + s.rating * s.ratingCount, 0)
  return { rating: total / ratingCount, ratingCount }
}

/**
 * Merges each store's reviews into one list in which the stores alternate instead of
 * appearing in blocks. Every list keeps its own order (5★ first, then newest) and is
 * spread evenly along the result: item i of an n-item list sits at (i + ½) / n. Equal
 * lists alternate strictly; a short list is spaced out through a long one rather than
 * used up at the start. Ties go to the list given first.
 */
export function interleaveReviews<T>(lists: T[][]): T[] {
  return lists
    .flatMap((list, listIndex) => list.map((item, i) => ({ item, listIndex, at: (i + 0.5) / list.length })))
    .sort((a, b) => a.at - b.at || a.listIndex - b.listIndex)
    .map(({ item }) => item)
}

/**
 * Decision: ratings are displayed with two decimals, always ("4.57", "3.00"). This is the
 * only place a rating is rounded: everything upstream keeps the unrounded value, so the
 * combined mean is computed from full precision and rounded once.
 */
export function formatRating(rating: number): string {
  return (Math.round(rating * 100) / 100).toFixed(2)
}

const MAX_DEV_DELAY_MS = 30_000

/**
 * How long to hold the reviews back, in ms: 0 everywhere except a development server
 * started with REVIEWS_DELAY_MS set to a positive whole number (capped at 30 seconds).
 *
 * The NODE_ENV check comes first and is written out in full, so a production build has it
 * replaced by a constant and the rest is never reached. Nothing here reads the request.
 */
export function devReviewsDelayMs(): number {
  if (process.env.NODE_ENV !== 'development') return 0
  const raw = process.env.REVIEWS_DELAY_MS
  if (!raw || !/^[0-9]+$/.test(raw)) return 0
  return Math.min(Number(raw), MAX_DEV_DELAY_MS)
}

/**
 * Fetches the three stores in parallel. A store that fails, or has no ratings, is left
 * out; the others are still shown. Returns null only when no store returned data.
 */
export async function getStoreRatings(): Promise<StoreRatings | null> {
  // Development only: REVIEWS_DELAY_MS keeps the loading placeholder up long enough to look at.
  const delayMs = devReviewsDelayMs()
  const delay = delayMs > 0 ? new Promise<void>((resolve) => setTimeout(resolve, delayMs)) : null

  // `async` so that a source failing synchronously is a rejection too, not a thrown error.
  const settled = await Promise.allSettled(STORE_IDS.map(async (store) => SOURCES[store]()))
  await delay

  const stores: StoreRating[] = settled.flatMap((result, i) =>
    result.status === 'fulfilled' && result.value ? [{ ...result.value, store: STORE_IDS[i] }] : [],
  )
  if (stores.length === 0) return null

  return {
    stores,
    ...combineRatings(stores),
    reviews: interleaveReviews(stores.map((s) => s.reviews ?? [])),
  }
}
