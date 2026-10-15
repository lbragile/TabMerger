---
name: learnings-ci-matrix-gates
description: Matrix jobs vs required check names in ci.yml (aggregator gate jobs), single-source shard count, per-test Playwright sharding, artifact layout after splitting per package
metadata:
  type: reference
---

- Decision: matrix jobs (unit tests per package, extension e2e shards) are not required checks themselves. A tiny aggregator job (`unit-tests-gate` named "Unit Tests", `e2e-extension-gate` named "E2E Tests (Extension)") has `needs: <matrix>`, `if: always()` and fails unless `needs.<job>.result == 'success'`. Rulesets then keep stable names when the matrix is resized. `release` and `deploy-web-preview` keep `needs:` on the matrix jobs (a `needs` on a matrix waits for every leg and is skipped if any failed), not on the gates.
- Never job-level `if:`-skip a job that a required check or `release` waits on: a skipped required check counts as passing, and a skipped `needs` skips the dependents. The extension e2e shards skip through a gate step and still finish green, so the aggregator's `success` check is right.
- Shard count in one place: `strategy.job-total` (available in step expressions) gives the matrix size, so `--shard=${{ matrix.shard }}/${{ strategy.job-total }}` only needs the `shard: [1, 2, ...]` list edited.
- Playwright `--shard` hands out whole spec files unless `fullyParallel: true`; with one worker per runner that made shards 3:32 / 5:08 / 3:44. `fullyParallel: true` in `e2e/playwright.config.ts` balances by test. Files that need order opt back in with `test.describe.configure({ mode: 'serial' })` (`autoBackupFile.spec.ts` already does).
- Codecov `files:` input is a comma list; build it in a step (`find ... | sort | paste -sd, -`) instead of hard-coding shard files.
- Splitting an artifact per package changes its layout: one literal file path (`coverage-summary.json`) unpacks as the bare file name, so `coverage-delta.mjs` reads `baseline/coverage-summary.json`; two files in one folder unpack as bare names too (`codecov-unit-<pkg>/coverage-final.json`). The first run after a split finds no per-package baseline and soft-skips once.
- `actionlint` is not installed on dev machines here; run it with `docker run --rm -v <dir>:/repo -w /repo rhysd/actionlint:latest .github/workflows/ci.yml` (set `MSYS_NO_PATHCONV=1` under Git Bash).
- Workflow files are CRLF in the Windows working tree but LF in the index; build patches from `git show HEAD:<file>` vs an LF copy so `git apply --check` passes.
