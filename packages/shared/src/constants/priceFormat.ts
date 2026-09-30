/**
 * How prices are written everywhere TabMerger shows one (web app and extension). Every price is
 * US dollars (the Stripe Prices are USD-only), so the only choice is how to say so.
 */

/**
 * A price marked as US dollars, always with cents (e.g. US$3.58): a bare "$" reads as local
 * dollars in Canada, Australia and elsewhere. For a price shown on its own (web account page and
 * dashboard, the extension's Settings); matches how the Billing Portal shows it.
 */
export function formatUsd(amount: number): string {
  return `US$${amount.toFixed(2)}`;
}

/**
 * A price in a plan listing, always with cents (e.g. $3.58). Only for listings that also show
 * {@link PRICES_IN_USD_NOTE}, which says the currency once instead of on every price.
 */
export function formatListPrice(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** Footnote under every plan listing (the web pricing page and the landing page's teaser). */
export const PRICES_IN_USD_NOTE = 'All prices are in US dollars (USD).';
