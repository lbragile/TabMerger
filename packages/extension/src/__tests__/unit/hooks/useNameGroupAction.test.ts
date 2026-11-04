import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useNameAction, useNameGroupAction } from '@/hooks/useNameGroupAction'
import { windowSubject, windowTabsKey } from '@/lib/aiTarget'
import { AiRequestError, QuotaExceededError } from '@/lib/aiErrors'
import type { Group, GroupsState } from '@/lib/types'

/**
 * The shared "name a group with AI" action behind the sidebar menu's "AI rename" and the header
 * AI menu's "Name group": what can be named, the reply cleanup (`names`, and the older `name`-only
 * reply), the current-name filter, the re-lookup by id, the picker it opens, and the error toasts.
 */

const { mockNameGroup, nameGroupState, mockOpenModal, mockToastError, mockToastInfo } = vi.hoisted(() => ({
  mockNameGroup: vi.fn(),
  nameGroupState: { isPending: false },
  mockOpenModal: vi.fn(),
  mockToastError: vi.fn(),
  mockToastInfo: vi.fn(),
}))

vi.mock('@/hooks/useAI', () => ({ useNameGroup: () => ({ mutateAsync: mockNameGroup, ...nameGroupState }) }))
vi.mock('@/hooks/useGroups', () => ({ GROUPS_QUERY_KEY: ['groups'] }))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) => selector({ openModal: mockOpenModal }),
}))
vi.mock('@/lib/toast', () => ({ toast: { error: mockToastError, info: mockToastInfo } }))

globalThis.chrome = { tabs: { create: vi.fn() } } as unknown as typeof chrome

const tab = (title: string) => ({ id: 0, title, url: `https://${title.toLowerCase()}.example.com` })

function group(overrides: Partial<Group> = {}): Group {
  return {
    id: 'g1',
    name: 'Research',
    color: 'rgba(59,130,246,1)',
    updatedAt: 1,
    windows: [
      { id: 1, tabs: [tab('A')], starred: false, incognito: false, focused: false },
      { id: 2, tabs: [tab('B'), tab('C')], starred: false, incognito: false, focused: false },
    ],
    ...overrides,
  }
}

let qc: QueryClient

const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children)

/** Runs the action for `g`; `cached` are the groups in the query cache when the reply arrives (default: `g` alone). */
async function run(g: Group | undefined, cached: Group[] = g ? [g] : []) {
  qc.setQueryData<GroupsState>(['groups'], { available: cached } as unknown as GroupsState)
  const { result } = renderHook(() => useNameGroupAction(g), { wrapper })
  await act(() => result.current.run())
  return result.current
}

beforeEach(() => {
  vi.clearAllMocks()
  nameGroupState.isPending = false
  qc = new QueryClient()
})

