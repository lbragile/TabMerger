import { useFormatter } from 'next-intl'

/**
 * A price in a plan listing, in the active locale: always with cents and the bare currency
 * symbol ("$3.58" in English, the same as `formatListPrice` in `@tabmerger/shared`). Only for
 * listings that also show the "All prices are in US dollars" note. Every price is USD.
 */
export function useListPrice(): (amount: number) => string {
  const format = useFormatter()
  return (amount) => format.number(amount, LIST_PRICE_FORMAT)
}

/** The number format of a list price (USD, always with cents), for a formatter outside the hook. */
export const LIST_PRICE_FORMAT = {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const satisfies Intl.NumberFormatOptions

/** The free plan's "$0": the same symbol, no cents. */
export function useZeroPrice(): string {
  const format = useFormatter()
  return format.number(0, { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
