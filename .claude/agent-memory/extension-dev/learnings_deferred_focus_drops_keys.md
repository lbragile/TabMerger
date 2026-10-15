---
name: learnings-deferred-focus-drops-keys
description: Focusing a just-opened input in setTimeout(0) loses keys typed right after opening on a busy main thread (CI e2e); focus synchronously in the effect instead
metadata:
  type: reference
---

The search overlay used `if (searchOpen) setTimeout(() => searchRef.current?.focus(), 0)` in
Header. On a loaded CI runner the `search.spec.ts` dim-mode test failed every time: it clicks
"Open search" and immediately presses Ctrl+A and types "jir". Chrome's scheduler runs queued
input tasks before timer tasks, so the keys reached the opener button (or the body) before the
timer focused the box, the query stayed "jra", and the Jira row kept `opacity-60`. Locally
(fast machine) it never failed, not even with CPU throttling (throttling slows everything
evenly and keeps the order).

**Reliable local repro:** before the action, patch the page's timers so 0 ms ones run late:
`page.evaluate(() => { const o = window.setTimeout; window.setTimeout = (fn, ms, ...a) => o(fn, (ms ?? 0) === 0 ? 120 : ms, ...a); })`.
That models "input first, timers later" and fails deterministically.

**Fix:** focus synchronously in the `useEffect`. The child input's ref is attached before the
parent's effect runs, and React flushes effects of a discrete event (click, keydown) before
the next event is handled, so no timer is needed. A unit test proves it: `act(() =>
fireEvent.click(opener))` then `expect(combobox).toHaveFocus()` with no `waitFor`.

**Test side:** after opening an overlay, wait for `expect(input).toBeFocused()` instead of a
`waitForTimeout(50)`; check typed text with `toHaveValue` before asserting on its effect.

Related: [[learnings-search-highlight-hide-dim]], [[learnings-search-a11y-and-sync-numbering]].
