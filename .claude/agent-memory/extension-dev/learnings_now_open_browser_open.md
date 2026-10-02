---
name: now-open-browser-open
description: Moving tabs/windows to the Now Open group must open them in the browser, not insert into IndexedDB
metadata:
  type: feedback
---

When any move operation targets the Now Open group (permanent group, index 0), the correct behavior is to open the item in the actual browser and let `useCurrentTabs` sync it in automatically — never insert directly into IndexedDB for that group.

Pattern:
- Tab → `chrome.tabs.create({ url, active: false })`, then remove from source in IndexedDB (unless source is also Now Open / copy=true)
- Window → `chrome.windows.create({ url: filteredUrls, focused: false })`, then remove from source in IndexedDB (unless source is also Now Open)
- Bulk tabs/windows → same per-item chrome API calls; skip the target-group IndexedDB insert block

**Why:** `useCurrentTabs` listens to `chrome.tabs.onCreated` / `chrome.windows.onCreated` and re-syncs Now Open on every such event. Inserting directly into IndexedDB bypasses this, causes duplicate entries when `useCurrentTabs` fires, and produces stale tab IDs (saved tabs have id=0, but Now Open tabs need real chrome tab IDs for actions like close/preview).

**How to apply:** In `useMoveTab`, `useMoveWindow`, and `useBulkMoveToGroup`, check `available[toGroupIndex]?.permanent` (or `targetGroup?.permanent`) before the normal IndexedDB write. If true, branch to the chrome API path instead.

**Restricted URLs:** Filter `chrome://`, `about:`, `chrome-extension://`, `moz-extension://` URLs before passing to `chrome.tabs.create` / `chrome.windows.create`. The regex `RESTRICTED_URL_RE` is exported from `useGroups.ts`.
