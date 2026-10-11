---
name: saved-copies-and-close-e2e
description: How e2e/tests/savedCopiesAndClose.spec.ts drives "only Now Open closes tabs", detached copies and position dedupe with real windows
metadata:
  type: reference
---

- Spec: `packages/extension/e2e/tests/savedCopiesAndClose.spec.ts`. Real windows are created from the service worker on a loopback title server; "open" is asserted with `chrome.tabs.query` in the worker (`liveTitles`, `tabCount`), never from the UI. Pin a live tab with `chrome.tabs.update(id, {pinned:true})` so a copy that kept `pinned` would show it.
- Stored copies: read IndexedDB with `readStoredGroups` and cast to a raw window/tab shape to assert tab `id: 0`, window `id: 0`, `focused: false`, a numeric `savedAt` and no `pinned` key.
- Bulk window copy to a group PREPENDS the copies (`sortWindowsByStarred([...newWindows, ...target])`); a single-window menu copy appends. Assert by content (windows containing `Live ` tabs), not by index.
- The e2e suite loads `.output/chrome-mv3-dev` when it exists: rebuild with `pnpm --filter @tabmerger/extension build:dev` (about 12 s) before a run, or it tests stale code.
- Dedupe dialog: heading "Remove duplicates", confirm button "Remove N duplicate(s)"; the first tab of a URL is kept, later ones are listed.
- Running a throwaway spec outside the repo: a config in a scratch folder with `testDir: '.'`, a `package.json` with `"type": "module"` beside it, and absolute-path imports of `e2e/fixtures` and `e2e/helpers`.
