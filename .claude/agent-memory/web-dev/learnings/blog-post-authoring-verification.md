---
name: blog-post-authoring-verification
description: Verifying blog facts and capturing screenshots headless — branded Chrome ignores --load-extension, extension shortcuts silently "Not set", SUMO captcha vs Firefox omni.ja, Google help hidden text, date-dependent tests, scheduled-post links, unstyled code fences
metadata:
  type: reference
---

**Loading TabMerger into a headless browser.** Branded Chrome (157) ignores `--load-extension`,
even with `--disable-features=DisableLoadExtensionCommandLineSwitch`: no extension, no error. Edge
(158) still loads an unpacked build, and so does Playwright's bundled Chromium (149 at the time).
So `chrome://extensions/shortcuts`-style captures come from Edge (`tier1Native.mjs`), and TabMerger
popup captures from bundled Chromium (`tm/*.spec.ts`). Build the production extension into the
scratchpad with the wxt `-c` wrapper ([[shared-date-format-and-scratch-extension-build]]) and pass
its absolute path as `TM_E2E_EXT_DIR`.

**Suggested extension shortcuts can silently not apply.** A manifest `suggested_key` that clashes
with a browser shortcut is left "Not set" on the shortcuts page; nothing is logged. Edge 158 left
Ctrl+Shift+P/K/U unset (it uses them for print-with-system-dialog, duplicate tab, Read Aloud);
Chromium 149 left P unset. Read the page's `ariaSnapshot()` ("Shortcut set: ..." vs placeholder
"Not set") rather than trusting the manifest.

**Firefox facts without the Mozilla help site.** support.mozilla.org serves a captcha to headless
browsers (Chrome UA spoofing and the SUMO API both hit it). Firefox's own build is authoritative
instead: `browser/omni.ja` in the install folder is a zip that `unzip` reads with warnings (Python's
`zipfile` refuses it). Key bindings are `<key>` elements in
`chrome/browser/content/browser/browser.xhtml` (`modifiers="accel,shift"` + a `data-l10n-id`
whose `.key` is in `localization/en-US/browser/browserSets.ftl`); menu and dialog wording is in the
other `localization/en-US/browser/*.ftl` files. Cite the help page in `sources` with a `note`
saying the entry was read from the build.

**Google Help pages hide most of their text from `innerText`** (collapsed sections). Collect
`textContent` per `h1..h4, p, li, td` inside `main`/`article` instead. Microsoft Support URLs
often 404 after a rename; the Edge settings pages themselves (`edge://settings/...`) are a
reliable source for setting names and defaults (fresh profile = defaults).

**Posts going live break date-blind tests.** Posts are live from 00:00 UTC on `published`; a test
run in the evening (US time) is already "tomorrow". A sitemap test that listed the live posts by
name broke the day the next post went live. Freeze the clock in such tests
(`vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime`), or derive the expectation from
`indexableSlugs()`.

**Scheduled posts:** the index, tag pages, sitemap, llms.txt and prev/next all hide them in every
mode; only the post URL works in dev/preview (with the banner). Links *to* them from live posts go
through `isScheduledPostLink` in `PostLink`: plain text on production until the date.

**Post body gotchas:** fenced code blocks render unstyled and overflow (no `pre` style in
`POST_ELEMENTS`); use inline code. `ThemedScreenshot` works outside a `Carousel`. Images from
another post (`/blog/<other-slug>/...`) may be reused, and keep that post's recorded boxes
(`figureBoxes` reads the slug from the path). A running `next dev` picked up new posts without a
restart once `generated/blog.ts` was rewritten (by `type-check`), since Turbopack watches it.

**Chrome and Edge UI wording from the installed build.** `<install>/<version>/Locales/en-US.pak`
holds the browser's UI strings uncompressed: `grep -a -o "Move tabs to another window"` confirms a
menu label exists in that exact version (absence is weaker evidence). Edge 158 and Chrome 157
were checked this way for "Search tabs", "Send tab to your devices", "Export favorites", "Tabs from
other devices". It proves the label, not where the item sits; don't invent the menu path.

**TabMerger capture gotchas.** The sidebar row's menu (right-click the group) and the main pane's
`⋯` menu differ: "Open all in new window" and Now Open's "Close all windows" exist only in the
sidebar menu. Tabs the extension opens itself (`chrome.windows.create({ url })`) load before
Playwright's `context.route` stubs apply; `goto(page.url())` each new page to reload through the
stubs. In TabMerger search an unquoted `group:` value takes the rest of the line, so a filter
plus words needs quotes (`group:"Work" pull`).

**llms.txt mirrors the sitemap.** `llms-txt.test.ts` checks that every sitemap path is in
llms.txt, so blog listing pages that join the sitemap by date (indexable tag pages, later index
pages, /blog/tags) must be listed in `app/llms.txt/route.ts` too, with the same conditions.

**Capturing the web app itself for a post** (e.g. /share/demo): `next dev` draws its dev-mode
indicator (`nextjs-portal`) into screenshots; hide it with `page.addStyleTag({ content:
'nextjs-portal { display: none !important; }' })` before capturing. A brand-new post can 404 on
its very first request right after `generated/blog.ts` is rewritten; reload before judging.

**Don't trust the product's own marketing copy as evidence.** The share page's CTA once said a
shared collection "becomes a group" after installing; there was no import path in the code, so the
post (and later the CTA itself) say "open the tabs, then save them as your own group" instead.

**Feature semantics that are easy to get wrong in copy** (read from the extension source):
dragging a Now Open tab onto a saved group MOVES it (the real tab closes, Undo reopens it);
"Open all in new window" flattens the whole group into ONE new window and opens only http(s)
pages, while restoring a session reopens each saved window separately and first closes every open
window (those go to Recently closed). A session snapshots saved groups, never Now Open. Search
matches title/page title/address only (not notes), contiguous and case-insensitive.

**Capture details.** On Free with 4+ groups the "approaching the free limit" banner pushes the
layout and sits under overlays; close it (button "Dismiss") before shooting. A context-menu item
below the menu's fold still gets a measured box; `hover()` + `scrollIntoViewIfNeeded()` it first or
the box points at nothing visible. For TabMerger-only posts `testedOn` names the Playwright
Chromium build (version from `%LOCALAPPDATA%/ms-playwright/chromium-*/chrome-win64/*.manifest`),
not a branded browser that wasn't used.

**Series pillars and not-yet-written posts.** The blog-posts link test rejects `/blog/<slug>` for a
slug with no post folder, so a pillar can only link posts that exist; name later ones as plain
text and link them when they land. Avoid `&quot;` in MDX JSX attribute strings (alt text): reword
instead.

Related: [[blog-covers-build-time]], [[blog-mdx-turbopack]], [[verify-competitor-facts-on-official-sites]].
