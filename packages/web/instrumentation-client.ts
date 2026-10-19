import { scrubBreadcrumb, scrubEvent, scrubPreparedEvent, scrubRecordingEvent } from '@/lib/sentry-scrubber'
import { whenPageIdle } from '@/components/DeferredOnLoad'

type SentryModule = typeof import('@sentry/nextjs')

// Sentry and its Replay integration are several hundred KB. They are imported once the page has
// loaded and the browser is idle, so they never delay first paint or input. The cost is that an
// error thrown before then goes unreported; those are errors the visitor never got to see.
const sentry: Promise<SentryModule> | null =
  typeof window === 'undefined' || !process.env.NEXT_PUBLIC_SENTRY_DSN
    ? null
    : new Promise((resolve) => {
        whenPageIdle(() => {
          void import('@sentry/nextjs').then((Sentry) => {
            Sentry.init({
              dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
              environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
              sendDefaultPii: false,
              beforeSend: scrubEvent,
              // Replay records breadcrumbs as they're added, so fragments (`#key=…`) go here too.
              beforeBreadcrumb: scrubBreadcrumb,
              // Session Replay: low background sample, full capture on error (crash-context video).
              // maskAllText/blockAllMedia default to true — keep them, this app handles auth/billing.
              integrations: [Sentry.replayIntegration({ beforeAddRecordingEvent: scrubRecordingEvent })],
              replaysSessionSampleRate: 0.1,
              replaysOnErrorSampleRate: 1.0,
            })
            // Replay events skip `beforeSend`; this strips fragments from their `urls` list.
            Sentry.getClient()?.on('postprocessEvent', scrubPreparedEvent)
            resolve(Sentry)
          })
        })
      })

export const onRouterTransitionStart = (href: string, navigationType: 'push' | 'replace' | 'traverse') => {
  void sentry?.then((Sentry) => Sentry.captureRouterTransitionStart(href, navigationType))
}
