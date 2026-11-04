import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AI_MONTHLY_PERIOD_MAX_DAYS, aiAllowanceMonth } from '@tabmerger/shared'

// Repo root is 3 levels up from this test file: packages/web/__tests__ -> repo root
const PGTAP_PATH = resolve(__dirname, '../../../supabase/tests/030_ai_billing_period_credits.test.sql')
const MIGRATION_PATH = resolve(__dirname, '../../../supabase/migrations/030_ai_billing_period_credits.sql')

/** The case table of the pgTAP file, between its two AGREEMENT markers. */
function agreementCases(): { start: string | null; end: string | null; now: string; expected: string; label: string }[] {
  const sql = readFileSync(PGTAP_PATH, 'utf-8')
  const block = sql.slice(sql.indexOf('-- AGREEMENT CASES START'), sql.indexOf('-- AGREEMENT CASES END'))
  const row = /\(\s*(null|'[^']+')\s*,\s*(null|'[^']+')\s*,\s*'([^']+)'\s*,\s*'(\d{4}-\d{2})'\s*,\s*'((?:[^']|'')+)'\s*\)/g
  const unquote = (v: string) => (v === 'null' ? null : v.slice(1, -1))
  return [...block.matchAll(row)].map((m) => ({ start: unquote(m[1]), end: unquote(m[2]), now: m[3], expected: m[4], label: m[5] }))
}

/**
 * The month key rule lives twice: aiAllowanceMonth() in `@tabmerger/shared` and ai_allowance_month()
 * in SQL (migration 030). The pgTAP file checks SQL against the case table it holds; this checks the
 * TS helper against that same table, so a case added there is proven on both sides. pgTAP isn't in
 * CI, so this half at least fails there if the TS rule moves. Skips if the files are not there,
 * rather than failing CI.
 */
describe('aiAllowanceMonth() vs the SQL ai_allowance_month()', () => {
  if (!existsSync(PGTAP_PATH) || !existsSync(MIGRATION_PATH)) {
    it.skip('migration 030 or its pgTAP file not found: skipping the agreement check', () => {})
    return
  }

  const cases = agreementCases()

  it('reads the whole case table', () => {
    const sql = readFileSync(PGTAP_PATH, 'utf-8')
    const block = sql.slice(sql.indexOf('-- AGREEMENT CASES START'), sql.indexOf('-- AGREEMENT CASES END'))
    const lines = block.split('\n').filter((line) => line.trim().startsWith('('))
    expect(cases).toHaveLength(lines.length)
    expect(cases.length).toBeGreaterThanOrEqual(30)
  })

  it.each(cases)('$label', ({ start, end, now, expected }) => {
    expect(aiAllowanceMonth(start, end, new Date(now))).toBe(expected)
  })

  it('both sides use the same monthly limit', () => {
    expect(readFileSync(MIGRATION_PATH, 'utf-8')).toContain(`interval '${AI_MONTHLY_PERIOD_MAX_DAYS} days'`)
  })
})
