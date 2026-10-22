---
name: learnings-language-picker-search
description: Searchable language pickers (header + Settings) — Popover + combobox/listbox instead of Radix menu/Select, height cap, scroll-to-current, two-name rows with RTL mark, test helpers
metadata:
  type: reference
---

`src/components/LanguagePicker.tsx` is shared by `Header/LanguageMenu.tsx` and
`Settings/LanguageSetting.tsx` (see [[learnings-language-picker]] for storage).

- **Popover, not DropdownMenu/Select:** a Radix menu's typeahead and focus-on-hover fight a text
  field inside it, and a Select can't host one. Focus stays in the input (`role="combobox"`,
  `aria-activedescendant`); options are `role="option"` with `aria-selected` = current choice.
  Radix Popover returns focus to the trigger on close; Escape is the Popover's own.
- Height cap: `max-h-[min(24rem,var(--radix-popover-content-available-height))]` + `collisionPadding`,
  list `min-h-0 flex-1 overflow-y-auto`, search row `shrink-0` (stays on top).
- **Scroll to the current choice manually** (offsetTop vs scrollTop on a `relative` list), re-run in a
  ResizeObserver: `scrollIntoView` on mount ran before the popper capped the height, so the checked
  row was off-screen; it can also scroll the page.
- Filtering, names and RTL come from `@tabmerger/shared` (`filterLocales`, `localeNameIn`,
  `isRtlLocale`), shared with the web picker. Browser default is always first, outside the filter.
- Rows: fixed check column, native name (`lang` + `dir=auto`, `data-native`), muted UI-language
  name, fixed end slot with `PilcrowLeft` (`data-rtl-mark`, `title`) for RTL languages. Accessible
  name "עברית, Hebrew, Right-to-left" (sr-only commas).
- Tests: match options with `native = (n) => new RegExp(`^${n}(,|$)`)`, read names from
  `[data-native]`, and the `lang` attribute is on `[data-native]`, not on the option. The Settings row
  is a button (`data-testid="settings-language"`, name "Language <value>"), no longer a combobox.
- **Accessible names of flex rows:** Chromium (and screen readers) put a space between flex items,
  so separate spans read "Deutsch , German". The option gets one `aria-label` joined with ", ".
- **Placeholder fit:** an input's `scrollWidth` ignores placeholder overflow in Chromium. Measure a
  hidden span with the input's computed `font`/`letter-spacing` against clientWidth minus padding;
  the e2e loop in `language.spec.ts` does this for every locale in both pickers. Copy is identical
  to the web switcher's `searchPlaceholder`/`searchLabel` (two-part example "German, de").
- `formatList`/`formatAndList` wrap each item in U+2068…U+2069 when the UI is RTL, so Latin items
  ("a.com, b.com") keep their order; LTR output is unchanged.
