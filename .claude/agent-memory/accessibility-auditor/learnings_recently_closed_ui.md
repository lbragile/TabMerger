---
name: learnings-recently-closed-ui
description: Checks and traps for the Recently closed sidebar section, day view, Ctrl+K closed results and session colour pickers (audit 2026-11-16)
metadata:
  type: project
---

Audit 2026-11-16. Check code before trusting. It reuses the archived/session patterns well: sibling (never nested) buttons, `aria-current` + MainPanel "Showing ..." status, `useFocusAfterRowRemoval`, arrow-key list marker, logical CSS props, `.tm-sidebar` muted token.

- `useRecentlyClosedActions.done()` calls `announceSectionView(msg)` AND `toast.success(msg)`: Sonner toasts are polite live regions, so every reopen/remove/clear/save is read twice. Colour change (status only) and copy link (toast only) are single. If the status line is dropped for toasts, identical consecutive texts must still re-announce.
- `ui/dropdown-menu.tsx` `DropdownMenuContent` always `preventDefault()`s `onCloseAutoFocus`, so after any menu action or Esc focus falls to body (not the trigger). Shared by every menu; only the row-removal hook repairs it.
- `Button variant="link"` is `text-primary` with no underline: light primary (hsl 193 100% 40%) is about 2.7:1 on the sidebar tint and about 3:1 on white, so the in-sentence "Turn on in Settings" / "See Pro" links fail 1.4.3 at 10-11px and 1.4.1 (colour-only link in muted text). Dark theme passes.
- AUTO_ITEM_COLORS on white (computed): yellow 1.9, green 2.3, cyan 2.4, teal 2.5, orange 2.8 fail 3:1; red, pink, blue, purple, indigo pass; all pass on dark backgrounds. Swatches are labelled, so only a WARN; selected ring is 1px foreground.
- Day colour bars and header dots are decorative (the label carries meaning), so exempt from 1.4.11.
- Window rows: the chevron button and nested list share one static name ("Tabs in this window") on every row; the visible time "14:32" is not in the open button's name ("closed 5 minutes ago"), a 2.5.3 risk.
- Row buttons are not roving: every entry adds open button + chevron + menu tab stops (100 rows = 200-300 stops). ArrowUp/Down on the chevron or menu buttons is not consumed (only open buttons are in the list), so it scrolls the panel instead.
- Header search over the day view: `SearchAnnouncer` knows nothing of closed entries and the "no matches" `<p>` is not live; dim mode uses `opacity-40` on whole rows.
- Closed `ClosedResultRow` chrome-tab-group badge is white text on Chrome group colours (yellow/cyan fail), same as the saved-tab ResultRow.
- Reduced motion is covered globally (Radix `animate-in/out` killed in globals.css); the session swatch `hover:scale-110` is not.
