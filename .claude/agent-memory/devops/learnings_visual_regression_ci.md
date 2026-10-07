---
name: learnings-visual-regression-ci
description: How the informational extension visual-regression job and the manual Linux-baseline workflow are built, and the gotchas behind their design
metadata:
  type: reference
---

- Decision: the extension `@visual` spec runs in `ci.yml` as `visual-regression`, informational only (job-level `continue-on-error`, in no `needs:` list, not a required check) so it can never delay a release or deploy. The web visual spec stays local-only.
- Baselines are platform-suffixed (`-linux.png` vs `-win32.png`); CI only reads Linux ones. The job ends green with a notice while none exist. `.github/workflows/visual-baselines.yml` (manual, read-only token) regenerates them in the same Playwright container image and uploads them as an artifact; it never commits (rulesets require a PR).
- The container image tag appears in `ci.yml` (e2e jobs, visual job) and `visual-baselines.yml`; both visual paths check that all equal the lockfile's Playwright version. Bump them together.
- Gotchas:
  - A `::warning::` line piped through `tee | grep` never reaches the runner; print workflow commands straight to stdout and write the summary to `$GITHUB_STEP_SUMMARY` separately.
  - `upload-artifact` roots a single glob path at its non-wildcard prefix; to keep repo-root-relative paths, copy files with `cp --parents` into a staging dir and upload that dir.
  - Put the step that can fail on `continue-on-error` as well as the job, so report/summary steps still run after a failing comparison.
  - Pass free-text dispatch inputs through `env:`, never inline in the script.
- Runner or image updates can shift font rendering by a pixel; the fix is re-running the baselines workflow. See `docs/VISUAL_REGRESSION.md`.
