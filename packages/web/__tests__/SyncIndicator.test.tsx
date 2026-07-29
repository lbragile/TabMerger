import { render, screen, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SyncIndicator } from '@/components/dashboard/SyncIndicator'

let changeHandler: ((payload: unknown) => void) | undefined
const removeChannel = vi.fn()
const select = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
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
})
