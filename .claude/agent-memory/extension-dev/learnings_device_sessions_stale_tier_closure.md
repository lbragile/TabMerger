---
name: device-sessions-stale-tier-closure
description: useCurrentTabs' mount-once effect closed over useEntitlements' tier at its first-render value ('free'), permanently breaking device_sessions writes for every user
metadata:
  type: feedback
---

`useCurrentTabs.ts`'s single `useEffect(() => {...}, [qc])` registers 8 chrome.tabs/windows
listeners once on mount and deliberately keeps a stable dep array so those listeners aren't
torn down/re-registered every time `useEntitlements()` refetches (it polls every 30s and
TanStack Query returns a new object reference each time even when the value is unchanged).

The bug: `doSync` inside that effect read `tier` directly from the outer closure. `tier`
starts as `'free'` on the very first render (before the `subscriptions` query resolves —
`useEntitlements` returns `resolveTier(undefined)` = `'free'` while `isLoading` is still
true). Because the effect body only ever runs once, that `'free'` was baked in for the
lifetime of the popup — `pushDeviceSession(next, tier)` always sent `'free'`, and
`deviceSessions.ts`'s `doPush()` no-ops on free tier (`if (!state || tier === 'free') return`).
Result: `device_sessions` rows were NEVER created, for any user, on any device, ever — not
intermittent, 100% broken from day one of this feature.

**Fix pattern:** don't add the fast-changing value to the effect's deps (that reintroduces
listener churn). Instead keep a `useRef` synced by its own tiny effect
(`useEffect(() => { tierRef.current = tier }, [tier])`), and read `tierRef.current` from
inside the mount-once effect's closures. This is the general fix for "stable effect deps but
the callback needs a live value" — watch for this pattern anywhere a `useEffect` has an
intentionally narrow dep array (usually to avoid re-registering listeners/subscriptions) but
its body reads another hook's return value that isn't in that array. Checked `useSync.ts` for
the same shape — it's fine, `doSync` is a `useCallback` with `[session, cloudSync, qc, ...]`
in its deps and the effect depends on `doSync`, so it isn't stale.
