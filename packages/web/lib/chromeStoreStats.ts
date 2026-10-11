// Server-only: fetches public Chrome Web Store HTML and parses rating stats and reviews.
// No official REST API exists for this, so we scrape two public pages: the listing (rating,
// rating count) and its reviews page (review texts).
// ponytail: regex against known markup instead of pulling in an HTML parser dep.

import { CHROME_EXTENSION_ID } from '@tabmerger/shared'
import {
  STORE_STATS_REVALIDATE_SECONDS,
  isUsableRating,
  selectStoreReviews,
  type ReviewCandidate,
  type StoreRatingStats,
  type StoreReview,
} from '@/lib/storeReviews'

const CWS_DETAIL = 'https://chromewebstore.google.com/detail'

/**
 * The store serves a JavaScript shell with no product data to clients that don't
 * look like a browser — including Node's default fetch. Without this header the
 * response never contains a rating, so this function always returned null.
 */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'

/**
 * Asks for the English pages wherever the server runs. Everything parsed below is English
 * text: "out of 5 stars", "ratings", and review dates such as "Oct 20, 2021".
 */
const ENGLISH = '?hl=en'

/**
 * The headline rating, e.g. `aria-label="4.5 out of 5 stars"`. Recommended items
 * further down the page carry `aria-label="Average rating 4.1 out of 5 stars."`;
 * requiring the digits immediately after the opening quote excludes those.
 */
const RATING_RE = /aria-label="([\d.]+) out of 5 stars"/

/** The rating count, abbreviated by the store: `47 ratings`, `3.6K ratings`, `1.2M ratings`. */
const COUNT_RE = />([\d.,]+)([KM]?) ratings?</

function parseAbbreviated(value: string, suffix: string): number {
  const n = Number.parseFloat(value.replace(/,/g, ''))
  if (suffix === 'K') return Math.round(n * 1_000)
  if (suffix === 'M') return Math.round(n * 1_000_000)
  return n
}

const roundToOneDecimal = (n: number) => Math.round(n * 10) / 10

/**
 * The visible rating is rounded to one decimal ("4.6"). The page's embedded data holds the
 * unrounded mean right before the exact rating count (`…,4.571428571428571,28,…`). Ratings
 * are displayed with two decimals and combined across stores, and both are only right when
 * computed from that: "4.6" would print as 4.60 for a mean that is really 4.57, and is
 * enough to shift the combined figure in its second decimal.
 *
 * A value is accepted only when it is followed by the same count the page shows and rounds
 * to the same rating the page shows. Otherwise the visible rating is returned unchanged.
 */
const PRECISE_RATING_RE = /(?<=[,[])(\d\.\d+),(\d+)(?=[,\]])/g

function preciseRating(html: string, shown: number, ratingCount: number): number {
  for (const match of html.matchAll(PRECISE_RATING_RE)) {
    const value = Number.parseFloat(match[1])
    if (Number.parseInt(match[2], 10) === ratingCount && roundToOneDecimal(value) === shown) return value
  }
  return shown
}

/** Rating and rating count from the listing page, or null when the page doesn't carry them. */
export function parseChromeRating(html: string): { rating: number; ratingCount: number } | null {
  const ratingMatch = html.match(RATING_RE)
  const countMatch = html.match(COUNT_RE)
  if (!ratingMatch || !countMatch) return null

  const shown = Number.parseFloat(ratingMatch[1])
  const ratingCount = parseAbbreviated(countMatch[1], countMatch[2])
  if (!isUsableRating(shown, ratingCount)) return null

  return { rating: preciseRating(html, shown, ratingCount), ratingCount }
}

// ---------------------------------------------------------------------------
// Reviews page
// ---------------------------------------------------------------------------

/**
 * The reviews page (`/detail/<id>/reviews`) server-renders its first page of reviews, each
 * shaped like this (class names are generated and change, so nothing below relies on them):
 *
 *   <section …>
 *     <h3 …><span …>NAME</span><div role="img" aria-label="5 out of 5 stars" …>…</div><span …>Oct 20, 2021</span></h3>
 *     … an options menu …
 *     <p …><span …>REVIEW TEXT</span></p>
 *     <section …> … the developer's reply, when there is one … </section>
 *   </section>
 *
 * A review longer than about 500 characters is cut short in that markup: the text ends in
 * "..." and a "Show more" button follows it inside the same `<p>`. Its complete text is in
 * the page's embedded data, and is recovered from there (see `completeText`).
 */

