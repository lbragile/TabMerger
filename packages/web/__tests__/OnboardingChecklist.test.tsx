import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { OnboardingChecklist } from '@/components/dashboard/OnboardingChecklist'

function fireInstalledMessage() {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { source: 'tabmerger-extension', type: 'INSTALLED', version: '2.0.0' },
      })
    )
  })
}

describe('OnboardingChecklist compact banner restyle', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows "2 of 4 done" when signed in but not pro (install not yet detected)', () => {
    render(<OnboardingChecklist isSignedIn={true} isPro={false} />)
    expect(screen.getByText('2 of 4 done')).toBeInTheDocument()
  })

  it('shows "3 of 4 done" when signed in and pro', () => {
    render(<OnboardingChecklist isSignedIn={true} isPro={true} />)
    expect(screen.getByText('3 of 4 done')).toBeInTheDocument()
  })

  it('shows "1 of 4 done" when signed out and not pro', () => {
    render(<OnboardingChecklist isSignedIn={false} isPro={false} />)
    expect(screen.getByText('1 of 4 done')).toBeInTheDocument()
  })

  it('renders a progress bar reflecting completed step count via aria-valuenow', () => {
    render(<OnboardingChecklist isSignedIn={true} isPro={false} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '2')
    expect(bar).toHaveAttribute('aria-valuemax', '4')
  })

  it('marks the install step done when the extension postMessage signal arrives', () => {
    render(<OnboardingChecklist isSignedIn={false} isPro={false} />)
    expect(screen.getByText('1 of 4 done')).toBeInTheDocument()

    fireInstalledMessage()

    expect(screen.getByText('2 of 4 done')).toBeInTheDocument()
    expect(localStorage.getItem('tm_extension_installed')).toBe('1')
  })

  it('ignores postMessage events from a different origin', () => {
    render(<OnboardingChecklist isSignedIn={false} isPro={false} />)
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://evil.example.com',
          data: { source: 'tabmerger-extension', type: 'INSTALLED', version: '2.0.0' },
        })
      )
    })
    expect(screen.getByText('1 of 4 done')).toBeInTheDocument()
  })

  it('reads a previously persisted install flag from localStorage on mount', () => {
    localStorage.setItem('tm_extension_installed', '1')
    render(<OnboardingChecklist isSignedIn={false} isPro={false} />)
    expect(screen.getByText('2 of 4 done')).toBeInTheDocument()
  })
})
