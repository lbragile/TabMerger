import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@tabmerger/shared';

// Repo root is 6 levels up from this test file:
// packages/extension/src/__tests__/unit/lib -> packages/extension -> packages -> repo root
const MIGRATIONS_DIR = resolve(__dirname, '../../../../../../supabase/migrations');

/**
 * Returns the body of `create or replace function public.<name>(...) ... $$ ... $$;` from a
 * migration, so assertions only look at that function and never at comments or other SQL.
 */
function functionBody(sql: string, name: string): string | null {
  const start = sql.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'i'));
  if (start === -1) return null;
  const open = sql.indexOf('$$', start);
  const close = open === -1 ? -1 : sql.indexOf('$$', open + 2);
  return open === -1 || close === -1 ? null : sql.slice(open + 2, close);
}

/** Every `s.status in (...)` list in a SQL snippet, as arrays of the quoted statuses. */
function statusLists(sql: string): string[][] {
  return [...sql.matchAll(/s\.status\s+in\s*\(([^)]+)\)/gi)].map((m) =>
    (m[1].match(/'([^']+)'/g) ?? []).map((s) => s.slice(1, -1))
  );
}

/**
 * Every SQL function that decides "is this subscription paid" by status. Each must list the
 * exact statuses of `ENTITLED_SUBSCRIPTION_STATUSES`, or a Stripe status could be entitled
 * client-side but rejected by the database (or vice versa).
 */
const ENTITLEMENT_FUNCTIONS = [
  { file: '019_gate_cloud_sync_rls.sql', fn: 'has_cloud_sync', tier: /s\.tier\s+in\s*\(\s*'pro'\s*,\s*'pro_ai'\s*\)/i },
  {
    file: '022_ai_byok_and_cost_credits.sql',
    fn: 'ai_reserve_credits',
    tier: /s\.tier\s*=\s*'pro_ai'[\s\S]*s\.ai_mode\s*=\s*'managed'/i,
  },
] as const;

/**
 * Guards against the SQL entitlement checks drifting from `ENTITLED_SUBSCRIPTION_STATUSES` (TS):
 * `has_cloud_sync()` (cloud-sync RLS) and `ai_reserve_credits()` (managed Pro AI allowance).
 * Skips a migration gracefully if its file doesn't exist (e.g. renamed/renumbered) rather
 * than failing CI.
 */
describe.each(ENTITLEMENT_FUNCTIONS)('$fn() SQL vs ENTITLED_SUBSCRIPTION_STATUSES drift', ({ file, fn, tier }) => {
  const path = resolve(MIGRATIONS_DIR, file);
  if (!existsSync(path)) {
    it.skip(`supabase/migrations/${file} not found — skipping drift check`, () => {});
    return;
  }

  const body = functionBody(readFileSync(path, 'utf-8'), fn);

  it(`${file} defines public.${fn}()`, () => {
    expect(body).not.toBeNull();
  });

  it(`${fn}() checks the paid tier`, () => {
    expect(body ?? '').toMatch(tier);
  });

  it(`${fn}()'s status allowlist matches ENTITLED_SUBSCRIPTION_STATUSES exactly`, () => {
    // Expect an explicit `s.status in ('active', 'trialing', 'past_due')` style check, not a
    // broader `s.status <> 'canceled'` (see resolveTier() in src/lib/entitlementTier.ts).
    const lists = statusLists(body ?? '');
    expect(lists.length, `expected ${fn}() to use an explicit status allowlist (s.status in (...))`).toBeGreaterThan(0);
    expect(body ?? '').not.toMatch(/s\.status\s*(<>|!=)/i);
    for (const statuses of lists) {
      expect(new Set(statuses)).toEqual(new Set(ENTITLED_SUBSCRIPTION_STATUSES));
    }
  });
});
