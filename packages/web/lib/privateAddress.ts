import { isIP } from 'node:net'

/**
 * Whether a host or IP address points at local, private or otherwise non-public space, so a
 * server-side fetch of a user-supplied URL must not connect to it. Used by /api/og-preview for
 * the URL's hostname, every address it resolves to, and every redirect hop.
 *
 * IPv4 blocked: 0.0.0.0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24,
 * 192.168/16, 198.18/15, 224/4 (multicast) and 240/4 (reserved, incl. broadcast).
 *
 * IPv6 blocked: ::, ::1, ::/96 (IPv4-compatible), ::ffff:0:0/96 (IPv4-mapped, dotted or hex),
 * 64:ff9b::/96 (NAT64) and 2002::/16 (6to4) when the embedded IPv4 is blocked, 64:ff9b:1::/48,
 * 100::/64 (discard), 2001::/32 (Teredo), 2001:db8::/32 (documentation), fc00::/7 (unique local),
 * fe80::/10 (link local), fec0::/10 (site local) and ff00::/8 (multicast).
 *
 * Names: localhost, *.localhost, *.local and *.internal.
 */

type Ipv4 = readonly [number, number, number, number]

/** Whether a dotted-quad IPv4 address is in a blocked range. */
export function isPrivateIPv4(octets: Ipv4): boolean {
  const [a, b, c] = octets
  return (
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

/** The eight 16-bit groups of a valid IPv6 address (brackets and zone id already removed). */
function expandIPv6(address: string): number[] {
  let text = address
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text)
  if (dotted) {
    const [, a, b, c, d] = dotted.map(Number)
    text = text.slice(0, dotted.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16)
  }
  const [head, tail] = text.split('::')
  const headGroups = head ? head.split(':') : []
  const tailGroups = tail === undefined ? [] : tail ? tail.split(':') : []
  const fill = tail === undefined ? [] : Array<string>(8 - headGroups.length - tailGroups.length).fill('0')
  return [...headGroups, ...fill, ...tailGroups].map((g) => parseInt(g, 16))
}

function embeddedIPv4(high: number, low: number): Ipv4 {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff]
}

function isPrivateIPv6(g: number[]): boolean {
  const lowFiveZero = g.slice(0, 5).every((x) => x === 0)
  if (lowFiveZero && g[5] === 0xffff) return isPrivateIPv4(embeddedIPv4(g[6], g[7])) // ::ffff:0:0/96
  if (lowFiveZero && g[5] === 0) return true // ::/96, includes :: and ::1
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    if (g.slice(2, 6).every((x) => x === 0)) return isPrivateIPv4(embeddedIPv4(g[6], g[7])) // 64:ff9b::/96
    if (g[2] === 1) return true // 64:ff9b:1::/48, local-use NAT64
  }
  if (g[0] === 0x2002) return isPrivateIPv4(embeddedIPv4(g[1], g[2])) // 6to4
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true // 100::/64
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true // Teredo, documentation
  return (
    (g[0] & 0xfe00) === 0xfc00 || // fc00::/7
    (g[0] & 0xffc0) === 0xfe80 || // fe80::/10
    (g[0] & 0xffc0) === 0xfec0 || // fec0::/10
    (g[0] & 0xff00) === 0xff00 // ff00::/8
  )
}

/** Whether `hostname` (a name, an IPv4/IPv6 literal, bracketed or not) is local or private. */
export function isPrivateHost(hostname: string): boolean {
  let h = hostname.trim().toLowerCase()
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  const zone = h.indexOf('%')
  if (zone !== -1) h = h.slice(0, zone)
  if (h.endsWith('.')) h = h.slice(0, -1)
  if (h === '') return true

  const version = isIP(h)
  if (version === 4) return isPrivateIPv4(h.split('.').map(Number) as unknown as Ipv4)
  if (version === 6) return isPrivateIPv6(expandIPv6(h))
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')
}
