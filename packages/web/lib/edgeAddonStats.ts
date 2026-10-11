// Server-only: reads rating stats and reviews for the Microsoft Edge Add-ons listing.
// Edge has no documented ratings API. This reads the two public JSON endpoints its own
// listing page loads: the product details (`EDGE_PRODUCT_DETAILS_URL`: mean rating, rating
// count, and the store's product ID) and, addressed by that product ID, the reviews.

import { EDGE_PRODUCT_DETAILS_URL, EDGE_REVIEWS_API_URL, STORE_LISTING_URL } from '@tabmerger/shared'
import {
  STORE_STATS_REVALIDATE_SECONDS,
  isUsableRating,
  selectStoreReviews,
  type ReviewCandidate,
  type StoreRatingStats,
  type StoreReview,
} from '@/lib/storeReviews'

const REVALIDATE = { next: { revalidate: STORE_STATS_REVALIDATE_SECONDS } }

interface EdgeProductDetails {
  averageRating?: unknown
  ratingCount?: unknown
  storeProductId?: unknown
}

/**
 * The only fields read from a review. The response carries more per review, including
 * identifiers of the reviewer's account and device. Those are deliberately absent here:
 * never add them to this type, log them, or copy them into a fixture.
 */
interface EdgeReviewItem {
  Rating?: unknown
  ReviewText?: unknown
  UserName?: unknown
  SubmittedDateTime?: unknown
  IsTakenDown?: unknown
  IsPublished?: unknown
}

/** First page, newest first. The shared rules keep at most a dozen reviews anyway. */
const REVIEWS_QUERY = 'catalogId=1&callSiteId=3&pageSize=25&orderBy=1&skipItems=0'

/** A timestamp as an ISO string, or null when it isn't one — a review's date is never guessed. */
function toIsoDate(value: unknown): string | null {
  // Only a timestamp that states its own offset: one without would be read in the
  // server's timezone and could land in a different month.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

/**
 * Maps the reviews response to review candidates and applies the shared selection rules.
 * Reviews the store has taken down or not published are skipped, as is one whose date
 * can't be read. Edge has no page per review, so every card links to the listing.
 */
export function selectEdgeReviews(items: unknown): StoreReview[] {
  if (!Array.isArray(items)) return []

  const candidates: ReviewCandidate[] = []
  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null) continue
    const { Rating, ReviewText, UserName, SubmittedDateTime, IsTakenDown, IsPublished } = raw as EdgeReviewItem
    if (IsTakenDown === true || IsPublished === false) continue

    const date = toIsoDate(SubmittedDateTime)
    if (date === null || typeof Rating !== 'number' || typeof ReviewText !== 'string') continue

    candidates.push({
      quote: ReviewText,
      author: typeof UserName === 'string' ? UserName : undefined,
      date,
      score: Rating,
      url: STORE_LISTING_URL.EDGE_STABLE,
      store: 'edge',
    })
  }
  return selectStoreReviews(candidates)
}

/** Reviews for the store's product ID. Any failure yields no reviews; it never throws. */
async function fetchEdgeReviews(storeProductId: unknown): Promise<StoreReview[]> {
  // Goes into a URL: accept only the plain ID the store issues.
  if (typeof storeProductId !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(storeProductId)) return []
  try {
    const res = await fetch(`${EDGE_REVIEWS_API_URL}/${storeProductId}?${REVIEWS_QUERY}`, REVALIDATE)
    if (!res.ok) return []
    const data = (await res.json()) as { Items?: unknown } | null
    return selectEdgeReviews(data?.Items)
  } catch {
    return []
  }
}

/**
 * Returns null if the listing can't be read, the response isn't the expected shape, or
 * the item has no ratings — never fabricates numbers.
 *
 * Reviews are optional: when they can't be fetched or read, the rating stats are still
 * returned, with `reviews: []`.
 */
export async function getEdgeAddonStats(): Promise<StoreRatingStats | null> {
  try {
    const res = await fetch(EDGE_PRODUCT_DETAILS_URL, REVALIDATE)
    if (!res.ok) return null

    const { averageRating, ratingCount, storeProductId } = (await res.json()) as EdgeProductDetails
    if (typeof averageRating !== 'number' || typeof ratingCount !== 'number') return null
    if (!isUsableRating(averageRating, ratingCount)) return null

    return { rating: averageRating, ratingCount, reviews: await fetchEdgeReviews(storeProductId) }
  } catch {
    return null
  }
}
