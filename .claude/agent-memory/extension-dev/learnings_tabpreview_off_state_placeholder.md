---
name: tabpreview-off-state-placeholder
description: TabPreview.tsx already skips the network fetch when showPreviewImages is off — the fix needed was only the tooltip's visual copy, not the fetch-gating logic
metadata:
  type: project
---

`components/Windows/TabPreview.tsx`'s `handleOpenChange` already guarded the og-image fetch behind
`appSettings.showPreviewImages` (falls back to `tab.ogImage` and returns early when off — see the
comment above that branch). The tooltip itself was also already unconditional — it always renders
on hover with title/url/favicon regardless of the setting. The only real gap was that the "no image"
fallback state used the same generic "No preview" copy whether the setting was off or on-but-no-image,
which read as broken/confusing when off.

**Why:** a coordinator-relayed bug report ("hovering shows nothing when the setting is off") turned
out to not match the code — always check the actual current behavior before assuming the fetch-gating
needs work.

**How to apply:** the fix was purely presentational — branch the muted fallback label on
`appSettings.showPreviewImages` ("No preview" when on, "Not enabled" when off) and add a one-line
hint ("Page images are off. Turn on in Settings.") only in the off case, keeping the same `h-24`
placeholder box so the tooltip doesn't resize on toggle. Do not touch the fetch path in
`handleOpenChange` or `tabAccess.ts` for this class of report without confirming the fetch itself is
actually failing.
