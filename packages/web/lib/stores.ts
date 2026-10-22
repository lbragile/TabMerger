import type { useTranslations } from 'next-intl'

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

/** The `common.list*` messages `listNames` joins with (any translator for the `common` namespace). */
export type ListTranslator = ReturnType<typeof useTranslations<'common'>>

/** First-strong isolate (U+2068) and its end (U+2069): invisible, and neutral to the text around them. */
const FSI = '\u2068'
const PDI = '\u2069'

/**
 * "Chrome", "Chrome and Firefox", "Chrome, Firefox and Edge" (no serial comma, in English), with
 * the separator and conjunction from the catalog so each language joins its own way.
 *
 * Each name is wrapped in a first-strong isolate. In a right-to-left sentence a comma between
 * two Latin names would otherwise join them into one left-to-right run ("Chrome, Firefox"), so
 * Hebrew showed Firefox first; isolated, each name keeps its own direction and the separators
 * and conjunction follow the sentence. The marks change nothing on screen in a left-to-right
 * language, but they are in the string: tests compare with them stripped.
 */
export function listNames(rawNames: string[], t: ListTranslator): string {
  const names = rawNames.map((name) => FSI + name + PDI)
  if (names.length <= 1) return names.join('')
  if (names.length === 2) return t('listTwo', { first: names[0], second: names[1] })
  return t('listMany', { rest: names.slice(0, -1).join(t('listSeparator')), last: names[names.length - 1] })
}
