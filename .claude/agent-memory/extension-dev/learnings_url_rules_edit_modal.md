---
name: learnings-url-rules-edit-modal
description: URL Rules edit UX moved from inline row to a shared modal with a dirty-check on Save
metadata:
  type: project
---

Follow-up to [[learnings_url_rules_draft_save]]: inline per-row edit was replaced with a nested
modal that reuses the Add modal component.

- Generalized `AddUrlRuleModal` to accept an optional `initialRule?: UrlRule` prop instead of
  building a separate edit modal. `isEdit = !!initialRule` switches title ("Add URL Rule" vs
  "Edit URL Rule"), button label ("Add rule" vs "Save"), and adds a dirty-check to the disabled
  condition. The add modal is mounted with no `initialRule` (always enabled once
  pattern+group are set); the edit modal is mounted separately with `open={editingRule !== null}`
  and `initialRule={editingRule ?? undefined}` — two mounts of the same component, not one
  conditionally-repurposed instance, since Dialog's open/close animation and internal state don't
  cleanly support swapping `initialRule` on an already-open instance.
- Gotcha: shadcn's `DialogContent` always renders its own close button (`DialogPrimitive.Close`,
  sr-only text "Close", top-right X) regardless of what's in the footer. Don't assume a "Cancel"
  labelled button exists for tests to hit — if the modal doesn't render an explicit Cancel button
  in the footer, the only way to close/discard is that X (`getByRole('button', { name: /^close$/i })`)
  or Escape/overlay click via `onOpenChange`.
- The reset-form-on-open pattern needs a `useEffect` keyed on `open` (not just mount), because the
  same `AddUrlRuleModal` instance is reused across multiple open/close cycles for the add flow —
  `useState(initialRule?.pattern ?? '')` only runs once on mount and won't re-sync on reopen.
