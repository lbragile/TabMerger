---
name: sync-now-bridge
description: Real "trigger sync now" bridge from web dashboard to extension via externally_connectable SYNC_NOW message
metadata:
  type: project
---

Built the web-dashboard "Re-sync now" button to actually trigger a push+pull sync in the
extension's background service worker, not just re-read Supabase (which can't reflect
locally-pending-but-unpushed changes).

**How sync became callable from the background context:** extracted the push+pull+save-to-IDB
core of `useSync.ts`'s `doSync` into `performSync(session): Promise<Group[]>` in
`syncEngine.ts`. `useSync.ts` now calls `performSync` then re-reads `getGroupsState()` for the
query-cache write, instead of inlining the push/pull/reorder logic itself. The React-specific
gating (encryption-setup modal, locked-toast, migration self-heals) stays in the hook — it's
popup-lifecycle-specific and doesn't belong in the background handler.

**Background handler (`background.ts`, `onMessageExternal`):** `{ type: 'SYNC_NOW' }` →
`handleSyncNow()` does its own gating (no React deps available): `supabase.auth.getSession()`
→ `getEncryptionKeyState()` → `getDataKey()` → `performSyncCycle(session)`. Responds
`{ ok: true, skipped }` (`skipped: true` = another cycle held the sync lock, nothing ran) or
`{ ok: false, reason: 'no-session'|'locked'|'error', message? }` (`error` also when the
encryption status could not be checked). Confirmed
`getDataKey()` works correctly from the background context (chrome.storage.session-backed, per
the earlier cross-context fix) — but the background worker has its OWN lifetime and its own
data-key-unlocked state, separate from the popup's. If the popup was closed and the SW went
idle/restarted, `getDataKey()` returns null there too, correctly surfacing `reason: 'locked'`
rather than silently no-op'ing.

**Response contract never leaks group content** — just ok/reason/message, matching the
existing PING/PONG pattern's shape philosophy.

**Web side:** `SyncIndicator.tsx`'s `handleRefreshClick` sends `SYNC_NOW` via
`chrome.runtime.sendMessage(EXTENSION_ID, ...)` with a 5s timeout, resolving `null` (not
rejecting) on any failure/timeout/no-`chrome`/no-response so it can fall back to a plain
Supabase re-read for browsers without the extension connected — never hard-fails the button.
`{ ok: false, reason }` surfaces as a `sonner` toast with a per-reason message.

Extracted the `EXTENSION_ID` (`NEXT_PUBLIC_CHROME_EXTENSION_ID` || dev id) resolution out of
`useExtensionInstalled.ts` into `packages/web/lib/extensionId.ts` so `SyncIndicator.tsx` reuses
it instead of duplicating the id-fallback logic.

**Test gotchas:**
- The ambient `declare global { interface Window { chrome?: ... } }` in
  `useExtensionInstalled.ts` merges project-wide — other files in the same package (e.g.
  `SyncIndicator.tsx`) can reference `chrome` directly without redeclaring it, as long as the
  types are compatible; widened the shared declaration's callback type to include
  `ok`/`reason`/`message` rather than adding a second incompatible `declare global`.
- `delete window.chrome` type-checks fine with no `@ts-expect-error` needed since `chrome?` is
  already optional on `Window` — an unused-suppression-directive TS error (`TS2578`) will fire
  if you add one anyway.
- `packages/web/vitest.setup.tsx`'s global `next/navigation` mock was missing `refresh` on the
  `useRouter()` return — every component calling `router.refresh()` threw an unhandled
  rejection in tests silently (didn't fail the test, just polluted output) until fixed there
  once, globally, rather than per-test-file.
- When extracting hook logic into a plain function that a module-mocked test already stubs
  (here: `useSync.test.ts` mocked `pushPendingChanges`/`pullRemoteChanges` directly, not
  `performSync`), the old mocks go silently undefined-typed once the hook stops calling them
  directly — the fix is to add a `performSync` mock to the same `vi.mock('@/lib/syncEngine', ...)`
  block that internally calls the existing granular mocks, so existing call-count/argument
  assertions on those still hold without rewriting every test.
