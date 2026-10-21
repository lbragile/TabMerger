import * as Sentry from '@sentry/nextjs'
import { scrubEvent } from '@/lib/sentry-scrubber'
import { isAutomatedTestEnvironment } from '@/lib/isAutomatedTestEnvironment'

export async function register() {
  // e2e/visual regression runs against a real (dev/preview-like) server; without this, every
  // thrown error and heartbeat during those runs would report to the real Sentry project.
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN || isAutomatedTestEnvironment()) return

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.VERCEL_ENV ?? 'development',
      sendDefaultPii: false,
      beforeSend: scrubEvent,
    })
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.VERCEL_ENV ?? 'development',
      sendDefaultPii: false,
      beforeSend: scrubEvent,
    })
  }
}
