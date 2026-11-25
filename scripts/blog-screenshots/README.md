# Blog screenshots

Capture scripts for the screenshots in `packages/web/public/blog/<slug>/` (first used for
`save-all-open-tabs`). Every image is a real capture of the current software; annotation boxes are
HTML overlays in the post, never painted into the pixels, and their positions are measured from the
live DOM at capture time (`boxes.json`, below), never by hand.

| File | What it does |
| --- | --- |
| `native.mjs <out> [chrome] [edge]` | Opens Chrome and Edge headless with a fresh profile, visits a few stubbed pages (real URLs, real favicons), makes the "Tab manager research" bookmark folder through `chrome.bookmarks`, picks the startup option, and saves the bookmarks, startup and History pages as PNGs (2x), each with its measured boxes. `BLOG_ARIA_DUMP=1` also writes each page's accessibility tree (`<shot>.aria.yml`) for finding a locator. |
| `tm/blogShots.spec.ts` | Playwright spec for the TabMerger popup (800×600 at 2x): Now Open, Merge with current, the merged group, Save session, the session view, Recently closed, search, Settings → Data, each with its measured boxes. Theme from `BLOG_THEME` (`light`/`dark`), output folder from `BLOG_OUT`. Reuses `packages/extension/e2e` fixtures and helpers. |
| `boxes.mjs` | Shared box code: `recordBoxes` (capture side) and `toImageBoxes` (convert side). |
| `convert.mjs <in> <out> [boxes.json]` | Crops (table `CROPS`) and converts each PNG to WebP at quality 0.86, at most 1600px wide, with Chromium's canvas encoder (no extra dependency), and writes the post's `boxes.json` (default `packages/web/content/blog/save-all-open-tabs/boxes.json`). Image sizes go to `<in>/sizes.json`. |
| `composite.mjs <out> [images] [boxes.json]` | Draws `boxes.json` on the images (one PNG per image plus a 2x close-up per box) for checking by eye. |
| `run.mjs [raw] [out]` | Runs native, the spec (both themes) and convert in order. |
| `tier1Native.mjs <out> [extension-dir]` | The Tier-1 posts' native captures, one folder per slug under `<out>`: Chrome's Performance (Memory Saver) and Appearance (tab groups) settings, Edge's Performance (sleeping tabs) settings and, with a built TabMerger passed in, Edge's `edge://extensions/shortcuts` (branded Chrome ignores `--load-extension`, Edge doesn't). |
| `tm/tier1Shots.spec.ts` | The Tier-1 posts' TabMerger captures, one test per post (`playwright.tier1.config.mjs`), into `BLOG_OUT/<slug>/`. Load a production build from anywhere with `TM_E2E_EXT_DIR=<absolute dir>`. Convert each folder with `convert.mjs <BLOG_OUT>/<slug> packages/web/public/blog/<slug> packages/web/content/blog/<slug>/boxes.json`. |
| `tm/tier2Shots.spec.ts` | The Tier-2 posts' TabMerger captures (`playwright.tier2.config.mjs`), same conventions as Tier 1; also saves the real Export JSON download to `BLOG_OUT/export-open-tabs/`. Both Tier specs share `tm/shotHelpers.ts` (context, stub pages, real windows and Chrome groups, `shot()`). |
| `tm/tier3Shots.spec.ts` | The Tier-3 posts' TabMerger captures (`playwright.tier3.config.mjs`): a favorites-HTML import, URL rules, tab notes and reminders, group selection for sharing. The share page itself (`/share/demo`) was captured from the running dev server with the dev indicator hidden. |
| `tm/seriesShots.spec.ts` | The "TabMerger guides" series (`playwright.series.config.mjs`), one test per post: sessions (save, view, the restore confirmation, which is always cancelled), auto-save settings and an auto-saved group, a closed window found with `closed:`, search (examples, results, the `window:` picker, Dim mode). Closes the Free-limit banner before shooting. |
| `tm/series2Shots.spec.ts` | Series batch 2 (`playwright.series2.config.mjs`): projects and the archive, notes/reminders/stale tabs, URL rules, import, Free limits, and real two-profile sync. Needs an extension built against the LOCAL Supabase stack (VITE_SUPABASE_URL/KEY and VITE_WEB_APP_URL passed as env vars) plus SYNC_EMAIL, SYNC_PASSWORD and SYNC_USER_ID for a local Pro seed user; it deletes that user's sync rows in the local database (docker exec) before running. Never point it at preview or production. |
| `tm/coverShots.spec.ts` | TabMerger covers of their own for posts whose index card reused another post's image (`playwright.covers.config.mjs`): firefox-tab-groups (windows with real browser tab groups merged into a new group, then closed) and move-tabs-between-computers (the ⋯ menu of a new, empty group with Merge with current focused). Seeds its own sidebar groups so the cards don't look like the others. |
| `coverNative.mjs <out> [chrome] [edge]` | Real browser pages as covers, 1600×1200, light and dark (Chrome with `--force-dark-mode`, Edge with its own Appearance theme), no boxes: Chrome Settings → Performance with Memory Saver on, Chrome's Bookmark manager with a folder, Edge's Favorites with folders in Other favorites (1280×960 at 1.25x, so the folder tree shows), Edge History → Recently closed after really closing tabs. Writes `<out>/<slug>/cover-<browser>-<theme>.png`; convert each folder into `public/blog/<slug>/`. |
| `og.mjs <slug> [stem]` | Renders the post's social card once, headless: `packages/web/public/blog/<slug>/og.png`, 1200×630 PNG under 1 MB (dark theme, title, `shareSummary`, logo, a framed crop of `<stem>-dark.webp` (default `tm-merged-group`), browser icons; 64px safe margins). There is no request-time image route: the site serves this file. Re-run it when the title, the summary or that screenshot changes. |

## Running

1. `pnpm build:extension` — the TabMerger captures use the **production** build in
   `packages/extension/.output/chrome-mv3`, never the dev build folder.
2. `node scripts/blog-screenshots/run.mjs` (raw PNGs go to `scripts/blog-screenshots/.raw/`,
   WebP files to `packages/web/public/blog/save-all-open-tabs/`).
3. Check every box: `node scripts/blog-screenshots/composite.mjs <scratch-dir>` and look at each
   composite and close-up (light and dark separately: their layouts can differ by a pixel or two).
   Then update the post's `testedOn` versions and any caption or alt text that names a time or date.

Re-run after any release that changes a screen the post shows.

## How boxes.json is made

`{ "<image file stem>": [ { "id", "label", "l", "t", "w", "h" } ] }`, with `l`/`t`/`w`/`h` as
`"..%"` strings of the final image, boxes in reading order (top to bottom, then left to right).
TabMerger images have one entry per theme (`tm-now-open-light`, `tm-now-open-dark`).

1. **Capture.** Each screenshot call lists its targets with accessible locators (role + name, e.g.
   `getByRole('button', { name: 'Restore session', exact: true })`). Right after the screenshot,
   `recordBoxes` reads each target's `boundingBox()` (which pierces the shadow DOM of
   `chrome://` pages) and writes `<shot>.boxes.json` next to the PNG: CSS pixels plus the device
   pixel ratio. A locator that matches nothing, or several elements without `all`/`each`, fails the
   run, so a renamed control can't silently box the wrong thing.
   - `fit: 'content'` boxes what the element draws (text, icons, coloured dots) instead of its
     layout box: used for full-width sidebar rows, whose layout box touches the image edge.
   - `each: true` gives one box per match (the search result's group tags); `all: true` one box
     around all of them; an array of locators one box around their union (the hour strip's bars
     plus its labels).
2. **Convert.** `toImageBoxes` applies the PNG's crop and scale to each box, adds padding of 0.8%
   of the image width on every side (12.8px on a 1600px image: 0.4rem of the popup at its real
   size), clamps to the image and writes percentages.
3. **Firefox** (`firefox-startup`) is captured with Firefox's own `-screenshot`, so there is no DOM
   to measure: its box is measured by hand on the raw PNG in `HAND_BOXES` (convert.mjs), without
   padding, and goes through the same mapping. Re-measure it whenever that capture changes.

Locator notes: Edge's favorites tree and its settings radios are web components whose roles live
in ElementInternals, which `getByRole` can't see, so those two use the component tag filtered by
the visible name (`fluent-tree-item`, `settings-radio-row`). The open TabMerger group menu marks
the rest of the popup `aria-hidden`, so targets behind it need `includeHidden: true`.

## Not automated

- **Firefox** (`firefox-startup`): captured by hand from `about:preferences#home`.
- Needs a visible browser window, so still to capture by hand: Chrome's "Bookmark all tabs"
  dialog, Firefox's Library with the folder, Firefox's History menu with recently closed tabs,
  and Chrome's tab-group right-click menu.

## Other languages

Not wired up yet. Chromium takes `--lang`, TabMerger reads `tm_locale` / `tabmerger-locale`, and
Firefox `intl.locale.requested`; a localised set would go to `public/blog/<slug>/<locale>/`.
