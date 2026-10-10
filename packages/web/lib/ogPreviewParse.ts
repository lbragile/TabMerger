/**
 * HTML parsing for POST /api/og-preview (app/api/og-preview/route.ts): pulls the preview image
 * and description out of a page's head. Kept out of the route file because a Next.js route may
 * only export request handlers, and these are exported for unit tests. Pure functions only — all
 * network access (and its SSRF protections) stays in the route.
 */

/** Response size cap; also bounds how much HTML the parser scans when there's no </head>. */
export const MAX_BYTES = 2 * 1024 * 1024 // 2MB

const MAX_DESCRIPTION_LENGTH = 500

/**
 * Meta `content` values are HTML-attribute text, so `&` in an image URL arrives as `&amp;`
 * (Wikipedia's og:image does this) and descriptions carry `&quot;`, `&#39;` and friends.
 * Decode the common named entities and numeric references before using the value — an
 * undecoded `&amp;` turns `?a=1&amp;b=2` into a different, often broken, image URL.
 */
export function decodeHtmlEntities(value: string): string {
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
 * Live measurement against ~30 real URLs (github, youtube, reddit, stackoverflow,
 * wikipedia, bbc, amazon, medium, MDN, vercel docs, npmjs, x.com, linkedin, shopify,
 * a plain blog, an image URL, a PDF, cloudflare-fronted sites, etc.) found the tag
 * parser itself was not the bottleneck — every genuine failure was either (a) the
 * upstream host 403/429-blocking the fetch outright (stackoverflow, medium, npmjs,
 * nytimes all reject non-browser UAs at the edge, independent of what we send in
 * `Accept`), or (b) a real page with no image meta tags at all (a news index page,
 * a minimal-markup blog). No case was found of a relative/protocol-relative/
 * entity-encoded image URL slipping past the existing decode+resolve step, and none
 * of uppercase tag names, `content` before `property`, or whitespace-padded content
 * broke extraction (attributes are collected into a map before being read, so order
 * never matters; `TAG_RE`/`ATTR_RE` already run case-insensitively). The one real gap
 * confirmed against live markup: attribute values without quotes (`content=foo`) do
 * not match `ATTR_RE`'s quote-only pattern — fixed by giving it an unquoted
 * alternative below. See `og-preview` learnings for the full measurement writeup.
 */

/**
 * Extracts the head region to scan for meta tags. Prefers the real
 * `<head>...</head>` slice; falls back to up to `MAX_BYTES` of the raw HTML
 * when there's no closing tag (a page's head can be truncated by our own
 * MAX_BYTES cap, or split oddly) — scanning only 50k in that case could miss
 * meta tags that a real browser would still see.
 */
export function extractHead(html: string): string {
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
// contribute to the unbounded-backtracking problem either. The third
// alternative (`[^\s"'>]+`) matches a bare, unquoted value (`content=foo.png`)
// — rare but valid HTML, and real bot-served markup was seen using it for a
// handful of legacy meta tags.
const ATTR_RE = /([a-zA-Z:-]+)\s*=\s*(?:(["'])([\s\S]*?)\2|([^\s"'>]+))/g

/** Parses a single already-bounded tag body into a lowercase-keyed attribute map. */
function parseAttrs(tagBody: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  let match: RegExpExecArray | null
  ATTR_RE.lastIndex = 0
  while ((match = ATTR_RE.exec(tagBody))) {
    attrs[match[1].toLowerCase()] = (match[3] ?? match[4] ?? '').trim()
  }
  return attrs
}

// Meta `name=` values checked, in priority order, after the og:image/twitter:image
// chain and after schema.org `itemprop="image"` — vendor-specific preview-image
// tags some CMSes/analytics platforms emit instead of (or in addition to) og:image.
const NAME_FALLBACK_KEYS = ['thumbnail', 'parsely-image-url', 'sailthru.image.full', 'msapplication-tileimage']

// Minimum `sizes="WxH"` (either dimension) for an `<link rel="icon">`/`apple-touch-icon`
// to be considered as a last-resort preview image — anything smaller is almost
// certainly a 16x16/32x32 favicon, not something worth showing as a tab preview.
const MIN_ICON_SIZE = 128

/** A single icon `<link>` candidate collected while scanning head tags. */
export interface IconCandidate {
  href: string
  size: number // 0 when no `sizes` attribute was present (treated as "unknown", not "tiny")
  isAppleTouch: boolean
}

/**
 * Walks every `<meta>`/`<link>` tag in the head region exactly once (see
 * `TAG_RE`/`ATTR_RE` for why this is linear-time, unlike the previous
 * backtracking-regex-per-attribute-name approach), and picks out the values
 * needed for the image and description. `property=` and `name=` are treated
 * interchangeably — real-world pages mix these (MDN serves `og:image` via
 * `name=`; some sites serve `twitter:image` via `property=`). Also collects
 * schema.org `itemprop` values and every icon `<link>`, so the caller can fall
 * back to them when the og:image/twitter:image chain comes up empty.
 */
export function scanHeadTags(head: string): {
  ogImage: string | null
  description: string | null
  itempropImage: string | null
  iconCandidates: IconCandidate[]
} {
  const metaByKey: Record<string, string> = {}
  let imageSrcLink: string | null = null
  let itempropImage: string | null = null
  const iconCandidates: IconCandidate[] = []

  TAG_RE.lastIndex = 0
  let tagMatch: RegExpExecArray | null
  while ((tagMatch = TAG_RE.exec(head))) {
    const [, tagName, body] = tagMatch
    const attrs = parseAttrs(body)
    const lowerTagName = tagName.toLowerCase()

    if (lowerTagName === 'meta') {
      const key = (attrs.property ?? attrs.name)?.toLowerCase()
      if (key && attrs.content !== undefined && !(key in metaByKey)) {
        metaByKey[key] = attrs.content
      }
      if (
        attrs.itemprop?.toLowerCase() === 'image' &&
        attrs.content !== undefined &&
        itempropImage === null
      ) {
        itempropImage = attrs.content
      }
    } else if (lowerTagName === 'link') {
      const rel = attrs.rel?.toLowerCase()
      if (rel === 'image_src' && attrs.href !== undefined && imageSrcLink === null) {
        imageSrcLink = attrs.href
      }
      if (attrs.itemprop?.toLowerCase() === 'image' && attrs.href !== undefined && itempropImage === null) {
        itempropImage = attrs.href
      }
      if ((rel === 'icon' || rel === 'apple-touch-icon' || rel === 'apple-touch-icon-precomposed') && attrs.href) {
        // `sizes="192x192"` (or `"any"`, which we treat as unknown/0) — take the
        // larger of the two dimensions in case a site ships non-square icons.
        let size = 0
        if (attrs.sizes) {
          const dims = attrs.sizes
            .split(/\s+/)[0]
            ?.split('x')
            .map((n) => parseInt(n, 10))
            .filter((n) => Number.isFinite(n))
          if (dims && dims.length) size = Math.max(...dims)
        }
        iconCandidates.push({ href: attrs.href, size, isAppleTouch: rel === 'apple-touch-icon' || rel === 'apple-touch-icon-precomposed' })
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

  // Vendor `name=` fallbacks, tried only if nothing above matched — folded in
  // here rather than the caller so `metaByKey` (a closure-local var) doesn't
  // have to be threaded back out.
  const nameFallbackImage = NAME_FALLBACK_KEYS.reduce<string | null>(
    (found, key) => found ?? metaByKey[key] ?? null,
    null
  )

  return { ogImage: ogImage ?? nameFallbackImage, description, itempropImage, iconCandidates }
}

// Bounds how much of a single `<script type="application/ld+json">` body is
// handed to `JSON.parse` — legitimate JSON-LD is a few KB at most; anything
// wildly larger is either garbage or hostile, and parsing it is pure waste
// (never a security issue since JSON.parse never executes code, but still
// capped defensively). Also caps how many scripts are scanned per page.
const MAX_JSONLD_SCRIPT_LENGTH = 50_000
const MAX_JSONLD_SCRIPTS = 20

// Matches one `<script type="application/ld+json" ...>...</script>` block at
// a time. The non-greedy `[\s\S]*?` before the closing tag is a single linear
// scan per match (not nested backtracking), so — unlike the historical
// per-attribute TAG_RE problem — this is already O(head length) regardless of
// how many script blocks are present or how they're malformed; see the
// matching perf test.
const JSONLD_SCRIPT_RE =
  /<script\b[^>]{0,512}\btype\s*=\s*(["'])application\/ld\+json\1[^>]{0,512}>([\s\S]*?)<\/script\s*>/gi

/**
 * Extracts an image URL (or `thumbnailUrl`) from JSON-LD `<script>` blocks in
 * the head — schema.org's `image` can be a plain string, an array of strings,
 * or an `ImageObject` (`{ "@type": "ImageObject", "url": "..." }`), and may be
 * nested inside `@graph` (a common pattern for pages emitting multiple linked
 * entities in one script). Every script is parsed defensively: bounded size,
 * try/catch around `JSON.parse`, and nothing here ever evaluates the content
 * as code.
 */
export function extractJsonLdImage(head: string): string | null {
  JSONLD_SCRIPT_RE.lastIndex = 0
  let match: RegExpExecArray | null
  let scanned = 0
  while ((match = JSONLD_SCRIPT_RE.exec(head)) && scanned < MAX_JSONLD_SCRIPTS) {
    scanned++
    const raw = match[2].trim()
    if (!raw || raw.length > MAX_JSONLD_SCRIPT_LENGTH) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }

    const nodes: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
    for (const node of nodes) {
      const image = imageFromJsonLdNode(node)
      if (image) return image
    }
  }
  return null
}

/** Reads `image`/`thumbnailUrl` off one JSON-LD node, descending into `@graph` if present. */
function imageFromJsonLdNode(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null
  const obj = node as Record<string, unknown>

  const image = firstImageUrl(obj.image) ?? firstImageUrl(obj.thumbnailUrl)
  if (image) return image

  if (Array.isArray(obj['@graph'])) {
    for (const child of obj['@graph']) {
      const childImage = imageFromJsonLdNode(child)
      if (childImage) return childImage
    }
  }
  return null
}

/** Normalizes schema.org's string / string[] / ImageObject `image` value into one URL. */
function firstImageUrl(value: unknown): string | null {
  if (typeof value === 'string') return value || null
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstImageUrl(item)
      if (url) return url
    }
    return null
  }
  if (value && typeof value === 'object') {
    const url = (value as Record<string, unknown>).url
    if (typeof url === 'string') return url || null
  }
  return null
}

/**
 * Picks the best last-resort icon from the candidates `scanHeadTags` collected:
 * largest declared `sizes` first, then any apple-touch-icon with no declared
 * size (Apple's spec default is 60x60+ and real sites rarely go below 120,
 * so treating "no sizes attribute" as acceptable-but-unranked is reasonable —
 * unlike a plain `rel="icon"` with no sizes, which is very often a 16x16
 * favicon.ico and is excluded unless declared >= MIN_ICON_SIZE).
 */
export function pickIcon(candidates: IconCandidate[]): string | null {
  const sized = candidates.filter((c) => c.size >= MIN_ICON_SIZE).sort((a, b) => b.size - a.size)
  if (sized.length) return sized[0].href

  const unsizedAppleTouch = candidates.find((c) => c.isAppleTouch && c.size === 0)
  return unsizedAppleTouch?.href ?? null
}

export type ImageKind = 'preview' | 'icon'

/**
 * Resolves a raw (possibly relative, protocol-relative, entity-encoded, or
 * empty/`data:`/`javascript:`) candidate image value against `finalUrl` into
 * an absolute http(s) URL, or `null` if the candidate isn't usable — callers
 * walk a priority list of candidates and move on to the next one on `null`
 * rather than giving up entirely (a `data:` og:image shouldn't block a
 * perfectly good JSON-LD or icon fallback further down the list).
 */
export function resolveCandidate(raw: string | null, finalUrl: string): string | null {
  if (!raw) return null
  const decoded = decodeHtmlEntities(raw).trim()
  if (!decoded) return null
  try {
    const imgUrl = new URL(decoded, finalUrl)
    return imgUrl.protocol === 'http:' || imgUrl.protocol === 'https:' ? imgUrl.toString() : null
  } catch {
    return null
  }
}
