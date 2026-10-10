import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockUseEntitlements, mockFetchDeviceSessions, mockRenameDevice, mockRemoveDevices, mockGetOrCreateDeviceId } = vi.hoisted(() => ({
  mockUseEntitlements: vi.fn(),
  mockFetchDeviceSessions: vi.fn(),
  mockRenameDevice: vi.fn(),
  mockRemoveDevices: vi.fn(),
  mockGetOrCreateDeviceId: vi.fn(),
}))

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: mockUseEntitlements,
}))

vi.mock('@/lib/deviceSessions', () => ({
  fetchDeviceSessions: mockFetchDeviceSessions,
  renameDevice: mockRenameDevice,
  removeDevices: mockRemoveDevices,
  getOrCreateDeviceId: mockGetOrCreateDeviceId,
}))

const mockTabsCreate = vi.fn()
globalThis.chrome = { tabs: { create: mockTabsCreate } } as unknown as typeof chrome

function entitlements(overrides: Partial<ReturnType<typeof mockUseEntitlements>> = {}) {
  return { tier: 'free', maxGroups: 5, maxTabs: 50, loading: false, ...overrides }
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(React.createElement(QueryClientProvider, { client: qc }, ui))
}

function makeDeviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-2',
    device_id: 'd2',
    device_name: 'Chrome on Mac',
    last_active: new Date().toISOString(),
    now_open_snapshot: { windows: [{ id: 1, tabs: [{ id: 0, title: 'Example', url: 'https://example.com', favIconUrl: '' }] }] },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockTabsCreate.mockResolvedValue(undefined)
  mockGetOrCreateDeviceId.mockResolvedValue('d1')
  mockFetchDeviceSessions.mockResolvedValue([])
  mockRemoveDevices.mockResolvedValue(undefined)
})

function makeOwnDeviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    device_id: 'd1',
    device_name: 'This Laptop',
    last_active: new Date().toISOString(),
    now_open_snapshot: { windows: [] },
    ...overrides,
  }
}

