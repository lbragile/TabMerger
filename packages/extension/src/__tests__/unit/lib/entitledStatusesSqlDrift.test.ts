import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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
] as const;

/**
 * Guards against the SQL entitlement checks drifting from `ENTITLED_SUBSCRIPTION_STATUSES` (TS):
 * `has_cloud_sync()` (cloud-sync RLS). `ai_reserve_credits()` counts the managed allowance for
 * `active` only since migration 027 and the freeze trigger uses the entitled list: both are
 * checked below.
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

/** Every migration file name, in apply order. */
function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

/**
 * The managed Pro AI allowance in `ai_reserve_credits()` (latest migration that defines it) is
 * narrower than entitlement since 027: only an `active` subscription earns new managed credits,
 * while `trialing`/`past_due` stay entitled for sync and may still spend credit packs. So its
 * allowance filter must be exactly `s.status = 'active'`, and it must not carry an entitled list
 * (or any broader `<>` check) that could put the allowance back for other statuses.
 */
describe('ai_reserve_credits() managed allowance: active only', () => {
  const file = [...migrationFiles()].reverse().find((f) => functionBody(readFileSync(resolve(MIGRATIONS_DIR, f), 'utf-8'), 'ai_reserve_credits') !== null);
  const body = file ? functionBody(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8'), 'ai_reserve_credits') ?? '' : '';

  it('a migration defines public.ai_reserve_credits()', () => {
    expect(file).toBeDefined();
  });

  it('counts the allowance only for pro_ai + managed + status active', () => {
    expect(body).toMatch(/s\.tier\s*=\s*'pro_ai'[\s\S]*s\.ai_mode\s*=\s*'managed'[\s\S]*s\.status\s*=\s*'active'/i);
    expect(ENTITLED_SUBSCRIPTION_STATUSES).toContain('active');
  });

  it('has no other status filter on the subscription', () => {
    expect(statusLists(body)).toEqual([]);
    expect(body).not.toMatch(/s\.status\s*(<>|!=)/i);
    expect(body.match(/s\.status\s*=/gi)).toHaveLength(1);
  });
});

/**
 * 027's freeze trigger records the allowance already spent when it drops to 0, only for a row that
 * could have spent it: pro_ai + managed + an entitled status (`old.status in (...)` in the
 * trigger's WHEN clause). That list must be ENTITLED_SUBSCRIPTION_STATUSES.
 */
describe('subscriptions_freeze_ai_allowance trigger vs ENTITLED_SUBSCRIPTION_STATUSES drift', () => {
  const file = '027_ai_credit_revocation_and_past_due_allowance.sql';
  const path = resolve(MIGRATIONS_DIR, file);
  if (!existsSync(path)) {
    it.skip(`supabase/migrations/${file} not found — skipping drift check`, () => {});
    return;
  }
  const sql = readFileSync(path, 'utf-8');
  const start = sql.search(/create\s+or\s+replace\s+trigger\s+subscriptions_freeze_ai_allowance/i);
  const clause = start === -1 ? '' : sql.slice(start, sql.indexOf('execute function', start));

  it(`${file} creates the trigger with a WHEN clause`, () => {
    expect(clause).toMatch(/when\s*\(/i);
  });

  it('fires only for a managed pro_ai row with an entitled status', () => {
    expect(clause).toMatch(/old\.tier\s*=\s*'pro_ai'/i);
    expect(clause).toMatch(/old\.ai_mode\s*=\s*'managed'/i);
    const lists = [...clause.matchAll(/old\.status\s+in\s*\(([^)]+)\)/gi)].map((m) =>
      (m[1].match(/'([^']+)'/g) ?? []).map((s) => s.slice(1, -1))
    );
    expect(lists).toHaveLength(1);
    expect(new Set(lists[0])).toEqual(new Set(ENTITLED_SUBSCRIPTION_STATUSES));
  });
});
