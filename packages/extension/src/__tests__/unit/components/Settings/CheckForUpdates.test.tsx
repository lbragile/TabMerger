import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * Settings → "Check for updates": one toast per result (update_available / no_update / throttled /
 * unsupported dev build / no_api / error), the button busy while checking. A browser without
 * `runtime.requestUpdateCheck` (Firefox) gets a hint instead of the button.
 */

const { mockCheckForUpdate, mockHasUpdateCheckApi, mockToast } = vi.hoisted(() => ({
  mockCheckForUpdate: vi.fn(),
  mockHasUpdateCheckApi: vi.fn(() => true),
  mockToast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/extensionUpdate', () => ({
  checkForUpdate: mockCheckForUpdate,
  hasUpdateCheckApi: mockHasUpdateCheckApi,
}))
vi.mock('@/lib/toast', () => ({ toast: mockToast }))

import { CheckForUpdates } from '@/components/Settings/CheckForUpdates'

const FIREFOX_HINT =
  'Firefox updates add-ons automatically. To check now, open about:addons, click the gear icon, then Check for Updates.'
const GENERIC_HINT = 'Your browser updates TabMerger automatically'

beforeEach(() => {
  vi.clearAllMocks()
  mockHasUpdateCheckApi.mockReturnValue(true)
  vi.stubEnv('FIREFOX', 'false')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

async function clickCheck() {
  render(<CheckForUpdates />)
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
}

describe('CheckForUpdates', () => {
  it('update_available with a version', async () => {
    mockCheckForUpdate.mockResolvedValue({ status: 'update_available', version: '3.5.0' })
    await clickCheck()
    await waitFor(() =>
      expect(mockToast.success).toHaveBeenCalledWith('Version 3.5.0 is ready. Use Restart to update at the top of the popup.')
    )
  })

  it('update_available without a version', async () => {
    mockCheckForUpdate.mockResolvedValue({ status: 'update_available' })
    await clickCheck()
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('An update is ready. Restart the browser to apply it.'))
  })

  it('no_update', async () => {
    mockCheckForUpdate.mockResolvedValue({ status: 'no_update' })
    await clickCheck()
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('You have the latest version'))
  })

  it('throttled', async () => {
    mockCheckForUpdate.mockResolvedValue({ status: 'throttled' })
    await clickCheck()
    await waitFor(() => expect(mockToast.info).toHaveBeenCalledWith('Checked too often. Try again in a few minutes.'))
  })

  it('development / unpacked build', async () => {
    mockCheckForUpdate.mockResolvedValue({ status: 'unsupported' })
    await clickCheck()
    await waitFor(() =>
      expect(mockToast.info).toHaveBeenCalledWith('This is a development build, which the browser does not update')
    )
  })

  it('no_api from the check (API gone after render) shows the browser hint, not the dev-build toast', async () => {
    mockCheckForUpdate.mockResolvedValue({ status: 'no_api' })
    await clickCheck()
    await waitFor(() => expect(mockToast.info).toHaveBeenCalledWith(GENERIC_HINT))
    expect(mockToast.info).not.toHaveBeenCalledWith('This is a development build, which the browser does not update')
  })

  it('error result and a thrown check both show the error toast', async () => {
    mockCheckForUpdate.mockResolvedValueOnce({ status: 'error', message: 'x' })
    await clickCheck()
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Could not check for updates'))
    mockCheckForUpdate.mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledTimes(2))
  })

  it('is disabled and says Checking… while the check runs', async () => {
    let resolve!: (v: unknown) => void
    mockCheckForUpdate.mockReturnValue(new Promise((r) => (resolve = r)))
    await clickCheck()
    const busy = screen.getByRole('button', { name: 'Checking…' })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')
    resolve({ status: 'no_update' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled())
  })
})

describe('CheckForUpdates without runtime.requestUpdateCheck', () => {
  beforeEach(() => {
    mockHasUpdateCheckApi.mockReturnValue(false)
  })

  it('Firefox: shows the about:addons hint and no button, without checking', () => {
    vi.stubEnv('FIREFOX', 'true')
    render(<CheckForUpdates />)
    expect(screen.getByText('Updates')).toBeInTheDocument()
    expect(screen.getByText(FIREFOX_HINT)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('Ask the browser to look for a newer version now')).not.toBeInTheDocument()
    expect(mockCheckForUpdate).not.toHaveBeenCalled()
    expect(mockToast.info).not.toHaveBeenCalled()
  })

  it('another browser: a generic hint without about:addons', () => {
    render(<CheckForUpdates />)
    expect(screen.getByText(GENERIC_HINT)).toBeInTheDocument()
    expect(screen.queryByText(/about:addons/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('decides once on mount', () => {
    const { rerender } = render(<CheckForUpdates />)
    rerender(<CheckForUpdates />)
    expect(mockHasUpdateCheckApi).toHaveBeenCalledTimes(1)
  })
})
