---
name: learnings-firefox-popup-same-size-resize
description: Firefox action popups fire window `resize` with an unchanged size after DOM changes; Radix Select closes on any resize, so it closed on open. Guard in SelectContent; headless real-popup repro recipe over WebDriver BiDi
metadata:
  type: reference
---

**Behaviour.** Firefox sizes a browser-action popup to its content. `ext-browser-content.js`
(in Firefox's `omni.ja`) watches the whole document with a MutationObserver plus
`MozScrolledAreaChanged`, measures again (debounced 100ms) and resizes the popup `<browser>`.
The popup window then fires `resize` even though `innerWidth`/`innerHeight` stay 800×600.
Measured in Firefox 158: two or three same-size resizes right after a Select opens.

**Why it matters.** Radix Select (2.3.3, and still in 2.4.1) adds `window` `resize` and `blur`
listeners in `SelectContentImpl` that close the list. Opening the list is a DOM change, so in a
Firefox popup every Select closed the instant it opened. Upgrading does not help. Radix
DropdownMenu, Popover and Dialog have no resize listener and work. No window `blur` fires here.
The bug never shows in a Firefox tab, only in the popup.

**Fix (shipped).** `lib/sameSizeResize.ts` `stopSameSizeResizes(win)` adds a capture `resize`
listener that calls `stopImmediatePropagation()` when the size equals the last size it let
through. `components/ui/select.tsx` `SelectContent` installs it from a React 19 callback ref with
cleanup. The content node only exists while the list is open, so the guard lives exactly as long
as the open list. Capture listeners run before ordinary listeners at the target, so order of
registration does not matter. A real size change still closes the list (Radix default kept).
Side effect: with the callback ref, a forwarded object ref is now set back to null on close
(Radix's composed ref left it pointing at the detached node).

**Repro recipe (headless, real popup).** Playwright's Firefox can't load extensions, but stock
Firefox speaks WebDriver BiDi. Node 24's global `WebSocket` is enough, with no extra packages:
- Start `firefox.exe -headless -no-remote -remote-allow-system-access -profile <dir>
  --remote-debugging-port=<port>` and connect to `ws://127.0.0.1:<port>/session`.
  `script.evaluate` in a moz-extension context needs `-remote-allow-system-access`.
- `user.js`: `extensions.webextensions.uuids` (pin the gecko id to a known UUID) and
  `extensions.openPopupWithoutUserGesture.enabled = true`.
- `session.new`, then `webExtension.install {type:'path'}`. BiDi refuses
  `browsingContext.navigate` to moz-extension URLs, so append one line to a COPY of the built
  `background.js` that sets `tm_tour` done and `tabs.create`s `popup.html`. Find that tab with
  `getTree`.
- In the tab: `await browser.action.openPopup()`, then `browser.extension.getViews({type:'popup'})[0]`
  is the real popup window. Drive it with synthetic PointerEvents, which Radix accepts.
- Use a new profile dir for every run. A killed run leaves files locked.
- Before killing any `firefox.exe`, check its start time. A visible Firefox may be the owner's.

**Chromium e2e stand-in.** `e2e/tests/settingsSelects.spec.ts` copies the Firefox behaviour
in the page: a MutationObserver dispatches a same-size `resize` at most every 50ms. It fails
without the guard. While a Select is open, its trigger is aria-hidden (`hideOthers`), so
`getByRole('combobox')` won't find it. Read the trigger before opening, or use `{ hidden: true }`
in RTL. Related: [[learnings-firefox-popup-permission-request]],
[[learnings-radix-arrow-focus-timer]].