describe('useNameGroupAction — what can be named', () => {
  it.each([
    ['no group', undefined, 'notSaved'],
    ['Now Open (permanent)', group({ permanent: true }), 'notSaved'],
    ['a saved group without tabs', group({ windows: [{ id: 1, tabs: [], starred: false, incognito: false, focused: false }] }), 'noTabs'],
    ['a saved group with tabs', group(), null],
  ] as const)('%s → block %s', (_name, g, block) => {
    const { result } = renderHook(() => useNameGroupAction(g), { wrapper })
    expect(result.current.block).toBe(block)
  })

  it('passes the request\'s pending state through', () => {
    nameGroupState.isPending = true
    const { result } = renderHook(() => useNameGroupAction(group()), { wrapper })
    expect(result.current.isPending).toBe(true)
  })

  it('does nothing for Now Open or a missing group', async () => {
    await run(group({ permanent: true }))
    await run(undefined)
    expect(mockNameGroup).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('toasts instead of calling the API when the group has no tabs', async () => {
    await run(group({ windows: [] }))
    expect(mockNameGroup).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith('No tabs in this group to name')
  })
})

describe('useNameGroupAction — suggestions', () => {
  it('sends every tab of the group and opens the picker with the suggestions, best first', async () => {
    mockNameGroup.mockResolvedValue({ names: ['Letters', 'Alphabet', 'ABC'], name: 'Letters' })
    await run(group())
    expect(mockNameGroup).toHaveBeenCalledWith([tab('A'), tab('B'), tab('C')])
    expect(mockOpenModal).toHaveBeenCalledWith('nameGroupPicker', { groupId: 'g1', suggestions: ['Letters', 'Alphabet', 'ABC'] })
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('an older server that sends only `name` still opens the picker with that one name', async () => {
    mockNameGroup.mockResolvedValue({ name: 'Letters' })
    await run(group())
    expect(mockOpenModal).toHaveBeenCalledWith('nameGroupPicker', { groupId: 'g1', suggestions: ['Letters'] })
  })

  it.each([['an empty array', []], ['not an array', 'Letters'], ['null', null]])('`names` as %s falls back to `name`', async (_label, names) => {
    mockNameGroup.mockResolvedValue({ names, name: 'Letters' })
    await run(group())
    expect(mockOpenModal).toHaveBeenCalledWith('nameGroupPicker', { groupId: 'g1', suggestions: ['Letters'] })
  })

  it('cleans every suggestion, drops unusable ones and repeats (ignoring case), and keeps at most 3', async () => {
    mockNameGroup.mockResolvedValue({
      names: ['  Product\n\tresearch  ', 42, '   ', 'product RESEARCH', 'x'.repeat(250), 'Docs', 'Fourth'],
      name: 'Product research',
    })
    await run(group())
    expect(mockOpenModal).toHaveBeenCalledWith('nameGroupPicker', { groupId: 'g1', suggestions: ['Product research', 'x'.repeat(100), 'Docs'] })
  })

  it('drops a suggestion equal to the current name (ignoring case)', async () => {
    mockNameGroup.mockResolvedValue({ names: ['research', 'Studies'], name: 'research' })
    await run(group({ name: 'Research' }))
    expect(mockOpenModal).toHaveBeenCalledWith('nameGroupPicker', { groupId: 'g1', suggestions: ['Studies'] })
  })

  it('when the current name is all that is left, toasts that it already fits and opens nothing', async () => {
    mockNameGroup.mockResolvedValue({ names: ['Research', 'RESEARCH'], name: 'Research' })
    await run(group({ name: 'Research' }))
    expect(mockOpenModal).not.toHaveBeenCalled()
    expect(mockToastInfo).toHaveBeenCalledWith('“Research” already fits this group')
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('compares against the name the group has when the reply arrives, found by id', async () => {
    // Renamed and moved while the request ran: the prop still says "Research"
    mockNameGroup.mockResolvedValue({ names: ['Research', 'Letters'], name: 'Research' })
    const other: Group = { ...group(), id: 'g0', name: 'Other' }
    await run(group(), [other, group({ name: 'Letters' })])
    expect(mockOpenModal).toHaveBeenCalledWith('nameGroupPicker', { groupId: 'g1', suggestions: ['Research'] })
  })

  it('a group deleted while the request ran: an info toast, no picker', async () => {
    mockNameGroup.mockResolvedValue({ names: ['Letters'], name: 'Letters' })
    await run(group(), [])
    expect(mockOpenModal).not.toHaveBeenCalled()
    expect(mockToastInfo).toHaveBeenCalledWith(expect.any(String), { id: 'groups-changed-elsewhere' })
  })

  it.each([['blank', { name: '   \n ' }], ['not a string', { name: 42 }], ['missing', {}], ['not an object', null]])(
    'a %s suggestion is a failure, never a picker',
    async (_label, reply) => {
      mockNameGroup.mockResolvedValue(reply)
      await run(group())
      expect(mockOpenModal).not.toHaveBeenCalled()
      expect(mockToastError).toHaveBeenCalledWith('AI rename failed')
    }
  )
})

describe('useNameGroupAction — errors', () => {
  it('out of credits: a quota toast whose "Buy more" opens pricing', async () => {
    mockNameGroup.mockRejectedValue(new QuotaExceededError())
    await run(group())
    const [message, options] = mockToastError.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }]
    expect(message).toBe("You've used all your AI credits for this month.")
    expect(options.action.label).toBe('Buy more')
    options.action.onClick()
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: expect.stringMatching(/\/pricing$/) })
    expect(mockOpenModal).not.toHaveBeenCalled()
  })

  it('an error fixed in Settings → AI offers "Open Settings" on the AI tab', async () => {
    mockNameGroup.mockRejectedValue(new AiRequestError('byok_key_invalid', 400, 'Key rejected'))
    await run(group())
    const [message, options] = mockToastError.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }]
    expect(message).toBe('Key rejected')
    expect(options.action.label).toBe('Open Settings')
    options.action.onClick()
    expect(mockOpenModal).toHaveBeenCalledWith('settings', { tab: 'ai' })
  })

  it('any other error shows its own message, without an action', async () => {
    mockNameGroup.mockRejectedValue(new Error('boom'))
    await run(group())
    expect(mockToastError).toHaveBeenCalledWith('boom')
    expect(mockToastError.mock.calls[0]).toHaveLength(1)
  })

  it('a non-Error rejection falls back to the generic message', async () => {
    mockNameGroup.mockRejectedValue('nope')
    await run(group())
    expect(mockToastError).toHaveBeenCalledWith('AI rename failed')
  })
})

