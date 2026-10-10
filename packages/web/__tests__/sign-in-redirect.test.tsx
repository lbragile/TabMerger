/**
 * Where the sign-in page sends the user after a successful password sign-in, for
 * each kind of `redirectTo` query value.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SignInPage from '@/app/auth/sign-in/page'

const push = vi.fn()
const signInWithPassword = vi.fn()
let query = ''

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signInWithPassword, signInWithOAuth: vi.fn(), signInWithOtp: vi.fn() },
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(query),
}))

async function signIn(search: string) {
  query = search
  const user = userEvent.setup()
  render(<SignInPage />)
  await user.type(screen.getByLabelText('Email'), 'user@example.com')
  await user.type(screen.getByLabelText('Password'), 'a-password')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
  return push.mock.calls[0][0] as string
}

describe('Sign-in page redirect after signing in', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signInWithPassword.mockResolvedValue({ error: null })
  })

  it('goes to the dashboard when no redirectTo is given', async () => {
    expect(await signIn('')).toBe('/dashboard')
  })

  it('goes to a same-site redirectTo path', async () => {
    expect(await signIn('redirectTo=/pricing')).toBe('/pricing')
  })

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '@evil.example'])(
    'goes to the dashboard when redirectTo is %j',
    async (value) => {
      expect(await signIn(`redirectTo=${encodeURIComponent(value)}`)).toBe('/dashboard')
    }
  )

  it('goes to the dashboard when signing in from the extension', async () => {
    expect(await signIn('redirect=extension&redirectTo=/pricing')).toBe('/dashboard')
  })
})
