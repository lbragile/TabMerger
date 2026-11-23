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

Run the template check again just before writing into the repo, to confirm en.mdx didn't change while the locales were being drafted.

**Verifier pitfalls:**
- A CJK stray-bold regex like `/**[^*
]+[。、，]**/` spans from one bold's closing `**` to the next one's opening. Match pairs with `/**([^*
]+?)**/g` and test whether the content ends in punctuation.
- A caption regex of `([^<]*)` misses RTL captions that contain `<bdi>`; use `(.*?)</ThemedScreenshot>`.
- Converting `"…"` to typographic quotes for JSX attributes must skip code spans (it paired quotes across `` `group:"Docs"` `` and `` `window:"Local"` ``). Convert only alt and caption keys, or protect backtick spans first.

**Search-syntax examples pin the example names:** when the body uses `group:"Docs"` or `window:"Local"`, keep those group and window names in English in every locale, or the prose contradicts the code.

**RTL marks:** a ComparisonTable cell (single-quoted string) can't hold U+200F, so reword it ("API ו-MDN" instead of "API, ‏MDN"). A caption that ends a Latin run with a neutral character (`github.com/lbragile/`) needs `<bdi dir="ltr">`.

**Catalog tokens:** let the generator expand `{L:file.key}` from `packages/extension/src/locales/<loc>/<file>.json` and refuse missing keys or unexpanded tokens. No hand-copied label drift, and fa ZWNJ inside labels stays intact.

- CJK bold: an opening `**` right after `、`/`。` is fine; only a closing `**` after CJK punctuation fails. Rely on the compile stray-`**` check plus the strong count rather than a bare `[。、]**` regex.
- FAQ link text: PostBody links the first occurrence of `link.text` in the answer, so keep it to the bare word (hi "बुकमार्क", ko "북마크"), not a clause.
- Invisible marks: in Git Bash `grep $'‌'` does not expand the escape; scan with node, e.g. `/[​-‏⁦-⁩]/`.
- Korean particles after a glossed label follow the Korean label's last syllable, not the English: "**JSON 내보내기**(Export JSON)를".
- Posts with several figures: collect every `<ThemedScreenshot` alt/darkAlt (match `[^>]*? alt=` since width/height may come first) and compare the list to `post.images`.
- A `` in a JS template literal written through a bash heredoc became a literal backspace byte (0x08) and silently broke a regex. Check edited scripts with `grep -c $''`, or write them with Write.
- Seed the verifier once with deliberate faults (missing bdi, changed cover, stray CJK bold) to prove it catches them.
