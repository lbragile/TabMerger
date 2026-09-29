import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, afterEach } from 'vitest'
import { UpgradedBanner } from '@/components/dashboard/UpgradedBanner'

describe('UpgradedBanner', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('welcomes the user to the plan they bought', () => {
    render(<UpgradedBanner planName="Pro AI" />)

    expect(screen.getByRole('status')).toHaveTextContent('Welcome to Pro AI!')
  })

  it('hides on dismiss and drops only `upgraded` from the URL', async () => {
    window.history.replaceState(null, '', '/dashboard?upgraded=1&organizeRunId=r1')
    render(<UpgradedBanner planName="Pro" />)

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(window.location.pathname).toBe('/dashboard')
    expect(window.location.search).toBe('?organizeRunId=r1')
  })
})
