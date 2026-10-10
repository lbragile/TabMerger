---
name: import-validation-and-open-guard
description: Import parsers return { groups, skipped } and rebuild every entry; lib/safeOpen.ts guards every stored-URL open; URL-rule glob matcher has no RegExp; bridge messages parsed by lib/bridgeMessage.ts
metadata:
  type: reference
---

**Imports (`src/lib/importExport.ts`).** `importGroups`, `parseBookmarksHtml` and `parseOneTabs`
return `{ groups, skipped }`, and `importGroupsState` returns `{ state, skipped }` for the
Import / Export dialog's full-state JSON. Groups, windows and tabs are rebuilt from known fields
only (unknown keys never pass through), saved tabs and windows get `id: 0`, `info` is recomputed,
and sync bookkeeping is never taken from a file. A `permanent: true` group in a file is the
exporter's live tabs: the appending import leaves it out, the replacing import keeps at most one
(first) as the fallback for `prepareImportedState`. Decision: the extension blocks script-running
schemes only (`isScriptUrl` from `@tabmerger/shared`), never restricts to http(s), because
`chrome://`, `file://`, `about:` and extension pages are tabs people really save.

**Opening stored URLs (`src/lib/safeOpen.ts`).** `isOpenableUrl` / `openableUrls` sit in front of
every `chrome.tabs.create` / `chrome.windows.create` that opens a URL from stored data. A new open
site must use them, and must not call `chrome.windows.create({ url: [] })` (an empty list opens a
blank window): skip the call, or create the window without `url` where a window is still wanted.

**Test fallout to expect.** Component tests that `vi.mock('@/lib/importExport')` must return the
`{ groups, skipped }` shape and provide `skippedSuffix`; use `importOriginal` when the component
also needs the real `importGroupsState`.

**Editing gotcha.** Most files under `src/` are CRLF on disk. A scripted multi-line replacement
has to split on the file's own line ending and write it back, or the file ends up with mixed
endings. `src/hooks/useDndHandlers.ts` holds one literal NUL character inside a template string
(a key separator), which is why `grep` reports it as a binary file; use `grep -a`.

**URL rules.** `matchUrlToRule` uses `globMatch` (split on `*`, `indexOf` left to right), not a
compiled regular expression, so matching time stays bounded for any pattern a user types.

**Web bridge.** `parseBridgeMessage` (`src/lib/bridgeMessage.ts`) is the runtime check for messages
from the web app: known type from `WEBSITE_TO_EXTENSION_TYPES`, token fields only as bounded strings.
