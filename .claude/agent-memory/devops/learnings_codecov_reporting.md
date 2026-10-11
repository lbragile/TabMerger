---
name: learnings-codecov-reporting
description: How Codecov is wired into CI as reporting only (artifact hand-off to one OIDC job), and the artifact-layout and pnpm-argument gotchas behind it
metadata:
  type: reference
---

- Decision: Codecov is reporting only. Test jobs save their report files as one-day `codecov-*` artifacts; the separate `codecov` job in `ci.yml` downloads them and uploads with `codecov/codecov-action` (`report_type: test_results` for JUnit; `codecov/test-results-action` is deprecated). Nothing `needs:` that job, so a slow or failing Codecov cannot delay `release` or a deploy. See `docs/CODECOV.md`.
- OIDC (`use_oidc`, no token): `id-token: write` only on the `codecov` job, which runs no repository code. Fork PRs and Dependabot cannot mint an OIDC token, so `use_oidc` is computed false for them.
- Gotchas:
  - `upload-artifact` with several `path` entries roots the artifact at the least common ancestor of the **patterns** (not of the files found). `packages/extension/coverage/x` + `packages/web/coverage/y` unpack as `extension/coverage/x` and `web/coverage/y`, with no `packages/` level, even when only one of the files exists. Any step that reads the downloaded artifact must use that layout. A single literal file path unpacks as the bare file name.
  - `download-artifact` with `pattern:` and no `name:` puts each artifact in its own folder named after the artifact.
  - `pnpm --filter <pkg> <script> -- --flag` passes a literal `--` to the script; Vitest and Playwright then read the flag as a file filter. Append flags without `--`.
  - Vitest: `--reporter=junit` alone replaces the console reporter; pass `--reporter=default --reporter=junit --outputFile.junit=<file>`.
  - Playwright: adding `junit` on the command line with `--reporter` replaces the config's reporters. Add it in the config behind `PLAYWRIGHT_JUNIT_OUTPUT_NAME` instead; the file is written next to the config.
  - Guard each upload step with `hashFiles('<report>') != ''` so a skipped test job does not produce a failing upload.
