---
name: cloud-sync-gating-helper
description: hasCloudSync() single-source gate for all free-vs-paid sync UI on dashboard/account pages, and its test-mock gotchas
metadata:
  type: project
---

`packages/web/lib/cloudSync.ts` exports `hasCloudSync(subscription)` — the single gate for
"does this account get cloud sync" (dashboard Tab Groups/Saved Sessions/SyncIndicator/New-group
button, account page Devices card/sync-stat cards). It requires BOTH a paid tier (`pro`/`pro_ai`)
AND `isEntitledSubscriptionStatus(status)` from `@tabmerger/shared` (active/trialing/past_due) —
matches the RLS gate in `supabase/migrations/019_gate_cloud_sync_rls.sql`. An `incomplete`/`unpaid`
paid-tier subscriber must be treated identically to free. Don't re-derive this check inline
anywhere — both dashboard/page.tsx and (app)/layout.tsx and account/page.tsx now import it.

When a page is gated this way, also **skip the Supabase queries themselves** for the
non-entitled branch (don't just hide the JSX) — nothing renders them anyway, and it avoids an
unnecessary RLS-rejected round trip. Wrap each `supabase.from(...).select(...)` in the
`if (syncEnabled)` branch, not just the JSX.

StatsOverview needed a `showSyncStats` boolean prop (not zeros) to hide Tabs/Groups/Sessions/
Memory cards for free accounts while keeping Member Since (and AI usage, which has independent
gating). When `showSyncStats` is false the 3-col desktop grid must shrink (`sm:max-w-md`-style
cap) or a single leftover card visibly floats in a broken half-empty row.

Test-mock gotcha: existing RTL suites (`DashboardHeader.test.tsx`, `account-page-visuals.test.tsx`,
`dashboard-account-responsive.test.tsx`) mock `subscriptions.single()` with only `{tier}` — once a
page start using `hasCloudSync`, every one of those mocks needs `status: 'active'` added or the
whole gated UI silently vanishes in unrelated tests (e.g. the responsive-grid test broke because
its free-tier mock now had zero rendered stats grid to assert against). Grep all
`vi.doMock('@/lib/supabase/server'` blocks in the touched test files whenever adding a new
`hasCloudSync`-consuming render path.
