# Demo Agent Learnings — TabPreview hover, star/pin selectors

## TabPreview hover requires sustained mouse position

`TabPreview` uses Radix `<Tooltip delayDuration={400}>`. Playwright's `element.hover()` leaves the
mouse on the element indefinitely — subsequent `waitForTimeout` calls do NOT move the cursor, so the
tooltip stays visible in the recording. No need to re-hover after the wait.

Saved (non-Now Open) tabs lack a live `tabId`, so `fetchOgImage` returns `null` and the "No
preview" placeholder renders. This is fine and intentional for demo purposes — it shows the feature
UI even without a real OG image fetch.

## Window star button vs. group star button selector

Both `Window.tsx` and `GroupItem.tsx` render `<Star>` icons inside buttons. To target only the
window-level star (not sidebar group stars), locator scope to `.bg-card` — the window card
container class. Sidebar group items never have `.bg-card` on them.

```js
page.locator(".bg-card").first().locator("button:has(.lucide-star)").click()
```

## Tooltip aria-label vs. CSS selector for star/pin buttons

The group "Pin" button (formerly "Star") has no `aria-label` — only a Radix `<TooltipContent>` that
says "Pin group" / "Unpin group". Playwright's `getByRole("button", { name: "Pin group" })` will NOT
find it. Use `button:has(svg.lucide-star)` CSS selector instead.

## Terminology shift: Star → Pin

As of the 2026-07 feature batch, the group star feature is called "Pin" in the UI (tooltip says
"Pin group" / "Unpin group"). The sidebar orders: Now Open → starred/pinned groups → unstarred
groups. Update demo captions accordingly — "Pin it" not "Star it".
