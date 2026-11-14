---
name: release-checklist
description: Cut a TabMerger release — version bump, changelog, store zips, web deploy. User-invoked only.
disable-model-invocation: true
---

# Release checklist

Run in order. Stop and report if any step fails — do not skip ahead.

1. **Clean tree**: `git status` — must be clean on `master` (or confirm with user if not).
2. **Quality gates**: `pnpm lint && pnpm type-check && pnpm test`
3. **Secrets scan**: `pnpm scan-secrets`
   - **IndexedDB version**: `DB_VERSION` in `packages/extension/src/lib/localDb.ts` must never be lower than in any build that already shipped (stable or beta) — confirm it hasn't gone down. A device whose database is at version N can't open it at a lower version (`VersionError`); `getDb` falls back to opening it without an upgrade so data stays readable, but stores added later are never created. If a version bump must be reverted after it shipped, keep the number and leave the new store unused. After a new version ships, raise `SHIPPED_DB_VERSION_FLOOR` in `src/__tests__/unit/lib/localDbVersion.test.ts` to match.
4. **Extension E2E**: `pnpm --filter @tabmerger/extension test:e2e`
5. **Web E2E**: `pnpm test:e2e`
6. **Version bump**: confirm the new version with the user (semver — ask which bump: patch/minor/major), then let `semantic-release` (already configured via commitlint/changelog) handle changelog + tag. On a stable release branch, `semantic-release` also writes that version into the root `package.json` and `packages/extension/package.json` itself (via `scripts/set-release-version.mjs`, an `@semantic-release/exec` `prepareCmd`) — do not hand-bump either file; the git tag is still what `publish.yml` actually reads.
7. **Build store zips**: `pnpm zip` — verify `packages/extension/.output/` has Chrome/Firefox/Edge zips.
8. **Web deploy**: confirm with the user before triggering — this is a shared/production action. Point to the `devops` agent or `.github/workflows/deploy-web.yml` / `vercel:deploy` skill.
9. **Store publish**: confirm with the user before running `.github/workflows/publish.yml` or manual store upload — irreversible, visible to end users.

Steps 8–9 are high-blast-radius (visible to real users) — always get explicit confirmation before triggering, never assume prior approval covers this run.
