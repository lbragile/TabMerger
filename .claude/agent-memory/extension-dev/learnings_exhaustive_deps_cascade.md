---
name: learnings-exhaustive-deps-cascade
description: Fixing a react-hooks/exhaustive-deps missing-dependency warning by adding a useCallback can surface a SECOND, previously-silent warning on sibling array/object deps in the same effect
metadata:
  type: project
---

When a `react-hooks/exhaustive-deps` "missing dependency: someFn" warning is fixed by wrapping
`someFn` in `useCallback` and adding it to the effect's dependency array, ESLint can immediately
surface a *new* warning on other, unrelated-looking dependencies in that same effect's array:
"The 'x' conditional could make the dependencies of useEffect Hook change on every render. To fix
this, wrap the initialization of 'x' in its own useMemo() Hook." This happened in
`SearchOverlay.tsx` (`packages/extension/src/components/Header/SearchOverlay.tsx`): adding
`completePick` (useCallback-wrapped) to the picker keydown effect's deps array made ESLint flag
`pickerItems` and `results` — both derived via ternary/plain conditional each render, already
sitting in that same deps array before the fix, and NOT flagged on their own.

**Why:** the plugin's heuristic apparently only calls out unmemoized non-primitive deps once it
can see the effect *could* otherwise be considered "stable" (i.e. once every dependency has at
least the possibility of memoization) — mixing one now-properly-memoized function dependency
with array literals recomputed every render defeats the memoization's whole purpose, so the
linter starts pointing at the remaining unstable ones. Don't expect fixing the named warning in
isolation to be the end of it — re-run `eslint --max-warnings=0` after ANY exhaustive-deps fix
that adds a function to a deps array, not just after the specific line changed.

**How to apply:** wrap the flagged conditional expressions in `useMemo` with the actual inputs
they read (verify no other code depends on now-removed intermediate variables — e.g. `groupPicks`/
`windowPicks`/`tagPicks` were each only used to build the final `pickerItems`, so they collapsed
into a single `useMemo` body with an if/return chain instead of three separate ternaries).
