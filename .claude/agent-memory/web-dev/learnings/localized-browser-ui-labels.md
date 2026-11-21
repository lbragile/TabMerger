# Localized browser UI labels in translated blog posts

Translated posts name browser settings and menus. Every localized label must come from an official source, never memory or machine translation.

## Where verified strings come from

- **Firefox:** Mozilla's l10n repo, `https://raw.githubusercontent.com/mozilla-l10n/firefox-l10n/main/<loc>/<path>.ftl` (codes: `hi-IN`, `ja` / `ja-JP-mac`, `zh-CN`, otherwise the bare language). Useful keys:
  - `browser/browser/preferences/preferences.ftl`: `pane-home-startup-title2` ("Home and startup"), `startup-group` ("Startup"), `startup-restore-windows-and-tabs` ("Open previous windows and tabs"), `pane-general-title` ("General").
  - `browser/browser/menubar.ftl`: `menu-history`, `menu-history-undo-menu` / `menu-history-undo-window-menu` ("Recently Closed Tabs/Windows"), `menu-bookmarks-manage`, `menu-bookmarks-all-tabs`.
  - `browser/browser/appmenu.ftl`: `appmenuitem-settings` ("Settings").
  - `browser/browser/places.ftl`: `places-library3` (Library window title; e.g. tr "Arşiv", zh-CN "我的足迹").
  - `toolkit/toolkit/about/aboutAddons.ftl`: `addon-manage-extensions-shortcuts` ("Manage Extension Shortcuts").
  - A key missing from a locale's file means Firefox shows the English string (Fluent falls back to en-US). Keep English there (e.g. `id` and `hi-IN` lack `pane-home-startup-title2`; `hi-IN` lacks the restore option).
- **Chrome:** Google Chrome Help per language, `https://support.google.com/chrome/answer/<id>?hl=<code>&co=GENIE.Platform%3DDesktop` (Hebrew is `iw`). Pages: 95314 (Settings, On startup, Continue where you left off), 188842 (Bookmark Manager), 95589 (History). UI labels are the `<strong>` runs inside `article-container`, which curl returns server-rendered. No help page uses "Bookmark all tabs" or "Recently closed" as a UI label. Some pages are inconsistent: hi uses two different strings for "On startup", and ja spells マネージャ both with and without the trailing ー. Prefer the variant in the step that names the target option.
- **Edge:** Microsoft Support `https://support.microsoft.com/<ll-cc>/edge/change-your-browser-home-page`. hi-in and fa-ir serve English. Several localized versions are visibly machine-translated (ru splits "Settings and more" into «"Параметры" и "Другое"»), so the option names aren't reliable UI labels. Convention: localize only the Edge "Settings" segment and keep the sub-labels in English, as de/es/fr/it/pt-BR/pl do.
- Chrome History "By date" / "By group" (new in 157) have no localized source yet; they stay English.

## Writing convention (from de/es/fr)

- First body mention: localized label plus the English in parentheses; later mentions use the localized label only. Settings paths use localized segments plus the English path in parentheses.
- Captions and alt text keep the on-screen English name (screenshots are English UI) with the localized label in parentheses. The alt in the `post.images` array and on the figure must stay identical, so edit both.

## RTL (ar, fa, he)

- Keep existing `<bdi>` / `<bdi dir="ltr">` wrappers. A localized RTL label needs none; any English label, path or shortcut inside RTL text gets `<bdi dir="ltr">…</bdi>`, including new English glosses.
- Arabic, Persian and Hebrew localized paths use ← between segments. A mixed Edge path reads `**الإعدادات** ← <bdi dir="ltr">**Start, home, … → Open tabs from the previous session**</bdi>`.
- Persian strings contain ZWNJ (U+200C). Copy them from the .ftl/help source byte for byte; an edit script can use a `‌` constant.
- Don't add U+200E/U+200F inside `export const post` fields (title, description, faq, images alt, …): they caused a generated-index mismatch before. Marks already there (fa uses U+200F after the Persian comma) are left alone. Body text may use them.

## Checks

`pnpm --filter @tabmerger/web exec vitest run __tests__/blog-posts`, `pnpm --filter @tabmerger/web lint`, and an `@mdx-js/mdx` `compile()` of each locale from a scratch script outside the repo.
