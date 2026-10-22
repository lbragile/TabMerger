# RTL catalog translation gotchas (Hebrew, applies to ar/fa too)

- `>` and `<` are bidi-mirrored glyphs: in an RTL run, a typed `>` already renders pointing left. Keep "Settings > Data" as `>` in the translation. Typing `<` instead is wrong twice: it renders pointing right, and in ICU (next-intl) a bare `<` starts a rich-text tag.
- `→`/`←` are not mirrored glyphs, so copy arrows meaning "next/into" must be swapped by hand (`→` becomes `←`).
- Copy naming a physical side or arrow key follows the mirrored layout: "the list on the left" becomes "on the right", "Left arrow chooses a group" becomes the Right arrow, toasts "bottom-right" become bottom-left. "Right-click" stays right-click (it is the mouse button).
- Chrome's tab strip mirrors too, so the context-menu "Save tabs to the left/right" swap meanings.
- Web catalogs: an ASCII apostrophe before `{ } < > # |` starts ICU quoting. Use the Hebrew geresh `׳` (U+05F3) for abbreviations like `דק׳`.
- Hebrew plurals are `one`/`two`/`other` (ICU 78, no `many`). Web ICU branches may add `two` freely (the catalog test compares argument names, not branches); an English message with a bare `{count}` (e.g. "{count}h ago") can become a plural argument in the translation.
- Extension (i18next) keys like `description_tab_one` are plural families with base `description_tab`; `imported_skipped` / `practiceKept_tabs` are plain keys (suffix is not a CLDR category).
- The extension catalog test only covers registered locales; run `validateCatalog` from `src/locales/validate.ts` directly (Node 24 strips the TS types) to check an unregistered folder.
