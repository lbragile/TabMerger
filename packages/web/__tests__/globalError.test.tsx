/**
 * Tests for app/global-error.tsx — the root error boundary.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

const mockCaptureException = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}))

vi.mock('next/error', () => ({
  default: ({ statusCode }: { statusCode: number }) => (
    <div data-testid="next-error">status {statusCode}</div>
  ),
}))

import GlobalError from '@/app/global-error'

describe('GlobalError', () => {
  it('reports the error to Sentry, which is imported only once there is an error to report', async () => {
    const error = new Error('boom')
    render(<GlobalError error={error} />)
    await waitFor(() => expect(mockCaptureException).toHaveBeenCalledWith(error))
  })

  it('renders the fallback NextError UI', () => {
    render(<GlobalError error={new Error('boom')} />)
    expect(screen.getByTestId('next-error')).toBeInTheDocument()
  })
})
