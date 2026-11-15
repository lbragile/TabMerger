import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed'
import type { GroupsState } from '@/lib/types'

/**
 * SearchOverlayWithClosed: the overlay's "Recently closed" source. Picking a closed result reopens
 * it through useReopenRecentlyClosed, tracks `recently_closed_reopened { kind, from: 'search' }`,
 * and shows a toast whose Undo goes to useUndoRecentlyClosed; a refused address is an error toast.
 */

const h = vi.hoisted(() => ({
  entries: [] as RecentlyClosedEntry[],
  settings: { rememberClosedTabs: true } as Record<string, unknown> | undefined,
  reopen: vi.fn(),
  undo: vi.fn(),
  track: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/hooks/useRecentlyClosed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useRecentlyClosed')>()
  return {
    ...actual,
    useRecentlyClosed: () => ({ entries: h.entries, days: [] }),
    useReopenRecentlyClosed: () => ({ mutateAsync: h.reopen }),
    useUndoRecentlyClosed: () => ({ mutateAsync: h.undo }),
  }
})
vi.mock('@/hooks/useAppSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useAppSettings')>()),
  useAppSettings: () => ({ data: h.settings }),
}))
vi.mock('@/lib/analytics', () => ({ trackEvent: h.track }))
vi.mock('@/lib/toast', () => ({ toast: Object.assign(vi.fn(), { success: h.success, error: h.error }) }))

import { SearchOverlayWithClosed } from '@/components/Header/SearchOverlayWithClosed'
import { RECENTLY_CLOSED_UNDO_TOAST_MS, RecentlyClosedOpenError } from '@/hooks/useRecentlyClosed'
import { useUIStore } from '@/stores/uiStore'

const groupsState: GroupsState = { active: { id: '', index: 0 }, available: [] }
const tabEntry: RecentlyClosedEntry = { id: 't', closedAt: Date.now(), kind: 'tab', tabs: [{ url: 'https://pay.test/a', title: 'Stripe invoices' }] }
const winEntry: RecentlyClosedEntry = {
  id: 'w',
  closedAt: Date.now() - 1000,
  kind: 'window',
  tabs: [{ url: 'https://mail.test', title: 'Mail' }, { url: 'https://docs.test', title: 'Stripe docs' }],
}

function setup(query: string) {
  const onClose = vi.fn()
  render(
    <SearchOverlayWithClosed
      query={query}
      onQueryChange={vi.fn()}
      groupsState={groupsState}
      onSelectGroup={vi.fn()}
      onSelectWindow={vi.fn()}
      onClose={onClose}
      inputRef={createRef<HTMLInputElement>()}
    />
  )
  return { onClose }
}

const rows = () => screen.queryAllByTestId('search-closed-result')
const rowFor = (title: string) => rows().find((r) => r.textContent?.includes(title))!

beforeEach(() => {
  vi.clearAllMocks()
  h.entries = [tabEntry, winEntry]
  h.settings = { rememberClosedTabs: true }
  h.reopen.mockResolvedValue({ kind: 'restore', entries: [tabEntry], openedTabIds: [7] })
  h.undo.mockResolvedValue({ complete: true })
  useUIStore.setState({ tourActive: false })
})

describe('SearchOverlayWithClosed', () => {
  it('reopens a tab entry, closes the overlay, tracks it and shows the Undo toast', async () => {
    const { onClose } = setup('stripe')
    fireEvent.click(rowFor('Stripe invoices'))
    expect(onClose).toHaveBeenCalled()
    await waitFor(() => expect(h.success).toHaveBeenCalled())
    expect(h.reopen).toHaveBeenCalledWith({ entry: tabEntry, tabIndex: undefined, active: true })
    expect(h.track).toHaveBeenCalledWith('recently_closed_reopened', { kind: 'tab', from: 'search' })
    const [message, opts] = h.success.mock.calls[0]
    expect(message).toBe('Reopened Stripe invoices')
    expect(opts).toMatchObject({ duration: RECENTLY_CLOSED_UNDO_TOAST_MS, action: { label: 'Undo' } })

    opts.action.onClick()
    expect(h.undo).toHaveBeenCalledWith({ kind: 'restore', entries: [tabEntry], openedTabIds: [7] })
  })

  it('analytics never carry the title or the address', async () => {
    setup('stripe')
    fireEvent.click(rowFor('Stripe invoices'))
    await waitFor(() => expect(h.track).toHaveBeenCalled())
    expect(JSON.stringify(h.track.mock.calls)).not.toMatch(/Stripe|pay\.test/)
  })

  it('reopens only the matching tab of a window entry, in the background on Ctrl/Cmd click', async () => {
    setup('stripe docs')
    fireEvent.click(rowFor('Stripe docs'), { ctrlKey: true })
    await waitFor(() => expect(h.reopen).toHaveBeenCalledWith({ entry: winEntry, tabIndex: 1, active: false }))
    await waitFor(() => expect(h.track).toHaveBeenCalledWith('recently_closed_reopened', { kind: 'tab', from: 'search' }))
  })

  it('restores a whole window picked from closed: and says so', async () => {
    setup('closed:')
    fireEvent.click(rowFor('Window · 2 tabs'))
    await waitFor(() => expect(h.success).toHaveBeenCalled())
    expect(h.reopen).toHaveBeenCalledWith({ entry: winEntry, tabIndex: undefined, active: true })
    expect(h.track).toHaveBeenCalledWith('recently_closed_reopened', { kind: 'window', from: 'search' })
    expect(h.success.mock.calls[0][0]).toBe('Restored a window with 2 tabs')
  })

  it('a refused address shows the open-failed error toast (the entry stays in the list)', async () => {
    h.reopen.mockRejectedValue(new RecentlyClosedOpenError())
    setup('stripe')
    fireEvent.click(rowFor('Stripe invoices'))
    await waitFor(() => expect(h.error).toHaveBeenCalledWith("Couldn't open this page. It stays in the list."))
    expect(h.success).not.toHaveBeenCalled()
    expect(h.track).not.toHaveBeenCalled()
  })

  it('any other failure shows the generic error toast', async () => {
    h.reopen.mockRejectedValue(new Error('idb'))
    setup('stripe')
    fireEvent.click(rowFor('Stripe invoices'))
    await waitFor(() => expect(h.error).toHaveBeenCalledWith("Couldn't change the list of closed tabs. Try again."))
  })

  it('a failed Undo shows the generic error toast', async () => {
    h.undo.mockRejectedValue(new Error('idb'))
    setup('stripe')
    fireEvent.click(rowFor('Stripe invoices'))
    await waitFor(() => expect(h.success).toHaveBeenCalled())
    h.success.mock.calls[0][1].action.onClick()
    await waitFor(() => expect(h.error).toHaveBeenCalledWith("Couldn't change the list of closed tabs. Try again."))
  })

  it('lists nothing closed while remembering is off', () => {
    h.settings = { rememberClosedTabs: false }
    setup('stripe')
    expect(rows()).toHaveLength(0)
  })

  it('lists nothing closed during the guided tour', () => {
    useUIStore.setState({ tourActive: true })
    setup('stripe')
    expect(rows()).toHaveLength(0)
  })
})
