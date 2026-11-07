import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AUTO_SAVE_MESSAGE } from '@tabmerger/shared'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Group, GroupsState } from '@/lib/types'
import { AutoSavedSection } from '@/components/SidePanel/AutoSavedSection'
import { AutoSaveBanner } from '@/components/Windows/AutoSaveBanner'
import { emitAutoSavePromoted } from '@/lib/autoSaveGroups'
import { AUTO_SAVE_INTRO_SHOWN_KEY } from '@/hooks/useAutoSaveToasts'
import { useUIStore } from '@/stores/uiStore'

const h = vi.hoisted(() => ({
  tier: 'pro',
  keep: vi.fn(),
  keepPending: false,
  del: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  undoEntry: vi.fn(),
}))

vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ tier: h.tier }) }))
vi.mock('@/hooks/useGroups', () => ({
  GROUPS_QUERY_KEY: ['groups'],
  useKeepAutoSave: () => ({ mutateAsync: h.keep, isPending: h.keepPending }),
  useDeleteGroup: () => ({ mutate: h.del }),
}))
vi.mock('@/hooks/useUndoRedo', () => ({ undoHistoryEntry: (...a: unknown[]) => h.undoEntry(...a) }))
vi.mock('@/lib/toast', () => ({ toast: h.toast }))

const tab = (url: string) => ({ id: 0, title: url, url })
const g = (id: string, extra: Partial<Group> = {}): Group => ({
  id, name: `Name ${id}`, color: 'rgba(1, 2, 3, 1)', updatedAt: 1,
  windows: [{ id: 1, tabs: [tab(`https://${id}.test/`), tab(`https://${id}2.test/`)], incognito: false, focused: false }],
  ...extra,
})
const nowOpen = g('now', { permanent: true })
const st = (...groups: Group[]): GroupsState => ({ active: { id: 'now', index: 0 }, available: [nowOpen, ...groups] })

let sendMessage: ReturnType<typeof vi.fn>
let localStore: Record<string, unknown>

function renderSection(state: GroupsState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <AutoSavedSection groupsState={state} />
      </TooltipProvider>
    </QueryClientProvider>
  )
  return { ...utils, qc }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.tier = 'pro'
  h.keep.mockResolvedValue(undefined)
  h.keepPending = false
  localStore = {}
  sendMessage = vi.fn()
  useUIStore.setState({ activeGroupIndex: 0, selectionMode: false, undoStack: [] })
  ;(globalThis as { chrome?: unknown }).chrome = {
    runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
    storage: {
      local: {
        get: vi.fn(async (k: string) => (k in localStore ? { [k]: localStore[k] } : {})),
        set: vi.fn(async (o: Record<string, unknown>) => void Object.assign(localStore, o)),
      },
    },
  }
})

