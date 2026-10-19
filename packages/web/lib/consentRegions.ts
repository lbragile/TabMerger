/**
 * Where analytics need consent first ("opt-in") and where they may run until the visitor opts out
 * ("opt-out"). A practical split, not legal advice: the EEA, the UK, Switzerland and Quebec ask
 * first; everywhere else analytics are on by default with a Reject in "Cookie settings".
 *
 * The proxy works out the visitor's region from Vercel's geo-IP headers and hands it to the
 * browser in the `tm_consent_region` cookie (strictly necessary: it only decides whether to ask).
 * Anything missing, malformed or unknown is opt-in, the safe side (localhost has no geo headers).
 */

export const CONSENT_REGION_COOKIE = 'tm_consent_region'

/** A day: re-checked daily, so a visitor who travels gets the right default soon enough. */
export const CONSENT_REGION_MAX_AGE_SECONDS = 24 * 60 * 60

export const CONSENT_REGIONS = ['optin', 'optout'] as const
export type ConsentRegion = (typeof CONSENT_REGIONS)[number]

/** EU member states (ISO 3166-1 alpha-2; Greece is `GR`, not the EU's own `EL`). */
const EU_COUNTRIES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
] as const

/**
 * Countries (ISO codes) where analytics ask first: the EU, the rest of the EEA (Norway, Iceland,
 * Liechtenstein), the UK and Switzerland. Also the EU's outermost regions and Åland, which have
 * their own ISO codes but are EU territory, and the Crown Dependencies and Gibraltar, which have
 * UK-style data-protection laws of their own: asking there costs nothing.
 */
export const OPT_IN_COUNTRIES: ReadonlySet<string> = new Set<string>([
  ...EU_COUNTRIES,
  'NO', 'IS', 'LI',
  'GB', 'CH',
  'AX', 'GF', 'GP', 'MQ', 'RE', 'YT', 'MF',
  'GG', 'JE', 'IM', 'GI',
])

/** Subdivisions (`<country>-<region>`) that ask first in an otherwise opt-out country: Quebec (Law 25). */
export const OPT_IN_SUBDIVISIONS: ReadonlySet<string> = new Set(['CA-QC'])

/** Two uppercase letters, as Vercel's `x-vercel-ip-country` sends them. */
const COUNTRY_CODE = /^[A-Z]{2}$/
/** The ISO 3166-2 subdivision code without its country prefix, as `x-vercel-ip-country-region` sends it. */
const REGION_CODE = /^[A-Z0-9]{1,3}$/
/** Well-formed codes that geo-IP databases use for "we don't know" (or for a whole continent). */
const UNKNOWN_COUNTRIES: ReadonlySet<string> = new Set(['XX', 'ZZ', 'EU', 'AP'])

/**
 * The consent region for a visitor's geo-IP country and subdivision. An unknown or malformed
 * country is opt-in; a malformed subdivision is ignored (the country decides).
 */
export function consentRegionFor(country: string | null | undefined, region?: string | null): ConsentRegion {
  if (typeof country !== 'string' || !COUNTRY_CODE.test(country) || UNKNOWN_COUNTRIES.has(country)) return 'optin'
  if (OPT_IN_COUNTRIES.has(country)) return 'optin'
  if (typeof region === 'string' && REGION_CODE.test(region) && OPT_IN_SUBDIVISIONS.has(`${country}-${region}`)) {
    return 'optin'
  }
  return 'optout'
}

/** The region a raw cookie value stands for, or `null` for anything that isn't exactly one. */
export function parseConsentRegion(value: unknown): ConsentRegion | null {
  return value === 'optin' || value === 'optout' ? value : null
}

/**
 * A `CONSENT_REGION_OVERRIDE`-style value (`US`, `DE`, `CA-QC`) split into country and region,
 * or `null` when it isn't one. Lets the opt-out path be tried locally, where there's no geo-IP.
 */
export function parseRegionOverride(value: string | undefined): { country: string; region: string | null } | null {
  if (!value) return null
  const match = /^([A-Z]{2})(?:-([A-Z0-9]{1,3}))?$/.exec(value.trim())
  return match ? { country: match[1], region: match[2] ?? null } : null
}
