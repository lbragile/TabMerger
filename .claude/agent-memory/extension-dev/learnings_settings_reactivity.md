---
name: learnings-settings-reactivity
description: Root cause and fix pattern for stale appSettings reads across the popup; a React ref-mutation-order bug; and a vi.waitFor vs testing-library waitFor/act gotcha.
metadata:
  type: project
---

**Root cause of "settings don't update without reopening the popup" / "wrong values after login":**
`appSettings` in IndexedDB (`src/lib/localDb.ts` getSetting/setSetting) had no TanStack Query wrapper.
Settings.tsx and three other consumers (`useTheme`, `useCleanupSuggestions`,
`Windows/index.tsx`'s staleThresholdMs) each did their own one-shot `getSetting(...).then(setState)`
in a `useEffect(() => {...}, [])`. Saving in Settings.tsx only updated Settings.tsx's own local
state — nothing else in the popup ever re-read IndexedDB, so other consumers stayed stale until
the popup was closed/reopened (which remounts everything fresh).

**Fix:** added `src/hooks/useAppSettings.ts` — `useAppSettings()` (useQuery, key `['appSettings']`,
`staleTime: 0` like `useGroups`) + `useSaveAppSettings()` (mutation that calls `setSetting` then
`qc.setQueryData` so every subscriber re-renders immediately). Converted the four consumers above
to this shared query. Also added an invalidate of `['appSettings']` in `useSync.ts`'s login effect
(`if (!session) return; qc.invalidateQueries(...)`) since settings are LOCAL-ONLY (never synced to
Supabase) — the invalidate exists purely to force already-mounted consumers to re-read the
authoritative IndexedDB value once a session appears, in case they'd cached a value before login.

**React gotcha hit while building the "don't clobber unsaved edits" resync effect:** never mutate
a ref synchronously right before calling a `setState(prev => ...)` updater that reads that same ref
— the updater function is invoked asynchronously by React, so by the time it runs the ref already
holds the *new* value, not the one you meant to compare against. Capture the ref's old value into a
local const first, mutate the ref, *then* pass the local const into the updater closure.

**Test gotcha:** `vi.waitFor` (vitest's own) does NOT flush React `act()` boundaries the same way
`waitFor` from `@testing-library/react` does. A test that calls `qc.invalidateQueries(...)` outside
`act()` and then polls with `vi.waitFor` can silently time out even though the same assertion with
`@testing-library/react`'s `waitFor` (or wrapping the invalidate in `act(async () => {...})`) passes
immediately. When a regression test manually triggers a TanStack Query cache change, prefer
`@testing-library/react`'s `waitFor`/`act` over `vi.waitFor`.
