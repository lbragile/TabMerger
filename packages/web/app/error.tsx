'use client'

import { ThemeToggle } from '@/components/theme-toggle'
import { ErrorHeader } from '@/components/errors/ErrorHeader'
import { ErrorBoundaryView, type ErrorBoundaryProps } from '@/components/errors/ErrorBoundaryView'

/**
 * 500 page for errors under the root layout that no nearer boundary catches: the auth pages,
 * and the marketing layout itself (its Navbar). The marketing pages and the dashboard have their
 * own boundaries that keep their header. Still inside the root layout, so the theme provider is
 * available for the toggle.
 */
export default function RootError(props: ErrorBoundaryProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <ErrorHeader end={<ThemeToggle />} />
      <ErrorBoundaryView {...props} context="site" as="main" />
    </div>
  )
}
