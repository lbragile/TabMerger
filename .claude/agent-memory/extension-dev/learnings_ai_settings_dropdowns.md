---
name: learnings-ai-settings-dropdowns
description: Settings → AI provider/model as Radix Selects — two-line options with a name-only trigger (SelectValue children + textValue), '' for the placeholder, popper caps from Radix CSS vars, focus-after-Cancel on the trigger, test/e2e patterns
metadata:
  type: reference
---

`AiProviderPicker` and `AiModelPicker` are shared-`Select` rows laid out like the General rows
(heading + hint left, trigger right), trigger `aria-labelledby` the heading `Label`. Shared
classes: `AI_SELECT_WIDTH` / `AI_SELECT_TRIGGER_CLASS` / `AI_SELECT_CONTENT_CLASS` in
`settingsControls.ts`. Decision: one fixed width for both triggers (`w-48`, 12rem), not
content-sized (a width that changed with the choice was rejected). Sized from measurements of
every locale's "Auto" and provider placeholder plus all model names at `text-xs` in the popup font;
the trigger's own padding + gap + chevron + border is 50px. Recompute when a model or translation
gets longer.

- **Ellipsis on a shared trigger:** `SelectTrigger` has `[&>span]:line-clamp-1` (display
  `-webkit-box`), which does not draw a `text-overflow` ellipsis on one nowrap line. Add
  `[&>span]:line-clamp-none [&>span]:truncate`: tailwind-merge drops `line-clamp-1` (same group),
  `line-clamp-none` makes the span `display: block` and `truncate` then ellipsizes (checked in a
  real build). Put a `title` with the full text on the trigger.
- **Measuring label widths in the real font:** a temporary `e2e/repro/*.repro.ts` that opens the
  popup and measures `span.text-xs` (with `lang`) per string, or writes each string into the real
  trigger's value span and reads `scrollWidth - clientWidth`. Delete the probe afterwards.

Non-obvious points:
- **Options with a second line, trigger with the name only.** shadcn `SelectItem` wraps ALL its
  children in `ItemText`, and Radix portals the selected item's `ItemText` into `SelectValue`,
  so the info line would land in the trigger. Give `<SelectValue>{name}</SelectValue>` children:
  Radix then skips that portal. Set `textValue={name}` on the item so typeahead matches the name,
  not the info. `ItemText` is a flex item of the option (blockified), so block spans inside stack.
  The option's accessible name includes the info line (acceptable: it is the price hint).
- **Placeholder needs `value=''`**, not `undefined` (that flips the Select to uncontrolled).
  Radix sets `data-placeholder` on the trigger; `data-[placeholder]:text-muted-foreground` mutes it.
- **Radix never calls `onValueChange` for the already-selected value**, matching the old radio
  `onChange`; a type guard on the value keeps the handler typed without casts.
- **Fitting the 800×600 popup:** the popper content exposes
  `--radix-select-content-available-width/height`; `max-h-[min(24rem,var(...height))]`,
  `max-w-(--radix-select-content-available-width)`, `collisionPadding={8}`, `align="end"`. The
  content is portaled, so the dialog's `overflow-hidden` never clips it. Long lists get Radix's
  scroll buttons. The model list uses a fixed `w-[min(22rem,...)]` so the long estimate lines wrap.
- **Selected info stays visible**: rendered under the row (`ai-model-selected-info`) and added to
  the trigger's `aria-describedby` next to the hint.
- **Focus after Cancel** (provider switch) now focuses the forwarded trigger ref; still gated on
  the provider equalling the saved one, since the pick's query update lands a render later
  (see [[learnings-ai-byok-model-choice]]).
- **Unit tests:** stub `scrollIntoView`, `hasPointerCapture`, `releasePointerCapture`; use
  `userEvent.setup({ pointerEventsCheck: 0 })`. Options exist only while open: helpers open, read
  `data-testid`s, then Escape and wait for the listbox to go before touching anything else (the
  rest of the page is aria-hidden while open). `userEvent.keyboard` with default delay is enough
  for ArrowDown + Enter in jsdom.
- **e2e:** address triggers by test id (`ai-provider-select`, `ai-model-select`), since an open
  list aria-hides them; Escape on an open Select closes only the list, not Settings. A spec
  asserts the open list's bounding box stays inside the viewport and the tab panel has no
  sideways overflow. Related: [[learnings-firefox-popup-same-size-resize]],
  [[learnings-radix-arrow-focus-timer]], [[learnings-modal-flex-grid-overflow]].
