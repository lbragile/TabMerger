# DevOps Agent Learnings — semantic-release, CI gates, dependency upgrades

## semantic-release in a pnpm monorepo

- `commitlint` config can live in root `package.json` under a `"commitlint"` key — no separate `.commitlintrc.json` needed. Root `package.json` already had this; the only gap was the missing `@commitlint/cli` + `@commitlint/config-conventional` devDependencies.
- `.husky/commit-msg` runs `pnpm commitlint --edit "$1"` — this works without `npx` as long as `@commitlint/cli` is installed at the workspace root (`pnpm add -w -D`).
- `semantic-release` `release` job in CI must use `fetch-depth: 0` on checkout — it needs the full git history to find the previous tag and compute the next version.
- `persist-credentials: false` on checkout is required so semantic-release can push the changelog commit back using its own GitHub token (otherwise the default GITHUB_TOKEN credential conflicts).
- The `[skip ci]` trailer in the release commit message (set in `.releaserc.json` `@semantic-release/git` message) prevents the changelog commit from re-triggering the workflow and looping.
- `GH_TOKEN` and `GITHUB_TOKEN` both need to be set to `secrets.GITHUB_TOKEN` — `@semantic-release/github` reads `GH_TOKEN`, the git push uses `GITHUB_TOKEN`.
- Required workflow permissions: `contents: write` (push changelog + create release), `issues: write` and `pull-requests: write` (semantic-release comments on merged PRs/issues).
- The `release` job should `needs: [scan-secrets, type-check, lint, unit-tests]` and have `if: github.ref == 'refs/heads/master' && github.event_name == 'push'` — build jobs are omitted from `needs` to keep release fast; they run in parallel on the same push.
- Plugin order in `.releaserc.json` matters: `commit-analyzer` → `release-notes-generator` → `changelog` → `git` → `github`. The `git` plugin must come before `github` so the changelog is committed before the GitHub release is created.

## Major dependency upgrade decision matrix (July 2026)

When running `pnpm outdated -r` and considering major upgrades, the ecosystem blockers to check first:

- **TypeScript 7** — tagged `latest` on npm (7.0.2) but `@typescript-eslint@8.x` only supports `<6.1.0`. Skip TS7 until `@typescript-eslint` adds support. (Confirmed: `rc-v6: 7.0.0-alpha.0` exists but not stable.)
- **ESLint 10** — `eslint-plugin-react@7.37.5` tops out at `^9.7`. Skip ESLint 10 until plugin catches up. `eslint-plugin-react-hooks@7.1.1` supports both 9 and 10.
- **`@vitejs/plugin-react@6`** — requires Vite 8. WXT 0.20 uses Vite 6.x. Stay on `@vitejs/plugin-react@5`.
- **Tailwind 4** — uses CSS-based config instead of `tailwind.config.ts`. Skip if the project has tailwind.config.ts files (significant migration).
- **Next.js 16** — removed `next lint` command entirely. Must switch to direct `eslint .` with `eslint.config.js`. The `eslint-config-next@16` exports a flat config array directly (`require('eslint-config-next')`).
- **`@dnd-kit/sortable@10`** — still peers `@dnd-kit/core: '^6.3.0'`; safe to upgrade sortable while keeping core at 6.3.x.
- **Sentry v10** — `event.breadcrumbs` changed from `{ values?: Breadcrumb[] }` to `Breadcrumb[]` directly. Update any `.breadcrumbs.values.map()` calls to `.breadcrumbs.map()`. Also `beforeSend` must be typed as `(event: ErrorEvent, hint: EventHint) => ErrorEvent | null`, not `(event: Event) => Event`.
- **Stripe v22** — `subscription.current_period_end` moved from `Subscription` to `SubscriptionItem`. Access via `subscription.items.data[0]?.current_period_end`.
- **Lucide React v1** — `Chrome` icon removed. Use `Globe` as a replacement for browser/web context.

