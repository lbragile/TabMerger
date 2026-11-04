import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { getGroupsState, saveGroupsState } from '@/lib/localDb'
import { createGroup, createNowOpenGroup, createWindow, createTab } from '@/lib/utils'
import { forgetHistoryCursor } from '@/lib/undoHistory'
import { useGroups, useToggleWindowStarred } from '@/hooks/useGroups'
import { useDescribeAction } from '@/hooks/useDescribeGroupAction'
import { useNameAction } from '@/hooks/useNameGroupAction'
import { useUndoRedo } from '@/hooks/useUndoRedo'
import { useUIStore } from '@/stores/uiStore'
import { ModalRoot } from '@/components/Modal'
import { windowSubject } from '@/lib/aiTarget'
import { toast } from '@/lib/toast'
import type { Group, Window } from '@/lib/types'
import { clearDb } from './dbTestUtils'

/**
 * The window AI actions ("Describe with AI", "AI rename" in a window's ⋯ menu) against REAL
 * IndexedDB (fake-indexeddb, the real localDb write queue, the real undo history and the real modal
 * root): the window's note and name are each ONE write that is one undo step, marks the group for
 * sync and leaves the group's own note and name alone; Undo takes it back. A window that moved while
 * the request ran is still the one written.
 */

const h = vi.hoisted(() => ({ describe: vi.fn(), nameGroup: vi.fn() }))
vi.mock('@/hooks/useAI', () => ({
  useDescribeGroup: () => ({ mutateAsync: h.describe, isPending: false }),
  useNameGroup: () => ({ mutateAsync: h.nameGroup, isPending: false }),
}))
vi.mock('@/lib/toast', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

const savedTab = (title: string) => ({ ...createTab(title, `https://${title.toLowerCase()}.example.com`), savedAt: 1 })

function research(readingNote?: string): Group {
  const first: Window = { ...createWindow([savedTab('Mail')], 'Inbox'), id: 0 }
  const reading: Window = { ...createWindow([savedTab('Docs'), savedTab('Specs')], 'Reading'), id: 0, ...(readingNote ? { note: readingNote } : {}) }
  return { ...createGroup('research', 'Research'), note: 'Group note', windows: [first, reading], updatedAt: 1000, pendingSync: false }
}

async function seed(group: Group) {
  const nowOpen = createNowOpenGroup()
  await saveGroupsState({ active: { id: nowOpen.id, index: 0 }, available: [nowOpen, group] })
}

type Api = {
  describe: ReturnType<typeof useDescribeAction>
  name: ReturnType<typeof useNameAction>
  history: ReturnType<typeof useUndoRedo>
  star: ReturnType<typeof useToggleWindowStarred>
  group: Group | undefined
  ready: boolean
}

/** Mounts the window actions, the undo history and the real modal root. */
async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const api = {} as Api
  function Probe() {
    const groups = useGroups()
    api.group = groups.data?.available.find((g) => g.id === 'research')
    api.describe = useDescribeAction()
    api.name = useNameAction()
    api.history = useUndoRedo()
    api.star = useToggleWindowStarred()
    api.ready = groups.isSuccess
    return null
  }
  render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Probe), React.createElement(ModalRoot)))
  await waitFor(() => expect(api.ready).toBe(true))
  return api
}

const stored = async () => (await getGroupsState()).available.find((g) => g.id === 'research') as Group
const readingWindow = async () => (await stored()).windows.find((w) => w.name === 'Reading' || w.tabs.length === 2) as Window
const lastSuccessToast = () => vi.mocked(toast.success).mock.calls.at(-1) as [string, { action: { onClick: () => void } } | undefined]

beforeEach(async () => {
  vi.clearAllMocks()
  await clearDb()
  forgetHistoryCursor()
  useUIStore.setState({ undoStack: [], redoStack: [], tourHistory: null, activeGroupIndex: 1, modal: { type: null } })
})