describe('OtherDevices settings panel', () => {
  async function renderPanel() {
    const { OtherDevices } = await import('@/components/Settings/OtherDevices')
    return wrap(React.createElement(OtherDevices))
  }

  it('renders nothing for free tier (hidden, not disabled)', async () => {
    mockUseEntitlements.mockReturnValue(entitlements({ tier: 'free' }))
    const { container } = await renderPanel()
    expect(container.firstChild).toBeNull()
    expect(mockFetchDeviceSessions).not.toHaveBeenCalled()
  })

  it('fetches and renders devices for pro tier', async () => {
    mockUseEntitlements.mockReturnValue(entitlements({ tier: 'pro' }))
    mockFetchDeviceSessions.mockResolvedValue([makeDeviceRow()])
    await renderPanel()
    expect(await screen.findByText('Chrome on Mac')).toBeInTheDocument()
  })

  it('fetches and renders devices for pro_ai tier', async () => {
    mockUseEntitlements.mockReturnValue(entitlements({ tier: 'pro_ai' }))
    mockFetchDeviceSessions.mockResolvedValue([makeDeviceRow()])
    await renderPanel()
    expect(await screen.findByText('Chrome on Mac')).toBeInTheDocument()
  })

  it('shows an empty state when there are no devices', async () => {
    mockUseEntitlements.mockReturnValue(entitlements({ tier: 'pro' }))
    mockFetchDeviceSessions.mockResolvedValue([])
    await renderPanel()
    expect(await screen.findByText(/no devices yet/i)).toBeInTheDocument()
  })

  it('shows relative last-active time, window count, and tab count', async () => {
    mockUseEntitlements.mockReturnValue(entitlements({ tier: 'pro' }))
    mockFetchDeviceSessions.mockResolvedValue([
      makeDeviceRow({ last_active: new Date(Date.now() - 5 * 60 * 1000).toISOString() }),
    ])
    await renderPanel()
    expect(await screen.findByText(/5m ago/i)).toBeInTheDocument()
    expect(screen.getByText(/1 window/i)).toBeInTheDocument()
    expect(screen.getByText(/1 tab/i)).toBeInTheDocument()
  })

  it('shows plural window count for multi-window snapshots', async () => {
    mockUseEntitlements.mockReturnValue(entitlements({ tier: 'pro' }))
    mockFetchDeviceSessions.mockResolvedValue([
      makeDeviceRow({
        now_open_snapshot: {
          windows: [
            { id: 1, tabs: [{ id: 0, title: 'A', url: 'https://a.com' }] },
            { id: 2, tabs: [{ id: 0, title: 'B', url: 'https://b.com' }] },
          ],
        },
      }),
    ])
    await renderPanel()
    expect(await screen.findByText(/2 windows/i)).toBeInTheDocument()
    expect(screen.getByText(/2 tabs/i)).toBeInTheDocument()
  })

  it('handles malformed/missing snapshot data without crashing', async () => {
    mockUseEntitlements.mockReturnValue(entitlements({ tier: 'pro' }))
    mockFetchDeviceSessions.mockResolvedValue([makeDeviceRow({ now_open_snapshot: null })])
    await renderPanel()
    expect(await screen.findByText('Chrome on Mac')).toBeInTheDocument()
    expect(screen.getByText(/0 windows/i)).toBeInTheDocument()
    expect(screen.getByText(/0 tabs/i)).toBeInTheDocument()
  })

  it('shows a "(this device)" badge on the current device row, not on others', async () => {
    mockUseEntitlements.mockReturnValue(entitlements({ tier: 'pro' }))
    mockFetchDeviceSessions.mockResolvedValue([makeOwnDeviceRow(), makeDeviceRow()])
    await renderPanel()

    expect(await screen.findByText('This Laptop')).toBeInTheDocument()
    const badge = await screen.findByText('(this device)')
    expect(badge).toBeInTheDocument()
    expect(screen.queryAllByText('(this device)')).toHaveLength(1)
  })

  it('renaming the current device via the pencil icon calls renameDevice', async () => {
    const user = userEvent.setup()
    mockUseEntitlements.mockReturnValue(entitlements({ tier: 'pro' }))
    mockFetchDeviceSessions.mockResolvedValue([makeOwnDeviceRow()])
    await renderPanel()

    await user.click(await screen.findByLabelText(/rename this device/i))
    const renameInput = await screen.findByLabelText(/this device name/i)
    await user.clear(renameInput)
    await user.type(renameInput, 'My Laptop{Enter}')

    expect(mockRenameDevice).toHaveBeenCalledWith('My Laptop')
  })

  it('does not show a select checkbox or remove action for the current device', async () => {
    mockUseEntitlements.mockReturnValue(entitlements({ tier: 'pro' }))
    mockFetchDeviceSessions.mockResolvedValue([makeOwnDeviceRow()])
    await renderPanel()

    await screen.findByText('This Laptop')
    expect(screen.queryByLabelText('Select This Laptop')).not.toBeInTheDocument()
  })

  it('no longer renders a standalone "This device name" input outside the list', async () => {
    mockUseEntitlements.mockReturnValue(entitlements({ tier: 'pro' }))
    mockFetchDeviceSessions.mockResolvedValue([makeDeviceRow()])
    await renderPanel()

    await screen.findByText('Chrome on Mac')
    expect(screen.queryByLabelText(/this device name/i)).not.toBeInTheDocument()
  })

  it('clicking Open on a tab opens it locally via chrome.tabs.create and does not call any remote write', async () => {
    const user = userEvent.setup()
    mockUseEntitlements.mockReturnValue(entitlements({ tier: 'pro' }))
    mockFetchDeviceSessions.mockResolvedValue([makeDeviceRow()])
    await renderPanel()

    await user.click(await screen.findByText('Chrome on Mac'))
    const openButton = await screen.findByRole('button', { name: /open/i })
    await user.click(openButton)

    expect(mockTabsCreate).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com' }))
    expect(mockRenameDevice).not.toHaveBeenCalled()
  })

  it('Restore opens the openable tabs of the snapshot and leaves script URLs closed', async () => {
    const user = userEvent.setup()
    mockUseEntitlements.mockReturnValue(entitlements({ tier: 'pro' }))
    mockFetchDeviceSessions.mockResolvedValue([
      makeDeviceRow({
        now_open_snapshot: {
          windows: [
            { id: 1, tabs: [{ id: 0, title: 'A', url: 'https://a.com' }, { id: 0, title: 'S', url: 'javascript:alert(1)' }] },
            { id: 2, tabs: [{ id: 0, title: 'D', url: 'data:text/html,x' }, { id: 0, title: 'E', url: 'chrome://extensions/' }] },
          ],
        },
      }),
    ])
    await renderPanel()

    await user.click(await screen.findByText('Chrome on Mac'))
    await user.click(await screen.findByRole('button', { name: /restore 4 tabs/i }))

    expect(mockTabsCreate.mock.calls.map(([arg]) => (arg as { url: string }).url)).toEqual(['https://a.com', 'chrome://extensions/'])
  })

  it('clicking Restore opens every tab in the snapshot locally via chrome.tabs.create', async () => {
    const user = userEvent.setup()
    mockUseEntitlements.mockReturnValue(entitlements({ tier: 'pro' }))
    mockFetchDeviceSessions.mockResolvedValue([
      makeDeviceRow({
        now_open_snapshot: {
          windows: [
            { id: 1, tabs: [{ id: 0, title: 'A', url: 'https://a.com' }] },
            { id: 2, tabs: [{ id: 0, title: 'B', url: 'https://b.com' }] },
          ],
        },
      }),
    ])
    await renderPanel()

    await user.click(await screen.findByText('Chrome on Mac'))
    const restoreButton = await screen.findByRole('button', { name: /restore 2 tabs/i })
    await user.click(restoreButton)

    expect(mockTabsCreate).toHaveBeenCalledTimes(2)
    expect(mockTabsCreate).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://a.com' }))
    expect(mockTabsCreate).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://b.com' }))
    expect(mockRenameDevice).not.toHaveBeenCalled()
  })

  it('selecting a device shows a bulk remove bar, and confirming calls removeDevices with its id', async () => {
    const user = userEvent.setup()
    mockUseEntitlements.mockReturnValue(entitlements({ tier: 'pro' }))
    mockFetchDeviceSessions.mockResolvedValue([makeDeviceRow()])
    await renderPanel()

    const checkbox = await screen.findByLabelText('Select Chrome on Mac')
    await user.click(checkbox)

    expect(await screen.findByText('1 selected')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^remove$/i }))

    const confirmButtons = screen.getAllByRole('button', { name: /^remove$/i })
    await user.click(confirmButtons[confirmButtons.length - 1])

    expect(mockRemoveDevices).toHaveBeenCalledWith(['row-2'])
  })

  it('cancelling the remove confirmation does not call removeDevices', async () => {
    const user = userEvent.setup()
    mockUseEntitlements.mockReturnValue(entitlements({ tier: 'pro' }))
    mockFetchDeviceSessions.mockResolvedValue([makeDeviceRow()])
    await renderPanel()

    await user.click(await screen.findByLabelText('Select Chrome on Mac'))
    await user.click(screen.getByRole('button', { name: /^remove$/i }))
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(mockRemoveDevices).not.toHaveBeenCalled()
  })

  it('expanded row content is width-contained (min-w-0 through the flex chain, no overflow bleed)', async () => {
    const user = userEvent.setup()
    mockUseEntitlements.mockReturnValue(entitlements({ tier: 'pro' }))
    mockFetchDeviceSessions.mockResolvedValue([
      makeDeviceRow({
        now_open_snapshot: {
          windows: [
            {
              id: 1,
              tabs: [
                {
                  id: 0,
                  title: 'A very long unbroken tab title that could otherwise force the row to overflow its container boundary',
                  url: 'https://example.com/a-very-long-path-segment-that-could-overflow',
                },
              ],
            },
          ],
        },
      }),
    ])
    await renderPanel()

    await user.click(await screen.findByText('Chrome on Mac'))
    const tabRow = screen.getByText(/a very long unbroken tab title/i).closest('div')
    expect(tabRow).toHaveClass('min-w-0')
    const truncateSpan = screen.getByText(/a very long unbroken tab title/i)
    expect(truncateSpan).toHaveClass('min-w-0', 'truncate')
  })

  it('selecting the checkbox does not toggle the row expansion', async () => {
    const user = userEvent.setup()
    mockUseEntitlements.mockReturnValue(entitlements({ tier: 'pro' }))
    mockFetchDeviceSessions.mockResolvedValue([makeDeviceRow()])
    await renderPanel()

    await user.click(await screen.findByLabelText('Select Chrome on Mac'))

    expect(screen.queryByText('Example')).not.toBeInTheDocument()
  })
})
