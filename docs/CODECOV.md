# Codecov (reporting only)

Codecov shows coverage trends and test results (Test Analytics) for `lbragile/TabMerger`. It is
**informational**: it never gates a merge, a release or a deploy. The real gates stay as they are:
the 80% Vitest thresholds and `scripts/ci/coverage-delta.mjs` (both in the `unit-tests` job of
`.github/workflows/ci.yml`).

## How it is wired

The test jobs do not talk to Codecov. Each one writes its report files and saves them as a
one-day artifact; a separate job, `codecov` ("Codecov (informational)"), downloads the artifacts
and uploads them with `codecov/codecov-action`.

| Test job | Artifact | Files | Codecov flag |
|---|---|---|---|
| `unit-tests` | `codecov-unit` | extension and web `coverage-final.json` | `extension`, `web` |
| `unit-tests` | `codecov-unit` | extension and web Vitest JUnit (`coverage/junit.xml`) | `unit-extension`, `unit-web` |
| `integration-tests` | `codecov-integration` | Vitest JUnit | `integration` |
| `e2e-extension` (each shard) | `codecov-e2e-extension-N` | Playwright JUnit | `e2e-extension` |
| `e2e-web` | `codecov-e2e-web` | Playwright JUnit | `e2e-web` |

Why a separate job: `release` and the deploys wait on the test jobs. An upload step inside them
would put a third-party service on the release path, where a slow or failing Codecov could delay
or fail a release. Nothing `needs` the `codecov` job, it is `continue-on-error` at job and step
level with `fail_ci_if_error: false`, and it must never become a required status check.
`codecov.yml` at the repo root makes every Codecov status `informational` and lists the ignored
paths, flags and components.

The job runs with `if: !cancelled()`, so the results of a failed test run are still reported. Each
upload step is skipped when its report file is missing (for example when a job was skipped).

## Authentication

OIDC, no token and no secret. `id-token: write` is granted to the `codecov` job only; that job
checks out the tree (Codecov maps report paths onto it) and runs the upload action, no repository
code. Fork PRs and Dependabot runs cannot get an OIDC token, so `use_oidc` is `false` for them:
they use Codecov's tokenless path for public repositories, and a refused upload only logs a
warning.

## Where the report files come from

- **Vitest** (unit, integration): extra flags on the CI commands,
  `--reporter=default --reporter=junit --outputFile.junit=<file>`.
- **Playwright** (both e2e suites): the configs add the `junit` reporter only when
  `PLAYWRIGHT_JUNIT_OUTPUT_NAME` is set, which only CI does. The file is written next to the config.

Local runs are unchanged and write no JUnit files (`junit-*.xml` is git-ignored in case you pass
the flags yourself).

## Reading the results

- **Coverage:** the Codecov commit/PR page, with the `extension` and `web` flags and the Extension,
  Web app and Shared components. The PR comment is condensed and appears only when coverage drops or
  the patch has uncovered lines.
- **Tests tab** (Test Analytics): per-test pass/fail history, flaky tests and slowest tests, split by
  flag.
- If something is missing, open the `codecov` job in the CI run: the "List reports" step prints
  every file it received, and each upload step logs Codecov's answer.

## Shared package

`packages/shared` tests are not run in CI, so Codecov has no coverage for the Shared component
until a CI step runs them.
