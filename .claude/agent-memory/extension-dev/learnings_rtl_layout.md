---
name: learnings-rtl-layout
description: Extension right-to-left support (ar/he/fa) — Tailwind v4 logical utilities, the text-ui-start trap, empty dir=auto fields, Radix direction, arrow-key flips, drag ghost, guard test, headless probe recipe
metadata:
  type: reference
---

RTL in the extension follows `<html dir>` (set by `applyDocumentLocale` from `i18n.dir()`).

- **Tailwind v4.3:** `space-x-*` / `divide-x` already compile to `margin-inline-*` / `border-inline-*`
  (no flip needed). Use `inset-s-*` / `inset-e-*` (start-/end- still work; web docs call them
  deprecated). `rtl:` compiles to `:where(:dir(rtl),[dir=rtl],[dir=rtl] *)` = zero extra specificity,
  emitted after `data-*` variants, so `rtl:data-[state=checked]:-translate-x-4` beats the plain one.
  Probe compiled CSS with `compile()` from `node_modules/.pnpm/tailwindcss@*/dist/lib.mjs`.
- **`text-ui-start` (globals.css) must key on `<html dir>`, not the parent.** `match-parent` is
  unprefixed-unsupported in Chromium (needs `-webkit-match-parent`) AND copies a parent's `center`:
  a `<button>`'s UA center moved the header search placeholder (an LTR regression). Now
  `left` + `:where(:root[dir=rtl] *) { right }`; the guard pins it.
- **An empty `dir="auto"` input is LTR in Chromium** (no fallback to the parent), so a translated
  placeholder renders backwards in RTL. Use `dir={value ? 'auto' : undefined}` on every text field.
- Truncating user text: put `dir="auto"` on the element that truncates (the ellipsis follows its own
  direction); `dir` on an inline child inside a truncating RTL block clips the START of English text.
- Latin examples inside RTL catalog strings ("de, he"): wrap in `⁦…⁩` in the JSON.
- **Radix:** only DropdownMenu/Select/Tabs/ScrollArea read direction — via one
  `@radix-ui/react-direction` instance (`LocaleDirectionProvider`). Popover/Tooltip `align` start/end
  flips by itself (floating-ui reads computed `direction`). Sonner's `dir='auto'` reads the document
  at render time, which can lag a language switch: pass `dir` explicitly.
- Physical-key logic: `inlineArrow(key)` in `lib/direction.ts` (reads `<html dir>` at keydown).
  Keyboard move: towards the group list is ArrowRight in RTL. Tour: placement left/right, fallback
  corner and docked corner are mirrored inside `computeCardPosition({direction})`. Drag ghost: grab
  offset measured from `rect.right` and the stack/badge on the right (`dndHtml5Sensor`,
  `dndDragVisuals`); geometry from `getBoundingClientRect` otherwise stays physical.
- Guard: `__tests__/unit/styles/logicalDirection.test.ts` (physical classes + inline style keys,
  ALLOWED with reasons and a stale-entry check; text-ui-start definition and usage).
- **Headless probe screenshots without touching `.output`:** `wxt build -c <scratch>/wxt.probe.config.ts`
  (outDir override, see [[learnings-in-app-confirm-and-backup-file-location]]) + a `.mts` script run
  with `npx tsx` from `packages/extension`, importing Playwright and `e2e/helpers.ts` by `file:///`
  URL. Gotchas: tsx's keepNames wraps `page.evaluate` callbacks in `__name` → `context.addInitScript('globalThis.__name = (f) => f')`;
  `import.meta.url` encodes `~` (short temp paths) → use `fileURLToPath`; Windows node has no `/dev/stdin`.
  Switch language with `localStorage['tabmerger-locale']` + `chrome.storage.local.tm_locale`, then reload.
- jsdom's accessible-name computation drops whitespace-only text at element edges: a separator
  must share a text node with the following words (`<span sr-only>,</span>{' ' + name}`).
