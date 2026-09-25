import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: vi.fn(),
      signInWithOAuth: vi.fn(),
      signInWithOtp: vi.fn(),
      signUp: vi.fn(),
    },
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

describe('Sign-in page — visual restyle', () => {
  it('centers the form on screen in a single column, with no side panel', async () => {
    const { default: SignInPage } = await import('@/app/auth/sign-in/page')
    const { container } = render(<SignInPage />)
    const root = container.firstElementChild as HTMLElement
    // Was a two-column grid with a brand panel on the right, which put the form in the
    // bottom-left on desktop.
    expect(root.className).not.toMatch(/grid-cols-2/)
    const form = screen.getByRole('heading', { name: 'Welcome back' }).parentElement as HTMLElement
    expect(form.className).toMatch(/\bmx-auto\b/)
    expect(form.className).toMatch(/\bmy-auto\b/)
    expect(screen.queryByText(/one tidy panel/)).not.toBeInTheDocument()
  })

  it('shows "Continue" as the submit button text, not "Sign in"', async () => {
    const { default: SignInPage } = await import('@/app/auth/sign-in/page')
    render(<SignInPage />)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('shortens the forgot-password link text to "Forgot?"', async () => {
    const { default: SignInPage } = await import('@/app/auth/sign-in/page')
    render(<SignInPage />)
    expect(screen.getByRole('link', { name: 'Forgot?' })).toBeInTheDocument()
  })

  it('renders the magic-link button with updated copy', async () => {
    const { default: SignInPage } = await import('@/app/auth/sign-in/page')
    render(<SignInPage />)
    expect(screen.getByRole('button', { name: 'Send magic link' })).toBeInTheDocument()
  })
})

describe('Sign-up page — visual restyle', () => {
  it('centers the form on screen in a single column, with no side panel', async () => {
    const { default: SignUpPage } = await import('@/app/auth/sign-up/page')
    const { container } = render(<SignUpPage />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).not.toMatch(/grid-cols-2/)
    const form = screen.getByRole('heading', { name: 'Create your account' }).parentElement as HTMLElement
    expect(form.className).toMatch(/\bmx-auto\b/)
    expect(form.className).toMatch(/\bmy-auto\b/)
    expect(screen.queryByText(/one tidy panel/)).not.toBeInTheDocument()
  })

  it('shows "Continue" as the submit button text, not "Create account"', async () => {
    const { default: SignUpPage } = await import('@/app/auth/sign-up/page')
    render(<SignUpPage />)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create account' })).not.toBeInTheDocument()
  })
})
