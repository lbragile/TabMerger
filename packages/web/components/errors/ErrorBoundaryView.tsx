'use client'

import { House, LayoutDashboard, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorPageShell, ShellLink } from './ErrorPageShell'
import { ReferenceId } from './ReferenceId'
import { useReportError } from './useReportError'
import { APP_LINKS, SERVER_ERROR_COPY, SITE_LINKS } from './copy'

/** The props Next.js passes an `error.tsx` / `global-error.tsx` boundary. */
export interface ErrorBoundaryProps {
  error: Error & { digest?: string }
  /** Next 16: re-fetches and re-renders the segment. Preferred over `reset`. */
  retry?: () => void
  /** Older API: re-renders without re-fetching. Used when `retry` isn't passed. */
  reset?: () => void
}

interface ErrorBoundaryViewProps extends ErrorBoundaryProps {
  /**
   * `site`: a public page. `app`: the signed-in dashboard/account shell, so the way back leads to
   * the dashboard. `global`: the root layout failed, so links are plain anchors (full page loads).
   */
  context: 'site' | 'app' | 'global'
  as?: 'main' | 'div'
  className?: string
}

/**
 * The 500 page body every error boundary renders: reports the error to Sentry, offers "Try again"
 * and a way home, and shows the error's digest as a reference ID. The error's message and stack
 * are never shown outside development, because a server error's message can hold internal detail.
 */
export function ErrorBoundaryView({ error, retry, reset, context, as = 'div', className }: ErrorBoundaryViewProps) {
  useReportError(error)

  const tryAgain = () => {
    if (retry) retry()
    else if (reset) reset()
    else window.location.reload()
  }

  const plain = context === 'global'
  const home = context === 'app' ? { href: '/dashboard', label: 'Back to dashboard' } : { href: '/', label: 'Back to home' }
  const HomeIcon = context === 'app' ? LayoutDashboard : House

  return (
    <>
      <title>{`${SERVER_ERROR_COPY.documentTitle} | TabMerger`}</title>
      <ErrorPageShell
        as={as}
        className={className}
        copy={SERVER_ERROR_COPY}
        variant="crashed"
        links={context === 'app' ? APP_LINKS : SITE_LINKS}
        plainLinks={plain}
        actions={
          <>
            <Button size="lg" onClick={tryAgain}>
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
            <Button size="lg" variant="outline" asChild>
              <ShellLink href={home.href} plain={plain}>
                <HomeIcon className="h-4 w-4" aria-hidden="true" />
                {home.label}
              </ShellLink>
            </Button>
          </>
        }
      >
        {error.digest ? <ReferenceId digest={error.digest} /> : null}
        {process.env.NODE_ENV === 'development' && error.message ? (
          <details className="mt-6 w-full max-w-full border border-dashed border-border2 bg-surface2 p-3 text-left text-xs">
            <summary className="cursor-pointer font-medium text-text2">Error details (development only)</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-text2">{error.message}</pre>
          </details>
        ) : null}
      </ErrorPageShell>
    </>
  )
}
