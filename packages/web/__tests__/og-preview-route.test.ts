/**
 * Tests for the pure extraction logic behind POST /api/og-preview
 * (app/api/og-preview/route.ts). The network/SSRF-guarded fetch path is
 * intentionally not exercised here — these tests target the exported,
 * side-effect-free tag/JSON-LD/icon parsing functions directly.
 */
import { describe, it, expect } from 'vitest'
import {
  decodeHtmlEntities,
  extractHead,
  scanHeadTags,
  extractJsonLdImage,
  pickIcon,
  resolveCandidate,
  type IconCandidate,
} from '@/lib/ogPreviewParse'

function head(inner: string): string {
  return `<head>${inner}</head>`
}

describe('decodeHtmlEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeHtmlEntities('a&amp;b&#39;c&quot;')).toBe(`a&b'c"`)
  })
})

describe('scanHeadTags — og:image chain priority', () => {
  it('prefers og:image over every other source', () => {
    const h = head(`
      <meta property="og:image" content="https://a.test/og.png">
      <meta name="twitter:image" content="https://a.test/tw.png">
      <meta itemprop="image" content="https://a.test/itemprop.png">
    `)
    expect(scanHeadTags(h).ogImage).toBe('https://a.test/og.png')
  })

  it('falls back through og:image:secure_url, og:image:url, twitter:image, twitter:image:src, link[image_src]', () => {
    expect(scanHeadTags(head(`<meta property="og:image:secure_url" content="https://a.test/x.png">`)).ogImage).toBe(
      'https://a.test/x.png'
    )
    expect(scanHeadTags(head(`<link rel="image_src" href="https://a.test/y.png">`)).ogImage).toBe(
      'https://a.test/y.png'
    )
  })

  it('treats property= and name= interchangeably', () => {
    expect(scanHeadTags(head(`<meta name="og:image" content="https://a.test/n.png">`)).ogImage).toBe(
      'https://a.test/n.png'
    )
  })

  it('is case-insensitive and tolerates uppercase tags/attrs', () => {
    const h = head(`<META PROPERTY="OG:IMAGE" CONTENT="https://a.test/upper.png">`)
    expect(scanHeadTags(h).ogImage).toBe('https://a.test/upper.png')
  })

  it('parses unquoted attribute values', () => {
    const h = head(`<meta property=og:image content=https://a.test/unquoted.png>`)
    expect(scanHeadTags(h).ogImage).toBe('https://a.test/unquoted.png')
  })

  it('does not care about content before property attribute order', () => {
    const h = head(`<meta content="https://a.test/order.png" property="og:image">`)
    expect(scanHeadTags(h).ogImage).toBe('https://a.test/order.png')
  })

  it('trims whitespace around content', () => {
    const h = head(`<meta property="og:image" content="  https://a.test/ws.png  ">`)
    expect(scanHeadTags(h).ogImage).toBe('https://a.test/ws.png')
  })
})

describe('scanHeadTags — itemprop image (Part 2.1)', () => {
  it('is returned separately from ogImage when og chain has nothing', () => {
    const h = head(`<meta itemprop="image" content="https://a.test/itemprop.png">`)
    const scanned = scanHeadTags(h)
    expect(scanned.ogImage).toBeNull()
    expect(scanned.itempropImage).toBe('https://a.test/itemprop.png')
  })

  it('also reads itemprop from a link href', () => {
    const h = head(`<link itemprop="image" href="https://a.test/link-itemprop.png">`)
    expect(scanHeadTags(h).itempropImage).toBe('https://a.test/link-itemprop.png')
  })

  it('does not let itemprop override a present og:image', () => {
    const h = head(`
      <meta property="og:image" content="https://a.test/og.png">
      <meta itemprop="image" content="https://a.test/itemprop.png">
    `)
    expect(scanHeadTags(h).ogImage).toBe('https://a.test/og.png')
  })
})

