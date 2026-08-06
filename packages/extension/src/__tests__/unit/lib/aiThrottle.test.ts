import { describe, it, expect, vi, beforeEach } from 'vitest'
import { wasCalledToday, markCalledToday } from '@/lib/aiThrottle'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('aiThrottle', () => {
  it('reports not-called-today when storage has no entry for the action', async () => {
    ;(chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({})
    expect(await wasCalledToday('suggest-sessions')).toBe(false)
  })

  it('reports called-today after markCalledToday persists the current epoch day', async () => {
    const store: Record<string, unknown> = {}
    ;(chrome.storage.local.set as ReturnType<typeof vi.fn>).mockImplementation(async (obj: Record<string, unknown>) => {
      Object.assign(store, obj)
    })
    ;(chrome.storage.local.get as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => ({ [key]: store[key] }))

    await markCalledToday('suggest-sessions')
    expect(await wasCalledToday('suggest-sessions')).toBe(true)
  })

  it('treats a stale (different-day) entry as not-called-today', async () => {
    ;(chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ 'ai_last_call_suggest-sessions': 1 })
    expect(await wasCalledToday('suggest-sessions')).toBe(false)
  })

  it('keys are scoped per action', async () => {
    await markCalledToday('suggest-sessions')
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'ai_last_call_suggest-sessions': expect.any(Number) })
    )
  })
})
