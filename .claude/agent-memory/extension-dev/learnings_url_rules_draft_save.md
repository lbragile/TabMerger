---
name: learnings-url-rules-draft-save
description: Converting UrlRules.tsx from immediate-persist mutations to a draft+outer-Save/Cancel model
metadata:
  type: project
---

Replaced individual `useAddUrlRule`/`useDeleteUrlRule`/`useReorderUrlRule`/`useUpdateUrlRule`
mutations (all immediate-persist) with a single `useSaveUrlRules(rules)` mutation in
`useUrlRules.ts` that does one `persistRules()` write + `qc.setQueryData` for the whole array.
Confirmed via grep that nothing outside UrlRules.tsx/its tests referenced the old per-action
hooks before deleting them — always grep call sites before removing a hook that looks
narrowly scoped.

`UrlRulesModal` now holds `draft: UrlRule[]` local state seeded from `useUrlRules()` on mount;
add/delete/reorder/edit all mutate `draft` only. Top-level footer Save calls
`saveRules(draft)` + `onClose()`; Cancel just calls `onClose()` (draft is discarded because the
whole component unmounts — `ModalRoot` does `if (!modal.type) return null`, so there's no
stale-state risk between opens; no extra reset-on-open effect needed).

The nested "Add URL Rule" modal is a second `<Dialog>` rendered unconditionally inside
`UrlRulesModal` with its own `open`/`onOpenChange` state — Radix supports a nested Dialog
root inside another Dialog's content fine, no portal conflicts observed.

Testing gotcha: giving the outer footer Save/Cancel buttons visible text "Save"/"Cancel" collides
with the per-row edit form's own Save/Cancel buttons and RTL's `getByRole('button', { name: /^save$/i })`
resolves ambiguously (2 elements) once both are in the DOM (footer is always rendered). Fixed by
adding `aria-label="Save all rules"` / `aria-label="Discard changes"` to the footer buttons —
aria-label overrides the accessible name entirely so `/^save$/i` and `/^cancel$/i` still match only
the row buttons, while `/save all rules/i` / `/discard changes/i` target the footer. Same pattern
worth reusing anywhere a modal nests same-labeled Save/Cancel actions at two levels.

Free-tier limit check (`FREE_RULE_LIMIT = 3` via `useEntitlements`) now runs against `draft.length`,
not the persisted count — the "Add rule" button that opens the nested modal is disabled once the
draft itself hits the cap, and the nested modal's own submit re-checks the same draft length (drafts
can queue multiple additions before the outer Save ever persists them).
