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
- Never fix the CJK bold trap by replacing `。**` with `**。` everywhere: it also moves opening markers (`しましょう。**何か月も**`) and breaks bold. Count `**` per line and fix only the closing ones.
- KeyFact text is free prose, so localized key names (fr "Maj") slip in; shortcuts there stay English like the `Kbd` keys.
- `vitest -t "<slug>/"` runs 15 tests per locale (14 for en); `--reporter=verbose | grep -o "<slug>/[a-zA-Z-]*" | sort | uniq -c` confirms every locale ran.
- Only `navTitle` and `shareSummary` have schema length limits; a long `seoTitle` passes silently.
- Don't `.trim()` data values: French keys that start right after a link (`](…) : …`) need their leading space. Strip only blank lines and trailing whitespace.
- Make every number cell a data key, even a bare `'3'`: fa uses Persian digits in table cells.
- Alts in JSX attributes can't hold ASCII `"`; where a language's body uses ASCII quotes (id, he), alts need “ ” or no quotes.

**Sidebar section headings are all-caps in the catalogs** (`sidePanel.archived`, `sessions`: "ARCHIVIERT", "ARŞİV"). For prose, generate sentence case with `toLocaleLowerCase(loc)` (handles Turkish İ) instead of copying the capitals or hand-typing.

**Plan names in tables and prose** come from `messages/<loc>/pricing.json` `tierNames` (a `{M:file.key}` token). he, hi, it and ru keep "Free" there, so "Gratis o Pro" would disagree with the pricing page.

- Verifier English-token checks must test names one by one, not a comma-joined list (ar writes "Design وBuild"); a keyFacts check must not assume every source label starts with "TabMerger 3" once source labels are translated.
- The "Sessions" name in normal case is the first quoted run in `tour.json`'s sessions body (trim it: fr has `« Sessions »`); check it against `sidePanel.sessions` ignoring case. id, pl, pt-BR and vi quote it in capitals there too.
- The restore confirm's Cancel is `modals.confirmDialog.cancel` (ConfirmDialog's default), not `common.cancel`.
- Convert real ZWNJ in fa drafts to `{z}` by script before generating rather than typing hundreds of tokens; then grep the output for `(^|s)می ` and ` ها ` to catch missing ones.
- Fact-token checks must accept inflected product names (pl "Firefoksa": match `Firefo`).

**Web-catalog token:** a `{W:file.key}` token pulls `messages/<loc>/pricing.json` `tierNames.free` and `compare.json` `states.yes`/`states.no` for ComparisonTable heads and Yes/No cells, so blog tables match /pricing and /compare.

- CJK labels ending in `…` (ja 後で通知…, zh 提醒我…, ko 알림 설정…): a closing `**` right before a particle or letter doesn't parse. Use ja `「**…**」`, a space after in ko, or punctuation/a gloss bracket right after.
- Korean particle after 내일 is 을 (ㄹ final). A symbolic N with a plural catalog label: use ar `_few`, ru/pl `_many`.
- RTL verifiers must accept ← in settings paths.

**RTL ComparisonTable cells** accept JSX: `<bdi dir="ltr">pattern</bdi>` for a pattern cell, a fragment `<>text <bdi dir="ltr">x</bdi></>` for a mixed cell. An unisolated pattern shows its trailing `/*` on the wrong side. The verifier should map `<bdi dir="ltr">X</bdi>` to `X` before comparing cells with English.

- Interpolated catalog strings ("{{used}}/{{max}}"): don't expand through a token; write the localized "3/3" by hand and let the verifier fill the placeholders.
- The data parser trims each value, stripping the first table row's indent: let the generator indent `*rows` keys itself.
- Declined product or place names (pl "Sintrze") break on-screen-name checks; quote the uninflected name instead.

**RTL auto-wrap in the generator:** wrap every Kbd combo and every code span in body keys (outside existing bdi runs), plus a `[[English]]` shorthand for glosses that is refused outside RTL; this removes hand-typed bdi, and the verifier confirms no Kbd or backtick is left outside one. A table slot `{{c:literal}}` can emit `'literal'` in LTR and `<bdi dir="ltr">literal</bdi>` in RTL.

- Number check regex: `n(?![0-9.])` misses "2." at a sentence end; use `(?![0-9]|.[0-9])`. Gloss checks must accept full-width `（…）` for ja/zh. ar/he dual forms ("يومين", "יומיים") replace the digit 2.
- In scratch scripts, `new URL(import.meta.url).pathname` keeps `%20` for paths with spaces; use `fileURLToPath`.

**Derive the English data from the template** instead of typing it: an `extract.mjs` turns `tpl.mdx` into a regex with one capture per slot, matches it against en.mdx and writes `data/en.txt`; `gen en` must then be byte-identical to en.mdx. This is the template check with no hand-copied English.

- The auto-save group name follows locale formatting (`toLocaleString(locale, {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"})`), so compute the example per locale in Node; fa comes out in the Persian calendar.
- Number match: use `(?![0-9]|[.:][0-9])` (plus a lookbehind) so a number before a sentence-ending full stop still matches. ja/zh glosses use full-width `（English）`, ko half-width with the particle after it.
- A translated "**Sentence.** Next" becomes `**…。**` in ja/zh; move the 。 outside the bold.

**Plural catalog token:** `{P:file.key:n}` picks `key_${new Intl.PluralRules(loc).select(n)}`, throws if that form is missing, and fills `{{count}}`, so labels with a count ("Restore 4 tabs") need no hand-picking (ru/pl/ar get `_few`).

- Hand-typed RLMs slip into he/ar data again and again (after "Pro:", before "US$"); scan every RTL data file with `/[​-‏⁦-⁩]/` before generating.
- Ad-hoc scans of CRLF output that split on `
}
` silently check nothing; normalise `
` first.
- Normalise full-width `（）` to `()` before checking English glosses in ja/zh.

**Prices and limits:** let the generator turn `{PM}`/`{PY}`/`{P0}` into placeholders and decide wrapping per slot: body text in RTL gets `<bdi dir="ltr">US$3.99</bdi>`, post fields and table cells the bare string. Verify each price appears exactly as often as in English, and that every number in each English data key appears in the translated key (convert Persian/Arabic digits first; extra numbers are only warnings since CJK writes number words as digits; allow only explicit dual words for 2).

- `tierNames.free` is "Free" in he, hi, it and ru, so blog tables and plan references there say "Free". Count Yes/No cells from English, not by hand.

- Dual plurals: for count 2, ar (`_two`) and he give forms with no digit ("استيراد مجموعتين؟"), so check labels built from the catalog, not for a "2".
- RTL ComparisonTable cells: a leading ".txt" or a Latin word next to a parenthesis is misplaced; start the cell with a native word ("ملف TXT من OneTab"). In RTL verifiers, strip `<bdi dir="ltr">…</bdi>` before rejecting →.
- Keep a whole bold imperative in one bold (hi/tr can split the verb and add a second bold, breaking the strong-count parity).

**Same-count bold mis-pairing:** a CJK bold like `**…閉じる。**こと` can pair with the next `**`, keeping the `<strong>` count and leaving no literal `**`, so the compile and count checks both miss it. Run a CommonMark flanking check over each `**X**` in the source: flag X ending in `p{P}`/`p{S}` with a letter right after, or starting with punctuation with a letter right before.

- Strip `{/* … */}` MDX comments before English-token checks; a comment can satisfy a gloss check when the gloss itself is gone.
- When a post reuses another post's figures and panels, a `{S:name}` token that extracts strings from the sibling's `<loc>.mdx` keeps alts, captions, browserFact and settings paths identical with no hand copying.
