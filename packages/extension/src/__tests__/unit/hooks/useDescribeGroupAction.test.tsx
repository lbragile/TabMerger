import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useDescribeGroupAction, useSaveGroupNote } from '@/hooks/useDescribeGroupAction'
import { AiRequestError, QuotaExceededError } from '@/lib/aiErrors'
import type { Group, GroupsState } from '@/lib/types'

/**
 * "Describe group" action (shared by the header's ✨ menu and the sidebar group menu): what can be
 * described, where the reply goes (empty note: written directly with an Undo toast; a note with
 * text: the review modal), and the error toasts.
 */

const h = vi.hoisted(() => ({
  describe: vi.fn(),
  describeState: { isPending: false },
  updateGroupNote: vi.fn(),
  openModal: vi.fn(),
  undoHistoryEntry: vi.fn(),
  store: { undoStack: [] as object[] },
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

vi.mock('@/hooks/useAI', () => ({ useDescribeGroup: () => ({ mutateAsync: h.describe, ...h.describeState }) }))
vi.mock('@/hooks/useGroups', () => ({ GROUPS_QUERY_KEY: ['groups'], useUpdateGroupNote: () => ({ mutateAsync: h.updateGroupNote }) }))
vi.mock('@/hooks/useUndoRedo', () => ({ undoHistoryEntry: h.undoHistoryEntry }))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: Object.assign((selector: (s: object) => unknown) => selector({ openModal: h.openModal }), { getState: () => h.store }),
}))
vi.mock('@/lib/toast', () => ({ toast: h.toast }))

globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome

const tab = (title: string) => ({ id: 0, title, url: `https://${title.toLowerCase()}.example.com` })

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: 'g1',
    name: 'Research',
    color: 'rgba(59,130,246,1)',
    updatedAt: 1,
    windows: [{ id: 1, tabs: [tab('A'), tab('B')], starred: false, incognito: false, focused: false }],
    ...overrides,
  }
}

let qc: QueryClient
function setGroups(groups: Group[]) {
  qc.setQueryData<GroupsState>(['groups'], { active: { id: groups[0]?.id ?? '', index: 0 }, available: groups })
}
const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children)

async function run(g: Group | undefined) {
  const { result } = renderHook(() => useDescribeGroupAction(g), { wrapper })
  await act(() => result.current.run())
  return result.current
}

/** The pushed undo step: `updateGroupNote` puts a new entry on top of the stack, as the real write does. */
function writePushesStep() {
  const step = { step: true }
  h.updateGroupNote.mockImplementation(async () => {
    h.store.undoStack = [step, ...h.store.undoStack]
  })
  return step
}

beforeEach(() => {
  vi.clearAllMocks()
  qc = new QueryClient()
  h.describeState.isPending = false
  h.store.undoStack = [{ older: true }]
  h.updateGroupNote.mockResolvedValue(undefined)
})

describe('useDescribeGroupAction — what can be described', () => {
  it.each([
    ['no group', undefined, 'notSaved'],
    ['Now Open (permanent)', group({ permanent: true }), 'notSaved'],
    ['a saved group without tabs', group({ windows: [] }), 'noTabs'],
    ['a saved group with tabs', group(), null],
  ] as const)('%s → block %s', (_name, g, block) => {
    const { result } = renderHook(() => useDescribeGroupAction(g), { wrapper })
    expect(result.current.block).toBe(block)
  })

  it('passes the request\'s pending state through', () => {
    h.describeState.isPending = true
    const { result } = renderHook(() => useDescribeGroupAction(group()), { wrapper })
    expect(result.current.isPending).toBe(true)
  })

  it('does nothing for Now Open or a missing group', async () => {
    await run(group({ permanent: true }))
    await run(undefined)
    expect(h.describe).not.toHaveBeenCalled()
    expect(h.toast.error).not.toHaveBeenCalled()
  })

  it('toasts instead of calling the API when the group has no tabs', async () => {
    await run(group({ windows: [] }))
    expect(h.describe).not.toHaveBeenCalled()
    expect(h.toast.error).toHaveBeenCalledWith('No tabs in this group to describe')
  })
})

