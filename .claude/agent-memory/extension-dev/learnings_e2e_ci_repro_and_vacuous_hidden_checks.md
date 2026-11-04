---
name: e2e-ci-repro-and-vacuous-hidden-checks
description: Extension e2e - a toHaveCount(0) on the header passes vacuously while a Radix dialog is open (aria-hidden), Settings saves are async so a reload must wait for Save to disable, and how to rebuild CI's exact e2e bundle on Windows
metadata:
  type: reference
---

**Vacuous "hidden" checks under an open dialog.** A Radix Dialog (Settings, any modal) sets
`aria-hidden` on everything outside it, so `getByRole(...)` finds nothing in the header while the
dialog is open. `expect(headerButton).toHaveCount(0)` then passes at once whatever the app did.
Close the dialog (`Escape`, then `expect(dialog).toBeHidden()`) before asserting something in the
header is gone. Same for `count()`-based `test.skip` checks: `count()` does not wait, so wait for a
header control to be visible first, or a slow (CPU-throttled) popup skips the test.

**Settings saves are async.** `handleSave` awaits the IndexedDB write before the cache updates, so
a `page.reload()` right after clicking Save can lose the write (CI started the reload 5 ms after the
click). Wait for `save` to be disabled (`isDirty` false = the write landed) before reloading.

**Reproducing CI's extension e2e build on Windows.** CI has no `.env*` files; the local package
does, and Vite/WXT read them even with a wrapper `envDir`. Windows cannot hold an empty env var, so
`VITE_SUPABASE_URL=` does not blank it either. What works: a wrapper config (see
[[shared-date-format-and-scratch-extension-build]] in web-dev's notes) whose `vite()` spreads the
base one and adds `define` entries `import.meta.env.VITE_X: 'undefined'` for every file-provided
key (and the CI values for the rest). Proof it matches: the popup chunk's content hash equals the
one in the CI trace's network log. The CI image (`mcr.microsoft.com/playwright:<ver>-noble`) runs
the specs on Linux: copy `e2e/` minus `kbdPopup.ts`/`repro/` into a scratch folder with only
`@playwright/test` installed, mount the build, `--cpus=2` and `TM_E2E_CPU_THROTTLE` for a slow runner.

**Reading a CI failure without a repro.** The report artifact holds `trace.zip`; its
`0-trace.trace` is JSON lines: `before`/`after` events give per-action timing, `frame-snapshot`
holds the DOM (diff-encoded; an 8-byte snapshot means unchanged), `0-trace.network` the requests.
A missing toast or a still-enabled Save in the snapshot right before a reload shows the save had
not finished.

Related: [[analytics-e2e-test-guard]], [[radix-nested-dialog-escape-race]].
