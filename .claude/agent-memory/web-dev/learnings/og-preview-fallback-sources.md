---
name: og-preview-fallback-sources
description: og-preview route reliability measurement + itemprop/JSON-LD/icon fallback chain, and how to test node:http(s)-based routes without hitting the network
metadata:
  type: project
---

Measured `packages/web/app/api/og-preview/route.ts` against ~30 real URLs (script fetched
directly with global `fetch`, bypassing the route's SSRF guards — a measurement-only
throwaway, not something to keep). Baseline og:image/twitter:image chain hit rate: 18/30
(60%). Real failure causes, in order of frequency:
1. Upstream 403/429 blocking the fetch outright before any HTML is seen (stackoverflow,
   medium, npmjs, nytimes all gate on non-browser UA/TLS-fingerprint at the edge —
   independent of `Accept` header content negotiation). Not fixable without impersonating
   a real browser, which the existing code deliberately avoids (see `fetchPinnedHop`'s
   honest `TabMergerBot/1.0` UA comment) — flagged as an accepted limitation, not a bug.
2. Genuine no-image pages (a BBC/Wikipedia index-style page, a plain blog with no meta
   tags at all) — nothing to extract, this is correct behavior, not a bug.
3. Real gap found: unquoted attribute values (`content=foo.png`, no quotes) didn't match
   the old `ATTR_RE`, which only had a quoted-value alternative. Fixed by adding a third
   alternation `[^\s"'>]+` for bare values.

No bugs found in: protocol-relative image URL resolution (already correct — `new URL('//x','https://y')`
naturally inherits the base's protocol), attribute order (content-before-property; attrs are
collected into a map before being read, so order never mattered), tag-name case (TAG_RE/ATTR_RE
already run with the `i` flag).

Added, in priority order after the existing og:image chain: schema.org `itemprop="image"`
(meta content= or link href=), vendor `meta name=` tags (thumbnail, parsely-image-url,
sailthru.image.full, msapplication-TileImage), JSON-LD `image`/`thumbnailUrl` (string/array/
ImageObject/@graph, bounded per-script size + try/catch, never executes anything), and a
last-resort icon fallback (largest apple-touch-icon/icon `sizes >= 128px`, or an unsized
apple-touch-icon) returned with a new additive `imageKind: 'icon'|'preview'` response field.
Every candidate is resolved independently via a new `resolveCandidate(raw, finalUrl)` helper
that decodes entities, rejects `data:`/`javascript:`, and falls through to the next source on
failure instead of aborting the whole chain — this is the key structural change: previously a
single `ogImage` variable either had a value or didn't, now there's an ordered list of
candidate-producing functions tried in sequence.

Testing pattern for this route: it fetches via `node:http`/`node:https` directly (not global
`fetch`) for DNS-pinning/SSRF reasons, which makes network-level mocking (`vi.mock('node:https')`)
fragile and low-value. Instead, exported the pure, side-effect-free extraction functions
(`scanHeadTags`, `extractJsonLdImage`, `pickIcon`, `resolveCandidate`, `decodeHtmlEntities`,
`extractHead`, plus the `IconCandidate` type) directly from the route file and unit-tested those
in isolation — no fetch mocking needed at all. `POST` itself stays untested at the unit level
(would need the network layer); that's an accepted gap for this route, not a regression.
