---
name: learnings-store-search-listing
description: Store-search copy rules per store (Chrome summary/keyword repeats, Edge search terms, AMO categories/tags), how to count keywords, and a Bash heredoc trap when scripting the counts on Windows
metadata:
  type: reference
---

- **Chrome Web Store** has no keyword field: search reads the name, the summary (manifest
  `description`, max 132, from `src/locales/<lng>/manifest.json` via `__MSG_extDescription__`) and
  the detailed description. Spam policy: no keyword more than about 5 times in the description.
  The count lives as an HTML comment under the description in `CHROMEWEBSTORE.md`; recount after
  every description edit (several phrases sit at exactly 5). "session" creeps up fastest: the
  Sessions section, the free-tier limit, sync, AI session suggestions and privacy all mention it;
  "snapshot" is the accurate substitute.
- The 132 limit is checked as JS `.length` (UTF-16 units) by `manifestLocales.test.ts`; Persian
  ZWNJ characters count. Japanese/Korean/Chinese summaries use about half the budget.
- **Edge** Partner Center: up to 7 hidden search terms, 30 chars each, 21 words total, per
  language. Not settable via the publish API.
- **AMO**: up to two categories; the list is public at `addons.mozilla.org/api/v5/addons/categories/`
  (extension categories include Tabs and Bookmarks). The predefined tag list is not readable outside
  the Developer Hub (no constants file in addons-server). AMO summary limit is 250.
- Claims to verify before writing copy: "save all open tabs from every window" is true through
  Duplicate on Now Open, Merge with current and Auto-save (the right-click/shortcut scopes are one
  window only); Ctrl/Cmd+K search lists recently closed tabs too (`SearchOverlayWithClosed`).
- Scripting trap: in this environment a Bash heredoc (`<<'EOF'`) dropped the backslashes from a
  Node script (regex `\b`, `\\.`), silently breaking it. Write scripts with the Write tool, or use
  line-based string ops without backslashes.

Related: [[learnings-store-locales-build-hook]].
