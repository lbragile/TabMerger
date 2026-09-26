// Server-only: reads rating stats and reviews from Firefox Add-ons (AMO).
// Unlike the Chrome Web Store, AMO has a documented public JSON API, so nothing
// here is scraped: https://addons-server.readthedocs.io/en/latest/topics/api/

import {
  RegExpMatcher,
  TextCensor,
  asteriskCensorStrategy,
  englishDataset,
  englishRecommendedTransformers,
  keepStartCensorStrategy,
} from 'obscenity'

export interface StoreReview {
  quote: string
  author: string
  /** ISO timestamp. Rendered next to the quote so old reviews read as old. */
  date: string
  score: number
  /** The review on its store, linked from the card as "Read full review". */
  url: string
}

export interface FirefoxAddonStats {
  rating: number
  ratingCount: number
  reviews: StoreReview[]
}

const AMO_API = 'https://addons.mozilla.org/api/v5'

/**
 * Reviews are shown VERBATIM or not at all. The rules below only ever EXCLUDE a
 * review; none of them edit one.
 *
 * Why 4★ and long reviews are allowed: the card shows each review's real score,
 * clamps the text visually (the full text stays in the DOM) and links to the
 * complete review on the store. On this listing the criticism in each mixed
 * review appears within its first couple of lines, so the clamp doesn't turn a
 * mixed review into apparent praise. Showing honest 4★ feedback is less
 * cherry-picked, not more.
 *
 * - 4★ and up. Below that, the review is a complaint, not a testimonial.
 * - Ordered 5★ first, then newest.
 */
const MIN_SCORE = 4
const MIN_LEN = 20
const MAX_REVIEWS = 12

/**
 * AMO's anonymized accounts are literally named "Firefox user 13445065". That is a
 * placeholder rather than a person's name, so replacing it drops nothing true —
 * and keeps the store out of the attribution line.
 */
const ANONYMOUS = 'Anonymous reviewer'
const AMO_PLACEHOLDER_NAME = /^Firefox user\s*\d*$/i

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

function displayAuthor(name: string | undefined): string {
  const trimmed = name?.trim()
  if (!trimmed || AMO_PLACEHOLDER_NAME.test(trimmed)) return ANONYMOUS
  return censorProfanity(trimmed)
}

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

const DEFAULT_SLUG = 'tabmerger'

export function selectReviews(results: AmoRating[], slug = DEFAULT_SLUG): StoreReview[] {
  const listing = `https://addons.mozilla.org/firefox/addon/${encodeURIComponent(slug)}/reviews/`
  return results
    .filter((r) => {
      const body = r.body?.trim() ?? ''
      return r.score >= MIN_SCORE && body.length >= MIN_LEN
    })
    .sort((a, b) => b.score - a.score || b.created.localeCompare(a.created))
    .slice(0, MAX_REVIEWS)
    .map((r) => ({
      quote: censorProfanity((r.body ?? '').trim()),
      author: displayAuthor(r.user?.name),
      date: r.created,
      score: r.score,
      url: r.id ? `${listing}${r.id}/` : listing,
    }))
}

/**
 * Returns null if the add-on can't be read or has no ratings — never fabricates.
 * Slug defaults to this project's public listing and can be overridden per
 * environment.
 */
export async function getFirefoxAddonStats(): Promise<FirefoxAddonStats | null> {
  const slug = process.env.FIREFOX_ADDON_SLUG || DEFAULT_SLUG
  const revalidate = { next: { revalidate: 21600 } } // 6 hours, same as Chrome

  try {
    const [addonRes, ratingsRes] = await Promise.all([
      fetch(`${AMO_API}/addons/addon/${encodeURIComponent(slug)}/`, revalidate),
      fetch(`${AMO_API}/ratings/rating/?addon=${encodeURIComponent(slug)}&page_size=50`, revalidate),
    ])
    if (!addonRes.ok) return null

    const addon = (await addonRes.json()) as AmoAddon
    const average = addon.ratings?.average
    const count = addon.ratings?.count
    if (typeof average !== 'number' || typeof count !== 'number' || count === 0) return null

    // Reviews are optional: a failed ratings call still leaves valid headline stats.
    let reviews: StoreReview[] = []
    if (ratingsRes.ok) {
      const data = (await ratingsRes.json()) as { results?: AmoRating[] }
      reviews = selectReviews(data.results ?? [], slug)
    }

    return {
      // AMO reports e.g. 3.9333; the store UI shows one decimal and so do we.
      rating: Math.round(average * 10) / 10,
      ratingCount: count,
      reviews,
    }
  } catch {
    return null
  }
}
