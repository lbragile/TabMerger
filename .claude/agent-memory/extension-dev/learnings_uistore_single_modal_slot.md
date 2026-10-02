---
name: uistore-single-modal-slot
description: uiStore has exactly one modal slot — opening a second modal from inside a modal unmounts the first and loses its local state
metadata:
  type: project
---

`uiStore.ts`'s `openModal: (type, data) => set({ modal: { type, data } })` holds a SINGLE modal
slot. Calling `openModal(...)` from inside an already-open modal component (e.g. Settings calling
`openModal('confirmPreviewImages', ...)` from a Switch's `onCheckedChange`) replaces `modal` wholesale
— it does not stack. The currently-open modal's React component unmounts immediately, and any of its
local `useState` (like Settings' `draft` — unsaved edits across the whole form, not just the one
toggle) is thrown away. The nested modal's own `onConfirm` callback closure still runs fine (it
closed over the pre-unmount state setter), but calling a state setter on an unmounted component is a
silent no-op, so the intended effect (enabling the setting) never lands, and the user's other
unsaved edits vanish too.

**Why:** this caused a real user-facing bug — "Show page images in previews" in Settings could not
be turned on, because turning it on opened a `confirmPreviewImages` modal via `openModal`, which
unmounted Settings before the confirm handler could patch its draft.

**How to apply:** any "confirm before changing this setting" UX inside an already-open modal must
either (a) be rendered inline within the same modal component using local state (no `openModal`
call), or (b) directly mutate the draft/state without a second confirmation step. Do not reach for
`openModal` from inside a modal unless you specifically want the current modal to close. In this
case specifically, it was later decided a confirmation step wasn't even needed — the toggle just
flips the draft directly like every other Settings switch, with a "Privacy policy" link (opens
`${VITE_WEB_APP_URL}/privacy#page-previews` via `chrome.tabs.create`) placed next to the helper text
instead. See [[tabpreview-off-state-placeholder]].
