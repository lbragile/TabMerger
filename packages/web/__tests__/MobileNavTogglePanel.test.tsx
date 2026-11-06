/**
 * MobileNavToggle panel: every link inside the open panel closes it, in each account state.
 */
import { describe, expect, it } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MobileNavToggle } from '@/components/layout/MobileNavToggle'
import type { NavAccountState } from '@/components/layout/NavAccount'

async function open(account: NavAccountState) {
  const user = userEvent.setup()
  render(<MobileNavToggle account={account} />)
  await act(async () => {
    await user.click(screen.getByRole('button', { name: 'Open menu' }))
  })
  return user
}

const panelOpen = () => document.getElementById('mobile-nav-panel') !== null

describe('MobileNavToggle panel links close the panel', () => {
  it.each(['Features', 'Pricing', 'Changelog', 'FAQ'])('closes after the %s link', async (name) => {
    const user = await open({ status: 'signedOut' })
    expect(panelOpen()).toBe(true)
    const link = screen.getByRole('link', { name })
    link.addEventListener('click', (e) => e.preventDefault())
    await user.click(link)
    expect(panelOpen()).toBe(false)
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false')
  })

  it.each(['Sign in', 'Get started'])('closes after the signed-out %s link', async (name) => {
    const user = await open({ status: 'signedOut' })
    const link = screen.getByRole('link', { name })
    link.addEventListener('click', (e) => e.preventDefault())
    await user.click(link)
    expect(panelOpen()).toBe(false)
  })

  it.each(['Dashboard', 'Account'])('closes after the signed-in %s link', async (name) => {
    const user = await open({ status: 'signedIn', email: 'user@example.test', initials: 'US' })
    const link = screen.getByRole('link', { name })
    link.addEventListener('click', (e) => e.preventDefault())
    await user.click(link)
    expect(panelOpen()).toBe(false)
  })

  it('closes after the sign out button and keeps it a submit button', async () => {
    const user = await open({ status: 'signedIn', email: 'user@example.test', initials: 'US' })
    const button = screen.getByRole('button', { name: 'Sign out' })
    expect(button).toHaveAttribute('type', 'submit')
    button.closest('form')?.addEventListener('submit', (e) => e.preventDefault())
    await user.click(button)
    expect(panelOpen()).toBe(false)
  })

  it('shows one busy placeholder row, no account links, while the session is loading', async () => {
    await open({ status: 'loading' })
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull()
  })

  it('toggles closed from the button itself', async () => {
    const user = await open({ status: 'signedOut' })
    await user.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(panelOpen()).toBe(false)
  })
})
