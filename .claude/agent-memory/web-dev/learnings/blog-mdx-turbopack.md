---
name: blog-mdx-turbopack
description: MDX on Next 16.4 + Turbopack for the blog — plugin loading rules (name or absolute path, default export only), plugins that fail, heading ids, the build-time post index, and what plugins never see
metadata:
  type: reference
---

- **Plugin loading:** `createMDX({ options: { remarkPlugins: ['remark-gfm', ...], rehypePlugins: [...] } })`.
  Strings only, options JSON-serialisable. `@next/mdx/mdx-js-loader.js` does
  `require.resolve(name, { paths: [projectRoot] })` then `import()` and takes `mod.default || mod`,
  so: an **absolute path** to our own plugin works (`path.resolve(process.cwd(), 'lib/blog/mdx/rehype-figure-numbers.mjs')`),
  and a CommonJS package with only a **named** export (`rehype-accessible-emojis` 0.3.2) gets an
  object, not a plugin, and breaks compilation. `remark-unwrap-images` 5.0.0 is an empty deprecated
  stub (package.json + readme): use `rehype-unwrap-images`.
- `pnpm add @next/mdx` resolved a newer patch than `next`; `-E`/`@x.y.z` still kept the caret
  until package.json was edited to the exact version and `pnpm install` re-run.
- **Heading ids:** `## Title {#id}` is invalid in MDX (`{}` is a JS expression). Stable ids come from
  a `<Section id title>` component; rehype-slug only ids plain Markdown headings (from their text,
  so they change in translations). Plugins see MDX JSX as `mdxJsxFlowElement` nodes (our figure
  numbering plugin adds a `figure` attribute to `AnnotatedFigure`/`ThemedScreenshot` there), but
  the `components` mapping only replaces Markdown-generated elements, never literal JSX `<table>`.
- `mdx-components.tsx` (package root, required) is a server module; posts use the registered
  components without importing them; `export const post = {...}` in the MDX is in scope in the
  body (`<Faq items={post.faq} />`).
- **No fs at runtime:** `scripts/generate-blog-index.mjs` writes git-ignored `generated/blog.ts`
  (static `import()` per locale file, word count, title/description/published/images/tags read
  from the `post` block, and `boxes.json`) from next.config, Vitest globalSetup and `type-check`,
  like the changelog generator. A new post or locale file needs a `next dev` restart.
- **One generated file, many writers:** `next dev` (next.config), Vitest's global setup and
  `type-check` all rewrite `generated/blog.ts`. Anything mode-dependent must not change its
  content (a test run would silently change the running dev site): dev-only placeholder posts are
  always written (flagged) except for `NODE_ENV=production`, and filtered at runtime in
  `lib/blog/posts.ts`. Tests comparing the raw generated list must drop flagged entries.
- The generator reads `post` strings with a regex, so it resolves JS escapes itself
  (`unescapeJsString`), or a translation's direction marks written as `‏` escapes won't match
  the parsed post.
- Read time counts Han/Hiragana/Katakana characters at 500/min next to 230 words/min; whitespace
  splitting alone gave ja/zh posts "1 min".
- Vitest can't import `.mdx`: tests use the generated summaries or render components directly.

Related: [[build-time-generated-module]], [[i18n-next-intl]].
