'use client'

import { useEffect } from 'react'

/**
 * Reports an error caught by an error boundary to Sentry, once per error.
 *
 * Sentry is imported here, not at the top of the module: the boundaries are part of every page's
 * JS, and Sentry is only needed once something has already gone wrong.
 */
export function useReportError(error: Error) {
  useEffect(() => {
    void import('@sentry/nextjs').then((Sentry) => Sentry.captureException(error))
  }, [error])
}
