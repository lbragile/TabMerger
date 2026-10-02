---
name: learnings-ga4-event-wiring
description: Where GA4 trackEvent call sites already live and gotchas when adding more (hooks conditional order, render-time firing)
metadata:
  type: project
---

When asked to wire up new GA4 `trackEvent` events, some events may already exist under
slightly different names from prior work not reflected in the task's "already wired" list —
grep `trackEvent(` across `src/` first before assuming an event is new. Found already-wired-but-
undocumented: `tab_saved` (useMoveTab), `ai_feature_used` (useAI, all 4 mutations with a
`feature_name` param), `session_restored` (useRestoreSession in useSessions.ts).

**Why:** the task prompt's list of pre-existing events can go stale across agent sessions;
trusting it without grepping risks either duplicate/conflicting event names or skipping a
call site that already does 90% of the job.

**How to apply:** always `grep -rn "trackEvent(" src --include=*.ts --include=*.tsx | grep -v __tests__`
before wiring new analytics events. When a newly-requested event name is semantically
identical to an existing one at the same call site (e.g. spec wants `tabs_saved`, code already
fires `tab_saved`), it's fine to fire both at that site rather than rename the old one — keeps
historical GA4 continuity intact and is a 1-line diff.

**Firing "shown" events from components with early returns:** components like `UpgradeCTA.tsx`
compute an eligibility gate and `return null` before any JSX. You cannot add a `useEffect` for
a "prompt shown" event *after* that early return — violates rules-of-hooks (conditional hook
call across renders). Fix: hoist all hook calls (including a `useRef` used as a fire-once guard)
above every early return, compute the "shown" boolean without returning early, and fire
`trackEvent` directly in the render body guarded by the ref (not inside `useEffect`) once the
boolean flips true. This is deliberately impure-in-render but matches the existing pattern of
fire-and-forget marketing analytics elsewhere in this codebase, and avoids a hook-order bug.
For components without early returns before the JSX (e.g. modals — always rendered when open),
a normal mount-only `useEffect(() => { trackEvent(...) }, [])` is fine and preferred.
