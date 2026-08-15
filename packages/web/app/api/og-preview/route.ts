import { NextRequest, NextResponse } from 'next/server'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from 'node:https'
import { gunzipSync, brotliDecompressSync, inflateSync } from 'node:zlib'
import type { LookupAddress } from 'node:dns'

/**
 * GET /api/og-preview?url=<encoded url>
 *
 * Fetches a third-party page server-side and extracts its og:image (or
 * twitter:image) and description meta tags, so the public share page can
 * show a live preview even when the extension never captured one at save
 * time, and so the extension's tab preview tooltip can get title/description
 * /image without needing an `<all_urls>` host permission.
 *
 * This is a real SSRF surface — it's unauthenticated and fetches
 * user-supplied URLs — so every private/loopback/link-local destination is
 * blocked, response size and time are capped, and only the extracted image
 * URL is ever echoed back (never raw HTML or fetch error details).
 *
 * Two things global `fetch` can't give us, which is why this uses
 * node:http(s) directly instead:
 *  1. DNS-rebinding / TOCTOU: validating a hostname then letting `fetch`
 *     re-resolve it internally leaves a window where the DNS answer can
 *     change between the check and the actual connection. Every request
 *     here resolves the hostname itself and pins the TCP connection to
 *     that exact validated IP via a custom `lookup` (with `servername`
 *     still set to the real hostname so TLS/SNI and cert validation are
 *     unaffected).
 *  2. Redirect-based bypass: `redirect: 'follow'` would let a validated
 *     URL 30x to an internal address without ever being re-checked.
 *     Redirects are followed manually here, capped at 3 hops, with full
 *     protocol + DNS-pinning validation re-run on every hop.
 */

const MAX_BYTES = 2 * 1024 * 1024 // 2MB
const FETCH_TIMEOUT_MS = 4000
const CACHE_TTL_MS = 60 * 60 * 1000 // 1h
const MAX_REDIRECTS = 3

// ponytail: module-level Map cache with lazy expiry check on read — no LRU
// eviction infra, add if this route ever sees enough unique URLs to matter.
const cache = new Map<
  string,
  { ogImage: string | null; description: string | null; expires: number }
>()

const MAX_DESCRIPTION_LENGTH = 500

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local')) return true

  const version = isIP(h)
  if (version === 4) {
    const [a, b] = h.split('.').map(Number)
    if (a === 127) return true // loopback
    if (a === 10) return true // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
    if (a === 192 && b === 168) return true // 192.168.0.0/16
    if (a === 169 && b === 254) return true // 169.254.0.0/16 (incl. cloud metadata)
    if (a === 0) return true
    return false
  }
  if (version === 6) {
    return h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')
  }
  return false
}

/**
 * Resolves a hostname to every address it currently answers with and rejects
 * if ANY of them is private — a host that round-robins between a public and
 * an internal IP must not sneak through on whichever one `lookup()` picks
 * first. Returns the validated address list so the caller can pin the actual
 * TCP connection to one of them instead of letting the HTTP client re-resolve
 * (and potentially get a different, unvalidated answer) at connect time.
 */
async function resolveAndValidate(hostname: string): Promise<LookupAddress[] | null> {
  if (isPrivateHost(hostname)) return null
  let addresses: LookupAddress[]
  try {
    addresses = await lookup(hostname, { all: true, family: 0 })
  } catch {
    return null // unresolvable → treat as unsafe, don't let it through
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateHost(a.address))) return null
  return addresses
}

function extractOgImage(html: string): string | null {
  const headMatch = html.match(/<head[\s\S]*?<\/head>/i)
  const head = headMatch ? headMatch[0] : html.slice(0, 50_000)

  const ogMatch =
    head.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
  if (ogMatch) return ogMatch[1]

  const twitterMatch =
    head.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ??
    head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i)
  return twitterMatch ? twitterMatch[1] : null
}

/**
 * Extracts the page description: prefer `og:description`, fall back to the
 * standard `name="description"` meta tag. Result is plain text (not echoed
 * as a URL like ogImage), so the only hardening needed is a length cap —
 * a malicious page can't set a 1MB meta tag and bloat the cache/response.
 */
function extractDescription(html: string): string | null {
  const headMatch = html.match(/<head[\s\S]*?<\/head>/i)
  const head = headMatch ? headMatch[0] : html.slice(0, 50_000)

  const ogMatch =
    head.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ??
    head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)
  const value =
    ogMatch?.[1] ??
    (head.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
      head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i))?.[1] ??
    null

  return value ? value.slice(0, MAX_DESCRIPTION_LENGTH) : null
}

/**
 * Fetches a single hop with the TCP connection pinned to `addresses` (already
 * DNS-validated by the caller) via a custom `lookup` — the HTTP client never
 * gets to re-resolve the hostname itself, so nothing can change between
 * validation and connection. Returns either the body text (2xx) or a
 * redirect target (3xx with Location), never both.
 */
