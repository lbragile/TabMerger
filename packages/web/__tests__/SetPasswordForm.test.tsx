import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockUpdateUser } = vi.hoisted(() => ({
  mockUpdateUser: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { updateUser: mockUpdateUser },
  }),
}))

const { mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: mockToastSuccess, error: mockToastError } }))

import { SetPasswordForm } from '@/components/account/SetPasswordForm'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SetPasswordForm', () => {
  it('labels the form "Set a password" when the account has no email identity', () => {
    render(<SetPasswordForm hasPassword={false} />)
    expect(screen.getByText('Set a password')).toBeInTheDocument()
  })

  it('labels the form "Change password" when the account already has one', () => {
    render(<SetPasswordForm hasPassword={true} />)
    expect(screen.getByText('Change password')).toBeInTheDocument()
  })

  it('rejects passwords under 8 characters without calling updateUser', async () => {
    render(<SetPasswordForm hasPassword={false} />)
    fireEvent.change(screen.getByLabelText(/set a password/i), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Password must be at least 8 characters.'))
    expect(mockUpdateUser).not.toHaveBeenCalled()
  })

  it('calls updateUser and shows a success toast on submit', async () => {
    mockUpdateUser.mockResolvedValue({ error: null })
    render(<SetPasswordForm hasPassword={false} />)
    fireEvent.change(screen.getByLabelText(/set a password/i), { target: { value: 'NewPassw0rd' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'NewPassw0rd' }))
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled())
  })

  it('shows a spinner on the Save button while saving', async () => {
    let resolveUpdate!: (v: { error: null }) => void
    mockUpdateUser.mockReturnValueOnce(new Promise((resolve) => { resolveUpdate = resolve }))
    render(<SetPasswordForm hasPassword={false} />)
    fireEvent.change(screen.getByLabelText(/set a password/i), { target: { value: 'NewPassw0rd' } })
    const button = screen.getByRole('button', { name: /save/i })
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    expect(button.querySelector('svg')).toBeInTheDocument()
    resolveUpdate({ error: null })
  })

  it('shows a toast error when Supabase returns an error', async () => {
    mockUpdateUser.mockResolvedValue({ error: { message: 'Password too weak' } })
    render(<SetPasswordForm hasPassword={false} />)
    fireEvent.change(screen.getByLabelText(/set a password/i), { target: { value: 'NewPassw0rd' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Password too weak'))
  })

  it('fires a set_password_completed GA event on success', async () => {
    mockUpdateUser.mockResolvedValue({ error: null })
    window.gtag = vi.fn()
    render(<SetPasswordForm hasPassword={false} />)
    fireEvent.change(screen.getByLabelText(/set a password/i), { target: { value: 'NewPassw0rd' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(window.gtag).toHaveBeenCalledWith('event', 'set_password_completed', undefined))
    delete (window as { gtag?: unknown }).gtag
  })

  it('does not fire or crash when gtag is absent', async () => {
    mockUpdateUser.mockResolvedValue({ error: null })
    delete (window as { gtag?: unknown }).gtag
    render(<SetPasswordForm hasPassword={false} />)
    fireEvent.change(screen.getByLabelText(/set a password/i), { target: { value: 'NewPassw0rd' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled())
  })
})
