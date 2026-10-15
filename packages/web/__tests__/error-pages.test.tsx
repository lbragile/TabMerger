/**
 * Tests for the 404 page (app/not-found.tsx) and the error.tsx boundaries (root, marketing and
 * the signed-in app), which share components/errors/*.
 */
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockCaptureException = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}))

// The Navbar is an async server component that reads the Supabase session; the 404 page only
// needs to include it.
vi.mock('@/components/layout/Navbar', () => ({
  Navbar: () => <header data-testid="navbar" />,
}))
vi.mock('@/components/layout/Footer', () => ({
  Footer: () => <footer data-testid="footer" />,
}))

import NotFound, { metadata as notFoundMetadata } from '@/app/not-found'
import RootError from '@/app/error'
import MarketingError from '@/app/(marketing)/error'
import AppError from '@/app/(app)/error'
import { ReferenceId } from '@/components/errors/ReferenceId'

function serverError(digest?: string, message = 'boom') {
  return Object.assign(new Error(message), digest ? { digest } : {})
}

beforeEach(() => {
  mockCaptureException.mockClear()
})

describe('not-found page', () => {
  it('renders one h1, the status in words, and the marketing header and footer', () => {
    render(<NotFound />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'This tab wandered off' })).toBeInTheDocument()
    expect(screen.getByText('Error 404 · Page not found')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByTestId('navbar')).toBeInTheDocument()
    expect(screen.getByTestId('footer')).toBeInTheDocument()
  })

  it('links back home and to the main sections', () => {
    render(<NotFound />)
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/')
    const nav = screen.getByRole('navigation', { name: 'Helpful links' })
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/features', '/pricing', '/faq', '/dashboard', '/contact'])
  })

  it('keeps the illustration (with the big "404") out of the accessibility tree', () => {
    render(<NotFound />)
    expect(screen.getByTestId('error-illustration')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('error-illustration')).toHaveTextContent('404')
  })

  it('is titled "Page not found" and leaves noindex to Next, which adds it to every 404', () => {
    expect(notFoundMetadata.title).toBe('Page not found')
    // A page-level robots would be a second <meta name="robots"> next to Next's own.
    expect(notFoundMetadata.robots).toBeUndefined()
  })
})

describe('error boundaries', () => {
  it.each([
    ['root', RootError],
    ['marketing', MarketingError],
    ['app', AppError],
  ] as const)('%s boundary: reports to Sentry and calls retry on "Try again"', async (_name, Boundary) => {
    const error = serverError('123456789')
    const retry = vi.fn()
    render(<Boundary error={error} retry={retry} />)
    await waitFor(() => expect(mockCaptureException).toHaveBeenCalledWith(error))
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'This tab crashed' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('falls back to reset when retry is not passed', () => {
    const reset = vi.fn()
    render(<MarketingError error={serverError()} reset={reset} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('root boundary brings its own header with a theme toggle, inside a main landmark', () => {
    render(<RootError error={serverError()} retry={vi.fn()} />)
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Toggle theme' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('marketing and app boundaries render inside their layout, which already has the main landmark', () => {
    const { unmount } = render(<MarketingError error={serverError()} retry={vi.fn()} />)
    expect(screen.queryByRole('main')).not.toBeInTheDocument()
    unmount()
    render(<AppError error={serverError()} retry={vi.fn()} />)
    expect(screen.queryByRole('main')).not.toBeInTheDocument()
  })

  it('app boundary leads back to the dashboard', () => {
    render(<AppError error={serverError()} retry={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/dashboard')
    expect(screen.queryByRole('link', { name: 'Back to home' })).not.toBeInTheDocument()
  })

  it('site boundary leads back home', () => {
    render(<MarketingError error={serverError()} retry={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/')
  })

  it('shows the digest as a copyable reference ID', () => {
    render(<MarketingError error={serverError('2741596873')} retry={vi.fn()} />)
    expect(screen.getByTestId('error-reference-id')).toHaveTextContent('2741596873')
    expect(screen.getByRole('button', { name: 'Copy reference ID' })).toBeInTheDocument()
  })

  it('shows no reference ID when the error has no digest', () => {
    render(<MarketingError error={serverError()} retry={vi.fn()} />)
    expect(screen.queryByTestId('error-reference-id')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy reference ID' })).not.toBeInTheDocument()
  })

  it('shows the error message only in development, never in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const { unmount } = render(<MarketingError error={serverError('d1', 'db password wrong')} retry={vi.fn()} />)
      expect(screen.queryByText(/db password wrong/)).not.toBeInTheDocument()
      unmount()
      vi.stubEnv('NODE_ENV', 'development')
      render(<MarketingError error={serverError('d1', 'db password wrong')} retry={vi.fn()} />)
      expect(screen.getByText('db password wrong')).toBeInTheDocument()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('renders a hostile digest as text, not markup', () => {
    render(<MarketingError error={serverError('<img src=x onerror=alert(1)>')} retry={vi.fn()} />)
    expect(screen.getByTestId('error-reference-id')).toHaveTextContent('<img src=x onerror=alert(1)>')
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })
})

describe('reference ID', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    writeText.mockReset()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the digest and copies it, announcing success', async () => {
    writeText.mockResolvedValue(undefined)
    render(<ReferenceId digest="2741596873" />)
    expect(screen.getByTestId('error-reference-id')).toHaveTextContent('2741596873')
    expect(screen.getByRole('status')).toHaveTextContent('')

    fireEvent.click(screen.getByRole('button', { name: 'Copy reference ID' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Reference ID copied'))
    expect(writeText).toHaveBeenCalledWith('2741596873')
  })

  it('announces a failed copy', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    render(<ReferenceId digest="abc" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy reference ID' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copy failed'))
  })

  it('clears the announcement after a moment', async () => {
    vi.useFakeTimers()
    writeText.mockResolvedValue(undefined)
    render(<ReferenceId digest="abc" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy reference ID' }))
    })
    expect(screen.getByRole('status')).toHaveTextContent('Reference ID copied')
    act(() => {
      vi.advanceTimersByTime(2500)
    })
    expect(screen.getByRole('status')).toHaveTextContent('')
  })
})