## react-hooks v7 new rules

`eslint-plugin-react-hooks@7` added `purity` and `set-state-in-effect` rules that didn't exist in v4. When writing ESLint flat config, only include `rules-of-hooks` and `exhaustive-deps` to match v4 behavior:
```js
'react-hooks/rules-of-hooks': 'error',
'react-hooks/exhaustive-deps': 'warn',
// do NOT spread reactHooksPlugin.configs.recommended.rules — it includes new strict rules
```

## ESLint flat config for extension (ESM package)

WXT extension packages have `"type": "module"` so `eslint.config.js` is ESM. Use `import` syntax:
```js
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
```
Do NOT use `typescript-eslint` (the convenience package) unless it's in direct deps — use the individual `@typescript-eslint/*` packages that are already devDependencies.

## Tailwind CSS 3 → 4 migration (pnpm monorepo)

- **Extension (WXT/Vite):** remove `autoprefixer`, `postcss`, `tailwindcss@3` devDeps; add `@tailwindcss/vite` + `tailwindcss@4`. Add `import tailwindcss from "@tailwindcss/vite"` in `wxt.config.ts` and include `tailwindcss()` in the Vite `plugins` array. Delete `postcss.config.js` and `tailwind.config.ts` entirely.
- **Web (Next.js):** remove `autoprefixer`, `tailwindcss@3`; add `@tailwindcss/postcss` + `tailwindcss@4`. Keep `postcss` (still needed). Update `postcss.config.js` to `{ plugins: { '@tailwindcss/postcss': {} } }`. Delete `tailwind.config.ts`.
- **CSS migration:** Replace `@tailwind base/components/utilities` with `@import "tailwindcss"`. Move shadcn color tokens into `@theme inline { --color-background: hsl(var(--background)); ... }` — the `inline` keyword is critical for dynamic CSS vars (dark mode) so Tailwind resolves them at use-time not build-time. Class-based dark mode needs `@custom-variant dark (&:where(.dark, .dark *));` (replaces `darkMode: ['class']` in config).
- **`tailwindcss-animate` in Tailwind 4:** Load via `@plugin "tailwindcss-animate"` directive in CSS instead of the `plugins` array. Move keyframes into CSS (not `@theme`).
- **Breaking class renames:** `shadow-sm` → `shadow-xs`, bare `shadow` → `shadow-sm`. Also `blur-sm` → `blur-xs`, bare `blur` → `blur-sm` (check usages). `ring-offset-*` utilities are removed in v4 — they become no-ops; visual impact is focus rings lose their white gap but components still work.
- **`darkMode: ['class']` in old config:** The `tailwind.config.ts` export is gone; the entire config is now CSS. Forgetting `@custom-variant dark` means `dark:` classes won't work.
- **Pre-existing build errors:** The Next.js `useSearchParams()` Suspense error at `/auth/sign-in` predates the Tailwind migration — confirmed by stashing all changes and running the same build. Don't chase Tailwind-unrelated errors after migration.

## CI gate design patterns

- `scripts/scan-secrets.sh` scans **staged files only** (`git diff --cached`) — it is designed for pre-commit hooks. In CI, scan the full repo with `git ls-files | xargs grep -lE <pattern>` instead. Do not run the shell script in CI directly.
- `pnpm audit --audit-level=high` as a non-blocking step: set `continue-on-error: true` on the job. This lets Renovate/Dependabot PRs land even when transitive advisories exist, while still surfacing the warning in the Actions UI.
- Branch protection hints belong as a comment block at the top of `ci.yml`, not in a separate doc file — this keeps the authoritative list next to the actual job names so it stays in sync.
- `dep-audit` does not need to be in the `release` job's `needs` list — it is informational, and blocking release on unresolvable transitive advisories is counterproductive.

## Bundle size budget

