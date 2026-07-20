import * as Sentry from '@sentry/nextjs';
import { scrubEvent } from '@/lib/sentry-scrubber';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    sendDefaultPii: false,
    // ponytail: no tracing/replay — free tier, just error capture
    beforeSend: scrubEvent,
  });
}
