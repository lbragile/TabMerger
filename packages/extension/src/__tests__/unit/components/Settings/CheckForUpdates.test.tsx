import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * Settings → "Check for updates": one toast per result (update_available / no_update / throttled /
 * unsupported dev build / error), the button busy while checking.
 */

const { mockCheckForUpdate, mockToast } = vi.hoisted(() => ({
  mockCheckForUpdate: vi.fn(),
  mockToast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/extensionUpdate', () => ({ checkForUpdate: mockCheckForUpdate }))
vi.mock('@/lib/toast', () => ({ toast: mockToast }))

import { CheckForUpdates } from '@/components/Settings/CheckForUpdates'

beforeEach(() => {
  vi.clearAllMocks()
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
