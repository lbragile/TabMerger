import { describe, expect, it } from 'vitest'
import { DB_VERSION } from '@/lib/localDb'

// NEVER let this go down. Once a build with IndexedDB version N has run on a device, the database
// there IS version N: a later build that opens it with a lower number gets a VersionError (getDb
// then opens it without upgrading, so data stays readable, but stores added after the lower version
// are no longer created). Reverting a version bump after it shipped must keep the number. Raise the
// floor below whenever DB_VERSION goes up.
const SHIPPED_DB_VERSION_FLOOR = 2

describe('IndexedDB version', () => {
  it('is never lower than a version that has shipped', () => {
    expect(DB_VERSION).toBeGreaterThanOrEqual(SHIPPED_DB_VERSION_FLOOR)
  })
})
