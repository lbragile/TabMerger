import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RECENTLY_CLOSED_LIMITS, RECENTLY_CLOSED_UNDO_TOAST_MS } from '@tabmerger/shared'

const h = vi.hoisted(() => ({
  entitlements: { tier: 'pro', loading: false } as Record<string, unknown>,
  entries: [] as unknown[],
  stored: new Map<string, unknown>(),
  mark: vi.fn(),
  unmark: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  track: vi.fn(),
  failSet: { on: false },
  // the switch lives in the recently-closed store's meta row
  remember: { on: true },
}))

vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => h.entitlements }))
vi.mock('@/lib/localDb', () => ({
  getSetting: async (k: string, d: unknown) => (h.stored.has(k) ? h.stored.get(k) : d),
  setSetting: async (k: string, v: unknown) => {
    if (h.failSet.on) throw new Error('disk full')
    h.stored.set(k, v)
  },
}))
vi.mock('@/lib/recentlyClosedDb', () => ({
  getRecentlyClosedEntries: async () => h.entries,
  getRememberClosedTabs: async () => h.remember.on,
  setRememberClosedTabs: async (on: boolean) => {
    if (h.failSet.on) throw new Error('disk full')
    h.remember.on = on
  },
  markRecentlyClosedCleared: async (ids: unknown, now: number, opts: { turnOff?: boolean } = {}) => {
    if (h.failSet.on) throw new Error('disk full')
    const marked = await h.mark(ids, now, opts)
    if (opts.turnOff) h.remember.on = false
    return marked
  },
  unmarkRecentlyClosedCleared: h.unmark,
  deleteRecentlyClosedEntries: vi.fn(),
  putRecentlyClosedEntries: vi.fn(),
  notifyRecentlyClosedChanged: vi.fn(),
}))
vi.mock('@/lib/toast', () => ({ toast: h.toast }))
vi.mock('@/lib/analytics', () => ({ trackEvent: (...a: unknown[]) => h.track(...a) }))

import { RecentlyClosedSettings } from '@/components/Settings/RecentlyClosedSettings'

const entry = (id: string) => ({ id, closedAt: Date.now() - 1000, kind: 'tab', tabs: [{ url: `https://${id}.test/`, title: id }] })

function renderIt(onSettingsSaved = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <RecentlyClosedSettings onSettingsSaved={onSettingsSaved} />
    </QueryClientProvider>
  )
  return { onSettingsSaved, qc }
}

const toggle = () => screen.getByRole('switch', { name: 'Remember closed tabs' })
const clearBtn = () => screen.getByRole('button', { name: 'Clear list' })

