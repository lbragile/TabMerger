import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getDevAiUsage, incrementDevAiUsage, setDevAiUsage } from '@/mocks/devAiUsage'

const STORAGE_KEY = 'tm_dev_ai_usage_count'

describe('devAiUsage', () => {
  let store: Record<string, unknown>

  beforeEach(() => {
    store = {}
    ;(globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local.get = vi
      .fn()
      .mockImplementation((key: string) => Promise.resolve({ [key]: store[key] }))
    ;(globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local.set = vi
      .fn()
      .mockImplementation((obj: Record<string, unknown>) => {
        Object.assign(store, obj)
        return Promise.resolve()
      })
  })

  it('returns 0 when nothing stored', async () => {
    expect(await getDevAiUsage()).toBe(0)
  })

  it('increments the count for the current month', async () => {
    await incrementDevAiUsage()
    await incrementDevAiUsage()
    expect(await getDevAiUsage()).toBe(2)
    expect(store[STORAGE_KEY]).toMatchObject({ count: 2 })
  })

  it('resets to 0 when the stored month does not match the current month', async () => {
    store[STORAGE_KEY] = { month: '2000-01', count: 50 }
    expect(await getDevAiUsage()).toBe(0)
  })

  it('setDevAiUsage overwrites the count directly', async () => {
    await setDevAiUsage(75)
    expect(await getDevAiUsage()).toBe(75)
  })
})
