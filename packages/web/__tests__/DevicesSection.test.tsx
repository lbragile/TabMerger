import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DevicesSection } from '@/components/account/DevicesSection'
import type { DeviceSession } from '@tabmerger/shared'

const update = vi.fn()
const del = vi.fn()
const bulkDel = vi.fn()
const toastError = vi.fn()
const toastSuccess = vi.fn()

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      update: (payload: unknown) => ({
        eq: () => ({
          eq: () => update(payload),
        }),
      }),
      delete: () => ({
        eq: () => ({
          eq: () => del(),
        }),
        in: (...args: unknown[]) => ({
          eq: () => bulkDel(...args),
        }),
      }),
    }),
  }),
}))

type DeviceRow = DeviceSession & { id: string }

function makeDevice(overrides: Partial<DeviceRow> = {}): DeviceRow {
  return {
    id: 'dev-1',
    device_id: 'device-uuid-1',
    device_name: 'Work Laptop',
    now_open_snapshot: [],
    last_active: new Date(Date.now() - 5 * 60000).toISOString(),
    ...overrides,
  }
}

describe('DevicesSection', () => {
  beforeEach(() => {
    update.mockReset().mockResolvedValue({ error: null })
    del.mockReset().mockResolvedValue({ error: null })
    bulkDel.mockReset().mockResolvedValue({ error: null })
    toastError.mockClear()
    toastSuccess.mockClear()
  })

  it('shows "No devices yet." when there are no devices', () => {
    render(<DevicesSection initialDevices={[]} userId="user-1" />)
    expect(screen.getByText('No devices yet.')).toBeInTheDocument()
  })

  it('renders each device name and a relative "Active ... ago" string', () => {
    render(<DevicesSection initialDevices={[makeDevice()]} userId="user-1" />)
    expect(screen.getByText('Work Laptop')).toBeInTheDocument()
    expect(screen.getByText(/Active 5m ago/)).toBeInTheDocument()
  })

  it('omits the windows/tabs summary when now_open_snapshot is null or empty', () => {
    render(<DevicesSection initialDevices={[makeDevice({ now_open_snapshot: null })]} userId="user-1" />)
    expect(screen.getByText('Active 5m ago')).toBeInTheDocument()
  })

  it('shows window and tab counts computed from now_open_snapshot', () => {
    const snapshot = {
      windows: [
        { tabs: [{ title: 'A' }, { title: 'B' }] },
        { tabs: [{ title: 'C' }] },
      ],
    }
    render(<DevicesSection initialDevices={[makeDevice({ now_open_snapshot: snapshot })]} userId="user-1" />)
    expect(screen.getByText(/2 windows · 3 tabs/)).toBeInTheDocument()
  })

  it('renames a device via Enter and calls the update mutation', async () => {
    render(<DevicesSection initialDevices={[makeDevice()]} userId="user-1" />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Device options' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Home PC{Enter}')

    await waitFor(() => expect(update).toHaveBeenCalledWith({ device_name: 'Home PC' }))
    expect(screen.getByText('Home PC')).toBeInTheDocument()
  })

  it('rolls back the rename and shows a toast on update failure', async () => {
    update.mockResolvedValue({ error: { message: 'fail' } })
    render(<DevicesSection initialDevices={[makeDevice()]} userId="user-1" />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Device options' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Home PC{Enter}')

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(screen.getByText('Work Laptop')).toBeInTheDocument()
  })

  it('removes a device after confirming the delete dialog', async () => {
    render(<DevicesSection initialDevices={[makeDevice()]} userId="user-1" />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Device options' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    const dialog = await screen.findByRole('dialog')
    expect(screen.getByText('Remove device?')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(del).toHaveBeenCalled())
    expect(screen.queryByText('Work Laptop')).not.toBeInTheDocument()
    expect(screen.getByText('No devices yet.')).toBeInTheDocument()
  })

  it('cancels out of the delete dialog and leaves the row untouched', async () => {
    render(<DevicesSection initialDevices={[makeDevice()]} userId="user-1" />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Device options' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(del).not.toHaveBeenCalled()
    expect(screen.getByText('Work Laptop')).toBeInTheDocument()
  })

  it('shows the bulk action bar when a row is selected', async () => {
    render(<DevicesSection initialDevices={[makeDevice(), makeDevice({ id: 'dev-2', device_name: 'Home PC' })]} userId="user-1" />)
    const user = userEvent.setup()

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Select Work Laptop' }))

    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove 1 device' })).toBeInTheDocument()
  })

  it('bulk removes selected devices after confirming', async () => {
    const devices = [makeDevice(), makeDevice({ id: 'dev-2', device_name: 'Home PC' })]
    render(<DevicesSection initialDevices={devices} userId="user-1" />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: 'Select Work Laptop' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Home PC' }))
    await user.click(screen.getByRole('button', { name: 'Remove 2 devices' }))

    const dialog = await screen.findByRole('dialog')
    expect(screen.getByText('Remove 2 devices?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(bulkDel).toHaveBeenCalledWith('id', ['dev-1', 'dev-2']))
    expect(screen.getByText('No devices yet.')).toBeInTheDocument()
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument()
  })

  it('clears selection and hides the bulk bar when the row is unchecked', async () => {
    render(<DevicesSection initialDevices={[makeDevice()]} userId="user-1" />)
    const user = userEvent.setup()

    const checkbox = screen.getByRole('checkbox', { name: 'Select Work Laptop' })
    await user.click(checkbox)
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    await user.click(checkbox)
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument()
  })
})
