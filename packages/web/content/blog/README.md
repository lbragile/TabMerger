# Blog posts

One folder per post, named after its URL slug: `content/blog/<slug>/<locale>.mdx` (`en.mdx`
first; another locale's file publishes that translation, no code change). Each file exports its
data as `export const post = { … }` (checked by `parsePost` in `lib/blog/posts.ts`) and its body
uses the components in `mdx-components.tsx`.

- **Go-live date:** set `published` to the day the post should appear (UTC). Posts can be merged
  early: until that date they are left out of the blog index, tag pages, sitemap and llms.txt,
  and their page is a 404 on production (preview and local development show it with a
  "Scheduled" banner). Keep `updated` equal to `published` until the content changes; no two
  posts share a `published` date.
- **Helpful votes:** add the slug to `blog_posts` in a new Supabase migration.
- **Tags:** 3 to 6 from `lib/blog/tags.ts`.
- **Screenshots:** `public/blog/<slug>/`, annotation boxes in `content/blog/<slug>/boxes.json`
  (see `scripts/blog-screenshots/README.md`).
- Restart `next dev` after adding a post or a locale file (the file list is generated when Next
  starts: `scripts/generate-blog-index.mjs`).
- **Dev-only placeholder posts:** `content/blog/_placeholders/<slug>/en.mdx` (English only, never
  translated). They exist so the previous/next links can be seen locally. The generated index lists
  them, flagged, in every mode but a production build (`next build` / Vercel leave them out, so they
  are never bundled); at runtime they show only under `next dev`, and not with
  `BLOG_DEV_PLACEHOLDERS=0`. They are `noindex` and never in the sitemap, llms.txt or tag counts.
  Restart `next dev` after adding or removing one.
