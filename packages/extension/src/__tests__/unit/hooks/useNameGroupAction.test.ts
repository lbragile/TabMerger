import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNameGroupAction } from '@/hooks/useNameGroupAction'
import { AiRequestError, QuotaExceededError } from '@/lib/aiErrors'
import type { Group } from '@/lib/types'

/**
 * The shared "name a group with AI" action behind the sidebar menu's "AI rename" and the header
 * AI menu's "Name group": what can be named, the positional rename, the reply cleanup, and the
 * error toasts.
 */

const { mockNameGroup, nameGroupState, mockUpdateGroupName, mockOpenModal, mockToastError } = vi.hoisted(() => ({
  mockNameGroup: vi.fn(),
  nameGroupState: { isPending: false },
  mockUpdateGroupName: vi.fn(),
  mockOpenModal: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/hooks/useAI', () => ({ useNameGroup: () => ({ mutateAsync: mockNameGroup, ...nameGroupState }) }))
vi.mock('@/hooks/useGroups', () => ({ useUpdateGroupName: () => ({ mutate: mockUpdateGroupName }) }))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: object) => unknown) => selector({ openModal: mockOpenModal }),
}))
vi.mock('@/lib/toast', () => ({ toast: { error: mockToastError } }))

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

async function run(g: Group | undefined, groupIndex = 2) {
  const { result } = renderHook(() => useNameGroupAction(g, groupIndex))
  await act(() => result.current.run())
  return result.current
}

beforeEach(() => {
  vi.clearAllMocks()
  nameGroupState.isPending = false
})

describe('useNameGroupAction — what can be named', () => {
  it.each([
    ['no group', undefined, 'notSaved'],
    ['Now Open (permanent)', group({ permanent: true }), 'notSaved'],
    ['a saved group without tabs', group({ windows: [{ id: 1, tabs: [], starred: false, incognito: false, focused: false }] }), 'noTabs'],
    ['a saved group with tabs', group(), null],
  ] as const)('%s → block %s', (_name, g, block) => {
    const { result } = renderHook(() => useNameGroupAction(g, 1))
    expect(result.current.block).toBe(block)
  })

  it('passes the request\'s pending state through', () => {
    nameGroupState.isPending = true
    const { result } = renderHook(() => useNameGroupAction(group(), 1))
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

describe('useNameGroupAction — renaming', () => {
  it('sends every tab of the group and renames it by position', async () => {
    mockNameGroup.mockResolvedValue({ name: 'Letters' })
    await run(group(), 4)
    expect(mockNameGroup).toHaveBeenCalledWith([tab('A'), tab('B'), tab('C')])
    expect(mockUpdateGroupName).toHaveBeenCalledWith({ groupIndex: 4, name: 'Letters' })
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('collapses whitespace runs and trims the suggestion', async () => {
    mockNameGroup.mockResolvedValue({ name: '  Product\n\tresearch  ' })
    await run(group())
    expect(mockUpdateGroupName).toHaveBeenCalledWith({ groupIndex: 2, name: 'Product research' })
  })

  it('caps a runaway suggestion at 100 characters', async () => {
    mockNameGroup.mockResolvedValue({ name: 'x'.repeat(250) })
    await run(group())
    expect(mockUpdateGroupName).toHaveBeenCalledWith({ groupIndex: 2, name: 'x'.repeat(100) })
  })

  it.each([['blank', '   \n '], ['not a string', 42], ['missing', undefined]])('a %s suggestion is a failure, never a rename', async (_name, name) => {
    mockNameGroup.mockResolvedValue({ name })
    await run(group())
    expect(mockUpdateGroupName).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith('AI rename failed')
  })
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
    expect(mockUpdateGroupName).not.toHaveBeenCalled()
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