- WXT builds output to `packages/extension/.output/chrome-mv3/` for Chrome MV3. Use `du -sb <dir> | cut -f1` in CI for a byte count — no plugin needed.
- Add the size check as steps in the existing `build-extension` job rather than a new job; saves a full runner spin-up and the build artifact is already there.
- `rollup-plugin-visualizer` must be a devDependency in `packages/extension/package.json`. Gate it with `process.env.ANALYZE` in `wxt.config.ts` so it is never loaded in normal dev or CI builds.
- WXT's `vite` config key is a function `() => ({...})` — plugins go inside the returned object, not as top-level wxt config.

## Beta channel rollout (Sept 2026) — semantic-release dry-run trap confirmed real

- **The zero-tags → `1.0.0` trap is real, not theoretical.** Ran `npx semantic-release --dry-run` on this repo (0 tags, 463 unreleased commits, `.releaserc.json` branches fixed to `["main", {name:"beta",prerelease:true}]`): commit-analyzer said "minor release" but the actual computed version was **`1.0.0`** ("There is no previous release, the next release version is 1.0.0"). semantic-release always anchors an unreleased repo's first release at `1.0.0` regardless of the analyzed bump type — always verify this with a real dry-run before trusting a written prediction, the bump-type reasoning alone doesn't tell you the first-release floor behavior.
- **`--dry-run --no-ci` still makes a real network call to GitHub** via `@semantic-release/github`'s `verifyConditions` (token validation), even in dry-run — it does NOT skip network auth checks. To see just the computed version without a real/valid `GH_TOKEN`, temporarily point `-e <path>` at a scratch config containing only `branches` + `commit-analyzer`/`release-notes-generator` (no `git`/`github`/`changelog` plugins) — but note `-e` **merges/extends** on top of any `.releaserc.json` still present via cosmiconfig, it does not replace it. You must `mv .releaserc.json .releaserc.json.bak` (and restore it after) for `-e` to be the sole source of plugins.
- **Branch config resolves silently** — there's no explicit "branch config OK" log line; success is just the absence of the "branch not configured to publish" error and a normal `Run automated release from branch <name>` info line.

## chrome-webstore-upload-cli v4 — CLI surface changed from what most docs/examples show

