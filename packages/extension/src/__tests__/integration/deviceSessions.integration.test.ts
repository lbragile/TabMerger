import { describe, it, expect, beforeEach } from 'vitest'
import { getOrCreateDeviceId } from '@/lib/deviceSessions'
import { clearDb } from './dbTestUtils'

// ponytail: no vi.mock('@/lib/localDb') — getOrCreateDeviceId round-trips through real
// IndexedDB (fake-indexeddb, see integration/setup.ts) via getSetting/setSetting.

describe('getOrCreateDeviceId — real IndexedDB integration', () => {
  beforeEach(async () => {
    await clearDb()
  })

  it('is idempotent across a simulated restart (module state cleared, DB persists)', async () => {
    const firstId = await getOrCreateDeviceId()
    expect(firstId).toMatch(/^[0-9a-f-]{36}$/i)

    // Simulate a popup close/reopen: no in-memory module state to reset here since
    // getOrCreateDeviceId reads from IndexedDB every call rather than caching in a module var.
    const secondId = await getOrCreateDeviceId()

    expect(secondId).toBe(firstId)
  })
})
