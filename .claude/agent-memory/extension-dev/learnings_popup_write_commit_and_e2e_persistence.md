---
name: learnings-popup-write-commit-and-e2e-persistence
description: Explicit IndexedDB commit for groups writes, where the time between a click and the commit goes, how to destroy a popup synchronously in e2e, the persistence-wait helper, and the TM_E2E_* switches for running e2e against the production-mode build
metadata:
  type: learning
---

Technique notes for `lib/localDb.ts` writes and the e2e suite.

**Explicit commit.** `writeGroupsState` calls `tx.commit()` in the same synchronous run as its last
request. With auto-commit the page has to stay alive for one more round trip (every request's
success event must come back before the browser is asked to commit), and a destroyed page aborts a
transaction whose commit was never requested. With the explicit request the write lands even when
the page is destroyed in the very next microtask. `await Promise.all([...requests, tx.done])` still
rejects on a failed request, so error handling is unchanged. fake-indexeddb 6 implements `commit()`.
A read does not wait for its read-only transaction's `complete` (`tx.done.catch(() => undefined)`):
that was one more round trip in front of every read-modify-write.

**Where the time goes** (click on Apply to commit requested, production-mode build, measured with
`e2e/repro/writeWindow.repro.ts`): the IndexedDB steps are the small part. The larger parts are the
main thread being busy with React's render of the click (TanStack calls `mutationFn` only after two
awaits, so React's sync render runs first) and the Web Lock grant, which is a task that waits behind
that work. Everything scales with CPU load, so a fixed sleep in a test is never a valid wait.

**e2e: wait for the store, not the screen.** `waitForStoredGroup(page, predicate, what)` /
`readStoredGroups(reader)` in `e2e/helpers.ts` poll IndexedDB through their own connection (works
from any extension page or the service worker). Use it before every reload, close or reopen that
follows a UI action. A preview on screen (the colour dot) renders before the write.

**e2e: destroying a popup at an exact instant.** `page.reload()`, `location.reload()`,
`page.close()` and `chrome.tabs.remove` all leave the old document running for several
milliseconds, enough for an unfinished transaction to finish. To destroy it synchronously, host
`popup.html` in an iframe of a plain same-origin extension page (`manifest.json` works, it runs no
app code) and call `window.frameElement.remove()` from inside, in a microtask queued by the write's
last `put` (`e2e/tests/persistence.spec.ts`). That test fails 3/3 on an auto-commit build and passes
on the explicit-commit build. `indexedDB.open(name)` with no version creates an empty version-1
database if none exists, which would block the app's own upgrade: abort in `onupgradeneeded`.

**Running e2e against the production-mode build** (what CI loads; timing differs from the dev build):
- `e2e/extensionPath.ts` is the ONE resolver (fixture, `kbdPopup.ts`, both real-popup DnD specs).
  `TM_E2E_EXT_DIR=.output/chrome-mv3` selects a build, `TM_E2E_CPU_THROTTLE=4` slows every popup
  page through CDP `Emulation.setCPUThrottlingRate`, `TM_E2E_OFFLINE=1` lets only loopback resolve
  (for loading an old store build without it reaching its endpoints).
- Env override for a build: values already in `process.env` win over `.env.*` files only when they
  are NON-EMPTY. WXT's env loading (dotenv-expand) replaces an empty variable with the file value,
  so a variable cannot be blanked from the command line. Non-empty values pass through pnpm on
  Windows; a direct `node node_modules/wxt/bin/wxt.mjs build` cannot resolve `vite` without
  `NODE_PATH=<repo>/node_modules/.pnpm/node_modules`.
- Playwright's `file:line` filter matches only the exact line a `test(` starts on; after editing a
  spec, re-check the line or the filter silently selects nothing for that entry.
- A failing test restarts the Playwright worker, which re-imports spec and helper files: do not edit
  them while a `--repeat-each` run is in flight if the run is meant to measure the old version.
