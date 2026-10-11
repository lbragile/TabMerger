#!/usr/bin/env node
// ponytail: flat script over a package — just diffs two coverage-summary.json "total" blocks.
//
// Usage: node scripts/ci/coverage-delta.mjs <baseline.json> <current.json> [maxDropPoints]
//
// Fails (exit 1) if any of statements/branches/functions/lines dropped by more
// than `maxDropPoints` percentage points vs baseline, even if still >= the
// vitest.config.ts threshold (80%) — that floor is already enforced by
// `vitest run --coverage` itself failing the job.
//
// If baseline is missing (first run on master, or artifact expired), this is
// a no-op pass — there's nothing to compare against yet.

import { readFileSync, existsSync } from 'node:fs'

const [, , baselinePath, currentPath, maxDropArg] = process.argv
const MAX_DROP = Number(maxDropArg ?? 2) // percentage points

if (!baselinePath || !currentPath) {
  console.error('Usage: coverage-delta.mjs <baseline.json> <current.json> [maxDropPoints]')
  process.exit(1)
}

if (!existsSync(baselinePath)) {
  // A notice (shown on the run's summary page), not a plain log line: a skip that
  // happens on every run means the baseline path is wrong, and that must be visible.
  console.log(`::notice::No baseline coverage found at ${baselinePath} — skipping delta check (nothing to compare).`)
  process.exit(0)
}

if (!existsSync(currentPath)) {
  console.error(`::error::Current coverage summary not found at ${currentPath}`)
  process.exit(1)
}

const metrics = ['statements', 'branches', 'functions', 'lines']

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).total
const current = JSON.parse(readFileSync(currentPath, 'utf8')).total

let failed = false
for (const metric of metrics) {
  const before = baseline[metric].pct
  const after = current[metric].pct
  const drop = before - after
  const status = drop > MAX_DROP ? 'REGRESSION' : 'ok'
  console.log(`${metric.padEnd(11)} ${before.toFixed(2)}% -> ${after.toFixed(2)}% (${drop >= 0 ? '-' : '+'}${Math.abs(drop).toFixed(2)}pt) [${status}]`)
  if (drop > MAX_DROP) failed = true
}

if (failed) {
  console.error(`::error::Coverage regressed by more than ${MAX_DROP} percentage points on at least one metric.`)
  process.exit(1)
}

console.log('Coverage delta OK.')
