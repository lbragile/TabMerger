// Server-only: fetches public Chrome Web Store listing HTML and parses rating stats.
// No official REST API exists for this, so we scrape the public listing page.
// ponytail: regex against known listing markup instead of pulling in an HTML parser dep.

export interface ChromeStoreStats {
  rating: number
  ratingCount: number
}

/**
 * The store serves a JavaScript shell with no product data to clients that don't
 * look like a browser — including Node's default fetch. Without this header the
 * response never contains a rating, so this function always returned null.
 */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'

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

/**
 * Fetches and parses rating stats from the public Chrome Web Store listing page.
 * Returns null if no extension ID is configured, if the listing is unavailable, or
 * if the fetch/parse fails — never fabricates numbers.
 *
 * An unpublished or unavailable item still returns HTTP 200: the store rewrites its
 * URL slug to `empty-title` and serves a shell with no rating in it. The patterns
 * simply don't match and this returns null, which is the correct outcome.
 */
export async function getChromeStoreStats(): Promise<ChromeStoreStats | null> {
  const extensionId = process.env.CHROME_WEBSTORE_EXTENSION_ID
  if (!extensionId) return null

  try {
    const res = await fetch(`https://chromewebstore.google.com/detail/${extensionId}`, {
      headers: { 'User-Agent': BROWSER_UA },
      next: { revalidate: 21600 }, // 6 hours — store ratings don't change fast
    })
    if (!res.ok) return null

    const html = await res.text()
    const ratingMatch = html.match(RATING_RE)
    const countMatch = html.match(COUNT_RE)
    if (!ratingMatch || !countMatch) return null

    const rating = Number.parseFloat(ratingMatch[1])
    const ratingCount = parseAbbreviated(countMatch[1], countMatch[2])
    if (Number.isNaN(rating) || Number.isNaN(ratingCount) || ratingCount === 0) return null

    return { rating, ratingCount }
  } catch {
    return null
  }
}
