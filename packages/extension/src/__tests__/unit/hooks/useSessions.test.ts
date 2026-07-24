import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useSessions, useSaveSession, useDeleteSession, useRestoreSession } from '@/hooks/useSessions'
import { createGroup, createWindow, createTab } from '@/lib/utils'
import type { GroupsState, Session } from '@/lib/types'

const { mockGetSessions, mockSaveSession, mockDeleteSession, mockTrackEvent } = vi.hoisted(() => ({
  mockGetSessions: vi.fn().mockResolvedValue([]),
  mockSaveSession: vi.fn().mockResolvedValue(undefined),
  mockDeleteSession: vi.fn().mockResolvedValue(undefined),
  mockTrackEvent: vi.fn(),
}))

vi.mock('@/lib/localDb', () => ({
  getSessions: mockGetSessions,
  saveSession: mockSaveSession,
  deleteSession: mockDeleteSession,
}))
vi.mock('@/lib/analytics', () => ({ trackEvent: mockTrackEvent }))

// ─── Supabase thenable builder mock — see agent-memory feedback_supabase_mock ──
const builder: Record<string, unknown> = {}
builder.upsert = vi.fn().mockReturnValue(builder)
builder.delete = vi.fn().mockReturnValue(builder)
builder.eq = vi.fn().mockReturnValue(builder)
let responses: { data: unknown; error: unknown }[] = []
let idx = 0
Object.defineProperty(builder, 'then', {
  get() {
    const r = responses[idx++] ?? { data: null, error: null }
    return (resolve: (v: unknown) => void) => Promise.resolve(r).then(resolve)
  },
  configurable: true,
  enumerable: false,
})
const mockGetSession = vi.fn()
const mockFrom = vi.fn().mockReturnValue(builder)
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: () => mockGetSession() }, from: (...args: unknown[]) => mockFrom(...args) },
}))

let groupsStateForUseGroups: GroupsState | undefined
vi.mock('@/hooks/useGroups', () => ({ useGroups: () => ({ data: groupsStateForUseGroups }) }))

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return React.createElement(QueryClientProvider, { client: qc }, children)
}

describe('useSessions query', () => {
  it('reads sessions from localDb', async () => {
    mockGetSessions.mockResolvedValue([{ id: '1', name: 'S', groups: [], createdAt: 1 }])
    const { result } = renderHook(() => useSessions(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: '1', name: 'S', groups: [], createdAt: 1 }])
  })
})

describe('useSaveSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    idx = 0
    responses = []
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const g = createGroup(undefined, 'Saved')
    g.windows = [createWindow([createTab('T1', 'https://a.com')])]
    const nowOpen = createGroup(undefined, 'Now Open')
    nowOpen.permanent = true
    groupsStateForUseGroups = { available: [nowOpen, g], active: { id: g.id, index: 1 } }
  })

  it('throws SESSION_LIMIT when free tier hits the cap and does not save locally', async () => {
    const { result } = renderHook(() => useSaveSession(), { wrapper })
    await act(async () => {
      await expect(
        result.current.mutateAsync({ name: 'My Session', sessionCount: 3, hasSessions: false })
      ).rejects.toThrow('SESSION_LIMIT')
    })
    expect(mockSaveSession).not.toHaveBeenCalled()
  })

  it('saves only non-permanent groups locally, excluding Now Open', async () => {
    const { result } = renderHook(() => useSaveSession(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ name: 'My Session', sessionCount: 0, hasSessions: false })
    })
    expect(mockSaveSession).toHaveBeenCalledTimes(1)
    const saved = mockSaveSession.mock.calls[0][0] as Session
    expect(saved.groups.length).toBe(1)
    expect(saved.groups[0].permanent).toBeFalsy()
  })

  it('unlimited sessions allowed when hasSessions entitlement is true, even over the free cap', async () => {
    const { result } = renderHook(() => useSaveSession(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ name: 'My Session', sessionCount: 99, hasSessions: true })
    })
    expect(mockSaveSession).toHaveBeenCalled()
  })

  it('best-effort syncs to Supabase when a session exists', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
    responses = [{ data: null, error: null }]
    const { result } = renderHook(() => useSaveSession(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ name: 'My Session', sessionCount: 0, hasSessions: false })
    })
    expect(mockFrom).toHaveBeenCalledWith('sessions')
    expect((builder.upsert as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
  })

  it('does not call Supabase upsert when there is no auth session', async () => {
    const { result } = renderHook(() => useSaveSession(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ name: 'My Session', sessionCount: 0, hasSessions: false })
    })
    expect((builder.upsert as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('swallows Supabase sync errors — local save still succeeds', async () => {
    mockGetSession.mockRejectedValue(new Error('network error'))
    const { result } = renderHook(() => useSaveSession(), { wrapper })
    await act(async () => {
      await expect(
        result.current.mutateAsync({ name: 'My Session', sessionCount: 0, hasSessions: false })
      ).resolves.toBeDefined()
    })
    expect(mockSaveSession).toHaveBeenCalled()
  })
})

