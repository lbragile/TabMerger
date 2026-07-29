import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'

// Navbar is an async server component — mock its data dependency so we can
// `await` and render the markup under test.
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: null } }),
    },
  }),
}))

import { Navbar } from '@/components/layout/Navbar'

describe('Navbar', () => {
  it('renders nav links including Changelog', async () => {
    render(await Navbar())
    expect(screen.getByRole('link', { name: 'Features' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pricing' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Changelog' })).toBeInTheDocument()
  })

  it('renders the theme toggle button', async () => {
    render(await Navbar())
    expect(screen.getByRole('button', { name: 'Toggle theme' })).toBeInTheDocument()
  })

  it('shows sign-in controls when logged out', async () => {
    render(await Navbar())
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('opens and closes the mobile nav panel via the hamburger toggle', async () => {
    const user = userEvent.setup()
    render(await Navbar())

    const toggle = screen.getByRole('button', { name: 'Open menu' })
    expect(screen.queryByRole('button', { name: 'Close menu' })).not.toBeInTheDocument()

    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
  })
})
