import { isIP } from 'node:net'
import { deployPlatform, type DeployPlatform } from '@/lib/deployment'

/**
 * The client's address for per-IP rate limits, read only from the header the hosting platform
 * itself sets ({@link deployPlatform}), never "whichever header exists":
 *
 * - `cloudflare`: `cf-connecting-ip` only. Cloudflare's edge sets it from the connection.
 *   `x-forwarded-for` / `x-real-ip` and Vercel's headers are ignored there, since nothing on the
 *   way strips a client-sent copy.
 * - `vercel`: `x-vercel-forwarded-for`, then `x-real-ip`, then `x-forwarded-for`. Vercel
 *   overwrites these with the client address and doesn't forward one a client sent;
 *   `x-vercel-forwarded-for` comes first because a proxy in front of Vercel could change
 *   `x-forwarded-for`. `cf-connecting-ip` is ignored there.
 * - no platform (local development, CI, tests): null. Every header is whatever the client typed.
 *
 * The first address of a list, trimmed; null when the header is missing or empty. Not validated:
 * see {@link ipRateLimitKey}.
 */
export function trustedClientAddress(headers: Headers, platform: DeployPlatform | null = deployPlatform()): string | null {
  let raw: string | null
  if (platform === 'cloudflare') raw = headers.get('cf-connecting-ip')
  else if (platform === 'vercel') raw = headers.get('x-vercel-forwarded-for') ?? headers.get('x-real-ip') ?? headers.get('x-forwarded-for')
  else return null
  // The platform sends one address; read a list defensively and keep the first hop.
  return raw?.split(',')[0]?.trim() || null
}

/** The 8 groups of an IPv6 address (already validated by `isIP`), or null. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase()
  // An embedded IPv4 tail (::ffff:192.0.2.1) becomes its two groups.
  const lastColon = text.lastIndexOf(':')
  const tail = text.slice(lastColon + 1)
  if (tail.includes('.')) {
    const o = tail.split('.').map(Number)
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
    text = `${text.slice(0, lastColon + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null
  const groups = rest === null ? head : [...head, ...Array<string>(8 - head.length - rest.length).fill('0'), ...rest]
  if (groups.length !== 8) return null
  const values = groups.map((g) => Number.parseInt(g, 16))
  return values.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffff) ? values : null
}

/**
 * The rate-limit key for an address: `4:<address>` for IPv4 (and IPv4-mapped IPv6), `6:<first
 * four groups>::/64` for IPv6. One IPv6 host usually holds a whole /64, so a key per address
 * would let it rotate addresses past the limit (and add a counter row per address). Null for
 * anything that is not an IP address.
 */
export function ipRateLimitKey(raw: string): string | null {
  let address = raw.trim()
  if (address.startsWith('[') && address.endsWith(']')) address = address.slice(1, -1)
  const zone = address.indexOf('%')
  if (zone !== -1) address = address.slice(0, zone)

  const family = isIP(address)
  if (family === 4) return `4:${address}`
  if (family !== 6) return null

  const groups = ipv6Groups(address)
  if (!groups) return null
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff
  if (mapped) return `4:${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`
  return `6:${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`
}

