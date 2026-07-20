# DevOps Agent Learnings

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
