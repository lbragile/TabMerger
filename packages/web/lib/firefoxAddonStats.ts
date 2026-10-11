// Server-only: reads rating stats and reviews from Firefox Add-ons (AMO).
// Unlike the Chrome Web Store, AMO has a documented public JSON API, so nothing
// here is scraped: https://addons-server.readthedocs.io/en/latest/topics/api/
// The review type and the rules deciding which reviews are shown live in
// `lib/storeReviews.ts`, shared with the other stores.

import { FIREFOX_LISTING_SLUG } from '@tabmerger/shared'
import {
  STORE_STATS_REVALIDATE_SECONDS,
  isUsableRating,
  selectStoreReviews,
  type StoreRatingStats,
  type StoreReview,
} from '@/lib/storeReviews'

const AMO_API = 'https://addons.mozilla.org/api/v5'

interface AmoAddon {
  ratings?: { average?: number; count?: number }
}

interface AmoRating {
  id?: number
  score: number
  body: string | null
  created: string
  user?: { name?: string }
}

/** Maps AMO's ratings to review candidates and applies the shared selection rules. */
export function selectReviews(results: AmoRating[], slug: string = FIREFOX_LISTING_SLUG): StoreReview[] {
  const listing = `https://addons.mozilla.org/firefox/addon/${encodeURIComponent(slug)}/reviews/`
  return selectStoreReviews(
    results.map((r) => ({
      quote: r.body,
      author: r.user?.name,
      date: r.created,
      score: r.score,
      url: r.id ? `${listing}${r.id}/` : listing,
      store: 'firefox' as const,
    })),
  )
}

/**
 * Returns null if the add-on can't be read or has no ratings — never fabricates.
 * Slug defaults to this project's public listing and can be overridden per
 * environment.
 */
export async function getFirefoxAddonStats(): Promise<StoreRatingStats | null> {
  const slug = process.env.FIREFOX_ADDON_SLUG || FIREFOX_LISTING_SLUG
  const revalidate = { next: { revalidate: STORE_STATS_REVALIDATE_SECONDS } }

  try {
    const [addonRes, ratingsRes] = await Promise.all([
      fetch(`${AMO_API}/addons/addon/${encodeURIComponent(slug)}/`, revalidate),
      fetch(`${AMO_API}/ratings/rating/?addon=${encodeURIComponent(slug)}&page_size=50`, revalidate),
    ])
    if (!addonRes.ok) return null

    const addon = (await addonRes.json()) as AmoAddon
    const average = addon.ratings?.average
    const count = addon.ratings?.count
    if (typeof average !== 'number' || typeof count !== 'number' || !isUsableRating(average, count)) return null

    // Reviews are optional: a failed ratings call still leaves valid headline stats.
    let reviews: StoreReview[] = []
    if (ratingsRes.ok) {
      const data = (await ratingsRes.json()) as { results?: AmoRating[] }
      reviews = selectReviews(data.results ?? [], slug)
    }

    return {
      // Unrounded (AMO reports e.g. 3.9333). Decision: ratings are displayed with two
      // decimals, and rounding happens only at display (`formatRating`), so the figure
      // combined across stores is computed from the full value.
      rating: average,
      ratingCount: count,
      reviews,
    }
  } catch {
    return null
  }
}
