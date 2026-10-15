---
name: uninstall-survey-url
description: runtime.setUninstallURL wiring (lib/uninstallSurvey.ts) — which builds register it, how channel/browser/e2e are detected, @types/chrome overload gotcha
metadata:
  type: reference
---

`src/lib/uninstallSurvey.ts` `registerUninstallSurvey()` is called on every background worker start
(not only `onInstalled`: the version in the URL changes on update). URL built by
`buildUninstallSurveyUrl` in `@tabmerger/shared` (`uninstallSurvey.ts`).

- **Channel:** there is no "is beta" helper in `src/`; the only signal is `import.meta.env.MODE === 'beta'`
  (same as `wxt.config.ts` `getExtensionName`). The manifest version is sent as is (beta carries the
  `BETA_STORE_MAJOR_OFFSET`, e.g. `4.1.0.6`); `__TABMERGER_VERSION__` is the un-offset semver if ever wanted.
- **Browser:** `import.meta.env.BROWSER` (WXT global, `-b chrome|firefox|edge`). `vi.stubEnv('BROWSER', ...)` works in vitest.
- **Which builds register:** every build except the demo-video build (`VITE_DEMO_BUILD === 'true'`).
  Development builds register too, against their local `VITE_WEB_APP_URL` (survey opens on localhost
  when a dev build is removed) with channel `stable` (the shared parser only accepts `stable`/`beta`).
- **E2E is unaffected.** No e2e build flag exists; local e2e loads the `development` build
  (`.output/chrome-mv3-dev`), so it now registers, but setUninstallURL only stores a URL. Nothing in
  `e2e/` uninstalls (no `chrome.management` calls), and closing a Playwright persistent context is
  not an uninstall, so the survey tab never opens and `context.pages()` counts are untouched.
- **No getter** for the uninstall URL exists in Chrome or Firefox, so there is no honest e2e assertion.
- **TS gotcha:** `setUninstallURL.call(chrome.runtime, url)` picks the callback overload ("Expected 3
  arguments"); call `chrome.runtime.setUninstallURL(url)` directly and `.catch` the returned promise if any.
