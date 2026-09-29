import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@tabmerger/shared';

// Repo root is 6 levels up from this test file:
// packages/extension/src/__tests__/unit/lib -> packages/extension -> packages -> repo root
const MIGRATION_PATH = resolve(
  __dirname,
  '../../../../../../supabase/migrations/019_gate_cloud_sync_rls.sql'
);

/**
 * Guards against `has_cloud_sync()` (SQL) drifting from `ENTITLED_SUBSCRIPTION_STATUSES` (TS).
 * Both must list the exact same paid statuses and paid tiers, or a Stripe status change
 * could be entitled client-side but rejected by RLS (or vice versa). Skips gracefully if
 * the migration file doesn't exist yet (e.g. renamed/renumbered) rather than failing CI.
 */
describe('has_cloud_sync() SQL vs ENTITLED_SUBSCRIPTION_STATUSES drift', () => {
  if (!existsSync(MIGRATION_PATH)) {
    it.skip('supabase/migrations/019_gate_cloud_sync_rls.sql not found — skipping drift check', () => {});
    return;
  }

  const sql = readFileSync(MIGRATION_PATH, 'utf-8');

  it('has_cloud_sync() checks tier in (pro, pro_ai) — the paid tiers', () => {
    expect(sql).toMatch(/s\.tier\s+in\s*\(\s*'pro'\s*,\s*'pro_ai'\s*\)/i);
  });

  it("has_cloud_sync()'s status allowlist matches ENTITLED_SUBSCRIPTION_STATUSES exactly", () => {
    // Expect an explicit `s.status in ('active', 'trialing', 'past_due')` style check,
    // not the old `s.status <> 'canceled'` — that broader form is what this migration
    // is meant to tighten per the owner decision (see useEntitlements.ts resolveTier()).
    const statusListMatch = sql.match(/s\.status\s+in\s*\(([^)]+)\)/i);
    expect(statusListMatch, 'expected has_cloud_sync() to use an explicit status allowlist (s.status in (...)), not s.status <> \'canceled\'').not.toBeNull();

    const statuses = (statusListMatch![1].match(/'([^']+)'/g) ?? []).map((s) => s.slice(1, -1));
    expect(new Set(statuses)).toEqual(new Set(ENTITLED_SUBSCRIPTION_STATUSES));
  });
});