beforeEach(() => {
  vi.clearAllMocks()
  h.entitlements = { tier: 'pro', loading: false }
  h.entries = []
  h.stored.clear()
  h.failSet.on = false
  h.remember.on = true
  h.mark.mockReset().mockResolvedValue([])
  h.unmark.mockReset().mockResolvedValue(0)
  ;(globalThis as { chrome?: unknown }).chrome = {
    runtime: { sendMessage: vi.fn(), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
  }
})

describe('RecentlyClosedSettings', () => {
  it('is on by default (never toggled) with the purpose line, and names the switch by the heading', async () => {
    renderIt()
    await waitFor(() => expect(toggle()).toBeEnabled())
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('heading', { level: 3, name: 'Remember closed tabs' })).toBeInTheDocument()
    expect(screen.getByText(/Stored only on this device/)).toBeInTheDocument()
  })

  it('shows the plan retention and the list size in the summary (Pro, 3 entries)', async () => {
    h.entries = [entry('a'), entry('b'), entry('c')]
    renderIt()
    await waitFor(() =>
      expect(screen.getByTestId('recently-closed-summary')).toHaveTextContent(`Your plan keeps your last ${RECENTLY_CLOSED_LIMITS.pro.days} days · 3 in the list`)
    )
  })

  it('uses the Free retention for the free plan, and the singular for one day', async () => {
    h.entitlements = { tier: 'free', loading: false }
    renderIt()
    await waitFor(() =>
      expect(screen.getByTestId('recently-closed-summary')).toHaveTextContent(`Your plan keeps your last ${RECENTLY_CLOSED_LIMITS.free.recentDays} days · 0 in the list`)
    )
  })

  it('shows a loading line while the plan is checked', async () => {
    h.entitlements = { tier: 'free', loading: true }
    renderIt()
    expect(await screen.findByText('Checking your plan...')).toBeInTheDocument()
  })

  it('Clear list is disabled with 0 entries and enabled with some', async () => {
    const first = renderIt()
    await waitFor(() => expect(toggle()).toBeEnabled())
    expect(clearBtn()).toBeDisabled()
    first.qc.clear()
  })

  it('Clear list marks everything, tracks it, and shows an Undo toast that lasts the undo window', async () => {
    h.entries = [entry('a'), entry('b')]
    h.mark.mockResolvedValue(['a', 'b'])
    renderIt()
    await waitFor(() => expect(clearBtn()).toBeEnabled())
    fireEvent.click(clearBtn())
    await waitFor(() => expect(h.toast.success).toHaveBeenCalled())
    expect(h.mark).toHaveBeenCalledWith('all', expect.any(Number), {})
    expect(h.track).toHaveBeenCalledWith('recently_closed_cleared')
    const [message, opts] = h.toast.success.mock.calls[0]
    expect(message).toBe('Cleared 2 closed tabs and windows')
    expect(opts.duration).toBe(RECENTLY_CLOSED_UNDO_TOAST_MS)
    // the toast's Undo takes the mark off
    h.unmark.mockResolvedValue(2)
    opts.action.onClick()
    await waitFor(() => expect(h.unmark).toHaveBeenCalledWith(['a', 'b']))
    expect(h.toast.error).not.toHaveBeenCalled()
  })

  it('an Undo that comes after the delete says the entries could not be brought back', async () => {
    h.entries = [entry('a'), entry('b')]
    h.mark.mockResolvedValue(['a', 'b'])
    h.unmark.mockResolvedValue(1)
    renderIt()
    await waitFor(() => expect(clearBtn()).toBeEnabled())
    fireEvent.click(clearBtn())
    await waitFor(() => expect(h.toast.success).toHaveBeenCalled())
    h.toast.success.mock.calls[0][1].action.onClick()
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Couldn't bring them back: they were already deleted."))
  })

  it('clearing a list that turns out empty shows no toast; a failure shows the error toast', async () => {
    h.entries = [entry('a')]
    h.mark.mockResolvedValueOnce([])
    renderIt()
    await waitFor(() => expect(clearBtn()).toBeEnabled())
    fireEvent.click(clearBtn())
    await waitFor(() => expect(h.mark).toHaveBeenCalled())
    expect(h.toast.success).not.toHaveBeenCalled()
    h.mark.mockRejectedValueOnce(new Error('db'))
    fireEvent.click(clearBtn())
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Couldn't change the list of closed tabs. Try again."))
  })

  it('a failed Undo shows the error toast', async () => {
    h.entries = [entry('a')]
    h.mark.mockResolvedValue(['a'])
    h.unmark.mockRejectedValue(new Error('db'))
    renderIt()
    await waitFor(() => expect(clearBtn()).toBeEnabled())
    fireEvent.click(clearBtn())
    await waitFor(() => expect(h.toast.success).toHaveBeenCalled())
    h.toast.success.mock.calls[0][1].action.onClick()
    await waitFor(() => expect(h.toast.error).toHaveBeenCalled())
  })

  it('turning it off saves the setting, clears the list, patches the draft and offers Undo that turns it back on', async () => {
    h.entries = [entry('a'), entry('b')]
    h.mark.mockResolvedValue(['a', 'b'])
    const { onSettingsSaved } = renderIt()
    await waitFor(() => expect(toggle()).toBeEnabled())
    fireEvent.click(toggle())
    await waitFor(() => expect(onSettingsSaved).toHaveBeenCalledWith({ rememberClosedTabs: false }))
    expect(h.remember.on).toBe(false)
    expect(h.mark).toHaveBeenCalledWith('all', expect.any(Number), { turnOff: true })
    expect(h.track).toHaveBeenCalledWith('recently_closed_toggled', { on: 0 })
    const [message, opts] = h.toast.success.mock.calls[0]
    expect(message).toBe('Turned off · cleared 2 closed tabs and windows')
    expect(opts.duration).toBe(RECENTLY_CLOSED_UNDO_TOAST_MS)
    // off: the summary becomes the off line and Clear list goes away
    await waitFor(() => expect(screen.getByTestId('recently-closed-summary')).toHaveTextContent('Remembering closed tabs is off.'))
    expect(screen.queryByRole('button', { name: 'Clear list' })).toBeNull()

    h.unmark.mockResolvedValue(2)
    opts.action.onClick()
    await waitFor(() => expect(onSettingsSaved).toHaveBeenLastCalledWith({ rememberClosedTabs: true }))
    expect(h.unmark).toHaveBeenCalledWith(['a', 'b'])
    expect(h.remember.on).toBe(true)
    expect(h.toast.error).not.toHaveBeenCalled()
  })

  it('a late Undo of turning it off still turns it back on, and says the list is gone', async () => {
    h.entries = [entry('a')]
    h.mark.mockResolvedValue(['a'])
    h.unmark.mockResolvedValue(0)
    const { onSettingsSaved } = renderIt()
    await waitFor(() => expect(toggle()).toBeEnabled())
    fireEvent.click(toggle())
    await waitFor(() => expect(h.toast.success).toHaveBeenCalled())
    h.toast.success.mock.calls[0][1].action.onClick()
    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith('Remembering closed tabs is back on, but the cleared list was already deleted.')
    )
    expect(h.remember.on).toBe(true)
    expect(onSettingsSaved).toHaveBeenLastCalledWith({ rememberClosedTabs: true })
  })

  it('turning it off with an empty list uses the plain message', async () => {
    renderIt()
    await waitFor(() => expect(toggle()).toBeEnabled())
    fireEvent.click(toggle())
    await waitFor(() => expect(h.toast.success).toHaveBeenCalled())
    expect(h.toast.success.mock.calls[0][0]).toBe('Stopped remembering closed tabs')
  })

  it('turning it on again saves it, tracks it and shows no toast', async () => {
    h.remember.on = false
    const { onSettingsSaved } = renderIt()
    await waitFor(() => expect(toggle()).toBeEnabled())
    expect(toggle()).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle())
    await waitFor(() => expect(onSettingsSaved).toHaveBeenCalledWith({ rememberClosedTabs: true }))
    expect(h.track).toHaveBeenCalledWith('recently_closed_toggled', { on: 1 })
    expect(h.toast.success).not.toHaveBeenCalled()
  })

  it('a failed save shows the error toast and does not patch the draft', async () => {
    h.failSet.on = true
    const { onSettingsSaved } = renderIt()
    await waitFor(() => expect(toggle()).toBeEnabled())
    fireEvent.click(toggle())
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Couldn't change the list of closed tabs. Try again."))
    expect(onSettingsSaved).not.toHaveBeenCalled()
  })
})
