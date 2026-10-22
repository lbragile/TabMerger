---
name: radix-direction-and-menu-search
description: Radix DirectionProvider wiring (one copy of @radix-ui/react-direction), and how to put a search field inside a Radix DropdownMenu — focus on open without the private onOpenAutoFocus, typeahead blocking, letter redirect, accessible-name whitespace trap
metadata:
  type: reference
---

**Direction**
- Radix primitives never read `<html dir>`; without `DirectionProvider` every menu, tabs and
  scroll area is LTR. `components/DirectionProvider.tsx` (`LocaleDirectionProvider`) is in the
  root layout; client code reads the same value with `useDirection()` (reviews carousel, password
  input, toaster, language menu). Tests set it by wrapping in Radix's `DirectionProvider dir="rtl"`.
- `@radix-ui/react-direction` is a direct dependency at the exact version the primitives use: a
  second copy would be a second React context the primitives never read. Verify with
  `ls node_modules/.pnpm | grep react-direction` (one entry).
- The reviews carousel in RTL: positive translate, `Math.abs` the measured stride, a card's
  position from the first card's right edge, viewport `scrollLeft` is 0..negative, and pointer
  travel flips sign. jsdom has no scrolling: stub `scrollLeft` with `Object.defineProperty`.

**Search field inside a Radix DropdownMenu (LanguageMenu)**
- `onOpenAutoFocus` is not in `DropdownMenuContentProps` (Radix's `MenuContentImplPrivateProps`);
  it happens to pass through at runtime but don't rely on it. Instead give the input a *stable*
  `useCallback` ref that calls `el.focus()`: refs run during the commit, before the FocusScope's
  mount effect, and FocusScope leaves focus alone when it is already inside the content. A
  `useEffect` on an `open` state runs too early (the portal content mounts a commit later). A
  non-stable inline ref would re-focus the input on every render and steal focus from items.
- Radix menu typeahead runs from the content's bubbling `onKeyDown`; `stopPropagation()` in the
  input's keydown (for everything but Escape/Tab/ArrowDown/Enter) keeps letters and Space in it.
- Letters typed while an item has focus: an `onKeyDownCapture` on the content that focuses the
  input and stops propagation, without `preventDefault` — the browser then types the character
  into the newly focused input (verified in headless Chromium).
- Scrolling the checked item into view on open: at mount the list isn't capped yet (its
  max-height uses `--radix-dropdown-menu-content-available-height`, set once Radix has placed
  the menu), so a one-shot `scrollIntoView` does nothing. Observe the list with a ResizeObserver
  and re-reveal on each size change, and disconnect on the first input change, wheel, touch,
  pointerdown or keydown so a later resize (clearing the search) doesn't jump. In Playwright,
  `toBeInViewport({ ratio: 1 })` fails at 0.996 from fractional row heights; use 0.95.
- Placeholder fit: Chrome's `input.scrollWidth` stays equal to `clientWidth` while a placeholder
  is clipped, so it can't detect overflow. Measure the placeholder with a hidden span in the
  input's computed `font` (after `document.fonts.ready`) against the inner width less a 1rem
  clear-button slot; `e2e/language-switcher.spec.ts` loops every locale at 320px that way. One
  string per locale must fit the narrowest screen (236px of text room at 320px).
- ArrowUp from the first item back to the input: pass `onKeyDown` to that item and
  `preventDefault()`; Radix composes handlers and skips its own when default is prevented.
- Accessible name: a trailing space inside an `sr-only` span is dropped ("Deutsch,German"). Put
  the comma in the sr-only span and the space as its own `{' '}` text node; a flex container
  doesn't lay out whitespace-only nodes, so it adds no visual gap.
- Shared helpers for any locale picker: `filterLocales` (word-prefix, diacritic-insensitive,
  Intl.DisplayNames names + aliases) and `localeNameIn` in `@tabmerger/shared`.

**Tooling**: `next dev` (Next 16) refuses a second dev server for the same app directory and
points at the running one; take headless screenshots against that one read-only. The Bash
tool collapses `\\` inside heredocs, so scripts containing backslashes (regex, `⁨`) should be
written with the Write tool and then run.

Related: [[rtl-layout-tailwind-v4]]
