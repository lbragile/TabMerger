---
name: blog-covers-build-time
description: Blog index covers resolved and validated at build time (public/ isn't on the server filesystem), 4:3 whole-image rule with header-read sizes, theme pairs via dark: classes without double fetch
metadata:
  type: reference
---

- **Resolve file-dependent facts in the generator, not at request time.** Checking whether
  `public/…-dark.webp` exists, or reading an image's size, can't happen in a server component: on
  Vercel `public/` is served from the CDN and isn't in the function filesystem.
  `scripts/generate-blog-index.mjs` `resolveCover` does it at build time (it runs in next.config,
  Vitest globalSetup and type-check; see [[build-time-generated-module]]) and writes
  `cover: { src, srcDark? }` into `generated/blog.ts`. `cardCover()` only reads that.
- **Image size without a dependency.** `imageSize()` reads the header: PNG IHDR (bytes 16/20),
  WebP `VP8X` (24/27, 24-bit +1), `VP8L` (bits at 21), `VP8 ` (26/28), JPEG SOFn markers. That's enough to enforce
  "4:3 within 2%" (TabMerger captures are 1600×1200; browser captures are 2.4–3:1 strips and
  must never become covers). Tests build a 33-byte PNG header fixture in a temp `publicDir`.
- **Decision: covers are shown whole** (4:3 frame, `object-contain`, no focus or zoom). A
  focus/zoom crop of a wide screenshot was tried and rejected because the UI text got unreadable or
  irrelevant. The generator rejects unknown cover fields, so `focus`/`zoom` fail the build.
- **Fallback order:** the post's `cover`, then the first 4:3 `images` entry, then the TabMerger mark.
  A translation without its own `cover` inherits the English one (resolved per post after all
  locale files are read).
- **Theme pairs without a flash or a double download:** render both `<Image>`s, `dark:hidden` and
  `hidden dark:block` (the ThemedScreenshot pattern), and keep both `loading="lazy"`. A
  `display: none` lazy image isn't fetched, but an eager one is. For the featured card, use
  `fetchPriority="high"` rather than `eager`.
- Hover zoom: `motion-safe:group-hover:scale-[1.03]` inside the `overflow-hidden` frame, with
  `group` on the card. Under reduced motion nothing scales or transitions.
