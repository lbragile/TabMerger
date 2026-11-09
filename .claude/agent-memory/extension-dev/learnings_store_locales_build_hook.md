---
name: learnings-store-locales-build-hook
description: How the store-listing _locales are generated (WXT build:publicAssets hook from the i18next `manifest` namespace), plus gotchas for importing wxt.config.ts in vitest and checking resolved strings in Chrome
metadata:
  type: reference
---

Store listings read only `_locales/<code>/messages.json` + `default_locale`; the react-i18next
catalogs are invisible to them. Setup:

- Source: `src/locales/<lng>/manifest.json` (flat keys, no `{{placeholders}}`), registered in every
  `<lng>/index.ts` like any other area. The catalog test "registers every English feature file in
  the catalog index" forces that registration, which also gives the store text the normal
  key/placeholder parity check (`validateCatalog`).
- `scripts/manifestLocales.ts` converts (pure; `readManifestCatalogs` is the only fs read). WXT
  hook `build:publicAssets: (_wxt, files) => files.push({ relativeDest, contents })` — a
  `GeneratedPublicFile`. It runs inside `buildEntrypoints`, so `wxt build`, `wxt zip` and the
  dev server's first build all get it; nothing lands in `src/public`, nothing is committed.
  WXT's generated `.wxt/types/i18n.d.ts` reads `publicDir/_locales` only, so these messages are
  untyped for `browser.i18n` (unused: the app uses i18next).
- Folder names: hyphen to underscore (`pt_BR`, `zh_CN`); all 18 shipped codes are on Chrome's list.
  Chrome reads `$name$` as a placeholder, so a literal `$` is written `$$`.
- `chrome.commands.getAll()` returns `""` as `_execute_action`'s description even when the
  manifest sets one: Chrome shows its own label there. Firefox may use it.
- Unit test imports the real `wxt.config.ts` and calls `config.manifest({ mode, browser, ... })`.
  Two traps: `vite` is not a direct dependency of the extension (pnpm links it for wxt only), so
  the import fails unless the test `vi.mock("vite", () => ({ loadEnv: () => ({...}) }))`; and a
  literal `import("../../../../wxt.config")` drags wxt.config.ts into `tsc`'s program, where the
  same `vite` import fails type-check. A computed path (`path.join(root, "wxt.config.ts")` with
  `/* @vite-ignore */`) keeps tsc out. Restore `process.env.NODE_ENV` after the import (the config
  sets it at load time). The Firefox beta branch throws without a `VITE_WEB_APP_URL`, so the
  mocked `loadEnv` returns one.
- Checking resolved strings: load the scratchpad build with Playwright (`--headless=new`,
  `--load-extension`, `--lang=de`) and evaluate `chrome.i18n.getMessage` /
  `chrome.commands.getAll()` in the service worker. `--lang` is honored on Windows. Run the node
  script with cwd `packages/extension/e2e` so `@playwright/test` resolves.

Related: [[learnings-i18n-i18next]], [[learnings-in-app-confirm-and-backup-file-location]] (outDir probe build).
