import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MobileNavToggle } from '@/components/layout/MobileNavToggle'

const REPO_URL = 'https://github.com/lbragile/TabMerger'

async function openPanel(starsPromise?: Promise<number | null>) {
  const user = userEvent.setup()
  render(<MobileNavToggle starsPromise={starsPromise} />)
  // use() suspends on the promise; act(async) flushes it so the row's count is in the DOM.
  await act(async () => {
    await user.click(screen.getByRole('button', { name: 'Open menu' }))
  })
  return user
}

describe('MobileNavToggle GitHub row', () => {
  it('is not rendered while the panel is closed', () => {
    render(<MobileNavToggle starsPromise={Promise.resolve(5)} />)
    expect(screen.queryByRole('link', { name: /on GitHub/ })).not.toBeInTheDocument()
  })

  it('shows the repo link with the compact count when the promise resolves a number', async () => {
    await openPanel(Promise.resolve(1234))
    const row = screen.getByRole('link', { name: 'TabMerger on GitHub, 1,234 stars' })
    expect(row).toHaveAttribute('href', REPO_URL)
    expect(row).toHaveAttribute('target', '_blank')
    expect(row).toHaveAttribute('rel', 'noopener noreferrer')
    expect(row).toHaveTextContent('GitHub')
    expect(row).toHaveTextContent('1.2K')
  })

  it('sits right after the FAQ link', async () => {
    await openPanel(Promise.resolve(10))
    const row = screen.getByRole('link', { name: 'TabMerger on GitHub, 10 stars' })
    const faq = screen.getByRole('link', { name: 'FAQ' })
    expect(faq.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(faq.nextElementSibling).toBe(row)
  })

  it('shows the row without a count when the promise resolves null', async () => {
    await openPanel(Promise.resolve(null))
    const row = screen.getByRole('link', { name: 'TabMerger on GitHub' })
    expect(row).toHaveAttribute('href', REPO_URL)
    expect(row.textContent).toBe('GitHub')
  })

  it('shows the row without a count while the promise is still pending', async () => {
    await openPanel(new Promise<number | null>(() => {}))
    const row = screen.getByRole('link', { name: 'TabMerger on GitHub' })
    expect(row.textContent).toBe('GitHub')
  })

  it('shows the row without a count when no promise is passed', async () => {
    await openPanel(undefined)
    const row = screen.getByRole('link', { name: 'TabMerger on GitHub' })
    expect(row).toHaveAttribute('href', REPO_URL)
    expect(row.textContent).toBe('GitHub')
  })

  it('closes the panel when clicked', async () => {
    const user = await openPanel(Promise.resolve(3))
    const row = screen.getByRole('link', { name: 'TabMerger on GitHub, 3 stars' })
    // jsdom does not navigate on a target=_blank anchor; the click handler still runs.
    await user.click(row)
    expect(screen.queryByRole('link', { name: /on GitHub/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
  })

  it('closes the panel when the no-count row is clicked', async () => {
    const user = await openPanel(undefined)
    await user.click(screen.getByRole('link', { name: 'TabMerger on GitHub' }))
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
  })
})

describe('MobileNavToggle language', () => {
  // The header's language button shows at every width, and the bar stays visible with the panel
  // open: a row here would put two pickers on screen. Navbar.test.tsx covers the header button.
  it('has no language picker of its own', async () => {
    await openPanel(Promise.resolve(10))
    await screen.findByRole('link', { name: 'TabMerger on GitHub, 10 stars' })
    expect(screen.queryByRole('button', { name: /^Language/ })).not.toBeInTheDocument()
  })
})

describe('MobileNavToggle — analytics privacy', () => {
  it('keeps the signed-in email out of analytics', async () => {
    const user = userEvent.setup()
    render(<MobileNavToggle email="someone@example.test" initials="SO" />)
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Open menu' }))
    })
    expect(screen.getByText('someone@example.test')).toHaveClass('ph-no-capture')
  })
})
