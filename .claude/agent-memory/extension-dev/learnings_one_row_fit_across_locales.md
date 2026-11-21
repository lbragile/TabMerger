---
name: one-row-fit-across-locales
description: Proving a popup row fits on one line in every locale - headless offsetTop probe, font proxies (Arial/Verdana) for macOS/Linux, the Save session Color row budget, scratch spec needs a type:module package.json
metadata:
  type: reference
---

The Save session dialog (`max-w-md`, `p-6`) has a **398px** content box. Its Color row is Random +
ten 24px swatches: with `gap-1.5` the swatches and gaps take 300px, leaving 98px for the Random chip.
ru "Случайный" and vi "Ngẫu nhiên" are the longest labels; with the chip at `px-2` ru needed 398.2px
(wrapped) and vi fit by 0.5px. Decision: chip `px-1` (also makes the 5px from chip edge to icon
match the icon's top/bottom clearance). The palette (`AUTO_ITEM_COLORS`) must never shrink to make
room: it drives saved session, auto-save and recently-closed day colours.

How to measure instead of eyeballing:
- Headless probe over every folder in `src/locales`: set `localStorage['tabmerger-locale']` +
  `chrome.storage.local.tm_locale`, reload, open the dialog by its catalog label
  (`sidePanel.json` `saveSession`), then compare the row children's `offsetTop` (a Set of size 1),
  their union rect vs the dialog's content box, and `scrollWidth > clientWidth`.
  `offsetTop` ignores the dialog's zoom-in transform; rects don't, so wait for
  `transform` to be `none`/`matrix(1, 0, 0, 1, ...)`.
- Fonts differ per OS (the stack is `Inter, system-ui`; Inter is not bundled). On Windows the probe
  renders Segoe UI; set the chip's `fontFamily` to **Arial** (proxy for Helvetica / Liberation Sans)
  and **Verdana** (wide worst case, close to DejaVu Sans) to see the margin elsewhere. Size the fix
  so Verdana still fits.
- Toggle `el.style.columnGap` in the same evaluate to show the probe catches the old wrap.
- A scratchpad spec importing `e2e/fixtures` by absolute path fails with "Cannot use 'import.meta'
  outside a module" unless the scratch folder has `package.json` `{"type":"module"}`.

The guard is `e2e/tests/sessionColorPickerRow.spec.ts` (all `SUPPORTED_LOCALES`, ~27s).

Related: [[learnings-rtl-layout]] (probe recipe, locale switching), [[blog-screenshot-boxes]]
(the blog's `tm-save-session-dialog` box moves when the dialog's height changes).
