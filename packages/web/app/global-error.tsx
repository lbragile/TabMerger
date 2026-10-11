'use client'

import NextError from 'next/error'
import { useEffect } from 'react'

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    // Imported here, not at the top: this module is part of every page's JS, and Sentry is
    // only needed once something has already gone wrong.
    void import('@sentry/nextjs').then((Sentry) => Sentry.captureException(error))
  }, [error])

  return (
    <html>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  )
}
