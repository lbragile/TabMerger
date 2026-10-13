import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AUTO_BACKUP_MESSAGE } from '@tabmerger/shared'
import { DEFAULT_APP_SETTINGS, useAppSettings, useSaveAppSettings } from '@/hooks/useAppSettings'

const h = vi.hoisted(() => ({ stored: undefined as unknown, setSetting: vi.fn() }))
vi.mock('@/lib/localDb', () => ({
  getSetting: vi.fn(async (_k: string, d: unknown) => (h.stored === undefined ? d : h.stored)),
  setSetting: (...a: unknown[]) => h.setSetting(...a),
}))

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children)

let sendMessage: ReturnType<typeof vi.fn>
beforeEach(() => {
  h.stored = undefined
  h.setSetting.mockReset().mockResolvedValue(undefined)
  sendMessage = vi.fn()
  ;(globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage } }
})

describe('automatic backup settings defaults', () => {
  it('DEFAULT_APP_SETTINGS has backups on, daily', () => {
    expect(DEFAULT_APP_SETTINGS.autoBackupEnabled).toBe(true)
    expect(DEFAULT_APP_SETTINGS.autoBackupIntervalMinutes).toBe(1440)
  })

  it('nothing stored yet returns the defaults', async () => {
    const { result } = renderHook(() => useAppSettings(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(DEFAULT_APP_SETTINGS))
  })

  it('an old stored object without the two keys is returned as stored (readers apply the defaults)', async () => {
    const { autoBackupEnabled: _a, autoBackupIntervalMinutes: _b, ...old } = DEFAULT_APP_SETTINGS
    h.stored = old
    const { result } = renderHook(() => useAppSettings(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(old))
  })
})

describe('useSaveAppSettings', () => {
  it('persists, updates the cache and tells the worker the backup settings changed', async () => {
    const { result } = renderHook(() => useSaveAppSettings(), { wrapper })
    const next = { ...DEFAULT_APP_SETTINGS, autoBackupIntervalMinutes: 60 as const }
    await result.current.mutateAsync(next)
    expect(h.setSetting).toHaveBeenCalledWith('appSettings', next)
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: AUTO_BACKUP_MESSAGE.SETTINGS_CHANGED }, expect.any(Function)))
  })

  it('does not notify when the write failed', async () => {
    h.setSetting.mockRejectedValue(new Error('idb'))
    const { result } = renderHook(() => useSaveAppSettings(), { wrapper })
    await expect(result.current.mutateAsync(DEFAULT_APP_SETTINGS)).rejects.toThrow()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('a missing chrome.runtime or a throwing sendMessage does not fail the save', async () => {
    ;(globalThis as { chrome?: unknown }).chrome = {}
    const { result } = renderHook(() => useSaveAppSettings(), { wrapper })
    await expect(result.current.mutateAsync(DEFAULT_APP_SETTINGS)).resolves.toBeDefined()
    sendMessage.mockImplementation(() => { throw new Error('invalidated') })
    ;(globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage } }
    await expect(result.current.mutateAsync(DEFAULT_APP_SETTINGS)).resolves.toBeDefined()
  })
})
