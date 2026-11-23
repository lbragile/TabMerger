---
name: blog-translation-sync-script
description: Carrying an en.mdx edit into all 17 blog translations with one anchored node script; resolving @mdx-js/mdx from the pnpm store for the scratch compile check; quick parity checks
metadata:
  type: reference
---

**Diff first, then check what the locales already have.** `git diff <old> <new> -- .../en.mdx`
shows the English edit, but a translation may already contain part of it (the save-session
figure was already in every locale when a brief said it was new). `grep -n` each locale for the
new link slugs or components before writing anything.

**One script, anchored on structure, not on translated text.** Translated sentences differ per
locale, so find/replace on prose breaks. Anchors that hold in every locale:
`<QuickAnswer>` + 2 lines (the answer paragraph), `</QuickAnswer>` + blank + `<BrowserSwitcher`
(insert point for a new `<InstallCta>`), `<Section id="…">` + 2 lines (a section's first
paragraph), a bullet at a fixed offset inside a section, a line containing a code token such as
`about:addons`, and `</Section>` - 2 (a section's last paragraph). Assert each anchor matches
exactly once and its expected shape (blank line, next tag), refuse to run if the file already holds
a new slug (idempotency), keep per-locale strings in a separate data module, and do a `--dry` run
first. Join appended sentences with `''` for ja and zh-CN, `' '` otherwise; insert text before a
bullet's final `.`/`。`/`।` to keep it inside the sentence. Writing the script with the Write tool
avoids shell backslash mangling ([[windows-shell-edit-scripts]]); Persian ZWNJ and the U+200F after
the Persian comma go in as `‌`/`‏` constants.

**`@mdx-js/mdx` is not resolvable from `packages/web`.** It is only a transitive dependency of
`@next/mdx`, so `createRequire('<web>/package.json')` fails. Point `createRequire` at
`node_modules/.pnpm/@mdx-js+mdx@<ver>_…/node_modules/@mdx-js/mdx/package.json` (and remark-gfm the
same way); `ls node_modules/.pnpm | grep mdx-js` gives the folder name.

**Parity checks worth adding to that compile script:** the ordered list of internal `](/…)` links
must equal English's (proves no locale prefix and no dropped link), and a count of component tags
(`Kbd`, `Section`, `ThemedScreenshot`, `InstallCta`, …) must match. Line counts can differ by a
few lines between locales (the `post` header wraps differently), so don't use them as a check.

Related: [[localized-browser-ui-labels]], [[blog-mdx-turbopack]].
