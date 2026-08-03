---
name: visual-baseline-update
description: Regenerate Playwright visual regression baseline screenshots for the extension and web packages after an intentional UI change. User-invoked only.
disable-model-invocation: true
---

# Visual baseline update

The visual regression suite (`packages/extension/e2e/tests/visual.spec.ts`, `packages/web/e2e/visual.spec.ts`, both tagged `@visual`) diffs against committed baseline PNGs under `*-snapshots/` directories. Run this whenever a UI change is intentional and the visual regression job should stop flagging it as a diff.

**Critical gotcha**: Playwright namespaces snapshot filenames by OS (`-win32.png`, `-linux.png`, `-darwin.png` suffixes). Baselines generated locally on Windows will NOT satisfy a Linux CI runner, and vice versa — this repo's CI runs on `ubuntu-latest`. If you only regenerate locally on Windows, the CI `visual-regression` job will still fail until Linux baselines also exist and are committed. Options:
- Run this skill inside a Linux container/WSL for baselines that need to match CI exactly.
- Or trigger a one-off `workflow_dispatch` run of the CI visual job with `--update-snapshots` and commit the artifact it produces — check `ci.yml`'s `visual-regression` job for the exact commands it runs before improvising a different invocation.

1. **Confirm the change is intentional** — a failing visual test is a signal, not automatically a bug. Look at the diff output (`playwright-report/`) before regenerating, to avoid baking in an actual regression as the new baseline.

2. **Regenerate extension baselines**:
   ```bash
   pnpm --filter @tabmerger/extension build
   pnpm --filter @tabmerger/extension test:visual -- --update-snapshots
   ```

3. **Regenerate web baselines**:
   ```bash
   pnpm --filter @tabmerger/web test:visual -- --update-snapshots
   ```

4. **Review the diff before committing** — `git diff --stat` on the `*-snapshots/` directories should show only the PNGs actually expected to change. A large unexpected set of changed baselines usually means something environment-specific shifted (font rendering, a dependency bump) rather than the intended change — investigate before committing wholesale.

5. Commit the updated baseline PNGs alongside the code change that caused them, in the same PR — a baseline update with no accompanying explanation of what visually changed and why is hard to review later.
