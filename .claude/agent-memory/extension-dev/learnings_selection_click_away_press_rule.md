---
name: selection-click-away-press-rule
description: How useSelectionClickAway decides a click is a background click (press origin + open overlays), why a Radix menu trigger's click targets the document root, and how to measure and test it
metadata:
  type: reference
---

**Rule in `src/hooks/useSelectionClickAway.ts`.** A click leaves selection mode only when the press that started it began on the background, no menu / popover / dialog / toast was open when the press began, none is open when the click arrives, and the click target is not a selection control. A keyboard-activated click has no press (a `keydown` clears the recorded press), so only the last two apply. The rule is about the gesture, never about one button, so every menu trigger in selection mode is covered: the selection bar's "Copy to group" / "Move to group", the panel's "More group options", row context menus, and the "Create new group…" dialog opened from a group picker.

**Why the click target alone is not enough.** A Radix `DropdownMenu` trigger opens on `pointerdown`. A modal menu then sets `pointer-events: none` on `<body>`, so the `pointerup` of the same press hits `<html>`, and the `click` is dispatched on the common ancestor of the press and release targets: `<html>`. Any document-level "click outside" logic that looks only at `event.target` sees a root click. Judge by where the press began and by whether an overlay is open.

**After a bulk action the product leaves selection mode** (`useBulkActions` calls `exitSelectionMode` in `onSuccess`), so an e2e asserts "no bar, no checkboxes, header shows Select items" after choosing a group.

**Measuring it (Playwright, headless, outside the repo).**
- `context.addInitScript` works on the extension popup page: add capture listeners on `window` for `pointerdown` / `pointerup` / `click` and log `target.tagName` plus `document.body.style.pointerEvents`.
- To attribute an effect to one handler, wrap `document.addEventListener` in the init script and skip one listener by its source text. The `--mode development` build is still minified, so match the minified shape of the function, not its identifiers.
- A spec outside the repo imports the e2e fixtures and helpers by `file:///` URL (space in the path percent-encoded, `.ts` extension included) next to a `package.json` with `"type": "module"`.
- While a modal Radix menu is open the rest of the page is `aria-hidden`, so `getByRole('checkbox')` finds nothing: count `[role="checkbox"][aria-checked="true"]` with a CSS locator instead.

**Unit-testing it (jsdom).** `fireEvent.pointerDown(control)` followed by `fireEvent.click(document.documentElement)` reproduces the browser's delivery. To run a test file against the committed version of one module without any git write, use a scratch Vitest config (plain object, `root` set to the package) whose first alias maps that module's `@/…` specifier to a copy made with `git show HEAD:<path>`; alias `react` to the package's `node_modules` so the copy resolves it.

Related: [[uistore-single-modal-slot]], [[sonner-toast-pointer-events-and-countdown]].
