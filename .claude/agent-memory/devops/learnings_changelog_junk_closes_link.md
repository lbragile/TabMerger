---
name: changelog-junk-closes-link
description: Why release notes got ", closes [../X.md#y](...)" suffixes and how the parser config and PR template prevent it
metadata:
  type: reference
---

Squash merges put the PR description into the commit body. conventional-commits-parser treats any
`<text>#<word>` (word = `[\w-]+`, not only digits) as an issue reference, and the release-notes writer
renders every reference as ", closes [...]". A relative link such as `../ACCESSIBILITY.md#section` in the
PR template therefore became a bogus "closes" link on every entry (also seen once for `hi#density`).

Fix: `parserOpts.issuePrefixes: ["GH-"]` on the release-notes-generator in `.releaserc.json` (JSON cannot
hold a RegExp, and string prefixes are regex-escaped, so a numeric-only `#\d+` rule is impossible there;
an unused prefix disables body references). The `(#68)` link in the subject is added by the writer
independently and is kept. Also use absolute URLs in the PR template. Prove changes by calling
`generateNotes` from the plugin with a fake commit containing the template text.
