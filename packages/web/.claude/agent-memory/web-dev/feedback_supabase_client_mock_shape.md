---
name: feedback-supabase-client-mock-shape
description: any RTL test rendering a tree that mounts SyncIndicator (e.g. AppLayout) must mock @/lib/supabase/client's auth.onAuthStateChange, or the render throws on mount
metadata:
  type: feedback
---

`components/dashboard/SyncIndicator.tsx` calls `useSyncExtensionAuth()`
(`lib/hooks/useSyncExtensionAuth.ts`), which does
`supabase.auth.onAuthStateChange(...)` in a `useEffect` and unsubscribes via
`subscription.subscription.unsubscribe()` in cleanup. Any test that
`vi.mock('@/lib/supabase/client', ...)`s a client without an `auth` property will
throw `Cannot read properties of undefined (reading 'onAuthStateChange')` the moment
a component that (directly or transitively) renders `SyncIndicator` mounts — e.g.
`app/(app)/layout.tsx`.

**Why this bit us:** `__tests__/app-layout.test.tsx` mocked `@/lib/supabase/client` with
only `from`/`channel`/`removeChannel` (for the realtime read `SyncIndicator` also does),
missing `auth` entirely. This was a pure mock gap, not a product bug — the hook failing
loudly when `auth` is missing is correct behavior for a real client.

**How to apply:** the minimal working shape is
`auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) }`.
See `__tests__/useSyncExtensionAuth.test.tsx` for the fuller mock (asserts
`sendMessage` calls) if a test needs to actually exercise the callback instead of
just satisfying the mount/unmount contract.
