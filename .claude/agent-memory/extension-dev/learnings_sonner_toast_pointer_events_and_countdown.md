---
name: sonner-toast-pointer-events-and-countdown
description: Root cause of undismissable toasts inside open modals (Radix pointer-events:none inheritance) + how the countdown bar was added on top of sonner without a new library
metadata:
  type: project
---

**Bug:** "toast doesn't dismiss when I click on it." Root cause was hypothesis (1) from the
brief, confirmed by direct repro: Radix `<Dialog>` sets `pointer-events: none` directly on
`<body>` while any modal is open (its own outside-interaction guard). Sonner's `<Toaster>`
portals to `document.body` too — a sibling of the dialog, not a descendant — and **sonner
never sets `pointer-events: auto` anywhere in its own injected stylesheet** (checked
`node_modules/sonner/dist/index.mjs` directly — grepped for `pointer-events`, only found on
`[data-sonner-toast][data-visible=false]`, nothing that re-asserts `auto` on the live toast
or toaster). Since `pointer-events` is inherited and nothing overrides it, every toast fired
while a modal is open becomes visually present but fully unclickable — the × close button
and any action button both silently fail. This affected *most* real call sites in the repo:
Settings Save, Auth, Import/Export, EncryptionSetup, SESSION_LIMIT — because these fire from
inside modals that don't call `onClose()` before or during the toast.

Confirmed with a live A/B: disabled the CSS fix and the same Playwright test failed with
Chrome literally reporting `<div ... class="fixed inset-0 z-50 bg-black/80..."> intercepts
pointer events` on the click — i.e. Playwright's own diagnostics named the dialog overlay as
the blocker. Re-enabling the fix (`[data-sonner-toaster] { pointer-events: auto !important; }`
in `globals.css`) made it pass immediately. This is the fastest way to prove/disprove this
exact hypothesis on any project using Radix Dialog + a toast lib that portals to body: kill
the override, watch Playwright name the actual intercepting element in its retry log.

**Gotcha for testing this:** `SaveSessionModal.handleSubmit` calls `onClose()` synchronously
right after firing the async `onSave(...)`, so by the time a SESSION_LIMIT toast actually
fires (inside the caught rejection), the modal has *already* unmounted — that path does NOT
reproduce the modal-open bug, even though it looks like it should from the toast call site
alone. Always check whether the modal's submit handler awaits the mutation before closing
before treating "toast fires from inside a modal component" as proof the modal is still open
when the toast appears.

**Countdown bar (react-toastify-style) added on top of sonner without switching libraries:**
sonner has no built-in progress bar. Built one as a `[data-sonner-toast]::after` pseudo-element,
`animation: toast-countdown var(--toast-duration) linear forwards` with `--toast-duration` set
per-toast via a thin wrapper (`src/lib/toast.ts`) around every `toast.*` call — every one of the
~12 call sites across the extension now imports `toast` from `@/lib/toast`, not `sonner`
directly (the `<Toaster>` component itself still comes straight from `sonner` in `App.tsx`,
only the imperative `toast(...)` calls needed rerouting).
- sonner's own default lifetime is `TOAST_LIFETIME = 4000` (hardcoded in its dist bundle,
  not exported) — the wrapper hardcodes the same 4000 fallback so the bar's duration always
  matches sonner's real internal timer, even for calls that never pass `duration` explicitly.
- Pausing: sonner pauses its *actual* JS dismiss timer on `expanded || interacting`, where
  `expanded` = toaster hovered (mouseenter sets it toaster-wide) and `interacting` = mid-swipe.
  Only `expanded` is exposed as a DOM attribute (`data-expanded="true"` on every stacked toast)
  — `interacting` is pure React state, never rendered to the DOM. The CSS pause rule can only
  mirror `data-expanded`; swipe-pause has no CSS hook available. Given sonner's toasts are
  rarely swiped in this extension's fixed 800×600 popup, this gap was accepted rather than
  reaching for JS.
- `toast.type` is `undefined` for a plain `toast(...)` call (not `'default'` or similar), so
  React omits the `data-type` attribute entirely — `:not([data-type])` is the correct selector
  for "plain toast, no richColors semantic tint" when picking the countdown bar's fallback color.
- `[style*='--toast-duration']` as a CSS attribute-selector substring match works fine against
  React's inline-style serialization of a custom property key, and is how the bar avoids
  rendering for `Infinity`-duration or `loading`-type toasts (which the wrapper deliberately
  leaves unstamped).

**Follow-up bug the pointer-events fix itself created:** making the toaster clickable exposed
a second-order issue — Radix Dialog's `DismissableLayer` treats any pointerdown/focus outside
`DialogContent` as an outside-interaction and closes the dialog by default. A toast's × or
action button is, by definition, outside `DialogContent` (sonner portals to `<body>`, sibling
of the dialog). So clicking a toast while a modal was open would ALSO dismiss that modal —
e.g. discarding an in-progress Auth sign-in draft or a not-yet-saved Settings toggle. Fixed
centrally in `src/components/ui/dialog.tsx`'s shared `DialogContent`: guard both
`onPointerDownOutside` and `onInteractOutside`, `e.target.closest('[data-sonner-toaster]')` →
`preventDefault()` and skip; otherwise chain to any caller-supplied handler unchanged (none
exist yet, but the chain is there for when one does). `closest()` matters because the real
event target is a toast's inner button/icon, several DOM levels below `[data-sonner-toaster]`
itself — a direct-parent check would miss it.
- Confirmed with the same "temporarily disable, watch it fail" technique: without the guard,
  clicking a toast's close button while Settings was open unmounted+remounted `SettingsModal`,
  silently resetting its `draft` state back to `saved` — a second, unrelated switch flip made
  *after* the toast fired was lost. The fix makes both the dialog stay mounted (same instance,
  not a close+silent-reopen) and the draft change survive.
- jsdom gotcha for testing this: Radix sets `pointer-events: none` on `<body>` while a dialog
  is open (the same mechanism as the original bug). `@testing-library/user-event` actually
  enforces computed `pointer-events` and refuses to click through it — but jsdom never loads
  the app's real `globals.css`, so the `[data-sonner-toaster]{pointer-events:auto!important}`
  rule isn't present in a component test's DOM. Any test simulating a click on a
  toaster-like element outside the dialog needs `el.style.pointerEvents = 'auto'` set
  explicitly inline to reproduce what the stylesheet does in the real popup.
