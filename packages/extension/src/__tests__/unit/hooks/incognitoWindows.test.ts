/**
 * Incognito-aware reopening of saved windows: useOpenWindow, useRestoreSession,
 * useBulkMoveToGroup (window -> Now Open) and useMoveWindow (-> Now Open).
 * `incognito: true` is passed only when the saved window was incognito AND the extension is
 * allowed in incognito; otherwise a normal window opens (and the user is told once).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useOpenWindow } from '@/hooks/useOpenWindow'
import { useRestoreSession } from '@/hooks/useSessions'
import { useBulkMoveToGroup } from '@/hooks/useBulkActions'
import { useMoveWindow, GROUPS_QUERY_KEY } from '@/hooks/useGroups'
import { createGroup, createNowOpenGroup } from '@/lib/utils'
import type { GroupsState, Window as ExtWindow, Session } from '@/lib/types'

const { mockToastInfo, mockGetGroupsState } = vi.hoisted(() => ({ mockToastInfo: vi.fn(), mockGetGroupsState: vi.fn() }))

vi.mock('@/lib/toast', () => ({ toast: { info: mockToastInfo, error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/localDb', async () => (await import('@/__tests__/unit/_helpers/updateGroupsStateMock')).withUpdateGroupsState({
  saveGroupsState: vi.fn().mockResolvedValue(undefined),
  getGroupsState: mockGetGroupsState,
  setSetting: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue(false),
  getSessions: vi.fn().mockResolvedValue([]),
  saveSession: vi.fn(),
  deleteSession: vi.fn(),
}))
vi.mock('@/lib/syncEngine', () => ({ deleteRemoteGroups: vi.fn().mockResolvedValue(undefined), canUploadOnFirefox: vi.fn() }))
vi.mock('@/hooks/useUrlRules', () => ({ deleteRulesForGroupIds: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() }, from: vi.fn() } }))
vi.mock('@/lib/encryptionKey', () => ({ getEncryptionKeyState: vi.fn().mockResolvedValue('absent'), getDataKey: vi.fn() }))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('@/lib/chromeGroups', () => ({ openTabInChromeGroup: vi.fn().mockResolvedValue(undefined) }))

const chromeMock = {
  extension: { isAllowedIncognitoAccess: vi.fn() },
  tabs: { query: vi.fn(), create: vi.fn(), remove: vi.fn() },
  windows: { create: vi.fn(), update: vi.fn(), getAll: vi.fn(), remove: vi.fn() },
}

function win(incognito: boolean, urls = ['https://a.com', 'https://b.com']): ExtWindow {
  return {
    id: 1,
    incognito,
    focused: false,
    tabs: urls.map((url, i) => ({ id: i + 1, url, title: url, favIconUrl: '', pinned: false })),
  } as ExtWindow
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  return { qc, wrapper }
}

beforeEach(() => {
  vi.clearAllMocks()
  chromeMock.extension.isAllowedIncognitoAccess.mockResolvedValue(true)
  chromeMock.tabs.query.mockResolvedValue([])
  chromeMock.tabs.create.mockResolvedValue({})
  chromeMock.windows.create.mockResolvedValue({ id: 99, tabs: [] })
  chromeMock.windows.getAll.mockResolvedValue([])
  chromeMock.windows.update.mockResolvedValue({})
  globalThis.chrome = chromeMock as unknown as typeof chrome
})

describe('useOpenWindow — incognito', () => {
  it('creates an incognito window when the saved window was incognito and access is allowed', async () => {
    const { result } = renderHook(() => useOpenWindow())
    await act(async () => { await result.current(win(true)) })
    expect(chromeMock.windows.create).toHaveBeenCalledWith({ focused: true, incognito: true })
    expect(mockToastInfo).not.toHaveBeenCalled()
  })

  it('creates a normal window (and toasts) when incognito access is denied', async () => {
    chromeMock.extension.isAllowedIncognitoAccess.mockResolvedValue(false)
    const { result } = renderHook(() => useOpenWindow())
    await act(async () => { await result.current(win(true)) })
    expect(chromeMock.windows.create).toHaveBeenCalledWith({ focused: true })
    expect(mockToastInfo).toHaveBeenCalledTimes(1)
  })

  it('never passes incognito for a non-incognito saved window', async () => {
    const { result } = renderHook(() => useOpenWindow())
    await act(async () => { await result.current(win(false)) })
    expect(chromeMock.windows.create).toHaveBeenCalledWith({ focused: true })
    expect(chromeMock.extension.isAllowedIncognitoAccess).not.toHaveBeenCalled()
  })

  it('matched-existing-window path is unchanged: focuses it, creates no window, no incognito lookup', async () => {
    chromeMock.tabs.query.mockResolvedValue([{ url: 'https://a.com', windowId: 42 }])
    const { result } = renderHook(() => useOpenWindow())
    await act(async () => { await result.current(win(true)) })
    expect(chromeMock.windows.update).toHaveBeenCalledWith(42, { focused: true })
    expect(chromeMock.windows.create).not.toHaveBeenCalled()
    expect(chromeMock.extension.isAllowedIncognitoAccess).not.toHaveBeenCalled()
  })
})

describe('useRestoreSession — incognito', () => {
  function session(...wins: ExtWindow[]): Session {
    return {
      id: 's1',
      name: 'S',
      createdAt: 1,
      groups: [{ id: 'g1', name: 'G', color: 'rgba(0,0,0,1)', updatedAt: 1, permanent: false, windows: wins }],
    } as Session
  }

  it('recreates an incognito window with incognito: true when allowed', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useRestoreSession(), { wrapper })
    await act(async () => { await result.current.mutateAsync(session(win(true))) })
    expect(chromeMock.windows.create).toHaveBeenCalledWith({ url: 'https://a.com', incognito: true })
    expect(mockToastInfo).not.toHaveBeenCalled()
  })

  it('recreates normal windows (single toast for several incognito windows) when denied', async () => {
    chromeMock.extension.isAllowedIncognitoAccess.mockResolvedValue(false)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useRestoreSession(), { wrapper })
    await act(async () => { await result.current.mutateAsync(session(win(true), win(true), win(false))) })
    expect(chromeMock.windows.create).toHaveBeenCalledTimes(3)
    for (const call of chromeMock.windows.create.mock.calls) expect(call[0]).toEqual({ url: 'https://a.com' })
    // Each denied resolve toasts with the same fixed id (sonner dedupes), so the id must be constant.
    expect(mockToastInfo).toHaveBeenCalledTimes(2)
    for (const call of mockToastInfo.mock.calls) expect(call[1]).toEqual({ id: 'incognito-not-allowed' })
  })

  it('never passes incognito for a non-incognito window', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useRestoreSession(), { wrapper })
    await act(async () => { await result.current.mutateAsync(session(win(false))) })
    expect(chromeMock.windows.create).toHaveBeenCalledWith({ url: 'https://a.com' })
  })
})

describe('move window to Now Open — incognito', () => {
  function stateWith(w: ExtWindow): GroupsState {
    const nowOpen = createNowOpenGroup()
    nowOpen.windows = []
    const group = createGroup('a', 'A')
    group.windows = [w]
    return { active: { id: group.id, index: 1 }, available: [nowOpen, group] }
  }

  describe.each([
    ['useBulkMoveToGroup', async (wrapper: React.FC<{ children: React.ReactNode }>) => {
      const { result } = renderHook(() => useBulkMoveToGroup(), { wrapper })
      await act(async () => { await result.current.mutateAsync({ items: [{ type: 'window' as const, id: 'window-1-0' }], targetGroupIndex: 0 }) })
    }],
    ['useMoveWindow', async (wrapper: React.FC<{ children: React.ReactNode }>) => {
      const { result } = renderHook(() => useMoveWindow(), { wrapper })
      await act(async () => { await result.current.mutateAsync({ fromGroupIndex: 1, windowIndex: 0, toGroupIndex: 0 }) })
    }],
  ])('%s', (_name, run) => {
    async function setup(w: ExtWindow) {
      const state = stateWith(w)
      mockGetGroupsState.mockResolvedValue(state)
      const { qc, wrapper } = makeWrapper()
      qc.setQueryData(GROUPS_QUERY_KEY, state)
      await run(wrapper)
    }

    it('opens an incognito window when allowed', async () => {
      await setup(win(true))
      await waitFor(() =>
        expect(chromeMock.windows.create).toHaveBeenCalledWith({ url: ['https://a.com', 'https://b.com'], focused: false, incognito: true })
      )
      expect(mockToastInfo).not.toHaveBeenCalled()
    })

    it('opens a normal window and toasts when incognito access is denied', async () => {
      chromeMock.extension.isAllowedIncognitoAccess.mockResolvedValue(false)
      await setup(win(true))
      await waitFor(() => expect(chromeMock.windows.create).toHaveBeenCalledWith({ url: ['https://a.com', 'https://b.com'], focused: false }))
      expect(mockToastInfo).toHaveBeenCalledTimes(1)
    })

    it('never passes incognito for a non-incognito window', async () => {
      await setup(win(false))
      await waitFor(() => expect(chromeMock.windows.create).toHaveBeenCalledWith({ url: ['https://a.com', 'https://b.com'], focused: false }))
      expect(chromeMock.extension.isAllowedIncognitoAccess).not.toHaveBeenCalled()
    })
  })
})

describe('useOpenWindow — stored URLs', () => {
  it('opens only the openable tabs of a saved window in the new window', async () => {
    const { result } = renderHook(() => useOpenWindow())
    await act(async () => { await result.current(win(false, ['javascript:alert(1)', 'https://a.com', 'data:text/html,x', 'chrome://extensions/'])) })
    expect(chromeMock.windows.create).toHaveBeenCalledTimes(1)
    expect(chromeMock.tabs.create.mock.calls.map(([arg]) => (arg as { url: string }).url)).toEqual(['https://a.com', 'chrome://extensions/'])
  })

  it('opens no window when the saved window has nothing openable', async () => {
    const { result } = renderHook(() => useOpenWindow())
    await act(async () => { await result.current(win(false, ['javascript:alert(1)', 'JaVaScRiPt:void(0)', ''])) })
    expect(chromeMock.tabs.query).not.toHaveBeenCalled()
    expect(chromeMock.windows.create).not.toHaveBeenCalled()
    expect(chromeMock.tabs.create).not.toHaveBeenCalled()
  })

  it('adds only the openable missing tabs to a window that already has one of them open', async () => {
    chromeMock.tabs.query.mockResolvedValue([{ url: 'https://a.com', windowId: 42 }])
    const { result } = renderHook(() => useOpenWindow())
    await act(async () => { await result.current(win(false, ['https://a.com', 'javascript:alert(1)', 'https://b.com'])) })
    expect(chromeMock.tabs.create).toHaveBeenCalledTimes(1)
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({ windowId: 42, url: 'https://b.com' })
  })
})
