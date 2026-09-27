import { NextRequest, NextResponse } from 'next/server'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from 'node:https'
import { gunzipSync, brotliDecompressSync, inflateSync } from 'node:zlib'
import type { LookupAddress } from 'node:dns'

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

const MAX_BYTES = 2 * 1024 * 1024 // 2MB
const FETCH_TIMEOUT_MS = 4000
const MAX_REDIRECTS = 3

// Deliberately no cache here (URL-keyed or otherwise) — the privacy policy
// promises the requested address isn't stored, even transiently in memory.
// If load ever becomes a concern, revisit with a short-TTL cache keyed by a
// hash rather than the raw URL, not a plain re-add of this Map.

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

/**
 * Meta `content` values are HTML-attribute text, so `&` in an image URL arrives as `&amp;`
 * (Wikipedia's og:image does this) and descriptions carry `&quot;`, `&#39;` and friends.
 * Decode the common named entities and numeric references before using the value — an
 * undecoded `&amp;` turns `?a=1&amp;b=2` into a different, often broken, image URL.
 */
function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return named[entity.toLowerCase()] ?? match
  })
}

/**
 * Extracts the head region to scan for meta tags. Prefers the real
 * `<head>...</head>` slice; falls back to up to `MAX_BYTES` of the raw HTML
 * when there's no closing tag (a page's head can be truncated by our own
 * MAX_BYTES cap, or split oddly) — scanning only 50k in that case could miss
 * meta tags that a real browser would still see.
 */
function extractHead(html: string): string {
  const headMatch = html.match(/<head[\s\S]*?<\/head>/i)
  return headMatch ? headMatch[0] : html.slice(0, MAX_BYTES)
}

// Caps how much of a single tag's raw attribute text the attribute-value
// regex is allowed to see. Without this, a hostile head can pack tens of
// thousands of `property="og:image"` occurrences into one giant, unclosed
// `<meta ...` run — every occurrence would then make an unbounded `[^>]+`
// backtrack across the rest of the document, roughly O(n × occurrences)
// (~10^11 steps at MAX_BYTES). Bounding the tag body to a fixed length makes
// a malformed/absurd tag simply get skipped, never backtracked over.
const MAX_TAG_LENGTH = 2048

// Matches one `<meta ...>` or `<link ...>` tag at a time, linearly over the
// head region — `[^>]{0,MAX_TAG_LENGTH}` never backtracks past its own cap,
// so total cost is O(head length) regardless of how many tags (malformed or
// not) are present.
const TAG_RE = new RegExp(`<(meta|link)\\b([^>]{0,${MAX_TAG_LENGTH}})>`, 'gi')

// Matches one `name="value"` (or `name='value'`) attribute at a time within
// an already-bounded tag body (at most MAX_TAG_LENGTH chars), so this can't
// contribute to the unbounded-backtracking problem either.
const ATTR_RE = /([a-zA-Z:-]+)\s*=\s*(["'])([\s\S]*?)\2/g

/** Parses a single already-bounded tag body into a lowercase-keyed attribute map. */
function parseAttrs(tagBody: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  let match: RegExpExecArray | null
  ATTR_RE.lastIndex = 0
  while ((match = ATTR_RE.exec(tagBody))) {
    attrs[match[1].toLowerCase()] = match[3]
  }
  return attrs
}

/**
 * Walks every `<meta>`/`<link>` tag in the head region exactly once (see
 * `TAG_RE`/`ATTR_RE` for why this is linear-time, unlike the previous
 * backtracking-regex-per-attribute-name approach), and picks out the values
 * needed for the image and description. `property=` and `name=` are treated
 * interchangeably — real-world pages mix these (MDN serves `og:image` via
 * `name=`; some sites serve `twitter:image` via `property=`).
 */
function scanHeadTags(head: string): { ogImage: string | null; description: string | null } {
  const metaByKey: Record<string, string> = {}
  let imageSrcLink: string | null = null

  TAG_RE.lastIndex = 0
  let tagMatch: RegExpExecArray | null
  while ((tagMatch = TAG_RE.exec(head))) {
    const [, tagName, body] = tagMatch
    const attrs = parseAttrs(body)

    if (tagName.toLowerCase() === 'meta') {
      const key = (attrs.property ?? attrs.name)?.toLowerCase()
      if (key && attrs.content !== undefined && !(key in metaByKey)) {
        metaByKey[key] = attrs.content
      }
    } else if (tagName.toLowerCase() === 'link') {
      if (attrs.rel?.toLowerCase() === 'image_src' && attrs.href !== undefined && imageSrcLink === null) {
        imageSrcLink = attrs.href
      }
    }
  }

  const ogImage =
    metaByKey['og:image'] ??
    metaByKey['og:image:secure_url'] ??
    metaByKey['og:image:url'] ??
    metaByKey['twitter:image'] ??
    metaByKey['twitter:image:src'] ??
    imageSrcLink ??
    null

  const rawDescription = metaByKey['og:description'] ?? metaByKey['description'] ?? null
  const description = rawDescription ? rawDescription.slice(0, MAX_DESCRIPTION_LENGTH) : null

  return { ogImage, description }
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
 */
async function fetchPreview(raw: string | null): Promise<
  | { ok: true; ogImage: string | null; description: string | null }
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
  let description: string | null = null
  try {
    const { body: html, finalUrl, contentType } = await fetchCapped(target)
    // Non-HTML responses (e.g. vercel.com/docs serving text/markdown to a
    // bot-flavored Accept header) have no meta tags — bail out before
    // regex-ing content that was never going to match.
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return { ok: true, ogImage: null, description: null }
    }
    const head = extractHead(html)
    const scanned = scanHeadTags(head)
    ogImage = scanned.ogImage ? decodeHtmlEntities(scanned.ogImage) : null
    description = scanned.description ? decodeHtmlEntities(scanned.description) : null
    // Only accept absolute http(s) image URLs — never echo relative paths
    // or javascript: schemes back to the client. Resolved against the final
    // URL (post-redirects), since a relative image path is relative to
    // wherever the page actually ended up, not the originally requested URL.
    if (ogImage) {
      try {
        const imgUrl = new URL(ogImage, finalUrl)
        ogImage = imgUrl.protocol === 'http:' || imgUrl.protocol === 'https:' ? imgUrl.toString() : null
      } catch {
        ogImage = null
      }
    }
  } catch {
    ogImage = null // never leak fetch/parse error details to the client
    description = null
  }

  return { ok: true, ogImage, description }
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
  return jsonResponse({ ogImage: result.ogImage, description: result.description })
}
