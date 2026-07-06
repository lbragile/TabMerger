---
name: feedback-component-test-patterns
description: Patterns required when rendering extension React components in jsdom tests
metadata:
  type: feedback
---

Wrap TabItem (and any component using Radix Tooltip) with `TooltipProvider` in the test wrapper, otherwise the render throws "`Tooltip` must be used within `TooltipProvider`".

**Why:** Radix tooltip context is required at render; jsdom doesn't have it by default.

**How to apply:** In the `wrapper` function passed to `render()`, nest `<TooltipProvider>` inside `<QueryClientProvider>`.

---

`useOpenWindow` now creates a window with `{ focused: true }` first, then creates tabs individually with `{ windowId, url }` — it no longer passes `{ url: [...] }` directly to `windows.create`. Tests must mock `windows.create` to return `{ id: <someId>, tabs: [] }` so `targetWindowId` resolves.

**Why:** Implementation changed to support chrome tab group preservation — needed to create the window first, get its ID, then open tabs (some possibly into existing groups).

**How to apply:** Set `chromeMock.windows.create.mockResolvedValue({ id: 99, tabs: [] })` and assert individual `tabs.create` calls, not a single `windows.create({ url: [...] })` call.
