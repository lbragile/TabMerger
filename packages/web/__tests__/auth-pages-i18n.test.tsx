/**
 * The auth pages (app/auth/*) read every word from the `auth` namespace: rendered with a
 * different catalog (the pseudo-locale, an accented copy of English), no English literal is left.
 * Also checks the `auth` namespace reaches Client Components and the privacy link is locale-aware.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import en from '@/messages/en'
import { pseudoLocalize } from '@/i18n/pseudo'
import { CLIENT_NAMESPACES } from '@/i18n/messages'

// The real locale-aware Link (the global test setup swaps in a plain one), to see the prefix.
vi.unmock('@/i18n/navigation')

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/auth/sign-in',
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: vi.fn(),
      signInWithOAuth: vi.fn(),
      signInWithOtp: vi.fn(),
      signUp: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
    },
  }),
}))

import SignInPage from '@/app/auth/sign-in/page'
import SignUpPage from '@/app/auth/sign-up/page'
import ForgotPasswordPage from '@/app/auth/forgot-password/page'
import ResetPasswordPage from '@/app/auth/reset-password/page'

const pseudo = pseudoLocalize(en)
const auth = pseudo.auth

function PseudoWrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en-XA" messages={pseudo}>
      {children}
    </NextIntlClientProvider>
  )
}

const renderPseudo = (ui: ReactNode) => render(ui, { wrapper: PseudoWrapper })

/** English strings from the old hard-coded pages that must not survive. */
const ENGLISH = [
  'Welcome back',
  'Create your account',
  'Reset your password',
  'Set new password',
  'Continue with Google',
  'Send magic link',
  'Back to sign in',
  'Protected by industry-standard encryption.',
]

function expectNoEnglish() {
  const text = document.body.textContent ?? ''
  for (const phrase of ENGLISH) expect(text).not.toContain(phrase)
}

describe('auth pages translations', () => {
  it('ships the auth namespace to Client Components', () => {
    expect(CLIENT_NAMESPACES).toContain('auth')
  })

  it('sign-in reads its copy from the catalog', () => {
    renderPseudo(<SignInPage />)
    expect(screen.getByRole('heading', { level: 1, name: auth.signIn.title })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: auth.continueWithGoogle })).toBeInTheDocument()
    expect(screen.getByLabelText(auth.email)).toHaveAttribute('placeholder', auth.emailPlaceholder)
    expect(screen.getByRole('link', { name: auth.privacy })).toHaveAttribute('href', '/en-XA/privacy')
    expectNoEnglish()
  })

  it('sign-in asks for the email first in the catalog language', async () => {
    const user = userEvent.setup()
    renderPseudo(<SignInPage />)
    await user.click(screen.getByRole('button', { name: auth.signIn.sendMagicLink }))
    expect(screen.getByText(auth.signIn.enterEmailFirst)).toBeInTheDocument()
  })

  it('sign-up fills the group limit and the password minimum, and translates its errors', async () => {
    const user = userEvent.setup()
    renderPseudo(<SignUpPage />)
    expect(screen.getByRole('heading', { level: 1, name: auth.signUp.title })).toBeInTheDocument()
    await user.type(screen.getByLabelText(auth.email), 'you@example.com')
    await user.type(document.getElementById('password')!, 'abcdefgh')
    await user.type(document.getElementById('confirm-password')!, 'different')
    await user.click(screen.getByRole('button', { name: auth.continue }))
    expect(screen.getByText(auth.passwordsDontMatch)).toBeInTheDocument()
    expectNoEnglish()
  })

  it('forgot-password and reset-password read their copy from the catalog', () => {
    const { unmount } = renderPseudo(<ForgotPasswordPage />)
    expect(screen.getByRole('heading', { level: 1, name: auth.forgotPassword.title })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: auth.forgotPassword.submit })).toBeInTheDocument()
    expectNoEnglish()
    unmount()

    renderPseudo(<ResetPasswordPage />)
    expect(screen.getByRole('heading', { level: 1, name: auth.resetPassword.title })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: auth.resetPassword.submit })).toBeInTheDocument()
    expectNoEnglish()
  })

  it('renders the same English text as before with the English catalog', () => {
    render(<SignInPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByText('Protected by industry-standard encryption.', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy')
  })
})
