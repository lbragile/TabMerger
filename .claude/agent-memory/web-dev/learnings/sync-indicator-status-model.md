---
name: sync-indicator-status-model
description: SyncIndicator status union, SYNC_NOW long timeout via sendToKnownExtension, live-region split so a ticking label is not announced, Radix asChild undefined-prop trap, fake-timer RTL pattern
metadata:
  type: reference
---

**Status model.** `SyncIndicator` holds one `SyncStatus` union (`idle | syncing{manual} | busy | checked | failed{message}`) and one pending timer (`startTimer` replaces the previous one). Timer callbacks only reset the state they were started for (`prev.kind === 'checked' ? IDLE : prev`), so a leftover pulse timer can never clear a later failure. `failed` has no timer: it ends on the next successful sync or row event.

**Extension reply timeouts.** `sendToExtension` gives every attempt 1.5 s (`PER_ATTEMPT_TIMEOUT_MS`), which suits PING but not a message whose reply follows real work. For SYNC_NOW: find the responder with PING (skipped when `getCachedExtensionId()` is set), then `sendToKnownExtension(msg, { timeoutMs })`. The long timeout exists on `sendToKnownExtension` only, so it can never be multiplied across every probed ID.

**SYNC_NOW answer.** `{ ok: true, skipped }` or `{ ok: false, reason, message }`. `skipped: true` means the request ran nothing. Only `ok && !skipped` sets the time to now. For `reason: 'error'` the extension's `message` is shown; `locked` / `no-session` use the web's mapped copy. Anything without a boolean `ok` is treated as "not reachable" (plain re-read).

**Live region vs ticking text.** The relative time re-renders every 30 s (`now` in state, plus `visibilitychange`). Put only the status word in `role="status"` and keep the time in a sibling outside it; otherwise a screen reader announces every tick. Tests then read the whole label with `toHaveTextContent` on the pill, not `getByText` (the text spans two elements).

**Radix `asChild` trap.** `aria-describedby={cond ? id : undefined}` on the child of `TooltipTrigger asChild` overrides the trigger's own `aria-describedby` with `undefined` (Slot spreads child props last). Spread the prop conditionally instead.

**Hydration.** localStorage is read after the fetch resolves (inside `recordSync`), not in a `useState` initializer: the pill is server-rendered, so an initializer read would change the first client render.

**Test teardown order.** In `afterEach`, call `vi.restoreAllMocks()` before `vi.useRealTimers()`. A spy placed on `setInterval` while fake timers are on restores to the fake function; if real timers came back first, the fake one is put back for good and any later `waitFor` on a non-DOM condition hangs (DOM-driven `waitFor`s still pass through the MutationObserver, which hides the problem).

**Tests with fake timers.** RTL `waitFor` does not advance Vitest fake timers. Use `await act(async () => { await vi.advanceTimersByTimeAsync(ms) })` and `fireEvent.click` (not `userEvent`). `vi.setSystemTime` moves the clock without firing timers, which is how the `visibilitychange` catch-up is tested. Fake extension: answer PING at once, hand SYNC_NOW's callback to the test.
