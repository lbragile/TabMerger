# Visual regression (extension popup)

Playwright screenshot comparison for the extension popup: the `@visual`-tagged spec
`packages/extension/e2e/tests/visual.spec.ts` (`toHaveScreenshot()`), with baselines in
`packages/extension/e2e/tests/visual.spec.ts-snapshots/`.

## What CI does

The `visual-regression` job in `.github/workflows/ci.yml` compares the popup against the committed
**Linux** baselines (`*-linux.png`), in the same Playwright container image as the e2e jobs. It is
**informational**:

- It is not a required status check and is in no `needs:` list, so it can never block or delay a
  merge, a release or a deploy. Job-level `continue-on-error` keeps the run green when it fails.
- A difference shows up as a warning annotation, a job summary (how many screenshots differ) and a
  `visual-regression-report` artifact (HTML report with expected, actual and diff images, kept 3 days).
- It does nothing (green, with a notice) until at least one `*-linux.png` baseline is committed.
- It is skipped when only `packages/web/`, `packages/demo/`, `supabase/`, `docs/`, agent files or
  markdown changed.
- Only the **extension** spec runs in CI. The web app's visual spec (`packages/web/e2e/visual.spec.ts`)
  is local-only.

## Baselines are per platform

Playwright suffixes baselines with the platform (`-win32.png`, `-linux.png`), and fonts render
differently on each. The `-win32.png` files are for local runs on Windows only; CI only reads
`-linux.png`. Never generate Linux baselines locally on Windows.

## Generate or update the Linux baselines

The **Visual baselines** workflow (`.github/workflows/visual-baselines.yml`, manual) regenerates them
on a GitHub runner using the CI image. It never commits anything.

1. Run it on the branch you want baselines for (Actions tab, "Visual baselines", "Run workflow",
   pick the branch; or `gh workflow run visual-baselines.yml --ref <branch>`). The optional `grep`
   input limits it to matching tests of `visual.spec.ts`; leave it empty for all `@visual` tests.
2. Download the artifact into a checkout of that branch (the run summary prints the exact command):

   ```bash
   gh run download <run-id> -n visual-baselines-linux -D .
   ```

3. Review the new or changed PNGs, then commit and push them in a PR:

   ```bash
   git add packages/extension/e2e/tests/visual.spec.ts-snapshots/*-linux.png
   git commit -m "test(extension): update the Linux visual baselines"
   ```

Re-run it whenever the popup's look changes on purpose, when a test is added to the spec, or when the
informational check reports small diffs everywhere without a code change (a GitHub runner or
Playwright image update can shift font rendering). Keep the Playwright image tag in `ci.yml`,
`visual-baselines.yml` and `@playwright/test` identical; both workflows check this.

## Run locally

```bash
pnpm --filter @tabmerger/extension build
pnpm --filter @tabmerger/extension test:visual                           # compare
pnpm --filter @tabmerger/extension test:visual --update-snapshots        # refresh local baselines
```
