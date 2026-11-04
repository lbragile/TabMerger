---
name: learnings-settings-initial-tab-and-focus-ring-clip
description: Settings opened on a tab that needs the account (AI, Devices) fell back to General via Radix focus activation; Settings' overflow-x-hidden scroller clipped the start-side focus ring of flush fields; dev-only UI tree-shake check
metadata:
  type: reference
---

**`openModal('settings', { tab: 'ai' })` opened General in a real build** while every unit test
passed. `useAuth` keeps per-component state that starts signed out and reads the session after
mount, so on SettingsModal's first render `aiFeatures` is false and the AI `TabsTrigger` does not
exist. The dialog's open auto-focus lands on the tab list, and Radix Tabs (automatic activation)
selects the focused trigger: General. Fix in `Modal/Settings.tsx`: keep the requested tab in a ref,
apply it once when its tab exists (`aiFeatures` / non-free tier), and move focus to the active
trigger only if focus is inside the tab list. Any modal whose content depends on a `useAuth`-derived
value has the same first-render gap. jsdom reproduces it if the test focuses the General trigger
with `act(() => el.focus())` before the entitlements mock flips.

**Focus ring clipped on one side.** Settings' tab panels scroll in a div with
`overflow-y-auto overflow-x-hidden pe-1`; content flush with its start edge (the own-key input)
lost the left side of its `ring-1` focus ring (box-shadow outside the border box), so the focused
field looked open on the left. `-ms-1 ps-1` moves the clip edge 0.25rem out without moving the
content. Diagnose by reading pixels: screenshot a 1px-high clip around the edge and decode it in the
page with a canvas (`Image` + `getImageData`); PIL is not installed.

**Dev-only UI.** Render it behind a literal `import.meta.env.DEV &&` at the call site, keep it in its
own side-effect-free module, and Rollup drops the module from production builds. Proof: a
production probe build to a scratch `outDir` (config that spreads the real `wxt.config.ts`), then
grep the JS for a `data-testid` and the component's literals. Catalog strings still ship (locales
are data). In unit tests `vi.stubEnv('DEV', false)` flips `import.meta.env.DEV` at render time.

**Playwright `check()` flakes on the AI provider radios** ("Clicking the checkbox did not change its
state", about 1 in 3, with or without these changes): the radio is controlled by a TanStack query
updated with `setQueryData`, whose observer notification is batched to a later tick, so React
briefly restores the old state. Use `click()` then `expect(radio).toBeChecked()`
(`pickProvider` in `aiByokSettings.spec.ts`).
