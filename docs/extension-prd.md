# TabMerger Extension — Product Requirements Document

> **Status:** Living document — source of truth for all extension behaviors, edge cases, and invariants.  
> **Scope:** Chrome MV3 extension popup (780×600 px fixed). All behaviors described here are verified against the current source code.

---

## Table of Contents

1. [Data Model](#1-data-model)
2. [Popup Layout & Shell](#2-popup-layout--shell)
3. [Now Open Group](#3-now-open-group)
4. [Group Management](#4-group-management)
5. [Window Management](#5-window-management)
6. [Tab Management](#6-tab-management)
7. [Search](#7-search)
8. [Selection Mode](#8-selection-mode)
9. [Drag and Drop](#9-drag-and-drop)
10. [Undo / Redo](#10-undo--redo)
11. [Settings](#11-settings)
12. [Import / Export](#12-import--export)
13. [Sessions](#13-sessions)
14. [URL Rules](#14-url-rules)
15. [Entitlements & Free Tier Limits](#15-entitlements--free-tier-limits)
16. [Keyboard Shortcuts](#16-keyboard-shortcuts)
17. [Edge Cases & Regression Guards](#17-edge-cases--regression-guards)

---

## 1. Data Model

### 1.1 Tab

```ts
interface Tab {
  id: number;           // 0 = saved copy (not live); > 0 = live Chrome tab ID
  title: string;
  url: string;
  favIconUrl?: string;
  ogImage?: string;     // Open Graph preview image URL fetched from content script
  pinned?: boolean;
  chromeGroup?: { id: number; name: string; color: string }; // Chrome tab group metadata
  note?: string;        // max 500 chars
  savedAt?: number;     // epoch ms — set when tab first lands in a saved group
  reminder?: { fireAt: number; note?: string };
  customTitle?: string; // user-set display title (overrides `title`)
}
```

**Invariant:** Saved tabs always have `id: 0`. Live tabs (in Now Open) have a real Chrome tab ID > 0. When a tab is copied from Now Open into a saved group, its `id` is set to 0. This prevents `useDeleteTab` from trying to close a browser tab that was already a saved copy.

### 1.2 ExtWindow

```ts
interface ExtWindow {
  id: number;        // Chrome window ID (Now Open) or synthetic ID (saved groups)
  tabs: Tab[];
  incognito: boolean;
  focused: boolean;  // true for the currently focused window in Now Open
  starred?: boolean; // pinned to top of the window list within its group
  name?: string;     // optional custom label for this window
  note?: string;
}
```

### 1.3 Group

```ts
interface Group {
  id: string;           // nanoid(10)
  name: string;
  color: string;        // rgba(r, g, b, 1) string
  updatedAt: number;    // epoch ms — used for cloud sync conflict resolution (last-write-wins)
  windows: ExtWindow[];
  permanent?: boolean;  // true ONLY for the Now Open group (index 0)
  starred?: boolean;    // pinned above non-starred groups (below Now Open)
  info?: string;        // cached summary string: "N windows · M tabs" — derived, not authoritative
  note?: string;
  pendingSync?: boolean; // local-only flag; not persisted to Supabase
  archived?: boolean;   // hidden from main sidebar; excluded from free-tier group count
}
```

### 1.4 GroupsState (IDB root object)

```ts
interface GroupsState {
  active: { id: string; index: number }; // which group is displayed in the main panel
  available: Group[];                    // all groups in display order
  urlRules?: UrlRule[];
}
```

**Active group persistence:** `active.index` is also written to the IDB `settings` store under key `'activeGroupIndex'` every time it changes, so the popup re-opens to the last-viewed group.

### 1.5 AppSettings (IDB key: `'appSettings'`)

```ts
interface AppSettings {
  theme: 'light' | 'dark' | 'system';  // default: 'system'
  confirmOnDelete: boolean;              // default: false
  syncEnabled: boolean;                  // default: true (only effective for Pro+)
  openTabOnClick: boolean;               // default: true
  autoDedupOnMerge: boolean;             // default: false
  staleThresholdDays: 7 | 14 | 30 | 60; // default: 30
}
```

### 1.6 Persistence Layer

| Store | Key type | Contents |
|---|---|---|
| `groups` | `id` (string) | One record per Group |
| `groupsState` | `'state'` | `{ active, order: string[] }` |
| `sessions` | `id` (string) | Saved session snapshots |
| `settings` | string | Any named setting; `'appSettings'` holds the full `AppSettings` object, `'activeGroupIndex'` holds the last active index |

**All reads go through TanStack Query** (`staleTime: 0` so the popup always gets fresh data on open). All writes go through `saveGroupsState` which atomically reconciles orphan groups.

---

## 2. Popup Layout & Shell

### 2.1 Overall structure

```
┌────────────────────────────────────────────────────────────────┐
│  Header (48px)                                                 │
│  [logo] [search input] [select] [undo] [redo] [settings] [AI] │
├──────────────┬─────────────────────────────────────────────────┤
│  SidePanel   │  Windows Panel (main content area)             │
│  (sidebar)   │                                                 │
│  Now Open    │  Window cards for the active group             │
│  Group A     │                                                 │
│  Group B     │                                                 │
│  …           │                                                 │
│  + Add group │                                                 │
├──────────────┴─────────────────────────────────────────────────┤
│  SelectionActionBar (only visible in selection mode)           │
└────────────────────────────────────────────────────────────────┘
```

### 2.2 Header

- **Logo:** TabMerger wordmark on the left.
- **Search input:** Text input that filters tabs in the active group. Placeholder: "Search tabs…". Keyboard shortcut `/` focuses it.
- **Select button:** Toggles selection mode. Label is "Select" when off, shows active selection count when on.
- **Undo / Redo buttons:** Enabled/disabled based on stack depth. Undo shortcut: `Ctrl+Z`. Redo shortcut: `Ctrl+Y` or `Ctrl+Shift+Z`.
- **Settings button:** Opens the Settings modal (gear icon).
- **AI button:** Only visible for `pro_ai` tier users. Opens AI features.

### 2.3 Sidebar (SidePanel)

- Fixed width on the left, scrollable.
- Lists all groups in `available` order.
- **Now Open** is always first, visually distinct (grey color accent).
- Each group item shows: color swatch, group name, badge (`<window count> ◆ <tab count>`).
- Clicking a group item makes it the active group.
- Right-clicking a group item opens a context menu.
- **Add group button** at the bottom. Hidden during an active sidebar DnD drag.
- Sidebar items are draggable for reordering (DnD handle visible on hover).

### 2.4 Windows Panel

- Displays windows for the active group.
- Scrollable vertically.
- Each window is a card with a header (window name, actions) and a tab list.
- **Add window button** near the bottom. Hidden during an active tab/window DnD drag.

---

## 3. Now Open Group

### 3.1 Invariants

| Property | Value |
|---|---|
| `permanent` | `true` |
| Index in `available` | Always 0 — immovable |
| `name` | `'Now Open'` (constant `FIRST_GROUP_TITLE`) |
| Deletable | Never — "Delete group" absent from context menu |
| Renameable | No |
| Moveable via DnD | No |
| Mutations pushed to undo stack | No |
| `id` written to cloud sync | No |

### 3.2 Population

On every popup open, `useCurrentTabs` queries `chrome.tabs.query({})` and `chrome.windows.getAll({ populate: true })` and replaces the Now Open group's `windows` in the cache. This is a `skipUndo=true` mutation — it never enters the undo stack.

### 3.3 Closing a live tab from Now Open

Clicking the × button on a tab in Now Open calls `chrome.tabs.remove(tab.id)` to close it in the browser. `useCurrentTabs` re-syncs and the tab disappears from the UI.

### 3.4 Badge

Shows real window and tab counts derived from the synced `windows` array, not a cached number. Format: `{windowCount} ◆ {tabCount}`.

### 3.5 Context menu for Now Open

Right-clicking Now Open shows a limited menu. **"Delete group" is absent.** Available options may include: "Rename" (no-op / blocked), group color picker (blocked), "Duplicate" (blocked or hidden). Exact available options: none of the destructive ones are present.

---

## 4. Group Management

### 4.1 Create Group

- **Trigger:** Clicking the "+ Add group" button in the sidebar footer.
- **Behavior:** Creates a group with `name = 'New'` (constant `DEFAULT_GROUP_TITLE`), `color = DEFAULT_GROUP_COLOR = 'rgba(128, 128, 128, 1)'`, one empty window, and a unique `nanoid(10)` ID. Appended to the end of `available`.
- **Undo:** Creation is pushed to the undo stack (standard mutation).
- **Entitlement gate:** Free tier: blocked when the user already has 5 non-archived groups. An upgrade prompt is shown instead.
- **Add button visibility:** Hidden during an active sidebar DnD drag (`isDraggingGroup = true`).

### 4.2 Rename Group

- **Trigger:** Double-clicking the group name text in the sidebar item.
- **UI:** The name text is replaced by an inline text `<input>` pre-filled with the current name.
- **Keyboard — commit:** `Enter` — saves the new name via `useUpdateGroupName`, commits to IDB, pushes undo.
- **Keyboard — cancel:** `Escape` — reverts to the original name without saving.
- **Empty string:** If the user clears the input and presses `Enter`, the original name is restored (empty group names are not permitted).
- **Space bar:** Must insert a space character. This is a key regression: `onKeyDown` must not call `e.preventDefault()` for space in rename inputs.
- **Click outside:** Commits the current value (same as Enter).
- **Concurrent rename:** Only one rename can be active at a time (`renameTarget` state in uiStore). Opening a rename elsewhere closes the previous one.
- **Now Open:** Cannot be renamed. Double-clicking its name does nothing.

### 4.3 Update Group Color

- **Trigger:** Context menu → color swatches (12 preset `rgba(…)` colors) or a custom color picker.
- **Behavior:** Updates `color` on the group record, pushes undo, persists to IDB.
- **Preset colors** (12 total): red, orange, yellow, green, cyan, blue, indigo, purple, pink, teal, gray, slate-dark.

### 4.4 Delete Group

- **Trigger:** Right-click context menu → "Delete group".
- **confirmOnDelete = false (default):** Deletion is immediate — no modal, group and all its windows/tabs are removed.
- **confirmOnDelete = true:** A `deleteGroup` modal is shown. User must click a "Confirm" / "Delete" button to proceed. Cancel dismisses the modal and leaves the group intact.
- **Side effect:** If any of the deleted group's tabs have URLs currently live in Now Open, those Chrome tabs are closed via `chrome.tabs.remove(tabIds)`.
- **Active index recalculation:** If the deleted group was the active group (`active.index === groupIndex`), the active index is decremented by 1 (but never below 0). If the deleted group was before the active group, active index is also decremented. If after, active index is unchanged.
- **Undo:** The deletion is pushed to the undo stack. Undoing restores the group at its original position.
- **Now Open:** Never deletable. "Delete group" is not present in its context menu.
- **Permanent groups:** `group.permanent === true` is a hard guard in `useDeleteGroup` — it returns early without mutating.

### 4.5 Duplicate Group

- **Trigger:** Context menu → "Duplicate".
- **Behavior:** Deep-clones the group, assigns a new `nanoid(10)` ID, sets `name = 'New'`, inserts immediately after the source group. `permanent = false` on the clone.
- **Undo:** Pushed to undo stack.

### 4.6 Star / Unstar Group

- **Trigger:** Context menu → "Star" / "Unstar"; or selection mode bulk star action.
- **Behavior:** Toggles `group.starred`. Re-sorts the `available` array into three zones:
  1. Now Open (index 0, always)
  2. Starred groups (in their relative order before the sort)
  3. Non-starred groups (in their relative order before the sort)
- **Active index:** Recalculated after the sort to keep pointing to the same group.
- **Undo:** Pushed to undo stack.

### 4.7 Archive / Restore Group

- **Archive trigger:** Context menu → "Archive".
- **Behavior:** Sets `archived: true`. The group disappears from the main sidebar.
- **Restore trigger:** An "Archived" section or view (exact UI location TBD per implementation).
- **Free tier:** Archived groups do not count toward the 5-group limit.

### 4.8 Context Menu Items (Saved Groups)

| Menu item | Now Open | Saved group |
|---|---|---|
| Rename | ✗ | ✓ |
| Color picker | ✗ | ✓ |
| Star / Unstar | ✗ | ✓ |
| Duplicate | ✗ | ✓ |
| Archive | ✗ | ✓ |
| Delete group | ✗ | ✓ |
| Add window | ✗ | ✓ |
| Sort tabs by title | ✗ | ✓ |
| Sort tabs by URL | ✗ | ✓ |
| Unite windows | ✗ | ✓ |
| Split windows | ✗ | ✓ |
| Update from current tabs | ✗ | ✓ |
| Merge with current tabs | ✗ | ✓ |
| Deduplicate | ✓ | ✓ |

### 4.9 Window Operations via Context Menu

- **Sort tabs by title:** Sorts all tabs within every window of the group alphabetically by title. Pushes undo.
- **Sort tabs by URL:** Sorts all tabs within every window alphabetically by URL. Pushes undo.
- **Unite windows:** Merges all windows into a single window; all tabs concatenated in order. Source windows beyond the first are discarded. Pushes undo.
- **Split windows:** Each tab becomes its own single-tab window. Pushes undo.
- **Update from current tabs:** Replaces the group's windows with a snapshot of the current Now Open windows. Stamps `savedAt` on any tabs that don't have it. Pushes undo.
- **Merge with current tabs:** Prepends a snapshot of Now Open windows to the group's existing windows. Pushes undo.
- **Deduplicate:** Removes duplicate tabs (by URL) within the group. For Now Open, closes duplicate Chrome tabs. Skips undo for Now Open.

### 4.10 Group Note

- **Trigger:** A note icon/area in the main panel for the active group.
- **Behavior:** Editable text area. Saves to `group.note` in IDB on blur or save action.
- **Undo:** `skipUndo = true` — note edits are too granular to track in the undo stack.
- **Persistence:** Survives popup close/open.

---

## 5. Window Management

### 5.1 Window Cards

Each window in the main panel has:
- A header with: optional name, star icon, incognito badge (if incognito), delete button, and a DnD handle.
- A tab list below the header.

### 5.2 Rename Window

- **Trigger:** Double-clicking the window name in the card header, or context menu → rename.
- **Behavior:** Inline text input. `Enter` commits, `Escape` cancels, empty string reverts to previous name. Space bar must work.
- **Undo:** Pushed to undo stack.

### 5.3 Delete Window

- **Trigger:** × button in the window card header.
- **confirmOnDelete = false:** Immediate deletion.
- **confirmOnDelete = true:** `deleteWindow` modal is shown. User must confirm.
- **Side effect:** If any of the window's tabs have URLs live in Now Open, those Chrome tabs are closed.
- **Deleting the last window:** The group is left with `windows: []` (an empty group). The group itself is NOT automatically deleted.
- **Undo:** Pushed to undo stack.
- **Window note:** If the window has a note, it is deleted along with the window.

### 5.4 Delete All Windows

- **Trigger:** Context menu (group level) or a "Clear all" action — sets `windows: []` on the group.
- **Side effect:** Closes any live tabs.
- **Undo:** Pushed to undo stack.

### 5.5 Star / Unstar Window

- **Trigger:** Star icon in the window card header; also via selection mode bulk star.
- **Behavior:** Toggles `window.starred`. Then `sortWindowsByStarred(windows)` is called: starred windows float to the top within the group, non-starred follow. Relative order within each zone is preserved.
- **Undo:** Pushed to undo stack.

### 5.6 Window Note

- Editable text area in the window card.
- Saved to `window.note` with `skipUndo = true`.

### 5.7 Toggle Incognito

- **For Now Open windows:** Opens a new browser window in the opposite incognito mode containing the same URLs; closes the old window. `useCurrentTabs` re-syncs. Restricted URLs (chrome://, about:, etc.) are excluded.
- **For saved group windows:** Only flips the `incognito` flag in IDB — no browser window interaction.

### 5.8 Add Window

- **Trigger:** "+ Add window" button in the main panel footer.
- **Behavior:** Appends an empty window to the active group.
- **Add button visibility:** Hidden during an active tab or window DnD drag (`isDraggingTab` or `activeWindow` is set).

### 5.9 DnD Reorder Windows

- Windows within a group can be reordered by dragging their DnD handle.
- Dropping above a starred window auto-stars the dragged window.
- Dropping below a non-starred window auto-unstars the dragged window.
- State persists to IDB.

---

## 6. Tab Management

### 6.1 Tab Display

Each tab row shows (left to right):
1. DnD grip handle (visible on hover, hidden in selection mode)
2. Favicon (16×16 px) or a placeholder icon
3. Tab title — if `customTitle` is set, shows `customTitle`; otherwise shows `title`; falls back to `url` if both empty
4. Chrome group badge (if `tab.chromeGroup` set) — color-coded, shows group name
5. "renamed" badge with pencil icon (if `tab.customTitle` is set)
6. Tab note button (sticky-note icon, only if `tab.note` is set and not in selection/edit mode)
7. Tab reminder button (clock icon, amber color, only if `tab.reminder` is set and not in selection/edit mode)
8. Lock icon (Pro gate) or selection checkbox (selection mode) or × delete button (normal mode)

### 6.2 Open Tab in Browser

- **Trigger:** Single click on the tab title (when `openTabOnClick = true`; default).
- **Behavior — saved group tab:** Opens the tab URL in a new browser tab (`chrome.tabs.create`). Tab is NOT removed from the group.
- **Behavior — Now Open tab:** Focuses the existing browser tab (brings it to front).
- **Restricted URLs** (`chrome://`, `about:`, `chrome-extension://`, `moz-extension://`): Cannot be programmatically opened. A click on a restricted URL does nothing / shows a toast error.
- **`openTabOnClick = false`:** Single click does NOT open the tab. Tab title must be clicked to navigate (no effect; user must use the external-link icon explicitly).

### 6.3 Rename Tab (Custom Title)

- **Trigger:** Double-clicking the tab title text.
- **UI:** An inline `<input>` replaces the title text, pre-filled with the current display title (custom title if set, otherwise original title).
- **Keyboard — commit:** `Enter` — saves. If non-empty, sets `tab.customTitle`. If empty, clears `customTitle` (reverts to original `title`).
- **Keyboard — cancel:** `Escape` — discards changes, restores previous display.
- **Space bar:** Must insert a space character. A previous regression caused spaces to be swallowed. This is tested explicitly.
- **Post-save UI:** A "renamed" badge (pencil icon + "renamed" text in primary color) appears on the tab row.
- **Persistence:** `customTitle` is stored in IDB on the Tab object. Survives popup close/open.
- **Undo:** The rename is pushed to the undo stack.
- **Empty string submitted:** Clears `customTitle`, reverts display to the original `title`.

### 6.4 Delete Tab

- **Trigger:** × button on the tab row (visible on hover, hidden in selection/edit mode).
- **confirmOnDelete:** Tab deletion is **always direct — no modal, regardless of `confirmOnDelete` setting.** This is an explicit design decision.
- **Side effect (saved group tab):** If the tab's URL is currently live in Now Open, the corresponding Chrome tab is closed via `chrome.tabs.remove(tab.id)`. Check is against URL match in Now Open's tab list, not tab ID.
- **Side effect (Now Open tab):** Closes the Chrome tab immediately.
- **Auto-collapse empty window:** If deleting the last tab in a window AND the group has more than one window, the now-empty window is automatically removed. If it was the only window, the window remains (empty group state is valid).
- **Undo:** Pushed to undo stack.
- **Lock guard:** If `tab.id === 0` and the tab is in a free-tier-locked position (over the 50-tab limit), a lock icon is shown instead of the × button. Clicking the lock shows the upgrade prompt.

### 6.5 Tab Note

- **Trigger:** Clicking the sticky-note icon on a tab that has a note; or the "Add note" option if no note exists.
- **UI:** An inline panel below the tab row with a `<textarea>` (max 500 chars), character counter, Cancel and Save buttons.
- **Commit:** Save button; or `Ctrl+Meta+Enter` / `Cmd+Enter`.
- **Cancel:** Cancel button; or `Escape`.
- **Auto-blur save:** Clicking outside the note panel also saves (via `onBlur`).
- **Undo:** `skipUndo = true` — note edits are too granular.
- **Persistence:** `tab.note` in IDB, survives popup close/open.

### 6.6 Tab Reminder

- **Trigger:** Clock icon on a tab (shown if `tab.reminder` is set); right-click → "Set reminder".
- **UI:** Inline panel with preset buttons (30 min, 1 hour, 3 hours, Tomorrow) and a `<input type="datetime-local">` for custom time + optional note field.
- **Minimum time:** 1 minute in the future. The `datetime-local` input has `min` set to `now + 60s`.
- **Save:** "Set" button — validates `fireAt > Date.now()`. Does nothing if invalid.
- **Cancel:** `Escape` closes the panel.
- **Background alarm:** Writes `{ url, title, note }` to `chrome.storage.local` under a key `reminder-{tabId}-{gi}-{wi}-{ti}`. Sends `{ type: 'CREATE_ALARM', name, delayInMinutes }` to the background script. Background fires a Chrome notification at alarm time.
- **Undo:** `skipUndo = true`.
- **Clear reminder:** A clear/dismiss option removes the `reminder` field and sends `CLEAR_ALARM` to background.

### 6.7 Move Tab (DnD)

See [Section 9 — Drag and Drop](#9-drag-and-drop).

### 6.8 Move Tab to Group (via Selection / Context)

- Single tab: right-click → "Move to group" → group picker.
- Bulk tabs: selection mode → "Move to …" in the action bar.
- **Behavior:** Tab is removed from source window/group and added to a **new window** at the top of the target group. If the source window becomes empty and the group has more than one window, the source window is auto-removed.
- **Moving to Now Open:** Opens the URL in Chrome; `useCurrentTabs` syncs. The tab is removed from the source group. If source is Now Open (copy = true), the live tab is NOT removed.
- **Moving from Now Open to a saved group:** `copy = true` — the live browser tab stays open. A saved copy (`id = 0`) is added to the target group.

### 6.9 Chrome Tab Groups

If a tab belongs to a Chrome tab group, a colored badge with the group name is shown on the tab row. In Now Open, clicking this badge reopens all tabs in that Chrome group. In saved groups, the badge is decorative.

### 6.10 Tab Preview (OG Image)

Tabs can show an Open Graph image preview on hover (if `tab.ogImage` is set). The content script fetches `og:image` from the page. Saved tabs carry the `ogImage` through when moved between groups.

### 6.11 Stale Tab Indicator

A tab is considered "stale" if `Date.now() - tab.savedAt > staleThresholdDays * 86_400_000`. Stale tabs show an amber dot indicator. The threshold is configurable in Settings (7, 14, 30, or 60 days; default 30). The "Remove stale tabs" action in the group context menu calls `useRemoveStaleTabs`.

---

## 7. Search

### 7.1 Trigger

Clicking the search input in the header, or pressing `/`.

### 7.2 Filter behavior

- Filters tabs **within the active group only** — does not search across groups.
- Matches against `tab.title`, `tab.customTitle`, and `tab.url` (case-insensitive substring match).
- Matching tabs: full opacity, no visual change.
- Non-matching tabs: `opacity: 0.3` applied via inline style. Tab remains in the DOM — it is **not** removed.
- Windows with all non-matching tabs are still shown (just all their tabs are dimmed).

### 7.3 Space bar

Space must insert a space character into the search input. This is a regression guard — a previous bug caused keydown events to be swallowed when the search overlay captured focus.

### 7.4 Clearing search

Setting the search input to empty string restores all tabs to full opacity. No reload or re-query needed — the filter is applied reactively.

### 7.5 Persistence

The search filter is **not** persisted — it resets to `''` every time the popup opens.

### 7.6 Scroll-to-window

When a search result isolates a tab in a specific window, `scrollToWindowIndex` is set in uiStore and the Windows Panel scrolls to that window.

---

## 8. Selection Mode

### 8.1 Entering / Exiting

- **Enter:** Clicking the "Select" button in the header; or `Ctrl+A` (selects all tabs in the current group).
- **Exit:** Clicking "Select" again, clicking "Cancel" in the action bar, pressing `Escape`, or after a successful bulk action (bulk delete, bulk move, bulk star all exit selection mode automatically).

### 8.2 What can be selected

The selection type is homogeneous — only one type at a time:
- **Tabs** (`'tab'`)
- **Windows** (`'window'`)
- **Groups** (`'group'`) — selectable from the sidebar in selection mode

Switching type clears the previous selection automatically.

### 8.3 Checkbox UI

- Each selectable item gains a checkbox.
- Unselected state: `Square` icon (empty square).
- Selected state: `CheckSquare` icon (check in square).
- Clicking a checkbox toggles the item. `toggleSelection` in uiStore handles this.
- The DnD grip handle is hidden in selection mode.

### 8.4 Selection ID Format

DnD ID strings are reused as selection IDs:
- Tab: `tab-{groupIndex}-{windowIndex}-{tabIndex}`
- Window: `window-{groupIndex}-{windowIndex}`
- Group: `group-{groupIndex}`

### 8.5 Action Bar

Shown at the bottom of the popup when at least one item is selected.

#### Available actions (tabs selected):
- **Delete selected** (`useBulkDelete`): Removes all selected tabs. Closes live tabs in Chrome. Auto-collapses empty windows (if group has >1). Pushes undo. Exits selection mode.
- **Move to group** (`useBulkMoveToGroup`): Group picker dropdown. Moves selected tabs to new windows in the target group. Now Open source tabs are copied (not removed). Moving to Now Open opens them in Chrome. Exits selection mode.
- **Star / Unstar** (`useBulkStar`): Not applicable to tabs (only windows and groups).

#### Available actions (windows selected):
- **Delete selected** (`useBulkDelete`): Removes all selected windows and their tabs. Closes live tabs.
- **Move to group** (`useBulkMoveToGroup`): Moves entire windows to the target group.
- **Star / Unstar** (`useBulkStar`): Batch-stars or unstars windows; re-sorts each group by starred.

#### Available actions (groups selected):
- **Delete selected** (`useBulkDelete`): Removes all selected groups (skips Now Open). Resets `active` to index 0. Exits selection mode.
- **Star / Unstar** (`useBulkStar`): Batch-stars or unstars groups.
- Move to group: **Not supported** for groups.

### 8.6 Index stability during bulk delete

Bulk delete sorts target items in **descending** index order before removing, so removing a higher index first does not shift lower indices.

---

## 9. Drag and Drop

Built with **@dnd-kit/core**. Pointer sensor with an 8px activation distance.

### 9.1 Group Reorder (Sidebar DnD)

- **Handle:** Left-side grip icon on each sidebar group item.
- **Now Open (index 0):** Cannot be moved; the DnD handle is hidden.
- **Drop behavior:** Groups reorder in the sidebar. The active group index is updated to stay with the same group.
- **Starring auto-behavior on drop:**
  - If the dragged group is dropped **above a starred group** → the dragged group is auto-starred.
  - If the dragged group is dropped **below a non-starred group** → the dragged group is auto-unstarred.
  - Otherwise the starred flag is unchanged.
- **"Add group" button:** Hidden while `isDraggingGroup` is true.
- **Undo:** Reorder is pushed to undo stack.

### 9.2 Tab DnD (Within Windows Panel)

- **Handle:** Left-side grip icon on each tab row (hidden in selection mode).
- **Within same window:** Reorders tabs.
- **To a different window:** Moves the tab to the target window (appended to the end). Source window auto-collapses if now empty and the group has >1 window.
- **To "drop to create new window" zone:** A sentinel drop zone is always in the DOM at the bottom of the Windows Panel, but with `height: 0` and `overflow: hidden` when not dragging. During a drag, it expands to a visible zone. Dropping here creates a new window containing only the dragged tab. The new window is **unstarred** regardless of the drop position.
- **Starring auto-behavior:** Same rule as group DnD but for windows — dropping a tab above a starred window stars the tab's new window; dropping below a non-starred window unstars it.
- **`isDraggingTab` state:** While true, the "Add window" button is hidden.

### 9.3 Window DnD (Within Windows Panel)

- **Handle:** Window card header has a DnD handle.
- **Behavior:** Reorders windows within the active group.
- **Starring auto-behavior on drop:**
  - Dropping above a starred window → auto-stars the dragged window.
  - Dropping below a non-starred window → auto-unstars the dragged window.
- **Undo:** Window reorder is pushed to undo stack.

### 9.4 DnD Constraints

- Now Open group cannot be moved via sidebar DnD.
- DnD is disabled in selection mode.
- Locked tabs (free-tier limit exceeded) cannot be dragged.

---

## 10. Undo / Redo

### 10.1 Stack

- **`undoStack`:** Up to 10 `GroupsState` snapshots, newest first. Implemented in Zustand (`uiStore`).
- **`redoStack`:** Up to 10 snapshots. Cleared when a new mutation is pushed.
- **Not persisted:** Both stacks reset to `[]` when the popup closes.

### 10.2 Push behavior

Every mutation that calls `useGroupsMutation()` with `skipUndo = false` (the default) calls `pushUndo(prevState)` before applying the transform. The snapshot is the **full GroupsState** at the moment of the mutation.

Operations that **skip undo** (`skipUndo = true`):
- Group note edits
- Window note edits
- Tab note edits
- Tab reminder set / clear
- Group info string updates
- `useCurrentTabs` Now Open sync
- `useDeduplicateGroup` for Now Open

### 10.3 Undo

1. Pops the top snapshot from `undoStack`.
2. Pushes the current live `GroupsState` onto `redoStack` (capped at 10).
3. Calls `useSetGroupsState(snapshot)` — writes directly to IDB and updates the TanStack Query cache, bypassing the normal mutation pattern (no new undo entry).

### 10.4 Redo

1. Pops the top snapshot from `redoStack`.
2. Pushes the current live `GroupsState` back onto `undoStack` (capped at 10).
3. Calls `useSetGroupsState(snapshot)`.

### 10.5 New mutation clears redo

`pushUndo` clears `redoStack: []` so that after any user action, redo is no longer available.

### 10.6 Keyboard shortcuts

- **Undo:** `Ctrl+Z` (Windows/Linux), `Cmd+Z` (Mac).
- **Redo:** `Ctrl+Y` or `Ctrl+Shift+Z` (Windows/Linux), `Cmd+Shift+Z` (Mac).

---

## 11. Settings

### 11.1 Modal Structure

Three tabs: **General**, **Account**, **Data**.

Settings are loaded from IDB on modal open. Changes are held in a `draft` state. A "Save changes" button (disabled when draft === saved) commits to IDB. "Restore defaults" resets draft to `DEFAULT_SETTINGS`. A dirty indicator ("Unsaved changes") appears when draft differs from saved.

### 11.2 General Tab

| Setting | Type | Default | Description |
|---|---|---|---|
| Theme | `'light' \| 'dark' \| 'system'` | `'system'` | Sets the popup color theme. Applied immediately on save via `applyTheme()`. |
| Confirm before deleting | boolean | `false` | When `true`, group delete and window delete show a confirmation modal. Tab delete is always direct. |
| Open tab on click | boolean | `true` | Single-click a tab title opens it in Chrome. When `false`, single click does nothing (user must use explicit open button). |
| Auto-deduplicate on merge | boolean | `false` | Removes duplicate URLs when merging windows. |
| Stale tab threshold | `7 \| 14 \| 30 \| 60` (days) | `30` | Tabs older than this threshold show an amber stale indicator. |

### 11.3 Account Tab

- Shows current plan (`Free`, `Pro ($3.99/mo)`, `Pro AI ($7.99/mo)`) and email if signed in.
- **Free:** Shows "Upgrade to Pro" button that opens `/pricing` in a new tab.
- **Pro / Pro AI:** Shows Cloud sync toggle (`syncEnabled`). Shows "Manage billing" button → opens Stripe billing portal in a new tab.
- Shows "Sign out" button if the user is authenticated.

### 11.4 Data Tab

| Action | Description |
|---|---|
| Export data | Downloads `tabmerger-backup-YYYY-MM-DD.json`. Excludes Now Open. Shows toast on success. |
| Import data | File picker (`.json`, `.html`, `.txt`). Parses and confirms count. Appends to existing groups. |
| Clear all data | Browser `confirm()` dialog. Clears all four IDB stores (`groups`, `groupsState`, `sessions`, `settings`). Shows toast, closes modal. |

---

## 12. Import / Export

### 12.1 Export

- Triggered from Settings → Data tab or a dedicated Export button in the header.
- Calls `exportGroups(groupsState.available)` — **excludes Now Open** (the permanent group at index 0).
- Output: a JSON array of `Group[]` objects serialized with `JSON.stringify`.
- File name: `tabmerger-backup-YYYY-MM-DD.json` (date is ISO date of export).
- Download is triggered via a synthetic `<a>` click with a Blob object URL.
- Shows a success toast: "Groups exported successfully".

### 12.2 Import

- Triggered from Settings → Data tab.
- Supports three file formats:
  - `.json` — TabMerger native export format (`Group[]`)
  - `.html` — Chrome bookmarks export (parsed by `parseBookmarksHtml`)
  - `.txt` — OneTab export format (parsed by `parseOneTabs`)
- After parsing, a browser `confirm()` dialog shows the group count: `"Import N group(s)?"`.
- On confirm: calls `useImportGroups` which **appends** the new groups to the end of `available` (Now Open preserved at index 0).
- On success: toast "Groups imported successfully", modal closes.
- On error (bad file format, 0 groups found): toast with error message.
- An empty import (0 groups found) throws `"No groups found"` and shows an error toast.

---

## 13. Sessions

### 13.1 Overview

Sessions are named snapshots of the current group state. Requires Pro tier.

### 13.2 Save Session

- Saves a copy of `groupsState.available` (including Now Open snapshot) as a `Session` object in the `sessions` IDB store with a `nanoid(10)` ID, user-provided name, optional description, and `createdAt` timestamp.

### 13.3 Restore Session

- Replaces `available` with the session's `groups` array.
- Handles the Now Open group: preserves the live Now Open at index 0, does not overwrite it with the saved snapshot.

### 13.4 Delete Session

Standard delete from IDB.

---

## 14. URL Rules

### 14.1 Overview

URL rules automatically assign tabs to groups when the tab navigates to a matching URL. Rules are processed in the background script on `chrome.tabs.onUpdated`.

### 14.2 Rule Structure

```ts
interface UrlRule {
  id: string;     // nanoid
  pattern: string; // glob pattern, e.g. "github.com/*"
  groupId: string; // target group id
  createdAt: number;
}
```

### 14.3 Storage

Stored in the `settings` IDB store under key `'urlRules'` as a `UrlRule[]` array. Also cached in `GroupsState.urlRules`.

### 14.4 Matching

Pattern matching uses `minimatch` glob syntax. When a tab navigates to a URL matching a rule's pattern, the background script calls `useUrlRules` to move the tab into the target group.

### 14.5 Managing Rules

A dedicated "URL Rules" modal (opened from Settings or a header button) allows creating, editing, and deleting rules. Each rule shows: pattern, target group name, created date.

---

## 15. Entitlements & Free Tier Limits

| Tier | Groups | Tabs | Cloud sync | Sessions | AI |
|---|---|---|---|---|---|
| Free | 5 (non-archived) | 50 total | No | No | No |
| Pro | Unlimited | Unlimited | Yes | Yes | No |
| Pro AI | Unlimited | Unlimited | Yes | Yes | Yes |

### 15.1 Enforcement

- **Group limit:** When the user has 5 non-archived groups (excluding Now Open, archived groups), the "Add group" button shows an upgrade prompt instead of creating a group.
- **Tab limit:** Tabs beyond the 50th in a free-tier account show a lock icon (🔒) instead of the × delete button. Clicking the lock opens the upgrade modal. Locked tabs cannot be dragged or interacted with.
- **Cloud sync:** `syncEnabled` toggle is only shown in Settings → Account for Pro+ users.
- **Sessions:** "Save session" UI is only accessible for Pro+ users.
- **AI features:** AI buttons are only shown for `pro_ai` users.

### 15.2 `useEntitlements` hook

Reads the `subscriptions` Supabase table for the current user. Returns `tier`, `cloudSync` (boolean), `aiEnabled` (boolean). Falls back to `'free'` if no subscription record or user not signed in.

---

## 16. Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `/` | Focus the search input |
| `Escape` | Clear search / close modal / cancel rename / exit selection mode |
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo |
| `Ctrl+A` / `Cmd+A` | Select all tabs in the active group (enters selection mode) |
| `↑` / `↓` | Navigate between groups in the sidebar |
| `Enter` (sidebar focused) | Select the focused group |
| `Del` (sidebar group focused) | Delete the focused group (respects `confirmOnDelete`) |
| `Ctrl+G` / `Cmd+G` | Add a new group |
| `Enter` (rename input) | Commit rename |
| `Escape` (rename input) | Cancel rename |
| `Ctrl+Enter` / `Cmd+Enter` (note textarea) | Save tab note |
| `Escape` (note textarea) | Cancel note edit |

---

## 17. Edge Cases & Regression Guards

### 17.1 Input handling (space bar regression)

Space bar must insert a space in:
- Group rename input (inline sidebar input)
- Window rename input (inline window card input)
- Tab rename input (inline tab row input)
- Search input (header search)
- Tab note textarea
- Tab reminder note input

**Root cause of past regression:** A `keydown` handler on an ancestor element was calling `e.preventDefault()` for the space key (used to trigger drag-and-drop). When an input is focused, space must be allowed to bubble normally. The fix is to call `e.stopPropagation()` on `onMouseDown` of all inputs and `onKeyDown` with a guard `if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;` in any ancestor space key handler.

### 17.2 Empty string in rename fields

| Input | Result |
|---|---|
| Group rename → empty → Enter | Reverts to previous group name (no save) |
| Window rename → empty → Enter | Reverts to previous window name (no save) |
| Tab custom title → empty → Enter | Clears `customTitle`; display reverts to original `title` |

### 17.3 Delete auto-behaviors

| Scenario | Result |
|---|---|
| Delete last tab in window; group has >1 window | Source window is auto-removed |
| Delete last tab in window; group has only 1 window | Window remains empty |
| Delete group with tabs live in Now Open | Chrome tabs closed before group removed from IDB |
| Delete window with tabs live in Now Open | Chrome tabs closed |
| Bulk delete groups (includes Now Open) | Now Open skipped silently |
| Bulk delete tabs; group has empty windows after | Empty windows auto-removed per-window (if group has >1) |

### 17.4 Active group index after deletion

| Scenario | New active index |
|---|---|
| Delete active group | `max(0, activeIndex - 1)` |
| Delete group before active | `activeIndex - 1` |
| Delete group after active | `activeIndex` (unchanged) |
| Bulk delete groups | Always resets to 0 |

### 17.5 Undo/Redo stack limits

- Both stacks are capped at 10 entries. An 11th push drops the oldest entry.
- Any new mutation (not undo/redo) clears the redo stack.
- Undo/redo use `useSetGroupsState` which bypasses `pushUndo`, preventing infinite undo loops.

### 17.6 Concurrent mutation safety

All mutations call `qc.fetchQuery(GROUPS_QUERY_KEY)` (not `getQueryData`) to guarantee they operate on the latest IDB state even if the cache is stale. This prevents lost-update bugs when rapid consecutive mutations occur.

### 17.7 Restricted URL handling

URLs matching `/^(chrome|about|chrome-extension|moz-extension):/i` cannot be opened via `chrome.tabs.create`. These are silently skipped in:
- Move tab to Now Open
- Move window to Now Open
- Bulk move to Now Open
- Now Open incognito toggle

### 17.8 DnD and selection mode mutual exclusion

DnD drag handles are hidden in selection mode. Selection checkboxes are hidden when a DnD drag is active. These states are mutually exclusive.

### 17.9 `savedAt` stamping

When a tab lands in a saved group for the first time, `savedAt = Date.now()` is set. When moving between saved groups, the existing `savedAt` is preserved. When copying from Now Open, `savedAt` is stamped fresh. On every popup open, `getGroupsStateWithMigration` backfills missing `savedAt` values for any tabs that predate this field.

### 17.10 Group info string

`group.info` is a derived cache string (e.g., `"2 windows · 5 tabs"`). It is recalculated and written by `getGroupInfo()` after every mutation that modifies windows or tabs. It is NOT the authoritative source — always compute counts from `group.windows` directly in UI.

### 17.11 `pendingSync` flag

Set to `true` on every mutation that modifies a saved group. The sync engine reads this flag to identify groups that need to be pushed to Supabase. Now Open (`permanent: true`) never gets `pendingSync`.

### 17.12 Incognito window: tab ID handling

Tabs in incognito windows have real Chrome tab IDs. However, when copying Now Open tabs to a saved group, `id` is set to 0 regardless of incognito status — the saved copy is never a live tab.

### 17.13 Tab title fallback chain

Display priority: `tab.customTitle` → `tab.title` → `tab.url`. An empty string for `customTitle` means "cleared" — UI falls back to `title`.

### 17.14 Star sort stability

`sortWindowsByStarred` and the group star-sort in `useToggleGroupStar` are stable: relative order within each tier (starred vs non-starred) is preserved using `filter` (which preserves order in JS).

### 17.15 Free tier tab count

The 50-tab limit applies to the total number of tabs across all non-archived saved groups (excludes Now Open). Archived groups are excluded from both the group count AND the tab count.

### 17.16 Settings save is explicit

Settings changes are held in a `draft` state until the user clicks "Save changes". Closing the settings modal without saving discards the draft. The "Restore defaults" button only resets the draft, not saved settings.

### 17.17 Import append (not replace)

Importing from a file **appends** new groups to the end of the existing list. It does NOT replace or merge existing groups. The user can use "Clear all data" first if they want a clean import.

### 17.18 Export excludes Now Open

The export only includes groups where `!group.permanent`. Now Open is never exported.

### 17.19 Window note clears on `note: ''`

When saving an empty string as a window or tab note, the implementation stores `note: undefined` (not `''`), so the note icon/area disappears. A non-empty note always stores the actual string.
