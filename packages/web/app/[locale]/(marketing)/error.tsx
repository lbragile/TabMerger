'use client'

import { ErrorBoundaryView, type ErrorBoundaryProps } from '@/components/errors/ErrorBoundaryView'

/**
 * 500 page for the public pages. It renders inside the marketing layout, so the Navbar and
 * Footer stay and the layout's `<main>` holds it.
 */
export default function MarketingError(props: ErrorBoundaryProps) {
  return <ErrorBoundaryView {...props} context="site" />
}
