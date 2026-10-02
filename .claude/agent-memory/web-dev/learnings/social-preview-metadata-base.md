---
name: social-preview-metadata-base
description: File-convention og/twitter images plus a non-throwing metadataBase helper; why absoluteUrl is unsuitable for metadata
metadata:
  type: reference
---

- `app/opengraph-image.png` / `twitter-image.png` (+ `.alt.txt`) are the App Router file conventions; they are inherited by routes whose own `openGraph`/`twitter` export has no `images`. Route-level `openGraph` objects replace the parent's shallowly, so a page that adds its own `openGraph` must set `images` itself (none do today; a test asserts the beta page exports none).
- `metadataBase` comes from `getMetadataBase()` in `lib/utils.ts`. `absoluteUrl` throws on a missing env var by design (Stripe redirects), so it must not be used for metadata, where a throw would break `next build`.
- The source art lives git-ignored in `packages/demo/promo/`; the web copies are committed.
