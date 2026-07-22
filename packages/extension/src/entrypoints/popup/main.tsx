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


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