describe('useDeleteSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    idx = 0
    responses = []
    mockGetSession.mockResolvedValue({ data: { session: null } })
  })

  it('deletes locally', async () => {
    const { result } = renderHook(() => useDeleteSession(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('sess-1')
    })
    expect(mockDeleteSession).toHaveBeenCalledWith('sess-1')
  })

  it('best-effort deletes remotely when signed in', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
    responses = [{ data: null, error: null }]
    const { result } = renderHook(() => useDeleteSession(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('sess-1')
    })
    expect(mockFrom).toHaveBeenCalledWith('sessions')
    expect((builder.delete as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
    expect((builder.eq as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('id', 'sess-1')
  })

  it('does not error when remote delete sync fails', async () => {
    mockGetSession.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useDeleteSession(), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync('sess-1')).resolves.toBeUndefined()
    })
    expect(mockDeleteSession).toHaveBeenCalled()
  })
})

describe('useRestoreSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('chrome', {
      windows: {
        getAll: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
        remove: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue({ id: 100 }),
      },
      tabs: { create: vi.fn().mockResolvedValue({}) },
    })
  })

  it('closes all existing windows and reopens session groups/windows/tabs', async () => {
    const session: Session = {
      id: 's1',
      name: 'Session',
      createdAt: Date.now(),
      groups: [
        {
          id: 'g1',
          name: 'G',
          color: 'rgba(0,0,0,1)',
          updatedAt: Date.now(),
          permanent: false,
          windows: [
            {
              id: 1,
              name: 'W',
              incognito: false,
              focused: false,
              starred: false,
              tabs: [
                { id: 1, title: 'A', url: 'https://a.com' },
                { id: 2, title: 'B', url: 'https://b.com' },
              ],
            },
          ],
        },
      ],
    }
    const { result } = renderHook(() => useRestoreSession(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync(session)
    })
    expect(chrome.windows.remove).toHaveBeenCalledTimes(2)
    expect(chrome.windows.create).toHaveBeenCalledWith({ url: 'https://a.com' })
    expect(chrome.tabs.create).toHaveBeenCalledWith({ windowId: 100, url: 'https://b.com' })
    expect(mockTrackEvent).toHaveBeenCalledWith('session_restored')
  })

  it('skips windows with no tabs', async () => {
    const session: Session = {
      id: 's1',
      name: 'Session',
      createdAt: Date.now(),
      groups: [
        {
          id: 'g1',
          name: 'G',
          color: 'rgba(0,0,0,1)',
          updatedAt: Date.now(),
          permanent: false,
          windows: [{ id: 1, name: 'W', incognito: false, focused: false, starred: false, tabs: [] }],
        },
      ],
    }
    const { result } = renderHook(() => useRestoreSession(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync(session)
    })
    expect(chrome.windows.create).not.toHaveBeenCalled()
  })
})
