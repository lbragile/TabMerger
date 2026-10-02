---
name: learnings-url-rules-edit
description: Adding inline edit mode to UrlRules.tsx — testing gotcha and layout convention
metadata:
  type: project
---

Added `useUpdateUrlRule` (packages/extension/src/hooks/useUrlRules.ts) following the same
read-cache-or-loadRules → map → persistRules → setQueryData pattern as the other URL rule
mutations. Edit mode in UrlRules.tsx uses a single `editingId` state (not per-row) with
pre-filled Input+Select, explicit Save/Cancel (no autosave, by design).

Gotcha: when a row's edit form reuses the same placeholder text ("Pattern, e.g. …") as the
persistent "Add rule" form below it, `screen.getByPlaceholderText(/pattern/i)` in RTL throws
a multiple-elements error once edit mode is active. Use `getAllByPlaceholderText(...)[0]`
(edit row renders first in DOM) instead.

Layout convention confirmed by reviewer: in a Save/Cancel action pair, Cancel/X goes first
(left), Save goes last (rightmost) — matches the existing icon-button ordering convention
(ChevronUp/ChevronDown/Trash2) where destructive/dismissive actions sit before the primary
action's terminal position isn't fixed, but Save specifically should be rightmost.
