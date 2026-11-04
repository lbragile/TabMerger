import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { getGroupsState, saveGroupsState } from '@/lib/localDb'
import { createGroup, createNowOpenGroup, createWindow, createTab } from '@/lib/utils'
import { forgetHistoryCursor } from '@/lib/undoHistory'
import { useGroups, useUpdateGroupName } from '@/hooks/useGroups'
import { useDescribeGroupAction, useSaveNote } from '@/hooks/useDescribeGroupAction'
import { useUIStore } from '@/stores/uiStore'
import { toast } from '@/lib/toast'
import type { Group } from '@/lib/types'
import { clearDb } from './dbTestUtils'

/**
 * "Describe group" note write against REAL IndexedDB (fake-indexeddb, the real localDb write queue
 * and the real undo history): an empty note gets the description in one write that is one undo
 * step and is marked for sync; the toast's Undo takes exactly that step back; a note with text
 * goes to the review, whose Add below is again one undoable write.
 */

const h = vi.hoisted(() => ({ describe: vi.fn() }))
vi.mock('@/hooks/useAI', () => ({ useDescribeGroup: () => ({ mutateAsync: h.describe, isPending: false }) }))
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

async function seed(note?: string) {
  const nowOpen = createNowOpenGroup()
  const research: Group = {
    ...createGroup('research', 'Research'),
    windows: [createWindow([{ ...createTab('Docs', 'https://docs.example.com'), savedAt: 1 }])],
    updatedAt: 1000,
    pendingSync: false,
    ...(note !== undefined ? { note } : {})
  }
  await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, research] })
}

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)
  const { result } = renderHook(
    () => {
      const groups = useGroups()
      return {
        groups,
        action: useDescribeGroupAction(groups.data?.available[1]),
        saveNote: useSaveNote(),
        rename: useUpdateGroupName()
      }
    },
    { wrapper }
  )
  await waitFor(() => expect(result.current.groups.isSuccess).toBe(true))
  return result
}

const research = async () => (await getGroupsState()).available.find((g) => g.id === 'research') as Group
const lastSuccessToast = () => vi.mocked(toast.success).mock.calls.at(-1) as [string, { action: { label: string; onClick: () => void } } | undefined]

beforeEach(async () => {
  vi.clearAllMocks()
  await clearDb()
  forgetHistoryCursor()
  useUIStore.setState({ undoStack: [], redoStack: [], tourHistory: null, activeGroupIndex: 1, modal: { type: null } })
})

describe('Describe group note — real IndexedDB + undo', () => {
  it('empty note: one write, one undo step, marked for sync; the toast Undo restores the empty note', async () => {
    await seed()
    h.describe.mockResolvedValue({ description: 'Documentation pages.' })
    const result = await mount()
    const revBefore = (await getGroupsState()).rev ?? 0

    await act(async () => { await result.current.action.run() })

    expect(h.describe).toHaveBeenCalledWith({ groupName: 'Research', tabs: [expect.objectContaining({ title: 'Docs', url: 'https://docs.example.com' })] })
    const stored = await research()
    expect(stored.note).toBe('Documentation pages.')
    expect(stored.pendingSync).toBe(true)
    expect(stored.updatedAt).toBeGreaterThan(1000)
    expect(((await getGroupsState()).rev ?? 0) - revBefore).toBe(1)
    expect(useUIStore.getState().undoStack).toHaveLength(1)

    const [message, options] = lastSuccessToast()
    expect(message).toBe('Note added')
    await act(async () => { options!.action.onClick() })
    await waitFor(async () => expect((await research()).note ?? '').toBe(''))
    expect(useUIStore.getState().undoStack).toHaveLength(0)
    expect(useUIStore.getState().redoStack).toHaveLength(1)
  })

  it('the toast Undo never takes back a later change', async () => {
    await seed()
    h.describe.mockResolvedValue({ description: 'Documentation pages.' })
    const result = await mount()
    await act(async () => { await result.current.action.run() })
    const [, options] = lastSuccessToast()

    await act(async () => { await result.current.rename.mutateAsync({ groupIndex: 1, name: 'Docs' }) })
    await act(async () => { options!.action.onClick() })

    const stored = await research()
    expect(stored.name).toBe('Docs')
    expect(stored.note).toBe('Documentation pages.')
    expect(toast.info).toHaveBeenCalledWith('Other changes came after this one. Use Undo at the top instead.')
  })

  it('a note with text opens the review; "Add below" is one undoable write keeping the old note above', async () => {
    await seed('Mine')
    h.describe.mockResolvedValue({ description: 'Documentation pages.' })
    const result = await mount()
    await act(async () => { await result.current.action.run() })

    expect(useUIStore.getState().modal).toEqual({ type: 'describeGroupReview', data: { groupId: 'research', description: 'Documentation pages.' } })
    expect((await research()).note).toBe('Mine')

    // What the review's "Add below" does
    await act(async () => { await result.current.saveNote({ kind: 'group', groupId: 'research' }, 'Mine\n\nDocumentation pages.', 'Note added') })
    expect((await research()).note).toBe('Mine\n\nDocumentation pages.')
    expect(useUIStore.getState().undoStack).toHaveLength(1)

    const [, options] = lastSuccessToast()
    await act(async () => { options!.action.onClick() })
    await waitFor(async () => expect((await research()).note).toBe('Mine'))
  })
})
