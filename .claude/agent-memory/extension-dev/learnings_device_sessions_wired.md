---
name: device-sessions-wired
description: pushDeviceSession wiring point in useCurrentTabs.ts confirmed by reading the code
metadata:
  type: project
---

pushDeviceSession(state, tier) is called in useCurrentTabs.ts's `doSync`, immediately after
`qc.setQueryData(GROUPS_QUERY_KEY, next)` and before the `fetchOg` ogImage backfill branch.
This matches what the deviceSessions.ts author described secondhand, but note the actual
signature is `pushDeviceSession(state: GroupsState, tier: Tier = 'pro')` — positional, not
`(payload, { tier })` as a memory summary claimed. Always verify signatures by reading the
file, not by trusting a secondhand description.

Tier comes from `useEntitlements().tier` (Entitlements has a `tier: Tier` field spread from
TIER_LIMITS[effectiveTier]). No extra free-tier guard was added before the call — doPush()
in deviceSessions.ts already no-ops for tier === 'free', and scheduling the debounced timer
is cheap even when it will no-op, so an upstream guard would be redundant work.

See [[learnings_device_sessions_write_path]] for the debounce/push internals.
