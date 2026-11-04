/**
 * Request helpers for the billing POST route tests. Those routes refuse a request that isn't
 * same-origin (rejectCrossOriginPost() in lib/billingRequestGuard.ts), so every test request carries
 * the header a browser sends on a same-origin `fetch`.
 */

/** The `Sec-Fetch-Site` header of a same-origin browser `fetch`. */
export const SAME_ORIGIN_HEADERS: Readonly<Record<string, string>> = { 'sec-fetch-site': 'same-origin' }
