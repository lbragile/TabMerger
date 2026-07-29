// Server-only: fetches public Chrome Web Store listing HTML and parses rating stats.
// No official REST API exists for this, so we scrape the public listing page.
// ponytail: regex against known listing markup instead of pulling in an HTML parser dep.

export interface ChromeStoreStats {
  rating: number
  ratingCount: number
}

/**
 * Fetches and parses rating stats from the public Chrome Web Store listing page.
 * Returns null if no extension ID is configured, or if the fetch/parse fails —
 * never fabricates numbers.
 */
export async function getChromeStoreStats(): Promise<ChromeStoreStats | null> {
  const extensionId = process.env.CHROME_WEBSTORE_EXTENSION_ID
  if (!extensionId) return null

  try {
    const res = await fetch(`https://chromewebstore.google.com/detail/${extensionId}`, {
      next: { revalidate: 21600 }, // 6 hours — store ratings don't change fast
    })
    if (!res.ok) return null

    const html = await res.text()

    // Listing page embeds an aria-label like: aria-label="4.8 out of 5 stars. 2,400 ratings."
    const match = html.match(/([\d.]+)\s+out of 5 stars\.\s*([\d,]+)\s+ratings?/i)
    if (!match) return null

    const rating = Number.parseFloat(match[1])
    const ratingCount = Number.parseInt(match[2].replace(/,/g, ''), 10)
    if (Number.isNaN(rating) || Number.isNaN(ratingCount)) return null

    return { rating, ratingCount }
  } catch {
    return null
  }
}
