import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { STORED_SUBSCRIPTION_STATUSES } from '@tabmerger/shared'

// Repo root is 3 levels up from this test file: packages/web/__tests__ -> repo root
const MIGRATION_PATH = resolve(__dirname, '../../../supabase/migrations/001_initial_schema.sql')

/**
 * Guards against the CHECK list on `subscriptions.status` (SQL) drifting from
 * `STORED_SUBSCRIPTION_STATUSES` (TS). The Stripe webhook writes only statuses from the TS list,
 * so a value in the TS list that the column rejects would fail every write of that status.
 * If a later migration replaces the constraint, point this test at that migration. Skips if the
 * migration file is not there, rather than failing CI.
 */
describe('subscriptions.status CHECK vs STORED_SUBSCRIPTION_STATUSES drift', () => {
  if (!existsSync(MIGRATION_PATH)) {
    it.skip('supabase/migrations/001_initial_schema.sql not found — skipping drift check', () => {})
    return
  }

  const sql = readFileSync(MIGRATION_PATH, 'utf-8')

  it('the status column allows exactly STORED_SUBSCRIPTION_STATUSES', () => {
    const match = sql.match(/\bstatus\s+text\b[^,\n]*?check\s*\(\s*status\s+in\s*\(([^)]+)\)/i)
    expect(match, 'expected subscriptions.status to have a `check (status in (...))` list').not.toBeNull()

    const statuses = (match![1].match(/'([^']+)'/g) ?? []).map((s) => s.slice(1, -1))
    expect(new Set(statuses)).toEqual(new Set(STORED_SUBSCRIPTION_STATUSES))
  })
})
