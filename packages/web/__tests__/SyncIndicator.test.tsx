import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SyncIndicator } from '@/components/dashboard/SyncIndicator'
import { _resetExtensionIdCache } from '@/lib/extensionMessaging'

let changeHandler: ((payload: unknown) => void) | undefined
const removeChannel = vi.fn()
const select = vi.fn()

const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => select(),
          }),
        }),
      }),
    }),
    channel: () => ({
      on: (_event: string, _filter: unknown, cb: (payload: unknown) => void) => {
        changeHandler = cb
        return { subscribe: () => ({}) }
      },
    }),
    removeChannel,
  }),
}))

describe('SyncIndicator', () => {
  beforeEach(() => {
    changeHandler = undefined
    removeChannel.mockClear()
    select.mockReset()
    toastError.mockClear()
    delete window.chrome
    _resetExtensionIdCache()
  })

  afterEach(() => {
    delete window.chrome
    _resetExtensionIdCache()
  })

  it('shows "No sync yet" when there is no prior group data', async () => {
    select.mockResolvedValue({ data: [] })
    render(<SyncIndicator userId="user-1" />)
    await waitFor(() => expect(screen.getByText('No sync yet')).toBeInTheDocument())
  })

  it('shows last synced time from the initial fetch', async () => {
    select.mockResolvedValue({ data: [{ updated_at: new Date().toISOString() }] })
    render(<SyncIndicator userId="user-1" />)
    await waitFor(() => expect(screen.getByText(/Synced/)).toBeInTheDocument())
  })

  it('flips to "Syncing..." live when a realtime postgres_changes event fires', async () => {
    select.mockResolvedValue({ data: [] })
    render(<SyncIndicator userId="user-1" />)
    await waitFor(() => expect(changeHandler).toBeDefined())

    act(() => {
      changeHandler!({ new: { updated_at: new Date().toISOString() } })
    })

    expect(screen.getByText('Syncing...')).toBeInTheDocument()
  })

  it('re-fetches and updates the displayed timestamp when "Refresh sync status" is clicked', async () => {
    select.mockResolvedValueOnce({ data: [] })
    render(<SyncIndicator userId="user-1" />)
    await waitFor(() => expect(screen.getByText('No sync yet')).toBeInTheDocument())

    select.mockResolvedValueOnce({ data: [{ updated_at: new Date().toISOString() }] })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Refresh sync status' }))

    await waitFor(() => expect(screen.getByText(/Synced/)).toBeInTheDocument())
    expect(select).toHaveBeenCalledTimes(2)
  })

  it('shows a spinning refresh icon while the manual refresh is in flight', async () => {
    select.mockResolvedValueOnce({ data: [] })
    render(<SyncIndicator userId="user-1" />)
    await waitFor(() => expect(screen.getByText('No sync yet')).toBeInTheDocument())

    let resolveSelect: (value: { data: unknown[] }) => void = () => {}
    select.mockReturnValueOnce(new Promise((resolve) => (resolveSelect = resolve)))

    const button = screen.getByRole('button', { name: 'Refresh sync status' })
    const user = userEvent.setup()
    const clickPromise = user.click(button)

    await waitFor(() => expect(button).toBeDisabled())
    expect(button.querySelector('svg')).toHaveClass('animate-spin')

    resolveSelect({ data: [] })
    await clickPromise
    await waitFor(() => expect(button).not.toBeDisabled())
  })

  it('sends SYNC_NOW to the extension and re-reads Supabase only after it responds ok', async () => {
    select.mockResolvedValueOnce({ data: [] })
    render(<SyncIndicator userId="user-1" />)
    await waitFor(() => expect(screen.getByText('No sync yet')).toBeInTheDocument())

    const sendMessage = vi.fn((_id: string, _msg: unknown, cb: (r: unknown) => void) => cb({ ok: true }))
    window.chrome = { runtime: { sendMessage } }

    select.mockResolvedValueOnce({ data: [{ updated_at: new Date().toISOString() }] })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Refresh sync status' }))

    await waitFor(() => expect(screen.getByText(/Synced/)).toBeInTheDocument())
    expect(sendMessage).toHaveBeenCalledWith(expect.any(String), { type: 'SYNC_NOW' }, expect.any(Function))
    expect(toastError).not.toHaveBeenCalled()
  })

  it('falls back to a plain Supabase re-read when the extension is not installed/reachable', async () => {
    select.mockResolvedValueOnce({ data: [] })
    render(<SyncIndicator userId="user-1" />)
    await waitFor(() => expect(screen.getByText('No sync yet')).toBeInTheDocument())

    // no window.chrome at all — simulates a browser without the extension installed
    select.mockResolvedValueOnce({ data: [{ updated_at: new Date().toISOString() }] })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Refresh sync status' }))

    await waitFor(() => expect(screen.getByText(/Synced/)).toBeInTheDocument())
    expect(toastError).not.toHaveBeenCalled()
  })

  it('surfaces a "locked" reason from the extension as a toast', async () => {
    select.mockResolvedValueOnce({ data: [] })
    render(<SyncIndicator userId="user-1" />)
    await waitFor(() => expect(screen.getByText('No sync yet')).toBeInTheDocument())

    const sendMessage = vi.fn((_id: string, _msg: unknown, cb: (r: unknown) => void) =>
      cb({ ok: false, reason: 'locked' })
    )
    window.chrome = { runtime: { sendMessage } }

    select.mockResolvedValueOnce({ data: [] })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Refresh sync status' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Open the extension and unlock encryption to sync.'))
  })

  it('uses a styled Tooltip trigger instead of a native title attribute', () => {
    select.mockResolvedValue({ data: [] })
    render(<SyncIndicator userId="user-1" />)

    const button = screen.getByRole('button', { name: 'Refresh sync status' })
    expect(button).not.toHaveAttribute('title')
  })
})
