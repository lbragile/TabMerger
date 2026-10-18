---
name: learnings-language-picker
description: Extension language choice (header menu + Settings row) — two-store design for no-flash startup and the background worker, reconcile direction, module-scope shared reads breaking mocked tests, Button svg sizing
metadata:
  type: reference
---

Language choice lives in `src/lib/localePreference.ts`, not AppSettings (per device, never synced).

- **Two stores.** `localStorage['tabmerger-locale']` is read synchronously by `initI18n` (via
  `initialUiLanguage()`), so the first popup render is already in the chosen language.
  `chrome.storage.local['tm_locale']` is for the background worker (no localStorage in an MV3
  SW). `saveLocalePreference` writes both; `auto` removes both keys.
- **chrome.storage wins.** `lib/i18nReact.ts` calls `reconcileLocalePreference()` after init: if
  localStorage differs from chrome.storage it is overwritten and the stored choice applied. So an
  e2e/manual test that sets only localStorage gets reset to "Browser default" on load: set both.
- **Background.** `followLocalePreference(scheduleMenuRebuild)` reads the stored choice, applies
  it, follows `storage.onChanged`, and returns `ready`. Handlers that can WAKE the worker
  (reminder `onAlarm`, SYNC_NOW reply, Quick Save group name) `await localeReady` first, or their
  text comes out in the browser language.
- **Apply** = `applyLocalePreference(pref)`: `changeLanguage(resolveLocale(pref|browser))` +
  `applyDocumentLocale()`; returns whether the language changed (`auto` goes back to the browser
  language, it is never "stuck" on the last explicit one).
- **Settings vs header.** Header `LanguageMenu` applies at once (`useLocalePreference().choose`);
  the Settings row is a draft saved by "Save changes" (`useLanguageSetting`), and its saved value
  is the same stored choice, so an untouched draft follows changes made elsewhere.
- **Module-scope reads of `@tabmerger/shared` in anything the i18n setup imports break every test
  that `vi.mock`s that package without the export** (vitest v4 throws on reading a missing mock
  export). `LOCALE_PREFERENCE_CHOICES` as a constant failed 41 encryptionKey tests; it is a
  function (`localePreferenceChoices()`) now.
- `ui/button.tsx` has `[&_svg]:size-4`: every lucide icon inside a `<Button>` renders 16px no
  matter its `h-3.5 w-3.5`. Header icons only match when all of them sit inside `Button`.
- Tour targets: every task selector is a `data-tour` anchor (`window-star`, `window-menu`,
  `window-open`, `group-deduplicate`, `dedup-confirm`, `search-clear`); `markTourLabels` /
  `data-tour-label` are gone. A unit test fails any tour selector containing `aria-label="`.
  The tourV2 e2e "in another language" test reloads the popup in German mid-tour (resume works).