describe('useNameAction — a window', () => {
  const win = (overrides: Partial<Group['windows'][number]> = {}) => ({
    id: 0, tabs: [tab('B'), tab('C')], starred: false, incognito: false, focused: false, name: 'Reading', ...overrides,
  })
  /** Runs "AI rename" for window `wi` of `g`; `cached` are the groups when the reply arrives. */
  async function runWindow(g: Group, wi: number, cached: Group[] = [g]) {
    qc.setQueryData<GroupsState>(['groups'], { available: cached } as unknown as GroupsState)
    const { result } = renderHook(() => useNameAction(), { wrapper })
    await act(() => result.current.run(windowSubject(g, wi, g.windows[wi])))
  }

  it('sends ONLY that window\'s tabs and opens the picker for that window', async () => {
    const g = group({ windows: [win({ tabs: [tab('A')] }), win()] })
    mockNameGroup.mockResolvedValue({ names: ['Letters', 'Alphabet'] })
    await runWindow(g, 1)
    expect(mockNameGroup).toHaveBeenCalledWith([tab('B'), tab('C')])
    expect(mockOpenModal).toHaveBeenCalledWith('nameGroupPicker', {
      groupId: 'g1', window: { index: 1, tabsKey: windowTabsKey(win()) }, suggestions: ['Letters', 'Alphabet'],
    })
  })

  it('drops a suggestion equal to the window\'s CURRENT name (ignoring case), not the group\'s', async () => {
    const g = group({ name: 'Letters', windows: [win()] })
    mockNameGroup.mockResolvedValue({ names: ['reading', 'Letters'] })
    await runWindow(g, 0)
    expect(mockOpenModal).toHaveBeenCalledWith('nameGroupPicker', expect.objectContaining({ suggestions: ['Letters'] }))
  })

  it('when the window\'s name is all that is left, toasts that it already fits this window', async () => {
    const g = group({ windows: [win()] })
    mockNameGroup.mockResolvedValue({ names: ['READING'] })
    await runWindow(g, 0)
    expect(mockOpenModal).not.toHaveBeenCalled()
    expect(mockToastInfo).toHaveBeenCalledWith('“Reading” already fits this window')
  })

  it('an unnamed window keeps every suggestion', async () => {
    const g = group({ windows: [win({ name: undefined })] })
    mockNameGroup.mockResolvedValue({ names: ['Window', 'Reading'] })
    await runWindow(g, 0)
    expect(mockOpenModal).toHaveBeenCalledWith('nameGroupPicker', expect.objectContaining({ suggestions: ['Window', 'Reading'] }))
  })

  it.each([
    ['deleted', () => [group({ windows: [] })]],
    ['its tabs changed', () => [group({ windows: [win({ tabs: [tab('B')] })] })]],
  ])('the window vanished mid-request (%s): "changed elsewhere", no picker', async (_name, cached) => {
    const g = group({ windows: [win()] })
    mockNameGroup.mockResolvedValue({ names: ['Letters'] })
    await runWindow(g, 0, cached())
    expect(mockOpenModal).not.toHaveBeenCalled()
    expect(mockToastInfo).toHaveBeenCalledWith(expect.stringMatching(/changed/i), { id: 'groups-changed-elsewhere' })
  })

  it('a window without tabs toasts instead of calling the API', async () => {
    await runWindow(group({ windows: [win({ tabs: [] })] }), 0)
    expect(mockNameGroup).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith('No tabs in this window to name')
  })

  it('a Now Open window does nothing', async () => {
    await runWindow(group({ permanent: true, windows: [win()] }), 0)
    expect(mockNameGroup).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })
})
