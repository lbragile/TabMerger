import { NextRequest, NextResponse } from 'next/server'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from 'node:https'
import { gunzipSync, brotliDecompressSync, inflateSync } from 'node:zlib'
import type { LookupAddress } from 'node:dns'
import {
  MAX_BYTES,
  decodeHtmlEntities,
  extractHead,
  extractJsonLdImage,
  pickIcon,
  resolveCandidate,
  scanHeadTags,
  type ImageKind,
} from '@/lib/ogPreviewParse'

/**
 * POST /api/og-preview  { "url": "<url>" }
 *
 * The URL travels in the JSON body, never in a query string, so it never
 * lands in server access logs or proxy/browser history. There is no GET
 * variant — no installed client predates this API, so there's nothing to
 * stay backward compatible with.
 *
 * Fetches a third-party page server-side and extracts its og:image (or
 * twitter:image) and description meta tags, so the public share page can
 * show a live preview even when the extension never captured one at save
 * time, and so the extension's tab preview tooltip can get title/description
 * /image without needing an `<all_urls>` host permission.
 *
 * Privacy: this endpoint intentionally has NO cache — every call fetches
 * upstream fresh, and the requested URL is never persisted, logged, or
 * attached to any Sentry event (see `scrubEvent` in lib/sentry-scrubber.ts,
 * wired globally via `beforeSend`, which redacts `event.request.url` and
 * breadcrumb URLs for this route too). No cookies/auth are read or sent
 * upstream. Response is always `Cache-Control: no-store`.
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

const FETCH_TIMEOUT_MS = 4000
const MAX_REDIRECTS = 3

// Deliberately no cache here (URL-keyed or otherwise) — the privacy policy
// promises the requested address isn't stored, even transiently in memory.
// If load ever becomes a concern, revisit with a short-TTL cache keyed by a
// hash rather than the raw URL, not a plain re-add of this Map.

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
): Promise<{ body: string; contentType: string } | { redirectTo: string }> {
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
        // Some sites (e.g. vercel.com/docs) content-negotiate on Accept and
        // serve `text/markdown` — with no meta tags at all — to a request
        // that doesn't look like it wants HTML. This doesn't impersonate a
        // browser (the honest bot User-Agent above stays as-is); it just
        // asks for the format we can actually parse.
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
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

        // A missing content-type header is treated as "unknown, try anyway"
        // rather than rejected — some servers omit it and still return real
        // HTML. Only an explicitly non-HTML type short-circuits.
        const contentType = res.headers['content-type'] ?? ''
        if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
          res.resume()
          resolve({ body: '', contentType })
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
            resolve({ body: decoded.toString('utf-8'), contentType })
          } catch {
            resolve({ body: raw.toString('utf-8'), contentType })
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
async function fetchCapped(startUrl: string): Promise<{ body: string; finalUrl: string; contentType: string }> {
  let current = new URL(startUrl)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new Error('blocked protocol')
    }
    const addresses = await resolveAndValidate(current.hostname)
    if (!addresses) throw new Error('blocked host')

    const result = await fetchPinnedHop(current, addresses)
    if ('body' in result) return { body: result.body, finalUrl: current.toString(), contentType: result.contentType }

    current = new URL(result.redirectTo, current)
  }

  throw new Error('too many redirects')
}

// Public, unauthenticated, cookie-free endpoint — safe to allow any origin.
// The extension calls this cross-origin (chrome-extension://...) with no
// host_permissions to bypass CORS, so without this header every fetch()
// fails silently client-side and Tab Preview just shows nothing.
// `Cache-Control: no-store` on every response: nothing about this request
// (including which URL was asked about) should be cached anywhere.
function jsonResponse(body: unknown, init?: { status?: number }): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
  })
}


/**
 * Validates and fetches a single URL, returning the extracted preview fields.
 * No caching: every call hits upstream.
 *
 * Candidates are tried in priority order and resolved independently — the
 * whole point of `resolveCandidate` returning `null` instead of throwing is
 * that a broken/unusable candidate (relative-but-unparseable, `data:`, etc.)
 * falls through to the next source instead of aborting the whole chain:
 *   1. og:image / og:image:secure_url / og:image:url / twitter:image /
 *      twitter:image:src / link[rel=image_src] / vendor name= fallbacks
 *      (all folded into `scanned.ogImage` by `scanHeadTags`)
 *   2. schema.org itemprop="image" (meta content= or link href=)
 *   3. JSON-LD `image`/`thumbnailUrl` (string, array, ImageObject, @graph)
 *   4. LAST RESORT: the largest apple-touch-icon/icon `<link>` >= 128px —
 *      returned with `imageKind: 'icon'` so the caller can render it
 *      contained/centered instead of cropped as a banner.
 */
async function fetchPreview(raw: string | null): Promise<
  | { ok: true; ogImage: string | null; description: string | null; imageKind: ImageKind }
  | { ok: false }
> {
  if (!raw) return { ok: false }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false }
  if (!(await resolveAndValidate(parsed.hostname))) return { ok: false }

  const target = parsed.toString()
  let ogImage: string | null = null
  let imageKind: ImageKind = 'preview'
  let description: string | null = null
  try {
    const { body: html, finalUrl, contentType } = await fetchCapped(target)
    // Non-HTML responses (e.g. vercel.com/docs serving text/markdown to a
    // bot-flavored Accept header) have no meta tags — bail out before
    // regex-ing content that was never going to match.
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return { ok: true, ogImage: null, description: null, imageKind: 'preview' }
    }
    const head = extractHead(html)
    const scanned = scanHeadTags(head)
    description = scanned.description ? decodeHtmlEntities(scanned.description) : null

    ogImage = resolveCandidate(scanned.ogImage, finalUrl)
    if (!ogImage) ogImage = resolveCandidate(scanned.itempropImage, finalUrl)
    if (!ogImage) ogImage = resolveCandidate(extractJsonLdImage(head), finalUrl)
    if (!ogImage) {
      const icon = resolveCandidate(pickIcon(scanned.iconCandidates), finalUrl)
      if (icon) {
        ogImage = icon
        imageKind = 'icon'
      }
    }
  } catch {
    ogImage = null // never leak fetch/parse error details to the client
    description = null
  }

  return { ok: true, ogImage, description, imageKind }
}

export async function POST(req: NextRequest) {
  let raw: unknown
  try {
    const body = await req.json()
    raw = (body as { url?: unknown } | null)?.url
  } catch {
    return jsonResponse({ ogImage: null, description: null }, { status: 400 })
  }
  if (typeof raw !== 'string') {
    return jsonResponse({ ogImage: null, description: null }, { status: 400 })
  }

  const result = await fetchPreview(raw)
  if (!result.ok) return jsonResponse({ ogImage: null, description: null }, { status: 400 })
  // `imageKind` is additive and defaults to 'preview' — existing extension
  // builds that only read `ogImage`/`description` keep working unchanged.
  return jsonResponse({ ogImage: result.ogImage, description: result.description, imageKind: result.imageKind })
}
