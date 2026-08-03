import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { AuthModal } from '@/components/Modal/Auth'

const {
  mockSignIn,
  mockSignUp,
  mockResetPassword,
  mockSignOut,
  mockUseAuth,
  mockSignInWithMagicLink,
  mockSignInWithGoogle,
  mockUpdatePassword,
} = vi.hoisted(() => ({
  mockSignIn: vi.fn(),
  mockSignUp: vi.fn(),
  mockResetPassword: vi.fn(),
  mockSignOut: vi.fn(),
  mockUseAuth: vi.fn(),
  mockSignInWithMagicLink: vi.fn(),
  mockSignInWithGoogle: vi.fn(),
  mockUpdatePassword: vi.fn(),
}))

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function renderModal(onClose = vi.fn()) {
  render(<Dialog open><DialogContent><AuthModal onClose={onClose} /></DialogContent></Dialog>)
  return { onClose }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseAuth.mockReturnValue({
    user: null,
    signIn: mockSignIn,
    signUp: mockSignUp,
    resetPassword: mockResetPassword,
    signInWithMagicLink: mockSignInWithMagicLink,
    signInWithGoogle: mockSignInWithGoogle,
    updatePassword: mockUpdatePassword,
    signOut: mockSignOut,
  })
})

describe('AuthModal — signed out', () => {
  it('renders Sign In / Sign Up tabs', () => {
    renderModal()
    expect(screen.getByRole('tab', { name: /sign in/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /sign up/i })).toBeTruthy()
  })

  it('submits sign-in and closes on success', async () => {
    mockSignIn.mockResolvedValue(undefined)
    const { onClose } = renderModal()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith('user@example.com', 'password123'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('shows a toast error and stays open when sign-in fails', async () => {
    mockSignIn.mockRejectedValue(new Error('Invalid credentials'))
    const { onClose } = renderModal()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrongpass' } })
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(mockSignIn).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('navigates to forgot-password and back', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }))
    expect(screen.getByText('Reset Password')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /back to sign in/i }))
    expect(screen.getByText('Sign In to TabMerger')).toBeTruthy()
  })

  it('submits password reset', async () => {
    mockResetPassword.mockResolvedValue(undefined)
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'reset@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send reset email/i }))
    await waitFor(() => expect(mockResetPassword).toHaveBeenCalledWith('reset@example.com'))
  })

  it('sign-up requires a strong password before enabling submit', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByRole('tab', { name: /sign up/i }))
    const passwordInput = screen.getByLabelText('Password')
    await user.type(passwordInput, 'weak')
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled()
    await user.clear(passwordInput)
    await user.type(passwordInput, 'StrongPass1')
    expect(screen.getByRole('button', { name: /create account/i })).not.toBeDisabled()
  })

  it('shows "Check your email" confirmation after successful sign-up', async () => {
    mockSignUp.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByRole('tab', { name: /sign up/i }))
    await user.type(screen.getByLabelText('Email'), 'new@example.com')
    await user.type(screen.getByLabelText('Password'), 'StrongPass1')
    await user.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() => expect(screen.getByText('Check your email')).toBeTruthy())
  })

  it('sends a magic link from the Magic Link tab', async () => {
    mockSignInWithMagicLink.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByRole('tab', { name: /magic link/i }))
    await user.type(screen.getByLabelText('Email'), 'magic@example.com')
    await user.click(screen.getByRole('button', { name: /send magic link/i }))
    await waitFor(() => expect(mockSignInWithMagicLink).toHaveBeenCalledWith('magic@example.com'))
    await waitFor(() => expect(screen.getByText('Check your email')).toBeTruthy())
  })

  it('signs in with Google and closes on success', async () => {
    mockSignInWithGoogle.mockResolvedValue(undefined)
    const { onClose } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    await waitFor(() => expect(mockSignInWithGoogle).toHaveBeenCalled())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('shows a toast error when Google sign-in fails', async () => {
    mockSignInWithGoogle.mockRejectedValue(new Error('cancelled'))
    const { onClose } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    await waitFor(() => expect(mockSignInWithGoogle).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('AuthModal — signed in', () => {
  it('shows account info and signs out', async () => {
    mockUseAuth.mockReturnValue({
      user: { email: 'user@example.com' },
      signIn: mockSignIn, signUp: mockSignUp, resetPassword: mockResetPassword, signOut: mockSignOut,
    })
    mockSignOut.mockResolvedValue(undefined)
    const { onClose } = renderModal()
    expect(screen.getByText('Account')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('labels the form "Set a password" and explains why for an OAuth-only account', () => {
    mockUseAuth.mockReturnValue({
      user: { email: 'user@example.com', identities: [{ provider: 'google' }] },
      signIn: mockSignIn, signUp: mockSignUp, resetPassword: mockResetPassword,
      updatePassword: mockUpdatePassword, signOut: mockSignOut,
    })
    renderModal()
    expect(screen.getByText('Set a password')).toBeTruthy()
    expect(screen.getByText(/created via Google\/magic link/i)).toBeTruthy()
  })

  it('labels the form "Change password" for an account that already has one', () => {
    mockUseAuth.mockReturnValue({
      user: { email: 'user@example.com', identities: [{ provider: 'email' }] },
      signIn: mockSignIn, signUp: mockSignUp, resetPassword: mockResetPassword,
      updatePassword: mockUpdatePassword, signOut: mockSignOut,
    })
    renderModal()
    expect(screen.getByText('Change password')).toBeTruthy()
    expect(screen.queryByText(/created via Google\/magic link/i)).toBeFalsy()
  })

  it('calls updatePassword with the entered value on submit', async () => {
    mockUseAuth.mockReturnValue({
      user: { email: 'user@example.com', identities: [{ provider: 'google' }] },
      signIn: mockSignIn, signUp: mockSignUp, resetPassword: mockResetPassword,
      updatePassword: mockUpdatePassword, signOut: mockSignOut,
    })
    mockUpdatePassword.mockResolvedValue(undefined)
    renderModal()
    fireEvent.change(screen.getByLabelText(/set a password/i), { target: { value: 'NewPassw0rd' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(mockUpdatePassword).toHaveBeenCalledWith('NewPassw0rd'))
  })
})