describe('Describe window — real IndexedDB + undo', () => {
  it('empty window note: one write, one undo step, marked for sync, the group note untouched; the toast Undo clears it', async () => {
    await seed(research())
    h.describe.mockResolvedValue({ description: 'Reading list for the spec.' })
    const api = await mount()
    const revBefore = (await getGroupsState()).rev ?? 0

    await act(async () => { await api.describe.run(windowSubject(api.group, 1, api.group!.windows[1])) })

    expect(h.describe).toHaveBeenCalledWith({
      groupName: 'Reading',
      tabs: [expect.objectContaining({ title: 'Docs' }), expect.objectContaining({ title: 'Specs' })],
    })
    const after = await stored()
    expect(after.windows[1].note).toBe('Reading list for the spec.')
    expect(after.windows[0].note).toBeUndefined()
    expect(after.note).toBe('Group note')
    expect(after.pendingSync).toBe(true)
    expect(after.updatedAt).toBeGreaterThan(1000)
    expect(((await getGroupsState()).rev ?? 0) - revBefore).toBe(1)
    expect(useUIStore.getState().undoStack).toHaveLength(1)

    const [message, options] = lastSuccessToast()
    expect(message).toBe('Note added')
    await act(async () => { options!.action.onClick() })
    await waitFor(async () => expect((await stored()).windows[1].note).toBeUndefined())
    expect(useUIStore.getState().undoStack).toHaveLength(0)
  })

  it('a window note with text: the review opens for that window; Add below is one undoable write; Undo restores the old note', async () => {
    await seed(research('Mine'))
    h.describe.mockResolvedValue({ description: 'Reading list.' })
    const api = await mount()
    const user = userEvent.setup()

    await act(async () => { await api.describe.run(windowSubject(api.group, 1, api.group!.windows[1])) })
    await screen.findByText('This window already has a note. Replace it, or add the suggestion below it.')
    expect(screen.getByTestId('describe-group-current-note')).toHaveTextContent('Mine')

    await user.click(screen.getByRole('button', { name: 'Add below' }))
    await waitFor(async () => expect((await stored()).windows[1].note).toBe('Mine\n\nReading list.'))
    expect((await stored()).note).toBe('Group note')
    expect(useUIStore.getState().undoStack).toHaveLength(1)

    await act(async () => { await api.history.undo() })
    await waitFor(async () => expect((await stored()).windows[1].note).toBe('Mine'))
  })

  it('the window was starred (moved to the top) while the request ran: the note still lands on it', async () => {
    await seed(research())
    h.describe.mockImplementation(async () => {
      await api.star.mutateAsync({ groupIndex: 1, windowIndex: 1 })
      return { description: 'Moved but found.' }
    })
    const api = await mount()

    await act(async () => { await api.describe.run(windowSubject(api.group, 1, api.group!.windows[1])) })

    const after = await stored()
    expect(after.windows[0].name).toBe('Reading')
    expect(after.windows[0].note).toBe('Moved but found.')
    expect(after.windows[1].note).toBeUndefined()
  })
})

describe('Name window — real IndexedDB + undo', () => {
  it('picking a suggestion renames the window (not the group) in one write and one undo step; Undo restores the old name', async () => {
    await seed(research())
    h.nameGroup.mockResolvedValue({ names: ['Spec reading', 'Reading', 'Docs'] })
    const api = await mount()
    const user = userEvent.setup()
    const revBefore = (await getGroupsState()).rev ?? 0

    await act(async () => { await api.name.run(windowSubject(api.group, 1, api.group!.windows[1])) })
    expect(h.nameGroup).toHaveBeenCalledWith([expect.objectContaining({ title: 'Docs' }), expect.objectContaining({ title: 'Specs' })])
    const dialog = await screen.findByRole('dialog', { name: 'Name this window' })
    expect(dialog).toHaveTextContent('Currently: Reading')
    // The current window name is dropped from the suggestions
    expect(screen.getAllByTestId('name-group-suggestion')).toHaveLength(2)

    await user.click(screen.getByRole('radio', { name: 'Docs' }))
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const after = await stored()
    expect(after.windows[1].name).toBe('Docs')
    expect(after.name).toBe('Research')
    expect(after.pendingSync).toBe(true)
    expect(((await getGroupsState()).rev ?? 0) - revBefore).toBe(1)
    expect(useUIStore.getState().undoStack).toHaveLength(1)

    await act(async () => { await api.history.undo() })
    await waitFor(async () => expect((await readingWindow()).name).toBe('Reading'))
  })

  it('a typed name is trimmed like a manual window rename and written once', async () => {
    await seed(research())
    h.nameGroup.mockResolvedValue({ names: ['Spec reading'] })
    const api = await mount()
    const user = userEvent.setup()

    await act(async () => { await api.name.run(windowSubject(api.group, 1, api.group!.windows[1])) })
    await screen.findByRole('dialog', { name: 'Name this window' })
    await user.type(screen.getByRole('textbox', { name: 'Your own name' }), '  Weekend  {Enter}')
    await waitFor(async () => expect((await stored()).windows[1].name).toBe('Weekend'))
    expect(useUIStore.getState().undoStack).toHaveLength(1)
  })
})
