/**
 * MobileNavToggle panel: every link inside the open panel closes it, in each account state; and
 * the disclosure semantics (panel label, aria-controls only while open, Escape, focus return).
 */
import { describe, expect, it, vi } from 'vitest'
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
  it.each(['Features', 'Pricing', 'Compare', 'Changelog', 'FAQ'])('closes after the %s link', async (name) => {
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

describe('MobileNavToggle disclosure semantics', () => {
  const toggle = () => screen.getByRole('button', { name: /menu/i })

  it('names the panel and only points aria-controls at it while it exists', async () => {
    const user = userEvent.setup()
    render(<MobileNavToggle account={{ status: 'signedOut' }} />)
    expect(toggle()).not.toHaveAttribute('aria-controls')

    await user.click(toggle())
    const nav = screen.getByRole('navigation', { name: 'Menu' })
    expect(toggle()).toHaveAttribute('aria-controls', nav.id)
    expect(nav.id).toBe('mobile-nav-panel')

    await user.click(toggle())
    expect(toggle()).not.toHaveAttribute('aria-controls')
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('closes on Escape from inside the panel and returns focus to the toggle', async () => {
    const user = await open({ status: 'signedOut' })
    screen.getByRole('link', { name: 'Pricing' }).focus()
    await user.keyboard('{Escape}')
    expect(panelOpen()).toBe(false)
    expect(toggle()).toHaveFocus()
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on Escape while the toggle itself has focus', async () => {
    const user = await open({ status: 'signedOut' })
    expect(toggle()).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(panelOpen()).toBe(false)
    expect(toggle()).toHaveFocus()
  })

  it('closes on Escape when nothing has focus', async () => {
    const user = await open({ status: 'signedOut' })
    ;(document.activeElement as HTMLElement | null)?.blur()
    await user.keyboard('{Escape}')
    expect(panelOpen()).toBe(false)
  })

  it('ignores other keys', async () => {
    const user = await open({ status: 'signedOut' })
    // Not Enter or Space: those press the focused toggle.
    await user.keyboard('{ArrowDown}')
    expect(panelOpen()).toBe(true)
    await user.keyboard('a')
    expect(panelOpen()).toBe(true)
  })

  it('leaves an Escape meant for another layer alone', async () => {
    const user = userEvent.setup()
    render(
      <>
        <MobileNavToggle account={{ status: 'signedOut' }} />
        <input aria-label="elsewhere" />
      </>
    )
    await user.click(toggle())
    screen.getByRole('textbox', { name: 'elsewhere' }).focus()
    await user.keyboard('{Escape}')
    expect(panelOpen()).toBe(true)
    expect(screen.getByRole('textbox', { name: 'elsewhere' })).toHaveFocus()
  })

  it('leaves an Escape another handler already handled alone', async () => {
    const user = await open({ status: 'signedOut' })
    const handled = (e: KeyboardEvent) => e.preventDefault()
    window.addEventListener('keydown', handled, { capture: true })
    try {
      await user.keyboard('{Escape}')
      expect(panelOpen()).toBe(true)
    } finally {
      window.removeEventListener('keydown', handled, { capture: true })
    }
  })

  it('returns focus to the toggle after a panel link closes it', async () => {
    const user = await open({ status: 'signedIn', email: 'user@example.test', initials: 'US' })
    const link = screen.getByRole('link', { name: 'Dashboard' })
    link.addEventListener('click', (e) => e.preventDefault())
    await user.click(link)
    expect(panelOpen()).toBe(false)
    expect(toggle()).toHaveFocus()
  })

  it('stops listening for Escape once closed', async () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    const user = await open({ status: 'signedOut' })
    await user.click(toggle())
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function))
    remove.mockRestore()
  })
})