/** One review's star label. A whole number of stars; the headline rating has a decimal. */
const REVIEW_SCORE_RE = /aria-label="([1-5]) out of 5 stars"/

/** A `<span>` holding only text. */
const SPAN_TEXT_RE = /<span(?:\s[^>]*)?>([^<]*)<\/span>/g

/**
 * The review body: the first `<p>` whose first child is a text-only `<span>`. `<p` must be
 * followed by whitespace or `>` — the page is full of `<path>` elements. Group 2 is the
 * closing `</p>` when it comes straight after the span, which is what an uncut review has.
 */
const REVIEW_BODY_RE = /<p(?:\s[^>]*)?>\s*<span(?:\s[^>]*)?>([^<]*)<\/span>\s*(<\/p>)?/

/** Where a review's own content ends: its developer reply, or the end of its section. */
const REVIEW_END_MARKERS = ['<section', '</section>', 'role="heading"']

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Decodes the entities the store escapes text with. An unknown entity is left as written. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]+));/gi, (whole, dec, hex, name) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? whole
    const code = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "Oct 20, 2021" → "2021-10-20T00:00:00.000Z". The store shows a calendar date with no
 * time, so it is placed at midnight UTC and the card formats it in UTC: the month a reader
 * sees is the month the store shows. Returns null for anything else (another language, a
 * relative date, a day that doesn't exist) — a review's date is never guessed.
 */
export function parseStoreDate(text: string): string | null {
  const match = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(text.trim())
  if (!match) return null

  const month = MONTHS.indexOf(match[1])
  const day = Number.parseInt(match[2], 10)
  const year = Number.parseInt(match[3], 10)
  if (month === -1) return null

  const date = new Date(Date.UTC(year, month, day))
  // Date.UTC rolls "Feb 31" over into March; a round trip catches it.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null
  return date.toISOString()
}

/** Shorter strings than this in the embedded data can't be a review the page cut short. */
const MIN_EMBEDDED_LEN = 100

/**
 * Every long string literal in the page's embedded data (`AF_initDataCallback({… data:[…]})`
 * scripts), decoded. Scanned by hand rather than with a regex or by parsing the payload:
 * this depends only on the data being double-quoted strings, not on where anything sits in
 * the store's nested arrays. A literal that isn't valid JSON is skipped.
 */
function embeddedStrings(html: string): string[] {
  const strings: string[] = []
  for (const chunk of html.split('<script').slice(1)) {
    const end = chunk.indexOf('</script>')
    const code = end === -1 ? chunk : chunk.slice(0, end)
    if (!code.includes('AF_initDataCallback')) continue

    let i = code.indexOf('"')
    while (i !== -1) {
      let j = i + 1
      while (j < code.length && code[j] !== '"') j += code[j] === '\\' ? 2 : 1
      if (j >= code.length) break
      if (j - i > MIN_EMBEDDED_LEN) {
        try {
          const value: unknown = JSON.parse(code.slice(i, j + 1))
          if (typeof value === 'string') strings.push(value)
        } catch {
          // Not a JSON string literal: not review text.
        }
      }
      i = code.indexOf('"', j + 1)
    }
  }
  return strings
}

/**
 * The complete text of a review the page cut short, or null. `visible` is the cut text as
 * rendered. The complete text is the one embedded string that starts with it; if none or
 * more than one does, the review is dropped — showing the store's cut version would not be
 * the review as written.
 */
function completeText(visible: string, embedded: string[]): string | null {
  const prefix = visible.replace(/\s*\.{3}\s*$/, '')
  if (prefix.length < MIN_EMBEDDED_LEN) return null
  const matches = new Set(embedded.filter((s) => s.length > prefix.length && s.startsWith(prefix)))
  return matches.size === 1 ? [...matches][0] : null
}

function firstMarker(text: string, markers: string[]): number {
  const found = markers.map((marker) => text.indexOf(marker)).filter((index) => index !== -1)
  return found.length ? Math.min(...found) : -1
}

/**
 * Reviews from the reviews page's HTML, chosen by the shared rules. A review is dropped,
 * never repaired, when any part of it can't be read with certainty: no star label, no
 * parseable date, no body before its developer reply, or a cut body whose complete text
 * can't be found. `reviewsUrl` is what each card links to: the store has no per-review page.
 */
export function parseChromeReviews(html: string, reviewsUrl: string): StoreReview[] {
  const candidates: ReviewCandidate[] = []
  let embedded: string[] | null = null

  for (const block of html.split(/<h3(?=[\s>])/).slice(1)) {
    const headingEnd = block.indexOf('</h3>')
    if (headingEnd === -1) continue
    const heading = block.slice(0, headingEnd)

    const scoreMatch = REVIEW_SCORE_RE.exec(heading)
    if (!scoreMatch) continue
    const spans = [...heading.matchAll(SPAN_TEXT_RE)]
    // The name comes before the stars and the date after them.
    const name = spans.find((span) => span.index < scoreMatch.index)?.[1]
    const date = spans
      .filter((span) => span.index > scoreMatch.index)
      .map((span) => parseStoreDate(decodeHtmlEntities(span[1])))
      .find((parsed) => parsed !== null)
    if (!date) continue

    // Only what precedes the developer's reply (or the end of the review's section) can be
    // the reviewer's words. With no such boundary the markup isn't what is described above.
    const rest = block.slice(headingEnd)
    const end = firstMarker(rest, REVIEW_END_MARKERS)
    if (end === -1) continue
    const body = REVIEW_BODY_RE.exec(rest.slice(0, end))
    if (!body) continue

    let quote: string | null = decodeHtmlEntities(body[1])
    if (!body[2]) {
      embedded ??= embeddedStrings(html)
      quote = completeText(quote, embedded)
      if (quote === null) continue
    }

    candidates.push({
      quote,
      author: name === undefined ? undefined : decodeHtmlEntities(name),
      date,
      score: Number.parseInt(scoreMatch[1], 10),
      url: reviewsUrl,
      store: 'chrome',
    })
  }

  return selectStoreReviews(candidates)
}

/** A page's HTML, or null when it can't be fetched. Never throws. */
async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA },
      next: { revalidate: STORE_STATS_REVALIDATE_SECONDS },
    })
    return res.ok ? await res.text() : null
  } catch {
    return null
  }
}

