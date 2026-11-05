---
name: build-time-generated-module
description: /changelog text is compiled in from CHANGELOG.md by scripts/generate-changelog.mjs (git-ignored generated/changelog.ts); where it runs (next.config, Vitest globalSetup, type-check), why .mjs, and local side effects of next dev (AGENTS.md rewrite)
metadata:
  type: reference
---

No runtime `fs` for page content: hosts without a filesystem (worker runtimes) fail silently
otherwise. `/changelog` imports `CHANGELOG_MARKDOWN` from the git-ignored
`packages/web/generated/changelog.ts`, written by `scripts/generate-changelog.mjs`.

- **Runs from three places:** top of `next.config.ts` (every `next dev`/`next build`, whatever
  command or CI wrapper starts Next), Vitest `globalSetup` (`vitest.global-setup.ts`), and the
  `type-check` script (`node scripts/generate-changelog.mjs && tsc --noEmit`; tsc needs the file).
  Lint doesn't need it (no import-resolution rule).
- **Fails loudly:** a missing CHANGELOG.md throws (fails the build); a missing generated module
  fails at the static import. Writes only when content changed, so `next dev` doesn't recompile.
- **Why `.mjs` with Node built-ins only:** Next 16 loads `next.config.ts` first by native
  `import()`, then falls back to SWC-to-CJS + `require`; a `.mjs` loads either way (Node 22.12+
  `require(esm)`, no top-level await). TS files import it with `allowJs`.
- Turbopack can also load raw text (`turbopack.rules` `type: 'text'`, 16.2+), but Vitest and tsc
  would each need their own shim, so a generated TS module is simpler.
- On Windows the generated string holds CRLF (checkout line endings); the parser splits on `\r?\n`.
- Tests: mock `@/generated/changelog` with a getter on a `vi.hoisted` object to vary the text
  and count reads; generator tests use `mkdtempSync` dirs and evaluate the emitted module.
- **Local side effect:** `next dev` regenerates `packages/web/AGENTS.md` (heading level
  changed `#` to `##`); put the tracked content back by hand with an edit after a dev run.

Related: [[changelog-md-parsing]], [[deployment-env-hub]].
