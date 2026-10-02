---
name: content-script-removed
description: The extension has no content script by design — src/entrypoints/content.ts was deleted in commit fb467f4 ("drop host permissions"), so A4's requirement for it is stale
metadata:
  type: project
---

Section A4 lists `content.ts` as a required entrypoint, and CLAUDE.md still documents `src/entrypoints/content.ts`. It does not exist and should not.

**Why:** commit `fb467f4` ("feat(extension,web): drop host permissions, sync auth via externally_connectable") removed the content script. The extension ships with **no `host_permissions`** (required or optional) to stay out of Chrome Web Store's elevated review tier. Tab Preview's OG-image read now goes through the web app's server-side scraper (`packages/web/app/api/og-preview`), and web-app install detection uses `externally_connectable` + `chrome.runtime.sendMessage` instead of a content-script `postMessage` broadcast. See the `manifest` block comments in `packages/extension/wxt.config.ts`.

**How to apply:** In A4, verify only `popup/index.html`, `popup/main.tsx`, `popup/App.tsx`, and `background.ts`. Treat a missing `content.ts` as expected. Note that `useGroups.ts` / `useMoveTab` still calls `chrome.tabs.sendMessage(id, { type: 'GET_PAGE_META' })` in a try/catch — that path is dead (no receiver) and silently returns undefined `ogImage`; not a smoke-test failure. Only flag `content.ts` if a change under test actually re-introduces host permissions or a content-script entrypoint.
