# Blog posts

One folder per post, named after its URL slug: `content/blog/<slug>/<locale>.mdx` (`en.mdx`
first; another locale's file publishes that translation, no code change). Each file exports its
data as `export const post = { … }` (checked by `parsePost` in `lib/blog/posts.ts`) and its body
uses the components in `mdx-components.tsx`.

- **Go-live date:** set `published` to the day the post should appear (UTC). Posts can be merged
  early: until that date they are left out of the blog index, tag pages, sitemap and llms.txt on
  production and preview, and their page is a 404 on production (preview and local development
  show it with a "Scheduled" banner). Keep `updated` equal to `published` until the content
  changes; no two posts share a `published` date. No deploy is needed on the day: every page
  renders per request (the root layout reads the request locale), so the date check runs on each
  request; the sitemap and llms.txt revalidate hourly. If blog pages ever become static, add a
  daily revalidation (a Vercel cron calling `revalidatePath`) or posts will stay hidden.
- **Scheduled posts under `next dev`:** locally they are also listed on the blog index, its pages,
  the tag pages, the topic chips and the previous/next links, each card flagged `Scheduled for
  <date>` (`scheduledPreviewEnabled` in `lib/blog/posts.ts`). `BLOG_DEV_SCHEDULED=0` turns that
  off. They never count toward a tag page's indexability and are never in the sitemap or llms.txt.
- **Links to scheduled posts:** link other posts as `/blog/<slug>` (no locale prefix). A link to a
  post whose date hasn't come yet is shown as plain text on production and becomes a link on that
  date (`isScheduledPostLink`); preview and local development link it.
- **Helpful votes:** nothing to do. A new post needs no migration: after each web deploy the deploy
  job runs `scripts/sync-blog-posts.mjs`, which sends every post slug (scheduled ones included) to
  the database's `sync_blog_posts` RPC, and `pnpm dev:all` does the same against local Supabase.
  `node scripts/sync-blog-posts.mjs --dry-run` prints the list it would send.
- **Renaming a published slug** loses its votes 30 days later (the old slug counts as missing and
  is deleted with its votes), unless you run
  `update public.blog_posts set slug = '<new>' where slug = '<old>'` before the deploy that lists
  the new slug: 031's `on update cascade` carries the votes across.
- **Tags:** 3 to 8 from `lib/blog/tags.ts`.
- **Screenshots:** `public/blog/<slug>/`, annotation boxes in `content/blog/<slug>/boxes.json`
  (see `scripts/blog-screenshots/README.md`).
- Restart `next dev` after adding a post or a locale file (the file list is generated when Next
  starts: `scripts/generate-blog-index.mjs`).
- **Dev-only placeholder posts:** none exist today. The generator still lists any
  `content/blog/_placeholders/<slug>/en.mdx`, flagged, outside a production build; they show only
  under `next dev` (not with `BLOG_DEV_PLACEHOLDERS=0`), are `noindex`, and are never in the
  sitemap, llms.txt or tag counts.
