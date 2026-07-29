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
4. **Extension E2E**: `pnpm --filter @tabmerger/extension test:e2e`
5. **Web E2E**: `pnpm test:e2e`
6. **Version bump**: confirm the new version with the user (semver — ask which bump: patch/minor/major), then let `semantic-release` (already configured via commitlint/changelog) handle changelog + tag, OR bump manually if the user prefers — ask which.
7. **Build store zips**: `pnpm zip` — verify `packages/extension/.output/` has Chrome/Firefox/Edge zips.
8. **Web deploy**: confirm with the user before triggering — this is a shared/production action. Point to the `devops` agent or `.github/workflows/deploy-web.yml` / `vercel:deploy` skill.
9. **Store publish**: confirm with the user before running `.github/workflows/publish.yml` or manual store upload — irreversible, visible to end users.

Steps 8–9 are high-blast-radius (visible to real users) — always get explicit confirmation before triggering, never assume prior approval covers this run.
