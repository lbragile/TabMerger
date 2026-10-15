---
name: learnings-radix-nested-dialog-escape-race
description: Radix DismissableLayer only removes the lower dialog's Escape listener a few renders after a nested dialog opens; an Escape in that window closes BOTH. ConfirmDialog answers Escape from a window-capture listener
metadata:
  type: reference
---

**Radix behaviour (the installed `@radix-ui/react-dismissable-layer`):** each layer adds its
`keydown` capture listener on the document only while `isHighestLayer`, and learns it is no
longer highest through a chain: the nested layer's node state, its effect adding it to
`context.layers`, a `dismissableLayer.update` custom event, a `force({})` re-render of the lower
layer, then that layer's effect cleanup. Until the last step the lower dialog (Settings) still
listens, and it was registered first, so it runs first: it calls `onDismiss` and
`preventDefault`s, the nested box's listener then sees `defaultPrevented` and does nothing, and
Settings unmounting takes the nested box with it. The [[in-app-confirm-and-backup-file-location]]
claim "Escape closes only the top box" holds only once that chain has settled.

Seen as `autoBackup.spec.ts` "declining Replace ... Settings stays open" failing in CI
(production build) with the Settings region gone after one Escape; the trace's DOM snapshot
after the Escape had no dialog at all.

**Repro:** slow React's scheduler with an init script before the reload:
wrap `MessageChannel` so `port2.postMessage` runs `setTimeout(..., 40)` later. Then
click, `expect(box).toBeVisible()`, Escape, `expect(settings).toBeVisible()` fails every time.
(Delaying `setTimeout` alone does not touch React's scheduler, which uses MessageChannel.)

**Fix pattern:** the top dialog handles Escape from a `window` capture listener (runs before
every document listener), installed in a `useLayoutEffect` keyed on open so it exists from the
commit that shows the box; it `preventDefault`s and closes itself, so every Radix layer skips that
Escape. Skip events already `defaultPrevented`. `ConfirmDialog.tsx` does this; any other dialog
opened on top of a Radix dialog has the same window unless it does too.

Tests: in e2e, wait for the nested box (`toBeVisible` or its focused button) before pressing
keys meant for it. Unit: a document-capture listener registered before asking stands in for the
stale lower layer and must see `defaultPrevented === true`.

Related: [[learnings-deferred-focus-drops-keys]], [[uistore-single-modal-slot]].
