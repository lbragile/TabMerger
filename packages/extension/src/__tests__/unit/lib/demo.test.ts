import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSaveGroupsState } = vi.hoisted(() => ({
  mockSaveGroupsState: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/localDb', () => ({ saveGroupsState: mockSaveGroupsState }))

import { enterDemoMode } from '@/lib/demo'

describe('enterDemoMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as { chrome: Record<string, unknown> }).chrome = {
      windows: {
        create: vi.fn().mockResolvedValue({ id: 99 }),
        getAll: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 99 }]),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    }
  })

  it('seeds demo data before touching windows', async () => {
    await enterDemoMode()
    expect(mockSaveGroupsState).toHaveBeenCalled()
  })

  it('creates a fresh window and closes every other window, keeping the fresh one', async () => {
    await enterDemoMode()
    const chromeWindows = (globalThis as { chrome: { windows: { remove: ReturnType<typeof vi.fn> } } }).chrome.windows
    expect(chromeWindows.remove).toHaveBeenCalledTimes(2)
    expect(chromeWindows.remove).toHaveBeenCalledWith(1)
    expect(chromeWindows.remove).toHaveBeenCalledWith(2)
    expect(chromeWindows.remove).not.toHaveBeenCalledWith(99)
  })

  it('skips windows with an undefined id', async () => {
    ;(globalThis as { chrome: Record<string, unknown> }).chrome = {
      windows: {
        create: vi.fn().mockResolvedValue({ id: 99 }),
        getAll: vi.fn().mockResolvedValue([{ id: undefined }, { id: 99 }]),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    }
    await enterDemoMode()
    const chromeWindows = (globalThis as { chrome: { windows: { remove: ReturnType<typeof vi.fn> } } }).chrome.windows
    expect(chromeWindows.remove).not.toHaveBeenCalled()
  })
})
