# Design System Agent Learnings

## A11y: Interactive `<span>` elements need explicit button semantics

**Pattern found:** Note/reminder icon triggers, Chrome group tags, and group note toggles were all `<span onClick>` elements wrapped in `<TooltipTrigger asChild>`. Tooltip wrapping does NOT make a span keyboard-focusable — Radix just passes props through. These must be `<button type="button">` elements.

**Fix:** Convert any `<span onClick>` that triggers an action to `<button>`. Add `focus-visible:ring-1 focus-visible:ring-ring rounded` for visible focus ring. The `asChild` Tooltip trigger pattern works correctly once the child is a real button.

## A11y: Tab row div needs onKeyDown for Enter to open tabs

The outer tab row `<div tabIndex={0}>` has `onClick={handleRowClick}` which only handles Ctrl+click for selection. Without an explicit `onKeyDown`, pressing Enter on a focused tab does nothing. Fixed by adding:
```tsx
onKeyDown={(e) => {
  if ((e.key === 'Enter' || e.key === ' ') && !isLocked) {
    e.preventDefault();
    void handleOpen();
  }
}}
```
Note: native `<button>` fires click on Enter automatically; `<div tabIndex>` does not.

## A11y: dnd-kit drag handles need explicit aria-label

`useSortable` returns `attributes` which injects `role="button"`, `tabIndex=0`, and `aria-roledescription="sortable"`, but NO `aria-label`. Add `aria-label="Drag to reorder [item type]"` after the spread. In selection mode when `attributes/listeners` are not spread, set `aria-label={undefined}`.

## A11y: GroupContextMenu wrapper div needs role="button" + onKeyDown

The group sidebar item is a `<div tabIndex={0} onClick>`. Browsers do NOT fire click on Enter for non-button elements. Fixed by adding `role="button"` and `onKeyDown` that dispatches the same onClick handler. The cast `e as unknown as React.MouseEvent<HTMLDivElement>` is needed since KeyboardEvent != MouseEvent.

## A11y: All icon-only buttons need aria-label

Affected buttons in this codebase that were missing labels:
- Color swatch (opens ColorPicker) → `aria-label="Change group color"`
- Star/pin group → `aria-label={starred ? 'Unpin group' : 'Pin group'}`
- Star/unstar window → `aria-label={starred ? 'Unstar window' : 'Star window'}`
- MoreHorizontal for group → `aria-label="More group options"`
- MoreHorizontal for window → `aria-label="More window options"`
- Clock (remove stale tabs) → `aria-label={Remove N stale tabs}`
- Delete X (tab row) → `aria-label={isNowOpen ? 'Close tab' : 'Remove tab'}`

Tooltips alone (TooltipContent) do NOT count as accessible names for screen readers.

## A11y: Navbar text-foreground/60 fails 4.5:1 WCAG AA

`text-foreground/60` on the web Navbar yields ~4.4:1 contrast against the `bg-background/95` header — just under the 4.5:1 threshold for normal (14px) text. Changed to `text-foreground/75` which gives comfortable headroom. The hover state `text-foreground/80` is fine as it's only a transient state.

Web foreground is `hsl(220 25% 10%)`. Background is `hsl(210 25% 97%)`. At 60% opacity the blended color fails AA; at 75% it passes (~5.5:1).

## A11y: FAQ accordion aria-controls pattern

`aria-expanded` on an accordion trigger is sufficient for WCAG AA, but `aria-controls` pointing to the panel id provides better screen-reader UX. Use a stable id derived from the question text (slugified). The panel `id` must match `aria-controls`. Add `aria-hidden="true"` to the decorative ChevronDown icon.

## A11y: Decorative SVGs need aria-hidden

Any SVG that is purely decorative (rating stars, UI icons not conveying information) should have `aria-hidden="true"`. In React this is `aria-hidden="true"` on the `<svg>` element. Lucide icons inside buttons/labels inherit context and don't need it separately if the parent has an accessible name.

## A11y: Interactive Chrome group tags should be buttons

The Chrome group tag `<span>` in the Now Open tab list is conditionally interactive (opens a Chrome group). When `isNowOpen=true` it has an `onClick` — this should be a `<button>` with `aria-label`. When `isNowOpen=false` it's decorative — keep as `<span>` with `aria-label` describing the group name.
