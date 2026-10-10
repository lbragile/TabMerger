---
name: e2e-codeql-sanitizers
description: escapeHtml / jsLiteral / startTitleServer in e2e/helpers.ts for CodeQL-clean harness code, plus the unicode-escape authoring gotcha
metadata:
  type: reference
---

`packages/extension/e2e/helpers.ts` holds three shared pieces for the Playwright harness:

- `escapeHtml(text)` — a plain `.replace` chain (`&` first). Use it for any loopback server that
  writes a request-derived value into HTML. The chain shape is what CodeQL's `js/reflected-xss`
  recognises as a sanitizer.
- `jsLiteral(value)` — `JSON.stringify` plus `\uXXXX` escapes for `<`, `>`, `/`, U+2028, U+2029.
  Use it instead of bare `JSON.stringify` when splicing a value into a JS source string that is
  evaluated in the page over CDP (`js/bad-code-sanitization`). Identical output for plain names.
- `startTitleServer()` — loopback server whose page title is the last URL path segment (returns
  `{ base, close }`). Distinct from `startFixtureServer(title)`, which serves one fixed title
  (returns `{ url, close }`).

Authoring gotcha: a six-character unicode escape for U+2028 / U+2029 typed into an edit or a
heredoc can arrive in the file as the raw line-separator character, which terminates a regex or
string literal ("Unterminated regular expression literal"). Check the bytes (`cat -A`) after
writing such escapes, and build them in a script from `String.fromCharCode(92) + 'u2028'` if
they were decoded.

How to verify harness-only changes: `e2e/` is outside the package `tsconfig.json` include and
the ESLint config, so the PostToolUse hooks say nothing about it. Run
`npx tsc --noEmit -p e2e/tsconfig.json --lib ESNext,DOM,DOM.Iterable --types node,chrome` and
compare against the errors that were already there, then run the affected specs.
