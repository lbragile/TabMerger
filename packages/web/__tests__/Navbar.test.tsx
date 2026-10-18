import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Navbar is an async server component — mock its data dependency so we can
// `await` and render the markup under test.
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: null } }),
    },
  }),
}))

// The navbar's GitHub badge reads the star count on the server; no network in unit tests.
const { getGithubStarCount } = vi.hoisted(() => ({ getGithubStarCount: vi.fn() }))
vi.mock('@/lib/githubStats', () => ({ getGithubStarCount }))

import { Navbar } from '@/components/layout/Navbar'

describe('Navbar', () => {
  beforeEach(() => {
    getGithubStarCount.mockReset()
    getGithubStarCount.mockResolvedValue(null)
  })

  it('renders the GitHub badge with the star count when the count resolves a number', async () => {
    getGithubStarCount.mockResolvedValue(1234)
    await act(async () => {
      render(await Navbar())
    })
    const badge = screen.getByRole('link', { name: 'TabMerger on GitHub, 1,234 stars' })
    expect(badge).toHaveAttribute('href', 'https://github.com/lbragile/TabMerger')
    expect(badge).toHaveAttribute('target', '_blank')
    expect(badge).toHaveAttribute('rel', 'noopener noreferrer')
    expect(badge).toHaveTextContent('1.2K')
  })

  it('renders the plain GitHub link, with no number, when the count resolves null', async () => {
    await act(async () => {
      render(await Navbar())
    })
    const badge = screen.getByRole('link', { name: 'TabMerger on GitHub' })
    expect(badge).toHaveAttribute('href', 'https://github.com/lbragile/TabMerger')
    expect(badge.textContent).toBe('')
  })

  it('starts the star lookup once and shares it with the mobile panel', async () => {
    getGithubStarCount.mockResolvedValue(9)
    const user = userEvent.setup()
    await act(async () => {
      render(await Navbar())
    })
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Open menu' }))
    })
    // Desktop badge and the mobile row both show the count from the single lookup.
    expect(screen.getAllByRole('link', { name: 'TabMerger on GitHub, 9 stars' })).toHaveLength(2)
    expect(getGithubStarCount).toHaveBeenCalledTimes(1)
  })

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

  it('puts the language button just before the theme toggle, from md, icon-only below lg', async () => {
    await act(async () => {
      render(await Navbar())
    })
    const language = await screen.findByRole('button', { name: 'Language: English (EN)' })
    expect(language.nextElementSibling).toBe(screen.getByRole('button', { name: 'Toggle theme' }))
    expect(language).toHaveClass('hidden', 'md:inline-flex')
    expect(language).toHaveTextContent('EN')
    expect(language.querySelector('span')).toHaveClass('hidden', 'lg:inline')
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

describe('Navbar: header controls', () => {
  it('gives Sign in and Get started the same 1px border as the toggle and the GitHub badge', async () => {
    getGithubStarCount.mockResolvedValue(10)
    await act(async () => {
      render(await Navbar())
    })
    // Same 36px box and same border, so the browser snaps all four to the same device pixels.
    expect(screen.getByRole('link', { name: 'Sign in' }).className).toContain('border-transparent')
    expect(screen.getByRole('link', { name: 'Get started' }).className).toContain('border-primary')
  })
})