describe('scanHeadTags — vendor name= fallbacks (Part 2.2)', () => {
  it.each(['thumbnail', 'parsely-image-url', 'sailthru.image.full', 'msapplication-TileImage'])(
    'falls back to meta name="%s" when nothing else matches',
    (name) => {
      const h = head(`<meta name="${name}" content="https://a.test/vendor.png">`)
      expect(scanHeadTags(h).ogImage).toBe('https://a.test/vendor.png')
    }
  )

  it('is lower priority than og:image', () => {
    const h = head(`
      <meta name="thumbnail" content="https://a.test/vendor.png">
      <meta property="og:image" content="https://a.test/og.png">
    `)
    expect(scanHeadTags(h).ogImage).toBe('https://a.test/og.png')
  })
})

describe('extractJsonLdImage (Part 2.3)', () => {
  it('reads a plain string image', () => {
    const h = head(`<script type="application/ld+json">{"image":"https://a.test/jsonld.png"}</script>`)
    expect(extractJsonLdImage(h)).toBe('https://a.test/jsonld.png')
  })

  it('reads the first entry of an array image', () => {
    const h = head(
      `<script type="application/ld+json">{"image":["https://a.test/first.png","https://a.test/second.png"]}</script>`
    )
    expect(extractJsonLdImage(h)).toBe('https://a.test/first.png')
  })

  it('reads an ImageObject { url }', () => {
    const h = head(
      `<script type="application/ld+json">{"image":{"@type":"ImageObject","url":"https://a.test/obj.png"}}</script>`
    )
    expect(extractJsonLdImage(h)).toBe('https://a.test/obj.png')
  })

  it('descends into @graph', () => {
    const h = head(
      `<script type="application/ld+json">{"@graph":[{"@type":"Thing"},{"image":"https://a.test/graph.png"}]}</script>`
    )
    expect(extractJsonLdImage(h)).toBe('https://a.test/graph.png')
  })

  it('falls back to thumbnailUrl when image is absent', () => {
    const h = head(`<script type="application/ld+json">{"thumbnailUrl":"https://a.test/thumb.png"}</script>`)
    expect(extractJsonLdImage(h)).toBe('https://a.test/thumb.png')
  })

  it('handles a top-level JSON-LD array', () => {
    const h = head(
      `<script type="application/ld+json">[{"@type":"Thing"},{"image":"https://a.test/arr.png"}]</script>`
    )
    expect(extractJsonLdImage(h)).toBe('https://a.test/arr.png')
  })

  it('never throws on malformed JSON and returns null', () => {
    const h = head(`<script type="application/ld+json">{ not: valid json </script>`)
    expect(extractJsonLdImage(h)).toBeNull()
  })

  it('skips a script whose body exceeds the size cap and does not throw', () => {
    const huge = `{"image":"https://a.test/x.png","pad":"${'a'.repeat(60_000)}"}`
    const h = head(`<script type="application/ld+json">${huge}</script>`)
    expect(extractJsonLdImage(h)).toBeNull()
  })

  it('returns null when there is no JSON-LD at all', () => {
    expect(extractJsonLdImage(head(''))).toBeNull()
  })

  it('is bounded in time even with many unterminated script tags (ReDoS-style input)', () => {
    const hostile = 'x'.repeat(50_000) + '<script type="application/ld+json">'.repeat(3000)
    const start = Date.now()
    extractJsonLdImage(head(hostile))
    expect(Date.now() - start).toBeLessThan(1000)
  })
})

describe('pickIcon (Part 2.4)', () => {
  it('returns null when there are no candidates', () => {
    expect(pickIcon([])).toBeNull()
  })

  it('ignores icons smaller than 128px', () => {
    const candidates: IconCandidate[] = [{ href: '/favicon-32.png', size: 32, isAppleTouch: false }]
    expect(pickIcon(candidates)).toBeNull()
  })

  it('picks the largest sized icon at or above 128px', () => {
    const candidates: IconCandidate[] = [
      { href: '/icon-128.png', size: 128, isAppleTouch: false },
      { href: '/icon-512.png', size: 512, isAppleTouch: false },
      { href: '/icon-32.png', size: 32, isAppleTouch: false },
    ]
    expect(pickIcon(candidates)).toBe('/icon-512.png')
  })

  it('falls back to an unsized apple-touch-icon when nothing sized qualifies', () => {
    const candidates: IconCandidate[] = [
      { href: '/favicon.ico', size: 16, isAppleTouch: false },
      { href: '/apple-touch-icon.png', size: 0, isAppleTouch: true },
    ]
    expect(pickIcon(candidates)).toBe('/apple-touch-icon.png')
  })

  it('does not use an unsized plain icon (only unsized apple-touch-icon qualifies)', () => {
    const candidates: IconCandidate[] = [{ href: '/icon.png', size: 0, isAppleTouch: false }]
    expect(pickIcon(candidates)).toBeNull()
  })
})

