---
name: changelog-md-parsing
description: How to parse semantic-release's generated CHANGELOG.md (conventional-changelog-angular preset) at build time in the web changelog page, and how the repo-root file path resolves from packages/web
metadata:
  type: project
---

`packages/web/app/(marketing)/changelog/page.tsx` reads the repo-root `CHANGELOG.md`
(owned by `@semantic-release/changelog`, which the release pipeline runs on every release) via `packages/web/lib/changelog.ts`'s `getGeneratedChangelog()`, instead of hand-maintaining
a `ChangeEntry[]` literal. Pre-automation history stays in a frozen `LEGACY_CHANGELOG` constant
in the page file, rendered after the generated entries.

**Path resolution:** Next.js runs `packages/web`'s build with `process.cwd()` at `packages/web`
itself, not the monorepo root — confirmed by `next.config.ts`'s own Turbopack `root:
path.resolve(process.cwd(), '../..')` workaround (comment: "Turbopack looks for next/package.json
from the workspace root... Point to the repo root"). `lib/changelog.ts` reuses the exact same
`path.resolve(process.cwd(), '../..', 'CHANGELOG.md')` pattern rather than guessing a different
assumption. `CHANGELOG.md` not existing yet (semantic-release has never run in this repo) must
resolve to `[]`, not throw — only re-throw on non-ENOENT `fs.readFileSync` errors.

**Format `@semantic-release/release-notes-generator` produces (default `conventional-changelog-angular`
preset — `.releaserc.json` doesn't override it):**
- Release heading is `# [x.y.z](compareUrl) (yyyy-mm-dd)` for major/minor bumps, `##` (h2) for
  patch-only bumps (`isPatch` flips the heading level in `conventional-changelog-angular`'s
  `writer.js` `headerPartial`) — the parser must accept both `#` and `##`, never assume one.
  Date is always `yyyy-mm-dd` (`conventional-changelog-writer`'s `formatDate` hardcodes this).
- Section headings are h3 (`### Features`, `### Bug Fixes`, `### Performance Improvements`,
  `### Reverts`, `### Code Refactoring`, plus docs/style/test/build/ci ones that never actually
  reach a release since commit-analyzer doesn't bump a version for those alone).
- Commit lines are `* **scope:** subject ([shortHash](commitUrl))` — note the bold wrapper is
  `**${scope}:**`, i.e. the colon is *inside* the bold markup already. A naive `'$1: '` replace
  after capturing the bold group double-colons the output ("popup:: text") — strip the trailing
  colon from the captured scope before re-adding one.

**Why the mapping table is small:** Features→New, Bug Fixes→Fixed, Performance/Reverts/Refactor→
Improved is deliberately exhaustive (a design decision of the release-channel work) — docs/style/test/build/ci commit types are left
unmapped on purpose because `@semantic-release/commit-analyzer`'s default (angular) rules never
bump a version for those alone, so they can't appear in a real release's notes; guessing a mapping
for them would be dead code.

**Testing:** mock `node:fs`'s `readFileSync` (via `vi.hoisted`) to unit-test `getGeneratedChangelog`'s
ENOENT-vs-real-error branch without touching the real filesystem. For the page component test, mock
only `getGeneratedChangelog` from `@/lib/changelog` (keep `parseChangelog` and types via
`importOriginal`) so page tests can inject arbitrary generated entries, while still exercising the
real parser end-to-end in a dedicated fixture-based test for prerelease filtering.

**Vercel/serverless file tracing for a runtime-computed fs path (real gap I missed on first pass,
caught by a reviewer):** `getGeneratedChangelog()` reads `CHANGELOG.md` via a *dynamically computed*
`path.resolve(process.cwd(), '../..', 'CHANGELOG.md')`, not a static string literal. Next's build-time
file tracer (`@vercel/nft`) only bundles files reachable through static analysis of imports/requires —
a runtime-resolved `fs.readFileSync` path is invisible to it. Without `outputFileTracingIncludes` in
`next.config.ts`, a route like this can build and pass every test locally while its *deployed* Vercel
function silently never has the file, permanently ENOENT-falling-back with no error anywhere. Fixed
with `outputFileTracingIncludes: { '/changelog': ['../../CHANGELOG.md'] } }`.

That include's glob resolves relative to the project directory (`packages/web`) and reaches OUTSIDE it
into the monorepo root — whether that's honored at all depends on where Next infers the file-tracing
root to be. Without an explicit `outputFileTracingRoot`, Next infers one (usually the pnpm workspace
root via the lockfile) and it happened to already work — but "probably works via inference" for a path
reaching outside the project directory is exactly the class of thing that fails silently in a different
environment. Set `outputFileTracingRoot: path.resolve(process.cwd(), '../..')` explicitly (mirrors the
existing `turbopack.root` workaround in the same file), and verify empirically by inspecting
`.next/server/app/(marketing)/changelog/page.js.nft.json` for the traced `CHANGELOG.md` path — don't
just trust that the config was accepted, since a wrong root fails without a build error.

**Memoize file reads on dynamic routes:** `/changelog` is dynamic (not statically generated) because
the shared marketing layout's `Navbar` calls the async Supabase server client (`cookies()`), which
forces every route sharing that layout into per-request SSR — this is pre-existing and affects every
marketing page, not something the changelog work introduced. That means a naive `fs.readFileSync` +
parse would re-run on every request. Memoize at module scope instead (`let cachedEntries: T[] |
undefined`); a warm serverless instance reuses the module across requests, and a redeploy always gets a
fresh instance/fresh cache, so there's no staleness risk. An empty array (`[]`, the ENOENT case) is
still truthy in JS, so `if (cachedEntries) return cachedEntries` correctly short-circuits on a cached
empty result too — no separate sentinel needed. Don't cache thrown (non-ENOENT) errors — let those
retry every call rather than pinning a transient failure for the instance's lifetime.
Testing a module-scope memo requires `vi.resetModules()` + a fresh `await import(...)` per test, or
every test after the first sees the first test's cached result.
