---
name: blog-translation-new-post-generator
description: Translating a whole new blog post into 17 locales with one template + per-locale data files; the zod length limits, a stray-bold check, reusing a sibling translation's alts, and bidi/ZWNJ traps in typed data
metadata:
  type: reference
---

**Shape that worked (17 files, one hook-free write):** in the scratchpad, `tpl.mdx` is en.mdx with
`{{key}}` slots (body), `{{q:key}}` (single-quoted post field, `\'`-escaped) and `{{a:key}}`
(JSX attribute, refuse a `"`). Each locale is a `data/<loc>.txt` of `@@key` blocks; a node
generator refuses missing, unused or duplicate keys, newlines in post fields and any U+200E/U+200F
in the post block, and writes the files. Everything structural (images, props, ids, links' hrefs,
comments) stays in the template, so parity holds by construction. Writing the template with the
Write tool on Windows gives CRLF, matching the repo's mdx files.

**Reuse verified strings from a sibling translation:** when the new post shares screenshots with an
already translated post, the generator can lift each locale's alt (by `src`) and caption (by the
`AnnotatedFigure src`) from that post's `<loc>.mdx`, so the same image keeps the same alt text. Strip
U+200F from lifted alts: older fa/he alts carry one, which is not allowed in new post fields.

**Limits the schema enforces** (`lib/blog/posts.ts`): `shareSummary` at most 100 characters and
`navTitle` at most 80. German, Indonesian, Polish, Portuguese and Vietnamese ran over 100 on a
literal translation; check lengths before the vitest run.

**Checks worth scripting (outside the repo, `@mdx-js/mdx` from the pnpm store):**
- unparsed bold: a CommonMark flanking failure leaves a literal `**` in a compiled string, and
  children can be an array, so match any `"…**…"` literal in the compiled JS, not only `children: "`;
- every FAQ `link.text` must be an exact substring of its answer (`PostBody` splits on it), and each
  figure/ThemedScreenshot alt must equal its `post.images` entry (eval the post block with
  `new Function`);
- exact catalog / ftl strings present per locale, and `<strong>` counts against English.

**Typed-data traps:** a U+200F slipped into hand-typed Hebrew after copying reference text; scan the
data files for U+200E/U+200F/U+200C before generating, and write Persian ZWNJ as a `{z}` token the
generator expands. In fa post fields "Chrome، Edge" (Persian comma between two Latin words) displays
in the wrong order without an RLM, which post fields can't have; write "Chrome و Edge و Firefox".
Shell-quoted `node -e` edits of regex-heavy scripts break (see [[windows-shell-edit-scripts]]):
edit scratch scripts with Edit/Write.

Related: [[blog-translation-sync-script]], [[localized-browser-ui-labels]].

**Check the template before writing any locale:** fill it with the English text and diff the result against `en.mdx`. If they're byte-identical, every structural field (dates, images, props, links) is right by construction.

**Alt comparison:** figure alts in JSX attributes contain `&quot;`; decode entities before comparing them with `post.images` alts, or a correct file fails the check.
