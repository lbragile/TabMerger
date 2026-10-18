---
name: learnings-i18n-i18next
description: Extension UI copy runs on i18next + react-i18next with JSON catalogs per feature; gotchas for typed keys, init order, DOM selectors, pseudo-locale, tests and e2e
metadata:
  type: reference
---

Extension i18n (packages/extension) uses i18next + react-i18next, not chrome.i18n / `_locales`.

- Catalogs: `src/locales/en/<area>.json`, merged under one `translation` namespace in
  `src/locales/en/index.ts` (key `header.undo` = `header.json` → `undo`). Typed through
  `src/i18next.d.ts` (`CustomTypeOptions.resources`), so a missing key fails tsc. The index's JSON
  imports carry `with { type: 'json' }`: e2e (Playwright, plain Node ESM) imports
  `src/lib/tourSteps.ts`, which reaches the catalog, and Node refuses JSON without it.
- `initI18n()` (src/lib/i18n.ts) is synchronous (`initAsync: false`). Popup and site-access import
  `@/lib/i18nReact` FIRST in main.tsx; background calls `initI18n()` at the top of
  `defineBackground`. Never call `t()` at module scope: background-imported modules evaluate before
  init. Tables indexed by a code use `lazyMessages({...})` (getters), tour steps use getters, and
  exported message constants became functions (`dndSaveFailedText()`, `openFailedMessage()`).
- `t` from `react-i18next`'s hook in components; `t` from `@/lib/i18n` elsewhere. Overloaded
  `Parameters<typeof t>[0]` is useless for key types: use `MessageKey` (= i18next `ParseKeys`).
- Plurals: `key_one`/`key_other` + `{ count }`; English `0` is `other`, so a "No results" zero form
  needs its own key. Variants: i18next `context` (`imported` / `imported_skipped`,
  `description_tab_one`), typed fine without a base key.
- Code that FOUND elements by English accessible names broke under translation: DnD grips now
  carry `data-dnd-grip="tab|window|group"` (`lib/dndGrip.ts`), the selection toggle is found by
  `data-tour="select-items"`. Tour selectors for window menu/star build their aria-label from `t()`
  at use time.
- Pseudo-locale `en-XA`: generated at runtime from en (`lib/pseudoLocale.ts`) only when
  `import.meta.env.DEV && VITE_PSEUDO_LOCALE === '1'` (`pnpm build:dev:pseudo`, own outDir
  `chrome-mv3-pseudo`). The pseudo catalog is built inside initI18n's DEV branch and passed to
  `buildI18nOptions`, so store bundles contain none of it (grep `en-XA` to verify; a plain dev build
  drops it too because the env value is a constant).
- Guards: ESLint `react/jsx-no-literals` (symbols allow-listed) + `no-restricted-syntax` for copy
  attributes, toast string/template args and `? '' : 's'` plurals. Catalog test
  (`src/locales/validate.ts`) checks keys, `{{placeholders}}`, `<Trans>` tags and
  `Intl.PluralRules` forms per language; a parity test keeps copy duplicated in @tabmerger/shared
  identical.
- Tests: setup files call `initI18n(initReactI18next)` with the real catalog (no t() mock). A test
  `vi.mock` factory of a module whose helper changed (e.g. `skippedContext`) must follow the rename.
- The worktree `.env.local` sets an http extra web origin: run unit tests with
  `VITE_EXTRA_WEB_APP_URLS=""`, demo builds with `VITE_EXTRA_WEB_APP_URLS=" "`.
