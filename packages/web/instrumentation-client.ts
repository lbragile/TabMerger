import * as Sentry from '@sentry/nextjs';
import { scrubEvent } from '@/lib/sentry-scrubber';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    // Session Replay: low background sample, full capture on error (crash-context video).
    // maskAllText/blockAllMedia default to true — keep them, this app handles auth/billing.
    integrations: [Sentry.replayIntegration()],
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
