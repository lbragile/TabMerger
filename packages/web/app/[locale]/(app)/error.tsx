'use client'

import { ErrorBoundaryView, type ErrorBoundaryProps } from '@/components/errors/ErrorBoundaryView'

/**
 * 500 page for the signed-in pages (dashboard, account). It renders inside the app layout, so
 * the header with navigation, sync status and the account menu stays, and the layout's `<main>`
 * holds it.
 */
export default function AppError(props: ErrorBoundaryProps) {
  return <ErrorBoundaryView {...props} context="app" className="py-10 sm:py-16" />
}
