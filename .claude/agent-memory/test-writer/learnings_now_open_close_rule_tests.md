---
name: learnings-now-open-close-rule-tests
description: Where the Now Open "defer only own window's active tab" rule is tested at unit, integration, e2e and real-popup layers, and the stub gotchas
metadata:
  type: reference
---

- Step 1 (unit): `unit/hooks/useDndHandlersNowOpenClose.test.tsx` drives the real `useDndHandlers` drop for a Now Open window (`now::w1` onto group `dest`). The chrome stub must include `windows.getCurrent` and `tabs.query`; without `getCurrent` the code lands in the defer-everything fallback and the test would prove nothing.
- Existing unit tests with `tabs.remove` stubs (`useDndHandlersMulti`, `useDndHandlersUnified`) only drag saved items INTO Now Open, so they never reach `partitionClosableTabs`.
- Step 3 (integration): `integration/dndPersistence.integration.test.ts` gained a describe that snapshots real IndexedDB from inside the `tabs.remove` / port-connect stubs, pinning "saved copy (id 0 tabs) persisted before any real tab closes". The shared integration chrome stub has no `windows.getCurrent`, so older integration drags land in the fallback path.
- Step 4 (e2e): `e2e/tests/nowOpenCloseOwnWindow.spec.ts` (tab-hosted page). Assert closure from the service worker with `chrome.windows.getAll({populate:true})`. Own-window case: open extra pages BEFORE bringing the TabMerger tab to the front so it is the active tab. Run with `--retries=0`; the config has retries: 1 which hides flakiness.
- Step 5 (real popup repro): `launch({extraWindowUrls})` now accepts string[] entries (multi-tab window). Window multi-select there: ctrl-click on `[data-window-header]` enters selection mode.
