---
name: selectors-and-app-mode
description: How record.ts finds the real Settings/Demo Mode selectors and why it uses --app= mode instead of a normal tab
metadata:
  type: project
---

record.ts (packages/demo/) drives the *production-shaped* build, not the dev server. Two things only existed in `pnpm build:extension`'s dead-code-eliminated dev branches:

- Icon-only buttons in Header/index.tsx (Settings, Undo/Redo, selection toggle, AI group) relied on a Radix Tooltip for their visible label. Radix wires TooltipContent via `aria-describedby`, **not** an accessible name — `getByRole('button', {name: /x/i})` times out on these unless an explicit `aria-label` is added. Fixed by extension-dev (2026-07-08): `aria-label="Settings"` / `"Undo"` / `"Redo"` / `"Select items"`|`"Exit selection mode"` / `"AI Auto-group"` now on those buttons.
- Settings.tsx's "Demo Mode" button was gated behind `import.meta.env.DEV`, `false` in `pnpm build:extension` output — the artifact record.ts loads. Fixed by extension-dev (2026-07-08): gate is now `import.meta.env.DEV || import.meta.env.VITE_DEMO_BUILD === "true"`. Build the recording input with `pnpm --filter @tabmerger/extension build:extension:demo` (runs `wxt build -m demo`, reads `.env.demo` which sets `VITE_DEMO_BUILD=true`) — NOT plain `pnpm build:extension`, that still eliminates the button. Same output path (`.output/chrome-mv3`).

record.ts's real selector chain: `getByRole('button', {name:'Settings'})` → `getByRole('tab', {name:'Data'})` → `getByRole('button', {name:'Demo Mode'})`, with `page.on('dialog', d => d.accept())` registered beforehand since `handleDemoMode()` uses a native `window.confirm()`, not a UI button.

record.ts also switched from `page.goto('chrome-extension://ID/popup.html')` in a normal tab to a two-phase launch: a throwaway `launchPersistentContext` to discover the extension ID via the MV3 service worker URL (unpacked extension IDs are a deterministic hash of the absolute `--load-extension` path, stable across runs), then a second launch with `--app=chrome-extension://ID/popup.html` plus `--window-size=780,600` and `viewport: {780,600}`. `--app=` mode removes the tab strip/address bar entirely, and matching the Playwright viewport to WXT's real popup size (780x600 at the time) keeps the popup's own responsive CSS from stretching to fill a bigger viewport than it actually renders at.