function fetchPinnedHop(
  parsed: URL,
  addresses: LookupAddress[]
): Promise<{ body: string } | { redirectTo: string }> {
  const requestFn = parsed.protocol === 'https:' ? httpsRequest : httpRequest

  // @types/node's RequestOptions doesn't declare `autoSelectFamily`, but Node
  // forwards http(s).request options straight through to net.connect() at
  // runtime, where it is honored — this widens the type to match actual
  // runtime behavior instead of suppressing the check.
  type RequestOptionsWithFamily = HttpsRequestOptions & { autoSelectFamily?: boolean }

  return new Promise((resolve, reject) => {
    const options: RequestOptionsWithFamily = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
      path: `${parsed.pathname}${parsed.search}`,
      servername: parsed.protocol === 'https:' ? parsed.hostname : undefined,
      headers: {
        'User-Agent': 'TabMergerBot/1.0 (+https://tabmerger.com)',
        'Accept-Encoding': 'gzip, deflate, br',
        Host: parsed.host,
      },
      timeout: FETCH_TIMEOUT_MS,
      // Node 20+'s Happy Eyeballs (autoSelectFamily, on by default) races multiple
      // resolved addresses and calls a custom `lookup` with `options.all: true`,
      // expecting an array-style `(err, addresses[])` callback instead of the
      // classic `(err, address, family)` one — mismatching that throws
      // ERR_INVALID_IP_ADDRESS internally and silently kills every request. We
      // already resolved + validated the address ourselves, so there's nothing
      // for Happy Eyeballs to race; disable it and keep the simple single-address
      // lookup signature.
      autoSelectFamily: false,
      // Pins the connection to the pre-validated address(es) instead of
      // letting Node re-resolve the hostname at connect time.
      lookup: (_hostname, _options, callback) => {
        const preferred = addresses.find((a) => a.family === 4) ?? addresses[0]
        callback(null, preferred.address, preferred.family)
      },
    }

    const req = requestFn(
      options,
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume() // discard body
          resolve({ redirectTo: res.headers.location })
          return
        }
        if (status < 200 || status >= 300) {
          res.resume()
          reject(new Error(`fetch failed: ${status}`))
          return
        }

        const encoding = res.headers['content-encoding']
        const chunks: Buffer[] = []
        let total = 0
        const finish = () => {
          const raw = Buffer.concat(chunks)
          // We only asked for gzip/deflate/br (never `identity`), so decode
          // whatever the server actually used — plain `fetch` does this
          // automatically, but node:http(s) does not, and treating compressed
          // bytes as UTF-8 text silently produces garbage (extractOgImage's
          // regex never matches, so ogImage always came back null).
          try {
            const decoded =
              encoding === 'gzip' ? gunzipSync(raw)
              : encoding === 'br' ? brotliDecompressSync(raw)
              : encoding === 'deflate' ? inflateSync(raw)
              : raw
            resolve({ body: decoded.toString('utf-8') })
          } catch {
            resolve({ body: raw.toString('utf-8') })
          }
        }
        res.on('data', (chunk: Buffer) => {
          total += chunk.byteLength
          if (total > MAX_BYTES) {
            res.destroy()
            finish()
            return
          }
          chunks.push(chunk)
        })
        res.on('end', finish)
        res.on('error', reject)
      }
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
}

/**
 * Fetches `startUrl`, following redirects manually (capped at
 * MAX_REDIRECTS) with full protocol + DNS-pinning validation re-run on every
 * hop — a redirect target is just as untrusted as the original input.
 */
async function fetchCapped(startUrl: string): Promise<string> {
  let current = new URL(startUrl)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new Error('blocked protocol')
    }
    const addresses = await resolveAndValidate(current.hostname)
    if (!addresses) throw new Error('blocked host')

    const result = await fetchPinnedHop(current, addresses)
    if ('body' in result) return result.body

    current = new URL(result.redirectTo, current)
  }

  throw new Error('too many redirects')
}

// Public, unauthenticated, cookie-free endpoint — safe to allow any origin.
// The extension calls this cross-origin (chrome-extension://...) with no
// host_permissions to bypass CORS, so without this header every fetch()
// fails silently client-side and Tab Preview just shows nothing.
function jsonResponse(body: unknown, init?: { status?: number }): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: { 'Access-Control-Allow-Origin': '*' },
  })
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url')
  if (!raw) return jsonResponse({ ogImage: null, description: null }, { status: 400 })

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return jsonResponse({ ogImage: null, description: null }, { status: 400 })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return jsonResponse({ ogImage: null, description: null }, { status: 400 })
  }
  if (!(await resolveAndValidate(parsed.hostname))) {
    return jsonResponse({ ogImage: null, description: null }, { status: 400 })
  }

  const cacheKey = parsed.toString()
  const cached = cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return jsonResponse({ ogImage: cached.ogImage, description: cached.description })
  }

  let ogImage: string | null = null
  let description: string | null = null
  try {
    const html = await fetchCapped(cacheKey)
    ogImage = extractOgImage(html)
    description = extractDescription(html)
    // Only accept absolute http(s) image URLs — never echo relative paths
    // or javascript: schemes back to the client.
    if (ogImage) {
      try {
        const imgUrl = new URL(ogImage, cacheKey)
        ogImage = imgUrl.protocol === 'http:' || imgUrl.protocol === 'https:' ? imgUrl.toString() : null
      } catch {
        ogImage = null
      }
    }
  } catch {
    ogImage = null // never leak fetch/parse error details to the client
    description = null
  }

  cache.set(cacheKey, { ogImage, description, expires: Date.now() + CACHE_TTL_MS })
  return jsonResponse({ ogImage, description })
}