describe('scanHeadTags — icon candidate collection', () => {
  it('collects icon and apple-touch-icon links with sizes', () => {
    const h = head(`
      <link rel="icon" href="/favicon-32.png" sizes="32x32">
      <link rel="apple-touch-icon" href="/apple-touch-180.png" sizes="180x180">
    `)
    const { iconCandidates } = scanHeadTags(h)
    expect(iconCandidates).toContainEqual({ href: '/favicon-32.png', size: 32, isAppleTouch: false })
    expect(iconCandidates).toContainEqual({ href: '/apple-touch-180.png', size: 180, isAppleTouch: true })
  })

  it('takes the larger dimension for non-square sizes', () => {
    const h = head(`<link rel="icon" href="/wide.png" sizes="64x256">`)
    expect(scanHeadTags(h).iconCandidates[0].size).toBe(256)
  })
})

describe('resolveCandidate', () => {
  const finalUrl = 'https://final.test/page'

  it('resolves a relative path against finalUrl', () => {
    expect(resolveCandidate('/img.png', finalUrl)).toBe('https://final.test/img.png')
  })

  it('resolves a protocol-relative URL using the final URL protocol', () => {
    expect(resolveCandidate('//cdn.test/img.png', finalUrl)).toBe('https://cdn.test/img.png')
  })

  it('rejects data: URLs', () => {
    expect(resolveCandidate('data:image/png;base64,abcd', finalUrl)).toBeNull()
  })

  it('rejects javascript: URLs', () => {
    expect(resolveCandidate('javascript:alert(1)', finalUrl)).toBeNull()
  })

  it('rejects every non-http(s) scheme, whatever its case or leading whitespace', () => {
    expect(resolveCandidate('data:image/png;base64,AAAA', finalUrl)).toBeNull()
    expect(resolveCandidate('JAVASCRIPT:alert(1)', finalUrl)).toBeNull()
    expect(resolveCandidate('vbscript:msgbox(1)', finalUrl)).toBeNull()
    expect(resolveCandidate(' javascript:alert(1)', finalUrl)).toBeNull()
  })

  it('keeps relative, protocol-relative and absolute https candidates', () => {
    expect(resolveCandidate('img/a.png', finalUrl)).toBe('https://final.test/img/a.png')
    expect(resolveCandidate('//cdn.example.com/a.png', finalUrl)).toBe('https://cdn.example.com/a.png')
    expect(resolveCandidate('https://cdn.example.com/a.png', finalUrl)).toBe('https://cdn.example.com/a.png')
  })

  it('rejects empty/null candidates', () => {
    expect(resolveCandidate('', finalUrl)).toBeNull()
    expect(resolveCandidate(null, finalUrl)).toBeNull()
  })

  it('decodes HTML entities before resolving', () => {
    expect(resolveCandidate('https://a.test/img.png?a=1&amp;b=2', finalUrl)).toBe(
      'https://a.test/img.png?a=1&b=2'
    )
  })

  it('rejects a non-http(s) absolute URL', () => {
    expect(resolveCandidate('ftp://a.test/img.png', finalUrl)).toBeNull()
  })
})

describe('extractHead', () => {
  it('extracts the real head region when present', () => {
    const html = `<html><head><title>t</title></head><body>x</body></html>`
    expect(extractHead(html)).toBe('<head><title>t</title></head>')
  })

  it('falls back to the raw HTML (bounded) when there is no closing head tag', () => {
    const html = `<html><head><title>t</title>`
    expect(extractHead(html)).toBe(html)
  })
})
