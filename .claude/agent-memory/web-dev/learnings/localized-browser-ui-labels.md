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
- **More keys:** `browser/browser/tabContextMenu.ftl`: `tab-context-close-duplicate-tabs` ("Close Duplicate Tabs"), `tab-context-unload-n-tabs` (take the `[1]` variant, else `[one]`, for "Unload Tab"). Spanish is `es-ES`. `hi-IN` lacks both keys (English). The en-US source lives in `mozilla-firefox/firefox` under `browser/locales/en-US/`.
- **Chrome Help quirks:** `hl=zh-CN` answers a 301 to `hl=zh-Hans`; curl without `-L` saves the redirect page, so fetch `zh-Hans` directly. Page 12929150 (Personalize performance) labels Settings/Performance/Performance issue alerts/Memory Saver as `<strong>`. On 2391819 "Tab Search" is plain text (an icon label), not `<strong>`, and the de/es/fr/it versions lack the Ctrl+Shift+A paragraph; use the "From the tab strip, select Tab Search" step. Strip `<style>` as well as `<script>` before searching the text, or CSS class names match.
- **Chrome tab groups:** 2391819 ("Manage tabs") has every tab-group label: Add tab to group, New group, Remove from group, Close group, ⋮ → Tab groups, Settings "Appearance", Show tab groups in bookmarks bar, the pin setting, Delete group, Ungroup. `hl=zh-CN` answers 301 to `hl=zh-Hans` (curl without `-L` saves the redirect page). fa, iw and hi serve an older revision (different line count) and fa mixes برگه/زبانه and two names for Grid; use the variant in the step that names the menu item.
- **Help wording can lag the UI.** The help names the pin setting "Automatically pin new tab groups to the bookmarks bar"; Chrome 157's real label (and its localized .pak strings) adds "created on any device". Use the help's localized string as the label and the exact English UI label as the gloss. The .pak grep (see [[blog-post-authoring-verification]]) shows the difference.
- **Chrome's word for "tab" isn't always the searched word:** pt-BR Chrome says "guia" (search and our prose: "aba"), vi "thẻ" ("tab"), fa "برگه" ("زبانه"). Keep the help label verbatim for UI names and name the Chrome term once in the prose.
- **Firefox tab groups** (`browser/browser/tabbrowser.ftl`): `tab-group-editor-action-save` ("Save and close group"), `tab-context-move-tab-to-group-saved-groups` ("Closed Groups"). hi-IN lacks both (English); ar renders "Closed Groups" as الألسنة المغلقة.

## Writing convention (from de/es/fr)

- First body mention: localized label plus the English in parentheses; later mentions use the localized label only. Settings paths use localized segments plus the English path in parentheses.
- Captions and alt text keep the on-screen English name (screenshots are English UI) with the localized label in parentheses. The alt in the `post.images` array and on the figure must stay identical, so edit both.

## RTL (ar, fa, he)

- Keep existing `<bdi>` / `<bdi dir="ltr">` wrappers. A localized RTL label needs none; any English label, path or shortcut inside RTL text gets `<bdi dir="ltr">…</bdi>`, including new English glosses.
- Arabic, Persian and Hebrew localized paths use ← between segments. A mixed Edge path reads `**الإعدادات** ← <bdi dir="ltr">**Start, home, … → Open tabs from the previous session**</bdi>`.
- Persian strings contain ZWNJ (U+200C). Copy them from the .ftl/help source byte for byte; an edit script can use a `‌` constant.
- Don't add U+200E/U+200F inside `export const post` fields (title, description, faq, images alt, …): they caused a generated-index mismatch before. Marks already there (fa uses U+200F after the Persian comma) are left alone. Body text may use them.

## CJK bold (ja, zh-CN, ko)

CommonMark won't close `**` that comes right after punctuation and right before a letter: `**使用会话管理器。**它能` renders with literal asterisks, and MDX compiles it without complaint. Put the full stop outside (`**使用会话管理器**。它能`). To catch it, compile each locale and look for `**` inside the compiled string literals. Bold before `（`, `、` or `<Kbd>` is fine.

## Writing 17 files without 17 hook runs

A 15 KB MDX body in a Bash heredoc failed ("unexpected EOF while looking for matching `'`"). Instead, write each draft with Write into the scratchpad (hooks only fire for `packages/web/` paths), check them there, then copy them into place with one node script. For Persian, write `{ZW}` and replace it with U+200C in that script. `en.mdx` is CRLF in the working tree, so any comparison script must normalise line endings.

## Checks

`pnpm --filter @tabmerger/web exec vitest run __tests__/blog-posts`, `pnpm --filter @tabmerger/web lint`, and an `@mdx-js/mdx` `compile()` of each locale from a scratch script outside the repo.

- Import the compiler by absolute path from `node_modules/.pnpm/@mdx-js+mdx@<ver>_.../node_modules/@mdx-js/mdx/index.js` (the web package only links `@mdx-js/loader`).
- `compile()` succeeds even when `**` fails to become bold (CJK or Arabic text next to punctuation). Count `_components.strong` in the output against the `**` pairs in the body; they should match.
- A scratch verifier that evaluates the `export const post` block, compares the fixed fields with English, checks each figure alt against `post.images`, and checks that every help label exists verbatim in both the file and the extracted help text caught label drift (verb forms used where the label was meant) and broken Persian ZWNJ before any repo hook ran.
- Working-tree `.mdx` files are CRLF (`core.autocrlf=true`, LF in the index). Normalise `\r\n` before splitting on `\n}\n`, and write new files with CRLF to match their neighbours.
