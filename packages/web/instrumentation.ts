import * as Sentry from '@sentry/nextjs'
import { scrubEvent } from '@/lib/sentry-scrubber'

export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return

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