describe('useDescribeGroupAction — empty note: written directly, one undo step', () => {
  it('sends the decrypted name and tabs, writes the note by the group\'s CURRENT position, and toasts "Note added" with Undo', async () => {
    const target = group()
    // Reordered while the request ran: the group is now at index 2
    setGroups([group({ id: 'now', permanent: true }), group({ id: 'x' }), target])
    h.describe.mockResolvedValue({ description: 'Docs for A and B.' })
    const step = writePushesStep()

    await run(target)

    expect(h.describe).toHaveBeenCalledWith({ groupName: 'Research', tabs: [tab('A'), tab('B')] })
    expect(h.updateGroupNote).toHaveBeenCalledWith({ groupIndex: 2, note: 'Docs for A and B.' })
    expect(h.openModal).not.toHaveBeenCalled()
    const [message, options] = h.toast.success.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }]
    expect(message).toBe('Note added')
    expect(options.action.label).toBe('Undo')

    options.action.onClick()
    expect(h.undoHistoryEntry).toHaveBeenCalledWith(qc, step)
  })

  it('a whitespace-only note counts as empty', async () => {
    const target = group({ note: '  \n ' })
    setGroups([target])
    h.describe.mockResolvedValue({ description: 'New.' })
    await run(target)
    expect(h.updateGroupNote).toHaveBeenCalledWith({ groupIndex: 0, note: 'New.' })
  })

  it('the toast\'s Undo does nothing to a later change: it says so instead', async () => {
    const target = group()
    setGroups([target])
    h.describe.mockResolvedValue({ description: 'D.' })
    writePushesStep()
    await run(target)
    const [, options] = h.toast.success.mock.calls[0] as [string, { action: { onClick: () => void } }]

    h.store.undoStack = [{ later: true }, ...h.store.undoStack]
    options.action.onClick()
    expect(h.undoHistoryEntry).not.toHaveBeenCalled()
    expect(h.toast.info).toHaveBeenCalledWith('Other changes came after this one. Use Undo at the top instead.')
  })

  it('no Undo action when the write pushed no step', async () => {
    const target = group()
    setGroups([target])
    h.describe.mockResolvedValue({ description: 'D.' })
    await run(target)
    expect(h.toast.success).toHaveBeenCalledWith('Note added', undefined)
  })

  it('the group is gone by the time the reply arrives: nothing is written', async () => {
    setGroups([group({ id: 'other' })])
    h.describe.mockResolvedValue({ description: 'D.' })
    await run(group())
    expect(h.updateGroupNote).not.toHaveBeenCalled()
    expect(h.toast.info).toHaveBeenCalledWith(expect.stringMatching(/changed/i), expect.anything())
  })
})

describe('useDescribeGroupAction — a note with text: the review modal', () => {
  it('reads the note as it is NOW (not when clicked) and opens the review with the suggestion', async () => {
    const clicked = group()
    setGroups([group({ note: 'Typed meanwhile' })])
    h.describe.mockResolvedValue({ description: 'Suggestion.' })
    await run(clicked)
    expect(h.openModal).toHaveBeenCalledWith('describeGroupReview', { groupId: 'g1', description: 'Suggestion.' })
    expect(h.updateGroupNote).not.toHaveBeenCalled()
  })
})

describe('useDescribeGroupAction — errors', () => {
  it('a reply with nothing usable is a failure toast, never a write', async () => {
    setGroups([group()])
    h.describe.mockResolvedValue({ description: null })
    await run(group())
    expect(h.toast.error).toHaveBeenCalledWith('Could not describe this group')
    expect(h.updateGroupNote).not.toHaveBeenCalled()
  })

  it('out of credits: a quota toast whose "Buy more" opens pricing', async () => {
    h.describe.mockRejectedValue(new QuotaExceededError())
    await run(group())
    const [message, options] = h.toast.error.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }]
    expect(message).toBe("You've used all your AI credits for this month.")
    expect(options.action.label).toBe('Buy more')
    options.action.onClick()
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: expect.stringMatching(/\/pricing$/) })
  })

  it('an error fixed in Settings → AI offers "Open Settings" on the AI tab', async () => {
    h.describe.mockRejectedValue(new AiRequestError('byok_key_invalid', 400, 'Key rejected'))
    await run(group())
    const [message, options] = h.toast.error.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }]
    expect(message).toBe('Key rejected')
    expect(options.action.label).toBe('Open Settings')
    options.action.onClick()
    expect(h.openModal).toHaveBeenCalledWith('settings', { tab: 'ai' })
  })

  it('any other error shows its own message, without an action', async () => {
    h.describe.mockRejectedValue(new Error('boom'))
    await run(group())
    expect(h.toast.error).toHaveBeenCalledWith('boom')
    expect(h.toast.error.mock.calls[0]).toHaveLength(1)
  })

  it('a non-Error rejection falls back to the generic message', async () => {
    h.describe.mockRejectedValue('nope')
    await run(group())
    expect(h.toast.error).toHaveBeenCalledWith('Could not describe this group')
  })
})

describe('useSaveGroupNote', () => {
  it('resolves false and writes nothing when the group is not in the list', async () => {
    setGroups([])
    const { result } = renderHook(() => useSaveGroupNote(), { wrapper })
    let ok: boolean | undefined
    await act(async () => { ok = await result.current('g1', 'x', 'Note added') })
    expect(ok).toBe(false)
    expect(h.updateGroupNote).not.toHaveBeenCalled()
  })
})
