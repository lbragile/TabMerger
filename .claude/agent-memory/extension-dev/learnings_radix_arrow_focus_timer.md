---
name: learnings-radix-arrow-focus-timer
description: Radix Select and Radix menus (RovingFocusGroup) move focus for ArrowUp/ArrowDown in setTimeout; an Enter pressed right after reaches the item the arrow left. e2e must wait for focus to move
metadata:
  type: reference
---

**Library behaviour (installed `@radix-ui/react-select` 2.3.x, `react-roving-focus` used by
`react-menu`):** the content's `onKeyDown` handles ArrowUp/ArrowDown with
`setTimeout(() => focusFirst(candidates))`. Chrome runs queued input before timers on a busy
main thread, so in e2e `press('ArrowUp'); press('Enter')` (5-13 ms apart) delivers Enter to the
still-focused old option: Radix selects the old value and closes the list. Also, a popper-
positioned Select focuses the selected option only after floating-ui places it (async), so right
after `[role="listbox"]` appears focus can still be on the trigger, whose textContent is the
current value too.

Seen as `tourV2.spec.ts` keyboard test failing on the theme step in CI (production build):
`data-tour-task` stayed `todo`; the trace showed the trigger still "System" after ArrowUp+Enter
and the list closed. Not a product bug: no person types that fast. No product code is involved.

**Repro:** before the keys, `page.evaluate` patches `window.setTimeout` so 0 ms timers run at
120 ms (see [[learnings-deferred-focus-drops-keys]]). Fails 5/5; the MessageChannel scheduler
slowdown from [[learnings-radix-nested-dialog-escape-race]] only hits it about 1 in 5.

**Test pattern:** wait for `[role="listbox"] [role="option"]:focus` (count 1) before reading the
start value, after the arrow wait for that locator `not.toHaveText(start)`, then Enter and assert
the trigger shows the picked text. For a menu, wait until focus leaves the trigger, then after each
ArrowDown poll until focus changed.
