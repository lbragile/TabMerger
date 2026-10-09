---
name: e2e-now-open-live-windows
description: How to e2e-test Now Open flows (needs real windows) and which build the e2e suite loads
metadata:
  type: reference
---

- The e2e fixture builds nothing; it loads `.output/chrome-mv3-dev` if present (else `chrome-mv3`). That build goes stale after source edits: rebuild with `pnpm --filter @tabmerger/extension build:dev`, which only rewrites `chrome-mv3-dev` (the `chrome-mv3-demo` directory is untouched).
- Run Playwright via `cd packages/extension/e2e && ../node_modules/.bin/playwright test <spec>`; `pnpm exec playwright` from `e2e/` does not resolve.
- A seeded Now Open group is overwritten by the live browser. To get several Now Open windows, create real ones from the service worker (`chrome.windows.create({url:[...]})`) pointing at a loopback server whose page title is the URL's last path segment, then reload the popup. See `e2e/tests/copyToGroup.spec.ts`.
- Window cards: `div[data-window-index]` that contain `[data-window-header]` (tab rows also carry `data-window-index`). Sidebar badge: `[data-sidebar-group-index="N"] span:has(> span.opacity-40)`, text like `2◆3`.
- Unit `useMoveWindow` tests: a mutation that returns `prev` is still saved by the `updateGroupsState` mock (identical content), so assert equality of the saved state, not `saveGroupsState` not called.
