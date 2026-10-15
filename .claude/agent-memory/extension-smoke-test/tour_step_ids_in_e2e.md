---
name: tour-step-ids-in-e2e
description: Tour step ids, chapter counts and step kinds are hardcoded string literals in e2e/tests/tour*.spec.ts; type-check, lint, build and unit tests all miss a rename, only the e2e run catches it
metadata:
  type: reference
---

- **[2026-10]** A tour copy pass renamed step id `group-colour` to `group-color` (and added a chapter, and made the read-only `undo` step a task). Type-check, lint, both builds and unit tests stayed green, but 14 tour e2e tests failed: `tour.spec.ts` / `tourV2.spec.ts` hardcode step ids (`goTo('group-colour')`, `stepId === '...'`), "Chapter N of M" text, which steps are read-only, and `RING_EXTENT` (the ring-clip check, which must match `ACTION_RING_EXTENT_REM` in `Tour.tsx`).
- A `goTo`/`goToStep` loop that never finds an id walks to `finish` and then times out with "Target page, context or browser has been closed" or "Expected: not finish". That's a stale-id symptom, not a crash. Read the `Expected/Received` lines.
- Search default `DEFAULT_SEARCH_NON_MATCHING` (shared/constants/search.ts) decides whether non-matching rows are dimmed (`opacity-30`) or not drawn at all. Specs that assert `opacity-30` must seed `searchNonMatching: 'dim'`.

**How to apply:** when the diff touches `lib/tourSteps.ts`, `lib/tour.ts`, `Tour.tsx` or search constants, run `tour.spec.ts`, `tourV2.spec.ts` and `search.spec.ts` against `.output/chrome-mv3` (`TM_E2E_EXT_DIR`). Classify each failure by its Expected/Received pair before calling it a bug. See [[stale-vimock-factory-keys]] for the same "only one gate catches it" pattern.
