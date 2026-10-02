---
name: continue-on-device-red-phase
description: Test file layout and mock shape for the "Continue on other device" feature (deviceSessions.ts + Settings/OtherDevices.tsx), written red-phase before the implementation
metadata:
  type: project
---

The "Continue on other device" feature (`device_sessions` Supabase table,
`src/lib/deviceSessions.ts`, `src/components/Settings/OtherDevices.tsx`) was tested red-phase
first: `src/__tests__/unit/lib/deviceSessions.test.ts` and
`src/__tests__/unit/components/Settings/OtherDevices.test.tsx`. Before the implementation
landed, both failed with "Failed to resolve import" (module not found), as expected for
red-phase tests of new modules.

**Why:** Settings UI lives in `components/Modal/Settings.tsx` as one big tabbed modal;
`OtherDevices.tsx` was the first sub-component under `components/Settings/`. The panel test
mounts it standalone (not only via the Settings modal tabs), matching how
`SubscriptionStatusBanner.test.tsx` renders in isolation.

**How to apply:** keep `OtherDevices.tsx` importable standalone and wired into `Settings.tsx`
as a tab. Don't inline its logic into `Settings.tsx`, or these tests need reworking to mount
the whole modal. The `pushDeviceSession` tests rely on a debounce implemented as a plain
module-level timer (exported `DEVICE_SESSION_DEBOUNCE_MS`, fake-timer-friendly). For the
Supabase client/builder mock split, see [[learnings_supabase_mock]].