/**
 * Fetches the listing and its reviews page in parallel. Returns null if the listing is
 * unavailable or carries no rating — never fabricates numbers. The item defaults to the
 * public stable listing and can be overridden per environment.
 *
 * An unpublished or unavailable item still returns HTTP 200: the store rewrites its
 * URL slug to `empty-title` and serves a shell with no rating in it. The patterns
 * simply don't match and this returns null, which is the correct outcome.
 *
 * Reviews are optional, and scraping them is the fragile part: when the reviews page can't
 * be fetched or read, the rating stats are still returned, with `reviews: []`.
 */
export async function getChromeStoreStats(): Promise<StoreRatingStats | null> {
  const extensionId = process.env.CHROME_WEBSTORE_EXTENSION_ID || CHROME_EXTENSION_ID.STABLE
  const listingUrl = `${CWS_DETAIL}/${encodeURIComponent(extensionId)}`
  const reviewsUrl = `${listingUrl}/reviews`

  const [listingHtml, reviewsHtml] = await Promise.all([
    fetchPage(`${listingUrl}${ENGLISH}`),
    fetchPage(`${reviewsUrl}${ENGLISH}`),
  ])
  if (listingHtml === null) return null

  try {
    const stats = parseChromeRating(listingHtml)
    if (!stats) return null

    let reviews: StoreReview[] = []
    if (reviewsHtml !== null) {
      try {
        reviews = parseChromeReviews(reviewsHtml, reviewsUrl)
      } catch {
        reviews = []
      }
    }
    return { ...stats, reviews }
  } catch {
    return null
  }
}