Verified against the actual version `pnpm dlx` resolves (**4.0.1**, matches what CI's unpinned `pnpm dlx chrome-webstore-upload-cli` would also resolve) by reading `source/cli.js` and `source/config.js` directly:

- **`--auto-publish` does not exist as a flag, in any version.** Auto-publish (upload + publish in one call) is triggered by omitting the `upload`/`publish` subcommand entirely — i.e. run `chrome-webstore-upload-cli --source ... --extension-id ...` with no leading command. `config.js`: `autoPublish: !command`. Any workflow snippet using `chrome-webstore-upload-cli upload --auto-publish` will just silently upload-only (meow parses the unknown flag but it does nothing), NOT publish — this is worse than an error because it fails silently.
- **`--client-id`, `--client-secret`, `--refresh-token` CLI flags throw a hard error in v4**: `"The --client-id, --client-secret, and --refresh-token flags are no longer supported. Please use the CLIENT_ID, CLIENT_SECRET, and REFRESH_TOKEN environment variables instead."` (source: `config.js` line 6-8, referencing fregante/chrome-webstore-upload-cli#80). These must be passed as job/step `env:`, not `--flag` args. `publish.yml`'s `publish-chrome` job once used the old `--client-id`/`--client-secret`/`--refresh-token` flags and would have hard-failed on its first run; it now passes the credentials as step `env:` (fixed). Watch for the old flags in any copied snippet.
- `--extension-id` and `--publisher-id` flags still work fine (meow auto-camelCases `--extension-id` → `flags.extensionId`, read directly in `config.js`, no deprecation).
- `--source` flag still works and is upload-only (throws if combined with the `publish` subcommand).

## MV3 manifest version can't just read package.json in this repo

- `package.json`'s `version` field is **not** the release source of truth here (no `@semantic-release/npm` plugin in `.releaserc.json` — confirmed by reading the plugin list; nothing ever bumps it). The actual released version only ever exists as a git tag, extracted in `publish.yml`'s existing `build` job via `echo "version=${GITHUB_REF_NAME#v}"`. Any manifest-version-from-package.json approach would silently ship a stale/wrong version.
- Built `packages/extension/scripts/manifestVersion.ts` (`resolveManifestVersion`) instead: pure function mapping `"2.2.0-beta.3"` → `{version:"2.2.0.3", version_name:"2.2.0-beta.3"}`, stable `"2.2.0"` → `{version:"2.2.0"}` (no `version_name`). Wired into `wxt.config.ts`'s `manifest()` via `process.env.TABMERGER_MANIFEST_VERSION ?? pkg.version` (new env var CI's blocked-from-agent-edit `build` job must export from the tag before `wxt zip`; local/dev builds fall back to `package.json`, which is fine since nothing downstream reads manifest.version for those).
- Placed the module + its test under `packages/extension/scripts/` (not `src/`) specifically to stay out of `extension-dev`'s domain and the 80%-coverage src gate — it's build-tooling logic, not app logic. Had to add `'scripts/**/*.{test,spec}.{ts,tsx}'` to `vitest.config.ts`'s `test.include` (left `coverage.include` untouched at `src/**` on purpose) to get it picked up by `pnpm --filter @tabmerger/extension test`.
- Verified end-to-end with a real `wxt zip -b chrome --mode beta` (not just unit tests): `TABMERGER_MANIFEST_VERSION="2.2.0-beta.3" pnpm wxt zip -b chrome --mode beta` produced a manifest.json with exactly `version: "2.2.0.3"` / `version_name: "2.2.0-beta.3"`, confirming the wiring (env var → resolveManifestVersion → manifest fields) actually works through WXT's real build pipeline, not just in isolation.
- The pre-existing hardcoded `version: "3.0.0"` in `wxt.config.ts` (disagreeing with `package.json`'s `2.0.0`) was dead/arbitrary — nothing referenced it as a source of truth; safe to remove.

## Vercel monorepo Root Directory

- The Vercel *project name* (`tabmerger`, shown by `vercel project ls`/`inspect`) does not have to match `.vercel/project.json`'s cached `projectName` field (`web`) — they can drift; always resolve by `projectId`, and use the actual project name for `vercel project inspect <name>`.
- `vercel project inspect <name>` shows the live **Root Directory** setting — check this first whenever a monorepo deploy fails with "No Next.js version detected" or module-not-found errors that don't reproduce locally. A Root Directory of `.` (repo root) instead of `packages/web` causes exactly this: `next build` never even sees `packages/web/package.json`, and `vercel.json`/`next.config.ts` monorepo workarounds inside `packages/web` are silently never read (Vercel reads `vercel.json` relative to Root Directory, not repo root).
- **Root Directory is not editable via `vercel project update` in CLI 57.0.0** — that subcommand only has `--build-command`, `--dev-command`, `--install-command`, `--output-directory`, `--framework`. Changing Root Directory requires the dashboard (Project → Settings → General → Root Directory). **Never fix this by extracting the CLI's stored auth token and hitting the REST API directly** — that's an unreviewed production config change made with credentials the agent wasn't given for that purpose. Diagnose and report the exact dashboard field/value needed, then stop and let a maintainer make the change.
- When a "Module not found" Turbopack error appears only in a cached Vercel build (not `--force`) after a `pnpm-workspace.yaml` overrides change, don't assume the lockfile/override change is the culprit until you've ruled out Root Directory — reproduce locally first with `rm -rf node_modules && pnpm install --frozen-lockfile && npx next build` from the actual package dir; if that succeeds, the overrides are fine and the failure is Vercel-project-config-side.
- `pnpm --filter <pkg> build` can itself invoke a `pnpm install` deps-status recheck that hard-fails (exit 1, non-interactive) on an ignored build script (e.g. `msw`) even when the script isn't needed for the build — this is a local/CI wrapper quirk, not a Vercel issue. Bypass by running `npx next build` (or the framework build binary) directly in the package dir when reproducing locally, since Vercel's own build step doesn't go through `pnpm run build`.
- Separate from Root Directory: bumping `@types/node` to a very new major (e.g. `^26.x`, "keep deps at latest stable" policy) can break `next build`'s built-in `tsc` type-check step on unrelated files (seen: `http.request`'s `autoSelectFamily` option missing from `RequestOptions`, tuple/spread typing changes in test files) even though `pnpm type-check` (`tsc --noEmit`) uses the same tsconfig and would show the same errors — this is dependency-version debt, not a deploy-config issue; route it to `web-dev`/`test-writer`, don't fix TS app-code errors from the devops agent.

## Sept 2026 security-patch pass — confirms the unbounded-override trap is a recurring pattern, not a one-off

- `fast-uri: '>=3.1.5'` (pre-existing, unbounded) was the *same bug class* as the `brace-expansion` outage documented above, just not yet triggered: it "achieved" a floor but pnpm still resolved to whatever satisfied it across the whole graph, which happened to be 4.1.2 — inside the vulnerable `>=4.0.0 <4.1.3` range for four separate GHSAs (SSRF/host-confusion). An unbounded floor override doesn't just risk crossing a major, it can also silently *fail to reach the patched version* within the same major if something resolves it lower than expected. Fixed the same way as brace-expansion: `fast-uri@4: '^4.1.3'` (scoped-major, bounded). Verified only major 4 exists in this tree (`ls node_modules/.pnpm | grep '^fast-uri@'` and grepping all `node_modules/.pnpm/*/node_modules/*/package.json` for declared `"fast-uri"` ranges) before scoping — if a future dep declares `^3.x` or `^1.x`, this override correctly leaves it alone.
- General rule now: **any bare (non-`@major`-scoped) override in `pnpm-workspace.yaml` using `>=` is a latent instance of this bug**, whether or not it has caused a visible break yet. When touching overrides for any reason, check every existing bare `>=` entry against `ls node_modules/.pnpm | grep '^<pkg>@'` — if only one major is present, still prefer scoping it (`pkg@N: '^N.x.y'`) as a defensive measure, not just as a reactive fix.
- `next`/other **direct** dependencies (declared in a workspace package's own `package.json`, not just present transitively) must be bumped there, not via `overrides:` — overrides only rewrite transitive resolution, they don't change what a workspace package's own manifest declares, so `pnpm outdated`/Dependabot will keep flagging it and a fresh `pnpm install --frozen-lockfile` elsewhere could still resolve the old range if the override were ever removed. Checked the matching `dependabot/npm_and_yarn/next-16.3.3` branch before bumping — it only changed the version string in `package.json`/`packages/web/package.json` (no other diffs), confirming a plain version bump was sufficient and safe to replicate directly rather than merging the (stale, based on an older commit) branch.
- `minimumReleaseAgeExclude` only gates versions younger than the policy's age threshold — adding the exact patched version (e.g. `next@16.3.3`) to the list doesn't pin the resolution to it. `pnpm install` after the override/bump resolved to `next@16.3.5` (newer, but old enough to not need explicit exclusion) without complaint. Don't assume the list entry you add is the version that ends up in the lockfile; always verify what actually resolved.
- **The `.pnpm` store keeps stale entries around after `pnpm install`** (e.g. `sharp@0.35.3` and `sharp@0.35.4` both present under `node_modules/.pnpm/` after bumping). `ls node_modules/.pnpm | grep '^<pkg>@'` is *not* proof a vulnerable version is still reachable — it's an unpruned local cache. Use `pnpm why <pkg>` (reads the actual lockfile/resolution graph) or `pnpm audit` itself as the source of truth for what's really in use, not directory listings of the store.

## Sept 2026 minutes-reduction pass (ci.yml/publish.yml/deploy-web.yml consolidation)

- **Actions Node-24 major versions, verified by reading each tag's `action.yml` `runs.using` directly** (don't trust WebFetch summaries of release pages here — they gave inconsistent/wrong answers for the same question across repos): `actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7`, `actions/download-artifact@v8`, `actions/cache@v6`, `pnpm/action-setup@v6` all report `runs.using: node24`. Fetch via `curl -s https://raw.githubusercontent.com/<owner>/<repo>/<tag>/action.yml | grep -A1 '^runs:'` — fast, authoritative, no summarization noise.
- **`dawidd6/action-download-artifact` uses its own versioning scheme, not semver majors matching upstream** — latest is `v25` (not `v6`/`v7`); check `releases/latest` via the GitHub API rather than guessing a small major bump.
- **A job that calls a reusable workflow via `uses:` cannot have `timeout-minutes`** — actionlint hard-errors: "only following keys are allowed: name, uses, with, secrets, needs, if, permissions". Put the timeout on the *called* workflow's own job instead (e.g. `deploy-web.yml`'s `preview` job), not on the caller job in `ci.yml`.
- **`actions/checkout@v6+` changed where `persist-credentials`/`token` writes the credential** — from directly in `.git/config` as an `http.extraheader` (v4/v5 behavior) to a separate file under `$RUNNER_TEMP`, referenced via git's `includeIf`. This is transparent to any subsequent `git` command (including semantic-release's) — no config/logic changes needed — but the *comment* explaining the release job's checkout `token:` line was written against the old mechanism and needed updating so it doesn't describe a now-wrong internal detail as current behavior.
- **actionlint** is not on npm under that name (`npx actionlint` 404s) — it's a Go binary; download the platform zip/tarball directly from `https://api.github.com/repos/rhysd/actionlint/releases/latest` (resolve the real tag first, don't guess a version string) and run the extracted binary directly against the workflow files.
- **Folding `coverage-delta` into `unit-tests`** (same job, coverage tests already produced the `coverage-summary.json` files on disk) removes the need for the same-run `upload-artifact`/`download-artifact` round trip entirely — only the cross-run baseline (`dawidd6/action-download-artifact`, reads a *different* workflow run) still needs a real artifact fetch. Don't keep an unnecessary same-run upload "just in case" once nothing else in that run downloads it.
- **Workflow-level `concurrency` with a ref-conditional `cancel-in-progress`** (`cancel-in-progress: ${{ github.ref != 'refs/heads/beta' }}`) coexists fine with a job-level `concurrency` block on a specific job (e.g. `release-${{ github.ref }}`, `cancel-in-progress: false`) — GitHub applies both; the job-level one there was already `false` and remains the actual protection for that job, the workflow-level one just stops it from being true by default everywhere else. No conflict to resolve, but worth calling out explicitly in a comment so a future reader doesn't think one makes the other redundant.
- **`paths-ignore` on `push`/`pull_request` skips the ENTIRE workflow run** (no jobs execute at all, not even ones with their own path-diffing logic) when every changed file matches — this is coarser than a job's own diff-based skip (e.g. this repo's `web-changes` job). They don't conflict: `paths-ignore` only fires on doc/agent-memory-only changes (a strict subset that would never need `web-changes` to run anyway), and any push touching real code still runs everything as before.
- **Chrome/Firefox/Edge store-publish `npx --yes chrome-webstore-upload-cli@4` / `web-ext sign` steps in `publish.yml` should NOT be bumped to node24-runtime actions** — those are npm packages run via `npx` on the runner's own preinstalled Node, unrelated to `runs.using` in any `action.yml`; only the `uses:`-referenced GitHub Actions (checkout/setup-node/upload-artifact/download-artifact) needed the version bump.
