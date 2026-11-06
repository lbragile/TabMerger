/**
 * Where analytics need consent first ("opt-in") and where they may run until the visitor opts out
 * ("opt-out"). A practical split, not legal advice: the EEA, the UK, Switzerland and Quebec ask
 * first; everywhere else analytics are on by default with a Reject in "Cookie settings".
 *
 * The proxy works out the visitor's region from the hosting platform's geo-IP headers
 * ({@link geoFromHeaders}) and hands it to the browser in the `tm_consent_region` cookie (strictly necessary: it only decides whether to ask).
 * Anything missing, malformed or unknown is opt-in, the safe side (localhost has no geo headers).
 */

import type { DeployPlatform } from '@/lib/deployment'

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

/** Two uppercase letters, as `x-vercel-ip-country` and `cf-ipcountry` send them. */
const COUNTRY_CODE = /^[A-Z]{2}$/
/**
 * The ISO 3166-2 subdivision code without its country prefix (`QC`, not `CA-QC`), as
 * `x-vercel-ip-country-region` and `cf-region-code` send it.
 */
const REGION_CODE = /^[A-Z0-9]{1,3}$/
/**
 * Codes that geo-IP databases use for "we don't know" (or for a whole continent): `XX` is also
 * Cloudflare's "no country data", and Cloudflare's `T1` (Tor exit nodes) says nothing about where
 * the visitor is. `T1` already fails {@link COUNTRY_CODE}; it is listed so that stays true if the
 * pattern ever loosens.
 */
const UNKNOWN_COUNTRIES: ReadonlySet<string> = new Set(['XX', 'ZZ', 'EU', 'AP', 'T1'])

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

/** The geo-IP header pair (country, subdivision) each platform sets on incoming requests. */
export const GEO_HEADERS: Readonly<Record<DeployPlatform, { country: string; region: string }>> = {
  vercel: { country: 'x-vercel-ip-country', region: 'x-vercel-ip-country-region' },
  // `cf-region-code` needs the zone's "Add visitor location headers" Managed Transform; without
  // it the country alone decides, and Quebec falls back to Canada's opt-out.
  cloudflare: { country: 'cf-ipcountry', region: 'cf-region-code' },
}

/**
 * The visitor's geo-IP country and subdivision from the request headers, for
 * {@link consentRegionFor}:
 *
 * - On a known platform, only that platform's headers ({@link GEO_HEADERS}).
 * - Off one (local development, CI), Vercel's pair, else Cloudflare's, taken as a pair (never a
 *   country from one and a subdivision from the other). The e2e tests send Vercel's names.
 *
 * Either way the values only choose a default for this visitor's own banner, which they can
 * change in "Cookie settings".
 */
export function geoFromHeaders(
  headers: Headers,
  platform: DeployPlatform | null
): { country: string | null; region: string | null } {
  const read = (names: { country: string; region: string }) => {
    const country = headers.get(names.country)
    const region = headers.get(names.region)
    // Both platforms document the bare subdivision (`QC`); a full ISO 3166-2 code (`CA-QC`) for
    // the same country is accepted too.
    const prefix = `${country}-`
    return { country, region: country && region?.startsWith(prefix) ? region.slice(prefix.length) : region }
  }
  if (platform) return read(GEO_HEADERS[platform])
  const vercel = read(GEO_HEADERS.vercel)
  return vercel.country ? vercel : read(GEO_HEADERS.cloudflare)
}
