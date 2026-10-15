/**
 * Tests for app/global-error.tsx — the last-resort boundary that replaces the root layout.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockCaptureException = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}))

vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'font-geist-sans' }),
  Geist_Mono: () => ({ variable: 'font-geist-mono' }),
}))

import GlobalError from '@/app/global-error'

describe('GlobalError', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockCaptureException.mockClear()
    // Rendering <html> inside RTL's <div> container is fine for these assertions, but React
    // warns about the nesting.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    document.documentElement.classList.remove('dark')
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('reports the error to Sentry, which is imported only once there is an error to report', async () => {
    const error = new Error('boom')
    render(<GlobalError error={error} retry={vi.fn()} />)
    await waitFor(() => expect(mockCaptureException).toHaveBeenCalledWith(error))
  })

  it('renders its own html and body, with the theme script and fonts', () => {
    const html = renderToStaticMarkup(<GlobalError error={new Error('boom')} retry={vi.fn()} />)
    expect(html.startsWith('<html lang="en"')).toBe(true)
    expect(html).toContain('<body class="font-geist-sans font-geist-mono font-sans"')
    expect(html).toContain("localStorage.getItem('theme')")
  })

  it('shows the 500 page with one heading, and "Try again" calls retry', () => {
    const retry = vi.fn()
    render(<GlobalError error={new Error('boom')} retry={retry} />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'This tab crashed' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('never shows the error message in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      render(<GlobalError error={new Error('secret internal detail')} retry={vi.fn()} />)
      expect(screen.queryByText(/secret internal detail/)).not.toBeInTheDocument()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('applies the saved dark theme, since the inline script does not run on a client render', async () => {
    localStorage.setItem('theme', 'dark')
    render(<GlobalError error={new Error('boom')} retry={vi.fn()} />)
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
  })

  it('links back home', () => {
    render(<GlobalError error={new Error('boom')} retry={vi.fn()} />)
    const home = screen.getByRole('link', { name: 'Back to home' })
    expect(home).toHaveAttribute('href', '/')
  })
})
