---
name: release-notes-scope-filter
description: How internal scopes are kept out of release notes/CHANGELOG without a new dependency, and why the conventionalcommits preset does not work here
metadata:
  type: reference
---

- Decision: internal scopes are hidden from notes through `parserOpts.headerPattern` of `@semantic-release/release-notes-generator` in `.releaserc.json` (negative lookahead on the scope list). A header that does not match gets `type: null`, and the angular preset's transform drops it. The angular preset stays, so headings and links are byte-identical, which `packages/web/lib/changelog.ts` depends on.
- `conventional-changelog-conventionalcommits@10.x` (only present transitively via commitlint) is incompatible with the plugin's `conventional-changelog-writer@8.4`: it emits only the version header and no entries. The plugin's own devDependency pin is 9.x, not installed. A scoped `types` approach would also need a declared dependency and a lockfile change.
- Breaking changes in a hidden scope are not dropped (notes survive the parse), but print as one ungrouped bullet under the version heading plus an unscoped entry under "BREAKING CHANGES". `feat(a,b)` multi-scope headers are not hidden.
- The plugin resolves presets from its own pnpm location (hoisted `.pnpm/node_modules`) then from cwd, so an undeclared preset can resolve locally yet be fragile.
- Proof method: import the plugin's `generateNotes` by file URL with a fake context (`commits`, `lastRelease.gitTag`, `nextRelease`, `options.repositoryUrl`) and diff old vs new config output. Commit-analyzer decisions can be compared the same way via `analyzeCommits`.
