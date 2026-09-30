import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSignUp, mockSignInWithOAuth, mockPush, mockRefresh } = vi.hoisted(() => ({
  mockSignUp: vi.fn(),
  mockSignInWithOAuth: vi.fn(),
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signUp: mockSignUp, signInWithOAuth: mockSignInWithOAuth },
  }),
}))

import SignUpPage from '@/app/auth/sign-up/page'

beforeEach(() => {
  vi.clearAllMocks()
  delete (window as { gtag?: unknown }).gtag
})

describe('Sign-up analytics', () => {
  it('fires sign_up_completed with method "password" after a successful signUp', async () => {
    window.gtag = vi.fn()
    mockSignUp.mockResolvedValue({ data: { user: { identities: [{}] } }, error: null })
    render(<SignUpPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() =>
      // trackEvent() tags every GA event with `environment` (see lib/analytics.ts) so
      // dev/prod share one GA4 property — added in c454269 alongside PostHog/Sentry tagging.
      expect(window.gtag).toHaveBeenCalledWith('event', 'sign_up_completed', {
        method: 'password',
        environment: 'development',
      })
    )
  })

  it('does not fire the event when signUp returns an error', async () => {
    window.gtag = vi.fn()
    mockSignUp.mockResolvedValue({ data: {}, error: { message: 'Signup failed' } })
    render(<SignUpPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(mockSignUp).toHaveBeenCalled())
    expect(window.gtag).not.toHaveBeenCalled()
  })

  it('fires sign_up_completed with method "google" on Google button click', async () => {
    window.gtag = vi.fn()
    mockSignInWithOAuth.mockResolvedValue({ data: {}, error: null })
    render(<SignUpPage />)

    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/i }))

    await waitFor(() =>
      expect(window.gtag).toHaveBeenCalledWith('event', 'sign_up_completed', {
        method: 'google',
        environment: 'development',
      })
    )
  })

  it('does not crash when gtag is absent', async () => {
    mockSignUp.mockResolvedValue({ data: { user: { identities: [{}] } }, error: null })
    render(<SignUpPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(screen.getByText('Verify your email')).toBeInTheDocument())
  })
})

describe('Sign-up outcome', () => {
  function submit() {
    render(<SignUpPage />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  }

  it('goes straight to the dashboard when Supabase signs the user in (email confirmation off)', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { identities: [{}] }, session: { access_token: 't' } },
      error: null,
    })
    submit()

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'))
    expect(mockRefresh).toHaveBeenCalled()
    expect(screen.queryByText('Verify your email')).not.toBeInTheDocument()
  })

  it('asks the user to verify their email when there is no session yet (email confirmation on)', async () => {
    mockSignUp.mockResolvedValue({ data: { user: { identities: [{}] }, session: null }, error: null })
    submit()

    await waitFor(() => expect(screen.getByText('Verify your email')).toBeInTheDocument())
    expect(mockPush).not.toHaveBeenCalled()
  })
})
