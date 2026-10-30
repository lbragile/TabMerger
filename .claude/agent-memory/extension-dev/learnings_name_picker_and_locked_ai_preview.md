---
name: learnings-name-picker-and-locked-ai-preview
description: "Name this group" picker (native radios + own arrow handling, textbox outside the radiogroup, re-lookup by id), the free/Pro locked ✨ preview (aria-disabled focusable Radix items, Playwright force click), Show AI button setting placement, Settings switch-index tests
metadata:
  type: reference
---

**Name group → picker.** `useNameGroupAction(group)` (no index any more) reads the reply with
`suggestedGroupNames` (lib/aiGroupName.ts: `names` when a non-empty array, else `[name]` for an older
server; cleaned, case-insensitive dedupe, capped at shared `AI_NAME_GROUP_SUGGESTIONS` AFTER
dropping), re-finds the group BY ID in the query cache, drops names equal to the current one
(`isSameGroupName`), toasts `nameAlreadyFits` when nothing is left, else
`openModal('nameGroupPicker', { groupId, suggestions })`. `Modal/NameGroupPicker.tsx` renames via
`useUpdateGroupName().mutateAsync` at `findIndex(id)` when Rename is pressed (one undo step); typed
names go through `typedGroupName` (lib/groupName.ts), shared with GroupItem's inline rename.

- **Radiogroup with a free-text option:** the textbox sits OUTSIDE `role="radiogroup"` (axe's
  aria-required-children flags a textbox owned by a radiogroup), indented under the "Or type your
  own:" radio. Native `<input type="radio">` + roving `tabIndex`; arrows are handled on the `<form>`
  keydown (jsdom has no native radio arrow behaviour, and handling it ourselves avoids a double move
  in Chrome): Up/Down always, Left/Right only on radios, flipped when `getComputedStyle(target).direction`
  is rtl (jsdom resolves `<html dir="rtl">` there). Landing on "your own" focuses the box; Up/Down in
  the box move back out. Enter = preventDefault + submit unless the target is a button. Radix
  Dialog autofocuses the first tabbable = the checked radio (Close X renders after children).
- **Tests needing the cache:** `useNameGroupAction` reads `GROUPS_QUERY_KEY` from the query client,
  so Header/GroupContextMenu tests must SEED the wrapper's QueryClient (`wrap(ui, groupsState)` /
  `renderGroup(g, i, cache)`); with the cache empty the action toasts "changed elsewhere" instead.

**Locked ✨ preview (free/Pro).** `locked = !aiFeatures` (Pro AI without a live option still returns
null). Items: `aria-disabled` + `onSelect: e.preventDefault()` and NO `disabled` prop: Radix spreads
item props after its own `aria-disabled`, so the item stays focusable/arrow-reachable but never runs
and the menu stays open. Per-feature switches don't apply to the preview. Footer: a menu item
"Upgrade to Pro AI" → `openModal('upgrade', { reason: 'aiFeatures' })`. The "Pro AI" tag is centred
with `absolute inset-x-0 flex justify-center` (left-1/2 + -translate-x-1/2 fails
logicalDirection.test.ts). Playwright refuses to click an aria-disabled element: `click({ force: true })`.
Radix DropdownMenu doesn't loop: reach the footer with ArrowDown from the first item, not ArrowUp.

**Show AI button** (`appSettings.showAiButton`, read as `!== false`): Settings → General (the AI tab
is Pro AI only), rendered only while `AI_ENABLED`, placed LAST in General because Settings.test.tsx
indexes switches by position (`getAllByRole('switch')[n]`). Settings.test's aiFlag mock is now a
getter (`aiFlag.enabled`) so a test can switch AI off. Hiding the button also drops the tour's `ai`
step on its own (`availableTourSteps` skips steps whose anchor is missing).

Related: [[learnings-ai-menu-sections-describe-group]], [[learnings-header-ai-name-group]], [[test-mocks-follow-hook-usage]]
