import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/browser';
import type { Breadcrumb, ErrorEvent } from '@sentry/browser';
import { queryClient } from '@/lib/queryClient';
import { App } from './App';
import '@/styles/globals.css';


if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    // Session Replay: the popup is a real DOM page (unlike the background service
    // worker, which has no window/DOM and can't run this), so replayIntegration works
    // here. But the popup typically lives only a few seconds (closes on blur), so a
    // "session" replay is mostly just the on-error tail — low background sample,
    // full capture on error, same as the web app. maskAllText/blockAllMedia default
    // to true — keep them, tab titles/URLs are user data.
    integrations: [Sentry.replayIntegration()],
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    // ponytail: strip browsing URLs from events — tab URLs are user PII
    beforeSend(event: ErrorEvent) {
      if (event.request) event.request = { ...event.request, url: '[redacted]', headers: {} }
      // ponytail: Sentry v10 breadcrumbs is now Breadcrumb[] directly (not {values: Breadcrumb[]})
      if (event.breadcrumbs) {
        event.breadcrumbs = (event.breadcrumbs as Breadcrumb[]).map((b) => ({
          ...b,
          data: b.data ? { ...b.data, url: '[redacted]', from: '[redacted]', to: '[redacted]' } : b.data,
        })) as typeof event.breadcrumbs
      }
      return event
    },
  });
}


async function bootstrap() {
  // ponytail: dev-only fetch intercept for /api/ai/* so iterating on AI UI
  // doesn't burn real Anthropic cost or require a running web app + Supabase
  // session. Never bundled into production — import.meta.env.DEV is
  // statically replaced and dead-code-eliminated by Vite/WXT at build time.
  // See src/mocks/devFetchMock.ts for why this isn't MSW's setupWorker.
  if (import.meta.env.DEV) {
    const { installDevFetchMock } = await import('@/mocks/devFetchMock');
    installDevFetchMock();
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>
  );
}

bootstrap();
