---
name: feedback-group-star-sort
description: useToggleGroupStar stable-sort gotcha — test setup must place items in the right initial order to verify zone movement
metadata:
  type: feedback
---

`useToggleGroupStar` re-sorts groups into three stable zones: `[NowOpen, ...starred, ...unstarred]`. The sort is **stable within each zone** — it preserves relative order. This means:

- To test that un-starring a group makes it fall *after* an unstarred group, the unstarred group must already be placed *before* the to-be-un-starred group in the initial state. If the to-be-un-starred group is first in `rest`, it will remain first among the unstarred zone after the toggle.

**Why:** First test had `[nowOpen, starred, unstarred]` and expected `starredIdx > unstarredIdx` after un-starring; both end up unstarred so relative order is preserved, making starred still at index 1 and unstarred at index 2. The assertion failed. Fixed by initializing `[nowOpen, unstarred, starred]`.

**How to apply:** Whenever writing tests for star/sort mutations, arrange initial state so the item-under-test is in a position where the sort will visibly move it across zones.
