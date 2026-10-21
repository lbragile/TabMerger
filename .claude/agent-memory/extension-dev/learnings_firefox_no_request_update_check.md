---
name: learnings-firefox-no-request-update-check
description: Firefox has no runtime.requestUpdateCheck; Settings shows an about:addons hint instead of the button; isFirefoxBuild lives in lib/buildTarget.ts so UI does not depend on dataConsent mocks
metadata:
  type: reference
---

- Firefox (desktop and Android) and Safari do not implement `runtime.requestUpdateCheck`
  (MDN browser-compat-data: `version_added: false`). `runtime.onUpdateAvailable` and
  `runtime.reload` do exist, so the "Restart to update" banner works everywhere.
- `lib/extensionUpdate.ts`: `checkForUpdate` answers `unsupported` only for a development /
  unpacked / temporary install (checked first), `no_api` for a browser without the API.
  `hasUpdateCheckApi()` is synchronous, so `CheckForUpdates.tsx` decides on mount (useState
  initializer) whether to render the button or the hint (`settings.updates.autoUpdateFirefox` on
  Firefox builds, `settings.updates.autoUpdate` elsewhere). `about:addons` stays literal in all
  catalogs; the menu item name is quoted per locale (Firefox's own label for that language).
- `isFirefoxBuild()` moved to `lib/buildTarget.ts` (re-exported from `dataConsent.ts`). Reason:
  four Settings test files `vi.mock('@/lib/dataConsent', () => ({ requestDataConsent }))`, and
  vitest v4 throws when a component reads an export the factory left out (see [[vitest-dndkit-mocks]]).
  New UI that only needs the browser should import from `buildTarget`.
- Probe a production Firefox build without touching `.output`: a config in the scratchpad that
  imports the real `wxt.config.ts` by absolute path and overrides `outDir`, then
  `VITE_EXTRA_WEB_APP_URLS=" " pnpm exec wxt build -b firefox -c <that file>` (~40 s). See
  [[learnings-in-app-confirm-and-backup-file-location]].
- Catalog JSON files are CRLF in the working copy: add keys with a small Node script that keeps
  the file's EOL (a 2-line diff per locale), then `JSON.parse` to check.
