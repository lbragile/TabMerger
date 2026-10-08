/**
 * The stores the extension is listed on, and what to call them. Plain values with no
 * dependencies, so client components can import them too (`lib/storeReviews.ts` cannot be:
 * it builds a profanity matcher at module load).
 */

export type StoreId = 'chrome' | 'firefox' | 'edge'

/** The order stores appear in wherever they are listed together. */
export const STORE_IDS: readonly StoreId[] = ['chrome', 'firefox', 'edge']

/** The store's own name: "4.6 on the Chrome Web Store", a review card's source line. */
export const STORE_LABEL: Record<StoreId, string> = {
  chrome: 'Chrome Web Store',
  firefox: 'Firefox Add-ons',
  edge: 'Microsoft Edge Add-ons',
}

/** The browser's short name, for a list of several stores: "Chrome, Firefox and Edge". */
export const STORE_BROWSER: Record<StoreId, string> = {
  chrome: 'Chrome',
  firefox: 'Firefox',
  edge: 'Edge',
}

/** "Chrome", "Chrome and Firefox", "Chrome, Firefox and Edge". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
