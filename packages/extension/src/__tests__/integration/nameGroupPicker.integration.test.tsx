import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { getGroupsState, saveGroupsState } from '@/lib/localDb'
import { createGroup, createNowOpenGroup, createWindow, createTab } from '@/lib/utils'
import { forgetHistoryCursor } from '@/lib/undoHistory'
import { useGroups, useReorderGroups } from '@/hooks/useGroups'
import { useNameGroupAction } from '@/hooks/useNameGroupAction'
import { useUndoRedo } from '@/hooks/useUndoRedo'
import { useUIStore } from '@/stores/uiStore'
import { ModalRoot } from '@/components/Modal'
import type { Group } from '@/lib/types'
import { clearDb } from './dbTestUtils'

/**
 * "Name group" end to end against REAL IndexedDB (fake-indexeddb, the real localDb write queue,
 * the real undo history and the real modal root): the AI reply opens the picker; the picked or
 * typed name is ONE write that is one undo step and marked for sync; Undo restores the old name.
 * The group is found by id at both ends, so a move while the request ran still renames the right
 * group.
 */

const h = vi.hoisted(() => ({ nameGroup: vi.fn() }))
vi.mock('@/hooks/useAI', () => ({ useNameGroup: () => ({ mutateAsync: h.nameGroup, isPending: false }) }))
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

const research = (): Group => ({
  ...createGroup('research', 'Google'),
  windows: [createWindow([{ ...createTab('BC votes', 'https://news.example.com/bc'), savedAt: 1 }])],
  updatedAt: 1000,
  pendingSync: false
})

async function seed(groups: Group[]) {
  const nowOpen = createNowOpenGroup()
  await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, ...groups] })
}

type Api = { action: ReturnType<typeof useNameGroupAction>; history: ReturnType<typeof useUndoRedo>; reorder: ReturnType<typeof useReorderGroups>; ready: boolean }

/** Mounts the action (on the group with id "research"), the undo history and the real modal root. */
async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const api = {} as Api
  function Probe() {
    const groups = useGroups()
    api.action = useNameGroupAction(groups.data?.available.find((g) => g.id === 'research'))
    api.history = useUndoRedo()
    api.reorder = useReorderGroups()
    api.ready = groups.isSuccess
    return null
  }
  render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(Probe), React.createElement(ModalRoot))
  )
  await waitFor(() => expect(api.ready).toBe(true))
  return api
}

const stored = async () => (await getGroupsState()).available.find((g) => g.id === 'research') as Group

beforeEach(async () => {
  vi.clearAllMocks()
  await clearDb()
  forgetHistoryCursor()
  useUIStore.setState({ undoStack: [], redoStack: [], tourHistory: null, activeGroupIndex: 1, modal: { type: null } })
})

describe('Name group picker — real IndexedDB + undo', () => {
  it('picking a suggestion is one write, one undo step, marked for sync; Undo restores the old name', async () => {
    await seed([research()])
    h.nameGroup.mockResolvedValue({ names: ['BC Election Coverage', 'Local News', 'Election Night'], name: 'BC Election Coverage' })
    const api = await mount()
    const user = userEvent.setup()
    const revBefore = (await getGroupsState()).rev ?? 0

    await act(async () => { await api.action.run() })
    const dialog = await screen.findByRole('dialog', { name: 'Name this group' })
    expect(dialog).toHaveTextContent('Currently: Google')
    // Nothing is written until the user picks
    expect((await stored()).name).toBe('Google')

    await user.click(screen.getByRole('radio', { name: 'Local News' }))
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const after = await stored()
    expect(after.name).toBe('Local News')
    expect(after.pendingSync).toBe(true)
    expect(after.updatedAt).toBeGreaterThan(1000)
    expect(((await getGroupsState()).rev ?? 0) - revBefore).toBe(1)
    expect(useUIStore.getState().undoStack).toHaveLength(1)

    await act(async () => { await api.history.undo() })
    await waitFor(async () => expect((await stored()).name).toBe('Google'))
    expect(useUIStore.getState().undoStack).toHaveLength(0)
    expect(useUIStore.getState().redoStack).toHaveLength(1)
  })

  it('a typed name (Enter in the box) is trimmed and written once', async () => {
    await seed([research()])
    h.nameGroup.mockResolvedValue({ name: 'BC Election Coverage' }) // an older server: one name
    const api = await mount()
    const user = userEvent.setup()

    await act(async () => { await api.action.run() })
    await screen.findByRole('dialog', { name: 'Name this group' })
    expect(screen.getAllByRole('radio')).toHaveLength(2) // the one suggestion + "your own"
    await user.type(screen.getByRole('textbox', { name: 'Your own name' }), '  Votes 2026  {Enter}')
    await waitFor(async () => expect((await stored()).name).toBe('Votes 2026'))
    expect(useUIStore.getState().undoStack).toHaveLength(1)
  })

  it('the group moved while the picker was open: the rename lands on it (by id), not on its old position', async () => {
    const other: Group = { ...createGroup('other', 'Other'), windows: [], updatedAt: 1000, pendingSync: false }
    await seed([research(), other])
    h.nameGroup.mockResolvedValue({ names: ['BC Election Coverage'], name: 'BC Election Coverage' })
    const api = await mount()
    const user = userEvent.setup()

    await act(async () => { await api.action.run() })
    await screen.findByRole('dialog', { name: 'Name this group' })
    // A drag puts "Other" where "research" was (index 1) while the picker is open
    await act(async () => { await api.reorder.mutateAsync({ from: 2, to: 1 }) })

    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await waitFor(async () => expect((await stored()).name).toBe('BC Election Coverage'))
    const names = (await getGroupsState()).available.map((g) => g.name)
    expect(names.slice(1)).toEqual(['Other', 'BC Election Coverage'])
  })
})