describe('AutoSavedSection', () => {
  it('empty: header with 0, collapsed, still offers "Auto-save now"', () => {
    renderSection(st(g('normal')))
    expect(screen.getByRole('button', { name: 'Auto-saved (0)' })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Auto-saved (0)' }))
    expect(screen.getByText('No auto-saves yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Auto-save now' })).toBeInTheDocument()
  })

  it('Pro: lists auto-saves newest first, open by default, never the normal groups', () => {
    renderSection(st(g('normal'), g('old', { autoSave: { at: 1000, rolling: false } }), g('new', { autoSave: { at: 2000, rolling: false } })))
    expect(screen.getByRole('button', { name: 'Auto-saved (2)' })).toHaveAttribute('aria-expanded', 'true')
    const opens = screen.getAllByRole('button', { name: /^Open Name/ }).map((b) => b.getAttribute('aria-label'))
    expect(opens).toEqual(['Open Name new', 'Open Name old'])
    expect(screen.queryByText('Name normal')).toBeNull()
    expect(screen.queryByText('Replaced at the next auto-save')).toBeNull()
  })

  it('Free: "n of 2", and the oldest of two rolling ones says it goes next', () => {
    h.tier = 'free'
    renderSection(st(g('r1', { autoSave: { at: 1000, rolling: true } }), g('r2', { autoSave: { at: 2000, rolling: true } })))
    expect(screen.getByRole('button', { name: 'Auto-saved (2 of 2)' })).toBeInTheDocument()
    expect(screen.getAllByText('Replaced at the next auto-save')).toHaveLength(1)
  })

  it('Free with a kept-on-Pro auto-save shows a plain count', () => {
    h.tier = 'free'
    renderSection(st(g('r1', { autoSave: { at: 1000, rolling: true } }), g('p', { autoSave: { at: 500, rolling: false } })))
    expect(screen.getByRole('button', { name: 'Auto-saved (2)' })).toBeInTheDocument()
    expect(screen.queryByText('Replaced at the next auto-save')).toBeNull()
  })

  it('a row opens the group in the main panel (not in selection mode); Delete deletes by its real index', () => {
    renderSection(st(g('normal'), g('a', { autoSave: { at: 1, rolling: false } })))
    fireEvent.click(screen.getByRole('button', { name: 'Open Name a' }))
    expect(useUIStore.getState().activeGroupIndex).toBe(2)
    expect(screen.getByRole('button', { name: 'Open Name a' })).toHaveAttribute('aria-current', 'true')
    act(() => useUIStore.setState({ activeGroupIndex: 0, selectionMode: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Name a' }))
    expect(useUIStore.getState().activeGroupIndex).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Name a' }))
    expect(h.del).toHaveBeenCalledWith(2, expect.objectContaining({ onSuccess: expect.any(Function) }))
    // the row is gone and focus moved on, so the delete is announced
    h.del.mock.calls[0][1].onSuccess()
    expect(h.toast.success).toHaveBeenCalledWith('Deleted Name a', { id: 'auto-save-deleted' })
  })

  it('Keep keeps it by id and offers Undo for that step only', async () => {
    const entry = { active: { id: 'now', index: 0 }, available: [] }
    h.keep.mockImplementation(async () => useUIStore.setState({ undoStack: [entry] }))
    renderSection(st(g('a', { autoSave: { at: 1, rolling: true } })))
    fireEvent.click(screen.getByRole('button', { name: 'Keep Name a as a group' }))
    await waitFor(() => expect(h.toast.success).toHaveBeenCalled())
    expect(h.keep).toHaveBeenCalledWith('a')
    const [message, opts] = h.toast.success.mock.calls[0]
    expect(message).toBe("Moved to your groups. It won't be removed automatically.")
    opts.action.onClick()
    expect(h.undoEntry).toHaveBeenCalledWith(expect.anything(), entry)
    useUIStore.setState({ undoStack: [{ ...entry }] })
    opts.action.onClick()
    expect(h.undoEntry).toHaveBeenCalledTimes(1)
  })

  it('a failed Keep says so', async () => {
    h.keep.mockRejectedValue(new Error('x'))
    renderSection(st(g('a', { autoSave: { at: 1, rolling: true } })))
    fireEvent.click(screen.getByRole('button', { name: 'Keep Name a as a group' }))
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Could not keep the group. Try again.'))
  })

  it('"Auto-save now" from the header asks the worker', async () => {
    sendMessage.mockResolvedValue({ status: 'skipped', at: 1, reason: 'nothing-new' })
    renderSection(st())
    fireEvent.click(screen.getByRole('button', { name: 'Auto-save now' }))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: AUTO_SAVE_MESSAGE.RUN_NOW }))
    await waitFor(() => expect(h.toast.info).toHaveBeenCalled())
  })

  it('shows the one-time intro toast once an auto-save exists, and never again', async () => {
    const { unmount } = renderSection(st(g('a', { autoSave: { at: 1, rolling: false } })))
    await waitFor(() => expect(h.toast.info).toHaveBeenCalledWith('Auto-save is on. Change it in Settings → Data', { id: 'auto-save-intro' }))
    expect(localStore[AUTO_SAVE_INTRO_SHOWN_KEY]).toBe(true)
    unmount()
    h.toast.info.mockClear()
    renderSection(st(g('a', { autoSave: { at: 1, rolling: false } })))
    await act(async () => {})
    expect(h.toast.info).not.toHaveBeenCalled()
  })

  it('an edit that kept an auto-save elsewhere shows the "moved" toast', async () => {
    vi.useFakeTimers()
    try {
      renderSection(st())
      act(() => emitAutoSavePromoted([g('a')]))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(h.toast.success).toHaveBeenCalledWith("Moved to your groups. It won't be removed automatically.", { id: 'auto-save-kept' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('AutoSavedSection — focus and announcements', () => {
  const wrap = (state: GroupsState) => (
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <AutoSavedSection groupsState={state} />
      </TooltipProvider>
    </QueryClientProvider>
  )

  it('after Delete: announces it and focuses the next row; the toggle when none is left', async () => {
    h.del.mockImplementation((_i: number, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.())
    const a = g('a', { autoSave: { at: 2, rolling: false } })
    const b = g('b', { autoSave: { at: 1, rolling: false } })
    const { rerender } = render(wrap(st(a, b)))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Name a' }))
    expect(h.toast.success).toHaveBeenCalledWith('Deleted Name a', { id: 'auto-save-deleted' })
    rerender(wrap(st(b)))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open Name b' })).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'Delete Name b' }))
    rerender(wrap(st()))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Auto-saved \(/ })).toHaveFocus())
  })

  it('after Keep: focus moves to the next row; the toast with Undo stays 10 s', async () => {
    const entry = { active: { id: 'now', index: 0 }, available: [] }
    h.keep.mockImplementation(async () => useUIStore.setState({ undoStack: [entry] }))
    const a = g('a', { autoSave: { at: 2, rolling: false } })
    const b = g('b', { autoSave: { at: 1, rolling: false } })
    const { rerender } = render(wrap(st(a, b)))
    fireEvent.click(screen.getByRole('button', { name: 'Keep Name a as a group' }))
    await waitFor(() => expect(h.toast.success).toHaveBeenCalled())
    expect(h.toast.success.mock.calls[0][1]).toMatchObject({ duration: 10_000 })
    rerender(wrap(st({ ...a, autoSave: undefined }, b)))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open Name b' })).toHaveFocus())
  })

  it('a row describes its time and its counts; the badge is hidden from screen readers', () => {
    render(wrap(st(g('a', { autoSave: { at: Date.now(), rolling: false } }))))
    const open = screen.getByRole('button', { name: 'Open Name a' })
    expect(open).toHaveAccessibleDescription(/1 window, 2 tabs/)
    expect(screen.getByRole('button', { name: /^Auto-saved \(/ })).toHaveAttribute('aria-controls')
  })
})

describe('AutoSaveBanner', () => {
  const renderBanner = (group: Group) => {
    const qc = new QueryClient()
    render(
      <QueryClientProvider client={qc}>
        <AutoSaveBanner group={group} />
      </QueryClientProvider>
    )
  }

  it('Pro / kept copy', () => {
    renderBanner(g('a', { autoSave: { at: 1, rolling: false } }))
    expect(screen.getByRole('note')).toHaveTextContent('Saved automatically. Kept until you delete it.')
  })

  it('Free rolling copy explains the newest-2 rule; Keep keeps it', async () => {
    renderBanner(g('a', { autoSave: { at: 1, rolling: true } }))
    expect(screen.getByRole('note')).toHaveTextContent(/newest 2 auto-saves/)
    fireEvent.click(screen.getByRole('button', { name: 'Keep as group' }))
    await waitFor(() => expect(h.keep).toHaveBeenCalledWith('a'))
    await waitFor(() => expect(h.toast.success).toHaveBeenCalled())
  })

  it('ignores clicks while a keep is pending; a failure toasts', async () => {
    h.keepPending = true
    renderBanner(g('a', { autoSave: { at: 1, rolling: true } }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep as group' }))
    expect(h.keep).not.toHaveBeenCalled()
  })

  it('a failed keep toasts', async () => {
    h.keep.mockRejectedValue(new Error('x'))
    renderBanner(g('a', { autoSave: { at: 1, rolling: true } }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep as group' }))
    await waitFor(() => expect(h.toast.error).toHaveBeenCalled())
  })
})
